import * as vscode from 'vscode';
import {
	findNodeAtPath,
	findArrayInsertionPoint,
	findNodeRangeForDeletion,
	parseDocument,
} from '../parser/configParser';
import type { ConfigTreeItem } from '../tree/treeNodes';
import type { Node } from 'jsonc-parser';
import type { Attribute, EntityType, RelationType, ReltioBusinessModel } from '../model/types';
import {
	type AttributeSkeletonKind,
	buildAttributeObject,
	buildCleanseConfigSkeleton,
	buildEntityTypeObject,
	buildGraphTypeObject,
	buildGroupingTypeObject,
	buildHierarchyTypeObject,
	buildInteractionTypeObject,
	buildMatchGroupObject,
	buildRelationTypeObject,
	buildSourceObject,
	buildSurvivorshipGroupObject,
	labelsFromAttributes,
	labelsFromEntityTypes,
	labelsFromGraphTypes,
	labelsFromGroupingTypes,
	labelsFromHierarchyTypes,
	labelsFromInteractionTypes,
	labelsFromMatchGroups,
	labelsFromRelationTypes,
	labelsFromSources,
	labelsFromSurvivorshipGroups,
	nextDefaultLabel,
} from './elementSkeletons';
import { revealInsertionInEditor } from './revealInsertion';

export async function addEntityType(
	documentUri: vscode.Uri,
	_ast: Node,
): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const labels = labelsFromEntityTypes(model.entityTypes);
	const label = nextDefaultLabel('EntityType', labels);
	const obj = buildEntityTypeObject(label);
	const jsonText = JSON.stringify(obj, null, 2);
	const newIdx = model.entityTypes?.length ?? 0;
	const ok = await insertIntoArray(documentUri, ast, ['entityTypes'], jsonText);
	if (ok) await revealInsertionInEditor(documentUri, ['entityTypes', newIdx]);
	return ok;
}

export async function addRelationType(
	documentUri: vscode.Uri,
	_ast: Node,
): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const labels = labelsFromRelationTypes(model.relationTypes);
	const label = nextDefaultLabel('RelationType', labels);
	const obj = buildRelationTypeObject(label);
	const jsonText = JSON.stringify(obj, null, 2);
	const newIdx = model.relationTypes?.length ?? 0;
	const ok = await insertIntoArray(documentUri, ast, ['relationTypes'], jsonText);
	if (ok) await revealInsertionInEditor(documentUri, ['relationTypes', newIdx]);
	return ok;
}

export async function insertAttribute(
	item: ConfigTreeItem,
	documentUri: vscode.Uri,
	_ast: Node,
	kind: AttributeSkeletonKind,
): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);

	const parentPath = resolveAttributeParentPath(item);
	if (!parentPath) return false;

	const arrayPath =
		item.nodeType === 'attributesFolder' ? item.jsonPath : [...parentPath, 'attributes'];

	const attrs = getModelAtPath(model, arrayPath) as Attribute[] | undefined;
	const labels = labelsFromAttributes(attrs);
	const label = nextDefaultLabel('Attribute', labels);
	const parentUri = resolveParentUri(ast, parentPath);
	const attrObj = buildAttributeObject(parentUri, label, kind);
	const jsonText = JSON.stringify(attrObj, null, 2);
	const newIdx = attrs?.length ?? 0;
	const ok = await appendToOptionalArray(
		documentUri,
		ast,
		parentPath,
		'attributes',
		jsonText,
		[...arrayPath, newIdx],
	);
	return ok;
}

export async function insertMatchGroup(
	item: ConfigTreeItem,
	documentUri: vscode.Uri,
	_ast: Node,
): Promise<boolean> {
	if (item.nodeType !== 'entityType') return false;
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const et = getModelAtPath(model, item.jsonPath) as EntityType | undefined;
	if (!et?.uri) return false;
	const groups = et.matchGroups;
	const labels = labelsFromMatchGroups(groups);
	const label = nextDefaultLabel('MatchGroup', labels);
	const obj = buildMatchGroupObject(et.uri, label);
	const jsonText = JSON.stringify(obj, null, 2);
	const parentPath = item.jsonPath;
	const newIdx = groups?.length ?? 0;
	return appendToOptionalArray(
		documentUri,
		ast,
		parentPath,
		'matchGroups',
		jsonText,
		[...parentPath, 'matchGroups', newIdx],
	);
}

