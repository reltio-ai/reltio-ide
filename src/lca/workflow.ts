import type { CloudProvider } from './cloud';
import { missingEnvKeys } from './envCheck';
import { ALL_LCA_HOOKS } from './hooks';
import { classifyTurn, isExplicitApproval, type LcaIntent } from './intent';
import type { ProjectContext } from './context';
import { listObjectTypes, resolveAttributes, resolveObjectType } from './l3Lookup';
import { assessPhysicalAccess } from './physicalConfig';
import { TENANT_CONNECTION_MESSAGE } from './tenantGate';

export type WorkflowState =
	| 'TENANT_CONNECTION_REQUIRED'
	| 'TENANT_CONNECTED'
	| 'COLLECT_REQUIREMENTS'
	| 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION'
	| 'OBJECT_ATTRIBUTES_CONFIRMED'
	| 'DESIGN_PENDING_APPROVAL'
	| 'DESIGN_APPROVED'
	| 'IMPLEMENTATION_GENERATED'
	| 'DEPLOYMENT_PENDING'
	| 'DEPLOYED'
	| 'CONNECTIVITY_PENDING'
	| 'CONNECTIVITY_CONFIRMED'
	| 'TENANT_CONFIG_PENDING'
	| 'TENANT_CONFIG_APPLIED'
	| 'VERIFICATION'
	| 'COMPLETED';

/** User-facing phase. External changes are impossible outside the matching phase. */
export type LcaPhase =
	| 'ASK'
	| 'REQUIREMENT_GATHERING'
	| 'GENERATE'
	| 'DEPLOY_PENDING_APPROVAL'
	| 'DEPLOY'
	| 'TEST'
	| 'L3_PREVIEW'
	| 'L3_PENDING_APPROVAL'
	| 'L3_UPDATE'
	| 'COMPLETE';

export type AllowedAction = 'answer' | 'ask' | 'generate' | 'previewDeploy' | 'deploy' | 'test' | 'previewL3' | 'updateL3';

export interface LcaWorkflow {
	state: WorkflowState;
	tenantAware: boolean;
	intent: LcaIntent;
	phase: LcaPhase;
	workingDirectory?: string;
	tenantId?: string;
	customerName?: string;
	targetType?: string;
	targetTypeUri?: string;
	targetKind?: 'entity' | 'relation' | 'changeRequest';
	hook?: string;
	additionalHooks?: string[];
	attributesRead?: string[];
	attributesAdded?: string[];
	attributesUpdated?: string[];
	/** True only after the user names attributes, or explicitly says none. */
	attributesSpecified?: boolean;
	cloudProvider?: 'aws' | 'gcp' | 'azure' | 'native';
	javaPackage?: string;
	implementationModule?: string;
	cloudFunctionIdentifier?: string;
	connectivityStatus?: 'unknown' | 'not-required' | 'missing' | 'confirmed';
	implementationLanguage?: string;
	pendingConfigurationPatch?: Record<string, unknown>;
	objectAttributesConfirmed: boolean;
	designApproved: boolean;
	deploymentApproved: boolean;
	l3UpdateApproved: boolean;
}

export function createWorkflow(partial: Partial<LcaWorkflow> = {}): LcaWorkflow {
	const workflow: LcaWorkflow = {
		state: 'TENANT_CONNECTION_REQUIRED',
		tenantAware: true,
		intent: 'generate',
		phase: 'REQUIREMENT_GATHERING',
		implementationLanguage: 'Java',
		objectAttributesConfirmed: false,
		designApproved: false,
		deploymentApproved: false,
		l3UpdateApproved: false,
		...partial,
	};
	if (
		partial.attributesSpecified === undefined
		&& (partial.attributesRead !== undefined || partial.attributesAdded !== undefined || partial.attributesUpdated !== undefined)
	) {
		workflow.attributesSpecified = true;
	}
	if (partial.phase === undefined) {
		workflow.phase = phaseFor(workflow);
	}
	return workflow;
}

export function phaseFor(workflow: Pick<LcaWorkflow, 'intent' | 'state' | 'deploymentApproved' | 'l3UpdateApproved'>): LcaPhase {
	if (workflow.intent === 'advise' || workflow.intent === 'inspect' || workflow.intent === 'validation-only') {
		return 'ASK';
	}
	switch (workflow.state) {
		case 'TENANT_CONNECTION_REQUIRED':
		case 'TENANT_CONNECTED':
		case 'COLLECT_REQUIREMENTS':
		case 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION':
		case 'OBJECT_ATTRIBUTES_CONFIRMED':
		case 'DESIGN_PENDING_APPROVAL':
			return 'REQUIREMENT_GATHERING';
		case 'DESIGN_APPROVED':
		case 'IMPLEMENTATION_GENERATED':
			return 'GENERATE';
		case 'DEPLOYMENT_PENDING':
			return workflow.deploymentApproved ? 'DEPLOY' : 'DEPLOY_PENDING_APPROVAL';
		case 'DEPLOYED':
		case 'CONNECTIVITY_PENDING':
		case 'CONNECTIVITY_CONFIRMED':
		case 'VERIFICATION':
			return 'TEST';
		case 'TENANT_CONFIG_PENDING':
			return workflow.l3UpdateApproved ? 'L3_UPDATE' : 'L3_PREVIEW';
		case 'TENANT_CONFIG_APPLIED':
			return 'L3_UPDATE';
		case 'COMPLETED':
			return 'COMPLETE';
		default:
			return 'REQUIREMENT_GATHERING';
	}
}

