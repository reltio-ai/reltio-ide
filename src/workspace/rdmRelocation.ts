import * as vscode from 'vscode';
import type { EnvironmentManager } from './environmentManager';
import { RDM_BASELINE_DIR, RDM_DIR, tenantPath } from './tenantFolderStructure';

/**
 * Moves RDM files written before the component tree existed — `RDM.{id}.reltio.json` and its
 * `RDM.{id}.remote-baseline.reltio.json` twin at the tenant folder root — into
 * `RDM/{id}/config.json` and `.reltio-ide/RDM/{id}.baseline.json`.
 *
 * Deliberately separate from the layout migration: that one stamps each tenant once, so every
 * workspace that has already migrated — precisely the ones with RDM files stranded at the root —
 * would never be reached if RDM were added to its move map. This step instead runs on every
 * activation and is safe to repeat, because a move happens only when the legacy file exists and
 * the destination does not. Once relocated, a workspace costs one directory read per tenant.
 *
 * No backup is taken. Each move is a single rename that refuses to overwrite, so there is
 * nothing a backup would protect.
 */

/** The filesystem operations relocation needs, injectable so the logic runs under a test stub. */
export interface RdmRelocationFs {
	exists(uri: vscode.Uri): Promise<boolean>;
	createDirectory(uri: vscode.Uri): Promise<void>;
	rename(from: vscode.Uri, to: vscode.Uri): Promise<void>;
}

export const vscodeRelocationFs: RdmRelocationFs = {
	async exists(uri) {
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			return false;
		}
	},
	async createDirectory(uri) {
		await vscode.workspace.fs.createDirectory(uri);
	},
	async rename(from, to) {
		await vscode.workspace.fs.rename(from, to, { overwrite: false });
	},
};

/** One RDM tenant's files: where they are, and where they belong. */
export interface RdmRelocationTarget {
	/** Human-readable name for reporting, e.g. `dev/Tenant1: RdmX`. */
	label: string;
	legacyConfig: vscode.Uri;
	legacyBaseline: vscode.Uri;
	config: vscode.Uri;
	configDir: vscode.Uri;
	baseline: vscode.Uri;
	baselineDir: vscode.Uri;
}

export interface RdmRelocationResult {
	/** Relocated RDM tenants. */
	moved: string[];
	/** Left in place because a destination was already occupied. Nothing was overwritten. */
	conflicts: string[];
	/** Left in place because a move failed; retried next activation. */
	failed: string[];
}

/**
 * Relocate each target, moving an RDM tenant's configuration and baseline together.
 *
 * They move as a pair on purpose: if the configuration's destination is occupied and only the
 * baseline moved, it would sit beside content it was never a snapshot of, and the drift guard
 * would report changes that do not exist. So an occupied destination for either leaves both.
 */
export async function relocateRdmTargets(
	targets: readonly RdmRelocationTarget[],
	fs: RdmRelocationFs = vscodeRelocationFs,
): Promise<RdmRelocationResult> {
	const result: RdmRelocationResult = { moved: [], conflicts: [], failed: [] };
	for (const t of targets) {
		try {
			if (!(await fs.exists(t.legacyConfig))) {
				continue; // already relocated, or never existed
			}
			const hasLegacyBaseline = await fs.exists(t.legacyBaseline);
			const configTaken = await fs.exists(t.config);
			const baselineTaken = hasLegacyBaseline && (await fs.exists(t.baseline));
			if (configTaken || baselineTaken) {
				result.conflicts.push(t.label);
				continue;
			}
			await fs.createDirectory(t.configDir);
			await fs.rename(t.legacyConfig, t.config);
			if (hasLegacyBaseline) {
				await fs.createDirectory(t.baselineDir);
				await fs.rename(t.legacyBaseline, t.baseline);
			}
			result.moved.push(t.label);
		} catch {
			// A baseline left behind by a mid-pair failure heals itself: the drift guard treats a
			// missing baseline as drifted, and the next fetch writes a fresh one.
			result.failed.push(t.label);
		}
	}
	return result;
}

/** Find every root-level RDM file in the workspace and relocate it. */
export async function relocateLegacyRdmFiles(
	environmentManager: EnvironmentManager,
	fs: RdmRelocationFs = vscodeRelocationFs,
): Promise<RdmRelocationResult> {
	const targets: RdmRelocationTarget[] = [];
	for (const env of await environmentManager.scanEnvironments()) {
		for (const tenant of env.tenants) {
			const ids = await environmentManager.listLegacyRdmTenantIds(env.name, tenant.tenantId);
			if (ids.length === 0) continue;
			const root = environmentManager.getTenantRootUri(env.name, tenant.tenantId);
			for (const id of ids) {
				targets.push({
					label: `${env.name}/${tenant.tenantId}: ${id}`,
					legacyConfig: environmentManager.getLegacyRdmUri(env.name, tenant.tenantId, id),
					legacyBaseline: environmentManager.getLegacyRdmBaselineUri(env.name, tenant.tenantId, id),
					config: environmentManager.getRdmUri(env.name, tenant.tenantId, id),
					configDir: tenantPath(root, `${RDM_DIR}/${id}`),
					baseline: environmentManager.getRdmBaselineUri(env.name, tenant.tenantId, id),
					baselineDir: tenantPath(root, RDM_BASELINE_DIR),
				});
			}
		}
	}
	return relocateRdmTargets(targets, fs);
}
