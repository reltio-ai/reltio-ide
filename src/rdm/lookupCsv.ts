/**
 * Pure logic behind loading RDM lookup values from a CSV: parsing, turning
 * rows into lookup values grouped by lookup type, the checks (each with its CSV
 * line), resolving lookup types against the RDM configuration, and the per-code
 * outcome of a load. No `vscode` import, so the test harness exercises it
 * directly.
 *
 * The CSV is the one RDM exports (`{rdmTenantId}_lookups_{timestamp}.csv`).
 * Every row names a `code` and its lookup `type`, and carries one item of that
 * lookup value: the code's own fields (`enabled`, `startDate`, `endDate`), one
 * source mapping (`sourceMappings.*`), or a parent, localization or attribute.
 * Codes and source mappings load; parents, localizations and attributes are
 * reported as warnings and not loaded.
 */
import {
	sourceSuggestions,
	storedCodes,
	type LookupValueDraft,
	type LookupValuesPlan,
	type MappingNote,
	type PlannedValue,
} from './lookupValueDraft';

/** Bounds what one file can turn into: a stray large file must not become thousands of requests. */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

/** A problem in the file. `lines` are CSV line numbers; the header is line 1. */
export interface CsvFinding {
	lines: number[];
	message: string;
}

/** The values of one lookup type in the file, in order of first appearance. */
export interface LookupCsvType {
	/** The lookup type's name: the last segment of `type`, e.g. `OrganizationStatuses`. */
	name: string;
	values: LookupValueDraft[];
	/** Every CSV line of each code, keyed by code. */
	linesByCode: Record<string, number[]>;
	/** The CSV line of each of a code's mappings, in the order of its `mappings`. */
	mappingLines: Record<string, number[]>;
	/** The line that set a code's `enabled`, `startDate` or `endDate`, when one did. */
	fieldLine: Record<string, number>;
}

export interface LookupCsv {
	/** Lookup types in order of first appearance in the file. */
	types: LookupCsvType[];
	errors: CsvFinding[];
	warnings: CsvFinding[];
}

interface CsvRecord {
	line: number;
	fields: string[];
}

/**
 * RFC 4180: comma separator, `"` quoting with `""` escapes, commas and line
 * breaks inside quotes, CRLF or LF. Each record carries the line it starts on.
 */
export function parseCsvRecords(text: string): { records: CsvRecord[]; error?: CsvFinding } {
	const records: CsvRecord[] = [];
	let fields: string[] = [];
	let field = '';
	let inQuotes = false;
	let line = 1;
	let recordLine = 1;
	let quoteLine = 1;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				if (ch === '\n') line++;
				field += ch;
			}
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			quoteLine = line;
		} else if (ch === ',') {
			fields.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			fields.push(field);
			records.push({ line: recordLine, fields });
			fields = [];
			field = '';
			line++;
			recordLine = line;
		} else {
			field += ch;
		}
	}
	if (inQuotes) {
		return { records, error: { lines: [quoteLine], message: `Line ${quoteLine}: a quoted field is never closed.` } };
	}
	if (field !== '' || fields.length > 0) {
		fields.push(field);
		records.push({ line: recordLine, fields });
	}
	return { records };
}

/** The columns of RDM's export, by their names as written there. Matched ignoring case. */
const COLUMNS = {
	code: 'code',
	type: 'type',
	enabled: 'enabled',
	startDate: 'startDate',
	endDate: 'endDate',
	parents: 'parents',
	mappingSource: 'sourceMappings.source',
	mappingCode: 'sourceMappings.code',
	mappingValue: 'sourceMappings.value',
	mappingEnabled: 'sourceMappings.enabled',
	mappingCanonical: 'sourceMappings.canonicalValue',
	mappingDownstream: 'sourceMappings.downStreamDefaultValue',
	localizationLanguage: 'localizations.languageCode',
	localizationValue: 'localizations.value',
	attributeName: 'attributes.name',
	attributeValue: 'attributes.value',
} as const;
type ColumnKey = keyof typeof COLUMNS;
const COLUMN_KEYS = Object.keys(COLUMNS) as ColumnKey[];
const REQUIRED: ColumnKey[] = ['code', 'type', 'mappingSource', 'mappingCode', 'mappingValue'];
const MAPPING_KEYS: ColumnKey[] = [
	'mappingSource',
	'mappingCode',
	'mappingValue',
	'mappingEnabled',
	'mappingCanonical',
	'mappingDownstream',
];
/** Read so they are reported, never loaded: the IDE has not yet confirmed how RDM takes them. */
const UNLOADED: ReadonlyArray<{ keys: ColumnKey[]; noun: string }> = [
	{ keys: ['parents'], noun: 'parents' },
	{ keys: ['localizationLanguage', 'localizationValue'], noun: 'localizations' },
	{ keys: ['attributeName', 'attributeValue'], noun: 'attributes' },
];

