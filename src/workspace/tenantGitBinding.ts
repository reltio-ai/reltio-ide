import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
	BranchNotFoundError,
	cloneRepository,
	describeGitFailure,
	isGitRepo,
} from './gitConfigSource';
import { materializeTenantTree } from './tenantFolderStructure';
import { writeTenantIdentityMarker } from './gitSourceMarker';

const execFileAsync = promisify(execFile);

/** Bounded so a credential prompt the user will never see cannot hang the command forever. */
const GIT_TIMEOUT_MS = 5 * 60 * 1000;

function getGitExecutable(): string {
	const cfg = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
	if (Array.isArray(cfg) && cfg.length > 0 && cfg[0].trim()) return cfg[0];
	if (typeof cfg === 'string' && cfg.trim()) return cfg;
	return 'git';
}

async function git(cwd: vscode.Uri, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync(getGitExecutable(), args, {
			cwd: cwd.fsPath,
			timeout: GIT_TIMEOUT_MS,
			killSignal: 'SIGTERM',
		});
		return stdout.trim();
	} catch (e) {
		throw describeGitFailure(e);
	}
}

/** Raised when the remote has no commits, so there is no default branch to create a branch from. */
export class EmptyRemoteError extends Error {
	constructor(readonly url: string) {
		super(`${url} has no commits yet. Push an initial commit, then connect this tenant.`);
	}
}

/**
 * The tenant's current branch, or undefined when it is not a repository or is on a detached HEAD.
 *
 * Read from git rather than stored by the extension: a branch persisted in extension state goes
 * stale the moment the user checks out from a terminal, whereas HEAD cannot.
 */
export async function getCurrentBranch(tenantRoot: vscode.Uri): Promise<string | undefined> {
	if (!(await isGitRepo(tenantRoot))) return undefined;
	try {
		const branch = await git(tenantRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
		// Detached HEAD reports the literal "HEAD"; show nothing rather than a fake branch name.
		return branch && branch !== 'HEAD' ? branch : undefined;
	} catch {
		return undefined;
	}
}

/** True when the worktree has staged or unstaged changes. Used to refuse migration. */
export async function hasUncommittedChanges(root: vscode.Uri): Promise<boolean> {
	if (!(await isGitRepo(root))) return false;
	try {
		return (await git(root, ['status', '--porcelain'])).length > 0;
	} catch {
		// Cannot tell, so assume dirty: refusing to migrate is the safe direction.
		return true;
	}
}

/**
 * Names that do not count as user content when deciding whether a tenant folder is empty enough
 * to clone into. These are created by the extension or the OS, never by the user's own work.
 */
const IGNORED_FOR_EMPTINESS = new Set([
	'.reltio',
	'.reltio-ide',
	'.DS_Store',
	'Thumbs.db',
	'desktop.ini',
]);

/**
 * True when a tenant folder holds nothing the user would lose by cloning over it.
 *
 * Unlike the workspace-level check, this tolerates a freshly materialized component tree: the
 * folders and their generated `README.md` files are ours, so a tenant that was created but never
 * fetched is still "empty" for cloning purposes. A `BusinessConfig.json`, or any file the user
 * put in a component folder, makes it non-empty.
 */
export async function isTenantFolderCloneable(tenantRoot: vscode.Uri): Promise<boolean> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(tenantRoot);
	} catch (e) {
		const err = e as vscode.FileSystemError & NodeJS.ErrnoException;
		if (err.code === 'FileNotFound' || err.code === 'ENOENT') return true;
		throw e;
	}

	for (const [name, type] of entries) {
		if (IGNORED_FOR_EMPTINESS.has(name)) continue;
		if (type !== vscode.FileType.Directory) return false;
		if (!(await containsOnlyGeneratedReadmes(vscode.Uri.joinPath(tenantRoot, name)))) {
			return false;
		}
	}
	return true;
}

async function containsOnlyGeneratedReadmes(dir: vscode.Uri): Promise<boolean> {
	const entries = await vscode.workspace.fs.readDirectory(dir);
	for (const [name, type] of entries) {
		if (type === vscode.FileType.Directory) {
			if (!(await containsOnlyGeneratedReadmes(vscode.Uri.joinPath(dir, name)))) return false;
			continue;
		}
		if (name !== 'README.md') return false;
	}
	return true;
}

/** Everything the caller needs to move the tenant folder onto a remote branch. */
export interface BindOptions {
	tenantRoot: vscode.Uri;
	remoteUrl: string;
	branch: string;
	environmentName: string;
	tenantId: string;
	/**
	 * Asked only when the branch is absent on the remote. Returning false aborts and leaves the
	 * folder untouched, so a mistyped branch never silently creates one.
	 */
	confirmCreateBranch: (branch: string, remoteUrl: string) => Promise<boolean>;
}

export type BindOutcome =
	| { kind: 'cloned'; branch: string }
	| { kind: 'branch-created'; branch: string }
	| { kind: 'branch-created-not-pushed'; branch: string; reason: string }
	| { kind: 'declined'; branch: string };

/**
 * Makes the tenant folder its own git repository on `branch`.
 *
 * Runs before the first fetch, while the folder is still empty, so a plain `git clone` works and
 * no `init` + `remote add` + `fetch` dance is needed. Because the repository root is the tenant
 * folder, nothing git tracks contains the environment host or the tenant ID.
 */
export async function bindTenantToGit(options: BindOptions): Promise<BindOutcome> {
	const { tenantRoot, remoteUrl, branch } = options;

	await vscode.workspace.fs.createDirectory(tenantRoot);

	let outcome: BindOutcome;
	try {
		await cloneRepository(remoteUrl, tenantRoot, branch);
		outcome = { kind: 'cloned', branch };
	} catch (e) {
		if (!(e instanceof BranchNotFoundError)) throw e;
		if (!(await options.confirmCreateBranch(branch, remoteUrl))) {
			return { kind: 'declined', branch };
		}
		outcome = await createBranchFromDefault(tenantRoot, remoteUrl, branch);
	}

	// A branch may predate this layout, so fill in whatever the tree is missing. Never destructive.
	await materializeTenantTree(tenantRoot);
	await writeTenantIdentityMarker(tenantRoot, {
		kind: 'tenant',
		environmentName: options.environmentName,
		tenantId: options.tenantId,
	});

	return outcome;
}

/**
 * Clones the remote's default branch and forks `branch` from it.
 *
 * Deliberately not an orphan branch: promotion branches must share history, otherwise a pull
 * request from `dev` into `test` hits unrelated-history conflicts and the whole flow breaks.
 */
async function createBranchFromDefault(
	tenantRoot: vscode.Uri,
	remoteUrl: string,
	branch: string,
): Promise<BindOutcome> {
	try {
		await cloneRepository(remoteUrl, tenantRoot);
	} catch (e) {
		throw describeGitFailure(e);
	}

	// An empty remote clones successfully but has no commit, so there is nothing to branch from.
	try {
		await git(tenantRoot, ['rev-parse', '--verify', 'HEAD']);
	} catch {
		throw new EmptyRemoteError(remoteUrl);
	}

	await git(tenantRoot, ['checkout', '-b', branch]);

	try {
		await git(tenantRoot, ['push', '-u', 'origin', branch]);
	} catch (e) {
		// The branch exists locally and the user's work is safe; only publishing failed.
		return {
			kind: 'branch-created-not-pushed',
			branch,
			reason: e instanceof Error ? e.message : String(e),
		};
	}

	return { kind: 'branch-created', branch };
}
