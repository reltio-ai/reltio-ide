declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();

interface SheetTab {
	columns: string[];
	rows: Record<string, unknown>[];
	docs?: string;
}

interface EntityWorkbook {
	host: string;
	tenantId: string;
	entityType: string;
	entityTypeUri: string;
	generatedAt: string;
	tabOrder: string[];
	tabs: Record<string, SheetTab>;
}

const RULES_TAB = 'Rules';

const META_TABS = new Set([
	'Rule Activity',
	'Rule Overlap',
	'By Profile',
	'How to use',
	'Suggested Changes',
]);

const HUB_COLS = new Set(['Profile A', 'Profile B', 'Entity', 'Partner']);
const RECOMMENDATION_CLASS: Record<string, string> = {
	'The count failed — unknown, not zero': 'rec-unknown',
	'No potential matches; scope is INTERNAL': 'rec-idle-internal',
	'Cites keys hidden in L3 or absent from the mapping list': 'rec-review',
	'No potential matches': 'rec-idle',
	'Produces potential matches': 'rec-keep',
};
const NOTE_CLASS: Record<string, string> = {
	'Lab notes': 'note-lab',
};

let workbooks: EntityWorkbook[] = [];
let selectedEntity = '';
let selectedTab = '';
let selectedRule = '';
let filterText = '';

function boot(): void {
	const raw = document.getElementById('match-lab-data')?.textContent;
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as { workbooks?: EntityWorkbook[]; selectedEntity?: string };
			workbooks = parsed.workbooks ?? [];
			selectedEntity = parsed.selectedEntity || workbooks[0]?.entityType || '';
		} catch {
			workbooks = [];
		}
	}
	selectedTab = currentWorkbook()?.tabOrder[0] ?? '';
	bindChrome();
	renderSheet();
}

function currentWorkbook(): EntityWorkbook | undefined {
	return workbooks.find(w => w.entityType === selectedEntity) ?? workbooks[0];
}

function tabNames(wb: EntityWorkbook): string[] {
	return wb.tabOrder.filter(name => name in (wb.tabs ?? {}));
}

/**
 * Every rule, taken from Rule Activity so a rule that produced no pairs is still offered
 * and reads as empty rather than going missing. Falls back to the pair rows themselves.
 */
function ruleNames(wb: EntityWorkbook): string[] {
	const listed = (wb.tabs?.['Rule Activity']?.rows ?? [])
		.map(r => String(r.Rule ?? ''))
		.filter(Boolean);
	if (listed.length > 0) return [...new Set(listed)];
	return [...new Set((wb.tabs?.[RULES_TAB]?.rows ?? []).map(r => String(r.Rule ?? '')).filter(Boolean))];
}

/** The rule picker replaces the old one-tab-per-rule bar, so it shows only on Rules. */
function syncRulePicker(): void {
	const wrap = document.getElementById('rule-picker-wrap');
	const picker = document.getElementById('rule-picker') as HTMLSelectElement | null;
	const wb = currentWorkbook();
	if (!wrap || !picker) return;
	const onRules = !!wb && selectedTab === RULES_TAB && RULES_TAB in (wb.tabs ?? {});
	wrap.hidden = !onRules;
	if (!onRules || !wb) return;
	const names = ruleNames(wb);
	// One rule at a time, as the per-rule tabs did — not every pair for the entity type.
	if (!names.includes(selectedRule)) selectedRule = names[0] ?? '';
	picker.replaceChildren();
	for (const name of names) {
		const opt = document.createElement('option');
		opt.value = name;
		opt.textContent = name;
		opt.selected = name === selectedRule;
		picker.appendChild(opt);
	}
}

function clearFilter(): void {
	filterText = '';
	const filter = document.getElementById('row-filter') as HTMLInputElement | null;
	if (filter) filter.value = '';
}

function bindChrome(): void {
	const picker = document.getElementById('entity-picker') as HTMLSelectElement | null;
	if (picker) {
		picker.addEventListener('change', () => {
			selectedEntity = picker.value;
			selectedTab = currentWorkbook()?.tabOrder[0] ?? '';
			selectedRule = '';
			clearFilter();
			rebuildTabs();
			renderTitle();
			renderSheet();
		});
	}
	const rulePicker = document.getElementById('rule-picker') as HTMLSelectElement | null;
	if (rulePicker) {
		rulePicker.addEventListener('change', () => {
			selectedRule = rulePicker.value;
			// A filter aimed at the previous rule would hide every row on this one.
			clearFilter();
			renderSheet();
		});
	}
	const filter = document.getElementById('row-filter') as HTMLInputElement | null;
	if (filter) {
		filter.addEventListener('input', () => {
			filterText = filter.value.trim().toLowerCase();
			renderSheet();
		});
	}
	document.getElementById('tab-bar')?.addEventListener('click', ev => {
		const btn = (ev.target as HTMLElement).closest('button[data-tab]') as HTMLButtonElement | null;
		if (!btn) return;
		selectedTab = btn.dataset.tab ?? selectedTab;
		// A filter left over from another tab would silently hide every row here.
		clearFilter();
		selectedRule = '';
		rebuildTabs();
		renderSheet();
	});
}

