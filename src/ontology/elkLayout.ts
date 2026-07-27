import ELK from 'elkjs/lib/elk.bundled.js';
import type { GraphModel } from './modelToGraph';

const elk = new ELK();

export async function computeLayout(graph: GraphModel): Promise<GraphModel> {
	const elkGraph = {
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'DOWN',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.spacing.nodeNode': '60',
			'elk.layered.spacing.nodeNodeBetweenLayers': '80',
			'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
		},
		children: graph.nodes.map(n => ({
			id: n.id,
			width: n.width,
			height: n.height,
		})),
		edges: graph.edges.map(e => ({
			id: e.id,
			sources: [e.source],
			targets: [e.target],
			layoutOptions: {
				'elk.layered.priority.direction': e.type === 'connection' ? '2' : '1',
			},
		})),
	};

	const laid = await elk.layout(elkGraph);

	const posMap = new Map<string, { x: number; y: number }>();
	for (const child of laid.children ?? []) {
		posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
	}

	const nodes = graph.nodes.map(n => {
		const pos = posMap.get(n.id);
		return pos ? { ...n, x: pos.x, y: pos.y } : n;
	});

	return { nodes, edges: graph.edges };
}
