import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { RdmLookupValueRow } from '../model/types';
import { parseLookupValuesMessage, type LookupValueDraft } from './lookupValueDraft';

export interface LookupValuesContext {
	environmentName: string;
	tenantId: string;
	rdmTenantId: string;
	lookupTypeName: string;
	/** The lookup type's own `uri`, sent as each added value's `type`. */
	lookupTypeUri: string;
	/** The RDM configuration the lookup type came from; its sources seed the form's suggestions. */
	rdmFileUri: vscode.Uri;
}

export interface LookupValuesView {
	rows: RdmLookupValueRow[];
	rawResponse: unknown;
	context: LookupValuesContext;
	/** Offered in the Add Value form's source fields; free text is still accepted. */
	sourceSuggestions: string[];
}

/** Blocks to put back into the form after a re-render, with the outcome message. */
export interface LookupValuesRestore {
	values: LookupValueDraft[];
	message: string;
}

/**
 * One rendered page of the panel. Each page carries a random token that its
 * script returns with every message; only the current page's token is
 * honoured, so a message posted by a page that has since been replaced can
 * never be applied to the lookup type now on screen.
 */
export interface LookupValuesRender {
	readonly token: string;
	readonly context: LookupValuesContext;
}

export type SubmitLookupValuesHandler = (render: LookupValuesRender, values: LookupValueDraft[]) => Promise<void>;

interface CurrentRender extends LookupValuesRender {
	pendingRestore?: LookupValuesRestore;
	inFlight: boolean;
}

// One reusable panel, as in `entityDetailPanel`: this is a viewer, not a
// document, so opening another lookup type retitles and repopulates it rather
// than accumulating tabs the user then has to manage.
let currentPanel: vscode.WebviewPanel | undefined;
let currentRender: CurrentRender | undefined;
let submitHandler: SubmitLookupValuesHandler | undefined;

/** The extension's handler for Add Value submissions; registered once at activation. */
export function setLookupValuesSubmitHandler(handler: SubmitLookupValuesHandler): void {
	submitHandler = handler;
}

export function showLookupValuesPanel(view: LookupValuesView, restore?: LookupValuesRestore): LookupValuesRender {
	const title = `Lookup: ${view.context.lookupTypeName}`;
	if (currentPanel) {
		currentPanel.title = title;
		currentPanel.reveal(vscode.ViewColumn.Beside);
	} else {
		const panel = vscode.window.createWebviewPanel(
			'reltioRdmLookupValues',
			title,
			vscode.ViewColumn.Beside,
			{
				// One nonce'd inline script drives the Add Value form; the page
				// loads no files, so no local resource is reachable.
				enableScripts: true,
				localResourceRoots: [],
				retainContextWhenHidden: true,
			},
		);
		const subscription = panel.webview.onDidReceiveMessage(message => handleMessage(message));
		panel.onDidDispose(() => {
			subscription.dispose();
			currentPanel = undefined;
			currentRender = undefined;
		});
		currentPanel = panel;
	}

	const render: CurrentRender = {
		token: getNonce(),
		context: view.context,
		pendingRestore: restore,
		inFlight: false,
	};
	currentRender = render;
	currentPanel.webview.html = renderLookupValuesHtml(view.rows, view.rawResponse, view.context, {
		renderToken: render.token,
		sourceSuggestions: view.sourceSuggestions,
	});
	return render;
}

/** Whether `render` is still the page on screen — false once the panel moved on or closed. */
export function isCurrentLookupValuesRender(render: LookupValuesRender): boolean {
	return !!currentPanel && currentRender?.token === render.token;
}

/** Show `message` above the form of `render`, keeping the form as it is. No-op if the page is gone. */
export function postLookupValuesResult(render: LookupValuesRender, message: string): void {
	if (currentPanel && isCurrentLookupValuesRender(render)) {
		void currentPanel.webview.postMessage({ type: 'submitResult', message });
	}
}

