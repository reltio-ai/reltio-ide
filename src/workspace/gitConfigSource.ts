import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Upper bound on a `git clone` run — protects against a stalled network transfer or a credential
 *  prompt the user will never see (no browser focus, headless remote session, etc.) hanging forever. */
const CLONE_TIMEOUT_MS = 5 * 60 * 1000;

export class GitNotFoundError extends Error {}

function getGitExecutable(): string {
	const cfg = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
	if (Array.isArray(cfg) && cfg.length > 0 && cfg[0].trim()) return cfg[0];
	if (typeof cfg === 'string' && cfg.trim()) return cfg;
	return 'git';
}

/** The `.reltio/` folder is created automatically on activation (synced agent skills/Velocity Packs), and these
 *  are OS-generated artifacts that can appear just from viewing a brand-new folder in a file browser — none of
 *  them are user content, so a folder containing only these is still treated as "empty" for cloning purposes. */
const IGNORED_FOR_EMPTINESS = new Set(['.reltio', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

/**
 * A folder that doesn't exist yet is empty (git will create it). Any other read failure (permissions, I/O)
 * is propagated rather than swallowed — the caller must not treat "we couldn't tell" as "safe to clone into".
 */
export async function isFolderEmpty(root: vscode.Uri): Promise<boolean> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(root);
	} catch (e) {
		const err = e as vscode.FileSystemError & NodeJS.ErrnoException;
		if (err.code === 'FileNotFound' || err.code === 'ENOENT') {
			return true;
		}
		throw e;
	}
	return entries.every(([name]) => IGNORED_FOR_EMPTINESS.has(name));
}

/** True when `candidate` is `root` itself or a descendant of it — guards against a path escaping the workspace. */
export function isPathContainedIn(root: vscode.Uri, candidate: vscode.Uri): boolean {
	const rootPath = root.path.replace(/\/+$/, '');
	const candidatePath = candidate.path;
	// Case-insensitive comparison on Windows (drive letters may differ in casing)
	if (process.platform === 'win32') {
		const rootLower = rootPath.toLowerCase();
		const candidateLower = candidatePath.toLowerCase();
		return candidateLower === rootLower || candidateLower.startsWith(`${rootLower}/`);
	}
	return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

export async function isGitRepo(root: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.git'));
		return true;
	} catch {
		return false;
	}
}

export async function getRemoteUrl(root: vscode.Uri): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			getGitExecutable(),
			['remote', 'get-url', 'origin'],
			{ cwd: root.fsPath },
		);
		const url = stdout.trim();
		return url.length > 0 ? url : undefined;
	} catch {
		return undefined;
	}
}

/** True when the folder is already a git repo with an `origin` remote configured — no clone needed. */
export async function isGitRepoWithRemote(root: vscode.Uri): Promise<boolean> {
	if (!(await isGitRepo(root))) return false;
	return (await getRemoteUrl(root)) !== undefined;
}

/**
 * The nearest repository at or above `start`, or undefined when there is none.
 *
 * Each tenant folder is meant to be its own repository, so a repository sitting above one is a
 * problem worth reporting: it either pulls the environment and tenant names back into every
 * tracked path, or swallows the tenant as a gitlink whose contents it does not actually store.
 *
 * Walks up to the filesystem root, because the enclosing repository is often a level or two above
 * the workspace (a `Projects` folder someone once ran `git init` in).
 */
export async function findEnclosingGitRepository(
	start: vscode.Uri,
): Promise<vscode.Uri | undefined> {
	let current = start;
	// Bounded rather than while(true): a malformed URI must not spin forever.
	for (let depth = 0; depth < 64; depth++) {
		if (await isGitRepo(current)) return current;
		const parentPath = current.path.slice(0, current.path.lastIndexOf('/'));
		// A drive root ("/c:") or the filesystem root has no further parent to examine.
		if (!parentPath || parentPath === current.path || !parentPath.includes('/')) return undefined;
		current = current.with({ path: parentPath });
	}
	return undefined;
}

/** Raised when `git clone --branch <b>` fails specifically because the branch is not on the remote. */
export class BranchNotFoundError extends Error {
	constructor(readonly branch: string, readonly url: string) {
		super(`Branch '${branch}' does not exist on ${url}.`);
	}
}

/**
 * git's wording for a missing ref, across the versions we support.
 *
 * The branch name is compared as plain text. Git allows characters such as `(`, `+`, `.` and `{` in
 * branch names, so compiling it into a regular expression either throws (`feature/(x`) or matches the
 * wrong thing (`a+b` matching `aab`).
 */
export function isMissingBranchFailure(stderr: string, branch: string): boolean {
	const text = stderr.toLowerCase();
	return (
		/Remote branch .* not found in upstream/i.test(stderr) ||
		/warning: Could not find remote branch/i.test(stderr) ||
		text.includes(`pathspec '${branch.toLowerCase()}' did not match`)
	);
}

/**
 * Clones `url` directly into `destRoot` (must already be empty — caller's responsibility to check).
 * Auth is entirely delegated to the system git installation and its credential helper
 * (e.g. Git Credential Manager), which opens a browser login when credentials aren't cached.
 *
 * When `branch` is given, only that branch is checked out; a branch absent from the remote raises
 * `BranchNotFoundError` so the caller can offer to create it rather than reporting a generic failure.
 */
export async function cloneRepository(
	url: string,
	destRoot: vscode.Uri,
	branch?: string,
): Promise<void> {
	const args = branch ? ['clone', '--branch', branch, url, '.'] : ['clone', url, '.'];
	try {
		await execFileAsync(getGitExecutable(), args, {
			cwd: destRoot.fsPath,
			timeout: CLONE_TIMEOUT_MS,
			killSignal: 'SIGTERM',
		});
	} catch (e) {
		if (branch) {
			const stderr = String((e as { stderr?: string }).stderr ?? '');
			if (isMissingBranchFailure(stderr, branch)) {
				throw new BranchNotFoundError(branch, url);
			}
		}
		throw describeGitFailure(e);
	}
}

/**
 * Translates a raw `execFile` rejection into the user-facing error for a git shell-out.
 *
 * Kept separate so every git-invoking code path (clone, branch creation, branch read) reports a
 * missing git executable and a timeout the same way.
 */
export function describeGitFailure(e: unknown): Error {
	const err = e as NodeJS.ErrnoException & { killed?: boolean };
	if (err.code === 'ENOENT') {
		return new GitNotFoundError(
			'Git executable not found. Install Git (https://git-scm.com/downloads) and ensure it is on your PATH, then try again.',
		);
	}
	if (err.killed) {
		return new Error(
			`Git operation timed out after ${CLONE_TIMEOUT_MS / 60000} minutes. Check your network connection and git credentials, then try again.`,
		);
	}
	return e instanceof Error ? e : new Error(String(e));
}
