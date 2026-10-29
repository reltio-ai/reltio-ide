/**
 * Pure planning for connecting a Custom Workflow Repository whose working tree lands
 * directly in `{tenant}/Workflows/`.
 *
 * `git clone` refuses a non-empty directory, and `Workflows/` is rarely empty by the time a
 * repository is connected: it carries a generated `README.md` and usually `bpmn/` drafts. So
 * the clone goes to a staging folder first and its entries are then *adopted* into
 * `Workflows/`. This module decides what that adoption does; `workflowRepoConnect.ts` does it.
 *
 * Decide/do split, same shape as `planDeploy`: no I/O here, so every collision rule is
 * unit-testable without a filesystem.
 *
 * Refusal is atomic. Either the whole adoption proceeds, or nothing moves and the caller gets
 * the full list of clashing paths. A half-adopted repository would be worse than none.
 *
 * One clash is not a refusal: a BPMN in `bpmn/` that the repository also tracks. That is the
 * normal case for a workflow deployed from the repository and downloaded here, and refusing would
 * block connecting for exactly the users the feature is for. The local copy is kept, the staged
 * one is dropped, and git then shows the file as modified against the repository, so nothing is
 * lost and the difference is visible.
 */

export interface AdoptionEntry {
	readonly name: string;
	readonly isDirectory: boolean;
}

export interface AdoptionInput {
	/** Top-level entries already in `Workflows/`. */
	readonly existing: readonly AdoptionEntry[];
	/** File names inside the existing `Workflows/bpmn/`, when it is a directory. */
	readonly existingBpmn: readonly string[];
	/** True when the existing `README.md` is the one this extension generated, so it may be replaced. */
	readonly existingReadmeIsGenerated: boolean;
	/** Top-level entries of the staged clone, `.git` included. */
	readonly staged: readonly AdoptionEntry[];
	/** File names inside the staged `bpmn/`, when it is a directory. */
	readonly stagedBpmn: readonly string[];
	/** Sub-folder names inside the existing `Workflows/bpmn/`. */
	readonly existingBpmnDirs?: readonly string[];
	/** Sub-folder names inside the staged `bpmn/`. */
	readonly stagedBpmnDirs?: readonly string[];
}

export type AdoptionPlan =
	| {
			readonly ok: true;
			/** Delete the generated placeholder README before moving anything. */
			readonly discardExistingReadme: boolean;
			/** Staged top-level entries moved into `Workflows/` as they are. */
			readonly moveTop: readonly string[];
			/** Staged `bpmn/` files moved into the existing `bpmn/`. */
			readonly mergeBpmn: readonly string[];
			/** Local drafts already in `Workflows/bpmn/`; they become part of the repository's working tree. */
			readonly drafts: readonly string[];
			/** Staged `bpmn/` files dropped because a local file of the same name was kept. */
			readonly keptLocal: readonly string[];
	  }
	| { readonly ok: false; readonly collisions: readonly string[] };

const BPMN_DIR = 'bpmn';
const BASELINE_SUFFIX = '.bpmn20.baseline.xml';
const DRAFT_SUFFIX = '.bpmn20.xml';

/** Compared case-insensitively: Windows and macOS would treat these as the same file. */
const fold = (name: string): string => name.toLowerCase();

/** Draft files (`*.bpmn20.xml`), not their `*.bpmn20.baseline.xml` snapshots. */
export function draftFileNames(bpmnFiles: readonly string[]): string[] {
	return bpmnFiles
		.filter(name => {
			const lower = fold(name);
			return lower.endsWith(DRAFT_SUFFIX) && !lower.endsWith(BASELINE_SUFFIX);
		})
		.sort((a, b) => a.localeCompare(b));
}

