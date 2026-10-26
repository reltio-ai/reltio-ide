/**
 * Local BPMN drafts — process definitions the user has created but not yet
 * deployed.
 *
 * On-disk shape:
 *   {tenant}/Workflows/bpmn/{processId}.bpmn20.xml
 *
 * A draft is a real file, not a scratch buffer: it survives a window reload, is
 * visible in the Explorer, and belongs to the customer rather than to this
 * extension. The filename is derived strictly from the process id, and the same
 * name is used as the multipart part filename on deploy, so what the user sees
 * in the Explorer is what the server receives.
 *
 * Everything here is pure string/XML logic except `listWorkflowDrafts` and
 * `writeWorkflowDraft`, which are the only two functions that touch
 * `vscode.workspace.fs`. That split is deliberate: the test harness's `vscode`
 * stub returns an empty `Uint8Array` from `readFile`, so anything reading a file
 * is untestable by construction. Keeping the rules out of the I/O keeps them
 * assertable.
 *
 * No XML parser is used, here or anywhere in this extension — see the note in
 * `workflowAdapterClient.ts`. `rewriteProcessIdentity` works by bounded regex.
 */
import * as vscode from 'vscode';
import { BPMN_SUFFIX, bpmnFileName, processIdFromBpmnFileName } from './workflowBpmnFiles';
import { extractProcessModel } from '../workflow/bpmnModel';
import { layoutChain, renderDiagramSection, withDiagramSection } from '../workflow/bpmnDiagram';
import type { EnvironmentManager } from './environmentManager';

/**
 * A draft and a downloaded deployment are the same kind of file on disk, so
 * they share one suffix constant rather than each declaring the literal.
 */
export const DRAFT_SUFFIX = BPMN_SUFFIX;

/**
 * Process-id rules live in `workflowBpmnFiles.ts`, beside the filename rules
 * they have to agree with, and are re-exported here for this module's callers.
 */
export { isValidProcessId, processIdValidationMessage } from './workflowBpmnFiles';

/**
 * Matches the first `<process …>` start tag, with or without a namespace prefix. Quoted attribute
 * values are consumed whole so a `>` inside one does not end the tag early.
 */
