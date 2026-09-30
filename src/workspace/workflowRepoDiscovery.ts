/**
 * Content-driven BPMN discovery inside a connected Custom Workflow Repository (D4),
 * and recovering deploy context from one of its files (D6).
 *
 * Unlike Drafts (`workflowDrafts.ts`), where this extension is the sole writer and can
 * guarantee `{processId}.bpmn20.xml`, a customer's repository is written by their own
 * tooling under their own convention. Filename is never trusted as identity here — the
 * one thing that is actually authoritative is the same thing the Workflow Adapter itself
 * keys on: the `<process id>` inside the file, read via the same `extractProcessModel()`
 * every other BPMN-reading code path in this extension already uses. No XML parser is
 * added — see the note in `workflowAdapterClient.ts`.
 */
import * as vscode from 'vscode';
import { extractProcessModel } from '../workflow/bpmnModel';
import type { EnvironmentManager } from './environmentManager';

/** Mirrors `l3Discovery.ts`'s constant — reused, not reinvented. */
const MAX_DEPTH = 10;

export interface DiscoveredBpmnFile {
	readonly fileUri: vscode.Uri;
	readonly processId: string;
}

function hasBpmnLikeExtension(fileName: string): boolean {
	const lower = fileName.toLowerCase();
	return lower.endsWith('.bpmn20.xml') || lower.endsWith('.xml');
}

/**
 * Depth-limited walk of a connected repository, collecting every file whose
 * extension is `.xml`/`.bpmn20.xml` **and** which parses to a non-empty
 * `<process id>` (D4). A file that merely has the right extension but no
 * process id — a schema, a README with an `.xml` typo — is silently excluded
 * rather than surfaced as a broken row.
 */
export async function discoverBpmnFiles(root: vscode.Uri): Promise<DiscoveredBpmnFile[]> {
	const found: DiscoveredBpmnFile[] = [];
	await walk(root, 0, found);
	found.sort((a, b) => a.processId.localeCompare(b.processId));
	return found;
}

async function walk(dir: vscode.Uri, depth: number, found: DiscoveredBpmnFile[]): Promise<void> {
	if (depth > MAX_DEPTH) return;
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return;
	}
	for (const [name, type] of entries) {
		if (name.startsWith('.')) continue;
		const child = vscode.Uri.joinPath(dir, name);
		if (type === vscode.FileType.Directory) {
			await walk(child, depth + 1, found);
			continue;
		}
		if (type !== vscode.FileType.File || !hasBpmnLikeExtension(name)) continue;

		let text: string;
		try {
			text = new TextDecoder().decode(await vscode.workspace.fs.readFile(child));
		} catch {
			continue;
		}
		const processId = extractProcessModel(text).processId;
		if (processId) found.push({ fileUri: child, processId });
	}
}

/** The two path segments naming D1's clone folder, in order. Not just the immediate parent — a customer's own subfolder structure lives inside it. */
const REPO_DIR_SEGMENTS = ['Workflows', 'Custom Workflows'];

/** Index of `parts[i] === 'Workflows' && parts[i+1] === 'Custom Workflows'`, searched from the tenant end, or -1. */
function repoDirSegmentIndex(parts: readonly string[]): number {
	for (let i = parts.length - 2; i >= 0; i--) {
		if (parts[i] === REPO_DIR_SEGMENTS[0] && parts[i + 1] === REPO_DIR_SEGMENTS[1]) return i;
	}
	return -1;
}

export interface RepoBpmnContext {
	readonly environmentName: string;
	readonly tenantId: string;
	readonly processId: string;
}

/**
 * Recovers environment/tenant/process-id from a file inside a connected repository (D6),
 * for `reltio.deployWorkflow`'s fallback when `resolveDraftContext()` doesn't match.
 *
 * Async and content-reading, unlike `resolveDraftContext()`'s synchronous filename parse —
 * D4 forbids trusting the filename here, so the process id can only come from reading the
 * file itself, the same way `discoverBpmnFiles()` establishes it in the first place.
 *
 * Two independent questions, resolved independently:
 *   - *Which tenant?* — the same authority as `resolveDraftContext()`:
 *     `EnvironmentManager.locFromPath()`'s scan-built index first, a suffix-based fallback
 *     for a pre-rename workspace second. Prefix matching on the full path means the file
 *     can sit at any depth inside `Workflows/Custom Workflows/` and still resolve.
 *   - *Which process?* — never the filename (D4): read from the file's own content.
 *
 * The `Workflows/Custom Workflows` segment pair has to appear in the path at all, or this
 * returns `undefined` — a file elsewhere in the tenant folder that happens to parse with a
 * process id (a downloaded deployment in `Workflows/BPMN/`, say) is not this repository's
 * concern to resolve.
 */
export async function resolveRepoBpmnContext(
	fsPath: string,
	environmentManager?: Pick<EnvironmentManager, 'locFromPath'> | null,
): Promise<RepoBpmnContext | undefined> {
	const parts = fsPath.split(/[/\\]/).filter(Boolean);
	const repoIdx = repoDirSegmentIndex(parts);
	if (repoIdx < 0) return undefined;

	const loc = environmentManager?.locFromPath(fsPath) ?? legacySuffixedRepoLoc(parts, repoIdx);
	if (!loc) return undefined;

	let text: string;
	try {
		text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)));
	} catch {
		return undefined;
	}
	const processId = extractProcessModel(text).processId;
	if (!processId) return undefined;

	return { environmentName: loc.environmentName, tenantId: loc.tenantId, processId };
}

/**
 * Suffix-based fallback for a pre-rename workspace, mirroring `resolveDraftContext()`'s
 * own `legacySuffixedDraftLoc()`. The tenant folder's suffix and the repository's location
 * inside it are independent renames, exactly as for Drafts.
 */
function legacySuffixedRepoLoc(
	parts: readonly string[],
	repoIdx: number,
): { environmentName: string; tenantId: string } | undefined {
	const tenantSeg = parts[repoIdx - 1];
	const envSeg = parts[repoIdx - 2];
	if (!tenantSeg?.endsWith('.reltio.tenant') || !envSeg?.endsWith('.reltio.environment')) {
		return undefined;
	}
	return {
		environmentName: envSeg.slice(0, -'.reltio.environment'.length),
		tenantId: tenantSeg.slice(0, -'.reltio.tenant'.length),
	};
}
