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
 * Clones `url` directly into `destRoot` (must already be empty — caller's responsibility to check).
 * Auth is entirely delegated to the system git installation and its credential helper
 * (e.g. Git Credential Manager), which opens a browser login when credentials aren't cached.
 */
export async function cloneRepository(url: string, destRoot: vscode.Uri): Promise<void> {
	try {
		await execFileAsync(getGitExecutable(), ['clone', url, '.'], {
			cwd: destRoot.fsPath,
			timeout: CLONE_TIMEOUT_MS,
			killSignal: 'SIGTERM',
		});
	} catch (e) {
		const err = e as NodeJS.ErrnoException & { killed?: boolean };
		if (err.code === 'ENOENT') {
			throw new GitNotFoundError(
				'Git executable not found. Install Git (https://git-scm.com/downloads) and ensure it is on your PATH, then try again.',
			);
		}
		if (err.killed) {
			throw new Error(
				`Clone timed out after ${CLONE_TIMEOUT_MS / 60000} minutes. Check your network connection and git credentials, then try again.`,
			);
		}
		throw e;
	}
}
