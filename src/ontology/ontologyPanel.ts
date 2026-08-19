import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { parseDocument } from '../parser/configParser';
import { buildGraphModel, type GraphModel } from './modelToGraph';
import { computeLayout } from './elkLayout';
import { loadLayout, saveLayout, applyLayout, type PositionMap } from './layoutPersistence';
import { UriIndex } from '../navigation/uriIndex';
import type { ReltioBusinessModel } from '../model/types';

const DEBOUNCE_MS = 500;

export class OntologyPanelManager {
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	private readonly disposables = new Map<string, vscode.Disposable[]>();

	async showPreview(document: vscode.TextDocument, extensionUri: vscode.Uri): Promise<void> {
		const key = document.uri.toString();
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal();
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'reltioOntology',
			`Ontology: ${fileName(document.uri)}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
			},
		);

		this.panels.set(key, panel);

		const nonce = getNonce();
		const scriptUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'),
		);
		const styleUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'),
		);
		panel.webview.html = getHtml(panel.webview, scriptUri, styleUri, nonce);

		const graph = await this.buildAndLayout(document);
		postGraph(panel, graph);

		const subs: vscode.Disposable[] = [];

		subs.push(
			panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
				if (msg.type === 'savePositions') {
					await saveLayout(document.uri, msg.positions);
				} else if (msg.type === 'requestResetLayout') {
					const baseGraph = this.buildGraph(document);
					const laid = await computeLayout(baseGraph);
					postGraph(panel, laid);
					const positions: PositionMap = {};
					for (const n of laid.nodes) positions[n.id] = { x: n.x, y: n.y };
					await saveLayout(document.uri, positions);
				} else if (msg.type === 'revealInEditor' && msg.nodeId) {
					await revealEntityInEditor(document, msg.nodeId);
				} else if (msg.type === 'revealInTreeView' && msg.nodeId) {
					await vscode.commands.executeCommand('reltio.revealInTreeView', msg.nodeId);
				} else if (msg.type === 'revealUriInEditor' && msg.uri) {
					await revealUriInEditor(document, msg.uri);
				}
			}),
		);

		let timer: ReturnType<typeof setTimeout> | undefined;
		subs.push(
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document.uri.toString() === document.uri.toString()) {
					if (timer) clearTimeout(timer);
					timer = setTimeout(async () => {
						const g = await this.buildAndLayout(e.document);
						if (this.panels.has(key)) {
							postGraph(panel, g);
						}
					}, DEBOUNCE_MS);
				}
			}),
		);

		subs.push(
			panel.onDidDispose(() => {
				this.panels.delete(key);
				for (const d of this.disposables.get(key) ?? []) d.dispose();
				this.disposables.delete(key);
			}),
		);

		this.disposables.set(key, subs);
	}

	private buildGraph(document: vscode.TextDocument): GraphModel {
		const { model } = parseDocument(document.getText());
		return buildGraphModel(model);
	}

	private async buildAndLayout(document: vscode.TextDocument): Promise<GraphModel> {
		const graph = this.buildGraph(document);
		const saved = await loadLayout(document.uri);
		if (saved) {
			const { applied, graph: restored } = applyLayout(graph, saved);
			if (applied) return restored;
		}
		return computeLayout(graph);
	}

	dispose(): void {
		for (const [, panel] of this.panels) panel.dispose();
	}
}

interface WebviewMessage {
	type: string;
	positions: PositionMap;
	nodeId: string;
	uri: string;
}

function buildIndex(document: vscode.TextDocument): { model: ReltioBusinessModel; index: UriIndex } {
	const { model, ast } = parseDocument(document.getText());
	const index = new UriIndex();
	index.build(model, ast);
	return { model, index };
}

async function navigateToNode(document: vscode.TextDocument, node: { offset: number }): Promise<void> {
	const pos = document.positionAt(node.offset);
	const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
	editor.selection = new vscode.Selection(pos, pos);
	editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

async function revealUriInEditor(document: vscode.TextDocument, uri: string): Promise<void> {
	const { index } = buildIndex(document);
	const node = index.getDefinitionNode(uri);
	if (node) await navigateToNode(document, node);
}

async function revealEntityInEditor(document: vscode.TextDocument, nodeId: string): Promise<void> {
	const { model, index } = buildIndex(document);
	const fullUri = findFullUri(model, nodeId);
	if (!fullUri) return;
	const node = index.getDefinitionNode(fullUri);
	if (node) await navigateToNode(document, node);
}

function findFullUri(model: ReltioBusinessModel, shortName: string): string | undefined {
	for (const et of model.entityTypes ?? []) {
		if (et.uri?.split('/').pop() === shortName) return et.uri;
	}
	for (const rt of model.relationTypes ?? []) {
		if (rt.uri?.split('/').pop() === shortName) return rt.uri;
	}
	return undefined;
}

function fileName(uri: vscode.Uri): string {
	const parts = uri.fsPath.split('/');
	return parts[parts.length - 1];
}

/** Same CSPRNG pattern as the OAuth `state` parameter in `src/api/oauthLogin.ts`. */
function getNonce(): string {
	return crypto.randomBytes(16).toString('hex');
}

function postGraph(panel: vscode.WebviewPanel, graph: GraphModel): void {
	panel.webview.postMessage({ type: 'setGraph', graph });
}

function getHtml(
	webview: vscode.Webview,
	scriptUri: vscode.Uri,
	styleUri: vscode.Uri,
	nonce: string,
): string {
	const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};`;
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>Ontology Preview</title>
</head>
<body>
	<div id="canvas-root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
