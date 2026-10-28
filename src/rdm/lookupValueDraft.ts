/**
 * Pure logic behind Add Value on the lookup values panel: validating what the
 * panel submits, building the create request body, and comparing submitted
 * codes against what the service reports. No `vscode` import, so the test
 * harness exercises it directly.
 */

/** Documented per-request maximum of `POST {serviceUri}/lookups/{rdmTenantId}`. */
export const MAX_LOOKUP_VALUES_PER_REQUEST = 100;

export interface LookupValueMappingDraft {
	source: string;
	/** Code at the source; blank means "same as the value's code". */
	code: string;
	value: string;
	canonicalValue: boolean;
	downStreamDefaultValue: boolean;
}

export interface LookupValueDraft {
	code: string;
	mappings: LookupValueMappingDraft[];
}

/** Identifiers the extension recorded when it rendered the panel — never taken from a message. */
export interface LookupValueTarget {
	rdmTenantId: string;
	lookupTypeName: string;
	/** The lookup type's own `uri` from the RDM configuration, e.g. `rdm/lookupTypes/AddressTypes`. */
	lookupTypeUri: string;
}

export type ParsedLookupValuesMessage =
	| { kind: 'ready'; render: string }
	| { kind: 'submit'; render: string; values: LookupValueDraft[] }
	| { kind: 'rejected'; render: string; errors: string[] };

/**
 * Parse one message from the panel.
 *
 * Returns `undefined` for anything that is not a well-formed panel message —
 * unknown `type`, missing fields, fields of the wrong type — which the caller
 * ignores. A well-formed submission that breaks a content rule comes back as
 * `rejected` with every error, so the panel can show them all at once.
 *
 * Only known fields are copied out. A field naming a tenant or lookup type is
 * dropped here and can never reach the request.
 */
export function parseLookupValuesMessage(message: unknown): ParsedLookupValuesMessage | undefined {
	if (!isRecord(message) || typeof message.render !== 'string') {
		return undefined;
	}
	const render = message.render;
	if (message.type === 'ready') {
		return { kind: 'ready', render };
	}
	if (message.type !== 'submitLookupValues' || !Array.isArray(message.values)) {
		return undefined;
	}

	const values: LookupValueDraft[] = [];
	for (const raw of message.values) {
		if (!isRecord(raw) || typeof raw.code !== 'string' || !Array.isArray(raw.mappings)) {
			return undefined;
		}
		const mappings: LookupValueMappingDraft[] = [];
		for (const m of raw.mappings) {
			if (
				!isRecord(m) ||
				typeof m.source !== 'string' ||
				typeof m.code !== 'string' ||
				typeof m.value !== 'string' ||
				typeof m.canonicalValue !== 'boolean' ||
				typeof m.downStreamDefaultValue !== 'boolean'
			) {
				return undefined;
			}
			mappings.push({
				source: m.source.trim(),
				code: m.code.trim(),
				value: m.value.trim(),
				canonicalValue: m.canonicalValue,
				downStreamDefaultValue: m.downStreamDefaultValue,
			});
		}
		values.push({ code: raw.code.trim(), mappings });
	}

	const errors = validateLookupValues(values);
	return errors.length > 0 ? { kind: 'rejected', render, errors } : { kind: 'submit', render, values };
}

/**
 * Content rules for a batch. Each error names its block by position and code,
 * so a long form can be fixed without hunting.
 *
 * How many mappings are canonical is deliberately not checked: the RDM
 * service owns that rule.
 */
