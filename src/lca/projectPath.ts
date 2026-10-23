import * as fs from 'fs';
import * as path from 'path';
import { BUSINESS_CONFIG_FILE, LEGACY_CONFIG_FILENAME } from '../workspace/tenantFolderStructure';

/** Sibling of `Business Config` and `Workflows`. One Maven project per LCA. */
export const LCA_DIR = 'LifeCycle Actions';

const MARKER_FILE = '.reltio-config-source.json';

function slug(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * `<type>-<hook>-<name>-lca`, lowercased.
 * The tenant id stays in the parent folder. When no action name is known yet, the folder is `<type>-<hook>-lca`.
 */
export function lcaProjectSlug(typeName: string, hook: string, actionName?: string): string {
	const parts = [slug(typeName), slug(hook), slug(actionName ?? '')].filter(part => part.length > 0);
	const name = parts.join('-') || 'lca';
	return name === 'lca' || name.endsWith('-lca') ? name : `${name}-lca`;
}

/**
 * Directory that holds `Business Config` or a legacy `L3.reltio.json`.
 * A git repository with no tenant folder uses the directory that contains the config marker.
 */
export function tenantRootFromConfig(configPath: string): string {
	const resolved = path.resolve(configPath);
	const normalized = resolved.replace(/\\/g, '/');
	if (normalized.endsWith(`/${BUSINESS_CONFIG_FILE}`)) {
		return path.resolve(path.dirname(path.dirname(resolved)));
	}
	if (path.basename(resolved) === LEGACY_CONFIG_FILENAME) {
		return path.resolve(path.dirname(resolved));
	}
	let dir = path.dirname(resolved);
	for (let i = 0; i < 8; i++) {
		if (fs.existsSync(path.join(dir, MARKER_FILE))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.dirname(resolved);
}

/** `<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca`. */
export function lcaProjectDirectory(configPath: string, typeName: string, hook: string, actionName?: string): string {
	return path.join(tenantRootFromConfig(configPath), LCA_DIR, lcaProjectSlug(typeName, hook, actionName));
}
