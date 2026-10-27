/**
 * The single list under "Process Definitions".
 *
 * A workflow can come from three places: the tenant (deployed, optionally downloaded to
 * `Workflows/bpmn/`), a local draft in `Workflows/bpmn/` that was never deployed, and the connected
 * Custom Workflow Repository. Tenant and draft rows are merged by process id. A repository file is
 * never merged into either: it keeps its own row even when its process id is already deployed, so
 * what came from the repository stays visibly the repository's, and disconnecting it removes
 * exactly those rows.
 *
 * Pure and generic over the file-location type so it is testable without `vscode`; the tree
 * provider supplies `vscode.Uri`.
 *
 * Row kinds:
 *   deployed — on the tenant. OOTB (`generic`) or custom, with the state of its downloaded copy
 *              (none / clean / local changes).
 *   draft    — a local file in `Workflows/bpmn/` that was never deployed and is not in the repository.
 *   repo     — a file that came from the repository, with how it compares to the tenant.
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
	/**
	 * True when the file came from the repository (tracked by it, or outside the drafts folder).
	 * False for a file in `Workflows/bpmn/` the repository does not track: that is the user's own
	 * draft, which the repository scan also sees because it walks the whole folder.
	 */
	readonly fromRepo: boolean;
}

export interface DeployedRow {
	readonly kind: 'deployed';
	readonly definition: ProcessDefinition;
	readonly localState: 'none' | 'clean' | 'changed';
}

export interface DraftRow<U> {
	readonly kind: 'draft';
	readonly processId: string;
	readonly processName: string | undefined;
	readonly fileUri: U;
}

/**
 * How a repository file compares to the tenant:
 *   `notDeployed` — the tenant has no workflow with this id
 *   `differs`     — deployed, and the deployed XML is not this file
 *   `same`        — deployed, and identical
 *   `unknown`     — not compared (definitions not fetched, or no token to fetch the deployed XML)
 */
export type RepoRowState = 'notDeployed' | 'differs' | 'same' | 'unknown';

export interface RepoRow<U> {
	readonly kind: 'repo';
	readonly processId: string;
	readonly processName: string | undefined;
	readonly fileUri: U;
	readonly state: RepoRowState;
}

export type ProcessRow<U> = DeployedRow | DraftRow<U> | RepoRow<U>;

export interface ProcessRowInputs<U> {
	/** `undefined` until the tenant's definitions have been fetched this session. */
	readonly definitions: readonly ProcessDefinition[] | undefined;
	readonly local: readonly LocalBpmnSummary<U>[];
	/** `undefined` when no repository is connected, or it has not been scanned yet. */
	readonly repoFiles: readonly RepoFileSummary<U>[] | undefined;
	readonly repoSync: ReadonlyMap<string, RepoSyncState>;
}

export function mergeProcessDefinitionRows<U>(inputs: ProcessRowInputs<U>): ProcessRow<U>[] {
	const { definitions, repoSync } = inputs;
	const repoFiles = inputs.repoFiles ?? [];
	const deployedIds = new Set((definitions ?? []).map(d => d.type));

	// The repository's scan reads the process id from the file's content; the local scan trusts the
	// file name. The same file can be seen by both, and when they disagree the content is the
	// authority, so the name-derived local entry is dropped.
	const repoByFile = new Map(repoFiles.map(file => [file.fileKey, file]));
	const local = inputs.local.filter(file => {
		const seenByRepo = repoByFile.get(file.fileKey);
		return seenByRepo === undefined || seenByRepo.processId === file.processId;
	});

	// A downloaded copy (baseline) belongs to the tenant row, even if the repository tracks the same
	// path: the file on disk is the user's downloaded copy, not the repository's version.
	const downloaded = new Map(local.filter(file => file.hasBaseline).map(file => [file.processId, file]));
	const downloadedKeys = new Set([...downloaded.values()].map(file => file.fileKey));

	const rows: ProcessRow<U>[] = (definitions ?? []).map(definition => {
		const file = downloaded.get(definition.type);
		const localState: DeployedRow['localState'] =
			file ? (file.hasLocalChanges ? 'changed' : 'clean') : 'none';
		return { kind: 'deployed', definition, localState };
	});

	// A local file without a baseline, that the repository does not claim, was never deployed.
	const repoKeys = new Set(repoFiles.filter(file => file.fromRepo).map(file => file.fileKey));
	const drafts = new Map<string, DraftRow<U>>();
	for (const file of local) {
		if (file.hasBaseline || repoKeys.has(file.fileKey) || deployedIds.has(file.processId)) continue;
		if (downloaded.has(file.processId)) continue;
		drafts.set(file.processId, {
			kind: 'draft',
			processId: file.processId,
			processName: file.processName,
			fileUri: file.fileUri,
		});
	}
	// A repository scan also sees untracked files in `bpmn/`; those are drafts the local scan has.
	for (const file of repoFiles) {
		if (file.fromRepo || downloadedKeys.has(file.fileKey)) continue;
		if (deployedIds.has(file.processId) || drafts.has(file.processId)) continue;
		drafts.set(file.processId, {
			kind: 'draft',
			processId: file.processId,
			processName: file.processName,
			fileUri: file.fileUri,
		});
	}

	const repoRows: RepoRow<U>[] = repoFiles
		.filter(file => file.fromRepo && !downloadedKeys.has(file.fileKey))
		.map(file => {
			let state: RepoRowState = 'unknown';
			if (definitions !== undefined) {
				if (!deployedIds.has(file.processId)) state = 'notDeployed';
				else {
					const sync = repoSync.get(file.processId);
					state = sync === 'changed' ? 'differs' : sync === 'clean' ? 'same' : 'unknown';
				}
			}
			return {
				kind: 'repo' as const,
				processId: file.processId,
				processName: file.processName,
				fileUri: file.fileUri,
				state,
			};
		})
		.sort((a, b) => a.processId.localeCompare(b.processId));

	return [
		...rows,
		...[...drafts.values()].sort((a, b) => a.processId.localeCompare(b.processId)),
		...repoRows,
	];
}
