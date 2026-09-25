import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
	BranchNotFoundError,
	cloneRepository,
	describeGitFailure,
	isGitRepo,
} from './gitConfigSource';
import { BUSINESS_CONFIG_FILE, materializeTenantTree } from './tenantFolderStructure';
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

/**
 * Branch names on a remote, without cloning it.
 *
 * `git ls-remote` needs no local repository, so the branch list can be offered as a picker before
 * anything is written to disk. Auth is the system credential helper's job, as everywhere else.
 *
 * Returns an empty list for a remote that has no branches yet (a freshly created repository), and
 * throws only when the remote could not be reached, so the caller can tell "nothing there" apart
 * from "could not ask".
 */
export async function listRemoteBranches(cwd: vscode.Uri, remoteUrl: string): Promise<string[]> {
	const stdout = await git(cwd, ['ls-remote', '--heads', remoteUrl]);
	return stdout
		.split(/\r?\n/)
		.map(line => line.split('refs/heads/')[1])
		.filter((name): name is string => !!name)
		.sort((a, b) => a.localeCompare(b));
}

/**
 * True when the repository has at least one commit.
 *
 * A freshly created remote has none, which makes its branch "unborn": it exists as a ref target
 * but cannot be pushed until something is committed. That is a normal starting state, not an error.
 */