export async function insertSurvivorshipGroup(
	item: ConfigTreeItem,
	documentUri: vscode.Uri,
	_ast: Node,
): Promise<boolean> {
	if (item.nodeType !== 'entityType' && item.nodeType !== 'relationType') return false;
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const row = getModelAtPath(model, item.jsonPath) as EntityType | RelationType | undefined;
	if (!row?.uri) return false;
	const groups = row.survivorshipGroups;
	const labels = labelsFromSurvivorshipGroups(groups);
	const label = nextDefaultLabel('SurvivorshipGroup', labels);
	const obj = buildSurvivorshipGroupObject(row.uri, label);
	const jsonText = JSON.stringify(obj, null, 2);
	const parentPath = item.jsonPath;
	const newIdx = groups?.length ?? 0;
	return appendToOptionalArray(
		documentUri,
		ast,
		parentPath,
		'survivorshipGroups',
		jsonText,
		[...parentPath, 'survivorshipGroups', newIdx],
	);
}

export async function insertCleanseConfig(
	item: ConfigTreeItem,
	documentUri: vscode.Uri,
	_ast: Node,
): Promise<boolean> {
	if (item.nodeType !== 'entityType') return false;
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const et = getModelAtPath(model, item.jsonPath) as EntityType | undefined;
	if (!et?.uri) return false;
	if (findNodeAtPath(ast, [...item.jsonPath, 'cleanseConfig'])) {
		void vscode.window.showInformationMessage('This entity type already has a cleanse config.');
		return false;
	}
	const parentNode = findNodeAtPath(ast, item.jsonPath);
	if (!parentNode || parentNode.type !== 'object') return false;
	const obj = buildCleanseConfigSkeleton(et.uri);
	const jsonText = JSON.stringify(obj, null, 2);
	const ok = await insertNewObjectProperty(
		documentUri,
		document,
		parentNode,
		'cleanseConfig',
		jsonText,
	);
	if (ok) await revealInsertionInEditor(documentUri, [...item.jsonPath, 'cleanseConfig']);
	return ok;
}

export async function addGroupingType(
	documentUri: vscode.Uri,
	_ast: Node,
): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const labels = labelsFromGroupingTypes(model.groupingTypes);
	const label = nextDefaultLabel('GroupingType', labels);
	const obj = buildGroupingTypeObject(label);
	const jsonText = JSON.stringify(obj, null, 2);
	const newIdx = model.groupingTypes?.length ?? 0;
	const ok = await insertIntoArray(documentUri, ast, ['groupingTypes'], jsonText);
	if (ok) await revealInsertionInEditor(documentUri, ['groupingTypes', newIdx]);
	return ok;
}

export async function addGraphType(documentUri: vscode.Uri, _ast: Node): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const labels = labelsFromGraphTypes(model.graphTypes);
	const label = nextDefaultLabel('GraphType', labels);
	const obj = buildGraphTypeObject(label);
	const jsonText = JSON.stringify(obj, null, 2);
	const newIdx = model.graphTypes?.length ?? 0;
	const ok = await insertIntoArray(documentUri, ast, ['graphTypes'], jsonText);
	if (ok) await revealInsertionInEditor(documentUri, ['graphTypes', newIdx]);
	return ok;
}

export async function addHierarchyType(documentUri: vscode.Uri, _ast: Node): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const labels = labelsFromHierarchyTypes(model.hierarchyTypes);
	const label = nextDefaultLabel('HierarchyType', labels);
	const obj = buildHierarchyTypeObject(label);
	const jsonText = JSON.stringify(obj, null, 2);
	const newIdx = model.hierarchyTypes?.length ?? 0;
	const ok = await insertIntoArray(documentUri, ast, ['hierarchyTypes'], jsonText);
	if (ok) await revealInsertionInEditor(documentUri, ['hierarchyTypes', newIdx]);
	return ok;
}