const normalizeHeader = (h: string): string => h.trim().toLowerCase();

/** `undefined` for blank, `null` for anything unreadable. */
function parseBoolean(raw: string): boolean | undefined | null {
	const v = raw.trim().toLowerCase();
	if (v === '') return undefined;
	if (v === 'true' || v === 'yes' || v === '1') return true;
	if (v === 'false' || v === 'no' || v === '0') return false;
	return null;
}

/** `undefined` for blank, `null` for anything but a whole number of milliseconds since 1970. */
function parseDate(raw: string): number | undefined | null {
	const v = raw.trim();
	if (v === '') return undefined;
	return /^\d+$/.test(v) ? Number(v) : null;
}

/** `rdm/lookupTypes/X`, as RDM exports it, or a bare `X`, gives `X`. Anything else is not a lookup type. */
export function lookupTypeName(raw: string): string | undefined {
	return /^(?:rdm\/lookupTypes\/)?([^/\s]+)$/.exec(raw.trim())?.[1];
}

/** "Line 4" or "Lines 2, 3 and 5 more" — a long list is cut short so a message stays readable. */
function linesText(lines: number[]): string {
	if (lines.length === 1) return `Line ${lines[0]}`;
	const shown = lines.length > 8 ? `${lines.slice(0, 8).join(', ')} and ${lines.length - 8} more` : lines.join(', ');
	return `Lines ${shown}`;
}

/**
 * Turns the CSV into lookup values, grouped by lookup type, with every error
 * and warning that does not need the tenant. Lookup types are checked against
 * the RDM configuration by `resolveLookupTypes`; sources against the tenant by
 * `unknownSourceWarnings`.
 *
 * A mapping's `sourceMappings.code` is the source's code, which RDM transcodes
 * by; `sourceMappings.value` is how it reads. When one of the two is blank, the
 * other stands in for it.
 */
