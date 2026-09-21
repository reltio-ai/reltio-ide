import * as vscode from 'vscode';
import type { EnvironmentManager } from './environmentManager';
import { ensureGitignoreEntries, ensureMarkerGitignored } from './gitSourceMarker';
import { hasUncommittedChanges } from './tenantGitBinding';
import {
	BASELINE_FILE,
	BUSINESS_CONFIG_FILE,
	HISTORY_DIR,
	LAYOUT_FILE,
	LEGACY_BASELINE_FILENAME,
	LEGACY_CONFIG_FILENAME,
	LEGACY_HISTORY_DIRNAME,
	LEGACY_LAYOUT_FILENAME,
	MIGRATION_BACKUP_DIR,
	materializeTenantTree,
	tenantPath,
} from './tenantFolderStructure';

/** Per-tenant stamp. Absent means "not yet migrated", so a failed run is retried next activation. */
function stampKey(environmentName: string, tenantId: string): string {
	return `reltio.layoutMigrated::${environmentName}::${tenantId}`;
}

/** Legacy name → component-tree destination. Order is irrelevant; every entry is independent. */
const MIGRATION_MAP: ReadonlyArray<readonly [legacy: string, destination: string]> = [
	[LEGACY_CONFIG_FILENAME, BUSINESS_CONFIG_FILE],
	[LEGACY_BASELINE_FILENAME, BASELINE_FILE],
	[LEGACY_LAYOUT_FILENAME, LAYOUT_FILE],
	[LEGACY_HISTORY_DIRNAME, HISTORY_DIR],
];

export interface MigrationMove {
	legacy: string;
	destination: string;
	from: vscode.Uri;
	to: vscode.Uri;
}

export interface TenantMigration {
	environmentName: string;
	tenantId: string;
	tenantRoot: vscode.Uri;
	moves: MigrationMove[];
}

export type SkipReason = 'dirty-worktree' | 'backup-failed' | 'move-failed';

export interface MigrationSkip {
	environmentName: string;
	tenantId: string;
	reason: SkipReason;
	detail?: string;
}

