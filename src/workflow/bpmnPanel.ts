/**
 * Read-only BPMN diagram preview, one panel per document URI.
 *
 * Modelled on `src/ontology/ontologyPanel.ts` — same CSP-nonce HTML, same
 * `localResourceRoots` restriction, same debounced refresh on document change,
 * same panel reuse by document key. Divergences from it are noted where they
 * occur; everything unremarked is deliberately identical, because two webview
 * hosts that differ for no reason are two things to audit instead of one.
 *
 * Read-only by design. Editing happens in the XML, which is where the Reltio
 * rules in `bpmn-rules.md` are expressed and where an agent can work; a
 * drag-and-drop modeller would be a second, weaker authoring surface with its
 * own persistence problem. The one interaction offered is clicking a shape to
 * jump to the element in the editor.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { extractProcessModel, hasDiagramSection, type BpmnProcessModel } from './bpmnModel';
import {
	isCompleteFor,
	readDiagramLayout,
	type Bounds,
	type DiagramLayout,
	type Point,
} from './bpmnDiagram';
import { layoutProcess } from './bpmnLayout';
import { flowLabelText, nodeDetailText, nodeLabelText } from './bpmnLabels';
import { findXmlProblem } from './bpmnWellFormed';

const DEBOUNCE_MS = 500;

/** One shape, flattened for the webview. */
interface DiagramViewNode extends Bounds {
	readonly id: string;
	readonly label: string;
	readonly shape: 'event' | 'gateway' | 'task';
	readonly tag: string;
	/** Rendered under the label — a user task's role or a service task's delegate. */
	readonly detail: string | undefined;
	/** Character offset of the element, for click-to-reveal. */
	readonly offset: number;
}

/** One connector, flattened for the webview. */
interface DiagramViewEdge {
	readonly id: string;
	readonly label: string | undefined;
	readonly points: readonly Point[];
}

/**
 * The whole payload. Plain arrays, not the `Map`s `DiagramLayout` uses, because
 * `postMessage` serialises structurally and a `Map` arrives as `{}`.
 */
interface DiagramView {
	readonly processId: string;
	readonly processName: string | undefined;
	readonly nodes: readonly DiagramViewNode[];
	readonly edges: readonly DiagramViewEdge[];
	/** True when positions came from the file rather than being computed. */
	readonly fromDiagramSection: boolean;
}