/** The heading is server-rendered once, so it has to follow the picker or it goes stale. */
function renderTitle(): void {
	const title = document.getElementById('panel-title');
	if (!title) return;
	const entity = currentWorkbook()?.entityType;
	title.textContent = entity ? `Match Lab — ${entity}` : 'Match Lab';
}

function rebuildTabs(): void {
	const bar = document.getElementById('tab-bar');
	const wb = currentWorkbook();
	if (!bar || !wb) return;
	bar.replaceChildren();
	for (const name of tabNames(wb)) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = name === selectedTab ? 'tab active' : 'tab';
		btn.dataset.tab = name;
		btn.textContent = name;
		bar.appendChild(btn);
	}
}

function renderSheet(): void {
	const main = document.getElementById('sheet');
	const wb = currentWorkbook();
	if (!main || !wb) return;
	const tab = wb.tabs[selectedTab];
	const filter = document.getElementById('row-filter') as HTMLInputElement | null;
	const showFilter =
		selectedTab === 'By Profile' || !META_TABS.has(selectedTab);
	if (filter) filter.hidden = !showFilter;
	syncRulePicker();

	main.replaceChildren();
	if (!tab) {
		main.appendChild(textEl('div', 'empty', 'No data for this tab.'));
		return;
	}
	if (tab.docs) {
		const docs = textEl('pre', 'docs', tab.docs);
		main.appendChild(docs);
	}
	if (tab.rows.length === 0 && tab.docs?.startsWith('Reason: ')) return;
	const wrap = renderTable(tab, wb);
	main.appendChild(wrap);
	const table = wrap.querySelector('table');
	if (table) freezeColumns(table, frozenCount(tab, widthClasses(tab)));
}

/**
 * Width follows the widest value a column actually holds rather than a hardcoded list, so a new
 * column gets sensible treatment without anyone remembering to register it here.
 */
function widthClasses(tab: SheetTab): Record<string, string> {
	const out: Record<string, string> = {};
	for (const col of tab.columns) {
		let widest = col.length;
		for (const row of tab.rows) {
			widest = Math.max(widest, String(row[col] ?? '').length);
		}
		out[col] = widest > 60 ? 'col-prose' : widest <= 24 ? 'col-compact' : '';
	}
	return out;
}

/** `a_FirstName`, `b_FirstName` and `cmp_FirstName` belong to one attribute and share a band. */
function bandedColumns(columns: string[]): Set<string> {
	const attributeOf = (col: string) => /^(?:a|b|cmp)_(.+)$/.exec(col)?.[1];
	const order: string[] = [];
	for (const col of columns) {
		const attr = attributeOf(col);
		if (attr && !order.includes(attr)) order.push(attr);
	}
	const banded = new Set<string>();
	for (const col of columns) {
		const attr = attributeOf(col);
		if (attr && order.indexOf(attr) % 2 === 1) banded.add(col);
	}
	return banded;
}

const IDENTITY_COLUMNS = new Set([
	'Section',
	'Step',
	'Rule',
	'Rule A',
	'Rule B',
	'Profile A',
	'Profile B',
	'Entity',
	'Partner',
]);

/** The leading columns that say which row you are on — at most three, and never prose. */
function frozenCount(tab: SheetTab, widths: Record<string, string>): number {
	let n = 0;
	while (
		n < tab.columns.length &&
		n < 3 &&
		IDENTITY_COLUMNS.has(tab.columns[n]) &&
		widths[tab.columns[n]] !== 'col-prose'
	) {
		n++;
	}
	return n;
}

function renderTable(tab: SheetTab, wb: EntityWorkbook): HTMLElement {
	const wrap = document.createElement('div');
	wrap.className = 'table-wrap';
	const table = document.createElement('table');
	const widths = widthClasses(tab);
	const banded = bandedColumns(tab.columns);
	const headRow = document.createElement('tr');
	for (const col of tab.columns) {
		const th = document.createElement('th');
		th.textContent = col;
		applyColumnClasses(th, col, widths, banded);
		headRow.appendChild(th);
	}
	const thead = document.createElement('thead');
	thead.appendChild(headRow);
	table.appendChild(thead);
	const tbody = document.createElement('tbody');
	const q = filterText;
	const headColumn = META_TABS.has(selectedTab) ? tab.columns[0] : '';
	// The Rules tab holds every rule's pairs; the picker is what narrows it to one.
	const ruleFilter = selectedTab === RULES_TAB ? selectedRule : '';
	for (const row of tab.rows) {
		if (ruleFilter && String(row.Rule ?? '') !== ruleFilter) continue;
		if (q && !rowMatches(row, tab.columns, q)) continue;
		const tr = document.createElement('tr');
		if (isBlankRow(row, tab.columns)) tr.className = 'spacer';
		for (const col of tab.columns) {
			const td = cell(col, row[col], wb);
			applyColumnClasses(td, col, widths, banded);
			if (col && col === headColumn) td.classList.add('rowhead');
			tr.appendChild(td);
		}
		tbody.appendChild(tr);
	}
	table.appendChild(tbody);
	wrap.appendChild(table);
	return wrap;
}

