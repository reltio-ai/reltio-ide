/**
 * Resolve tenant ID from a tree context-menu argument or TreeItem duck type
 * (VS Code may not preserve `instanceof` on custom node classes).
 */
export function tenantIdFromTreeContext(node: unknown): string | undefined {
	if (!node || typeof node !== 'object') return undefined;
	if ('tenantId' in node && typeof (node as { tenantId: unknown }).tenantId === 'string') {
		const tid = (node as { tenantId: string }).tenantId;
		return tid.length > 0 ? tid : undefined;
	}
	const item = node as {
		id?: unknown;
		label?: unknown;
		contextValue?: unknown;
	};
	if (typeof item.id === 'string' && item.id.startsWith('tenant:')) {
		const slash = item.id.indexOf('/');
		if (slash >= 0) {
			const tid = item.id.slice(slash + 1);
			return tid.length > 0 ? tid : undefined;
		}
	}
	if (typeof item.contextValue === 'string' && /^reltio\.tenant/.test(item.contextValue)) {
		const label = item.label;
		if (typeof label === 'string' && label.length > 0) return label;
		if (label && typeof label === 'object' && 'label' in label) {
			const text = (label as { label?: string }).label;
			if (typeof text === 'string' && text.length > 0) return text;
		}
	}
	return undefined;
}