export class BpmnPanelManager {
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
			'reltioBpmnDiagram',
			`Diagram: ${fileName(document.uri)}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
			},
		);

		this.panels.set(key, panel);

		const subs: vscode.Disposable[] = [];
		let latest: DiagramPayload | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		// Registered before the first await. Layout can throw, and a panel that is in `panels` with no
		// dispose handler can never be removed: the next Show BPMN Diagram would `reveal()` a dead entry.
		subs.push(
			panel.onDidDispose(() => {
				if (timer) clearTimeout(timer);
				this.panels.delete(key);
				for (const d of this.disposables.get(key) ?? []) d.dispose();
				this.disposables.delete(key);
			}),
		);
		this.disposables.set(key, subs);

		const nonce = getNonce();
		const scriptUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'bpmnView.js'),
		);
		const styleUri = panel.webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'bpmnView.css'),
		);
		panel.webview.html = getHtml(panel.webview, scriptUri, styleUri, nonce);

		try {
			latest = await buildDiagramPayload(document.getText());
			postDiagram(panel, latest);
		} catch (e) {
			void vscode.window.showErrorMessage(`Could not draw the diagram: ${(e as Error).message}`);
			panel.dispose();
			return;
		}

		subs.push(
			panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
				// One message type, one direction of trust: the webview may ask to
				// reveal an offset, and nothing else.
				if (msg.type === 'revealOffset' && typeof msg.offset === 'number') {
					await revealOffset(document, msg.offset);
				}
				// The first post can beat the webview's script; re-send once it says it is listening.
				if (msg.type === 'ready' && latest) postDiagram(panel, latest);
			}),
		);

		subs.push(
			vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document.uri.toString() !== key) return;
				if (timer) clearTimeout(timer);
				timer = setTimeout(async () => {
					let view: DiagramPayload;
					try {
						view = await buildDiagramPayload(e.document.getText());
					} catch (err) {
						// A half-typed edit can be unlayoutable; show the "nothing to draw" state, not a stale or dead panel.
						console.error('Reltio BPMN diagram update failed:', err);
						view = { diagram: undefined, message: undefined };
					}
					latest = view;
					// Re-check: the panel can be disposed while the layout is awaited.
					if (this.panels.has(key)) postDiagram(panel, view);
				}, DEBOUNCE_MS);
			}),
		);
	}

	dispose(): void {
		for (const [, panel] of this.panels) panel.dispose();
	}
}

/**
 * Turn document text into something drawable.
 *
 * Positions come from the file when it carries a complete diagram section, and
 * are computed otherwise. That ordering is the whole reason this preview can be
 * trusted: a deployed definition is shown as its author arranged it, while a
 * definition authored before diagram interchange was written into drafts still
 * renders instead of appearing empty.
 */
/** What the webview is sent: a drawing, or the reason there is none. */
interface DiagramPayload {
	readonly diagram: DiagramView | undefined;
	readonly message: string | undefined;
}

/**
 * A broken file is told apart from an empty one. `extractProcessModel` believes the document is
 * well-formed and returns a thin model for a broken one, so without this check "cannot be drawn"
 * and "is malformed" look the same: a blank canvas.
 */
async function buildDiagramPayload(text: string): Promise<DiagramPayload> {
	const problem = findXmlProblem(text);
	if (problem) {
		return {
			diagram: undefined,
			message: `This BPMN is not valid XML, so it cannot be drawn. Line ${problem.line}: ${problem.message} Fix the XML and the diagram will update.`,
		};
	}
	return { diagram: await buildDiagramView(text), message: undefined };
}

async function buildDiagramView(text: string): Promise<DiagramView | undefined> {
	const model = extractProcessModel(text);
	if (!model.processId || model.nodes.length === 0) return undefined;

	const existing = hasDiagramSection(text) ? readDiagramLayout(text) : undefined;
	const useExisting = existing !== undefined && isCompleteFor(existing, model);
	const layout: DiagramLayout = useExisting
		? (existing as DiagramLayout)
		: await layoutProcess(model);

	return {
		processId: model.processId,
		processName: model.processName,
		nodes: viewNodes(model, layout),
		edges: viewEdges(model, layout),
		fromDiagramSection: useExisting,
	};
}

function viewNodes(model: BpmnProcessModel, layout: DiagramLayout): DiagramViewNode[] {
	const nodes: DiagramViewNode[] = [];
	for (const node of model.nodes) {
		const bounds = layout.bounds.get(node.id);
		if (!bounds) continue;
		nodes.push({
			...bounds,
			id: node.id,
			// Both strings come from `bpmnLabels`, which is also what the layout
			// measured to reserve room for them. Deriving them a second time here
			// is how a caption ends up wider than the space set aside for it.
			label: nodeLabelText(node),
			shape: node.shape,
			tag: node.tag,
			detail: nodeDetailText(node),
			offset: node.offset,
		});
	}
	return nodes;
}

function viewEdges(model: BpmnProcessModel, layout: DiagramLayout): DiagramViewEdge[] {
	const edges: DiagramViewEdge[] = [];
	for (const flow of model.flows) {
		if (!flow.id) continue;
		const points = layout.waypoints.get(flow.id);
		if (!points || points.length < 2) continue;
		edges.push({ id: flow.id, label: flowLabelText(flow), points });
	}
	return edges;
}

interface WebviewMessage {
	readonly type: string;
	readonly offset?: number;
}

/**
 * Move the cursor to an element's position in the XML.
 *
 * The offset is clamped: it arrives from the webview, and the document may have
 * been edited between the diagram being posted and the click arriving, so an
 * offset past the end is expected rather than exceptional.
 */
async function revealOffset(document: vscode.TextDocument, offset: number): Promise<void> {
	const clamped = Math.max(0, Math.min(Math.trunc(offset), document.getText().length));
	const position = document.positionAt(clamped);
	const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function fileName(uri: vscode.Uri): string {
	return uri.path.split('/').pop() ?? uri.path;
}

/** Same CSPRNG pattern as `ontologyPanel.ts` and the OAuth `state` parameter. */
function getNonce(): string {
	return crypto.randomBytes(16).toString('hex');
}

function postDiagram(panel: vscode.WebviewPanel, payload: DiagramPayload): void {
	void panel.webview.postMessage({
		type: 'setDiagram',
		diagram: payload.diagram ?? null,
		message: payload.message,
	});
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
	<title>BPMN Diagram</title>
</head>
<body>
	<div id="diagram-header">
		<span id="diagram-header-name"></span>
		<span id="diagram-header-id"></span>
	</div>
	<div id="diagram-root"></div>
	<div id="diagram-status" hidden></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
