/**
 * Sidecar persistence for the Workflow Adapter URL.
 *
 * On-disk shape (inside `{tenantId}.reltio.tenant/WorkflowAdapter.reltio.json`):
 * ```json
 * { "version": 1, "workflowAdapterUrl": "https://demo-01-workflow.reltio.com" }
 * ```
 *
 * Mirrors the pattern established by `src/ontology/layoutPersistence.ts`:
 *   - A `version` field guards future schema migrations.
 *   - All reads return `undefined` on any error (missing file, corrupt JSON,
 *     wrong version) — callers treat `undefined` as "no URL saved yet" and
 *     prompt the user.
 *   - Only the URL is persisted. Tokens are never written to disk.
 */
import * as vscode from 'vscode';

const CURRENT_VERSION = 1;

interface WorkflowAdapterConfigFile {
	version: number;
	workflowAdapterUrl: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reads the saved Workflow Adapter URL for the given tenant sidecar URI.
 *
 * @param configUri  The URI returned by `environmentManager.getWorkflowAdapterConfigUri()`.
 * @returns          The URL string, or `undefined` if the file doesn't exist,
 *                   can't be parsed, or has an unexpected version.
 */
export async function loadWorkflowAdapterUrl(
	configUri: vscode.Uri,
): Promise<string | undefined> {
	try {
		const data = await vscode.workspace.fs.readFile(configUri);
		const parsed: WorkflowAdapterConfigFile = JSON.parse(
			Buffer.from(data).toString('utf-8'),
		) as WorkflowAdapterConfigFile;
		if (parsed.version !== CURRENT_VERSION || typeof parsed.workflowAdapterUrl !== 'string') {
			return undefined;
		}
		return parsed.workflowAdapterUrl || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Saves the Workflow Adapter URL to the tenant sidecar file.
 * Creates intermediate directories if they do not exist.
 *
 * @param configUri  The URI returned by `environmentManager.getWorkflowAdapterConfigUri()`.
 * @param url        The validated `https://` URL to persist.
 */
export async function saveWorkflowAdapterUrl(
	configUri: vscode.Uri,
	url: string,
): Promise<void> {
	const content: WorkflowAdapterConfigFile = {
		version: CURRENT_VERSION,
		workflowAdapterUrl: url,
	};
	const data = Buffer.from(JSON.stringify(content, null, 2), 'utf-8');
	await vscode.workspace.fs.writeFile(configUri, data);
}