export function validateLookupValues(values: LookupValueDraft[]): string[] {
	if (values.length === 0) {
		return ['Add at least one code.'];
	}
	const errors: string[] = [];
	if (values.length > MAX_LOOKUP_VALUES_PER_REQUEST) {
		errors.push(
			`At most ${MAX_LOOKUP_VALUES_PER_REQUEST} codes can be added at once; this form has ${values.length}.`,
		);
	}
	const firstBlockByCode = new Map<string, number>();

	values.forEach((v, i) => {
		const label = blockLabel(i, v.code);
		if (!v.code) {
			errors.push(`${label}: enter a code.`);
		} else if (v.code.includes('/')) {
			// The code becomes the last segment of the value's `uri`.
			errors.push(`${label}: a code cannot contain "/".`);
		} else if (firstBlockByCode.has(v.code)) {
			errors.push(`${label}: the same code is already in code ${firstBlockByCode.get(v.code)! + 1}.`);
		} else {
			firstBlockByCode.set(v.code, i);
		}

		if (v.mappings.length === 0) {
			errors.push(`${label}: add at least one source mapping.`);
		}
		const firstMappingBySource = new Map<string, number>();
		v.mappings.forEach((m, k) => {
			if (!m.source) {
				errors.push(`${label}: mapping ${k + 1} has no source.`);
			} else if (firstMappingBySource.has(m.source)) {
				errors.push(
					`${label}: source "${m.source}" is in mappings ${firstMappingBySource.get(m.source)! + 1} and ${k + 1}.`,
				);
			} else {
				firstMappingBySource.set(m.source, k);
			}
			if (!m.value) {
				errors.push(`${label}: mapping ${k + 1} has no value.`);
			}
		});
	});
	return errors;
}

/**
 * The body of `POST {serviceUri}/lookups/{rdmTenantId}`: one plain lookup
 * object per code, in form order — not the `{ uri, value }` wrapper, which is
 * what the service returns.
 *
 * `updatedBy`, `updateDate` and `version` are left out. They describe a prior
 * revision, which a new value does not have, and the server owns them.
 */
export function buildLookupValuesCreateBody(values: LookupValueDraft[], target: LookupValueTarget): unknown[] {
	return values.map(v => ({
		tenantId: target.rdmTenantId,
		type: target.lookupTypeUri,
		code: v.code,
		enabled: true,
		sourceMappings: v.mappings.map(m => ({
			source: m.source,
			values: [
				{
					code: m.code || v.code,
					value: m.value,
					enabled: true,
					canonicalValue: m.canonicalValue,
					downStreamDefaultValue: m.downStreamDefaultValue,
				},
			],
		})),
		// 0 is how stored values report "no bound"; the team's working request sends it too.
		startDate: 0,
		endDate: 0,
	}));
}

/**
 * Lookup value objects in a response: a lookups `GET` returns them bare; the
 * create response wraps each as `{ uri, value }`. Anything else contributes
 * nothing.
 */
function lookupEntries(response: unknown): Array<Record<string, unknown> & { code: string }> {
	const out: Array<Record<string, unknown> & { code: string }> = [];
	if (Array.isArray(response)) {
		for (const entry of response) {
			if (!isRecord(entry)) continue;
			const value = isRecord(entry.value) ? entry.value : entry;
			if (typeof value.code === 'string') out.push(value as Record<string, unknown> & { code: string });
		}
	}
	return out;
}

/** Codes the create response says were stored. */
export function codesInCreateResponse(response: unknown): Set<string> {
	return new Set(lookupEntries(response).map(e => e.code));
}

/** Codes present in a `GET …/lookups/{rdmTenantId}/{lookupTypeName}` response. */
export function codesInLookupsResponse(response: unknown): Set<string> {
	return new Set(lookupEntries(response).map(e => e.code));
}

/**
 * Submitted codes the server already holds. Exact match: whether codes are
 * case-sensitive is the RDM service's decision, not the IDE's.
 */
export function findExistingCodes(codes: string[], response: unknown): string[] {
	const present = codesInLookupsResponse(response);
	return codes.filter(c => present.has(c));
}

/** A source mapping value, by the two keys RDM stores it under. */
export interface MappingKey {
	source: string;
	code: string;
}

