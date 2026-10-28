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
 * Codes the create response says were stored. Documented as one
 * `{ uri, value }` per stored code; a bare lookup object is accepted too.
 * Anything else contributes nothing, leaving the re-fetch to decide.
 */
export function codesInCreateResponse(response: unknown): Set<string> {
	const codes = new Set<string>();
	if (Array.isArray(response)) {
		for (const entry of response) {
			if (!isRecord(entry)) continue;
			const value = isRecord(entry.value) ? entry.value : entry;
			if (typeof value.code === 'string') {
				codes.add(value.code);
			}
		}
	}
	return codes;
}

/** Codes present in a `GET …/lookups/{rdmTenantId}/{lookupTypeName}` response. */
export function codesInLookupsResponse(response: unknown): Set<string> {
	const codes = new Set<string>();
	if (Array.isArray(response)) {
		for (const entry of response) {
			if (isRecord(entry) && typeof entry.code === 'string') {
				codes.add(entry.code);
			}
		}
	}
	return codes;
}

/**
 * Submitted codes the server already holds. Exact match: whether codes are
 * case-sensitive is the RDM service's decision, not the IDE's.
 */
export function findExistingCodes(codes: string[], response: unknown): string[] {
	const present = codesInLookupsResponse(response);
	return codes.filter(c => present.has(c));
}

/**
 * Which submitted codes the server stored: those a fetch taken after the post
 * contains, plus those the create response lists — so a re-fetch that lags
 * the write cannot report a stored code as missing. `notYetVisible` are the
 * stored codes the re-fetch does not show yet.
 */
export function reconcileSubmittedCodes(
	codes: string[],
	refetched: unknown,
	createResponse?: unknown,
): { landed: string[]; notLanded: string[]; notYetVisible: string[] } {
	const visible = codesInLookupsResponse(refetched);
	const created = codesInCreateResponse(createResponse);
	const stored = (c: string) => visible.has(c) || created.has(c);
	return {
		landed: codes.filter(stored),
		notLanded: codes.filter(c => !stored(c)),
		notYetVisible: codes.filter(c => created.has(c) && !visible.has(c)),
	};
}

/**
 * What the panel shows once the outcome is known: the blocks to restore
 * (those not stored, as entered) and one message. `postError` is the post's
 * failure detail, if it failed.
 */
export function describeSubmissionOutcome(
	values: LookupValueDraft[],
	refetched: unknown,
	postError: string | undefined,
	createResponse?: unknown,
): { landed: string[]; remaining: LookupValueDraft[]; message: string } {
	const { landed, notLanded, notYetVisible } = reconcileSubmittedCodes(
		values.map(v => v.code),
		refetched,
		createResponse,
	);
	const remaining = values.filter(v => notLanded.includes(v.code));
	const reported = postError ? ` The service reported: ${postError}` : '';
	const lagging =
		notYetVisible.length > 0
			? ` ${notYetVisible.join(', ')} may take a moment to appear in the table; run Get Lookup Values again to refresh it.`
			: '';

	let message: string;
	if (notLanded.length === 0) {
		message = `Added ${plural(landed.length, 'value')}.${lagging}${reported}`;
	} else if (landed.length === 0) {
		message = postError
			? `Nothing was added.${reported}`
			: `Nothing was added: the service accepted the request but did not store ${notLanded.join(', ')}.`;
	} else {
		message =
			`Added ${landed.join(', ')}. Not stored: ${notLanded.join(', ')}.${lagging}` +
			(postError ? reported : ' The service accepted the request but did not store them.');
	}
	return { landed, remaining, message };
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