export function readLookupCsv(text: string, byteLength: number): LookupCsv {
	const empty = (finding: CsvFinding): LookupCsv => ({ types: [], errors: [finding], warnings: [] });
	if (byteLength > MAX_CSV_BYTES) {
		return empty({ lines: [1], message: `The file is larger than ${MAX_CSV_BYTES / (1024 * 1024)} MB.` });
	}

	const parsed = parseCsvRecords(text.replace(/^﻿/, ''));
	if (parsed.error) return empty(parsed.error);
	const records = parsed.records.filter(r => r.fields.some(f => f.trim() !== ''));
	if (records.length === 0) return empty({ lines: [1], message: 'The file is empty.' });

	const errors: CsvFinding[] = [];
	const warnings: CsvFinding[] = [];
	const [header, ...rows] = records;

	const names = header.fields.map(normalizeHeader);
	if (names.includes('value at source') && !names.includes(normalizeHeader(COLUMNS.mappingSource))) {
		return empty({
			lines: [header.line],
			message:
				`Line ${header.line}: this is the earlier Code, Source, Value at Source layout. Lookup values now load from ` +
				'the CSV that RDM exports, with the columns code, type, sourceMappings.source, sourceMappings.code and sourceMappings.value.',
		});
	}

	const index: Partial<Record<ColumnKey, number>> = {};
	const ignored: string[] = [];
	header.fields.forEach((name, i) => {
		const key = COLUMN_KEYS.find(k => normalizeHeader(COLUMNS[k]) === normalizeHeader(name));
		if (key && index[key] === undefined) index[key] = i;
		else if (name.trim()) ignored.push(name.trim());
	});
	const missing = REQUIRED.filter(k => index[k] === undefined);
	if (missing.length > 0) {
		return empty({
			lines: [header.line],
			message: `Line ${header.line}: missing column${missing.length === 1 ? '' : 's'} ${missing.map(k => `"${COLUMNS[k]}"`).join(', ')}.`,
		});
	}
	if (ignored.length > 0) {
		warnings.push({ lines: [header.line], message: `Line ${header.line}: ignored column${ignored.length === 1 ? '' : 's'} ${ignored.map(c => `"${c}"`).join(', ')}.` });
	}
	if (rows.length === 0) return { types: [], errors: [{ lines: [header.line], message: 'The file has no data rows.' }], warnings };
	if (rows.length > MAX_CSV_ROWS) {
		return { types: [], errors: [{ lines: [1], message: `The file has ${rows.length} data rows; the limit is ${MAX_CSV_ROWS}.` }], warnings };
	}

	const cell = (r: CsvRecord, k: ColumnKey): string => {
		const i = index[k];
		return i === undefined ? '' : (r.fields[i] ?? '').trim();
	};
	const has = (r: CsvRecord, k: ColumnKey): boolean => cell(r, k) !== '';

	const types: LookupCsvType[] = [];
	const byName = new Map<string, { type: LookupCsvType; byCode: Map<string, LookupValueDraft> }>();
	const mappingAt = new Map<string, number>();
	const unloaded = new Map<string, number[]>();

	for (const r of rows) {
		const before = errors.length;
		const fail = (message: string) => errors.push({ lines: [r.line], message: `Line ${r.line}: ${message}` });

		const code = cell(r, 'code');
		const rawType = cell(r, 'type');
		const name = lookupTypeName(rawType);
		if (!code) fail('"code" is empty.');
		else if (code.includes('/')) fail(`a code cannot contain "/" ("${code}").`);
		if (!rawType) fail('"type" is empty.');
		else if (!name) fail(`"type" must name a lookup type, such as rdm/lookupTypes/OrganizationStatuses ("${rawType}").`);

		const enabled = parseBoolean(cell(r, 'enabled'));
		const startDate = parseDate(cell(r, 'startDate'));
		const endDate = parseDate(cell(r, 'endDate'));
		if (enabled === null) fail('"enabled" must be true/false, yes/no, 1/0 or blank.');
		if (startDate === null) fail('"startDate" must be a whole number (milliseconds since 1970) or blank.');
		if (endDate === null) fail('"endDate" must be a whole number (milliseconds since 1970) or blank.');

		const isMapping = MAPPING_KEYS.some(k => has(r, k));
		const source = cell(r, 'mappingSource');
		const atSource = cell(r, 'mappingCode');
		const value = cell(r, 'mappingValue');
		const mappingEnabled = parseBoolean(cell(r, 'mappingEnabled'));
		const canonical = parseBoolean(cell(r, 'mappingCanonical'));
		const downstream = parseBoolean(cell(r, 'mappingDownstream'));
		if (isMapping) {
			if (!source) fail('"sourceMappings.source" is empty.');
			if (!atSource && !value) fail('"sourceMappings.code" and "sourceMappings.value" are both empty.');
			for (const [flag, parsedFlag] of [
				['enabled', mappingEnabled],
				['canonicalValue', canonical],
				['downStreamDefaultValue', downstream],
			] as const) {
				if (parsedFlag === null) fail(`"sourceMappings.${flag}" must be true/false, yes/no, 1/0 or blank.`);
			}
		}
		for (const u of UNLOADED) {
			if (u.keys.some(k => has(r, k))) unloaded.set(u.noun, [...(unloaded.get(u.noun) ?? []), r.line]);
		}
		if (errors.length > before || !code || !name) continue;

		let group = byName.get(name);
		if (!group) {
			group = {
				type: { name, values: [], linesByCode: Object.create(null), mappingLines: Object.create(null), fieldLine: Object.create(null) },
				byCode: new Map(),
			};
			byName.set(name, group);
			types.push(group.type);
		}
		const t = group.type;
		let draft = group.byCode.get(code);
		if (!draft) {
			draft = { code, mappings: [] };
			group.byCode.set(code, draft);
			t.values.push(draft);
			t.linesByCode[code] = [];
			t.mappingLines[code] = [];
		}
		t.linesByCode[code].push(r.line);

		if (has(r, 'enabled') || has(r, 'startDate') || has(r, 'endDate')) {
			const earlier = t.fieldLine[code];
			if (earlier !== undefined) {
				errors.push({
					lines: [earlier, r.line],
					message: `Lines ${earlier} and ${r.line}: code "${code}" of ${name} has enabled, startDate or endDate on two rows.`,
				});
				continue;
			}
			t.fieldLine[code] = r.line;
			// A null (unreadable) value was already an error, which skipped this row.
			if (enabled != null) draft.enabled = enabled;
			if (startDate != null) draft.startDate = startDate;
			if (endDate != null) draft.endDate = endDate;
		}

		if (isMapping) {
			const codeAtSource = atSource || value;
			const key = [name, code, source, codeAtSource].join('\u0000');
			const earlier = mappingAt.get(key);
			if (earlier !== undefined) {
				errors.push({
					lines: [earlier, r.line],
					message: `Lines ${earlier} and ${r.line}: code "${code}" of ${name} maps ${source} code "${codeAtSource}" twice.`,
				});
				continue;
			}
			mappingAt.set(key, r.line);
			draft.mappings.push({
				source,
				code: codeAtSource,
				value: value || atSource,
				// Blank: only the code's first mapping is canonical.
				canonicalValue: canonical ?? draft.mappings.length === 0,
				downStreamDefaultValue: downstream ?? true,
				enabled: mappingEnabled ?? true,
			});
			t.mappingLines[code].push(r.line);
		}
	}

	for (const [noun, lines] of unloaded) {
		warnings.push({
			lines,
			message: `${linesText(lines)}: ${noun} are not loaded. Only codes and their source mappings load from a CSV; add ${noun} in RDM.`,
		});
	}
	return { types, errors, warnings };
}

