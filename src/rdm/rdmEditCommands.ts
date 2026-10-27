import * as vscode from 'vscode';
import { parseRdmDocument } from '../parser/configParser';
import { insertIntoArray } from '../commands/editCommands';
import { revealInsertionInEditor } from '../commands/revealInsertion';
import { nextDefaultLabel } from '../commands/elementSkeletons';
import {
	RDM_CREATABLE_ROOT_KEYS,
	buildRdmLookupTypeObject,
	buildRdmSourceObject,
	labelsFromRdmLookupTypes,
	labelsFromRdmSources,
} from './rdmSkeletons';

/**
 * Insert a new entry into one section of an RDM configuration document.
 *
 * Reuses the L3 insertion machinery, which is document-agnostic, but passes
 * `RDM_CREATABLE_ROOT_KEYS` so only `lookupTypes` and `sources` can be brought
 * into existence here — the L3 allowlist happens to share `sources` and would
 * otherwise create the wrong impression that it works for `lookupTypes` too.
 */
async function insertRdmEntry(
	rdmFileUri: vscode.Uri,
	sectionKey: 'lookupTypes' | 'sources',
	prefix: string,
	build: (label: string) => Record<string, unknown>,
	existingLabels: (model: ReturnType<typeof parseRdmDocument>['model']) => string[],
): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(rdmFileUri);
	const { model, ast } = parseRdmDocument(document.getText());
	if (!ast) {
		void vscode.window.showErrorMessage(
			'This RDM configuration is not valid JSON. Fix the file before adding to it.',
		);
		return false;
	}

	const label = nextDefaultLabel(prefix, existingLabels(model));
	const jsonText = JSON.stringify(build(label), null, 2);
	const section = model[sectionKey];
	const newIndex = Array.isArray(section) ? section.length : 0;

	const ok = await insertIntoArray(
		rdmFileUri,
		ast,
		[sectionKey],
		jsonText,
		RDM_CREATABLE_ROOT_KEYS,
	);
	if (ok) {
		await revealInsertionInEditor(rdmFileUri, [sectionKey, newIndex]);
	}
	return ok;
}

export async function addRdmLookupType(rdmFileUri: vscode.Uri): Promise<boolean> {
	return insertRdmEntry(
		rdmFileUri,
		'lookupTypes',
		'LookupType',
		buildRdmLookupTypeObject,
		labelsFromRdmLookupTypes,
	);
}

export async function addRdmSource(rdmFileUri: vscode.Uri): Promise<boolean> {
	return insertRdmEntry(
		rdmFileUri,
		'sources',
		'Source',
		buildRdmSourceObject,
		labelsFromRdmSources,
	);
}