export interface MigrationReport {
	migrated: TenantMigration[];
	skipped: MigrationSkip[];
	backupRoot?: vscode.Uri;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/**
 * The moves a tenant folder needs, omitting anything that is not on disk.
 *
 * An empty result means the tenant is already on the component tree (or was never populated),
 * so there is nothing to do and no backup is taken.
 */
export async function planMigration(
	environmentName: string,
	tenantId: string,
	tenantRoot: vscode.Uri,
): Promise<TenantMigration> {
	const moves: MigrationMove[] = [];
	for (const [legacy, destination] of MIGRATION_MAP) {
		const from = tenantPath(tenantRoot, legacy);
		if (!(await exists(from))) continue;
		// Never clobber a destination that somehow already exists.
		const to = tenantPath(tenantRoot, destination);
		if (await exists(to)) continue;
		moves.push({ legacy, destination, from, to });
	}
	return { environmentName, tenantId, tenantRoot, moves };
}

/** Tenants still on the legacy flat layout that have not already been stamped as handled. */
export async function detectLegacyTenants(
	environmentManager: EnvironmentManager,
	workspaceState: vscode.Memento,
): Promise<TenantMigration[]> {
	const out: TenantMigration[] = [];
	for (const env of await environmentManager.scanEnvironments()) {
		for (const tenant of env.tenants) {
			if (workspaceState.get<boolean>(stampKey(env.name, tenant.tenantId), false)) continue;
			const tenantRoot = environmentManager.getTenantRootUri(env.name, tenant.tenantId);
			const plan = await planMigration(env.name, tenant.tenantId, tenantRoot);
			if (plan.moves.length > 0) out.push(plan);
		}
	}
	return out;
}

function backupUriFor(workspaceRoot: vscode.Uri, m: TenantMigration): vscode.Uri {
	return vscode.Uri.joinPath(
		workspaceRoot,
		MIGRATION_BACKUP_DIR,
		m.environmentName,
		m.tenantId,
	);
}

/**
 * Copies every file this migration will move into the workspace-root backup folder.
 *
 * Outside the tenant folder so a later commit can never pick it up, and inside the workspace so
 * the user can actually find it. Retained after a successful migration: silently deleting a
 * recovery artifact is worse than leaving a folder behind.
 */
async function backupTenant(workspaceRoot: vscode.Uri, m: TenantMigration): Promise<vscode.Uri> {
	const dest = backupUriFor(workspaceRoot, m);
	await vscode.workspace.fs.createDirectory(dest);
	for (const move of m.moves) {
		await vscode.workspace.fs.copy(move.from, vscode.Uri.joinPath(dest, move.legacy), {
			overwrite: true,
		});
	}
	await ensureGitignoreEntries(workspaceRoot, [
		[`${MIGRATION_BACKUP_DIR}/`, [MIGRATION_BACKUP_DIR]],
	]);
	return dest;
}

/**
 * Moves one tenant onto the component tree.
 *
 * The stamp is written only after every move succeeds, so an interrupted run is retried on the
 * next activation rather than leaving the tenant half-migrated and marked done.
 */
export async function migrateTenant(
	workspaceRoot: vscode.Uri,
	m: TenantMigration,
	workspaceState: vscode.Memento,
): Promise<MigrationSkip | undefined> {
	// Moving tracked files under uncommitted work would bury it in a large rename diff.
	if (await hasUncommittedChanges(m.tenantRoot)) {
		return { environmentName: m.environmentName, tenantId: m.tenantId, reason: 'dirty-worktree' };
	}

	try {
		await backupTenant(workspaceRoot, m);
	} catch (e) {
		return {
			environmentName: m.environmentName,
			tenantId: m.tenantId,
			reason: 'backup-failed',
			detail: e instanceof Error ? e.message : String(e),
		};
	}

	try {
		await materializeTenantTree(m.tenantRoot);
		for (const move of m.moves) {
			await vscode.workspace.fs.rename(move.from, move.to, { overwrite: false });
		}
		await ensureMarkerGitignored(m.tenantRoot);
	} catch (e) {
		// No stamp: the next activation retries from whatever state we reached.
		return {
			environmentName: m.environmentName,
			tenantId: m.tenantId,
			reason: 'move-failed',
			detail: e instanceof Error ? e.message : String(e),
		};
	}

	await workspaceState.update(stampKey(m.environmentName, m.tenantId), true);
	return undefined;
}

/** Migrates every legacy tenant in the workspace. Safe to call on an already-migrated workspace. */
export async function migrateWorkspace(
	workspaceRoot: vscode.Uri,
	environmentManager: EnvironmentManager,
	workspaceState: vscode.Memento,
): Promise<MigrationReport> {
	const pending = await detectLegacyTenants(environmentManager, workspaceState);
	const migrated: TenantMigration[] = [];
	const skipped: MigrationSkip[] = [];

	for (const m of pending) {
		const skip = await migrateTenant(workspaceRoot, m, workspaceState);
		if (skip) skipped.push(skip);
		else migrated.push(m);
	}

	return {
		migrated,
		skipped,
		backupRoot: migrated.length > 0
			? vscode.Uri.joinPath(workspaceRoot, MIGRATION_BACKUP_DIR)
			: undefined,
	};
}

/** Human-readable detail for the notification's "Show details" action. */
export function renderMigrationDetail(report: MigrationReport): string {
	const lines: string[] = ['Reltio IDE — tenant layout migration', ''];
	for (const m of report.migrated) {
		lines.push(`Migrated ${m.environmentName} / ${m.tenantId}`);
		for (const move of m.moves) lines.push(`    ${move.legacy}  ->  ${move.destination}`);
		lines.push('');
	}
	for (const s of report.skipped) {
		const why = s.reason === 'dirty-worktree'
			? 'skipped: the tenant folder has uncommitted Git changes. It will migrate once the worktree is clean.'
			: `skipped (${s.reason})${s.detail ? `: ${s.detail}` : ''}`;
		lines.push(`Skipped ${s.environmentName} / ${s.tenantId} — ${why}`);
	}
	if (report.backupRoot) {
		lines.push('', `Backup of the pre-migration files: ${report.backupRoot.fsPath}`);
	}
	return lines.join('\n');
}

/**
 * Restores the legacy layout for every tenant backed up in this workspace and clears the stamps,
 * so the next activation reconsiders them.
 */
export async function undoMigration(
	workspaceRoot: vscode.Uri,
	environmentManager: EnvironmentManager,
	workspaceState: vscode.Memento,
): Promise<{ restored: string[] }> {
	const backupRoot = vscode.Uri.joinPath(workspaceRoot, MIGRATION_BACKUP_DIR);
	if (!(await exists(backupRoot))) return { restored: [] };

	const restored: string[] = [];
	for (const [envName, envType] of await vscode.workspace.fs.readDirectory(backupRoot)) {
		if (envType !== vscode.FileType.Directory) continue;
		const envDir = vscode.Uri.joinPath(backupRoot, envName);
		for (const [tenantId, tenantType] of await vscode.workspace.fs.readDirectory(envDir)) {
			if (tenantType !== vscode.FileType.Directory) continue;
			const backupDir = vscode.Uri.joinPath(envDir, tenantId);
			const tenantRoot = environmentManager.getTenantRootUri(envName, tenantId);

			for (const [legacy, destination] of MIGRATION_MAP) {
				const saved = vscode.Uri.joinPath(backupDir, legacy);
				if (!(await exists(saved))) continue;
				// Drop the migrated copy first so the restore lands on a clean path.
				const migratedUri = tenantPath(tenantRoot, destination);
				if (await exists(migratedUri)) {
					await vscode.workspace.fs.delete(migratedUri, { recursive: true, useTrash: false });
				}
				await vscode.workspace.fs.copy(saved, tenantPath(tenantRoot, legacy), { overwrite: true });
			}

			await workspaceState.update(stampKey(envName, tenantId), undefined);
			restored.push(`${envName} / ${tenantId}`);
		}
	}
	return { restored };
}

/** True when this workspace has a migration backup that `undoMigration` could restore from. */
export async function hasMigrationBackup(workspaceRoot: vscode.Uri): Promise<boolean> {
	return exists(vscode.Uri.joinPath(workspaceRoot, MIGRATION_BACKUP_DIR));
}