function applyColumnClasses(
	el: HTMLTableCellElement,
	col: string,
	widths: Record<string, string>,
	banded: Set<string>,
): void {
	const noteClass = NOTE_CLASS[col];
	if (noteClass) el.classList.add(noteClass);
	const width = widths[col];
	if (width) el.classList.add(width);
	if (banded.has(col)) el.classList.add('band');
}

function isBlankRow(row: Record<string, unknown>, columns: string[]): boolean {
	return columns.every(col => String(row[col] ?? '') === '');
}

/**
 * Sticky offsets have to be measured, not assumed, because the table sizes itself to its content.
 * Freezing stops once the frozen block would eat too much of the viewport.
 */
function freezeColumns(table: HTMLTableElement, count: number): void {
	const headCells = Array.from(table.tHead?.rows[0]?.cells ?? []);
	const offsets: number[] = [];
	let left = 0;
	for (let i = 0; i < Math.min(count, headCells.length); i++) {
		if (left > 0 && left + headCells[i].offsetWidth > 420) break;
		offsets.push(left);
		left += headCells[i].offsetWidth;
	}
	if (offsets.length < 1) return;
	const rows = [table.tHead?.rows[0], ...Array.from(table.tBodies[0]?.rows ?? [])];
	for (const row of rows) {
		if (!row) continue;
		offsets.forEach((offset, i) => {
			const target = row.cells[i];
			if (!target) return;
			target.classList.add('frozen');
			target.style.left = `${offset}px`;
		});
	}
}

function rowMatches(row: Record<string, unknown>, columns: string[], q: string): boolean {
	return columns.some(col => String(row[col] ?? '').toLowerCase().includes(q));
}

function cell(
	col: string,
	value: unknown,
	wb: EntityWorkbook,
): HTMLTableCellElement {
	const td = document.createElement('td');
	if (col === 'Profiles with potential matches' && value === 'error') {
		td.classList.add('census-error');
		td.textContent = 'error';
		return td;
	}
	if (col === 'Status') {
		const label = value == null ? '' : String(value);
		td.classList.add('recommendation');
		if (label) {
			const badge = document.createElement('span');
			badge.className = `rec-badge ${RECOMMENDATION_CLASS[label] ?? ''}`.trim();
			badge.textContent = label;
			td.appendChild(badge);
		}
		return td;
	}
	const text = value == null ? '' : String(value);
	if (HUB_COLS.has(col) && text) {
		const url = hubUrl(text, wb);
		if (url) {
			td.appendChild(hubLink(labelForHub(text), url));
			return td;
		}
	}
	if (text.includes('\n')) td.classList.add('multi-line');
	td.textContent = text;
	return td;
}

function labelForHub(text: string): string {
	if (text.startsWith('http')) {
		try {
			const u = new URL(text);
			const entity = u.searchParams.get('entityUri') ?? text;
			return decodeURIComponent(entity);
		} catch {
			return text;
		}
	}
	return text;
}

function hubUrl(text: string, wb: EntityWorkbook): string | undefined {
	if (/^https?:\/\//i.test(text)) return text;
	const m = /(?:^|\/)entities\/([^/?#]+)/i.exec(text);
	if (!m) return undefined;
	const host = wb.host.replace(/^https?:\/\//i, '');
	return `https://${host}/nui/${encodeURIComponent(wb.tenantId)}/profile?entityUri=${encodeURIComponent(`entities/${m[1]}`)}`;
}

function hubLink(label: string, url: string): HTMLAnchorElement {
	const a = document.createElement('a');
	a.textContent = label;
	a.href = '#';
	a.addEventListener('click', e => {
		e.preventDefault();
		vscode.postMessage({ type: 'openExternal', url });
	});
	return a;
}

function textEl(tag: string, className: string, text: string): HTMLElement {
	const node = document.createElement(tag);
	node.className = className;
	node.textContent = text;
	return node;
}

window.addEventListener('message', event => {
	const msg = event.data as { type?: string; workbooks?: EntityWorkbook[] };
	if (msg.type === 'setWorkbooks' && msg.workbooks) {
		workbooks = msg.workbooks;
		selectedEntity = workbooks[0]?.entityType ?? '';
		selectedTab = currentWorkbook()?.tabOrder[0] ?? '';
		selectedRule = '';
		rebuildTabs();
		renderTitle();
		renderSheet();
	}
});

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot);
} else {
	boot();
}
