import * as vscode from 'vscode';

let currentPanel: vscode.WebviewPanel | undefined;

interface GuideStep {
	id: string;
	number: number;
	icon: string;
	title: string;
	body: string;
}

interface GuideContent {
	title: string;
	subtitle: string;
	steps: GuideStep[];
	footer: string;
}

export function openSetupGuidePanel(context: vscode.ExtensionContext): void {
	if (currentPanel) {
		currentPanel.reveal(vscode.ViewColumn.One);
		return;
	}

	const resourcesRoot = vscode.Uri.joinPath(context.extensionUri, 'resources');
	const codiconRoot = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');

	const panel = vscode.window.createWebviewPanel(
		'reltio.setupGuide',
		'Reltio Setup Guide',
		vscode.ViewColumn.One,
		{
			enableScripts: false,
			retainContextWhenHidden: true,
			localResourceRoots: [resourcesRoot, codiconRoot],
		},
	);

	panel.iconPath = new vscode.ThemeIcon('book');

	void loadAndRender(panel, context);

	panel.onDidDispose(() => {
		currentPanel = undefined;
	}, null, context.subscriptions);

	currentPanel = panel;
}

async function loadAndRender(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): Promise<void> {
	const contentUri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'setupGuide.json');
	let content: GuideContent;
	try {
		const bytes = await vscode.workspace.fs.readFile(contentUri);
		content = JSON.parse(new TextDecoder('utf-8').decode(bytes)) as GuideContent;
	} catch (e) {
		panel.webview.html = renderErrorHtml((e as Error).message);
		return;
	}

	const codiconCssUri = panel.webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
	);
	panel.webview.html = renderHtml(content, panel.webview, codiconCssUri);
}

function renderHtml(content: GuideContent, webview: vscode.Webview, codiconCssUri: vscode.Uri): string {
	const csp = [
		"default-src 'none'",
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`font-src ${webview.cspSource}`,
		`img-src ${webview.cspSource} https:`,
	].join('; ');

	const stepsHtml = content.steps.map(step => `
		<li class="step-card">
			<div class="step-card__chip">
				<span class="step-card__number">${step.number}</span>
				<i class="codicon codicon-${escapeAttribute(step.icon)}" aria-hidden="true"></i>
			</div>
			<div class="step-card__body">
				<h2 class="step-card__title">${escapeText(step.title)}</h2>
				<div class="step-card__content">${step.body}</div>
			</div>
		</li>
	`).join('\n');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<link rel="stylesheet" href="${codiconCssUri}" />
	<title>${escapeText(content.title)}</title>
	<style>
		:root {
			/* Reltio brand accent — kept constant across themes for brand recognition. */
			--reltio-primary: #0072CE;
			--reltio-primary-light: rgba(0, 114, 206, 0.12);

			/* Theme-aware base — uses VS Code / Cursor's currently-selected theme. */
			--bg: var(--vscode-editor-background);
			--bg-card: var(--vscode-editorWidget-background, var(--vscode-editor-background));
			--text-primary: var(--vscode-foreground);
			--text-secondary: var(--vscode-descriptionForeground, var(--vscode-foreground));
			--border: var(--vscode-editorWidget-border, var(--vscode-panel-border, rgba(127, 127, 127, 0.2)));

			--font-family: 'Roboto', 'Helvetica', 'Arial', var(--vscode-font-family);

			--spacing-xs: 4px;
			--spacing-sm: 8px;
			--spacing-md: 12px;
			--spacing-lg: 16px;
			--spacing-xl: 24px;
			--spacing-2xl: 32px;
			--spacing-3xl: 48px;

			--radius-md: 4px;
			--radius-lg: 6px;
			--radius-pill: 24px;

			/* Shadow toned for both themes (works on light + dark). */
			--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.18),
			               0 1px 1px rgba(0, 0, 0, 0.12);
		}
		/* On dark themes, lighten the card slightly above the editor background so it stands out. */
		body.vscode-dark .step-card,
		body.vscode-high-contrast .step-card {
			background: rgba(255, 255, 255, 0.04);
		}
		* { box-sizing: border-box; }
		body {
			font-family: var(--font-family);
			font-size: 14px;
			line-height: 1.55;
			color: var(--text-primary);
			background: var(--bg);
			margin: 0;
			padding: var(--spacing-2xl) clamp(var(--spacing-lg), 5vw, var(--spacing-3xl));
			max-width: 64rem;
			-webkit-font-smoothing: antialiased;
		}
		h1.guide-title {
			font-size: 28px;
			font-weight: 400;
			color: var(--reltio-primary);
			margin: 0 0 var(--spacing-sm);
			letter-spacing: 0.00938em;
		}
		.guide-subtitle {
			color: var(--text-secondary);
			margin: 0 0 var(--spacing-2xl);
			font-size: 14px;
			max-width: 50rem;
		}
		ol.steps {
			list-style: none;
			padding: 0;
			margin: 0;
			display: grid;
			gap: var(--spacing-lg);
		}
		.step-card {
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			box-shadow: var(--shadow-card);
			padding: var(--spacing-xl);
			display: grid;
			grid-template-columns: 84px 1fr;
			gap: var(--spacing-xl);
			align-items: start;
		}
		.step-card__chip {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--spacing-sm);
		}
		.step-card__number {
			width: 36px;
			height: 36px;
			border-radius: 50%;
			background: var(--reltio-primary);
			color: white;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 16px;
			font-weight: 500;
		}
		.step-card__chip .codicon {
			color: var(--reltio-primary);
			font-size: 28px;
		}
		.step-card__body {
			min-width: 0;
		}
		.step-card__title {
			font-size: 18px;
			font-weight: 500;
			color: var(--text-primary);
			margin: 0 0 var(--spacing-md);
			line-height: 1.4;
		}
		.step-card__content p {
			margin: 0 0 var(--spacing-md);
		}
		.step-card__content p:last-child {
			margin-bottom: 0;
		}
		.step-card__content ul,
		.step-card__content ol {
			margin: var(--spacing-sm) 0 var(--spacing-md);
			padding-left: var(--spacing-xl);
		}
		.step-card__content li {
			margin-bottom: var(--spacing-xs);
		}
		.step-card__content li:last-child {
			margin-bottom: 0;
		}
		.step-card__content code {
			background: var(--reltio-primary-light);
			color: var(--reltio-primary);
			padding: 0.15em 0.4em;
			border-radius: var(--radius-md);
			font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
			font-size: 0.9em;
		}
		.step-card__content strong {
			font-weight: 500;
			color: var(--text-primary);
		}
		footer.guide-footer {
			margin-top: var(--spacing-2xl);
			padding-top: var(--spacing-lg);
			border-top: 1px solid var(--border);
			color: var(--text-secondary);
			font-size: 13px;
		}
		footer.guide-footer strong {
			color: var(--reltio-primary);
			font-weight: 500;
		}
	</style>
</head>
<body>
	<h1 class="guide-title">${escapeText(content.title)}</h1>
	<p class="guide-subtitle">${escapeText(content.subtitle)}</p>
	<ol class="steps">
		${stepsHtml}
	</ol>
	<footer class="guide-footer">${content.footer}</footer>
</body>
</html>`;
}

function renderErrorHtml(message: string): string {
	return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 2rem;">
		<h2>Could not load Setup Guide</h2>
		<p>${escapeText(message)}</p>
		<p>The content file <code>resources/setupGuide.json</code> may be missing or invalid JSON.</p>
	</body></html>`;
}

function escapeText(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttribute(s: string): string {
	return s.replace(/[^a-zA-Z0-9-]/g, '');
}