async function handleMessage(message: unknown): Promise<void> {
	const parsed = parseLookupValuesMessage(message);
	const render = currentRender;
	if (!parsed || !render || parsed.render !== render.token) {
		return;
	}
	if (parsed.kind === 'ready') {
		const restore = render.pendingRestore;
		render.pendingRestore = undefined;
		if (restore && currentPanel) {
			void currentPanel.webview.postMessage({ type: 'restoreForm', values: restore.values, message: restore.message });
		}
		return;
	}
	if (parsed.kind === 'rejected') {
		postLookupValuesResult(render, parsed.errors.join('\n'));
		return;
	}
	// The form disables Submit while a request is out; this is the backstop.
	if (render.inFlight || !submitHandler) {
		return;
	}
	render.inFlight = true;
	try {
		await submitHandler(render, parsed.values);
	} finally {
		render.inFlight = false;
	}
}

export interface LookupValuesRenderOptions {
	/** Token the page's script returns with every message; omitted, the page gets a fresh one. */
	renderToken?: string;
	sourceSuggestions?: string[];
}

export function renderLookupValuesHtml(
	rows: RdmLookupValueRow[],
	rawResponse: unknown,
	context: Pick<LookupValuesContext, 'rdmTenantId' | 'lookupTypeName'>,
	options: LookupValuesRenderOptions = {},
): string {
	const nonce = getNonce();
	const renderToken = options.renderToken ?? getNonce();
	// Nothing is loaded from anywhere; the only style and the only script are
	// the inline blocks below, both gated by this render's nonce — matching the
	// hardening applied to the extension's other webviews.
	const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

	const body = rows.length === 0
		? `<p class="empty">This lookup type has no values.</p>`
		: renderTable(rows);

	let raw: string;
	try {
		raw = JSON.stringify(rawResponse, null, 2) ?? '';
	} catch {
		raw = '';
	}

	const suggestions = (options.sourceSuggestions ?? [])
		.map(s => `<option value="${escapeHtml(s)}"></option>`)
		.join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(context.lookupTypeName)}</title>
	<style nonce="${nonce}">
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			padding: 12px 16px;
		}
		h1 { font-size: 1.2em; margin: 0 0 2px; }
		.subtitle {
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
			margin-bottom: 14px;
			word-break: break-all;
		}
		table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
		th, td {
			text-align: left;
			padding: 4px 10px 4px 0;
			border-bottom: 1px solid var(--vscode-panel-border);
			vertical-align: top;
		}
		th {
			font-weight: 600;
			position: sticky;
			top: 0;
			background: var(--vscode-editor-background);
		}
		tbody tr:hover { background: var(--vscode-list-hoverBackground); }
		.empty { color: var(--vscode-descriptionForeground); font-style: italic; }
		details { margin-top: 10px; }
		summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
		pre {
			background: var(--vscode-textCodeBlock-background);
			padding: 10px;
			overflow: auto;
			max-height: 420px;
		}
		button {
			font: inherit;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			border: none;
			padding: 4px 12px;
			cursor: pointer;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary {
			color: var(--vscode-button-secondaryForeground);
			background: var(--vscode-button-secondaryBackground);
		}
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		button:disabled { opacity: 0.5; cursor: default; }
		input[type="text"] {
			font: inherit;
			width: 100%;
			box-sizing: border-box;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, transparent);
			padding: 3px 5px;
		}
		.toolbar { margin-bottom: 12px; }
		.status { white-space: pre-line; padding: 6px 10px; margin-bottom: 12px; }
		.status.error {
			background: var(--vscode-inputValidation-errorBackground);
			border: 1px solid var(--vscode-inputValidation-errorBorder);
		}
		.status.info {
			background: var(--vscode-inputValidation-infoBackground);
			border: 1px solid var(--vscode-inputValidation-infoBorder);
		}
		form { margin-bottom: 18px; }
		fieldset.code-block {
			border: 1px solid var(--vscode-panel-border);
			margin: 0 0 12px;
			padding: 8px 12px;
		}
		.code-row { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
		.code-row label { display: flex; gap: 6px; align-items: center; flex: 1; }
		table.mappings { margin-bottom: 8px; }
		table.mappings th { position: static; }
		table.mappings td.flag { text-align: center; width: 1%; }
		.form-actions { display: flex; gap: 8px; }
		.form-actions .spacer { flex: 1; }
	</style>
</head>
<body data-render="${escapeHtml(renderToken)}">
	<h1>${escapeHtml(context.lookupTypeName)}</h1>
	<div class="subtitle">${escapeHtml(context.rdmTenantId)} &middot; ${escapeHtml(rowSummary(rows))}</div>
	<div class="toolbar"><button type="button" id="addValue">Add Value</button></div>
	<div id="status" class="status" role="status" hidden></div>
	<form id="addForm" hidden novalidate>
		<div id="blocks"></div>
		<div class="form-actions">
			<button type="button" id="addCode" class="secondary">Add Code</button>
			<span class="spacer"></span>
			<button type="submit" id="submit">Submit</button>
			<button type="button" id="cancel" class="secondary">Cancel</button>
		</div>
	</form>
	<datalist id="rdmSources">${suggestions}</datalist>
	${body}
	<details>
		<summary>Raw response</summary>
		<pre>${escapeHtml(raw)}</pre>
	</details>
	<template id="codeBlockTemplate">
		<fieldset class="code-block">
			<legend class="block-title"></legend>
			<div class="code-row">
				<label>Code <input type="text" class="code"></label>
				<button type="button" class="remove-code secondary">Remove code</button>
			</div>
			<table class="mappings">
				<thead><tr><th>Source</th><th>Code at source</th><th>Value</th><th>Canonical</th><th>Downstream default</th><th></th></tr></thead>
				<tbody class="mapping-rows"></tbody>
			</table>
			<button type="button" class="add-mapping secondary">Add mapping</button>
		</fieldset>
	</template>
	<template id="mappingRowTemplate">
		<tr>
			<td><input type="text" class="source" list="rdmSources" aria-label="Source"></td>
			<td><input type="text" class="mapping-code" placeholder="Same as code" aria-label="Code at source"></td>
			<td><input type="text" class="value" aria-label="Value"></td>
			<td class="flag"><input type="checkbox" class="canonical" aria-label="Canonical"></td>
			<td class="flag"><input type="checkbox" class="downstream" aria-label="Downstream default"></td>
			<td><button type="button" class="remove-mapping secondary">Remove</button></td>
		</tr>
	</template>
	<script nonce="${nonce}">${PANEL_SCRIPT}</script>
</body>
</html>`;
}

/**
 * The Add Value form. Rules it keeps:
 *   - every value from the extension or the user is set through `.value`,
 *     `.checked` or `.textContent`, never parsed as markup;
 *   - messages are trusted only from the origin observed at start
 *     (`isTrustedMessageOrigin` in `ontology/webviewMessageSafety.ts`, inlined
 *     because this script is not bundled);
 *   - validation is left to the extension, which checks a submission before
 *     any network call, so its answer is as immediate as a local check and
 *     there is one rule set rather than two that can drift.
 * No data is interpolated into this script.
 */
const PANEL_SCRIPT = `
(function () {
	'use strict';
	const vscode = acquireVsCodeApi();
	const trustedOrigin = window.origin;
	const render = document.body.dataset.render;

	const form = document.getElementById('addForm');
	const blocks = document.getElementById('blocks');
	const status = document.getElementById('status');
	const submitButton = document.getElementById('submit');
	const cancelButton = document.getElementById('cancel');
	const codeBlockTemplate = document.getElementById('codeBlockTemplate');
	const mappingRowTemplate = document.getElementById('mappingRowTemplate');

	function showStatus(message, tone) {
		status.textContent = message;
		status.className = 'status ' + tone;
		status.hidden = !message;
	}

	function setBusy(busy) {
		submitButton.disabled = busy;
		cancelButton.disabled = busy;
	}

	function addMappingRow(block, mapping) {
		const rows = block.querySelector('tbody.mapping-rows');
		const first = rows.children.length === 0;
		const row = mappingRowTemplate.content.firstElementChild.cloneNode(true);
		row.querySelector('.source').value = mapping ? mapping.source : '';
		row.querySelector('.mapping-code').value = mapping ? mapping.code : '';
		row.querySelector('.value').value = mapping ? mapping.value : '';
		row.querySelector('.canonical').checked = mapping ? mapping.canonicalValue === true : first;
		row.querySelector('.downstream').checked = mapping ? mapping.downStreamDefaultValue === true : true;
		rows.appendChild(row);
		return row;
	}

	function renumber() {
		Array.from(blocks.children).forEach(function (block, i) {
			block.querySelector('.block-title').textContent = 'Code ' + (i + 1);
		});
	}

	function addCodeBlock(value) {
		const block = codeBlockTemplate.content.firstElementChild.cloneNode(true);
		block.querySelector('.code').value = value ? value.code : '';
		blocks.appendChild(block);
		const mappings = value && Array.isArray(value.mappings) ? value.mappings : [];
		if (mappings.length === 0) {
			addMappingRow(block);
		} else {
			mappings.forEach(function (m) { addMappingRow(block, m); });
		}
		renumber();
		return block;
	}

	function collect() {
		return Array.from(blocks.children).map(function (block) {
			return {
				code: block.querySelector('.code').value,
				mappings: Array.from(block.querySelectorAll('tbody.mapping-rows > tr')).map(function (row) {
					return {
						source: row.querySelector('.source').value,
						code: row.querySelector('.mapping-code').value,
						value: row.querySelector('.value').value,
						canonicalValue: row.querySelector('.canonical').checked,
						downStreamDefaultValue: row.querySelector('.downstream').checked,
					};
				}),
			};
		});
	}

	document.getElementById('addValue').addEventListener('click', function () {
		if (form.hidden) {
			form.hidden = false;
			if (blocks.children.length === 0) addCodeBlock();
		}
		blocks.querySelector('.code').focus();
	});

	document.getElementById('addCode').addEventListener('click', function () {
		addCodeBlock().querySelector('.code').focus();
	});

	cancelButton.addEventListener('click', function () {
		form.hidden = true;
		blocks.replaceChildren();
		showStatus('', 'info');
	});

	blocks.addEventListener('click', function (event) {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const block = target.closest('.code-block');
		if (!block) return;
		if (target.classList.contains('add-mapping')) {
			addMappingRow(block).querySelector('.source').focus();
		} else if (target.classList.contains('remove-mapping')) {
			target.closest('tr').remove();
		} else if (target.classList.contains('remove-code')) {
			block.remove();
			renumber();
		}
	});

	form.addEventListener('submit', function (event) {
		event.preventDefault();
		if (submitButton.disabled) return;
		setBusy(true);
		showStatus('Submitting…', 'info');
		vscode.postMessage({ type: 'submitLookupValues', render: render, values: collect() });
	});

	window.addEventListener('message', function (event) {
		if (event.origin !== trustedOrigin) return;
		const message = event.data;
		if (!message || typeof message !== 'object' || typeof message.message !== 'string') return;
		if (message.type === 'submitResult') {
			setBusy(false);
			showStatus(message.message, 'error');
		} else if (message.type === 'restoreForm' && Array.isArray(message.values)) {
			blocks.replaceChildren();
			message.values.forEach(function (value) { addCodeBlock(value); });
			form.hidden = message.values.length === 0;
			setBusy(false);
			showStatus(message.message, message.values.length > 0 ? 'error' : 'info');
		}
	});

	vscode.postMessage({ type: 'ready', render: render });
})();
`;

function rowSummary(rows: RdmLookupValueRow[]): string {
	const codes = new Set(rows.map(r => r.code)).size;
	return `${codes} code${codes === 1 ? '' : 's'}, ${rows.length} row${rows.length === 1 ? '' : 's'}`;
}

function renderTable(rows: RdmLookupValueRow[]): string {
	const body = rows
		.map(
			r =>
				`<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.source)}</td><td>${escapeHtml(
					r.valueAtSource,
				)}</td></tr>`,
		)
		.join('');
	return `<table><thead><tr><th>Code</th><th>Source</th><th>Value at Source</th></tr></thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Same CSPRNG pattern as `entityDetailPanel` and the OAuth `state` parameter. */
function getNonce(): string {
	return crypto.randomBytes(16).toString('hex');
}
