import * as vscode from 'vscode';
import type { RdmConfiguration } from '../model/types';
import { RdmFolderNode, RdmItemNode, RdmRootNode } from './multiTenantNodes';

/**
 * Sections of an RDM configuration that the tree renders, in display order.
 *
 * Explicit rather than reflected over the payload's array keys: RDM
 * configurations vary per tenant, and an unrecognized array would otherwise
 * render as an unlabelled folder of unlabelled objects. Omitting what we do not
 * recognize is the safer failure for a read-only view — a tenant needing a new
 * section costs one entry here.
 */
interface RdmSectionConfig {
	key: 'lookupTypes' | 'sources';
	label: string;
	iconId: string;
	itemIconId: string;
}

const RDM_SECTIONS: RdmSectionConfig[] = [
	{ key: 'lookupTypes', label: 'Lookup Types', iconId: 'symbol-enum', itemIconId: 'symbol-enum-member' },
	{ key: 'sources', label: 'Sources', iconId: 'database', itemIconId: 'database' },
];

/** Trailing segment of a URI, e.g. `rdm/lookupTypes/EmailTypes` → `EmailTypes`. */
function extractName(uri: string | undefined): string {
	if (!uri) return '';
	const idx = uri.lastIndexOf('/');
	return idx >= 0 ? uri.slice(idx + 1) : uri;
}

function readString(entry: unknown, key: string): string | undefined {
	if (!entry || typeof entry !== 'object') return undefined;
	const value = (entry as Record<string, unknown>)[key];
	return typeof value === 'string' && value ? value : undefined;
}

function sectionEntries(model: RdmConfiguration, key: RdmSectionConfig['key']): unknown[] {
	const value = model[key];
	return Array.isArray(value) ? value : [];
}

/**
 * Sections of one RDM configuration, as counted folders.
 * Absent and empty sections are omitted, matching how the L3 root renders.
 */
export function getRdmRootChildren(model: RdmConfiguration, root: RdmRootNode): RdmFolderNode[] {
	const out: RdmFolderNode[] = [];
	for (const section of RDM_SECTIONS) {
		const entries = sectionEntries(model, section.key);
		if (entries.length === 0) continue;
		out.push(
			new RdmFolderNode(
				root.environmentName,
				root.tenantId,
				root.rdmTenantId,
				root.fileUri,
				section.key,
				section.label,
				entries.length,
				section.iconId,
			),
		);
	}
	return out;
}

/**
 * Entries of one section, as leaves. Labelled by `label`, falling back to the
 * trailing segment of `uri`; the full `uri` shows as the description.
 */
export function getRdmFolderChildren(model: RdmConfiguration, folder: RdmFolderNode): RdmItemNode[] {
	const section = RDM_SECTIONS.find(s => s.key === folder.sectionKey);
	if (!section) return [];

	return sectionEntries(model, section.key).map((entry, index) => {
		const uri = readString(entry, 'uri');
		const label = readString(entry, 'label') ?? extractName(uri) ?? '';
		return new RdmItemNode(
			folder.environmentName,
			folder.tenantId,
			folder.rdmTenantId,
			folder.fileUri,
			section.key,
			[section.key, index],
			label || '(unnamed)',
			uri,
			section.itemIconId,
			extractName(uri),
		);
	});
}

/** Reverse mapping for `TreeDataProvider.getParent`: item → its section folder. */
export function getRdmItemParent(model: RdmConfiguration, item: RdmItemNode): RdmFolderNode | undefined {
	const section = RDM_SECTIONS.find(s => s.key === item.sectionKey);
	if (!section) return undefined;
	const entries = sectionEntries(model, section.key);
	if (entries.length === 0) return undefined;
	return new RdmFolderNode(
		item.environmentName,
		item.tenantId,
		item.rdmTenantId,
		item.fileUri,
		section.key,
		section.label,
		entries.length,
		section.iconId,
	);
}

/** Reverse mapping for `TreeDataProvider.getParent`: section folder → its root. */
export function getRdmFolderParent(folder: RdmFolderNode): RdmRootNode {
	return new RdmRootNode(
		folder.environmentName,
		folder.tenantId,
		folder.rdmTenantId,
		folder.fileUri,
	);
}

/** Exposed for tests — the section keys the tree knows how to render. */
export function rdmSectionKeys(): string[] {
	return RDM_SECTIONS.map(s => s.key);
}

/** Icon lookup so callers do not need the private table. */
export function rdmSectionIcon(key: string): vscode.ThemeIcon | undefined {
	const section = RDM_SECTIONS.find(s => s.key === key);
	return section ? new vscode.ThemeIcon(section.iconId) : undefined;
}