async function hasAnyCommit(root: vscode.Uri): Promise<boolean> {
	try {
		await git(root, ['rev-parse', '--verify', 'HEAD']);
		return true;
	} catch {
		return false;
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

/**
 * Moves the tenant onto an existing remote branch.
 *
 * Unlike creating a branch, this replaces tracked files with that branch's content, so a dirty
 * worktree is refused rather than silently carried across. Git would refuse anyway; catching it
 * here means a readable message instead of raw git output.
 */
export async function switchToExistingBranch(
	tenantRoot: vscode.Uri,
	branch: string,
): Promise<void> {
	if (await hasUncommittedChanges(tenantRoot)) {
		throw new Error(
			`This tenant has uncommitted changes. Commit or stash them before switching to "${branch}".`,
		);
	}
	await git(tenantRoot, ['fetch', 'origin', branch]);
	const localExists = await branchExistsLocally(tenantRoot, branch);
	await git(
		tenantRoot,
		localExists ? ['checkout', branch] : ['checkout', '-b', branch, '--track', `origin/${branch}`],
	);
}

async function branchExistsLocally(tenantRoot: vscode.Uri, branch: string): Promise<boolean> {
	try {
		await git(tenantRoot, ['rev-parse', '--verify', `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Creates a branch from the current HEAD and publishes it.
 *
 * This is the feature-branch case: fork off whatever the tenant is on, keep working. `checkout -b`
 * leaves the working tree alone, so uncommitted edits come along rather than blocking, and the new
 * branch shares history with its parent so a pull request back into it merges normally.
 *
 * Publishing immediately means the branch exists on the remote from the outset, even with no new
 * commits, so a pull request can be opened as soon as there is something to review.
 */
export async function createAndPublishBranch(
	tenantRoot: vscode.Uri,
	branch: string,
): Promise<{ published: boolean; reason?: string }> {
	if (await branchExistsLocally(tenantRoot, branch)) {
		throw new Error(`Branch "${branch}" already exists in this tenant.`);
	}
	await git(tenantRoot, ['checkout', '-b', branch]);
	try {
		await git(tenantRoot, ['push', '-u', 'origin', branch]);
		return { published: true };
	} catch (e) {
		// The branch is valid locally and the user's work is safe; only publishing failed.
		return { published: false, reason: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Removes the repository from a tenant folder, keeping every file.
 *
 * Only `.git` goes. The configuration, the component tree and `.reltio-ide/` are untouched, so the
 * tenant carries on working exactly as an unbound one.
 */
export async function disconnectFromGit(tenantRoot: vscode.Uri): Promise<void> {
	await vscode.workspace.fs.delete(vscode.Uri.joinPath(tenantRoot, '.git'), {
		recursive: true,
		useTrash: false,
	});
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
	/** The folder already held a configuration, so the branch was adopted underneath it. */
	| { kind: 'adopted'; branch: string }
	| { kind: 'branch-created'; branch: string }
	/**
	 * The remote has no commits yet. The repository is initialized on the requested branch with
	 * `origin` set; the user's first commit starts the branch. Nothing failed.
	 */
	| { kind: 'initialized-empty-remote'; branch: string }
	| { kind: 'branch-created-not-pushed'; branch: string; reason: string }
	| { kind: 'declined'; branch: string };

/**
 * Makes the tenant folder its own git repository on `branch`.
 *
 * Works in either order. An empty tenant folder is cloned into directly. One that already holds a
 * fetched configuration is adopted in place, because `git clone` refuses a non-empty directory and
 * "connect, then fetch" is not the only way people work.
 *
 * Because the repository root is the tenant folder, nothing git tracks contains the environment
 * host or the tenant ID.
 */
export async function bindTenantToGit(options: BindOptions): Promise<BindOutcome> {
	const { tenantRoot, remoteUrl, branch } = options;

	await vscode.workspace.fs.createDirectory(tenantRoot);

	const outcome = (await isTenantFolderCloneable(tenantRoot))
		? await cloneIntoEmptyFolder(options)
		: await adoptExistingFolder(options);

	// Declining branch creation leaves the folder exactly as it was found, marker included.
	if (outcome.kind === 'declined') return outcome;

	// A branch may predate this layout, so fill in whatever the tree is missing. Never destructive.
	await materializeTenantTree(tenantRoot);
	// Also writes the `.gitignore`, so `.reltio-ide/` is excluded before the user reads git status.
	await writeTenantIdentityMarker(tenantRoot, {
		kind: 'tenant',
		environmentName: options.environmentName,
		tenantId: options.tenantId,
	});

	return outcome;
}

/** The simple path: an empty tenant folder, so the branch can be cloned straight in. */
async function cloneIntoEmptyFolder(options: BindOptions): Promise<BindOutcome> {
	const { tenantRoot, remoteUrl, branch } = options;
	try {
		await cloneRepository(remoteUrl, tenantRoot, branch);
		return { kind: 'cloned', branch };
	} catch (e) {
		if (!(e instanceof BranchNotFoundError)) throw e;
		if (!(await options.confirmCreateBranch(branch, remoteUrl))) {
			return { kind: 'declined', branch };
		}
		return createBranchFromDefault(tenantRoot, remoteUrl, branch);
	}
}

/**
 * Binds a tenant folder that already holds a fetched configuration.
 *
 * `git clone` refuses a non-empty directory, so instead the repository is created in place and the
 * remote branch's history is adopted underneath the files already on disk:
 *
 * ```
 * git init -b <branch>
 * git remote add origin <url>
 * git fetch origin <branch>
 * git reset origin/<branch>                       # HEAD + index, working tree untouched
 * git branch --set-upstream-to=origin/<branch>
 * ```
 *
 * The `reset` is deliberately mixed, never `--hard`: not one byte of the user's configuration is
 * overwritten. Afterwards their config shows as an uncommitted change against the remote branch,
 * which is exactly the diff they want to review and push.
 *
 * When the branch does not exist on the remote, the same thing happens against the default branch
 * and the new branch is published, so the promotion topology still starts from shared history.
 */
async function adoptExistingFolder(options: BindOptions): Promise<BindOutcome> {
	const { tenantRoot, remoteUrl, branch } = options;

	if (await isGitRepo(tenantRoot)) {
		throw new Error('This tenant folder is already a Git repository.');
	}

	await git(tenantRoot, ['init', '-b', branch]);
	await git(tenantRoot, ['remote', 'add', 'origin', remoteUrl]);

	let targetRef: string;
	let created = false;
	try {
		await git(tenantRoot, ['fetch', 'origin', branch]);
		targetRef = `origin/${branch}`;
	} catch {
		// Either the branch is absent or the remote is empty; both are recoverable.
		if (!(await options.confirmCreateBranch(branch, remoteUrl))) {
			await removeGitDirectory(tenantRoot);
			return { kind: 'declined', branch };
		}
		const defaultRef = await fetchDefaultBranch(tenantRoot, remoteUrl);
		if (!defaultRef) {
			// Nothing to base on, and an unborn branch cannot be pushed. The repository is wired up
			// on `branch` with `origin` set, so the user's first commit starts it.
			return { kind: 'initialized-empty-remote', branch };
		}
		targetRef = defaultRef;
		created = true;
	}

	// Mixed reset: adopt the remote history without touching a single working-tree file.
	await git(tenantRoot, ['reset', targetRef]);

	if (!created) {
		await git(tenantRoot, ['branch', `--set-upstream-to=origin/${branch}`, branch]);
		return { kind: 'adopted', branch };
	}

	try {
		await git(tenantRoot, ['push', '-u', 'origin', branch]);
	} catch (e) {
		return {
			kind: 'branch-created-not-pushed',
			branch,
			reason: e instanceof Error ? e.message : String(e),
		};
	}
	return { kind: 'branch-created', branch };
}

/**
 * Removes the configuration inherited from the branch this one was forked off.
 *
 * A new branch forks from the remote's default branch so that promotion pull requests
 * (`dev` into `test` into `prod`) have a common ancestor. The side effect is that the default
 * branch's configuration, which belongs to a *different* tenant, lands in this tenant's folder.
 * Showing one tenant's data under another tenant is wrong, so it is dropped here and
 * **Fetch Configuration** writes this tenant's own into a clean tree.
 *
 * Only the managed configuration file is removed. The component folders and their generated
 * READMEs are identical for every tenant, and anything a user hand-placed in an unmanaged folder
 * is their content, not inherited noise, so neither is touched.
 *
 * The deletion is staged but deliberately not committed: the extension does not make commits on
 * the user's behalf. Their first commit carries both the removal and their own configuration.
 */
async function dropInheritedConfiguration(tenantRoot: vscode.Uri): Promise<void> {
	try {
		await git(tenantRoot, ['rm', '--quiet', '--', BUSINESS_CONFIG_FILE]);
	} catch {
		// The default branch had no configuration at that path. Nothing to drop.
	}
}

/** Fetches the remote's default branch and returns its ref, or undefined when the remote is empty. */
async function fetchDefaultBranch(
	tenantRoot: vscode.Uri,
	remoteUrl: string,
): Promise<string | undefined> {
	try {
		await git(tenantRoot, ['fetch', 'origin']);
		const head = await git(tenantRoot, ['remote', 'show', 'origin']);
		const match = /HEAD branch:\s*(\S+)/.exec(head);
		const name = match?.[1];
		if (!name || name === '(unknown)') return undefined;
		return `origin/${name}`;
	} catch {
		return undefined;
	}
}

/** Undoes a `git init` when binding is abandoned, so the folder is left exactly as it was found. */
async function removeGitDirectory(tenantRoot: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.delete(vscode.Uri.joinPath(tenantRoot, '.git'), {
			recursive: true,
			useTrash: false,
		});
	} catch {
		// Leaving a bare `.git` behind is untidy but harmless; never fail the command over it.
	}
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

	// An empty remote clones fine but has no commit to branch from, and an unborn branch cannot be
	// pushed. That is not a failure: the repository is wired up and the user's first commit starts
	// the branch. Say so rather than reporting a push that was never possible.
	if (!(await hasAnyCommit(tenantRoot))) {
		await git(tenantRoot, ['checkout', '-b', branch]);
		return { kind: 'initialized-empty-remote', branch };
	}

	await git(tenantRoot, ['checkout', '-b', branch]);
	await dropInheritedConfiguration(tenantRoot);

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