/** LCA application code is Java. Supporting files may use their own formats. */
export function requireJava(language?: string): { ok: boolean; message: string } {
	const value = (language ?? 'Java').trim();
	if (!value || value.toLowerCase() === 'java') {
		return { ok: true, message: 'Java' };
	}
	return { ok: false, message: `LCA code must be Java. Refusing ${value}.` };
}

export type Gate = 'generate' | 'deploy' | 'updateL3';

export function gate(workflow: LcaWorkflow, action: Gate): { allowed: boolean; message: string } {
	if (workflow.intent === 'validation-only') {
		return { allowed: false, message: 'Validation-only requirements use DVF. Do not generate an LCA or deploy.' };
	}
	if (workflow.intent === 'inspect' || workflow.intent === 'advise' || workflow.intent === 'register') {
		if (action === 'generate' || action === 'deploy') {
			return {
				allowed: false,
				message: workflow.intent === 'register'
					? 'Direct registration does not generate or deploy code.'
					: 'Inspection does not generate or deploy code.',
			};
		}
	}
	if (action === 'generate') {
		const gaps = missingRequirements(workflow);
		if (gaps.length > 0) {
			return { allowed: false, message: `Missing ${gaps.map(gap => gap.field).join(', ')}. Ask; do not guess.` };
		}
		if (!workflow.objectAttributesConfirmed || workflow.state === 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION') {
			return { allowed: false, message: 'Confirm the object type and attributes before generating code.' };
		}
		if (!workflow.designApproved || workflow.state === 'DESIGN_PENDING_APPROVAL') {
			return { allowed: false, message: 'Print the LCA design and wait for approval before generating code.' };
		}
		if (workflow.state !== 'DESIGN_APPROVED' && workflow.state !== 'IMPLEMENTATION_GENERATED') {
			return { allowed: false, message: `Code generation is not available in state ${workflow.state}.` };
		}
		const language = requireJava(workflow.implementationLanguage);
		if (!language.ok) {
			return { allowed: false, message: language.message };
		}
		return { allowed: true, message: 'Java code generation is approved.' };
	}
	if (action === 'deploy') {
		if (workflow.phase === 'DEPLOY_PENDING_APPROVAL' || workflow.state !== 'DEPLOYMENT_PENDING' || !workflow.deploymentApproved) {
			return { allowed: false, message: 'Show the deployment target and wait for explicit approval before deploying.' };
		}
		return { allowed: true, message: 'Deployment is approved.' };
	}
	if (!connectivityReady(workflow)) {
		return { allowed: false, message: 'Confirm Reltio-to-cloud connectivity for this tenant before updating L3.' };
	}
	if (workflow.phase === 'L3_PREVIEW' || workflow.phase === 'L3_PENDING_APPROVAL' || !workflow.l3UpdateApproved || workflow.state !== 'TENANT_CONFIG_PENDING') {
		return { allowed: false, message: 'Show the lifecycleActions diff and wait for confirmation before updating L3.' };
	}
	return { allowed: true, message: 'Tenant configuration update is approved.' };
}

/** A new code change re-enters confirmation even when an LCA already exists. */
export function beginCodeChange(workflow: LcaWorkflow): LcaWorkflow {
	return {
		...workflow,
		state: workflow.targetType ? 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION' : 'COLLECT_REQUIREMENTS',
		phase: 'REQUIREMENT_GATHERING',
		implementationLanguage: 'Java',
		objectAttributesConfirmed: false,
		designApproved: false,
		deploymentApproved: false,
		l3UpdateApproved: false,
		attributesSpecified: false,
		pendingConfigurationPatch: undefined,
	};
}

export function markObjectAttributesConfirmed(workflow: LcaWorkflow): LcaWorkflow {
	return { ...workflow, state: 'OBJECT_ATTRIBUTES_CONFIRMED', phase: 'REQUIREMENT_GATHERING', objectAttributesConfirmed: true };
}

export function markDesignPending(workflow: LcaWorkflow): LcaWorkflow {
	return {
		...workflow,
		state: 'DESIGN_PENDING_APPROVAL',
		phase: 'REQUIREMENT_GATHERING',
		designApproved: false,
		cloudProvider: workflow.cloudProvider ?? 'aws',
	};
}

export function markDesignApproved(workflow: LcaWorkflow): LcaWorkflow {
	return { ...workflow, state: 'DESIGN_APPROVED', phase: 'GENERATE', designApproved: true };
}

export function markImplementationGenerated(workflow: LcaWorkflow): LcaWorkflow {
	return { ...workflow, state: 'IMPLEMENTATION_GENERATED', phase: 'GENERATE' };
}

