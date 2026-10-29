/**
 * Local BPMN files and their remote baselines.
 *
 * This is the Business Config model applied to workflows. Opening a deployed
 * process definition downloads two files:
 *
 *   {tenant}/Workflows/bpmn/{processId}.bpmn20.xml           ← editable
 *   {tenant}/Workflows/bpmn/{processId}.bpmn20.baseline.xml  ← last fetch
 *
 * exactly as `L3.reltio.json` sits beside `L3.remote-baseline.reltio.json`. The
 * baseline is what makes "do I have undeployed changes?" and "did the server
 * move under me?" answerable, which is what drives the same guard dialogs the
 * configuration flow already uses.
 *
 * The two concepts this feature used to keep apart now fall out of one rule:
 *   - a **draft** is a local BPMN with no baseline — it was never on the tenant
 *   - an **edited deployment** is a local BPMN whose text differs from its baseline
 *
 * so deploying a draft simply gives it a baseline, and it stops being a draft.
 *
 * ── Why comparison is normalised text, not a parse ──────────────────────────
 *
 * Business Config compares with `jsonDeepEqual`. There is no XML equivalent here
 * and deliberately so: this codebase ships no XML parser, because no parser means
 * no XXE surface (see `workflowAdapterClient.ts`).
 *
 * A naive text compare would be useless anyway. The Activiti engine re-serialises
 * a definition when it deploys — attribute order shifts, whitespace changes, and
 * a `BPMNDI` layout block may be added that was never in the source. Comparing
 * raw text would report "locally changed" on every definition the moment it was
 * fetched, permanently, and the warning would be trained out of the user within a
 * day.
 *
 * So both sides are normalised first: BOM stripped, comments and the whole
 * `BPMNDI` block removed, inter-tag whitespace collapsed, line endings unified.
 * The consequence worth knowing: a purely cosmetic edit — reindenting, reordering
 * attributes — does not count as a change. That is the intended behaviour, but it
 * is a real difference from how L3 comparison behaves.
 */
import * as vscode from 'vscode';

export const BPMN_SUFFIX = '.bpmn20.xml';
export const BPMN_BASELINE_SUFFIX = '.bpmn20.baseline.xml';

/**
 * A process id is the workflow's identity on the tenant: it names the process
 * in the engine, it is what an API call starts the workflow by, and it decides
 * whether a deploy creates a new workflow or a new *version* of an existing one.
 *
 * It also reaches three different contexts — a filename, a URL query parameter
 * and XML content — so this pattern is as much injection and path-traversal
 * safety as it is usability. Deliberately conservative: leading letter or
 * underscore, then letters, digits, underscore, dot or hyphen, 64 max.
 *
 * It lives here, beside the filename rules, because every local BPMN — draft or
 * downloaded deployment — is discovered by parsing its filename. Two parsers
 * applying different notions of "valid" is how a name the rest of the feature
 * refuses still reaches the tree, the guards and a deploy URL.
 * `workflowDrafts.ts` re-exports these for its own callers.
 */
const PROCESS_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/** Windows opens the device, not a file, for these names with or without an extension — `con.bpmn20.xml` would hit the console. */
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function isValidProcessId(processId: string): boolean {
	return PROCESS_ID_PATTERN.test(processId) && !WINDOWS_DEVICE_NAME.test(processId);
}

/**
 * Human-readable reason a process id was rejected, for `validateInput`.
 * Returns `undefined` when the id is acceptable.
 */
export function processIdValidationMessage(raw: string): string | undefined {
	const id = raw.trim();
	if (!id) return 'A process ID is required.';
	if (id.length > 64) return 'A process ID must be 64 characters or fewer.';
	if (!/^[A-Za-z_]/.test(id)) return 'A process ID must start with a letter or underscore.';
	if (!PROCESS_ID_PATTERN.test(id)) {
		return 'A process ID may contain only letters, digits, underscore, dot and hyphen.';
	}
	if (WINDOWS_DEVICE_NAME.test(id)) {
		return 'A process ID must not be a reserved Windows device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9).';
	}
	return undefined;
}

export function bpmnFileName(processId: string): string {
	return `${processId}${BPMN_SUFFIX}`;
}

export function bpmnBaselineFileName(processId: string): string {
	return `${processId}${BPMN_BASELINE_SUFFIX}`;
}

/**
 * Process id from a local BPMN file name, or `undefined` for anything else in
 * the folder — including a baseline, which must never be mistaken for a draft,
 * and any name whose stem is not a valid process id.
 */