/**
 * The lookup type each group of the file loads into: the RDM configuration's
 * lookup type with the same name. Exact only; a match ignoring case is named so
 * the user can correct the `type` column.
 */
export function resolveLookupTypes(
	csv: LookupCsv,
	rdmConfiguration: unknown,
): { resolved: Map<string, { name: string; uri: string }>; errors: CsvFinding[] } {
	const known: Array<{ name: string; uri: string }> = [];
	const config = rdmConfiguration as { lookupTypes?: unknown } | null;
	if (config && typeof config === 'object' && Array.isArray(config.lookupTypes)) {
		for (const t of config.lookupTypes) {
			const uri = (t as { uri?: unknown } | null)?.uri;
			if (typeof uri === 'string' && uri) known.push({ name: uri.slice(uri.lastIndexOf('/') + 1), uri });
		}
	}
	const resolved = new Map<string, { name: string; uri: string }>();
	const errors: CsvFinding[] = [];
	for (const t of csv.types) {
		const exact = known.find(k => k.name === t.name);
		if (exact) {
			resolved.set(t.name, exact);
			continue;
		}
		const lines = Object.values(t.linesByCode).flat().sort((a, b) => a - b);
		const near = known.find(k => k.name.toLowerCase() === t.name.toLowerCase());
		errors.push({
			lines,
			message: near
				? `${linesText(lines)}: the RDM configuration has no lookup type "${t.name}". Did you mean "${near.name}"? ` +
					`Correct the type column to rdm/lookupTypes/${near.name}.`
				: `${linesText(lines)}: the RDM configuration has no lookup type "${t.name}". ` +
					'Add it (Add a new Lookup Type, then Apply RDM Configuration) before loading values into it.',
		});
	}
	return { resolved, errors };
}

/**
 * Sources the tenant does not know: neither declared in its RDM configuration
 * (by abbreviation) nor used by the lookup type already. Warnings only — the
 * configuration on disk may be out of date, and the service decides.
 */
export function unknownSourceWarnings(type: LookupCsvType, lookupsResponse: unknown, rdmConfiguration: unknown): CsvFinding[] {
	const known = new Set(sourceSuggestions(lookupsResponse, rdmConfiguration));
	const linesBySource = new Map<string, number[]>();
	for (const v of type.values) {
		v.mappings.forEach((m, i) => {
			if (known.has(m.source)) return;
			const lines = linesBySource.get(m.source) ?? [];
			lines.push(type.mappingLines[v.code][i]);
			linesBySource.set(m.source, lines);
		});
	}
	return [...linesBySource].map(([source, lines]) => ({
		lines,
		message: `${linesText(lines)}: source "${source}" is not declared in the RDM configuration or used by ${type.name}.`,
	}));
}

export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

const CODE_FIELDS = ['enabled', 'startDate', 'endDate'] as const;
/** What a stored value without the field means: enabled, and no bound. */
const FIELD_DEFAULTS = { enabled: true, startDate: 0, endDate: 0 } as const;

