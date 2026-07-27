import * as vscode from 'vscode';
import type { GraphModel } from './modelToGraph';

export type PositionMap = Record<string, { x: number; y: number }>;

interface LayoutFile {
	version: number;
	positions: PositionMap;
}

function layoutUri(configUri: vscode.Uri): vscode.Uri {
	const path = configUri.fsPath.replace(/\.reltio\.json$/, '.reltio.layout.json');
	return vscode.Uri.file(path);
}

export async function loadLayout(configUri: vscode.Uri): Promise<PositionMap | undefined> {
	try {
		const uri = layoutUri(configUri);
		const data = await vscode.workspace.fs.readFile(uri);
		const parsed: LayoutFile = JSON.parse(Buffer.from(data).toString('utf-8'));
		if (parsed.version !== 1 || !parsed.positions) return undefined;
		return parsed.positions;
	} catch {
		return undefined;
	}
}

export async function saveLayout(configUri: vscode.Uri, positions: PositionMap): Promise<void> {
	const uri = layoutUri(configUri);
	const content: LayoutFile = { version: 1, positions };
	const data = Buffer.from(JSON.stringify(content, null, 2), 'utf-8');
	await vscode.workspace.fs.writeFile(uri, data);
}

export function applyLayout(
	graph: GraphModel,
	positions: PositionMap,
): { applied: boolean; graph: GraphModel } {
	const allPresent = graph.nodes.every(n => positions[n.id] !== undefined);
	if (!allPresent) return { applied: false, graph };

	const nodes = graph.nodes.map(n => {
		const pos = positions[n.id];
		return { ...n, x: pos.x, y: pos.y };
	});
	return { applied: true, graph: { nodes, edges: graph.edges } };
}