export async function addInteractionType(documentUri: vscode.Uri, _ast: Node): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const labels = labelsFromInteractionTypes(model.interactionTypes);
	const label = nextDefaultLabel('InteractionType', labels);
	const obj = buildInteractionTypeObject(label);
	const jsonText = JSON.stringify(obj, null, 2);
	const newIdx = model.interactionTypes?.length ?? 0;
	const ok = await insertIntoArray(documentUri, ast, ['interactionTypes'], jsonText);
	if (ok) await revealInsertionInEditor(documentUri, ['interactionTypes', newIdx]);
	return ok;
}

export async function addSource(documentUri: vscode.Uri, _ast: Node): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const { model, ast } = parseDocument(text);
	const labels = labelsFromSources(model.sources);
	const label = nextDefaultLabel('Source', labels);
	const obj = buildSourceObject(label);
	const jsonText = JSON.stringify(obj, null, 2);
	const newIdx = model.sources?.length ?? 0;
	const ok = await insertIntoArray(documentUri, ast, ['sources'], jsonText);
	if (ok) await revealInsertionInEditor(documentUri, ['sources', newIdx]);
	return ok;
}

export async function deleteNode(
	item: ConfigTreeItem,
	documentUri: vscode.Uri,
	ast: Node,
): Promise<boolean> {
	const confirm = await vscode.window.showWarningMessage(
		`Delete "${item.nodeLabel}"?`,
		{ modal: true },
		'Delete',
	);
	if (confirm !== 'Delete') return false;

	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const range = findNodeRangeForDeletion(text, ast, item.jsonPath);
	if (!range) return false;

	const edit = new vscode.WorkspaceEdit();
	const startPos = document.positionAt(range.offset);
	const endPos = document.positionAt(range.offset + range.length);
	edit.delete(documentUri, new vscode.Range(startPos, endPos));
	return vscode.workspace.applyEdit(edit);
}

export async function renameNode(
	item: ConfigTreeItem,
	documentUri: vscode.Uri,
	ast: Node,
): Promise<boolean> {
	const newName = await vscode.window.showInputBox({
		prompt: 'New name',
		value: item.nodeLabel,
		validateInput: v => v.trim() ? undefined : 'Name is required',
	});
	if (!newName || newName === item.nodeLabel) return false;

	const document = await vscode.workspace.openTextDocument(documentUri);
	const edit = new vscode.WorkspaceEdit();

	const labelNode = findNodeAtPath(ast, [...item.jsonPath, 'label']);
	if (labelNode) {
		const start = document.positionAt(labelNode.offset);
		const end = document.positionAt(labelNode.offset + labelNode.length);
		edit.replace(documentUri, new vscode.Range(start, end), JSON.stringify(newName));
	}

	const uriNode = findNodeAtPath(ast, [...item.jsonPath, 'uri']);
	if (uriNode && uriNode.value) {
		const oldUri = uriNode.value as string;
		const parts = oldUri.split('/');
		parts[parts.length - 1] = newName;
		const newUri = parts.join('/');
		const start = document.positionAt(uriNode.offset);
		const end = document.positionAt(uriNode.offset + uriNode.length);
		edit.replace(documentUri, new vscode.Range(start, end), JSON.stringify(newUri));
	}

	return vscode.workspace.applyEdit(edit);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getModelAtPath(model: ReltioBusinessModel, path: (string | number)[]): unknown {
	let cur: unknown = model;
	for (const p of path) {
		if (cur === undefined || cur === null) return undefined;
		cur = (cur as Record<string | number, unknown>)[p];
	}
	return cur;
}

function resolveAttributeParentPath(item: ConfigTreeItem): (string | number)[] | undefined {
	if (item.nodeType === 'attributesFolder') {
		return item.jsonPath.slice(0, -1);
	}
	if (
		item.nodeType === 'entityType' ||
		item.nodeType === 'relationType' ||
		item.nodeType === 'nestedAttribute'
	) {
		return item.jsonPath;
	}
	return undefined;
}

const BOOTSTRAP_ROOT_ARRAY_KEYS = new Set([
	'entityTypes',
	'relationTypes',
	'groupingTypes',
	'graphTypes',
	'hierarchyTypes',
	'interactionTypes',
	'sources',
]);

function rootObjectDeclaresProperty(text: string, key: string): boolean {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`"${escaped}"\\s*:`).test(text);
}

