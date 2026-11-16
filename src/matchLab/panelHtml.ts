import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MATCH_LAB_ENGINE_VERSION } from './defaults';
import { MATCH_LAB_DIRNAME, MATCHING_PIPELINE_GATE_FILENAME } from './matchingGate';
import { AGENT_SUGGESTIONS_SUFFIX, FILL_RATE_CACHE_SUFFIX, readAgentSuggestions } from './sidecar';
import { applyAgentSuggestions } from './workbook';
import type { EntityWorkbook } from './workbook';

export const META_TABS = [
	'Rule Activity',
	'Rule Overlap',
	'By Profile',
	'How to use',
	'Suggested Changes',
] as const;

export async function loadEntityWorkbooks(tenantRoot: string): Promise<EntityWorkbook[]> {
	const dir = path.join(tenantRoot, MATCH_LAB_DIRNAME);
	let names: string[] = [];
	try {
		names = await fs.readdir(dir);
	} catch {
		return [];
	}
	const workbooks: EntityWorkbook[] = [];
	for (const name of names) {
		if (!name.endsWith('.json') || name === MATCHING_PIPELINE_GATE_FILENAME) continue;
		// Companion sidecars share the directory but are not workbooks.
		if (name.endsWith(FILL_RATE_CACHE_SUFFIX) || name.endsWith(AGENT_SUGGESTIONS_SUFFIX)) {
			continue;
		}
		try {
			const text = await fs.readFile(path.join(dir, name), 'utf8');
			const parsed = JSON.parse(text) as EntityWorkbook;
			// A sidecar from an older engine uses different tab and column names; showing it
			// beside a current one is what made a scoped run look tenant-wide.
			if (
				parsed
				&& typeof parsed.entityType === 'string'
				&& Array.isArray(parsed.tabOrder)
				&& parsed.engineVersion === MATCH_LAB_ENGINE_VERSION
			) {
				// The skill's proposals and an imported analyzer result both land here, so
				// reopening the panel is enough to see them — no re-run needed.
				workbooks.push(
					applyAgentSuggestions(parsed, await readAgentSuggestions(tenantRoot, parsed.entityType)),
				);
			}
		} catch {
			/* skip unreadable sidecar */
		}
	}
	workbooks.sort((a, b) => a.entityType.localeCompare(b.entityType));
	return workbooks;
}

export function tabsForWorkbook(workbook: EntityWorkbook): string[] {
	return workbook.tabOrder.filter(name => name in (workbook.tabs ?? {}));
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function embedJson(data: unknown): string {
	return JSON.stringify(data).replace(/</g, '\\u003c');
}

export interface MatchLabShellParams {
	nonce: string;
	csp: string;
	scriptSrc?: string;
	cssText?: string;
	workbooks: EntityWorkbook[];
	selectedEntity?: string;
}

/**
 * Nonced HTML shell. Tab labels are in the document so tests can assert without JS.
 * `default-src 'none'`; styles and scripts use the nonce.
 */
export function matchLabShellHtml(params: MatchLabShellParams): string {
	const selected =
		params.workbooks.find(w => w.entityType === params.selectedEntity) ?? params.workbooks[0];
	const tabNames = selected ? tabsForWorkbook(selected) : [];
	const picker =
		params.workbooks.length > 1
			? `<label class="picker">Entity
<select id="entity-picker">${params.workbooks
					.map(
						w =>
							`<option value="${escapeHtml(w.entityType)}"${w === selected ? ' selected' : ''}>${escapeHtml(w.entityType)}</option>`,
					)
					.join('')}</select></label>`
			// A single entity type is already named in the heading, so repeating it in the
			// toolbar beside the rule picker was noise.
			: '';
	const tabs = tabNames
		.map(
			(name, i) =>
				`<button type="button" class="tab${i === 0 ? ' active' : ''}" data-tab="${escapeHtml(name)}">${escapeHtml(name)}</button>`,
		)
		.join('');
	const style = params.cssText
		? `<style nonce="${params.nonce}">${params.cssText}</style>`
		: '';
	const script = params.scriptSrc
		? `<script nonce="${params.nonce}" src="${params.scriptSrc}"></script>`
		: '';
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${params.csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Match Lab</title>
	${style}
</head>
<body>
	<div class="shell">
		<header>
			<h1 id="panel-title">Match Lab${selected ? ` — ${escapeHtml(selected.entityType)}` : ''}</h1>
			<div class="toolbar">
				${picker}
				<label class="picker" id="rule-picker-wrap" hidden>Rule
					<select id="rule-picker"></select>
				</label>
				<input id="row-filter" type="search" placeholder="Filter rows" hidden>
			</div>
			<nav class="tab-bar" id="tab-bar">${tabs}</nav>
		</header>
		<main id="sheet"></main>
	</div>
	<script nonce="${params.nonce}" type="application/json" id="match-lab-data">${embedJson({
		workbooks: params.workbooks,
		selectedEntity: selected?.entityType ?? '',
	})}</script>
	${script}
</body>
</html>`;
}

export function matchLabCsp(nonce: string): string {
	return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
}
