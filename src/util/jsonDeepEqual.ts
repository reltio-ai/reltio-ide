/**
 * Deep equality for values produced by JSON.parse (objects, arrays, primitives, null).
 */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (a === null || b === null || typeof a !== typeof b) {
		return false;
	}
	if (typeof a !== 'object') {
		return false;
	}
	if (Array.isArray(a) !== Array.isArray(b)) {
		return false;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0; i < a.length; i++) {
			if (!jsonDeepEqual(a[i], b[i])) {
				return false;
			}
		}
		return true;
	}
	const ao = a as Record<string, unknown>;
	const bo = b as Record<string, unknown>;
	const keys = Object.keys(ao);
	if (Object.keys(bo).length !== keys.length) {
		return false;
	}
	for (const k of keys) {
		if (!Object.prototype.hasOwnProperty.call(bo, k)) {
			return false;
		}
		if (!jsonDeepEqual(ao[k], bo[k])) {
			return false;
		}
	}
	return true;
}