const FIRST_PROCESS_TAG = /<(?:[\w.-]+:)?process(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/;

/** One `name="value"` attribute. Tokenised rather than regex-searched by name so `data-id=` or a quoted value that merely contains ` id="` is never mistaken for the `id` attribute. */
const ATTRIBUTE = /([^\s=/>"']+)(\s*=\s*)("[^"]*"|'[^']*')/g;

function attributeValue(tag: string, attribute: string): string | undefined {
	for (const m of tag.matchAll(ATTRIBUTE)) {
		if (m[1] === attribute) return m[3].slice(1, -1);
	}
	return undefined;
}

/** Replace attribute `attribute` on a start tag, or add it right after the tag name when absent. */
function setAttribute(tag: string, attribute: string, escapedValue: string): string {
	let found = false;
	const replaced = tag.replace(ATTRIBUTE, (whole, name: string) => {
		if (found || name !== attribute) return whole;
		found = true;
		return `${attribute}="${escapedValue}"`;
	});
	return found ? replaced : replaced.replace(/^<([\w.:-]+)/, `<$1 ${attribute}="${escapedValue}"`);
}

export interface WorkflowDraft {
	readonly fileUri: vscode.Uri;
	readonly fileName: string;
	readonly processId: string;
	/**
	 * The BPMN's `<process name="...">`, when the file has one and could be read. `undefined`
	 * for "no name attribute" or "could not read the file right now" alike — both fall back to
	 * `processId` in the tree, and a transient read failure here must not be fatal to listing
	 * the draft at all, which is the one thing `processId` (filename-derived, D4-exempt for
	 * Drafts — see this file's own doc comment) never needs the file's content to answer.
	 */
	readonly processName: string | undefined;
}

export interface DraftContext {
	readonly environmentName: string;
	readonly tenantId: string;
	readonly processId: string;
}

// ─── Naming ──────────────────────────────────────────────────────────────────

export function draftFileName(processId: string): string {
	return bpmnFileName(processId);
}

/**
 * Strict inverse of `draftFileName`; `undefined` for anything else in the
 * folder. One parser, shared with `listLocalBpmnFiles`, so a filename cannot be
 * a valid draft here and an invalid BPMN there.
 */
export function processIdFromDraftFileName(fileName: string): string | undefined {
	return processIdFromBpmnFileName(fileName);
}

/**
 * Recover the tenant a draft belongs to from its own path.
 *
 * Deploy is reachable from an editor tab and the command palette, where there is
 * no tree node to carry context — and three tenants can each hold a draft with
 * the same filename. Inferring the tenant from the current tree selection would
 * eventually deploy the wrong file to the wrong tenant, so the file's own path
 * is the authority.
 *
 * Plain folder names carry no identity — a tenant folder is now just the bare
 * tenant ID, and an environment folder's short label is not invertible when two
 * hosts collide on it — so `environmentManager`'s scan-built reverse index is
 * the authority whenever it is available. The suffix-based fallback below only
 * still matches a pre-rename workspace, exactly like `pathTenantLocFromL3Path`,
 * which this mirrors.
 */
export function resolveDraftContext(
	fsPath: string,
	environmentManager?: Pick<EnvironmentManager, 'locFromPath'> | null,
): DraftContext | undefined {
	const parts = fsPath.split(/[/\\]/).filter(Boolean);
	const fileName = parts[parts.length - 1];
	if (!fileName) return undefined;

	const processId = processIdFromDraftFileName(fileName);
	if (!processId) return undefined;

	// …/{tenant folder}/Workflows/bpmn/{file} — the immediate parent must be the drafts folder.
	if (parts[parts.length - 2] !== 'bpmn' || parts[parts.length - 3] !== 'Workflows') return undefined;

	const loc = environmentManager?.locFromPath(fsPath) ?? legacySuffixedDraftLoc(parts);
	if (!loc) return undefined;

	return { environmentName: loc.environmentName, tenantId: loc.tenantId, processId };
}

/**
 * Suffix-based fallback for a pre-rename workspace: `…/{env}.reltio.environment/
 * {tenant}.reltio.tenant/Workflows/bpmn/{file}`. Mirrors `pathTenantLocFromL3Path`.
 * The tenant folder may still be legacy-suffixed even though the drafts location
 * inside it (`Workflows/bpmn/`) never was — the two renames are independent.
 */
function legacySuffixedDraftLoc(
	parts: readonly string[],
): { environmentName: string; tenantId: string } | undefined {
	const tenantSeg = parts[parts.length - 4];
	const envSeg = parts[parts.length - 5];
	if (!tenantSeg?.endsWith('.reltio.tenant') || !envSeg?.endsWith('.reltio.environment')) {
		return undefined;
	}
	return {
		environmentName: envSeg.slice(0, -'.reltio.environment'.length),
		tenantId: tenantSeg.slice(0, -'.reltio.tenant'.length),
	};
}

// ─── XML generation ──────────────────────────────────────────────────────────

/** Escape the five characters that matter inside an XML attribute value. */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * A minimal but genuinely deployable process: start → one approval task → end.
 *
 * Deliberately not a stub with placeholders to fill in. A user who deploys this
 * unchanged gets a working (if trivial) workflow rather than a rejected upload,
 * which makes the create → deploy → observe loop usable on the first pass.
 *
 * All seven namespaces from `bpmn-rules.md` §1 are declared, including the three
 * diagram ones. Earlier versions declared four and emitted no diagram section,
 * on the grounds that the engine executes without one. That was true and beside
 * the point: DI is what every *viewer* reads, so a definition without it opened
 * as a blank canvas in Camunda Modeler, in the Reltio console, and in this
 * extension's own preview. A workflow nobody can look at cannot be reviewed.
 *
 * The section is produced by the same serializer an arbitrary document uses, off
 * a fixed chain layout rather than a layout engine — the topology here is known,
 * so `layoutChain` is enough and this function stays pure and synchronous.
 * Deriving it from the emitted XML rather than hard-coding coordinates means the
 * shapes cannot drift out of step with the elements if this skeleton changes.
 */
export function buildBpmnSkeleton(processId: string, displayName: string): string {
	const id = escapeXml(processId);
	const name = escapeXml(displayName);
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
             typeLanguage="http://www.w3.org/2001/XMLSchema"
             expressionLanguage="http://www.w3.org/1999/XPath"
             targetNamespace="http://www.reltio.com/workflow">
  <process id="${id}" name="${name}" isExecutable="true">

    <startEvent id="start" name="Start" />
    <sequenceFlow id="flow1" sourceRef="start" targetRef="reviewTask" />

    <userTask id="reviewTask" name="Review" activiti:candidateGroups="ROLE_ADMIN">
      <documentation>Replace with the reviewer assignment this workflow needs.</documentation>
      <!-- Both create listeners are required on every user task: omitting
           either produces errorCode 10044 at runtime, not at deploy. -->
      <extensionElements>
        <activiti:taskListener event="create"
          class="com.reltio.workflow.activiti.service.TaskStartEventListener" />
        <activiti:taskListener event="create"
          class="com.reltio.workflow.activiti.service.DCRTypeTaskListener" />
      </extensionElements>
    </userTask>
    <sequenceFlow id="flow2" sourceRef="reviewTask" targetRef="end" />

    <endEvent id="end" name="End" />

  </process>
</definitions>
`;

	const model = extractProcessModel(body);
	if (!model.processId) return body;
	const layout = layoutChain(model.nodes, model.flows);
	return withDiagramSection(body, renderDiagramSection(model.processId, model, layout));
}

/**
 * Rewrite the `id` and `name` of the first `<process>` element, and re-point the
 * diagram plane at the new id.
 *
 * Used by Duplicate as Draft. Keeping the original id would not produce a copy —
 * it would deploy the next *version* of the live workflow, so changing it is the
 * whole point of the operation, not a cosmetic touch-up.
 *
 * The plane matters because DI references the process by id:
 * `<bpmndi:BPMNPlane bpmnElement="{processId}">`. Rewriting the process without
 * the plane leaves the diagram pointing at an id that no longer exists in the
 * document, and a viewer that cannot resolve the plane's `bpmnElement` draws
 * nothing at all. Shape-level `bpmnElement` references are deliberately left
 * alone: those name flow nodes, whose ids this function does not touch.
 *
 * Returns `undefined` when no `<process>` element is found, so the caller can
 * refuse rather than write a draft that silently kept the original identity.
 */
export function rewriteProcessIdentity(
	xml: string,
	newProcessId: string,
	newDisplayName: string,
): string | undefined {
	const match = FIRST_PROCESS_TAG.exec(xml);
	if (!match) return undefined;

	const tag = match[0];
	const id = escapeXml(newProcessId);
	const name = escapeXml(newDisplayName);
	const previousId = attributeValue(tag, 'id');

	const rewritten = setAttribute(setAttribute(tag, 'id', id), 'name', name);

	const withProcess = xml.slice(0, match.index) + rewritten + xml.slice(match.index + tag.length);
	return retargetDiagramPlane(withProcess, previousId, id);
}

/** `<bpmndi:BPMNPlane …>`, with or without a namespace prefix. */
const BPMN_PLANE_TAG = /<(?:[\w.-]+:)?BPMNPlane(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/i;

/**
 * Point the diagram plane's `bpmnElement` at the new process id.
 *
 * Only rewritten when it currently names the *old* process id. A plane pointing
 * somewhere else is either already correct or something this function did not
 * author, and overwriting it would be a guess.
 */
function retargetDiagramPlane(
	xml: string,
	previousProcessId: string | undefined,
	escapedNewId: string,
): string {
	if (!previousProcessId) return xml;
	const match = BPMN_PLANE_TAG.exec(xml);
	if (!match) return xml;

	const tag = match[0];
	const current = attributeValue(tag, 'bpmnElement');
	if (current !== previousProcessId) return xml;

	const rewritten = setAttribute(tag, 'bpmnElement', escapedNewId);
	return xml.slice(0, match.index) + rewritten + xml.slice(match.index + tag.length);
}

// ─── File system ─────────────────────────────────────────────────────────────

/**
 * Every draft in a tenant's `Workflows/bpmn/` folder, sorted by process id.
 *
 * `processName` costs one extra read per draft, on top of the directory listing this function
 * already does — acceptable because a tenant's draft count is small (these are hand-created,
 * not provisioned) and because `processId` must stay filename-derived either way (D4 does not
 * apply to Drafts; see this module's own doc comment), so a read that fails or returns no name
 * degrades to `processId` rather than losing the draft from the list.
 */
export async function listWorkflowDrafts(draftsDir: vscode.Uri): Promise<WorkflowDraft[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(draftsDir);
	} catch {
		return [];
	}
	const out: WorkflowDraft[] = [];
	for (const [fileName, fileType] of entries) {
		if (fileType !== vscode.FileType.File) continue;
		const processId = processIdFromDraftFileName(fileName);
		if (!processId) continue;
		const fileUri = vscode.Uri.joinPath(draftsDir, fileName);
		let processName: string | undefined;
		try {
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
			processName = extractProcessModel(text).processName;
		} catch {
			processName = undefined;
		}
		out.push({ fileUri, fileName, processId, processName });
	}
	out.sort((a, b) => a.processId.localeCompare(b.processId));
	return out;
}

/** Write one draft, creating the `Workflows/bpmn/` folder on first use. */
export async function writeWorkflowDraft(
	draftsDir: vscode.Uri,
	fileName: string,
	xml: string,
): Promise<vscode.Uri> {
	await vscode.workspace.fs.createDirectory(draftsDir);
	const fileUri = vscode.Uri.joinPath(draftsDir, fileName);
	// This is the one call site that creates a brand-new draft — never a re-save of an existing
	// one — so an existing file here means something else claimed this name between the caller's
	// own (case-insensitive, pre-trimmed) duplicate check and this write, on a case-insensitive
	// filesystem (NTFS/APFS default) that check cannot fully see across two different inputs.
	// Checked here, immediately before the write, to close that window rather than widen it.
	try {
		await vscode.workspace.fs.stat(fileUri);
		throw new Error(`"${fileName}" already exists.`);
	} catch (e) {
		// FileSystemError with code 'FileNotFound' is the expected, good outcome of `stat` here;
		// anything else (including the Error thrown just above) must propagate.
		if (!(e instanceof vscode.FileSystemError) || e.code !== 'FileNotFound') throw e;
	}
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(xml, 'utf-8'));
	return fileUri;
}
