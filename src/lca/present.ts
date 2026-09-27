import type { CloudProvider } from './cloud';

const CLOUD_LABEL: Record<CloudProvider, string> = {
	aws: 'AWS Lambda',
	gcp: 'GCP',
	azure: 'Azure',
	native: 'Native',
};

const KIND_LABEL = {
	entity: 'Entity',
	relation: 'Relation',
	changeRequest: 'Change Request',
} as const;

export const OBJECT_ATTRIBUTE_CONFIRM_PROMPT = [
	'Please confirm that the object type and attributes above are correct.',
	'',
	'Should I use these values for the LCA implementation?',
].join('\n');

export const DESIGN_CONFIRM_PROMPT = [
	'Please review the design above.',
	'',
	'Should I proceed with Java LCA code generation?',
].join('\n');

export const L3_CONFIRM_PROMPT = [
	'Would you like me to apply this lifecycleActions change',
	'to the currently connected tenant?',
].join('\n');

export function deploymentPrompt(provider: CloudProvider): string {
	return `Would you like me to deploy this version to ${CLOUD_LABEL[provider]}?`;
}

/** Shown before any deploy tool runs. Approval is a later turn. */
export function formatDeploymentPreview(input: {
	provider: CloudProvider;
	target: string;
	configuration: string[];
	changes: string[];
}): string {
	return [
		'Deployment preview',
		'',
		'Target environment',
		'------------------',
		`${CLOUD_LABEL[input.provider]}: ${input.target}`,
		'',
		'Configuration',
		'-------------',
		bulletList(input.configuration),
		'',
		'What will change',
		'----------------',
		bulletList(input.changes),
		'',
		'This does not deploy anything.',
		deploymentPrompt(input.provider),
		'Reply yes only if I should deploy.',
	].join('\n');
}

function bulletList(names: string[] | undefined): string {
	if (!names?.length) return 'None';
	return names.map(name => `- ${name}`).join('\n');
}

export function formatObjectAttributeConfirmation(input: {
	kind: keyof typeof KIND_LABEL;
	objectType: string;
	uri: string;
	attributesRead?: string[];
	attributesAddedOrUpdated?: string[];
}): string {
	return [
		'LCA Code Inputs',
		'',
		'Target',
		'------',
		`Category: ${KIND_LABEL[input.kind]}`,
		`Object Type: ${input.objectType}`,
		`URI: ${input.uri}`,
		'',
		'Attributes Read',
		'---------------',
		bulletList(input.attributesRead),
		'',
		'Attributes Added/Updated',
		'------------------------',
		bulletList(input.attributesAddedOrUpdated),
		'',
		OBJECT_ATTRIBUTE_CONFIRM_PROMPT,
	].join('\n');
}

export function formatImplementationDesign(input: {
	workingDirectory: string;
	tenantLabel: string;
	kind: keyof typeof KIND_LABEL;
	objectType: string;
	hooks: string[];
	cloud: CloudProvider;
	attributesRead?: string[];
	attributesAddedOrUpdated?: string[];
	behavior: string;
	javaPackage: string;
	cloudFunction: string;
	registration: string;
}): string {
	return [
		'LCA Implementation Design',
		'',
		'Project',
		'-------',
		`Working Directory: ${input.workingDirectory}`,
		`Tenant: ${input.tenantLabel}`,
		'',
		'Target',
		'------',
		`Category: ${KIND_LABEL[input.kind]}`,
		`Object: ${input.objectType}`,
		'',
		'Hook',
		'----',
		input.hooks.join(', '),
		'',
		'Language',
		'--------',
		'Java',
		'',
		'Cloud',
		'-----',
		CLOUD_LABEL[input.cloud],
		'',
		'Attributes Read',
		'---------------',
		bulletList(input.attributesRead),
		'',
		'Attributes Added/Updated',
		'------------------------',
		bulletList(input.attributesAddedOrUpdated),
		'',
		'Behavior',
		'--------',
		input.behavior,
		'',
		'Java Package',
		'------------',
		input.javaPackage,
		'',
		'Cloud Function',
		'--------------',
		input.cloudFunction,
		'',
		'Expected Registration',
		'---------------------',
		input.registration,
		'',
		DESIGN_CONFIRM_PROMPT,
	].join('\n');
}

export function formatLifecycleDiff(input: {
	hook: string;
	current: string[];
	proposed: string[];
}): string {
	const currentLines = input.current.length ? input.current.map(name => `- ${name}`).join('\n') : '- (none)';
	const proposedLines = input.proposed.map(name => `- ${name}`).join('\n');
	return [
		'Current',
		'',
		`${input.hook}:`,
		currentLines,
		'',
		'Proposed',
		'',
		`${input.hook}:`,
		proposedLines,
		'',
		L3_CONFIRM_PROMPT,
	].join('\n');
}
