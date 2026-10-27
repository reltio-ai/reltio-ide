/**
 * The git and file-system half of connecting-state bookkeeping for a Custom Workflow Repository:
 * asking git which files are the repository's, and removing them on disconnect. The decisions are
 * in `workflowRepoOrigin.ts` and are unit-tested there.
 */
import * as vscode from 'vscode';
import { runGit } from './tenantGitBinding';
import { planRepoCleanup, type RepoCleanupPlan, type RepoFileSets } from './workflowRepoOrigin';

async function gitList(repoDir: vscode.Uri, args: string[]): Promise<string[]> {
	// `-z` so a path with spaces or non-ASCII characters arrives raw rather than quoted.
	const out = await runGit(repoDir, args);
	return out.split('\0').filter(path => path.length > 0);
}

/** Files the repository tracks, posix-relative to `repoDir`; `undefined` when git cannot be asked. */
export async function listTrackedFiles(repoDir: vscode.Uri): Promise<Set<string> | undefined> {
	try {
		return new Set(await gitList(repoDir, ['ls-files', '-z']));
	} catch {
		return undefined;
	}
}

export interface RepoInspection {
	readonly plan: RepoCleanupPlan;
	readonly unpushedCommits: number;
}

/** What disconnecting would remove and keep, or `undefined` when git cannot be asked. */
export async function inspectRepoForDisconnect(repoDir: vscode.Uri): Promise<RepoInspection | undefined> {
	let sets: RepoFileSets;
	try {
		const tracked = await gitList(repoDir, ['ls-files', '-z']);
		const ignored = await gitList(repoDir, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard']);
		// A repository with no commit has no HEAD to diff against; every tracked file is then new.
		let modified: string[] = [];
		try {
			modified = await gitList(repoDir, ['diff', '--name-only', '-z', 'HEAD']);
		} catch {
			modified = tracked;
		}
		sets = { tracked, modified, ignored };
	} catch {
		return undefined;
	}
	let unpushedCommits = 0;
	try {
		unpushedCommits = Number.parseInt(await runGit(repoDir, ['rev-list', '--count', '@{u}..HEAD']), 10) || 0;
	} catch {
		// No upstream configured: nothing to compare with.
	}
	return { plan: planRepoCleanup(sets), unpushedCommits };
}

/** Deletes the planned files, then every directory that is left empty, except `keep` and `repoDir`. */
export async function removeRepoFiles(repoDir: vscode.Uri, plan: RepoCleanupPlan, keep: string[] = ['bpmn']): Promise<void> {
	for (const relative of plan.remove) {
		try {
			await vscode.workspace.fs.delete(vscode.Uri.joinPath(repoDir, ...relative.split('/')), { useTrash: false });
		} catch {
			/* already gone */
		}
	}
	await pruneEmptyDirectories(repoDir, repoDir, new Set(keep.map(name => name.toLowerCase())));
}

async function pruneEmptyDirectories(root: vscode.Uri, dir: vscode.Uri, keep: Set<string>): Promise<boolean> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return false;
	}
	let empty = true;
	for (const [name, type] of entries) {
		const child = vscode.Uri.joinPath(dir, name);
		if (type === vscode.FileType.Directory) {
			if (await pruneEmptyDirectories(root, child, keep)) continue;
		}
		empty = false;
	}
	if (empty && dir.toString() !== root.toString()) {
		const name = dir.path.slice(dir.path.lastIndexOf('/') + 1).toLowerCase();
		const parentIsRoot = dir.path.slice(0, dir.path.lastIndexOf('/')) === root.path;
		if (!(parentIsRoot && keep.has(name))) {
			try {
				await vscode.workspace.fs.delete(dir, { recursive: false, useTrash: false });
				return true;
			} catch {
				return false;
			}
		}
	}
	return false;
}
