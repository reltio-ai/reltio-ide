import * as vscode from 'vscode';

export interface EntityDetailContext {
	environmentName: string;
	tenantId: string;
	entityTypeLabel: string;
}

let currentPanel: vscode.WebviewPanel | undefined;
let currentPanelDisposables: vscode.Disposable[] = [];

export function showEntityDetailPanel(
	entity: unknown,
	context: EntityDetailContext,
): void {
	const label = stringProp(entity, 'label') || shortUri(stringProp(entity, 'uri')) || 'Entity';
	const title = `Entity: ${label}`;
	if (currentPanel) {
		currentPanel.title = title;
		currentPanel.reveal(vscode.ViewColumn.Beside);
	} else {
		currentPanel = vscode.window.createWebviewPanel(
			'reltioEntityDetail',
			title,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			},
		);
		currentPanel.onDidDispose(() => {
			currentPanel = undefined;
			for (const disposable of currentPanelDisposables) {
				disposable.dispose();
			}
			currentPanelDisposables = [];
		});
		currentPanelDisposables.push(
			currentPanel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
				if (msg.type === 'copy' && typeof msg.text === 'string') {
					await vscode.env.clipboard.writeText(msg.text);
					void vscode.window.setStatusBarMessage('Copied entity detail value.', 2000);
				}
			}),
		);
	}
	currentPanel.webview.html = renderEntityHtml(entity, context);
}

interface WebviewMessage {
	type: string;
	text?: string;
}

function renderEntityHtml(
	entity: unknown,
	context: EntityDetailContext,
): string {
	const nonce = getNonce();
	const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
	const uri = stringProp(entity, 'uri') || '';
	const label = stringProp(entity, 'label') || shortUri(uri) || 'Entity';
	const type = stringProp(entity, 'type') || '';
	const updatedTime = stringProp(entity, 'updatedTime') || stringProp(entity, 'updateDate') || '';
	const createdTime = stringProp(entity, 'createdTime') || stringProp(entity, 'createDate') || '';
	const attributes = getRecord(entity, 'attributes');
	const crosswalks = Array.isArray(getValue(entity, 'crosswalks')) ? getValue(entity, 'crosswalks') as unknown[] : [];
	const tags = [
		context.environmentName,
		context.tenantId,
		context.entityTypeLabel,
	].filter(Boolean);

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(label)}</title>
	<style nonce="${nonce}">
		:root {
			color-scheme: light dark;
			--bg: var(--vscode-editor-background);
			--fg: var(--vscode-editor-foreground);
			--muted: var(--vscode-descriptionForeground);
			--border: var(--vscode-panel-border);
			--surface: var(--vscode-sideBar-background);
			--surface2: var(--vscode-input-background);
			--accent: var(--vscode-focusBorder);
			--link: var(--vscode-textLink-foreground);
			--code: var(--vscode-textCodeBlock-background);
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			background: var(--bg);
			color: var(--fg);
			font: 13px/1.45 var(--vscode-font-family);
		}
		.shell {
			display: grid;
			grid-template-rows: auto 1fr;
			min-height: 100vh;
		}
		header {
			border-bottom: 1px solid var(--border);
			background: var(--surface);
			padding: 14px 18px 12px;
		}
		h1 {
			font-size: 20px;
			font-weight: 600;
			margin: 0 0 6px;
			line-height: 1.2;
		}
		.uri {
			color: var(--muted);
			font-family: var(--vscode-editor-font-family);
			word-break: break-all;
		}
		.tags {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-top: 10px;
		}
		.tag {
			border: 1px solid var(--border);
			background: var(--surface2);
			border-radius: 4px;
			padding: 2px 6px;
			color: var(--muted);
		}
		main {
			padding: 16px 18px 28px;
			display: grid;
			gap: 14px;
			max-width: 1200px;
			width: 100%;
		}
		.toolbar {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		button {
			border: 1px solid var(--border);
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border-radius: 4px;
			padding: 5px 9px;
			font: inherit;
			cursor: pointer;
		}
		button:hover { background: var(--vscode-button-secondaryHoverBackground); }
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
			gap: 10px;
		}
		.card, details {
			border: 1px solid var(--border);
			border-radius: 6px;
			background: var(--surface);
		}
		.card { padding: 10px 12px; }
		.k { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
		.v { word-break: break-word; font-family: var(--vscode-editor-font-family); }
		details { overflow: hidden; }
		summary {
			cursor: pointer;
			padding: 9px 12px;
			background: var(--surface2);
			border-bottom: 1px solid var(--border);
			font-weight: 600;
		}
		details:not([open]) summary { border-bottom: 0; }
		table {
			width: 100%;
			border-collapse: collapse;
		}
		th, td {
			text-align: left;
			vertical-align: top;
			border-bottom: 1px solid var(--border);
			padding: 7px 10px;
		}
		th {
			color: var(--muted);
			font-size: 12px;
			font-weight: 600;
			background: var(--surface);
			position: sticky;
			top: 0;
		}
		tr:last-child td { border-bottom: 0; }
		.attr-name {
			font-family: var(--vscode-editor-font-family);
			white-space: nowrap;
			width: 220px;
		}
		.value-list {
			display: grid;
			gap: 5px;
		}
		.value {
			display: inline-block;
			max-width: 100%;
			word-break: break-word;
			font-family: var(--vscode-editor-font-family);
		}
		.value.ov::before {
			content: "OV";
			display: inline-block;
			margin-right: 6px;
			padding: 0 4px;
			border-radius: 3px;
			background: var(--accent);
			color: var(--vscode-button-foreground);
			font-family: var(--vscode-font-family);
			font-size: 10px;
			line-height: 16px;
		}
		.meta {
			color: var(--muted);
			font-size: 12px;
			margin-top: 2px;
		}
		pre {
			display: none;
			margin: 0;
			white-space: pre-wrap;
			word-break: break-word;
			background: var(--code);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 12px;
			font-family: var(--vscode-editor-font-family);
			font-size: var(--vscode-editor-font-size);
		}
		pre.visible { display: block; }
		.empty {
			color: var(--muted);
			padding: 12px;
		}
	</style>
</head>
<body>
	<div class="shell">
		<header>
			<h1>${escapeHtml(label)}</h1>
			<div class="uri">${escapeHtml(uri)}</div>
			<div class="tags">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
		</header>
		<main>
			<div class="toolbar">
				<button id="copyUri" ${uri ? '' : 'disabled'}>Copy URI</button>
				<button id="copyJson">Copy JSON</button>
				<button id="toggleRaw">Raw JSON</button>
			</div>
			<section class="grid">
				${infoCard('Type', type)}
				${infoCard('Created', formatTime(createdTime))}
				${infoCard('Updated', formatTime(updatedTime))}
				${infoCard('Crosswalks', String(crosswalks.length))}
			</section>
			${renderAttributes(attributes)}
			${renderCrosswalks(crosswalks)}
			<pre id="raw">${escapeHtml(JSON.stringify(entity, null, 2))}</pre>
		</main>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const uri = ${JSON.stringify(uri)};
		const json = ${JSON.stringify(JSON.stringify(entity, null, 2))};
		document.getElementById('copyUri')?.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: uri }));
		document.getElementById('copyJson')?.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: json }));
		document.getElementById('toggleRaw')?.addEventListener('click', () => document.getElementById('raw')?.classList.toggle('visible'));
	</script>