export function markDeploymentPending(workflow: LcaWorkflow, approved: boolean): LcaWorkflow {
	return {
		...workflow,
		state: 'DEPLOYMENT_PENDING',
		phase: approved ? 'DEPLOY' : 'DEPLOY_PENDING_APPROVAL',
		deploymentApproved: approved,
	};
}

export function markDeployed(workflow: LcaWorkflow, cloudFunctionIdentifier: string): LcaWorkflow {
	return {
		...workflow,
		state: 'CONNECTIVITY_PENDING',
		phase: 'TEST',
		cloudFunctionIdentifier,
		deploymentApproved: true,
		connectivityStatus: workflow.connectivityStatus === 'confirmed' || workflow.connectivityStatus === 'not-required'
			? workflow.connectivityStatus
			: 'unknown',
	};
}

/** A cloud deploy succeeded. The lifecycleActions update is the next step, using the function name already on the workflow. */
export function noteDeploySuccess(workflow: LcaWorkflow, functionName: string): LcaWorkflow {
	const name = functionName.trim() || workflow.cloudFunctionIdentifier;
	return {
		...markDeployed(workflow, name ?? functionName),
		state: 'TENANT_CONFIG_PENDING',
		phase: 'L3_UPDATE',
		l3UpdateApproved: true,
	};
}

export function markConnectivityConfirmed(workflow: LcaWorkflow, status: 'confirmed' | 'not-required' = 'confirmed'): LcaWorkflow {
	return { ...workflow, state: 'CONNECTIVITY_CONFIRMED', phase: 'TEST', connectivityStatus: status };
}

export function markTenantConfigPending(workflow: LcaWorkflow, patch: Record<string, unknown>, approved: boolean): LcaWorkflow {
	return {
		...workflow,
		state: 'TENANT_CONFIG_PENDING',
		phase: approved ? 'L3_UPDATE' : 'L3_PREVIEW',
		pendingConfigurationPatch: patch,
		l3UpdateApproved: approved,
	};
}

export function markTenantConfigApplied(workflow: LcaWorkflow): LcaWorkflow {
	return { ...workflow, state: 'TENANT_CONFIG_APPLIED', phase: 'COMPLETE', l3UpdateApproved: true };
}

export interface RequirementGap {
	field: 'targetType' | 'hook' | 'attributes';
	question: string;
}

/** Fields that must be stated by the user. Omitted cloud stays AWS and is shown in the design. */
export function missingRequirements(workflow: Pick<LcaWorkflow, 'targetType' | 'hook' | 'attributesSpecified'>): RequirementGap[] {
	const gaps: RequirementGap[] = [];
	if (!workflow.targetType) {
		gaps.push({
			field: 'targetType',
			question: 'Which entity, relation, or change-request type should this LCA run on? Use the exact name from the connected tenant L3.',
		});
	}
	if (!workflow.hook) {
		gaps.push({
			field: 'hook',
			question: 'Which LCA hook should this use? Name one hook. I will not choose one for you.',
		});
	}
	if (!workflow.attributesSpecified) {
		gaps.push({
			field: 'attributes',
			question: 'Which attributes will the LCA read, and which will it add or update? Use the exact L3 names, or none.',
		});
	}
	return gaps;
}

const SECRET_VALUE = /AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:aws_secret_access_key|api[_-]?secret|client_secret|access_token|password)\s*[:=]\s*\S+/i;

export function containsSecretValue(text: string): boolean {
	return SECRET_VALUE.test(text);
}

export function redactSecrets(text: string): string {
	return text.replace(new RegExp(SECRET_VALUE.source, 'gi'), '[redacted]');
}

/** Prompts that ask the user to paste a secret. Naming an environment variable is allowed. */
export function isDisallowedCredentialPrompt(prompt: string): boolean {
	if (/\benvironment variable\b|\bcredential reference\b|\bproperty name\b/i.test(prompt) && !/\b(paste|provide|enter|send|share)\b/i.test(prompt)) {
		return false;
	}
	return /\b(secret key|password|access token|api secret|private key|client secret|credential value)\b/i.test(prompt);
}

export function credentialPrompt(): string {
	return 'What environment variable name holds the credential reference? Do not paste the secret value.';
}

