#!/usr/bin/env node
'use strict';
/**
 * Area: RDM (src/rdm/lookupCsv.ts).
 *
 * Regression checks for the CSV reader behind loading RDM lookup values. The happy path and the
 * main errors are in test-rdm-lookup-csv-load.cjs; this script adds the edge cases it does not
 * assert.
 *
 * RDM-001  CSV parsing: RFC 4180 quoting and duplicate code or mapping rejection.
 *          #1-#8  parseCsvRecords: quoted commas, doubled quotes, newline inside quotes, CRLF,
 *                 LF, a lone CR and no trailing newline, each record with the line it starts on.
 *                 A lone CR ends a record. That pins current behavior; the owner may want another.
 *          #9-#14 readLookupCsv: code fields on two rows and the same mapping twice each give one
 *                 error naming both lines, and the duplicate mapping is not added to the draft;
 *                 the same code under two lookup types stays two values without an error.
 * RDM-010  CSV size and row limits accept the boundary and reject one past it.
 *          #1-#4  10000 data rows and exactly 2 MB parse without a limit error; 10001 rows and
 *                 2 MB + 1 byte are refused with their messages; neither case throws.
 *
 * Tier C (manual): none for these behaviors.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');

const { parseCsvRecords, readLookupCsv, MAX_CSV_ROWS, MAX_CSV_BYTES } = importDist('rdm/lookupCsv');

const HEADER = 'code,type,enabled,startDate,endDate,sourceMappings.source,sourceMappings.code,sourceMappings.value';
const COLS = HEADER.split(',');
const ORG = 'rdm/lookupTypes/OrganizationStatuses';
const ADDR = 'rdm/lookupTypes/AddressTypes';
const row = fields => COLS.map(c => fields[c] ?? '').join(',');
const file = (...rows) => [HEADER, ...rows].join('\n');
const csv = text => readLookupCsv(text, Buffer.byteLength(text));

// ---------------------------------------------------------------------------
// RDM-001 — RFC 4180 records and their start lines
// ---------------------------------------------------------------------------

{
	const { records, error } = parseCsvRecords('a,"b, c"\r\n"say ""hi""",x\n"multi\nline",y\rlast,"z"');
	assert.strictEqual(error, undefined, 'RDM-001 #1: well-formed input parses without an error');
	assert.deepStrictEqual(records.map(r => r.fields), [
		['a', 'b, c'],
		['say "hi"', 'x'],
		['multi\nline', 'y'],
		['last', 'z'],
	], 'RDM-001 #2: commas and doubled quotes inside quotes are unquoted, the embedded newline kept');
	assert.deepStrictEqual(records.map(r => r.line), [1, 2, 3, 5],
		'RDM-001 #3: each record reports the line it starts on, counting the newline inside quotes');
}

// CRLF and LF give the same records.
{
	const lf = parseCsvRecords('h1,h2\na,b\nc,d\n').records;
	const crlf = parseCsvRecords('h1,h2\r\na,b\r\nc,d\r\n').records;
	assert.deepStrictEqual(crlf, lf, 'RDM-001 #4: CRLF and LF line endings give identical records');
	assert.deepStrictEqual(lf.map(r => r.line), [1, 2, 3], 'RDM-001 #5: no empty record after the final line break');
}

// A lone CR ends a record (pinned current behavior).
{
	const { records } = parseCsvRecords('h\ra\rb');
	assert.deepStrictEqual(records, [
		{ line: 1, fields: ['h'] },
		{ line: 2, fields: ['a'] },
		{ line: 3, fields: ['b'] },
	], 'RDM-001 #6: a lone CR ends a record and advances the line');
}

// No trailing newline: the final record is still kept.
{
	const { records } = parseCsvRecords('h1,h2\nx,"y"');
	assert.deepStrictEqual(records[records.length - 1], { line: 2, fields: ['x', 'y'] },
		'RDM-001 #7: the final record without a trailing newline is kept');
	const empties = parseCsvRecords('a,\n,');
	assert.deepStrictEqual(empties.records.map(r => r.fields), [['a', ''], ['', '']],
		'RDM-001 #8: a final record of empty fields is kept too');
}

// ---------------------------------------------------------------------------
// RDM-001 — duplicate code fields and mappings
// ---------------------------------------------------------------------------

{
	const out = csv(file(
		row({ code: 'A', type: ORG, enabled: 'true' }), // 2
		row({ code: 'A', type: ORG, startDate: '5' }), // 3
		row({ code: 'A', type: ORG, endDate: '9' }), // 4
		row({ code: 'A', type: ORG, 'sourceMappings.source': 'SAP', 'sourceMappings.code': 'A1', 'sourceMappings.value': 'One' }), // 5
		row({ code: 'A', type: ORG, 'sourceMappings.source': 'SAP', 'sourceMappings.code': 'A1', 'sourceMappings.value': 'Other' }), // 6
	));
	assert.deepStrictEqual(out.errors.map(e => e.lines), [[2, 3], [2, 4], [5, 6]],
		'RDM-001 #9: code fields on a second row, and a mapping repeated, each name both lines');
	assert.match(out.errors[0].message, /^Lines 2 and 3: code "A" of OrganizationStatuses has enabled, startDate or endDate on two rows\./,
		'RDM-001 #10: the code-field error names the code, its lookup type and both lines');
	assert.match(out.errors[2].message, /^Lines 5 and 6: code "A" of OrganizationStatuses maps SAP code "A1" twice\./,
		'RDM-001 #11: the mapping error names the source, the code at the source and both lines');
	const [a] = out.types[0].values;
	assert.strictEqual(a.mappings.length, 1, 'RDM-001 #12: the repeated mapping is not added to the draft');
	assert.deepStrictEqual([a.enabled, a.startDate, a.endDate], [true, undefined, undefined],
		'RDM-001 #13: only the first row sets the code fields');
}

// The same code under two lookup types is two values, not a duplicate.
{
	const out = csv(file(
		row({ code: 'A', type: ORG, enabled: 'true', 'sourceMappings.source': 'SAP', 'sourceMappings.code': 'A', 'sourceMappings.value': 'Acquired' }),
		row({ code: 'A', type: ADDR, enabled: 'false', 'sourceMappings.source': 'SAP', 'sourceMappings.code': 'A', 'sourceMappings.value': 'Acquired' }),
	));
	assert.deepStrictEqual(out.errors, [], 'RDM-001 #14: the same code and mapping under two lookup types is not an error');
	assert.deepStrictEqual(
		out.types.map(t => [t.name, t.values.map(v => [v.code, v.enabled, v.mappings.length])]),
		[['OrganizationStatuses', [['A', true, 1]]], ['AddressTypes', [['A', false, 1]]]],
		'RDM-001 #14: each lookup type keeps its own value',
	);
}

// ---------------------------------------------------------------------------
// RDM-010 — limits at the boundary
// ---------------------------------------------------------------------------

{
	const rows = n => Array.from({ length: n }, (_, i) =>
		row({ code: `C${i}`, type: ORG, 'sourceMappings.source': 'SAP', 'sourceMappings.code': `C${i}`, 'sourceMappings.value': `V${i}` }));
	const limitError = out => out.errors.find(e => /limit is|larger than/.test(e.message));

	let atLimit;
	assert.doesNotThrow(() => { atLimit = csv(file(...rows(MAX_CSV_ROWS))); }, 'RDM-010 #1: the row limit itself never throws');
	assert.strictEqual(limitError(atLimit), undefined, `RDM-010 #1: exactly ${MAX_CSV_ROWS} data rows are accepted`);
	assert.strictEqual(atLimit.types[0].values.length, MAX_CSV_ROWS, 'RDM-010 #1: every row at the limit becomes a value');

	let over;
	assert.doesNotThrow(() => { over = csv(file(...rows(MAX_CSV_ROWS + 1))); }, 'RDM-010 #2: one row past the limit does not throw');
	assert.strictEqual(over.errors.length, 1, 'RDM-010 #2: one row past the limit is one error');
	assert.match(over.errors[0].message, new RegExp(`has ${MAX_CSV_ROWS + 1} data rows; the limit is ${MAX_CSV_ROWS}\\.`),
		'RDM-010 #2: the error states the row count and the limit');
	assert.deepStrictEqual(over.types, [], 'RDM-010 #2: nothing loads past the limit');

	const small = file(...rows(2));
	let atBytes;
	assert.doesNotThrow(() => { atBytes = readLookupCsv(small, MAX_CSV_BYTES); }, 'RDM-010 #3: the byte limit itself never throws');
	assert.strictEqual(limitError(atBytes), undefined, `RDM-010 #3: exactly ${MAX_CSV_BYTES} bytes are accepted`);
	assert.strictEqual(atBytes.types[0].values.length, 2, 'RDM-010 #3: a file at the byte limit is read');

	let overBytes;
	assert.doesNotThrow(() => { overBytes = readLookupCsv(small, MAX_CSV_BYTES + 1); }, 'RDM-010 #4: one byte past the limit does not throw');
	assert.deepStrictEqual(overBytes.errors.map(e => e.message), ['The file is larger than 2 MB.'],
		'RDM-010 #4: one byte past 2 MB is refused');
	assert.deepStrictEqual(overBytes.types, [], 'RDM-010 #4: nothing loads past the byte limit');
}

console.log('test-rdm-csv-parsing: OK');