</body>
</html>`;
}

function renderAttributes(attributes: Record<string, unknown> | undefined): string {
	if (!attributes || Object.keys(attributes).length === 0) {
		return `<details open><summary>Attributes (0)</summary><div class="empty">No attributes returned for this entity.</div></details>`;
	}
	const rows = Object.entries(attributes)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => renderAttributeRow(name, value))
		.join('');
	return `<details open><summary>Attributes (${Object.keys(attributes).length})</summary><table><thead><tr><th>Attribute</th><th>Values</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function renderAttributeRow(name: string, value: unknown): string {
	const values = Array.isArray(value) ? value : [value];
	const rendered = values.map(renderAttributeValue).join('');
	return `<tr><td class="attr-name">${escapeHtml(name)}</td><td><div class="value-list">${rendered}</div></td></tr>`;
}

function renderAttributeValue(value: unknown): string {
	const display = attributeDisplayValue(value);
	const ov = getBoolean(value, 'ov');
	const uri = stringProp(value, 'uri');
	const source = firstString([stringProp(value, 'type'), stringProp(value, 'source'), stringProp(value, 'sourceType')]);
	const meta = [uri, source].filter(Boolean).join(' · ');
	return `<div><span class="value${ov ? ' ov' : ''}">${escapeHtml(display)}</span>${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}</div>`;
}

function attributeDisplayValue(value: unknown): string {
	if (value == null) return '';
	if (typeof value !== 'object') return String(value);
	const record = value as Record<string, unknown>;
	if ('value' in record) return stringifyValue(record.value);
	if ('label' in record) return stringifyValue(record.label);
	if ('refEntity' in record) return stringifyValue(record.refEntity);
	return stringifyValue(record);
}

function renderCrosswalks(crosswalks: unknown[]): string {
	if (crosswalks.length === 0) return '';
	const rows = crosswalks.map(cw => {
		const type = stringProp(cw, 'type') || '';
		const value = stringProp(cw, 'value') || '';
		const sourceTable = stringProp(cw, 'sourceTable') || '';
		const uri = stringProp(cw, 'uri') || '';
		return `<tr><td>${escapeHtml(type)}</td><td>${escapeHtml(value)}</td><td>${escapeHtml(sourceTable)}</td><td>${escapeHtml(uri)}</td></tr>`;
	}).join('');
	return `<details><summary>Crosswalks (${crosswalks.length})</summary><table><thead><tr><th>Type</th><th>Value</th><th>Source Table</th><th>URI</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function infoCard(label: string, value: string): string {
	return `<div class="card"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value || '-')}</div></div>`;
}

function formatTime(value: string): string {
	if (!value) return '';
	const asNumber = Number(value);
	const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

function getValue(value: unknown, key: string): unknown {
	if (!value || typeof value !== 'object') return undefined;
	return (value as Record<string, unknown>)[key];
}

function getRecord(value: unknown, key: string): Record<string, unknown> | undefined {
	const child = getValue(value, key);
	return child && typeof child === 'object' && !Array.isArray(child)
		? child as Record<string, unknown>
		: undefined;
}

function stringProp(value: unknown, key: string): string | undefined;
function stringProp(value: unknown): string | undefined;
function stringProp(value: unknown, key?: string): string | undefined {
	const candidate = key ? getValue(value, key) : value;
	if (typeof candidate === 'string') return candidate;
	if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
	return undefined;
}

function getBoolean(value: unknown, key: string): boolean {
	return getValue(value, key) === true;
}

function firstString(values: Array<string | undefined>): string | undefined {
	return values.find(Boolean);
}

function stringifyValue(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value);
}

function shortUri(uri: string | undefined): string | undefined {
	if (!uri) return undefined;
	return uri.split('/').pop();
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getNonce(): string {
	let text = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