const DEPLOY_CAVEAT = /\b(but|however|instead|production|first|wait|explain|don't|do not|not yet|hold on)\b/i;

/** Yes to the deploy question that is already waiting. A change of target is not approval. */
export function affirmsPendingDeploy(text: string): boolean {
	const value = text.trim();
	if (!value || /[?]/.test(value) || DEPLOY_CAVEAT.test(value)) return false;
	if (isExplicitApproval(value)) return true;
	return /^(yes|yep|yeah|ok|okay|go ahead|proceed)\b.*\b(deploy|publish)\b/i.test(value);
}

/**
 * Deploy tool failures. The returned text is safe to show: secret values are removed.
 * `nextAction` is the single follow-up. Do not update L3 after a failed deploy.
 */
export function deployFailureGuidance(errorText: string): { error: string; nextAction: string } {
	const error = redactSecrets(errorText).slice(0, 2000);
	const lower = error.toLowerCase();
	let nextAction: string;
	if (/expiredtoken|token has expired|requestexpired|security token.*expired|credentials?.*expired/.test(lower)) {
		nextAction = 'The cloud credentials in .env are expired. Refresh them in .env, then deploy again. Do not paste the secret values here.';
	} else if (/invalidclienttokenid|unrecognizedclient|signaturedoesnotmatch|authfailure|invalid access key|security token included in the request is invalid/.test(lower)) {
		nextAction = 'The cloud credentials in .env were rejected. Replace the access key, profile, or session token in .env, then deploy again. Do not paste the secret values here.';
	} else if (/accessdenied|not authorized|unauthorizedoperation|status(?:\s+code)?:\s*403|\b403\b/.test(lower)) {
		nextAction = 'The identity in .env does not have permission for this deploy. Grant the permission named in the error, then deploy again.';
	} else if (/resourcenotfound|function not found|resource not found|does not exist/.test(lower)) {
		nextAction = 'The cloud function was not found. Create it in the target account and region, then deploy again.';
	} else {
		nextAction = 'Fix the error above, then deploy again. Do not update tenant L3 until the deploy succeeds.';
	}
	return { error, nextAction };
}

export function actionSucceeded(toolResult?: { ok?: boolean; exitCode?: number; error?: string } | null): boolean {
	if (!toolResult || toolResult.error) return false;
	if (toolResult.ok === true) return true;
	return toolResult.exitCode === 0;
}

function mentioned(text: string, value: string): boolean {
	const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function hookMentioned(text: string, hook: string): boolean {
	if (mentioned(text, hook)) return true;
	const spaced = hook.replace(/([A-Z])/g, ' $1').toLowerCase();
	return text.toLowerCase().includes(spaced.trim());
}

export interface ExtractedFacts {
	workflow: LcaWorkflow;
	ambiguousHooks: string[];
}

/**
 * Accept a fact only when the user said it in this message, or it was already stored.
 * Claimed approvals, phases, and unmentioned names are ignored.
 */
export function extractFacts(text: string, stored: LcaWorkflow, claimed?: Partial<LcaWorkflow>): ExtractedFacts {
	const next: LcaWorkflow = { ...stored };
	const hooks = ALL_LCA_HOOKS.filter(hook => hookMentioned(text, hook));
	if (hooks.length === 1) {
		next.hook = hooks[0];
	} else if (hooks.length > 1) {
		next.hook = undefined;
	} else if (!stored.hook && claimed?.hook && hookMentioned(text, claimed.hook)) {
		next.hook = claimed.hook;
	}

	const typeMatch = text.match(/\b(?:entity|relation|change-request|change request|object)\s+type\s+[`'"]?([A-Za-z][A-Za-z0-9_]*)/i);
	if (typeMatch) {
		next.targetType = typeMatch[1];
	} else if (claimed?.targetType && mentioned(text, claimed.targetType)) {
		next.targetType = claimed.targetType;
	}

	const claimedRead = (claimed?.attributesRead ?? []).filter(name => mentioned(text, name));
	const claimedAdded = (claimed?.attributesAdded ?? []).filter(name => mentioned(text, name));
	const claimedUpdated = (claimed?.attributesUpdated ?? []).filter(name => mentioned(text, name));
	if (claimedRead.length || claimedAdded.length || claimedUpdated.length) {
		next.attributesSpecified = true;
		next.attributesRead = claimedRead;
		next.attributesAdded = claimedAdded;
		next.attributesUpdated = claimedUpdated;
	} else if (
		!stored.attributesSpecified
		&& (/^(none|no attributes|read-only|readonly)\b[.!\s]*$/i.test(text.trim()) || /\battributes?\b[\s\S]{0,40}\bnone\b/i.test(text))
	) {
		next.attributesSpecified = true;
		next.attributesRead = [];
		next.attributesAdded = [];
		next.attributesUpdated = [];
	}

	if (/\baws lambda\b|\baws\b/i.test(text)) next.cloudProvider = 'aws';
	if (/\bgcp\b|\bgoogle cloud\b/i.test(text)) next.cloudProvider = 'gcp';
	if (/\bazure\b/i.test(text)) next.cloudProvider = 'azure';
	if (/\bnative lca\b/i.test(text)) next.cloudProvider = 'native';

	return { workflow: next, ambiguousHooks: hooks.length > 1 ? [...hooks] : [] };
}

export interface StepResult {
	phase: LcaPhase;
	persistedPhase: LcaPhase;
	workflow: LcaWorkflow;
	allowedActions: AllowedAction[];
	/** True only when this turn may create or edit LCA source. */
	writeFiles: boolean;
	message: string;
	questions?: string[];
	redacted?: boolean;
	/** Cloud access details missing from tenant physical configuration. Omitted when they are present. */
	consoleUpdate?: string;
	/** .env key names that are missing. Values are never included. */
	missingCredentials?: string[];
}

export interface StepOptions {
	/** `caller` drops approval flags so a single request cannot approve itself. */
	trust?: 'persisted' | 'caller';
	ambiguousHooks?: string[];
	/** Facts the caller believes the user stated. Names absent from the user text are ignored. */
	claimed?: Partial<LcaWorkflow>;
	/** Connected tenant L3. When set, named types and attributes must exact-match before confirmation. */
	l3Model?: Record<string, unknown>;
	/** `false` stops tenant-object work until a tenant L3 is connected. Omit to skip the check. */
	tenantConnected?: boolean;
	/** Raw `.env` text. Values are checked locally and never copied into the result. */
	envText?: string;
	/** `undefined` means the tenant physical configuration file was not found. */
	physicalConfigText?: string;
}

function finish(workflow: LcaWorkflow, phase: LcaPhase, persistedPhase: LcaPhase, allowedActions: AllowedAction[], message: string, questions?: string[]): StepResult {
	return {
		phase,
		persistedPhase,
		workflow: { ...workflow, phase: persistedPhase },
		allowedActions,
		writeFiles: allowedActions.includes('generate'),
		message,
		questions,
	};
}

const POST_DESIGN_STATES: ReadonlySet<WorkflowState> = new Set([
	'DESIGN_APPROVED',
	'IMPLEMENTATION_GENERATED',
	'DEPLOYMENT_PENDING',
	'DEPLOYED',
	'CONNECTIVITY_PENDING',
	'CONNECTIVITY_CONFIRMED',
	'TENANT_CONFIG_PENDING',
	'TENANT_CONFIG_APPLIED',
	'VERIFICATION',
	'COMPLETED',
]);

function inPostDesign(workflow: LcaWorkflow): boolean {
	return workflow.designApproved || POST_DESIGN_STATES.has(workflow.state);
}

/** A new build request repeats object and design confirmation. Stored facts stay until the user replaces them. */
function restartConfirmation(workflow: LcaWorkflow): LcaWorkflow {
	return {
		...workflow,
		state: 'COLLECT_REQUIREMENTS',
		phase: 'REQUIREMENT_GATHERING',
		objectAttributesConfirmed: false,
		designApproved: false,
		deploymentApproved: false,
		l3UpdateApproved: false,
		pendingConfigurationPatch: undefined,
	};
}

function connectivityReady(workflow: LcaWorkflow): boolean {
	if (workflow.cloudProvider === 'native') return true;
	return workflow.connectivityStatus === 'confirmed' || workflow.connectivityStatus === 'not-required';
}

function cloudOf(workflow: LcaWorkflow): CloudProvider {
	return workflow.cloudProvider ?? 'aws';
}

function gapQuestions(gaps: RequirementGap[], model?: Record<string, unknown>): string[] {
	const types = model ? listObjectTypes(model) : [];
	const names = types.slice(0, 25).map(t => t.label || t.name);
	const extra = types.length > 25 ? ` …and ${types.length - 25} more` : '';
	return gaps.map(gap => {
		if (gap.field !== 'targetType' || names.length === 0) return gap.question;
		return `${gap.question} Available types: ${names.join(', ')}${extra}.`;
	});
}

/** Exact-match the stated type and attributes. A miss stops the turn before any confirmation or code. */
function alignToL3(workflow: LcaWorkflow, model?: Record<string, unknown>): { workflow: LcaWorkflow; blocked?: StepResult } {
	if (!model || !workflow.targetType) return { workflow };
	const found = resolveObjectType(model, workflow.targetType, workflow.targetKind);
	if (!found.ok) {
		return {
			workflow,
			blocked: gathering(
				{ ...workflow, targetType: undefined, targetTypeUri: undefined },
				[`${found.message} Which actual name should I use?`, ...found.suggestions.slice(0, 25)],
				'The named type is not an exact match in this tenant L3. Stop. Ask which actual name to use. Do not write code or pick a similar type.',
			),
		};
	}
	const next: LcaWorkflow = {
		...workflow,
		targetType: found.object.name,
		targetTypeUri: found.object.uri,
		targetKind: found.object.kind,
	};
	const names = [
		...(next.attributesRead ?? []),
		...(next.attributesAdded ?? []),
		...(next.attributesUpdated ?? []),
	];
	if (next.attributesSpecified && names.length > 0) {
		const attrs = resolveAttributes(found.object, names);
		if (!attrs.ok) {
			return {
				workflow: next,
				blocked: gathering(
					next,
					[`${attrs.message} Which attributes should I use?`, ...attrs.suggestions.slice(0, 25)],
					'An attribute is not on this type. Ask for the correct attribute. Do not write code.',
				),
			};
		}
	}
	return { workflow: next };
}

function gathering(workflow: LcaWorkflow, questions: string[], message: string): StepResult {
	const next: LcaWorkflow = {
		...workflow,
		intent: workflow.intent === 'update' ? 'update' : 'generate',
		state: 'COLLECT_REQUIREMENTS',
		phase: 'REQUIREMENT_GATHERING',
		objectAttributesConfirmed: false,
		designApproved: false,
		deploymentApproved: false,
		l3UpdateApproved: false,
	};
	return finish(next, 'REQUIREMENT_GATHERING', 'REQUIREMENT_GATHERING', ['ask'], message, questions);
}

const GENERATE_MESSAGE = 'The object type, hook, and attributes are already known. Generate Java now. After the files are written, ask whether to deploy this version. Do not deploy or edit L3 in this turn.';

/** Facts are present. Write code in this turn, then the only question is deploy. */
function readyToGenerate(workflow: LcaWorkflow): StepResult {
	const approved = markDesignApproved(markObjectAttributesConfirmed({
		...workflow,
		cloudProvider: workflow.cloudProvider ?? 'aws',
		objectAttributesConfirmed: true,
		designApproved: true,
	}));
	const pending = markDeploymentPending(approved, false);
	return finish(pending, 'GENERATE', 'DEPLOY_PENDING_APPROVAL', ['generate'], GENERATE_MESSAGE);
}

function authorizeDeploy(workflow: LcaWorkflow, options: StepOptions): StepResult {
	const provider = cloudOf(workflow);
	const next: LcaWorkflow = { ...workflow, cloudProvider: provider };
	if (provider !== 'native') {
		const missing = missingEnvKeys(options.envText ?? '', provider);
		if (options.envText === undefined || missing.length > 0) {
			const keys = missing.length > 0 ? missing : missingEnvKeys('', provider);
			const why = options.envText === undefined
				? 'No .env file was found.'
				: 'The .env file does not have the cloud access details for this deploy.';
			const result = finish(
				markDeploymentPending(next, false),
				'DEPLOY_PENDING_APPROVAL',
				'DEPLOY_PENDING_APPROVAL',
				['ask'],
				`${why} Add the missing keys, then say deploy again. Do not paste secret values. Missing: ${keys.join('; ')}.`,
				keys,
			);
			result.missingCredentials = keys;
			return result;
		}
	}
	const physical = assessPhysicalAccess(options.physicalConfigText, provider);
	const approved = markDeploymentPending(
		{
			...next,
			connectivityStatus: physical.present ? 'confirmed' : 'missing',
			l3UpdateApproved: true,
		},
		true,
	);
	const result = finish(
		approved,
		'DEPLOY',
		'DEPLOY',
		['deploy', 'updateL3'],
		physical.present
			? 'Deployment is approved. Use the credentials in .env. If the deploy tool fails, report the error and the next action, and do not update L3. If it succeeds, apply lifecycleActions immediately without asking, then summarize what was registered. Do not mention cloud connectivity.'
			: 'Deployment is approved. Use the credentials in .env. If the deploy tool fails, report the error and the next action, and do not update L3. If it succeeds, apply lifecycleActions immediately without asking, then summarize what was registered. Also include the console steps for the missing physical-configuration details. Do not ask the user to confirm them.',
	);
	if (!physical.present) result.consoleUpdate = physical.consoleUpdate;
	return result;
}

/** Apply lifecycleActions when physical access details exist. Otherwise show the console steps and do not ask. */
function authorizeL3(workflow: LcaWorkflow, options: StepOptions): StepResult {
	const provider = cloudOf(workflow);
	const physical = assessPhysicalAccess(options.physicalConfigText, provider);
	if (!physical.present) {
		const result = finish(
			{
				...workflow,
				cloudProvider: provider,
				state: 'CONNECTIVITY_PENDING',
				connectivityStatus: 'missing',
				l3UpdateApproved: false,
			},
			'TEST',
			'TEST',
			['ask'],
			`${physical.consoleUpdate}\nDo not ask whether this is already configured. Do not edit L3 until these details exist.`,
		);
		result.consoleUpdate = physical.consoleUpdate;
		return result;
	}
	const next: LcaWorkflow = {
		...workflow,
		cloudProvider: provider,
		state: 'TENANT_CONFIG_PENDING',
		phase: 'L3_UPDATE',
		connectivityStatus: 'confirmed',
		l3UpdateApproved: true,
	};
	return finish(
		next,
		'L3_UPDATE',
		'L3_UPDATE',
		['updateL3'],
		'Cloud access details are already in the tenant physical configuration. Apply lifecycleActions now without asking. Then tell the user what was registered. Do not mention the connectivity check.',
	);
}

/**
 * One user turn. The returned `allowedActions` are the only tools that may run.
 * Deploy and L3 apply stay off the turn that only asks to generate code.
 * After an explicit deploy yes, L3 apply is allowed only once the deploy tool succeeds.
 */
export function step(workflow: LcaWorkflow, userText: string, options: StepOptions = {}): StepResult {
	if (containsSecretValue(userText)) {
		return {
			phase: workflow.phase,
			persistedPhase: workflow.phase,
			workflow,
			allowedActions: ['ask'],
			writeFiles: false,
			message: 'A secret value was provided and has been discarded. Ask only for the environment variable or credential reference name.',
			redacted: true,
		};
	}

	let current = workflow;
	const prior = workflow;
	if (options.trust === 'caller') {
		current = {
			...workflow,
			objectAttributesConfirmed: false,
			designApproved: false,
			deploymentApproved: false,
			l3UpdateApproved: false,
			state: 'COLLECT_REQUIREMENTS',
			phase: 'REQUIREMENT_GATHERING',
			targetType: undefined,
			targetTypeUri: undefined,
			targetKind: undefined,
			hook: undefined,
			additionalHooks: undefined,
			attributesRead: undefined,
			attributesAdded: undefined,
			attributesUpdated: undefined,
			attributesSpecified: false,
		};
	}

	const extracted = extractFacts(userText, current, options.claimed);
	current = extracted.workflow;
	const act = classifyTurn(userText);
	const pendingDeploy = current.phase === 'DEPLOY_PENDING_APPROVAL';
	const pendingL3 = current.phase === 'L3_PENDING_APPROVAL';
	const approving = isExplicitApproval(userText);
	const ambiguousHooks = options.ambiguousHooks ?? extracted.ambiguousHooks;

	if (options.tenantConnected === false) {
		return finish(
			{ ...current, deploymentApproved: false, l3UpdateApproved: false },
			'ASK',
			'ASK',
			['ask'],
			TENANT_CONNECTION_MESSAGE,
		);
	}

	if (act === 'ask' || act === 'inspect' || act === 'validation-only') {
		const pendingDesign = prior.state === 'DESIGN_PENDING_APPROVAL' || prior.state === 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION';
		const leaveExternalGate = prior.phase === 'DEPLOY_PENDING_APPROVAL'
			|| prior.phase === 'L3_PENDING_APPROVAL'
			|| prior.state === 'DEPLOYMENT_PENDING'
			|| prior.state === 'TENANT_CONFIG_PENDING';
		const next: LcaWorkflow = {
			...current,
			intent: act === 'validation-only' ? 'validation-only' : act === 'inspect' ? 'inspect' : 'advise',
			phase: 'ASK',
			deploymentApproved: false,
			l3UpdateApproved: false,
			hook: prior.hook,
			additionalHooks: prior.additionalHooks,
			targetType: prior.targetType,
			targetTypeUri: prior.targetTypeUri,
			targetKind: prior.targetKind,
			attributesRead: prior.attributesRead,
			attributesAdded: prior.attributesAdded,
			attributesUpdated: prior.attributesUpdated,
			attributesSpecified: prior.attributesSpecified,
			cloudProvider: prior.cloudProvider,
			objectAttributesConfirmed: prior.objectAttributesConfirmed,
			designApproved: prior.designApproved,
			state: pendingDesign ? prior.state : current.state,
		};
		const message = act === 'validation-only'
			? 'Validation-only requirements use DVF. Answer the question. Do not generate, deploy, or edit L3.'
			: 'Answer from the LCA knowledge base. Do not generate code, deploy, or edit L3.';
		if (pendingDesign && !leaveExternalGate) {
			return finish(next, 'ASK', 'REQUIREMENT_GATHERING', ['answer'], message);
		}
		return finish(next, 'ASK', 'ASK', ['answer'], message);
	}

	if (act === 'test') {
		const next: LcaWorkflow = { ...current, phase: 'TEST', state: current.state === 'COMPLETED' ? 'VERIFICATION' : (current.state || 'VERIFICATION'), deploymentApproved: false, l3UpdateApproved: false };
		if (next.state === 'DESIGN_APPROVED' || next.state === 'IMPLEMENTATION_GENERATED' || next.state === 'DEPLOYMENT_PENDING') {
			next.state = 'VERIFICATION';
		}
		return finish(next, 'TEST', 'TEST', ['test'], 'Guide invocation and testing. Provide a sample request and the expected result. Do not claim the test passed unless a tool result says so. Do not deploy or edit L3.');
	}

	if (pendingDeploy && affirmsPendingDeploy(userText)) {
		return authorizeDeploy(current, options);
	}

	if ((act === 'approve' || approving) && pendingL3) {
		return authorizeL3(current, options);
	}

	if (current.phase === 'REQUIREMENT_GATHERING' && (act === 'approve' || approving) && act !== 'deploy' && act !== 'update-l3' && (current.state === 'DESIGN_PENDING_APPROVAL' || current.state === 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION')) {
		const aligned = alignToL3(current, options.l3Model);
		if (aligned.blocked) return aligned.blocked;
		return readyToGenerate(aligned.workflow);
	}

	if ((act === 'approve' || approving) && current.designApproved && current.phase === 'GENERATE' && act !== 'deploy' && act !== 'update-l3') {
		return finish(current, 'GENERATE', 'GENERATE', ['generate'], 'Design is already approved. Generate Java only. Do not deploy or edit L3.');
	}

	if (act === 'deploy' || (approving && /\b(deploy|publish)\b/i.test(userText) && !pendingDeploy)) {
		const next = markDeploymentPending({ ...current, deploymentApproved: false }, false);
		return finish(
			next,
			'DEPLOY_PENDING_APPROVAL',
			'DEPLOY_PENDING_APPROVAL',
			['previewDeploy'],
			'Ask whether to deploy this version. Do not deploy in this turn.',
		);
	}

	if (act === 'update-l3' || act === 'register') {
		return authorizeL3(
			{
				...current,
				intent: act === 'register' ? 'register' : current.intent,
				deploymentApproved: false,
			},
			options,
		);
	}

	if (act === 'generate' || act === 'update') {
		const intent: LcaIntent = act === 'update' ? 'update' : 'generate';
		let withIntent: LcaWorkflow = { ...current, intent };
		if (inPostDesign(current)) {
			withIntent = restartConfirmation(withIntent);
		}
		if (ambiguousHooks.length > 1) {
			return gathering(
				{ ...withIntent, hook: undefined },
				[`Which hook should I use? You mentioned ${ambiguousHooks.join(', ')}. I will not pick one.`],
				'The hook is ambiguous. Ask which one to use. Do not write code.',
			);
		}
		const aligned = alignToL3(withIntent, options.l3Model);
		if (aligned.blocked) return aligned.blocked;
		withIntent = aligned.workflow;
		const gaps = missingRequirements(withIntent);
		if (gaps.length > 0) {
			return gathering(withIntent, gapQuestions(gaps, options.l3Model), 'Requirements are incomplete. Ask only for the missing facts. Do not guess tenant, hook, attribute, API, or cloud details, and do not write code.');
		}
		return readyToGenerate(withIntent);
	}

	if (approving) {
		return gathering(current, missingRequirements(current).map(gap => gap.question), 'Nothing is waiting for approval. Say what you want to do next.');
	}

	return finish(current, current.phase, current.phase, ['answer'], 'Answer from the LCA knowledge base. Do not generate code, deploy, or edit L3.');
}

function splitStoredAttributes(context: ProjectContext): { added?: string[]; updated?: string[] } {
	if (context.attributesAdded !== undefined || context.attributesUpdated !== undefined) {
		return {
			added: context.attributesAdded ?? [],
			updated: context.attributesUpdated ?? [],
		};
	}
	return { updated: context.attributesAddedOrUpdated };
}

export function workflowFromContext(context: ProjectContext, intent?: LcaIntent): LcaWorkflow {
	const hooks = context.hooks ?? [];
	const storedPhase = context.phase as LcaPhase | undefined;
	const resolvedIntent = intent ?? (storedPhase && storedPhase !== 'ASK' ? 'generate' : 'advise');
	return createWorkflow({
		intent: resolvedIntent,
		state: (context.workflowState as WorkflowState | undefined) ?? (resolvedIntent === 'advise' ? 'TENANT_CONNECTED' : 'COLLECT_REQUIREMENTS'),
		phase: context.phase as LcaPhase | undefined,
		workingDirectory: context.workingDirectory,
		tenantId: context.tenantId,
		customerName: context.customerName,
		targetKind: context.targetKind,
		targetType: context.targetType,
		targetTypeUri: context.targetTypeUri,
		hook: hooks[0],
		additionalHooks: hooks.slice(1),
		attributesRead: context.attributesSpecified ? context.attributesRead : undefined,
		attributesAdded: context.attributesSpecified ? splitStoredAttributes(context).added : undefined,
		attributesUpdated: context.attributesSpecified ? splitStoredAttributes(context).updated : undefined,
		attributesSpecified: context.attributesSpecified,
		cloudProvider: context.cloudProvider,
		javaPackage: context.javaPackage,
		implementationModule: context.implementationModule,
		cloudFunctionIdentifier: context.cloudFunctionIdentifier,
		connectivityStatus: context.connectivityStatus,
		pendingConfigurationPatch: context.pendingConfigurationPatch,
		objectAttributesConfirmed: context.objectAttributesConfirmed,
		designApproved: context.designApproved,
		deploymentApproved: context.deploymentApproved,
		l3UpdateApproved: context.l3UpdateApproved,
	});
}

export function contextPatchFromWorkflow(workflow: LcaWorkflow): Partial<ProjectContext> {
	const hooks = [workflow.hook, ...(workflow.additionalHooks ?? [])].filter((hook): hook is string => !!hook);
	return {
		phase: workflow.phase,
		workflowState: workflow.state,
		customerName: workflow.customerName,
		targetKind: workflow.targetKind,
		targetType: workflow.targetType,
		targetTypeUri: workflow.targetTypeUri,
		hooks: hooks.length ? hooks : undefined,
		attributesRead: workflow.attributesSpecified ? workflow.attributesRead : undefined,
		attributesAdded: workflow.attributesSpecified ? workflow.attributesAdded : undefined,
		attributesUpdated: workflow.attributesSpecified ? workflow.attributesUpdated : undefined,
		attributesAddedOrUpdated: workflow.attributesSpecified
			? [...(workflow.attributesAdded ?? []), ...(workflow.attributesUpdated ?? [])]
			: undefined,
		attributesSpecified: workflow.attributesSpecified,
		cloudProvider: workflow.cloudProvider,
		javaPackage: workflow.javaPackage,
		implementationModule: workflow.implementationModule,
		cloudFunctionIdentifier: workflow.cloudFunctionIdentifier,
		connectivityStatus: workflow.connectivityStatus ?? 'unknown',
		pendingConfigurationPatch: workflow.pendingConfigurationPatch,
		objectAttributesConfirmed: workflow.objectAttributesConfirmed,
		designApproved: workflow.designApproved,
		deploymentApproved: workflow.deploymentApproved,
		l3UpdateApproved: workflow.l3UpdateApproved,
		implementationLanguage: 'Java',
	};
}
