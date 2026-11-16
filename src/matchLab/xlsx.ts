import { deflateRawSync } from 'node:zlib';

/**
 * Writes a real .xlsx with no third-party dependency. An .xlsx is a zip of XML parts, and the
 * extension already bundles nothing for spreadsheets — pulling in a writer library for this would
 * add megabytes to the VSIX for a few hundred lines of markup.
 *
 * Strings are written inline rather than through a shared string table: the workbook is written
 * once and read by a human, so deduplicating strings would only save bytes we do not care about.
 */

export interface XlsxSheet {
	name: string;
	columns: string[];
	rows: Record<string, unknown>[];
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Style indexes into `cellXfs` below. */
const STYLE_BODY = 0;
const STYLE_HEADER = 1;
const STYLE_NUMBER = 2;

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		// Excel rejects most control characters outright rather than ignoring them.
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnRef(index: number): string {
	let n = index;
	let ref = '';
	do {
		ref = String.fromCharCode(65 + (n % 26)) + ref;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return ref;
}

/**
 * Excel forbids `[]:*?/\` in a sheet name, caps it at 31 characters, and rejects duplicates.
 * A truncated name can collide with another truncated name, so uniqueness is checked last.
 */
export function sheetName(raw: string, taken: Set<string>): string {
	const cleaned = raw.replace(/[[\]:*?/\\]/g, '-').slice(0, 31).trim() || 'Sheet';
	let name = cleaned;
	let n = 2;
	while (taken.has(name.toLowerCase())) {
		const suffix = ` (${n++})`;
		name = cleaned.slice(0, 31 - suffix.length) + suffix;
	}
	taken.add(name.toLowerCase());
	return name;
}

/**
 * Counts are written for a reader ("390,910"), which Excel would otherwise store as text and
 * refuse to sort or total. Recovering the number keeps the thousands separator as a format.
 */
function numericValue(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value !== 'string') return undefined;
	if (!/^-?\d{1,3}(?:,\d{3})+$/.test(value) && !/^-?\d+$/.test(value)) return undefined;
	const n = Number(value.replace(/,/g, ''));
	return Number.isFinite(n) ? n : undefined;
}

function cellXml(ref: string, value: unknown, header: boolean): string {
	if (header) {
		return `<c r="${ref}" s="${STYLE_HEADER}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
	}
	const num = numericValue(value);
	if (num !== undefined) return `<c r="${ref}" s="${STYLE_NUMBER}"><v>${num}</v></c>`;
	const text = value == null ? '' : String(value);
	if (text === '') return `<c r="${ref}" s="${STYLE_BODY}"/>`;
	return `<c r="${ref}" s="${STYLE_BODY}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/** Wide enough to read, narrow enough that a prose column does not push everything off-screen. */
function columnWidth(sheet: XlsxSheet, column: string): number {
	let widest = column.length;
	for (const row of sheet.rows) {
		widest = Math.max(widest, String(row[column] ?? '').length);
	}
	return Math.min(60, Math.max(10, widest + 2));
}

function worksheetXml(sheet: XlsxSheet): string {
	const cols = sheet.columns
		.map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${columnWidth(sheet, col)}" customWidth="1"/>`)
		.join('');
	const headerCells = sheet.columns.map((col, i) => cellXml(`${columnRef(i)}1`, col, true)).join('');
	const bodyRows = sheet.rows
		.map((row, r) => {
			const cells = sheet.columns
				.map((col, i) => cellXml(`${columnRef(i)}${r + 2}`, row[col], false))
				.join('');
			return `<row r="${r + 2}">${cells}</row>`;
		})
		.join('');
	const lastCol = columnRef(Math.max(0, sheet.columns.length - 1));
	// The frozen header row and the filter are what make a wide tab usable at all.
	return (
		`${XML_HEADER}<worksheet xmlns="${NS_MAIN}">` +
		`<sheetViews><sheetView workbookViewId="0">` +
		`<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
		`</sheetView></sheetViews>` +
		`<sheetFormatPr defaultRowHeight="15"/>` +
		(cols ? `<cols>${cols}</cols>` : '') +
		`<sheetData><row r="1">${headerCells}</row>${bodyRows}</sheetData>` +
		`<autoFilter ref="A1:${lastCol}1"/>` +
		`</worksheet>`
	);
}

function stylesXml(): string {
	return (
		`${XML_HEADER}<styleSheet xmlns="${NS_MAIN}">` +
		`<fonts count="2">` +
		`<font><sz val="11"/><name val="Calibri"/></font>` +
		`<font><b/><sz val="11"/><name val="Calibri"/></font>` +
		`</fonts>` +
		`<fills count="2"><fill><patternFill patternType="none"/></fill>` +
		`<fill><patternFill patternType="gray125"/></fill></fills>` +
		`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
		`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
		`<cellXfs count="3">` +
		`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
		`<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
		`<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>` +
		`</cellXfs>` +
		`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
		`</styleSheet>`
	);
}

export function xlsxParts(sheets: XlsxSheet[]): { name: string; data: Buffer }[] {
	const taken = new Set<string>();
	const named = sheets.map(s => ({ ...s, name: sheetName(s.name, taken) }));
	const styleRel = `rId${named.length + 1}`;

	const contentTypes =
		`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
		`<Default Extension="xml" ContentType="application/xml"/>` +
		`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
		`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
		named
			.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
			.join('') +
		`</Types>`;

	const rootRels =
		`${XML_HEADER}<Relationships xmlns="${NS_PKG_REL}">` +
		`<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
		`</Relationships>`;

	const workbook =
		`${XML_HEADER}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
		named
			.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
			.join('') +
		`</sheets></workbook>`;

	const workbookRels =
		`${XML_HEADER}<Relationships xmlns="${NS_PKG_REL}">` +
		named
			.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
			.join('') +
		`<Relationship Id="${styleRel}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
		`</Relationships>`;

	const utf8 = (s: string) => Buffer.from(s, 'utf8');
	return [
		{ name: '[Content_Types].xml', data: utf8(contentTypes) },
		{ name: '_rels/.rels', data: utf8(rootRels) },
		{ name: 'xl/workbook.xml', data: utf8(workbook) },
		{ name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
		{ name: 'xl/styles.xml', data: utf8(stylesXml()) },
		...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(worksheetXml(s)) })),
	];
}

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

/**
 * Minimal zip container: one deflated entry per part, then the central directory. Sizes are known
 * up front because every part is built in memory, so no data descriptors are needed.
 */
function zip(entries: { name: string; data: Buffer }[]): Buffer {
	const locals: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = Buffer.from(entry.name, 'utf8');
		const deflated = deflateRawSync(entry.data);
		const crc = crc32(entry.data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt16LE(0, 10); // time
		local.writeUInt16LE(0x21, 12); // date — fixed, so the same workbook zips byte-identically
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(deflated.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, deflated);

		const dir = Buffer.alloc(46);
		dir.writeUInt32LE(0x02014b50, 0);
		dir.writeUInt16LE(20, 4);
		dir.writeUInt16LE(20, 6);
		dir.writeUInt16LE(0x0800, 8);
		dir.writeUInt16LE(8, 10);
		dir.writeUInt16LE(0, 12);
		dir.writeUInt16LE(0x21, 14);
		dir.writeUInt32LE(crc, 16);
		dir.writeUInt32LE(deflated.length, 20);
		dir.writeUInt32LE(entry.data.length, 24);
		dir.writeUInt16LE(name.length, 28);
		dir.writeUInt32LE(0, 30); // extra + comment lengths
		dir.writeUInt16LE(0, 34);
		dir.writeUInt16LE(0, 36);
		dir.writeUInt32LE(0, 38);
		dir.writeUInt32LE(offset, 42);
		central.push(dir, name);

		offset += local.length + name.length + deflated.length;
	}

	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralBuf, end]);
}

/** One sheet per tab, in the order given. */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
	return zip(xlsxParts(sheets));
}
