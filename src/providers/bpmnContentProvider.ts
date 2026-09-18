/**
 * Read-only virtual document provider for BPMN XML content.
 *
 * VS Code requires a `TextDocumentContentProvider` on a custom URI scheme to
 * open a document that has no file-system backing and is genuinely read-only
 * (no dirty flag, no "Save As" prompt on close). Using `openTextDocument({
 * content })` instead would produce an "Untitled" tab with a dirty state,
 * which misleads the user into thinking they can save the BPMN back to the
 * server — they cannot, as the API is read-only.
 *
 * Scheme: `reltio-workflow-bpmn`
 * URI shape: `reltio-workflow-bpmn://{environmentName}/{tenantId}/{processType}`
 *
 * The extension registers this provider once in `extension.ts` and calls
 * `BpmnContentProvider.store()` to cache content before opening the document,
 * so VS Code's `provideTextDocumentContent()` callback can return it
 * synchronously (no network call inside the provider).
 */
import * as vscode from 'vscode';

export const BPMN_SCHEME = 'reltio-workflow-bpmn';

export class BpmnContentProvider implements vscode.TextDocumentContentProvider {
	/** Cached XML strings keyed by the URI's string form. */
	private readonly cache = new Map<string, string>();

	readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.onDidChangeEmitter.event;

	/**
	 * Store BPMN XML for a given environment / tenant / processType triple
	 * before calling `vscode.workspace.openTextDocument(uri)`.
	 */
	store(environmentName: string, tenantId: string, processType: string, xml: string): vscode.Uri {
		const uri = vscode.Uri.from({
			scheme: BPMN_SCHEME,
			authority: environmentName,
			path: `/${encodeURIComponent(tenantId)}/${encodeURIComponent(processType)}`,
		});
		this.cache.set(uri.toString(), xml);
		return uri;
	}

	/**
	 * Called by VS Code when it needs the content for a `reltio-workflow-bpmn`
	 * document. Returns the cached XML, or a placeholder if the content was
	 * somehow evicted before the document opened.
	 */
	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.cache.get(uri.toString()) ?? '<!-- BPMN content unavailable — please re-open. -->';
	}
}