export function processIdFromBpmnFileName(fileName: string): string | undefined {
	if (fileName.endsWith(BPMN_BASELINE_SUFFIX)) return undefined;
	if (!fileName.endsWith(BPMN_SUFFIX)) return undefined;
	const processId = fileName.slice(0, -BPMN_SUFFIX.length);
	return isValidProcessId(processId) ? processId : undefined;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

/** The `<bpmndi:BPMNDiagram>` block, with or without a namespace prefix. */
const BPMNDI_BLOCK = /<(?:[\w.-]+:)?BPMNDiagram\b[\s\S]*?<\/(?:[\w.-]+:)?BPMNDiagram>/gi;
const XML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Reduce a BPMN to the form worth comparing. See the header for why this exists.
 * Cheap and total — never throws, never parses.
 */
export function normalizeBpmn(xml: string): string {
	return xml
		.replace(/^﻿/, '')
		.replace(XML_COMMENT, '')
		.replace(BPMNDI_BLOCK, '')
		.replace(/\r\n?/g, '\n')
		.replace(/>\s+</g, '><')
		.trim();
}

/**
 * True when the local file differs from the baseline captured at the last fetch.
 * A missing or empty baseline means "never fetched from the tenant", which is a
 * draft rather than an edit — callers distinguish the two, so this reports
 * `false` and leaves that decision to them.
 */
export function hasLocalBpmnChanges(localText: string, baselineText: string | undefined): boolean {
	if (baselineText === undefined) return false;
	return normalizeBpmn(localText) !== normalizeBpmn(baselineText);
}

/** True when the server still matches the baseline captured at the last fetch. */
export function remoteBpmnMatchesBaseline(baselineText: string, remoteText: string): boolean {
	return normalizeBpmn(baselineText) === normalizeBpmn(remoteText);
}

// ─── File system ─────────────────────────────────────────────────────────────

/** Read a file as text, or `undefined` when it does not exist or cannot be read. */
export async function readTextFile(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return undefined;
	}
}

/** Write a BPMN (or its baseline), creating `Workflows/bpmn/` on first use. */
export async function writeBpmnFile(
	directory: vscode.Uri,
	fileName: string,
	xml: string,
): Promise<vscode.Uri> {
	await vscode.workspace.fs.createDirectory(directory);
	const fileUri = vscode.Uri.joinPath(directory, fileName);
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(xml, 'utf-8'));
	return fileUri;
}

// ─── Compare / discard plans ─────────────────────────────────────────────────
//
// Same decide/say split as `workflowDeployPlan.ts`'s `planDeploy()`: deciding
// whether there is anything to compare or restore, and what the file write
// should contain, is pure and total over a baseline that may not exist. Only
// the actual `vscode.workspace.fs` read/write and the diff editor stay in the
// `extension.ts` command handlers, which become thin wrappers around these.

export type BpmnDiffPlan =
	| { readonly ok: false; readonly message: string }
	| { readonly ok: true };

/**
 * Whether "Compare with Last Fetch" has anything to show. A BPMN that was
 * never downloaded — a draft — has no baseline to diff against, so this
 * refuses rather than opening an empty or misleading comparison.
 */
export function planBpmnDiff(processId: string, baselineText: string | undefined): BpmnDiffPlan {
	if (baselineText === undefined) {
		return { ok: false, message: `"${processId}" has not been downloaded yet, so there is nothing to compare.` };
	}
	return { ok: true };
}

export type DiscardBpmnPlan =
	| { readonly ok: false; readonly message: string }
	| {
		readonly ok: true;
		readonly fileName: string;
		readonly text: string;
		readonly successMessage: string;
	};

/**
 * What "Discard Local Changes" should write, given the baseline captured at
 * the last fetch. Same refusal as `planBpmnDiff()` when there is no baseline:
 * a draft has nothing fetched to restore to.
 */
export function planDiscardBpmnChanges(processId: string, baselineText: string | undefined): DiscardBpmnPlan {
	if (baselineText === undefined) {
		return {
			ok: false,
			message: `No baseline exists for "${processId}", so there is nothing to restore. Fetch it from the tenant first.`,
		};
	}
	return {
		ok: true,
		fileName: bpmnFileName(processId),
		text: baselineText,
		successMessage: `Local changes to "${processId}" discarded.`,
	};
}

export interface LocalBpmnState {
	readonly processId: string;
	readonly fileUri: vscode.Uri;
	/** `undefined` when this BPMN was never fetched from a tenant — i.e. a draft. */
	readonly baselineText: string | undefined;
	readonly localText: string;
	readonly hasLocalChanges: boolean;
}

/**
 * Every local BPMN in a tenant's `Workflows/bpmn/` folder, with its baseline state.
 *
 * One pass over the directory answers both "which rows should show a local-changes
 * marker" and "which files are drafts", so the tree and the navigation guard read
 * from the same place rather than each deriving it.
 */
export async function listLocalBpmnFiles(directory: vscode.Uri): Promise<LocalBpmnState[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(directory);
	} catch {
		return [];
	}

	const out: LocalBpmnState[] = [];
	for (const [fileName, fileType] of entries) {
		if (fileType !== vscode.FileType.File) continue;
		const processId = processIdFromBpmnFileName(fileName);
		if (!processId) continue;

		const fileUri = vscode.Uri.joinPath(directory, fileName);
		const localText = await readTextFile(fileUri);
		if (localText === undefined) continue;

		const baselineText = await readTextFile(
			vscode.Uri.joinPath(directory, bpmnBaselineFileName(processId)),
		);
		out.push({
			processId,
			fileUri,
			baselineText,
			localText,
			hasLocalChanges: hasLocalBpmnChanges(localText, baselineText),
		});
	}
	out.sort((a, b) => a.processId.localeCompare(b.processId));
	return out;
}
