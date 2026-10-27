/**
 * Which BPMN files "came from the repository", and which files disconnecting should remove.
 *
 * The repository is cloned into `Workflows/`, and its own `bpmn/` folder is also where local drafts
 * live, so a file's location alone does not say where it came from. Git does: a file the
 * repository tracks is the repository's. This module is the pure half (decide); the git calls and
 * deletions are in `workflowRepoCleanup.ts`.
 */

/** Posix-style path of `fsPath` relative to `workflowsFsPath`, or `undefined` when it is not inside it. */
export function relativeToWorkflows(fsPath: string, workflowsFsPath: string): string | undefined {
	const file = fsPath.replace(/\\/g, '/');
	const root = workflowsFsPath.replace(/\\/g, '/').replace(/\/+$/, '');
	if (!file.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return undefined;
	return file.slice(root.length + 1);
}

const DRAFTS_PREFIX = 'bpmn/';

/**
 * True when a BPMN at `relativePath` came from the repository: the repository tracks it, or it sits
 * outside the drafts folder (the extension never writes there, so it can only be the repository's).
 *
 * `tracked` is `undefined` when git could not be asked; then only location counts, so a file in
 * `bpmn/` is treated as the user's own draft rather than guessed to be the repository's.
 */
export function isRepoOriginFile(relativePath: string, tracked: ReadonlySet<string> | undefined): boolean {
	if (tracked?.has(relativePath)) return true;
	return !relativePath.toLowerCase().startsWith(DRAFTS_PREFIX);
}

export interface RepoFileSets {
	/** Files git tracks (`git ls-files`). */
	readonly tracked: readonly string[];
	/** Tracked files with uncommitted changes (`git diff --name-only HEAD`). */
	readonly modified: readonly string[];
	/** Untracked files git ignores: build output, and the baseline snapshots excluded at connect. */
	readonly ignored: readonly string[];
}

export interface RepoCleanupPlan {
	/** Repository-relative paths to delete. */
	readonly remove: readonly string[];
	/** Tracked files kept because they hold uncommitted changes. */
	readonly keptModified: readonly string[];
}

const BASELINE_SUFFIX = '.baseline.xml';

/** A path git reported that must not be deleted from: absolute, parent-relative, or inside `.git`. */
function isUnsafePath(path: string): boolean {
	if (path.length === 0 || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return true;
	const segments = path.split('/');
	return segments.some(segment => segment === '..' || segment === '.git');
}

/**
 * What disconnecting removes: every file the repository tracks and the user has not changed, plus
 * ignored build output. Kept: tracked files with uncommitted edits, and everything untracked and not
 * ignored (new drafts, new Java, anything the user added) — none of it came from the repository.
 *
 * A baseline snapshot goes only together with the BPMN it belongs to, so the downloaded copy of a
 * tenant workflow that is kept never loses its baseline.
 */
export function planRepoCleanup(sets: RepoFileSets): RepoCleanupPlan {
	const modified = new Set(sets.modified);
	const remove = new Set<string>();
	const keptModified: string[] = [];
	for (const path of sets.tracked) {
		if (isUnsafePath(path)) continue;
		if (modified.has(path)) keptModified.push(path);
		else remove.add(path);
	}
	for (const path of sets.ignored) {
		if (isUnsafePath(path)) continue;
		if (path.toLowerCase().endsWith(BASELINE_SUFFIX)) {
			const owner = `${path.slice(0, -BASELINE_SUFFIX.length)}.xml`;
			if (remove.has(owner)) remove.add(path);
			continue;
		}
		remove.add(path);
	}
	return {
		remove: [...remove].sort((a, b) => a.localeCompare(b)),
		keptModified: keptModified.sort((a, b) => a.localeCompare(b)),
	};
}

/** The confirmation text for disconnecting, saying what goes and what stays. */
export function describeDisconnect(
	tenantId: string,
	plan: RepoCleanupPlan | undefined,
	unpushedCommits: number,
): string {
	if (!plan) {
		return `Disconnect the Custom Workflow Repository for "${tenantId}"? The repository could not be read, so every file in Workflows/ stays as it is; only the repository link and its local history are removed.`;
	}
	const kept = plan.keptModified.length > 0
		? ` ${plan.keptModified.length} repository file${plan.keptModified.length === 1 ? ' has' : 's have'} uncommitted changes and will be kept.`
		: '';
	const unpushed = unpushedCommits > 0
		? ` ${unpushedCommits} commit${unpushedCommits === 1 ? ' has' : 's have'} not been pushed and will be lost.`
		: '';
	return (
		`Disconnect the Custom Workflow Repository for "${tenantId}"? ` +
		`Its ${plan.remove.length} file${plan.remove.length === 1 ? '' : 's'} will be removed from Workflows/, ` +
		`so another repository can be connected. Drafts and files you added yourself are kept.${kept}${unpushed}`
	);
}