/** Where a note about one row of a submission points: its code and the mapping's position. */
export interface MappingNote extends MappingKey {
	valueCode: string;
	index: number;
}

export interface PlannedValue {
	draft: LookupValueDraft;
	/** `new`: created. `append`: an existing code with mappings to add. `unchanged`: nothing to send. */
	kind: 'new' | 'append' | 'unchanged';
	/** The object to post: the create body for a new code, the merged stored value for an append. */
	element?: Record<string, unknown>;
	/** The mappings the post must store: all of a new code's, the appended ones of an existing code. */
	expect: MappingKey[];
}

export interface LookupValuesPlan {
	/** In submission order. */
	items: PlannedValue[];
	alreadyPresent: MappingNote[];
	/** Same source and code at the source, a different value: the stored value is kept. */
	conflicts: Array<MappingNote & { storedValue: string; value: string }>;
	/** A flag the submission asked for but the stored value already gives to another mapping. */
	flagsDropped: Array<MappingNote & { flag: 'canonical' | 'downstream default' }>;
}

/**
 * Appends a submitted value's mappings to the stored value of the same code.
 *
 * The create endpoint replaces a code's whole value, so appending is a merge:
 * the result is the stored value with **every field kept as fetched** — its
 * other mappings, flags, dates, `version` — plus the mappings it lacks.
 * Nothing stored is changed or removed:
 *
 * - same source and code at the source, same value: already present;
 * - same source and code at the source, other value: a conflict, left alone;
 * - an appended value is canonical only when the code has no canonical value,
 *   and downstream default only when its source has none.
 */
export function mergeLookupValue(
	stored: Record<string, unknown>,
	draft: LookupValueDraft,
): Pick<LookupValuesPlan, 'alreadyPresent' | 'conflicts' | 'flagsDropped'> & {
	merged: Record<string, unknown> | undefined;
	appended: MappingKey[];
} {
	const merged = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
	if (!Array.isArray(merged.sourceMappings)) merged.sourceMappings = [];
	const sourceMappings = merged.sourceMappings as unknown[];
	const valuesOf = (sm: Record<string, unknown>): Array<Record<string, unknown>> => {
		if (!Array.isArray(sm.values)) sm.values = [];
		return (sm.values as unknown[]).filter(isRecord);
	};
	let hasCanonical = sourceMappings.some(sm => isRecord(sm) && valuesOf(sm).some(v => v.canonicalValue === true));

	const appended: MappingKey[] = [];
	const result: Pick<LookupValuesPlan, 'alreadyPresent' | 'conflicts' | 'flagsDropped'> = {
		alreadyPresent: [],
		conflicts: [],
		flagsDropped: [],
	};

	draft.mappings.forEach((m, index) => {
		const code = m.code || draft.code;
		const note: MappingNote = { valueCode: draft.code, index, source: m.source, code };
		let target = sourceMappings.find(sm => isRecord(sm) && sm.source === m.source) as Record<string, unknown> | undefined;
		if (target) {
			const storedValue = valuesOf(target).find(v => v.code === code);
			if (storedValue) {
				if (storedValue.value === m.value) result.alreadyPresent.push(note);
				else result.conflicts.push({ ...note, storedValue: String(storedValue.value ?? ''), value: m.value });
				return;
			}
		}

		const canonical = m.canonicalValue && !hasCanonical;
		if (m.canonicalValue && !canonical) result.flagsDropped.push({ ...note, flag: 'canonical' });
		const sourceHasDownstream = !!target && valuesOf(target).some(v => v.downStreamDefaultValue === true);
		const downstream = m.downStreamDefaultValue && !sourceHasDownstream;
		if (m.downStreamDefaultValue && !downstream) result.flagsDropped.push({ ...note, flag: 'downstream default' });

		const value = { code, value: m.value, enabled: true, canonicalValue: canonical, downStreamDefaultValue: downstream };
		if (target) {
			(target.values as unknown[]).push(value);
		} else {
			target = { source: m.source, values: [value] };
			sourceMappings.push(target);
		}
		if (canonical) hasCanonical = true;
		appended.push({ source: m.source, code });
	});

	return { merged: appended.length > 0 ? merged : undefined, appended, ...result };
}

