import { maybeMaskSsn } from './masking';
import { ATTR_FAMILY_ORDER } from './types';
import type { MatchLabAttrMeta } from './types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function ovPrimitive(value: unknown): string | undefined {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return undefined;
}

/** One flattened attribute path. `viaReference` marks values read from a referenced entity. */
export type FlatValueSlot = { uri?: string; values: string[]; viaReference?: boolean };

/** Reltio marks a reference attribute value with the entity and relation it points to. */
function isReferenceValue(rec: Record<string, unknown>): boolean {
	return 'refEntity' in rec || 'refRelation' in rec;
}

function collectOvFromAttrArray(
	items: unknown,
	prefix: string,
	typeUri: string | undefined,
	into: Map<string, FlatValueSlot>,
	viaReference = false,
): void {
	if (!Array.isArray(items)) return;
	for (const item of items) {
		const rec = asRecord(item);
		if (!rec) continue;
		if (rec.ov === false) continue;
		const uri = typeof rec.uri === 'string' ? rec.uri : typeof rec.type === 'string' ? rec.type : typeUri;
		const key = prefix;
		const prim = ovPrimitive(rec.value);
		if (prim !== undefined) {
			const slot = into.get(key) ?? { uri, values: [], ...(viaReference ? { viaReference } : {}) };
			slot.uri = slot.uri ?? uri;
			slot.values.push(prim);
			into.set(key, slot);
			continue;
		}
		const nested = asRecord(rec.value);
		if (nested) {
			const childViaReference = viaReference || isReferenceValue(rec);
			for (const [childName, childVal] of Object.entries(nested)) {
				collectOvFromAttrArray(childVal, prefix ? `${prefix}.${childName}` : childName, undefined, into, childViaReference);
			}
		}
	}
}

export function flattenEntityOvValues(entity: unknown): Map<string, FlatValueSlot> {
	const into = new Map<string, FlatValueSlot>();
	const rec = asRecord(entity);
	const attrs = rec ? asRecord(rec.attributes) : undefined;
	if (!attrs) return into;
	for (const [name, val] of Object.entries(attrs)) {
		collectOvFromAttrArray(val, name, undefined, into);
	}
	return into;
}

/**
 * Columns are keyed by the attribute's own name. A referenced entity's attribute that shares
 * a name with one of this type's attributes (a Contact's linked Organization `Name` next to
 * the Contact's own `Name`) is left out, so it never stands in for the profile's own value.
 */
export function displayValues(
	flat: Map<string, FlatValueSlot>,
	metaByUri: Map<string, MatchLabAttrMeta>,
	metaByName: Map<string, MatchLabAttrMeta>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [path, slot] of flat) {
		const last = path.split('.').pop() ?? path;
		if (slot.viaReference && metaByName.has(last)) continue;
		const meta = (slot.uri ? metaByUri.get(slot.uri) : undefined) ?? metaByName.get(last);
		if (meta?.hidden) continue;
		const joined = slot.values.filter(v => v.length > 0).join(' | ');
		out[last] = maybeMaskSsn(joined, meta?.maskSsn === true);
	}
	return out;
}

export function orderedValueColumns(
	attributes: MatchLabAttrMeta[],
	usedNames: Set<string>,
): { key: string; family: string }[] {
	const visible = attributes.filter(a => !a.hidden && usedNames.has(a.name));
	const seen = new Set<string>();
	const cols: { key: string; family: string }[] = [];
	for (const family of ATTR_FAMILY_ORDER) {
		for (const attr of visible.filter(a => a.family === family)) {
			if (seen.has(attr.name)) continue;
			seen.add(attr.name);
			cols.push({ key: attr.name, family });
		}
	}
	for (const name of [...usedNames].sort()) {
		if (seen.has(name)) continue;
		seen.add(name);
		cols.push({ key: name, family: 'other' });
	}
	return cols;
}

export function cmpValues(a: string | undefined, b: string | undefined): string {
	const av = (a ?? '').trim();
	const bv = (b ?? '').trim();
	if (!av && !bv) return '';
	if (!av) return 'B only';
	if (!bv) return 'A only';
	if (av.toLowerCase() === bv.toLowerCase()) return 'equal';
	return 'differ';
}

export function entityLabel(entity: unknown, fallbackUri: string): string {
	if (entity && typeof entity === 'object') {
		const label = (entity as { label?: unknown }).label;
		if (typeof label === 'string' && label.trim()) return label.trim();
	}
	return fallbackUri;
}
