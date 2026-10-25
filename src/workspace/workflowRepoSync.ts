/**
 * D5 — the sync badge's comparison, kept deliberately isolated in its own function.
 *
 * RESOLVED (2026-09-27), empirically, against a real tenant (`tst-01`/`SunilTst` — see
 * `design.md`): a BPMN deployed through the Workflow Adapter and then refetched came
 * back byte-identical (2284/2284 bytes, matching SHA-256). So content is compared as it
 * is, not normalized the way `normalizeBpmn()` in `workflowBpmnFiles.ts` does (that one
 * answers a different question: does a *downloaded* copy have local edits, where
 * re-serialization noise must be ignored).
 *
 * The one deliberate exception is the line ending. A Windows checkout with
 * `core.autocrlf` turns every LF in the repository into CRLF on disk, so a byte-exact
 * comparison reported every file as `changed` although nothing differs but the checkout
 * setting. A leading byte-order mark is dropped for the same reason. Nothing else is
 * normalized: a real whitespace or attribute change must still show as `changed`.
 */

export type RepoSyncState = 'clean' | 'changed';

function withoutCheckoutNoise(text: string): string {
	return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

/** `repoXml` is the connected repository's file content; `deployedXml` is the tenant's own copy. */
export function compareBpmnContent(repoXml: string, deployedXml: string): RepoSyncState {
	return withoutCheckoutNoise(repoXml) === withoutCheckoutNoise(deployedXml) ? 'clean' : 'changed';
}