export function planWorkflowRepoAdoption(input: AdoptionInput): AdoptionPlan {
	const existingTop = new Map(input.existing.map(e => [fold(e.name), e]));
	const existingBpmn = new Set(input.existingBpmn.map(fold));
	const existingBpmnDirs = new Set((input.existingBpmnDirs ?? []).map(fold));
	const collisions: string[] = [];
	const moveTop: string[] = [];
	const mergeBpmn: string[] = [];
	const keptLocal: string[] = [];

	for (const entry of input.staged) {
		const clash = existingTop.get(fold(entry.name));
		const replaceableReadme =
			clash !== undefined && fold(entry.name) === 'readme.md' && input.existingReadmeIsGenerated;

		if (clash && fold(entry.name) === BPMN_DIR && clash.isDirectory && entry.isDirectory) {
			// The one folder both sides legitimately own: merge, file by file.
			for (const file of input.stagedBpmn) {
				if (existingBpmnDirs.has(fold(file))) collisions.push(`${BPMN_DIR}/${file}`);
				else if (existingBpmn.has(fold(file))) keptLocal.push(file);
				else mergeBpmn.push(file);
			}
			// A sub-folder (for example `bpmn/archive/`) moves across whole. It is refused, not
			// merged, when anything local already has that name.
			for (const dir of input.stagedBpmnDirs ?? []) {
				if (existingBpmn.has(fold(dir)) || existingBpmnDirs.has(fold(dir))) collisions.push(`${BPMN_DIR}/${dir}`);
				else mergeBpmn.push(dir);
			}
			continue;
		}
		if (clash && !replaceableReadme) {
			collisions.push(entry.name);
			continue;
		}
		moveTop.push(entry.name);
	}

	if (collisions.length > 0) return { ok: false, collisions: collisions.sort((a, b) => a.localeCompare(b)) };

	const existingReadme = input.existing.find(e => fold(e.name) === 'readme.md');
	return {
		ok: true,
		discardExistingReadme: Boolean(existingReadme) && input.existingReadmeIsGenerated,
		moveTop,
		mergeBpmn,
		drafts: draftFileNames(input.existingBpmn),
		keptLocal: keptLocal.sort((a, b) => a.localeCompare(b)),
	};
}

/** Lines `Workflows/.git/info/exclude` needs so a draft's last-fetch snapshot never shows as a repository change. */
export const BASELINE_EXCLUDE_PATTERN = '*.bpmn20.baseline.xml';

/** `exclude` text with the baseline pattern present exactly once; unchanged when it already is. */
export function withBaselineExclude(current: string): string {
	const lines = current.split(/\r?\n/);
	if (lines.some(line => line.trim() === BASELINE_EXCLUDE_PATTERN)) return current;
	const base = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
	return `${base}${BASELINE_EXCLUDE_PATTERN}\n`;
}

const MAX_LISTED_DRAFTS = 5;

/**
 * Wording for the dialog shown when connecting finds drafts already in `Workflows/bpmn/`: they are
 * in the repository's BPMN folder, so the next commit includes them. Kept short on purpose; the
 * only addition is the note for a draft whose name the repository also tracks.
 */
export function describeAdoptedDrafts(
	drafts: readonly string[],
	keptLocal: readonly string[] = [],
): { message: string; detail: string } {
	const count = drafts.length;
	return {
		message:
			(count === 1 ? 'Your local draft BPMN has' : 'Your local draft BPMNs have') +
			' been moved to the bpmn folder in the repository and will be included the next time you commit.',
		detail: keptLocal.length > 0 ? describeKeptLocal(keptLocal) : '',
	};
}

function describeKeptLocal(keptLocal: readonly string[]): string {
	const listed = keptLocal.slice(0, MAX_LISTED_DRAFTS).join(', ');
	const more = keptLocal.length > MAX_LISTED_DRAFTS ? ` and ${keptLocal.length - MAX_LISTED_DRAFTS} more` : '';
	const same = keptLocal.length === 1 ? 'has the same name as a file' : 'have the same names as files';
	return (
		`${listed}${more} ${same} already in the repository. Your local copy was kept, so git will show it as modified ` +
		'compared with the repository. Review it with git diff, or restore the repository version with git checkout.'
	);
}
