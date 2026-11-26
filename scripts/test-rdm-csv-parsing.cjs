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
 *          #6     parseCsvRecords: a lone CR ends a record and advances the line. That pins
 *                 current behavior; the owner may want another.
 *          #9     readLookupCsv: code fields on a second and a third row, whichever of enabled,
 *                 startDate or endDate they set, each give an error naming the first row and
 *                 their own; a repeated mapping names both lines.
 *          #12-#13 The repeated mapping is not added to the draft, and only the first row sets
 *                 the code fields.
 *          Covered in test-rdm-lookup-csv-load.cjs, so not repeated here (former #1-#5, #7, #8,
 *          #10, #11, #14): quoted commas, doubled quotes, a newline inside quotes, CRLF, line
 *          numbers, the final record, both duplicate messages, the same code under two lookup
 *          types.
 * RDM-010  CSV size and row limits accept the boundary.
 *          #1, #3 10000 data rows and exactly 2 MB parse without a limit error, and neither throws.
 *          Covered in test-rdm-lookup-csv-load.cjs, so not repeated here (former #2, #4): 10001
 *          rows and 2 MB + 1 byte are refused with their messages.
 *
 * Tier C (manual): none for these behaviors.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');

const { parseCsvRecords, readLookupCsv, MAX_CSV_ROWS, MAX_CSV_BYTES } = importDist('rdm/lookupCsv');

const HEADER = 'code,type,enabled,startDate,endDate,sourceMappings.source,sourceMappings.code,sourceMappings.value';
const COLS = HEADER.split(',');
const ORG = 'rdm/lookupTypes/OrganizationStatuses';
const row = fields => COLS.map(c => fields[c] ?? '').join(',');
const file = (...rows) => [HEADER, ...rows].join('\n');
const csv = text => readLookupCsv(text, Buffer.byteLength(text));

// ---------------------------------------------------------------------------
// RDM-001 — RFC 4180 records and their start lines
// ---------------------------------------------------------------------------

// A lone CR ends a record (pinned current behavior).
{
	const { records } = parseCsvRecords('h\ra\rb');
	assert.deepStrictEqual(records, [
		{ line: 1, fields: ['h'] },
		{ line: 2, fields: ['a'] },
		{ line: 3, fields: ['b'] },
	], 'RDM-001 #6: a lone CR ends a record and advances the line');
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
	const [a] = out.types[0].values;
	assert.strictEqual(a.mappings.length, 1, 'RDM-001 #12: the repeated mapping is not added to the draft');
	assert.deepStrictEqual([a.enabled, a.startDate, a.endDate], [true, undefined, undefined],
		'RDM-001 #13: only the first row sets the code fields');
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

	const small = file(...rows(2));
	let atBytes;
	assert.doesNotThrow(() => { atBytes = readLookupCsv(small, MAX_CSV_BYTES); }, 'RDM-010 #3: the byte limit itself never throws');
	assert.strictEqual(limitError(atBytes), undefined, `RDM-010 #3: exactly ${MAX_CSV_BYTES} bytes are accepted`);
	assert.strictEqual(atBytes.types[0].values.length, 2, 'RDM-010 #3: a file at the byte limit is read');
}

console.log('test-rdm-csv-parsing: OK');
