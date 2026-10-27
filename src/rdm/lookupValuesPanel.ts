import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { RdmLookupValueRow } from '../model/types';

export interface LookupValuesContext {
	environmentName: string;
	tenantId: string;
	rdmTenantId: string;
	lookupTypeName: string;
}

// One reusable panel, as in `entityDetailPanel`: this is a viewer, not a
// document, so opening another lookup type retitles and repopulates it rather
// than accumulating tabs the user then has to manage.
let currentPanel: vscode.WebviewPanel | undefined;

export function showLookupValuesPanel(
	rows: RdmLookupValueRow[],
	rawResponse: unknown,
	context: LookupValuesContext,
): void {
	const title = `Lookup: ${context.lookupTypeName}`;
	if (currentPanel) {
		currentPanel.title = title;
		currentPanel.reveal(vscode.ViewColumn.Beside);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			'reltioRdmLookupValues',
			title,
			vscode.ViewColumn.Beside,
			{
				// No scripts are needed to render a static table; keeping this off
				// means the CSP below has nothing to allow.
				enableScripts: false,
				retainContextWhenHidden: true,
			},
		);
		currentPanel.onDidDispose(() => {
			currentPanel = undefined;
		});
	}
	currentPanel.webview.html = renderLookupValuesHtml(rows, rawResponse, context);
}

export function renderLookupValuesHtml(
	rows: RdmLookupValueRow[],
	rawResponse: unknown,
	context: LookupValuesContext,
): string {
	const nonce = getNonce();
	// Nothing is loaded from anywhere, and the only style is the inline block
	// below — matching the hardening applied to the extension's other webviews.
	const csp = `default-src 'none'; style-src 'nonce-${nonce}';`;

	const body = rows.length === 0
		? `<p class="empty">This lookup type has no values.</p>`
		: renderTable(rows);

	let raw: string;
	try {
		raw = JSON.stringify(rawResponse, null, 2) ?? '';
	} catch {
		raw = '';
	}

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
	</style>
</head>
<body>
	<h1>${escapeHtml(context.lookupTypeName)}</h1>
	<div class="subtitle">${escapeHtml(context.rdmTenantId)} &middot; ${escapeHtml(rowSummary(rows))}</div>
	${body}
	<details>
		<summary>Raw response</summary>
		<pre>${escapeHtml(raw)}</pre>
	</details>
</body>
</html>`;
}

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
