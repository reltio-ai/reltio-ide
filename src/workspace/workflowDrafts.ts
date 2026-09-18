/**
 * Local BPMN drafts — process definitions the user has created but not yet
 * deployed.
 *
 * On-disk shape:
 *   {tenantId}.reltio.tenant/workflows/{processId}.bpmn20.xml
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

/** Matches the first `<process …>` element, with or without a namespace prefix. */
const FIRST_PROCESS_TAG = /<(?:[\w.-]+:)?process\b[^>]*>/;

export interface WorkflowDraft {
	readonly fileUri: vscode.Uri;
	readonly fileName: string;
	readonly processId: string;
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
 * is the authority. Mirrors `pathTenantLocFromL3Path`.
 */
export function resolveDraftContext(fsPath: string): DraftContext | undefined {
	const parts = fsPath.split(/[/\\]/).filter(Boolean);
	const fileName = parts[parts.length - 1];
	if (!fileName) return undefined;

	const processId = processIdFromDraftFileName(fileName);
	if (!processId) return undefined;

	// …/{env}.reltio.environment/{tenant}.reltio.tenant/workflows/{file}
	if (parts[parts.length - 2] !== 'workflows') return undefined;
	const tenantSeg = parts[parts.length - 3];
	const envSeg = parts[parts.length - 4];
	if (!tenantSeg?.endsWith('.reltio.tenant') || !envSeg?.endsWith('.reltio.environment')) {
		return undefined;
	}

	return {
		environmentName: envSeg.slice(0, -'.reltio.environment'.length),
		tenantId: tenantSeg.slice(0, -'.reltio.tenant'.length),
		processId,
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
 * No `BPMNDI` diagram section is emitted. The engine does not need one to
 * execute; whether the Reltio console renders a definition without it is a Tier
 * C question recorded in design.md.
 */
export function buildBpmnSkeleton(processId: string, displayName: string): string {
	const id = escapeXml(processId);
	const name = escapeXml(displayName);
	return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xmlns:activiti="http://activiti.org/bpmn"
             targetNamespace="http://www.reltio.com/workflow">
  <process id="${id}" name="${name}" isExecutable="true">

    <startEvent id="start" name="Start" />
    <sequenceFlow id="flow1" sourceRef="start" targetRef="reviewTask" />

    <userTask id="reviewTask" name="Review" activiti:candidateGroups="ROLE_ADMIN">
      <documentation>Replace with the reviewer assignment this workflow needs.</documentation>
    </userTask>
    <sequenceFlow id="flow2" sourceRef="reviewTask" targetRef="end" />

    <endEvent id="end" name="End" />

  </process>
</definitions>
`;
}

/**
 * Rewrite the `id` and `name` of the first `<process>` element only.
 *
 * Used by Duplicate as Draft. Keeping the original id would not produce a copy —
 * it would deploy the next *version* of the live workflow, so changing it is the
 * whole point of the operation, not a cosmetic touch-up.
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

	let rewritten = /\bid\s*=\s*["'][^"']*["']/.test(tag)
		? tag.replace(/\bid\s*=\s*["'][^"']*["']/, `id="${id}"`)
		: tag.replace(/^<([\w.:-]+)/, `<$1 id="${id}"`);

	rewritten = /\bname\s*=\s*["'][^"']*["']/.test(rewritten)
		? rewritten.replace(/\bname\s*=\s*["'][^"']*["']/, `name="${name}"`)
		: rewritten.replace(/^<([\w.:-]+)/, `<$1 name="${name}"`);

	return xml.slice(0, match.index) + rewritten + xml.slice(match.index + tag.length);
}

// ─── File system ─────────────────────────────────────────────────────────────

/** Every draft in a tenant's `workflows/` folder, sorted by process id. */
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
		out.push({ fileUri: vscode.Uri.joinPath(draftsDir, fileName), fileName, processId });
	}
	out.sort((a, b) => a.processId.localeCompare(b.processId));
	return out;
}

/** Write one draft, creating the `workflows/` folder on first use. */
export async function writeWorkflowDraft(
	draftsDir: vscode.Uri,
	fileName: string,
	xml: string,
): Promise<vscode.Uri> {
	await vscode.workspace.fs.createDirectory(draftsDir);
	const fileUri = vscode.Uri.joinPath(draftsDir, fileName);
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(xml, 'utf-8'));
	return fileUri;
}
