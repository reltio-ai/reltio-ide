import * as vscode from 'vscode';
import {
	BASELINE_FILE,
	BUSINESS_CONFIG_DIR,
	BUSINESS_CONFIG_FILE,
	HISTORY_DIR,
	LAYOUT_FILE,
	materializeTenantTree,
	tenantPath,
} from './tenantFolderStructure';
import {
	ensureMarkerGitignored,
	readEnvironmentIdentityMarker,
	readTenantIdentityMarker,
	writeEnvironmentIdentityMarker,
	writeTenantIdentityMarker,
} from './gitSourceMarker';

const ENV_SUFFIX = '.reltio.environment';
const TENANT_SUFFIX = '.reltio.tenant';

/** Legacy home for env/tenant dirs. Still scanned, but new environments go to the workspace root. */
export const RELTIO_WORKSPACE_DOTDIR = '.reltio';

export interface TenantInfo {
	tenantId: string;
	hasL3: boolean;
}

export interface EnvironmentInfo {
	name: string;
	tenants: TenantInfo[];
}

/** One L3 file discovered inside a git-cloned config-source repository. */
export interface GitSource {
	environmentName: string;
	tenantId: string;
	/** Plain leaf name for the tree row. Unlike `tenantId` it is never collision-qualified. */
	label?: string;
	/** Folder rows between the environment and this config, outermost first. Empty means it sits directly under the repository row. */
	folders: string[];
	l3Uri: vscode.Uri;
}

/**
 * Folder label for an environment host: the first DNS label, so `dev.reltio.com` becomes `dev`.
 *
 * The host stays the environment's identity everywhere else (it is what every API call needs);
 * only the directory name is shortened, and the host is recorded in the folder's marker.
 */
export function environmentShortLabel(host: string): string {
	const first = host.split('.')[0];
	return first && first.length > 0 ? first : host;
}

/** Tenant folders are named by the bare tenant ID: unique and stable by definition. */
function tenantDirName(tenantId: string): string {
	return tenantId;
}

function tenantKey(environment: string, tenantId: string): string {
	return `${environment}/${tenantId}`;
}

