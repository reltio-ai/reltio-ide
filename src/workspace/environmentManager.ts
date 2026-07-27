import * as vscode from 'vscode';

const ENV_SUFFIX = '.reltio.environment';
const TENANT_SUFFIX = '.reltio.tenant';

/** Preferred home for env/tenant dirs (alongside agent assets). */
export const RELTIO_WORKSPACE_DOTDIR = '.reltio';

/** Remote configuration snapshot at last successful Fetch L3; used for apply safety checks. */
export const REMOTE_BASELINE_FILENAME = 'L3.remote-baseline.reltio.json';

export interface TenantInfo {
	tenantId: string;
	hasL3: boolean;
}

export interface EnvironmentInfo {
	name: string;
	tenants: TenantInfo[];
}

function environmentDirName(name: string): string {
	return `${name}${ENV_SUFFIX}`;
}

function tenantDirName(tenantId: string): string {
	return `${tenantId}${TENANT_SUFFIX}`;
}

export class EnvironmentManager {
	/** Resolved env dir URIs from the last scan (or create). Prefer `.reltio/` over legacy root. */
	private readonly envLocations = new Map<string, vscode.Uri>();

	constructor(private readonly workspaceRoot: vscode.Uri) {}

	/** New environments are created under `.reltio/` (not the workspace root). */
	private preferredEnvironmentUri(name: string): vscode.Uri {
		return vscode.Uri.joinPath(
			this.workspaceRoot,
			RELTIO_WORKSPACE_DOTDIR,
			environmentDirName(name),
		);
	}

	private environmentUri(name: string): vscode.Uri {
		return this.envLocations.get(name) ?? this.preferredEnvironmentUri(name);
	}

	private tenantUri(environment: string, tenantId: string): vscode.Uri {
		return vscode.Uri.joinPath(this.environmentUri(environment), tenantDirName(tenantId));
	}

	getL3Uri(environment: string, tenantId: string): vscode.Uri {
		return vscode.Uri.joinPath(this.tenantUri(environment, tenantId), 'L3.reltio.json');
	}

	getRemoteBaselineUri(environment: string, tenantId: string): vscode.Uri {
		return vscode.Uri.joinPath(this.tenantUri(environment, tenantId), REMOTE_BASELINE_FILENAME);
	}

	getLayoutUri(environment: string, tenantId: string): vscode.Uri {
		return vscode.Uri.joinPath(this.tenantUri(environment, tenantId), 'L3.reltio.layout.json');
	}

	/** Root URI of `{tenantId}.reltio.tenant/` (for `history/` and other tenant-local data). */
	getTenantRootUri(environment: string, tenantId: string): vscode.Uri {
		return this.tenantUri(environment, tenantId);
	}

	/** `{tenant}/history/` — configuration history snapshots. */
	getHistoryDirectoryUri(environment: string, tenantId: string): vscode.Uri {
		return vscode.Uri.joinPath(this.tenantUri(environment, tenantId), 'history');
	}

	/**
	 * Scan preferred `.reltio/` first, then legacy workspace-root dirs.
	 * If the same host exists in both places, prefer `.reltio/`.
	 */
	async scanEnvironments(): Promise<EnvironmentInfo[]> {
		this.envLocations.clear();
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
			if (t !== vscode.FileType.Directory || !n.endsWith(ENV_SUFFIX)) continue;
			const name = n.slice(0, -ENV_SUFFIX.length);
			if (this.envLocations.has(name)) continue;
			this.envLocations.set(name, vscode.Uri.joinPath(base, n));
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
			if (t !== vscode.FileType.Directory || !n.endsWith(TENANT_SUFFIX)) continue;
			const tenantId = n.slice(0, -TENANT_SUFFIX.length);
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
			return known;
		}
		const uri = this.preferredEnvironmentUri(name);
		await vscode.workspace.fs.createDirectory(uri);
		this.envLocations.set(name, uri);
		return uri;
	}

	async removeEnvironment(name: string): Promise<void> {
		await this.deleteRecursive(this.environmentUri(name));
		this.envLocations.delete(name);
	}

	async createTenant(environment: string, tenantId: string): Promise<vscode.Uri> {
		const uri = this.tenantUri(environment, tenantId);
		await vscode.workspace.fs.createDirectory(uri);
		return uri;
	}

	async removeTenant(environment: string, tenantId: string): Promise<void> {
		await this.deleteRecursive(this.tenantUri(environment, tenantId));
	}

	async writeL3(environment: string, tenantId: string, content: string): Promise<vscode.Uri> {
		const uri = this.getL3Uri(environment, tenantId);
		const enc = new TextEncoder();
		await vscode.workspace.fs.writeFile(uri, enc.encode(content));
		return uri;
	}

	async writeRemoteBaseline(environment: string, tenantId: string, content: string): Promise<vscode.Uri> {
		const uri = this.getRemoteBaselineUri(environment, tenantId);
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
