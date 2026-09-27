import * as fs from 'fs';
import * as path from 'path';

export const TENANT_CONNECTION_MESSAGE = [
	'The LCA request requires tenant configuration information.',
	'',
	'Please connect the Reltio Cursor plugin to the target tenant first.',
	'Once connected, I can verify the object type, attributes, and existing',
	'lifecycleActions before continuing.',
].join('\n');

export interface TenantL3Location {
	tenantId: string;
	path: string;
	environment?: string;
}

export interface TenantGateResult {
	connected: boolean;
	state: 'TENANT_CONNECTION_REQUIRED' | 'TENANT_CONNECTED';
	message?: string;
	tenants: TenantL3Location[];
	selected?: TenantL3Location;
}

const TENANT_DIR = /\.reltio\.tenant(?:\/|$)/;
const ENV_DIR = /\.reltio\.environment(?:\/|$)/;
const CLASSIC_L3_FILE = 'L3.reltio.json';
const GIT_L3_FILE = 'BusinessConfig.json';
const GIT_MARKER_FILE = '.reltio-config-source.json';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'samples', 'velocity-packs']);

function fileName(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function isPackOrSample(normalized: string): boolean {
	return normalized.includes('/samples/') || normalized.includes('/velocity-packs/');
}

/** True when a path is a fetched tenant L3, not a sample, Velocity Pack, or lookalike filename. */
export function isTenantL3Path(filePath: string): boolean {
	const normalized = filePath.replace(/\\/g, '/');
	if (fileName(normalized) !== CLASSIC_L3_FILE) {
		return false;
	}
	if (isPackOrSample(normalized)) {
		return false;
	}
	return TENANT_DIR.test(normalized);
}

export function tenantIdFromL3Path(filePath: string): string | undefined {
	const normalized = filePath.replace(/\\/g, '/');
	const parts = normalized.split('/');
	const tenantSeg = parts.find(p => p.endsWith('.reltio.tenant'));
	if (!tenantSeg) return undefined;
	return tenantSeg.slice(0, -'.reltio.tenant'.length);
}

export function environmentFromL3Path(filePath: string): string | undefined {
	const normalized = filePath.replace(/\\/g, '/');
	const parts = normalized.split('/');
	const envSeg = parts.find(p => p.endsWith('.reltio.environment'));
	if (!envSeg) return undefined;
	return envSeg.slice(0, -'.reltio.environment'.length);
}

interface GitMarkerSource {
	l3RelativePath?: string;
	environmentName?: string;
	tenantId?: string;
}

/** L3 paths named by a git-source marker. Rejects paths that leave the marker directory. */
export function locationsFromGitMarker(markerFile: string): TenantL3Location[] {
	let parsed: { l3RelativePath?: string; tenantId?: string; environmentName?: string; sources?: GitMarkerSource[] };
	try {
		parsed = JSON.parse(fs.readFileSync(markerFile, 'utf8')) as typeof parsed;
	} catch {
		return [];
	}
	const sources: GitMarkerSource[] = [];
	if (typeof parsed?.l3RelativePath === 'string' && typeof parsed?.tenantId === 'string') {
		sources.push(parsed);
	} else if (Array.isArray(parsed?.sources)) {
		sources.push(...parsed.sources);
	}
	const markerDir = path.dirname(markerFile);
	const found: TenantL3Location[] = [];
	for (const source of sources) {
		if (typeof source?.l3RelativePath !== 'string' || typeof source?.tenantId !== 'string' || !source.tenantId.trim()) {
			continue;
		}
		const resolved = path.resolve(markerDir, source.l3RelativePath);
		const relative = path.relative(markerDir, resolved);
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			continue;
		}
		const base = path.basename(resolved);
		if (base !== GIT_L3_FILE && base !== CLASSIC_L3_FILE) {
			continue;
		}
		const normalized = resolved.replace(/\\/g, '/');
		if (isPackOrSample(normalized) || !fs.existsSync(resolved)) {
			continue;
		}
		found.push({
			tenantId: source.tenantId,
			path: resolved,
			environment: typeof source.environmentName === 'string' ? source.environmentName : undefined,
		});
	}
	return found;
}

/**
 * Classic `*.reltio.tenant/L3.reltio.json` files plus git-connected
 * `BusinessConfig.json` paths recorded in `.reltio-config-source.json`.
 */
export function discoverTenantL3(root: string): TenantL3Location[] {
	const found: TenantL3Location[] = [];
	const push = (loc: TenantL3Location) => {
		if (!loc.tenantId || !loc.path) return;
		if (found.some(t => t.path === loc.path && t.tenantId === loc.tenantId)) return;
		found.push(loc);
	};
	const rootMarker = path.join(root, GIT_MARKER_FILE);
	if (fs.existsSync(rootMarker)) {
		for (const loc of locationsFromGitMarker(rootMarker)) push(loc);
	}
	const stack = [{ dir: root, depth: 0 }];
	while (stack.length && found.length < 20) {
		const current = stack.pop();
		if (!current || current.depth > 8) continue;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (SKIP_DIRS.has(entry.name)) continue;
			const full = path.join(current.dir, entry.name);
			if (entry.isDirectory()) {
				stack.push({ dir: full, depth: current.depth + 1 });
				continue;
			}
			if (!entry.isFile()) continue;
			if (entry.name === GIT_MARKER_FILE) {
				for (const loc of locationsFromGitMarker(full)) push(loc);
				continue;
			}
			if (!isTenantL3Path(full)) continue;
			const tenantId = tenantIdFromL3Path(full);
			if (!tenantId) continue;
			push({ tenantId, path: full, environment: environmentFromL3Path(full) });
		}
	}
	return found;
}

export function assessTenantConnection(input: {
	tenantAware: boolean;
	l3Paths?: string[];
	locations?: TenantL3Location[];
	preferredTenantId?: string;
}): TenantGateResult {
	const tenants: TenantL3Location[] = [];
	const push = (loc: TenantL3Location) => {
		if (!loc.tenantId || !loc.path) return;
		if (tenants.some(t => t.path === loc.path && t.tenantId === loc.tenantId)) return;
		tenants.push(loc);
	};
	for (const filePath of input.l3Paths ?? []) {
		if (!isTenantL3Path(filePath)) continue;
		const tenantId = tenantIdFromL3Path(filePath);
		if (!tenantId) continue;
		push({
			tenantId,
			path: filePath,
			environment: environmentFromL3Path(filePath),
		});
	}
	for (const loc of input.locations ?? []) {
		push(loc);
	}

	if (!input.tenantAware) {
		return {
			connected: tenants.length > 0,
			state: tenants.length > 0 ? 'TENANT_CONNECTED' : 'TENANT_CONNECTION_REQUIRED',
			tenants,
			selected: tenants[0],
		};
	}

	if (tenants.length === 0) {
		return {
			connected: false,
			state: 'TENANT_CONNECTION_REQUIRED',
			message: TENANT_CONNECTION_MESSAGE,
			tenants,
		};
	}

	const preferred = input.preferredTenantId
		? tenants.find(t => t.tenantId.toLowerCase() === input.preferredTenantId!.toLowerCase())
		: undefined;
	return {
		connected: true,
		state: 'TENANT_CONNECTED',
		tenants,
		selected: preferred ?? (tenants.length === 1 ? tenants[0] : undefined),
		message: !preferred && tenants.length > 1 && !input.preferredTenantId
			? `Multiple tenants are connected (${tenants.map(t => t.tenantId).join(', ')}). Confirm which tenant to use.`
			: undefined,
	};
}

export { ENV_DIR };