/**
 * What a submission does against the lookup type as just fetched: new codes
 * are created; existing codes get their missing mappings appended
 * (`mergeLookupValue`); codes with nothing to append are left alone.
 */
export function planLookupValues(values: LookupValueDraft[], current: unknown, target: LookupValueTarget): LookupValuesPlan {
	const storedByCode = new Map(lookupEntries(current).map(e => [e.code, e]));
	const plan: LookupValuesPlan = { items: [], alreadyPresent: [], conflicts: [], flagsDropped: [] };
	for (const draft of values) {
		const stored = storedByCode.get(draft.code);
		if (!stored) {
			plan.items.push({
				draft,
				kind: 'new',
				element: buildLookupValuesCreateBody([draft], target)[0] as Record<string, unknown>,
				expect: draft.mappings.map(m => ({ source: m.source, code: m.code || draft.code })),
			});
			continue;
		}
		const merge = mergeLookupValue(stored, draft);
		plan.alreadyPresent.push(...merge.alreadyPresent);
		plan.conflicts.push(...merge.conflicts);
		plan.flagsDropped.push(...merge.flagsDropped);
		plan.items.push(
			merge.merged
				? { draft, kind: 'append', element: merge.merged, expect: merge.appended }
				: { draft, kind: 'unchanged', expect: [] },
		);
	}
	return plan;
}

/** Requested mappings of one code, as judged after a post. */
export interface StoredExpectation {
	code: string;
	mappings: MappingKey[];
}

/**
 * Codes that some response holds with **every** requested mapping, matched by
 * source and code at the source. One rule for new and appended codes, and for
 * the create response and a re-fetch alike — so a re-fetch that lags the
 * write cannot report a stored code as missing.
 */
export function storedCodes(responses: unknown[], expectations: StoredExpectation[]): Set<string> {
	const stored = new Set<string>();
	for (const response of responses) {
		const byCode = new Map(lookupEntries(response).map(e => [e.code, e]));
		for (const x of expectations) {
			const entry = byCode.get(x.code);
			if (entry && x.mappings.every(k => holdsMapping(entry, k))) stored.add(x.code);
		}
	}
	return stored;
}

function holdsMapping(entry: Record<string, unknown>, key: MappingKey): boolean {
	const mappings = Array.isArray(entry.sourceMappings) ? entry.sourceMappings : [];
	return mappings.some(
		sm =>
			isRecord(sm) &&
			sm.source === key.source &&
			Array.isArray(sm.values) &&
			sm.values.some(v => isRecord(v) && v.code === key.code),
	);
}

/** Why a submission was refused: each conflict, with both values. Nothing stored is ever changed. */
export function describeConflicts(conflicts: LookupValuesPlan['conflicts']): string {
	const each = conflicts.map(
		c => `${c.valueCode}: ${c.source} code "${c.code}" is stored as "${c.storedValue}", not "${c.value}"`,
	);
	return `Nothing was sent. ${each.join('; ')}. Stored values are never changed; correct the value or remove the mapping.`;
}

/** One sentence per flag the stored value kept. */
export function describeFlagsDropped(flags: LookupValuesPlan['flagsDropped']): string {
	return flags
		.map(f =>
			f.flag === 'canonical'
				? `${f.source} on ${f.valueCode} was added as non-canonical: ${f.valueCode} already has a canonical value.`
				: `${f.source} on ${f.valueCode} was added without downstream default: ${f.source} already has one for ${f.valueCode}.`,
		)
		.join(' ');
}

/**
 * What the panel shows once the outcome is known: the blocks to restore
 * (those whose requested mappings are not all stored, as entered) and one
 * message. `postError` is the post's failure detail, if it failed.
 */
