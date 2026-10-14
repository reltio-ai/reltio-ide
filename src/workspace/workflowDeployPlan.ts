/**
 * What a deploy will actually do, decided from the XML that is about to be uploaded.
 *
 * The Workflow Adapter keys a deployment on the `<process id>` inside the file, not on the
 * file's name. A draft's name is only this extension's own convention, so a user can edit the
 * id in the XML and the name no longer says what will be deployed. Confirmation, collision
 * checks and "this replaces a live workflow" therefore all read the id from the XML — that is
 * the one thing that tells the truth about the tenant-side effect.
 */
import { extractProcessModel } from '../workflow/bpmnModel';
import { isValidProcessId } from './workflowBpmnFiles';

/**
 * Process ids the platform itself starts on a user action. Replacing one changes behaviour for
 * every entity type on the tenant, whether or not the tenant's list flags it as `generic`.
 */
export const REPLACEABLE_BUILT_IN_IDS: readonly string[] = [
	'dataChangeRequestReview',
	'potentialMatchReview',
	'deleteReview',
	'recommendForDelete',
	'authoring',
];

export interface DeployedDefinition {
	readonly type: string;
	readonly generic?: boolean;
}

export type DeployPlan =
	| { readonly ok: false; readonly message: string }
	| {
		readonly ok: true;
		/** The id inside the XML — what the engine will deploy. */
		readonly processId: string;
		/** The id the file name or tree row suggested. */
		readonly fileProcessId: string;
		readonly idMismatch: boolean;
		readonly replacesLive: boolean;
		readonly replacesBuiltIn: boolean;
	};

/**
 * `deployed` is `undefined` when the tenant's list has never been fetched: a caller must fetch
 * it first rather than read "unknown" as "nothing is deployed", so this refuses to decide.
 */
export function planDeploy(
	xml: string,
	fileProcessId: string,
	deployed: readonly DeployedDefinition[] | undefined,
): DeployPlan {
	if (deployed === undefined) {
		return { ok: false, message: 'The tenant’s deployed workflows have not been loaded, so this cannot be checked yet.' };
	}
	const xmlId = extractProcessModel(xml).processId;
	if (!xmlId) {
		return { ok: false, message: 'This file has no <process id>, so there is nothing the tenant could deploy.' };
	}
	if (!isValidProcessId(xmlId)) {
		return { ok: false, message: `"${xmlId}" is not a valid process id (letters, digits, "_", "-", "." only, starting with a letter or "_").` };
	}
	const match = deployed.find(d => d.type === xmlId);
	return {
		ok: true,
		processId: xmlId,
		fileProcessId,
		idMismatch: xmlId !== fileProcessId,
		replacesLive: match !== undefined,
		replacesBuiltIn: match?.generic === true || REPLACEABLE_BUILT_IN_IDS.includes(xmlId),
	};
}

export interface DeployConfirmation {
	readonly message: string;
	readonly detail: string;
	readonly action: string;
}

/** The modal text for a plan. Kept here so the wording is testable and cannot drift per entry point. */
export function describeDeploy(
	plan: Extract<DeployPlan, { ok: true }>,
	tenantId: string,
): DeployConfirmation {
	const lines: string[] = [];
	if (plan.idMismatch) {
		lines.push(
			`The file is named "${plan.fileProcessId}", but the process id inside it is "${plan.processId}". The tenant will receive "${plan.processId}".`,
		);
	}
	if (plan.replacesBuiltIn && plan.replacesLive) {
		lines.push(
			`"${plan.processId}" is a Reltio built-in workflow that is already deployed on ${tenantId}. This uploads a new version of it, and every entity type that uses it will follow your version.`,
		);
	} else if (plan.replacesLive) {
		lines.push(
			`"${plan.processId}" is already deployed on ${tenantId}. This uploads a new version of it, which is the one new process instances will use.`,
		);
	} else {
		lines.push(`This uploads "${plan.processId}" to ${tenantId} as a new workflow.`);
	}
	return {
		message: `Deploy "${plan.processId}" to ${tenantId}?`,
		detail: lines.join('\n\n'),
		action: plan.replacesLive ? 'Deploy new version' : 'Deploy',
	};
}
