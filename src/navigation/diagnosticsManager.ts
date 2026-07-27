import * as vscode from 'vscode';
import type { UriIndex } from './uriIndex';

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	information: vscode.DiagnosticSeverity.Information,
	hint: vscode.DiagnosticSeverity.Hint,
};

export class DiagnosticsManager {
	private readonly collection: vscode.DiagnosticCollection;

	constructor() {
		this.collection = vscode.languages.createDiagnosticCollection('reltio-uri');
	}

	update(document: vscode.TextDocument, index: UriIndex): void {
		const severitySetting = vscode.workspace
			.getConfiguration('reltio')
			.get<string>('unresolvedUriSeverity', 'warning');

		if (severitySetting === 'off') {
			this.collection.set(document.uri, []);
			return;
		}

		const severity = SEVERITY_MAP[severitySetting] ?? vscode.DiagnosticSeverity.Warning;
		const unresolved = index.getAllUnresolved();
		const diagnostics: vscode.Diagnostic[] = [];

		for (const { uri, node } of unresolved) {
			const start = document.positionAt(node.offset + 1);
			const end = document.positionAt(node.offset + node.length - 1);
			const range = new vscode.Range(start, end);
			const diag = new vscode.Diagnostic(range, `Unresolved URI: ${uri}`, severity);
			diag.source = 'reltio';
			diagnostics.push(diag);
		}

		this.collection.set(document.uri, diagnostics);
	}

	clear(uri: vscode.Uri): void {
		this.collection.delete(uri);
	}

	dispose(): void {
		this.collection.dispose();
	}
}
