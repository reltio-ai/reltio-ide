/**
 * Connect-time filesystem work for the Custom Workflow Repository.
 *
 * The repository's working tree lives directly in `{tenant}/Workflows/`, which already holds a
 * generated `README.md` and usually `bpmn/` drafts. `git clone` refuses a non-empty directory,
 * so the clone goes into a staging folder and `adoptStagedRepository()` moves it in. The
 * decisions (what clashes, what merges) are `planWorkflowRepoAdoption()`'s; this file only
 * performs them, and undoes them if a move fails part-way.
 */
import * as vscode from 'vscode';
import { IDE_STATE_DIR } from './tenantFolderStructure';
import {
	planWorkflowRepoAdoption,
	withBaselineExclude,
	type AdoptionEntry,
} from './workflowRepoAdoption';

/** Sentence every generated README carries — see `tenantFolderStructure.ts#renderReadme()`. */
const GENERATED_README_MARKER = 'not yet managed by Reltio IDE';

/** Gitignored scratch folder, relative to the tenant root, that the clone is made in. */
export const WORKFLOW_REPO_STAGING_DIR = `${IDE_STATE_DIR}/workflow-repo-staging`;

/** The adoption would have overwritten something, so nothing was changed. */
export class WorkflowRepoAdoptionConflictError extends Error {
	constructor(readonly collisions: readonly string[]) {
		super(
			`Workflows/ already has files that the repository also contains: ${collisions.join(', ')}. ` +
				'Nothing was changed. Move or rename them, then connect again.',
		);
	}
}

export interface AdoptionResult {
	/** Drafts that were already in `Workflows/bpmn/` and are now part of the repository's working tree. */
	readonly drafts: readonly string[];
	/** Repository `bpmn/` files not brought in because a local file of the same name was kept. */
	readonly keptLocal: readonly string[];
}

async function listDirectory(dir: vscode.Uri): Promise<AdoptionEntry[]> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(dir);
		return entries.map(([name, type]) => ({ name, isDirectory: (type & vscode.FileType.Directory) !== 0 }));
	} catch {
		return [];
	}
}

async function isGeneratedReadme(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
		return text.includes(GENERATED_README_MARKER) ? text : undefined;
	} catch {
		return undefined;
	}
}

/** Empties the staging folder (or creates it), so a crashed earlier attempt cannot leak into this one. */
export async function prepareStagingDir(staging: vscode.Uri): Promise<void> {
	await removeStagingDir(staging);
	await vscode.workspace.fs.createDirectory(staging);
}

export async function removeStagingDir(staging: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.delete(staging, { recursive: true, useTrash: false });
	} catch {
		/* nothing to remove */
	}
}

/**
 * Moves a freshly cloned repository from `staging` into `workflowsDir`, merging `bpmn/` and
 * replacing only this extension's own placeholder README. All-or-nothing: a clash is refused
 * before anything moves, and a failed move is rolled back.
 */
export async function adoptStagedRepository(
	workflowsDir: vscode.Uri,
	staging: vscode.Uri,
): Promise<AdoptionResult> {
	const existingBpmnUri = vscode.Uri.joinPath(workflowsDir, 'bpmn');
	const stagedBpmnUri = vscode.Uri.joinPath(staging, 'bpmn');
	const readmeUri = vscode.Uri.joinPath(workflowsDir, 'README.md');

	const [existing, staged, existingBpmn, stagedBpmn, readmeText] = await Promise.all([
		listDirectory(workflowsDir),
		listDirectory(staging),
		listDirectory(existingBpmnUri),
		listDirectory(stagedBpmnUri),
		isGeneratedReadme(readmeUri),
	]);

	const plan = planWorkflowRepoAdoption({
		existing,
		existingBpmn: existingBpmn.filter(e => !e.isDirectory).map(e => e.name),
		existingReadmeIsGenerated: readmeText !== undefined,
		staged,
		stagedBpmn: stagedBpmn.filter(e => !e.isDirectory).map(e => e.name),
	});
	if (!plan.ok) throw new WorkflowRepoAdoptionConflictError(plan.collisions);

	const moved: Array<{ from: vscode.Uri; to: vscode.Uri }> = [];
	const move = async (from: vscode.Uri, to: vscode.Uri): Promise<void> => {
		await vscode.workspace.fs.rename(from, to, { overwrite: false });
		moved.push({ from, to });
	};

	try {
		if (plan.discardExistingReadme) await vscode.workspace.fs.delete(readmeUri, { useTrash: false });
		for (const name of plan.moveTop) {
			await move(vscode.Uri.joinPath(staging, name), vscode.Uri.joinPath(workflowsDir, name));
		}
		for (const name of plan.mergeBpmn) {
			await move(vscode.Uri.joinPath(stagedBpmnUri, name), vscode.Uri.joinPath(existingBpmnUri, name));
		}
	} catch (e) {
		for (const { from, to } of moved.reverse()) {
			try {
				await vscode.workspace.fs.rename(to, from, { overwrite: false });
			} catch {
				/* best effort: the staging folder still holds whatever could not be put back */
			}
		}
		if (plan.discardExistingReadme && readmeText !== undefined) {
			try {
				await vscode.workspace.fs.writeFile(readmeUri, new TextEncoder().encode(readmeText));
			} catch {
				/* best effort */
			}
		}
		throw e;
	}

	await excludeBaselineSnapshots(workflowsDir);
	return { drafts: plan.drafts, keptLocal: plan.keptLocal };
}

/**
 * Adds the baseline-snapshot pattern to `Workflows/.git/info/exclude`: a per-clone, never-committed
 * ignore list, so a draft's last-fetch copy does not appear as a repository change and no
 * `.gitignore` is added to the customer's repository.
 */
async function excludeBaselineSnapshots(workflowsDir: vscode.Uri): Promise<void> {
	await writeBaselineExclude(workflowsDir);
}

/**
 * Makes sure an existing clone ignores baseline snapshots, for a clone connected before the
 * pattern was added or whose `info/exclude` was reset. Idempotent, best effort, and a no-op when
 * `Workflows/` is not a git repository: creating `.git/info` there would make a plain folder look
 * like a repository.
 */
export async function ensureBaselineExcluded(workflowsDir: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(workflowsDir, '.git'));
	} catch {
		return;
	}
	try {
		await writeBaselineExclude(workflowsDir);
	} catch {
		/* a missed ignore line is cosmetic; it must never fail a download */
	}
}

async function writeBaselineExclude(workflowsDir: vscode.Uri): Promise<void> {
	const infoDir = vscode.Uri.joinPath(workflowsDir, '.git', 'info');
	const excludeUri = vscode.Uri.joinPath(infoDir, 'exclude');
	let current = '';
	try {
		current = new TextDecoder().decode(await vscode.workspace.fs.readFile(excludeUri));
	} catch {
		/* a fresh clone may not have one */
	}
	const next = withBaselineExclude(current);
	if (next === current) return;
	await vscode.workspace.fs.createDirectory(infoDir);
	await vscode.workspace.fs.writeFile(excludeUri, new TextEncoder().encode(next));
}