async function appendToOptionalArray(
	documentUri: vscode.Uri,
	ast: Node,
	parentPath: (string | number)[],
	arrayKey: string,
	jsonText: string,
	revealPath: (string | number)[],
): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const arrayPath = [...parentPath, arrayKey];
	const insertion = findArrayInsertionPoint(text, ast, arrayPath);
	if (insertion.offset >= 0) {
		const ok = await insertIntoArray(documentUri, ast, arrayPath, jsonText);
		if (ok) await revealInsertionInEditor(documentUri, revealPath);
		return ok;
	}
	const parentNode = findNodeAtPath(ast, parentPath);
	if (!parentNode || parentNode.type !== 'object') {
		void vscode.window.showErrorMessage('Cannot insert: parent object not found in JSON.');
		return false;
	}
	const ok = await insertNewArrayPropertyOnObject(documentUri, document, parentNode, arrayKey, jsonText);
	if (ok) await revealInsertionInEditor(documentUri, revealPath);
	return ok;
}

async function insertNewArrayPropertyOnObject(
	documentUri: vscode.Uri,
	document: vscode.TextDocument,
	parentNode: Node,
	arrayKey: string,
	jsonText: string,
): Promise<boolean> {
	const text = document.getText();
	const insertPos = parentNode.offset + parentNode.length - 1;
	const inner = text.slice(parentNode.offset + 1, insertPos).trim();
	const prefix = inner.length === 0 ? '' : ',';
	const propIndent = propertyIndentForObject(text, parentNode);
	const elemIndent = propIndent + '  ';
	const innerElemIndent = elemIndent + '  ';
	const indented = indentJson(jsonText, innerElemIndent);
	const block = `${prefix}\n${propIndent}"${arrayKey}": [\n${indented}\n${propIndent}]`;
	const edit = new vscode.WorkspaceEdit();
	edit.insert(documentUri, document.positionAt(insertPos), block);
	return vscode.workspace.applyEdit(edit);
}

async function insertNewObjectProperty(
	documentUri: vscode.Uri,
	document: vscode.TextDocument,
	parentNode: Node,
	key: string,
	jsonText: string,
): Promise<boolean> {
	const text = document.getText();
	const insertPos = parentNode.offset + parentNode.length - 1;
	const inner = text.slice(parentNode.offset + 1, insertPos).trim();
	const prefix = inner.length === 0 ? '' : ',';
	const propIndent = propertyIndentForObject(text, parentNode);
	const nestedIndent = propIndent + '  ';
	const indentedValue = indentJson(jsonText, nestedIndent);
	const block = `${prefix}\n${propIndent}"${key}": ${indentedValue}`;
	const edit = new vscode.WorkspaceEdit();
	edit.insert(documentUri, document.positionAt(insertPos), block);
	return vscode.workspace.applyEdit(edit);
}

function leadingWhitespaceBeforeOffset(text: string, offset: number): string {
	const ls = text.lastIndexOf('\n', offset - 1);
	const lineStart = ls < 0 ? 0 : ls + 1;
	const line = text.slice(lineStart, offset);
	const m = line.match(/^(\s*)/);
	return m ? m[1] : '';
}

function propertyIndentForObject(text: string, objectNode: Node): string {
	const ch = objectNode.children;
	if (ch && ch.length > 0) {
		return leadingWhitespaceBeforeOffset(text, ch[0]!.offset);
	}
	return leadingWhitespaceBeforeOffset(text, objectNode.offset + 1) + '  ';
}

