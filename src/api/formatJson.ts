/**
 * Pretty-print JSON text for writing to disk.
 * Uses `JSON.parse` + `JSON.stringify` so large payloads stay fast (unlike
 * `jsonc-parser` `format`, which can take seconds on ~1MB documents).
 * Object key order and array element order follow the parsed document (V8
 * preserves `JSON.parse` key order for ordinary objects; `JSON.stringify`
 * emits keys in that order).
 * On failure, returns the input unchanged.
 */
export function prettyPrintJsonIfPossible(raw: string): string {
	const text = raw.replace(/^\uFEFF/, '').trimEnd();
	if (!text.trim()) return raw;
	try {
		const parsed = JSON.parse(text);
		return `${JSON.stringify(parsed, null, 2)}\n`;
	} catch {
		return raw;
	}
}
