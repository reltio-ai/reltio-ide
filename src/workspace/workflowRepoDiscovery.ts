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
import { isValidProcessId } from './workflowBpmnFiles';
import type { EnvironmentManager } from './environmentManager';
import { nearestModuleFor } from './workflowRepoModule';

/** Mirrors `l3Discovery.ts`'s constant — reused, not reinvented. */
const MAX_DEPTH = 10;

export interface DiscoveredBpmnFile {
	readonly fileUri: vscode.Uri;
	readonly processId: string;
	/**
	 * Owning Maven module: the nearest ancestor directory holding a `pom.xml`, via the
	 * same walk `workflowRepoJavaDiscovery.ts` uses (`nearestModuleFor()`). `undefined`
	 * means no such ancestor exists within the repository root — expected and common,
	 * since BPMN is never provisioned by Reltio and a customer may place it anywhere,
	 * including entirely outside every Maven module (e.g. a flat `bpmn/` folder at the
	 * repository root). Unlike Java's `moduleName`, this is never defaulted to the
	 * repository folder's own name — see `nearestModuleFor()`'s doc comment.
	 */
	readonly moduleName: string | undefined;
}

/**
 * Directories that hold build output or vendored copies, never authored BPMN. A Maven build
 * copies `src/main/resources` into `target/classes`, so without this every BPMN appeared
 * twice, the two rows collided on one process id, and a deploy could pick the stale copy.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set(['target', 'node_modules']);

/** A BPMN is a few kilobytes; anything near this size is not one, and every candidate is read whole. */
const MAX_BPMN_BYTES = 1024 * 1024;

/** Upper bound on .xml files read per sync, so a repository full of generated XML cannot stall the tree. */
const MAX_XML_CANDIDATES = 2000;

export interface BpmnDiscovery {
	readonly files: DiscoveredBpmnFile[];
	/** True when the candidate limit stopped the walk early; callers say so instead of listing a silently partial result. */
	readonly truncated: boolean;
}

/**
 * Depth-limited walk of a connected repository, collecting every file whose
 * extension is `.xml` (which includes `.bpmn20.xml`) **and** which parses to a non-empty
 * `<process id>` (D4). A file that merely has the right extension but no
 * process id — a schema, a README with an `.xml` typo — is silently excluded
 * rather than surfaced as a broken row.
 */
export async function discoverBpmnFilesDetailed(root: vscode.Uri): Promise<BpmnDiscovery> {
	const found: DiscoveredBpmnFile[] = [];
	const budget = { candidates: 0, truncated: false };
	await walk(root, 0, [], undefined, found, budget);
	found.sort((a, b) => a.processId.localeCompare(b.processId));
	return { files: found, truncated: budget.truncated };
}

export async function discoverBpmnFiles(root: vscode.Uri): Promise<DiscoveredBpmnFile[]> {
	return (await discoverBpmnFilesDetailed(root)).files;
}

/**
 * `relParts`/`moduleName` mirror `workflowRepoJavaDiscovery.ts`'s own `walk()`: the path
 * from the repository root to `dir`, and the nearest enclosing `pom.xml` directory found so
 * far on this path. Unlike Java's walk, `moduleName` starts `undefined` rather than seeded
 * with the repository folder's name — see `DiscoveredBpmnFile.moduleName`'s doc comment.
 */
async function walk(
	dir: vscode.Uri,
	depth: number,
	relParts: readonly string[],
	moduleName: string | undefined,
	found: DiscoveredBpmnFile[],
	budget: { candidates: number; truncated: boolean },
): Promise<void> {
	if (depth > MAX_DEPTH || budget.truncated) return;
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return;
	}
	const module = nearestModuleFor(entries, relParts, moduleName);
	for (const [name, type] of entries) {
		if (name.startsWith('.')) continue;
		const child = vscode.Uri.joinPath(dir, name);
		if (type === vscode.FileType.Directory) {
			if (SKIP_DIRS.has(name)) continue;
			await walk(child, depth + 1, [...relParts, name], module, found, budget);
			continue;
		}
		if (type !== vscode.FileType.File || !name.toLowerCase().endsWith('.xml')) continue;

		if (budget.candidates >= MAX_XML_CANDIDATES) {
			budget.truncated = true;
			return;
		}
		budget.candidates++;
		try {
			const { size } = await vscode.workspace.fs.stat(child);
			if (size > MAX_BPMN_BYTES) continue;
		} catch {
			continue;
		}
		let text: string;
		try {
			text = new TextDecoder().decode(await vscode.workspace.fs.readFile(child));
		} catch {
			continue;
		}
		const processId = extractProcessModel(text).processId;
		if (processId) found.push({ fileUri: child, processId, moduleName: module });
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
	// A customer's own repository is untrusted content, same as an adapter response — this
	// id goes on to build a local baseline path (`getWorkflowBpmnBaselineUri`) in the deploy
	// flow that calls this function, so it must pass the same filesystem-path-safety check
	// `isProcessDefinition()` applies to a server-returned `type`, not just "non-empty".
	if (!processId || !isValidProcessId(processId)) return undefined;

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