async function insertMissingRootArrayProperty(
	documentUri: vscode.Uri,
	document: vscode.TextDocument,
	key: string,
	jsonText: string,
): Promise<boolean> {
	const text = document.getText();
	const openIdx = text.indexOf('{');
	if (openIdx < 0) {
		void vscode.window.showErrorMessage('JSON root must be an object.');
		return false;
	}
	const rootIndent = '  ';
	const innerIndent = rootIndent + '  ';
	const indented = indentJson(jsonText, innerIndent);
	const block = `\n${rootIndent}"${key}": [\n${indented}\n${rootIndent}]`;
	const afterBrace = text.slice(openIdx + 1);
	const trimmed = afterBrace.trimStart();
	const needsComma = trimmed.length > 0 && trimmed[0] !== '}';
	const insertPayload = block + (needsComma ? ',' : '');

	const edit = new vscode.WorkspaceEdit();
	edit.insert(documentUri, document.positionAt(openIdx + 1), insertPayload);
	return vscode.workspace.applyEdit(edit);
}

async function insertIntoArray(
	documentUri: vscode.Uri,
	ast: Node,
	arrayPath: (string | number)[],
	jsonText: string,
): Promise<boolean> {
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();
	const insertion = findArrayInsertionPoint(text, ast, arrayPath);

	if (insertion.offset < 0) {
		const top = arrayPath.length === 1 ? arrayPath[0] : undefined;
		if (
			typeof top === 'string' &&
			BOOTSTRAP_ROOT_ARRAY_KEYS.has(top) &&
			!rootObjectDeclaresProperty(text, top)
		) {
			return insertMissingRootArrayProperty(documentUri, document, top, jsonText);
		}
		void vscode.window.showErrorMessage(
			'Cannot find insertion point. The target array may be missing or not an array — fix the JSON structure.',
		);
		return false;
	}

	const arrayNode = findNodeAtPath(ast, arrayPath);
	if (!arrayNode || arrayNode.type !== 'array') {
		void vscode.window.showErrorMessage(
			'Cannot find insertion point. The target array may be missing or not an array — fix the JSON structure.',
		);
		return false;
	}

	const edit = new vscode.WorkspaceEdit();

	const indentMatch = indentForNewArrayElement(text, arrayNode);
	const indented = indentJson(jsonText, indentMatch);

	let insertText: string;
	if (insertion.isEmpty) {
		const closeBracketIndent = oneIndentLevelLess(indentMatch);
		insertText = `\n${indentMatch}${indented}\n${closeBracketIndent}`;
	} else {
		insertText = `,\n${indentMatch}${indented}`;
	}

	const pos = document.positionAt(insertion.offset);
	edit.insert(documentUri, pos, insertText);
	return vscode.workspace.applyEdit(edit);
}

/**
 * Indent for a **new array element** — matches sibling elements by reusing the first
 * element's line indent (avoids an extra `detectIndent` + '  ' that doubled nesting).
 */
function indentForNewArrayElement(text: string, arrayNode: Node): string {
	const ch = arrayNode.children;
	if (ch && ch.length > 0) {
		return leadingWhitespaceBeforeOffset(text, ch[0]!.offset);
	}
	const ls = text.lastIndexOf('\n', arrayNode.offset);
	const lineStart = ls < 0 ? 0 : ls + 1;
	const line = text.slice(lineStart, arrayNode.offset + 1);
	const m = line.match(/^(\s*)/);
	const bracketLineIndent = m ? m[1] : '';
	return bracketLineIndent + '  ';
}

/** Strip one indentation step (2 spaces or 1 tab) for closing `]` alignment after empty-array insert. */
function oneIndentLevelLess(indent: string): string {
	if (indent.endsWith('  ')) return indent.slice(0, -2);
	if (indent.endsWith('\t')) return indent.slice(0, -1);
	return indent;
}

function indentJson(json: string, indent: string): string {
	const lines = json.split('\n');
	return lines.map((line, i) => i === 0 ? line : indent + line).join('\n');
}

function resolveParentUri(ast: Node, path: (string | number)[]): string {
	const uriNode = findNodeAtPath(ast, [...path, 'uri']);
	if (uriNode?.value) return uriNode.value as string;

	for (let i = path.length - 1; i >= 0; i--) {
		const parentUriNode = findNodeAtPath(ast, [...path.slice(0, i + 1), 'uri']);
		if (parentUriNode?.value) return parentUriNode.value as string;
	}
	return 'configuration';
}
