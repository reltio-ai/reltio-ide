import { applyEdits, modify, type JSONPath } from 'jsonc-parser';

const COLLECTIONS = ['entityTypes', 'relationTypes', 'changeRequestTypes'];

/** JSON path of the `lifecycleActions` object for a type URI. */
export function findTypeJsonPath(model: Record<string, unknown>, typeUri: string): JSONPath | undefined {
	for (const key of COLLECTIONS) {
		const items = model[key];
		if (!Array.isArray(items)) continue;
		const index = items.findIndex(item => item && typeof item === 'object' && (item as { uri?: string }).uri === typeUri);
		if (index >= 0) return [key, index, 'lifecycleActions'];
	}
	return undefined;
}

/** Replace one type's lifecycleActions and preserve the rest of the document. */
export function replaceLifecycleActions(text: string, jsonPath: JSONPath, proposed: Record<string, unknown>): string {
	const edits = modify(text, jsonPath, proposed, {
		formattingOptions: { insertSpaces: true, tabSize: 2 },
	});
	return applyEdits(text, edits);
}