/**
 * Rows the stored values decide against, as line-numbered warnings. None stops
 * the file:
 *
 * - a conflicting mapping value: the stored one is kept;
 * - a flag the stored value already gives to another mapping;
 * - `enabled`, `startDate` or `endDate` that differ from an existing code's:
 *   the stored ones are kept;
 * - a new code with mappings but none canonical.
 */
export function planWarnings(plan: LookupValuesPlan, type: LookupCsvType): CsvFinding[] {
	const lineOf = (n: MappingNote) => type.mappingLines[n.valueCode]?.[n.index] ?? 1;
	const findings: CsvFinding[] = [
		...plan.conflicts.map(c => ({
			lines: [lineOf(c)],
			message:
				`Line ${lineOf(c)}: ${c.valueCode} already maps ${c.source} code "${c.code}" to "${c.storedValue}", not "${c.value}". ` +
				'The stored value is kept and this row is skipped.',
		})),
		...plan.flagsDropped.map(f => ({
			lines: [lineOf(f)],
			message:
				f.flag === 'canonical'
					? `Line ${lineOf(f)}: ${f.valueCode} already has a canonical value, so ${f.source} is added as non-canonical.`
					: `Line ${lineOf(f)}: ${f.source} already has a downstream default for ${f.valueCode}, so this row is added without one.`,
		})),
	];

	for (const item of plan.items) {
		const { draft, stored } = item;
		if (!stored) continue;
		const line = type.fieldLine[draft.code] ?? type.linesByCode[draft.code]?.[0] ?? 1;
		for (const field of CODE_FIELDS) {
			const wanted = draft[field];
			const kept = stored[field] ?? FIELD_DEFAULTS[field];
			if (wanted === undefined || wanted === kept) continue;
			findings.push({
				lines: [line],
				message: `Line ${line}: ${draft.code} is stored with ${field} ${String(kept)}, not ${String(wanted)}. Stored values are never changed, so it stays ${String(kept)}.`,
			});
		}
	}

	for (const item of plan.items) {
		if (item.kind !== 'new' || item.draft.mappings.length === 0 || item.draft.mappings.some(m => m.canonicalValue)) continue;
		findings.push({
			lines: type.linesByCode[item.draft.code] ?? [1],
			message: `Code "${item.draft.code}" of ${type.name} has no canonical mapping.`,
		});
	}
	return findings;
}

export const LOAD_OUTCOMES = ['added', 'appended', 'unchanged', 'not-stored', 'not-sent', 'unconfirmed'] as const;
export type LoadOutcome = (typeof LOAD_OUTCOMES)[number];

/**
 * One outcome per code, in CSV order. A sent code is stored when a create
 * response or the re-fetch holds it with every mapping it asked for
 * (`storedCodes`); without a re-fetch (`refetched` undefined) a sent code the
 * responses do not show is `unconfirmed` rather than `not-stored`.
 *
 * Called once per lookup type, with only that type's responses: the same code
 * in two lookup types must never confirm the other.
 */
export function loadOutcomes(input: {
	items: PlannedValue[];
	sent: string[];
	createResponses: unknown[];
	refetched: unknown | undefined;
}): Array<{ code: string; outcome: LoadOutcome }> {
	const sent = new Set(input.sent);
	const expectations = input.items.filter(i => sent.has(i.draft.code)).map(i => ({ code: i.draft.code, mappings: i.expect }));
	const responses = input.refetched === undefined ? input.createResponses : [...input.createResponses, input.refetched];
	const stored = storedCodes(responses, expectations);

	return input.items.map(({ draft: { code }, kind }) => {
		let outcome: LoadOutcome;
		if (kind === 'unchanged') outcome = 'unchanged';
		else if (!sent.has(code)) outcome = 'not-sent';
		else if (stored.has(code)) outcome = kind === 'new' ? 'added' : 'appended';
		else outcome = input.refetched === undefined ? 'unconfirmed' : 'not-stored';
		return { code, outcome };
	});
}

export function countOutcomes(outcomes: Array<{ outcome: LoadOutcome }>): Record<LoadOutcome, number> {
	const counts = Object.fromEntries(LOAD_OUTCOMES.map(o => [o, 0])) as Record<LoadOutcome, number>;
	for (const o of outcomes) counts[o.outcome]++;
	return counts;
}
