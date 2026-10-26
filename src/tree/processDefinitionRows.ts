/**
 * The single list under "Process Definitions".
 *
 * A workflow can exist in up to three places: deployed on the tenant, as a local file in
 * `Workflows/bpmn/`, and as a file in the connected Custom Workflow Repository. Showing each place
 * as its own folder made one workflow look like two or three. This merges them into one row per
 * process id, and decides which of the six states each row is in.
 *
 * Pure and generic over the file-location type so it is testable without `vscode`; the tree
 * provider supplies `vscode.Uri`.
 *
 * Row states (precedence for a deployed custom row: local edits, then differs, then untracked):
 *   1. OOTB                      — deployed, `generic`
 *   2. Custom, clean             — deployed, nothing differs
 *   3. Custom, local edits       — a downloaded copy was edited and not yet deployed
 *   4. Custom, differs from repo — the repository's file for this id is not what is deployed
 *   5. Custom, not in repository — a repository is connected and has no file for this id
 *   6. Not deployed              — a local draft or a repository file with no deployed counterpart
 */
import type { ProcessDefinition } from '../api/workflowAdapterClient';
import type { RepoSyncState } from '../workspace/workflowRepoSync';

export interface LocalBpmnSummary<U> {
	readonly processId: string;
	readonly fileUri: U;
	/** Stable identity of the file (its URI as a string), to recognise one file seen by both scans. */
	readonly fileKey: string;
	readonly processName: string | undefined;
	/** True when the file was downloaded from the tenant, so it belongs to a deployed definition. */
	readonly hasBaseline: boolean;
	readonly hasLocalChanges: boolean;
}

export interface RepoFileSummary<U> {
	readonly processId: string;
	readonly fileUri: U;
	readonly fileKey: string;
	readonly processName: string | undefined;
}

export interface DeployedRow<U> {
	readonly kind: 'deployed';
	readonly definition: ProcessDefinition;
	readonly localState: 'none' | 'clean' | 'changed';
	/** `changed`: the repository file differs. `untracked`: a repository is connected and has no file for this id. */
	readonly repoState: 'changed' | 'untracked' | undefined;
	/** The repository's file for this id, when there is one. */
	readonly repoFileUri: U | undefined;
}

export interface DraftRow<U> {
	readonly kind: 'draft';
	readonly processId: string;
	readonly processName: string | undefined;
	readonly fileUri: U;
	/** `local`: a file in `Workflows/bpmn/` named for its id. `repo`: a repository file with a free-form name. */
	readonly source: 'local' | 'repo';
}

export type ProcessRow<U> = DeployedRow<U> | DraftRow<U>;

export interface ProcessRowInputs<U> {
	/** `undefined` until the tenant's definitions have been fetched this session. */
	readonly definitions: readonly ProcessDefinition[] | undefined;
	readonly local: readonly LocalBpmnSummary<U>[];
	/** `undefined` when no repository is connected, or it has not been scanned yet: nothing is judged "untracked". */
	readonly repoFiles: readonly RepoFileSummary<U>[] | undefined;
	readonly repoSync: ReadonlyMap<string, RepoSyncState>;
}

export function mergeProcessDefinitionRows<U>(inputs: ProcessRowInputs<U>): ProcessRow<U>[] {
	const { definitions, repoFiles, repoSync } = inputs;
	// The repository's scan reads the process id from the file's content; the local scan trusts the
	// file name. The same file can sit in both (the repository's own `bpmn/` is the drafts folder),
	// and when they disagree the content is the authority, so the name-derived entry is dropped.
	const repoByFile = new Map((repoFiles ?? []).map(file => [file.fileKey, file]));
	const local = inputs.local.filter(file => {
		const seenByRepo = repoByFile.get(file.fileKey);
		return seenByRepo === undefined || seenByRepo.processId === file.processId;
	});
	const localById = new Map(local.map(file => [file.processId, file]));
	const repoById = new Map((repoFiles ?? []).map(file => [file.processId, file]));
	const deployedIds = new Set((definitions ?? []).map(d => d.type));

	const rows: ProcessRow<U>[] = (definitions ?? []).map(definition => {
		const localFile = localById.get(definition.type);
		const repoFile = repoById.get(definition.type);
		const localState: DeployedRow<U>['localState'] =
			localFile?.hasBaseline ? (localFile.hasLocalChanges ? 'changed' : 'clean') : 'none';
		let repoState: DeployedRow<U>['repoState'];
		if (repoSync.get(definition.type) === 'changed') repoState = 'changed';
		// OOTB processes are Reltio's, so being absent from the customer's repository says nothing.
		else if (repoFiles !== undefined && !repoFile && !definition.generic) repoState = 'untracked';
		return { kind: 'deployed', definition, localState, repoState, repoFileUri: repoFile?.fileUri };
	});

	// Anything with a baseline came from the tenant, so it is not a draft even before definitions load.
	const downloadedIds = new Set(local.filter(file => file.hasBaseline).map(file => file.processId));
	const drafts = new Map<string, DraftRow<U>>();
	for (const file of local) {
		if (file.hasBaseline) continue;
		if (deployedIds.has(file.processId)) continue;
		drafts.set(file.processId, {
			kind: 'draft',
			processId: file.processId,
			processName: file.processName,
			fileUri: file.fileUri,
			source: 'local',
		});
	}
	for (const file of repoFiles ?? []) {
		if (deployedIds.has(file.processId) || downloadedIds.has(file.processId) || drafts.has(file.processId)) continue;
		drafts.set(file.processId, {
			kind: 'draft',
			processId: file.processId,
			processName: file.processName,
			fileUri: file.fileUri,
			source: 'repo',
		});
	}

	return [...rows, ...[...drafts.values()].sort((a, b) => a.processId.localeCompare(b.processId))];
}