/** Comparable form of a URI path: forward slashes, no trailing slash, lowercased on Windows. */
function normalizePath(p: string): string {
	const trimmed = p.replace(/\\/g, '/').replace(/\/+$/, '');
	return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

export class EnvironmentManager {
	/** Resolved env dir URIs from the last scan (or create). Prefer `.reltio/` over legacy root. */
	private readonly envLocations = new Map<string, vscode.Uri>();

	/**
	 * Tenant folder path -> (environment, tenant), rebuilt on every scan.
	 *
	 * Folder names no longer encode identity, so it cannot be parsed back out of a path.
	 * Callers needing the reverse mapping (`getParent`, first-open tracking) are synchronous
	 * and cannot read a marker on demand, so the scan records it here.
	 */
	private readonly tenantPathIndex = new Map<string, { environmentName: string; tenantId: string }>();

	/**
	 * (environment, tenant) -> the tenant's actual directory, recorded during a scan.
	 *
	 * A folder may still be legacy-suffixed (`t1.reltio.tenant`) while new ones are bare (`t1`),
	 * so the name cannot be derived from the id alone. Mirrors `envLocations`, and is why an
	 * un-renamed workspace keeps resolving correctly.
	 */
	private readonly tenantLocations = new Map<string, vscode.Uri>();

	/**
	 * Which (environment, tenant) a path belongs to, or undefined when it is outside every
	 * known tenant folder. Matches the deepest containing tenant directory.
	 */
	locFromPath(fsPath: string): { environmentName: string; tenantId: string } | undefined {
		const target = normalizePath(fsPath);
		let best: { environmentName: string; tenantId: string } | undefined;
		let bestLength = -1;
		for (const [dir, loc] of this.tenantPathIndex) {
			if (target !== dir && !target.startsWith(`${dir}/`)) continue;
			if (dir.length > bestLength) {
				bestLength = dir.length;
				best = loc;
			}
		}
		return best;
	}

	constructor(private readonly workspaceRoot: vscode.Uri) {}

	/**
	 * New environments are created at the workspace root, so each tenant folder below one is a
	 * git repository sitting in plain sight rather than nested inside a hidden dotfolder.
	 *
	 * Environments already under `.reltio/` are never relocated: `envLocations` wins over this,
	 * and `collectEnvironmentDirs` keeps scanning both.
	 */
	private preferredEnvironmentUri(name: string): vscode.Uri {
		return vscode.Uri.joinPath(this.workspaceRoot, this.environmentFolderName(name));
	}

	/**
	 * Directory name for a host: the short label, unless another environment already holds it.
	 *
	 * `dev.reltio.com` and `dev.uk.reltio.com` both want `dev`. The first keeps it; the second
	 * falls back to its full host, which is unique by construction.
	 */
	private environmentFolderName(host: string): string {
		const label = environmentShortLabel(host);
		for (const [otherHost, uri] of this.envLocations) {
			if (otherHost === host) continue;
			const basename = uri.path.slice(uri.path.lastIndexOf('/') + 1);
			if (basename === label) return host;
		}
		return label;
	}

	/** Directory basename of a known environment, for `.gitignore` entries and messages. */
	environmentFolderNameFor(name: string): string | undefined {
		const uri = this.envLocations.get(name);
		if (!uri) return undefined;
		return uri.path.slice(uri.path.lastIndexOf('/') + 1);
	}

	private environmentUri(name: string): vscode.Uri {
		return this.envLocations.get(name) ?? this.preferredEnvironmentUri(name);
	}

	private tenantUri(environment: string, tenantId: string): vscode.Uri {
		return (
			this.tenantLocations.get(tenantKey(environment, tenantId)) ??
			vscode.Uri.joinPath(this.environmentUri(environment), tenantDirName(tenantId))
		);
	}

	getL3Uri(environment: string, tenantId: string): vscode.Uri {
		const source = this.findGitSource(environment, tenantId);
		if (source) {
			return source.l3Uri;
		}
		return tenantPath(this.tenantUri(environment, tenantId), BUSINESS_CONFIG_FILE);
	}

	getRemoteBaselineUri(environment: string, tenantId: string): vscode.Uri {
		return tenantPath(this.tenantUri(environment, tenantId), BASELINE_FILE);
	}

	getLayoutUri(environment: string, tenantId: string): vscode.Uri {
		const source = this.findGitSource(environment, tenantId);
		if (source) {
			const l3Path = source.l3Uri.path;
			const dir = l3Path.slice(0, l3Path.lastIndexOf('/'));

			// A cloned repository that carries the component tree gets the same treatment as a
			// natively-connected tenant: the layout is IDE state, so it belongs in the gitignored
			// `.reltio-ide/` rather than beside the config where it would show up in every PR.
			if (dir.endsWith(`/${BUSINESS_CONFIG_DIR}`)) {
				const repoRoot = dir.slice(0, -(`/${BUSINESS_CONFIG_DIR}`.length));
				return source.l3Uri.with({ path: `${repoRoot}/${LAYOUT_FILE}` });
			}

			const layoutFilename = l3Path.endsWith('BusinessConfig.json')
				? 'BusinessConfig.layout.json'
				: 'L3.reltio.layout.json';
			return source.l3Uri.with({ path: `${dir}/${layoutFilename}` });
		}
		return tenantPath(this.tenantUri(environment, tenantId), LAYOUT_FILE);
	}

	/** Root URI of `{tenantId}.reltio.tenant/` (for `history/` and other tenant-local data). */
	getTenantRootUri(environment: string, tenantId: string): vscode.Uri {
		return this.tenantUri(environment, tenantId);
	}

	/** `{tenant}/.reltio-ide/history/` — configuration history snapshots, outside the tracked tree. */
	getHistoryDirectoryUri(environment: string, tenantId: string): vscode.Uri {
		return tenantPath(this.tenantUri(environment, tenantId), HISTORY_DIR);
	}

	/** Git-sourced L3 files, when the workspace is in git-config-source mode. */
	private gitSources: GitSource[] = [];

	private findGitSource(environment: string, tenantId: string): GitSource | undefined {
		return this.gitSources.find(s => s.environmentName === environment && s.tenantId === tenantId);
	}

	/** Switches the manager into git-source mode: `scanEnvironments`/`getL3Uri`/`getLayoutUri` now describe discovered L3 files instead of `*.reltio.environment` folders. */
	setGitSource(source: GitSource): void {
		this.gitSources = [source];
	}

	/** Sets multiple git sources (for multi-L3 repos). */
	setGitSources(sources: GitSource[]): void {
		this.gitSources = sources;
	}

	/** Git sources currently in effect, for callers that need the folder hierarchy (the tree). */
	getGitSources(): readonly GitSource[] {
		return this.gitSources;
	}

	/** Reverts to the normal `*.reltio.environment`-folder-based scan (used when the user removes the fetched config). */
	clearGitSource(): void {
		this.gitSources = [];
	}

	/**
	 * In git-source mode, report the discovered L3 files as one environment.
	 * Otherwise scan preferred `.reltio/` first, then legacy workspace-root dirs.
	 * If the same host exists in both places, prefer `.reltio/`.
	 */
	async scanEnvironments(): Promise<EnvironmentInfo[]> {
		if (this.gitSources.length > 0) {
			// Group all tenants under a single environment (repo name)
			const environmentName = this.gitSources[0]?.environmentName ?? 'git-config';
			const tenants = this.gitSources.map(s => ({ tenantId: s.tenantId, hasL3: true }));
			return [{ name: environmentName, tenants }];
		}
		this.envLocations.clear();
		this.tenantPathIndex.clear();
		this.tenantLocations.clear();
		const preferredRoot = vscode.Uri.joinPath(this.workspaceRoot, RELTIO_WORKSPACE_DOTDIR);
		await this.collectEnvironmentDirs(preferredRoot);
		await this.collectEnvironmentDirs(this.workspaceRoot);

		const out: EnvironmentInfo[] = [];
		for (const name of [...this.envLocations.keys()].sort((a, b) => a.localeCompare(b))) {
			out.push({ name, tenants: await this.scanTenants(name) });
		}
		return out;
	}

	private async collectEnvironmentDirs(base: vscode.Uri): Promise<void> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(base);
		} catch {
			return;
		}
		for (const [n, t] of entries) {
			if (t !== vscode.FileType.Directory) continue;
			const dir = vscode.Uri.joinPath(base, n);

			// Legacy layout: the host was the directory name.
			if (n.endsWith(ENV_SUFFIX)) {
				const name = n.slice(0, -ENV_SUFFIX.length);
				if (!this.envLocations.has(name)) this.envLocations.set(name, dir);
				continue;
			}

			// `.reltio` holds agent assets, not environments; skip dotfolders entirely.
			if (n.startsWith('.')) continue;

			// Current layout: a short-labelled folder whose marker carries the host.
			const marker = await readEnvironmentIdentityMarker(dir);
			if (!marker) continue;
			if (!this.envLocations.has(marker.host)) this.envLocations.set(marker.host, dir);
		}
	}

	async scanTenants(environment: string): Promise<TenantInfo[]> {
		const root = this.environmentUri(environment);
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(root);
		} catch {
			return [];
		}
		const out: TenantInfo[] = [];
		for (const [n, t] of entries) {
			if (t !== vscode.FileType.Directory || n.startsWith('.')) continue;

			// Legacy suffixed folder, or a plain folder identified by its tenant marker.
			let tenantId: string | undefined;
			if (n.endsWith(TENANT_SUFFIX)) {
				tenantId = n.slice(0, -TENANT_SUFFIX.length);
			} else {
				tenantId = (await readTenantIdentityMarker(vscode.Uri.joinPath(root, n)))?.tenantId;
			}
			if (!tenantId) continue;

			// Record before resolving paths: a legacy folder is not named after its id.
			const tenantDir = vscode.Uri.joinPath(root, n);
			this.tenantPathIndex.set(normalizePath(tenantDir.path), { environmentName: environment, tenantId });
			this.tenantLocations.set(tenantKey(environment, tenantId), tenantDir);

			const l3 = this.getL3Uri(environment, tenantId);
			let hasL3 = false;
			try {
				await vscode.workspace.fs.stat(l3);
				hasL3 = true;
			} catch {
				hasL3 = false;
			}
			out.push({ tenantId, hasL3 });
		}
		out.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
		return out;
	}

	async createEnvironment(name: string): Promise<vscode.Uri> {
		const known = this.envLocations.get(name);
		if (known) {
			await vscode.workspace.fs.createDirectory(known);
			await writeEnvironmentIdentityMarker(known, name);
			return known;
		}
		const uri = this.preferredEnvironmentUri(name);
		await vscode.workspace.fs.createDirectory(uri);
		// The folder is named by a short label, so the host only survives in the marker.
		await writeEnvironmentIdentityMarker(uri, name);
		this.envLocations.set(name, uri);
		return uri;
	}

	async removeEnvironment(name: string): Promise<void> {
		await this.deleteRecursive(this.environmentUri(name));
		this.envLocations.delete(name);
	}

	/** Creates the tenant directory and materializes the component tree, so it is git-ready before the first fetch. */
	async createTenant(environment: string, tenantId: string): Promise<vscode.Uri> {
		const uri = this.tenantUri(environment, tenantId);
		await vscode.workspace.fs.createDirectory(uri);
		await materializeTenantTree(uri);
		// Folder names no longer carry identity, so the marker is written now rather than
		// waiting for a git bind that may never happen. The `.gitignore` matters just as early:
		// the user may run Initialize Repository from the Source Control panel, and without it
		// `.reltio-ide/` would be staged as tracked content.
		await writeTenantIdentityMarker(uri, { kind: 'tenant', environmentName: environment, tenantId });
		await ensureMarkerGitignored(uri);
		this.tenantPathIndex.set(normalizePath(uri.path), { environmentName: environment, tenantId });
		this.tenantLocations.set(tenantKey(environment, tenantId), uri);
		return uri;
	}

	async removeTenant(environment: string, tenantId: string): Promise<void> {
		// Resolve the directory before forgetting where it is: a legacy-suffixed folder would
		// otherwise fall back to the bare name and delete the wrong path (or nothing at all).
		const uri = this.tenantUri(environment, tenantId);
		await this.deleteRecursive(uri);
		this.tenantLocations.delete(tenantKey(environment, tenantId));
		this.tenantPathIndex.delete(normalizePath(uri.path));
	}

	/**
	 * The config and its sidecars now sit in subdirectories (`Business Config/`, `.reltio-ide/`)
	 * rather than at the tenant root, so the parent has to exist before the write.
	 */
	private async ensureParentDirectory(uri: vscode.Uri): Promise<void> {
		const parentPath = uri.path.slice(0, uri.path.lastIndexOf('/'));
		await vscode.workspace.fs.createDirectory(uri.with({ path: parentPath }));
	}

	async writeL3(environment: string, tenantId: string, content: string): Promise<vscode.Uri> {
		const uri = this.getL3Uri(environment, tenantId);
		await this.ensureParentDirectory(uri);
		const enc = new TextEncoder();
		await vscode.workspace.fs.writeFile(uri, enc.encode(content));
		return uri;
	}

	async writeRemoteBaseline(environment: string, tenantId: string, content: string): Promise<vscode.Uri> {
		const uri = this.getRemoteBaselineUri(environment, tenantId);
		await this.ensureParentDirectory(uri);
		const enc = new TextEncoder();
		await vscode.workspace.fs.writeFile(uri, enc.encode(content));
		return uri;
	}

	private async deleteRecursive(uri: vscode.Uri): Promise<void> {
		let stat: vscode.FileStat;
		try {
			stat = await vscode.workspace.fs.stat(uri);
		} catch {
			return;
		}
		if (stat.type === vscode.FileType.Directory) {
			const entries = await vscode.workspace.fs.readDirectory(uri);
			for (const [name, type] of entries) {
				const child = vscode.Uri.joinPath(uri, name);
				if (type === vscode.FileType.Directory) {
					await this.deleteRecursive(child);
				} else {
					await vscode.workspace.fs.delete(child, { useTrash: false });
				}
			}
		}
		await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
	}
}
