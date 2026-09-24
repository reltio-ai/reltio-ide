/**
 * BPMN findings as editor squiggles.
 *
 * Deliberately the same shape as `src/navigation/diagnosticsManager.ts`, which
 * does this for Business Config JSON: own collection, a severity setting that
 * understands `off`, `clear` on close and `dispose` on deactivate. Two
 * diagnostics hosts that differ for no reason are two things to audit instead of
 * one — the differences that do exist are noted below.
 *
 * Separate collection (`reltio-bpmn`, not `reltio-uri`) so a user can tell the
 * two apart in the Problems panel and so clearing one never clears the other.
 */
import * as vscode from 'vscode';
import { analyseBpmn, type BpmnFindingSeverity } from './bpmnDiagnostics';
import { processIdFromBpmnFileName } from '../workspace/workflowBpmnFiles';

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	information: vscode.DiagnosticSeverity.Information,
	hint: vscode.DiagnosticSeverity.Hint,
};

/**
 * Whether this document is a local BPMN worth checking.
 *
 * `processIdFromBpmnFileName` is the filter because it already answers both
 * questions this needs: it returns `undefined` for a `.bpmn20.baseline.xml` — a
 * baseline is a record of what the tenant has, so squiggling it would be
 * reporting someone else's file back at the user — and for anything whose stem
 * is not a valid process id. What it returns is the id the file name claims,
 * which is exactly what the id/file-name rule compares against.
 */
export function bpmnProcessIdForDocument(document: vscode.TextDocument): string | undefined {
	const fileName = document.uri.path.split('/').pop();
	return fileName ? processIdFromBpmnFileName(fileName) : undefined;
}

export class BpmnDiagnosticsManager {
	private readonly collection: vscode.DiagnosticCollection;

	constructor() {
		this.collection = vscode.languages.createDiagnosticCollection('reltio-bpmn');
	}

	update(document: vscode.TextDocument): void {
		const fileProcessId = bpmnProcessIdForDocument(document);
		if (fileProcessId === undefined) return;

		const configured = vscode.workspace
			.getConfiguration('reltio')
			.get<string>('bpmnDiagnosticsSeverity', 'warning');

		if (configured === 'off') {
			this.collection.set(document.uri, []);
			return;
		}

		const diagnostics = analyseBpmn(document.getText(), { fileProcessId }).map(finding => {
			const range = new vscode.Range(
				document.positionAt(finding.offset),
				document.positionAt(finding.offset + finding.length),
			);
			const diagnostic = new vscode.Diagnostic(
				range,
				finding.message,
				resolveSeverity(finding.severity, configured),
			);
			diagnostic.source = 'reltio';
			diagnostic.code = finding.code;
			return diagnostic;
		});

		this.collection.set(document.uri, diagnostics);
	}

	clear(uri: vscode.Uri): void {
		this.collection.delete(uri);
	}

	dispose(): void {
		this.collection.dispose();
	}
}

/**
 * The setting governs the advisory rules only; a hard failure is always an error.
 *
 * This is the one behavioural difference from the JSON manager, which has a
 * single kind of finding and so maps the setting straight onto it. Here the rules
 * already distinguish "Activiti will reject this file" from "this is unusual, and
 * a customer JAR would make it legal". Letting the setting demote the first kind
 * would offer a way to hide a deploy that is going to fail, which is not what
 * turning the noise down should mean. So the setting moves the advisory findings
 * and leaves the definite ones alone.
 */
function resolveSeverity(
	severity: BpmnFindingSeverity,
	configured: string,
): vscode.DiagnosticSeverity {
	if (severity === 'error') return vscode.DiagnosticSeverity.Error;
	return SEVERITY_MAP[configured] ?? vscode.DiagnosticSeverity.Warning;
}