export function describeSubmissionOutcome(
	plan: LookupValuesPlan,
	refetched: unknown,
	postError: string | undefined,
	createResponse?: unknown,
): { landed: string[]; remaining: LookupValueDraft[]; message: string } {
	const sent = plan.items.filter(i => i.kind !== 'unchanged');
	const expectations = sent.map(i => ({ code: i.draft.code, mappings: i.expect }));
	const visible = storedCodes([refetched], expectations);
	const stored = storedCodes([refetched, createResponse], expectations);
	const codes = (pick: (i: PlannedValue) => boolean) => sent.filter(pick).map(i => i.draft.code);

	const added = codes(i => i.kind === 'new' && stored.has(i.draft.code));
	const appendedTo = codes(i => i.kind === 'append' && stored.has(i.draft.code));
	const notStored = codes(i => !stored.has(i.draft.code));
	const lagging = codes(i => stored.has(i.draft.code) && !visible.has(i.draft.code));
	const unchanged = plan.items.filter(i => i.kind === 'unchanged').map(i => i.draft.code);

	const parts: string[] = [];
	if (added.length > 0) parts.push(`Added ${plural(added.length, 'new value')} (${added.join(', ')}).`);
	if (appendedTo.length > 0) parts.push(`Added mappings to ${appendedTo.join(', ')}.`);
	if (added.length === 0 && appendedTo.length === 0) parts.push('Nothing was added.');
	if (unchanged.length > 0) parts.push(`${unchanged.join(', ')} already had every mapping.`);
	if (notStored.length > 0) {
		parts.push(
			postError
				? `Not stored: ${notStored.join(', ')}.`
				: `Not stored: ${notStored.join(', ')}; the service accepted the request but did not store ${notStored.length === 1 ? 'it' : 'them'}.`,
		);
	}
	if (postError) parts.push(`The service reported: ${postError}`);
	if (lagging.length > 0) {
		parts.push(`${lagging.join(', ')} may take a moment to appear in the table; run Get Lookup Values again to refresh it.`);
	}
	const flags = describeFlagsDropped(plan.flagsDropped);
	if (flags) parts.push(flags);

	return {
		landed: [...added, ...appendedTo],
		remaining: plan.items.filter(i => i.kind !== 'unchanged' && !stored.has(i.draft.code)).map(i => i.draft),
		message: parts.join(' '),
	};
}

/**
 * Sources to suggest in the form: those this lookup type already maps, plus
 * those declared in the tenant's RDM configuration. A configured source is
 * suggested by its `abbreviation`, which is what a mapping's `source` must
 * match; the trailing segment of its `uri` only stands in when there is none.
 * Suggestions only — the form accepts any source.
 */
export function sourceSuggestions(lookupsResponse: unknown, rdmConfiguration: unknown): string[] {
	const names = new Set<string>();
	if (Array.isArray(lookupsResponse)) {
		for (const entry of lookupsResponse) {
			if (!isRecord(entry) || !Array.isArray(entry.sourceMappings)) continue;
			for (const m of entry.sourceMappings) {
				if (isRecord(m) && typeof m.source === 'string' && m.source.trim()) {
					names.add(m.source.trim());
				}
			}
		}
	}
	if (isRecord(rdmConfiguration) && Array.isArray(rdmConfiguration.sources)) {
		for (const s of rdmConfiguration.sources) {
			if (!isRecord(s)) continue;
			const abbreviation = typeof s.abbreviation === 'string' ? s.abbreviation.trim() : '';
			const fromUri = typeof s.uri === 'string' ? s.uri.slice(s.uri.lastIndexOf('/') + 1).trim() : '';
			const name = abbreviation || fromUri;
			if (name) names.add(name);
		}
	}
	return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function blockLabel(index: number, code: string): string {
	return code ? `Code ${index + 1} (${code})` : `Code ${index + 1}`;
}

function plural(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
