import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { applyAgentSuggestions } from './workbook';
import type { EntityWorkbook } from './workbook';
import { loadEntityWorkbooks, matchLabCsp, matchLabShellHtml } from './panelHtml';
import { readAgentSuggestions } from './sidecar';

export class MatchLabPanelManager {
	private panel: vscode.WebviewPanel | undefined;
	private extensionUri: vscode.Uri | undefined;
	private lastCss = '';
	private selectedEntity: string | undefined;

	async show(options: {
		tenantId: string;
		tenantRoot: string;
		extensionUri: vscode.Uri;
		workbooks?: EntityWorkbook[];
		/** The entity type this run analysed. The panel shows that type and nothing else. */
		selectedEntity?: string;
	}): Promise<void> {
		this.extensionUri = options.extensionUri;
		this.selectedEntity = options.selectedEntity;
		const loaded = options.workbooks
			? await Promise.all(
				options.workbooks.map(async w =>
					applyAgentSuggestions(w, await readAgentSuggestions(options.tenantRoot, w.entityType)),
				),
			)
			: await loadEntityWorkbooks(options.tenantRoot);
		const workbooks = options.selectedEntity
			? loaded.filter(w => w.entityType === options.selectedEntity)
			: loaded;
		const title = options.selectedEntity
			? `Match Lab: ${options.selectedEntity}`
			: `Match Lab: ${options.tenantId}`;
		if (!this.lastCss) {
			this.lastCss = await readWebviewCss(options.extensionUri);
		}
		if (this.panel) {
			this.panel.title = title;
			this.panel.reveal(vscode.ViewColumn.Beside);
			this.panel.webview.html = this.buildHtml(this.panel.webview, workbooks);
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			'reltioMatchLab',
			title,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(options.extensionUri, 'dist')],
			},
		);
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
		this.panel.webview.onDidReceiveMessage(async (msg: { type?: string; url?: string }) => {
			if (msg.type === 'openExternal' && typeof msg.url === 'string') {
				await vscode.env.openExternal(vscode.Uri.parse(msg.url));
			}
		});
		this.panel.webview.html = this.buildHtml(this.panel.webview, workbooks);
	}

	private buildHtml(webview: vscode.Webview, workbooks: EntityWorkbook[]): string {
		const nonce = getNonce();
		const ext = this.extensionUri;
		const scriptSrc = ext
			? webview.asWebviewUri(vscode.Uri.joinPath(ext, 'dist', 'matchLabWebview.js')).toString()
			: '';
		return matchLabShellHtml({
			nonce,
			csp: matchLabCsp(nonce),
			scriptSrc,
			cssText: this.lastCss,
			workbooks,
			selectedEntity: this.selectedEntity,
		});
	}

	dispose(): void {
		this.panel?.dispose();
	}
}

function getNonce(): string {
	let text = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

async function readWebviewCss(extensionUri: vscode.Uri): Promise<string> {
	const cssPath = path.join(extensionUri.fsPath, 'dist', 'matchLabWebview.css');
	try {
		return await fs.readFile(cssPath, 'utf8');
	} catch {
		return '';
	}
}
