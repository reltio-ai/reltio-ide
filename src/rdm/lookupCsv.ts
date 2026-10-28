/**
 * Pure logic behind loading RDM lookup values from a CSV: parsing, turning
 * rows into lookup values, the checks (each with its CSV line), resolving the
 * lookup type from the file name, and the per-code outcome of a load. No
 * `vscode` import, so the test harness exercises it directly.
 *
 * The CSV has the columns Get Lookup Values shows — Code, Source, Value at
 * Source — one row per source mapping; rows sharing a Code are one value.
 */
import { codesInCreateResponse, codesInLookupsResponse, sourceSuggestions, type LookupValueDraft } from './lookupValueDraft';

/** Bounds what one file can turn into: a stray large file must not become thousands of requests. */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

/** A problem in the file. `lines` are CSV line numbers; the header is line 1. */
export interface CsvFinding {
	lines: number[];
	message: string;
}

export interface LookupCsv {
	values: LookupValueDraft[];
	/** CSV lines of each code's rows, keyed by code. */
	linesByCode: Record<string, number[]>;
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

const COLUMNS = {
	code: 'code',
	source: 'source',
	valueAtSource: 'value at source',
	codeAtSource: 'code at source',
	canonical: 'canonical',
	downstreamDefault: 'downstream default',
} as const;
type ColumnKey = keyof typeof COLUMNS;
const REQUIRED: ColumnKey[] = ['code', 'source', 'valueAtSource'];
const HEADER_NAMES: Record<ColumnKey, string> = {
	code: 'Code',
	source: 'Source',
	valueAtSource: 'Value at Source',
	codeAtSource: 'Code at Source',
	canonical: 'Canonical',
	downstreamDefault: 'Downstream Default',
};

const normalizeHeader = (h: string): string => h.trim().replace(/\s+/g, ' ').toLowerCase();

/** `undefined` for blank, `null` for anything unreadable. */
function parseBoolean(raw: string): boolean | undefined | null {
	const v = raw.trim().toLowerCase();
	if (v === '') return undefined;
	if (v === 'true' || v === 'yes' || v === '1') return true;
	if (v === 'false' || v === 'no' || v === '0') return false;
	return null;
}

/**
 * Turns the CSV into lookup values, with every error and warning that does
 * not need the tenant. Source warnings need the tenant's sources and come
 * from `unknownSourceWarnings`.
 *
 * Value at Source sets the mapping's value **and** its code: RDM transcodes
 * source data by the source's code, so `Single,BvD,Unmarried` makes BvD data
 * sending "Unmarried" transcode to Single. A non-empty Code at Source sets
 * the code instead.
 */
export function readLookupCsv(text: string, byteLength: number): LookupCsv {
	const empty = (finding: CsvFinding): LookupCsv => ({ values: [], linesByCode: {}, errors: [finding], warnings: [] });
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

	const index: Partial<Record<ColumnKey, number>> = {};
	const ignored: string[] = [];
	header.fields.forEach((name, i) => {
		const key = (Object.keys(COLUMNS) as ColumnKey[]).find(k => COLUMNS[k] === normalizeHeader(name));
		if (key && index[key] === undefined) index[key] = i;
		else if (name.trim()) ignored.push(name.trim());
	});
	const missing = REQUIRED.filter(k => index[k] === undefined);
	if (missing.length > 0) {
		return empty({
			lines: [header.line],
			message: `Line ${header.line}: missing column${missing.length === 1 ? '' : 's'} ${missing.map(k => `"${HEADER_NAMES[k]}"`).join(', ')}.`,
		});
	}
	if (ignored.length > 0) {
		warnings.push({ lines: [header.line], message: `Line ${header.line}: ignored column${ignored.length === 1 ? '' : 's'} ${ignored.map(c => `"${c}"`).join(', ')}.` });
	}
	if (rows.length === 0) return { values: [], linesByCode: {}, errors: [{ lines: [header.line], message: 'The file has no data rows.' }], warnings };
	if (rows.length > MAX_CSV_ROWS) {
		return { values: [], linesByCode: {}, errors: [{ lines: [1], message: `The file has ${rows.length} data rows; the limit is ${MAX_CSV_ROWS}.` }], warnings };
	}

	const cell = (r: CsvRecord, k: ColumnKey): string => {
		const i = index[k];
		return i === undefined ? '' : (r.fields[i] ?? '').trim();
	};

	const values: LookupValueDraft[] = [];
	const byCode = new Map<string, LookupValueDraft>();
	const linesByCode: Record<string, number[]> = Object.create(null);
	const firstLineOf = new Map<string, number>();

	for (const r of rows) {
		const at = `Line ${r.line}`;
		const code = cell(r, 'code');
		const source = cell(r, 'source');
		const valueAtSource = cell(r, 'valueAtSource');
		const before = errors.length;
		if (!code) errors.push({ lines: [r.line], message: `${at}: "Code" is empty.` });
		else if (code.includes('/')) errors.push({ lines: [r.line], message: `${at}: a code cannot contain "/" ("${code}").` });
		if (!source) errors.push({ lines: [r.line], message: `${at}: "Source" is empty.` });
		if (!valueAtSource) errors.push({ lines: [r.line], message: `${at}: "Value at Source" is empty.` });
		const canonical = parseBoolean(cell(r, 'canonical'));
		const downstream = parseBoolean(cell(r, 'downstreamDefault'));
		if (canonical === null) errors.push({ lines: [r.line], message: `${at}: "Canonical" must be true/false, yes/no, 1/0 or blank.` });
		if (downstream === null) {
			errors.push({ lines: [r.line], message: `${at}: "Downstream Default" must be true/false, yes/no, 1/0 or blank.` });
		}
		if (!code || !source) continue;

		const pairKey = `${code}\u0000${source}`;
		const earlier = firstLineOf.get(pairKey);
		if (earlier !== undefined) {
			errors.push({ lines: [earlier, r.line], message: `Lines ${earlier} and ${r.line}: code "${code}" has source "${source}" twice.` });
			continue;
		}
		firstLineOf.set(pairKey, r.line);
		if (errors.length > before) continue;

		let value = byCode.get(code);
		if (!value) {
			value = { code, mappings: [] };
			byCode.set(code, value);
			values.push(value);
			linesByCode[code] = [];
		}
		linesByCode[code].push(r.line);
		value.mappings.push({
			source,
			code: cell(r, 'codeAtSource') || valueAtSource,
			value: valueAtSource,
			canonicalValue: canonical ?? value.mappings.length === 0,
			downStreamDefaultValue: downstream ?? true,
		});
	}

	for (const v of values) {
		if (!v.mappings.some(m => m.canonicalValue)) {
			warnings.push({ lines: linesByCode[v.code], message: `Code "${v.code}" has no canonical mapping.` });
		}
	}
	return { values, linesByCode, errors, warnings };
}

/**
 * Sources the tenant does not know: neither declared in its RDM configuration
 * (by abbreviation) nor used by the lookup type already. Warnings only — the
 * configuration on disk may be out of date, and the service decides.
 */
export function unknownSourceWarnings(csv: LookupCsv, lookupsResponse: unknown, rdmConfiguration: unknown): CsvFinding[] {
	const known = new Set(sourceSuggestions(lookupsResponse, rdmConfiguration));
	const linesBySource = new Map<string, number[]>();
	for (const v of csv.values) {
		v.mappings.forEach((m, i) => {
			if (known.has(m.source)) return;
			const lines = linesBySource.get(m.source) ?? [];
			lines.push(csv.linesByCode[v.code][i]);
			linesBySource.set(m.source, lines);
		});
	}
	return [...linesBySource].map(([source, lines]) => ({
		lines,
		message: `Source "${source}" is not declared in the RDM configuration or used by this lookup type (line${lines.length === 1 ? '' : 's'} ${lines.join(', ')}).`,
	}));
}

/**
 * The lookup type a CSV loads into: its file name, without `.csv`, equal to
 * the trailing segment of a lookup type URI in the configuration. Exact only;
 * a match ignoring case is reported by name so the user can rename the file.
 */
export function resolveLookupType(
	fileName: string,
	rdmConfiguration: unknown,
): { name: string; uri: string } | { error: string } {
	const name = fileName.replace(/\.csv$/i, '');
	const types: Array<{ name: string; uri: string }> = [];
	const config = rdmConfiguration as { lookupTypes?: unknown } | null;
	if (config && typeof config === 'object' && Array.isArray(config.lookupTypes)) {
		for (const t of config.lookupTypes) {
			const uri = (t as { uri?: unknown } | null)?.uri;
			if (typeof uri === 'string' && uri) types.push({ name: uri.slice(uri.lastIndexOf('/') + 1), uri });
		}
	}
	const exact = types.find(t => t.name === name);
	if (exact) return exact;
	const near = types.find(t => t.name.toLowerCase() === name.toLowerCase());
	return {
		error: near
			? `"${fileName}" does not name a lookup type exactly. Did you mean "${near.name}"? Rename the file to "${near.name}.csv".`
			: `The RDM configuration has no lookup type "${name}". The file must be named after the lookup type it loads.`,
	};
}

export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export const LOAD_OUTCOMES = ['added', 'not-stored', 'not-sent', 'skipped-existing', 'unconfirmed'] as const;
export type LoadOutcome = (typeof LOAD_OUTCOMES)[number];

/**
 * One outcome per code, in CSV order. A sent code is `added` when a create
 * response lists it or the re-fetch contains it; without a re-fetch
 * (`refetched` undefined) a sent code the responses do not list is
 * `unconfirmed` rather than `not-stored`.
 */
export function loadOutcomes(input: {
	codes: string[];
	existing: string[];
	sent: string[];
	createResponses: unknown[];
	refetched: unknown | undefined;
}): Array<{ code: string; outcome: LoadOutcome }> {
	const existing = new Set(input.existing);
	const sent = new Set(input.sent);
	const created = new Set<string>();
	for (const r of input.createResponses) for (const c of codesInCreateResponse(r)) created.add(c);
	const visible = input.refetched === undefined ? undefined : codesInLookupsResponse(input.refetched);

	return input.codes.map(code => {
		let outcome: LoadOutcome;
		if (existing.has(code)) outcome = 'skipped-existing';
		else if (!sent.has(code)) outcome = 'not-sent';
		else if (created.has(code) || visible?.has(code)) outcome = 'added';
		else outcome = visible === undefined ? 'unconfirmed' : 'not-stored';
		return { code, outcome };
	});
}

export function countOutcomes(outcomes: Array<{ outcome: LoadOutcome }>): Record<LoadOutcome, number> {
	const counts = Object.fromEntries(LOAD_OUTCOMES.map(o => [o, 0])) as Record<LoadOutcome, number>;
	for (const o of outcomes) counts[o.outcome]++;
	return counts;
}
