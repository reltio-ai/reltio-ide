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

export const DRAFT_SUFFIX = '.bpmn20.xml';

/**
 * A process id is the workflow's identity on the tenant: it names the process
 * in the engine, it is what an API call starts the workflow by, and it decides
 * whether a deploy creates a new workflow or a new *version* of an existing one.
 *
 * It also reaches three different contexts — a filename, a URL query parameter
 * and XML content — so this pattern is as much injection and path-traversal
 * safety as it is usability. Deliberately conservative: leading letter or
 * underscore, then letters, digits, underscore, dot or hyphen, 64 max.
 */
const PROCESS_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

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

export function isValidProcessId(processId: string): boolean {
	return PROCESS_ID_PATTERN.test(processId);
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
	return undefined;
}

export function draftFileName(processId: string): string {
	return `${processId}${DRAFT_SUFFIX}`;
}

/** Strict inverse of `draftFileName`; `undefined` for anything else in the folder. */
export function processIdFromDraftFileName(fileName: string): string | undefined {
	if (!fileName.endsWith(DRAFT_SUFFIX)) return undefined;
	const processId = fileName.slice(0, -DRAFT_SUFFIX.length);
	return isValidProcessId(processId) ? processId : undefined;
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
