/**
 * D5 — the sync badge's comparison, kept deliberately isolated in its own function.
 *
 * RESOLVED (2026-09-27), empirically, against a real tenant (`tst-01`/`SunilTst` — see
 * `design.md`): a BPMN deployed through the Workflow Adapter and then refetched came
 * back byte-identical (2284/2284 bytes, matching SHA-256). Byte-exact comparison is the
 * decision, not a normalized one — deliberately not reusing `normalizeBpmn()` from
 * `workflowBpmnFiles.ts`, which exists for a different question (does a *downloaded*
 * copy have local edits, where re-serialization noise must be ignored). Kept behind this
 * one function so a dialect that does reformat on this path is a one-function change,
 * not a redesign.
 */

export type RepoSyncState = 'clean' | 'changed';

/** `repoXml` is the connected repository's file content; `deployedXml` is the tenant's own copy. */
export function compareBpmnContent(repoXml: string, deployedXml: string): RepoSyncState {
	return repoXml === deployedXml ? 'clean' : 'changed';
}
