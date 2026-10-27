import type { RdmConfiguration } from '../model/types';

/**
 * Minimal skeletons for the two authorable RDM sections, and the label
 * collection behind their default naming.
 *
 * Pure by design — no `vscode` import — so the shapes these produce can be
 * asserted directly, the same way `elementSkeletons` is for L3.
 */

/** Top-level arrays the RDM insert commands may create when absent. */
export const RDM_CREATABLE_ROOT_KEYS: ReadonlySet<string> = new Set(['lookupTypes', 'sources']);

/**
 * `uri` is the identity an L3 `lookupCode` references and the RDM schema
 * requires it, so it is always written rather than left for the user to fill.
 */
export function buildRdmLookupTypeObject(label: string): Record<string, unknown> {
	return {
		uri: `rdm/lookupTypes/${label}`,
		label,
		enabled: true,
		startDate: 0,
		endDate: 0,
	};
}

export function buildRdmSourceObject(label: string): Record<string, unknown> {
	return {
		uri: `rdm/sources/${label}`,
		label,
		abbreviation: label,
		canonicalValueProvider: false,
	};
}

function labelsFrom(section: unknown): string[] {
	if (!Array.isArray(section)) return [];
	const out: string[] = [];
	for (const entry of section) {
		if (!entry || typeof entry !== 'object') continue;
		const label = (entry as Record<string, unknown>).label;
		if (typeof label === 'string' && label) out.push(label);
	}
	return out;
}

/** Existing lookup type labels; tolerant of an absent, empty or malformed section. */
export function labelsFromRdmLookupTypes(model: RdmConfiguration | undefined): string[] {
	return labelsFrom(model?.lookupTypes);
}

/** Existing source labels; tolerant of an absent, empty or malformed section. */
export function labelsFromRdmSources(model: RdmConfiguration | undefined): string[] {
	return labelsFrom(model?.sources);
}
