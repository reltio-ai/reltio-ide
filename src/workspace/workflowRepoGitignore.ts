/**
 * D10 — the nested-repository `.gitignore` safeguard.
 *
 * Cloning the Custom Workflow Repository into `Workflows/Custom Workflows/`
 * (D1) makes that folder a second git repository whenever the tenant folder is
 * *also* bound via `reltio.connectTenantToGit` — a repository nested inside a
 * repository. Left alone, the outer repository's `git add` would record the
 * inner `.git` as a gitlink (a commit pointer, not the files), so anyone who
 * clones the outer repository elsewhere gets an empty `Custom Workflows`
 * folder — silent data loss for the customer's Java-backed workflow code.
 *
 * This has to be correct in **both** connection orders, and it has to get
 * there without either feature knowing about the other's command:
 *
 *   - Workflow repo connected first, tenant bound second: Snehil's
 *     `reltio.connectTenantToGit` writes its own `.gitignore` entries and has
 *     no idea `Workflows/Custom Workflows/` exists.
 *   - Tenant bound first, workflow repo connected second: the connect command
 *     controls the moment and can gitignore it immediately.
 *
 * Rather than special-casing either order, this module re-derives the answer
 * from scratch every time it runs — it does not touch `tenantGitBinding.ts` at
 * all — so it is correct regardless of which happened first or whether either
 * command ever runs again. Idempotent and silent (D11): no notification, since
 * by the time this runs the hazard is already fully resolved.
 */
import * as vscode from 'vscode';
import { isGitRepo } from './gitConfigSource';
import { ensureGitignoreEntries } from './gitSourceMarker';
import { loadWorkflowRepoConfig } from './workflowRepoConfig';
import type { EnvironmentManager } from './environmentManager';

/**
 * Ensures `Workflows/Custom Workflows/` (or whatever `relativePath` the sidecar
 * actually records) is excluded from an *outer* tenant repository's tracking,
 * for one tenant.
 *
 * A no-op whenever either condition is false: no outer `.git`, or no connected
 * Custom Workflow Repository — there is nothing nested to protect in either
 * case. Safe and cheap to call unconditionally on every tenant, every time.
 */
export async function reconcileWorkflowRepoGitignore(
	tenantRoot: vscode.Uri,
	repoConfigUri: vscode.Uri,
): Promise<void> {
	const [hasOuterRepo, config] = await Promise.all([
		isGitRepo(tenantRoot),
		loadWorkflowRepoConfig(repoConfigUri),
	]);
	if (!hasOuterRepo || !config) return;

	const entry = `${config.relativePath}/`;
	await ensureGitignoreEntries(tenantRoot, [[entry, [config.relativePath]]]);
}

/**
 * Runs the reconciliation above for every known tenant across every environment.
 *
 * Used on activation, so Order 1's hazard (repo connected in one session, outer
 * binding added in a later one — or by a teammate, on a shared machine) is
 * caught the moment the extension next starts, not only once the user happens
 * to expand that tenant's Workflows folder in the tree.
 */
export async function reconcileAllWorkflowRepoGitignores(
	environmentManager: EnvironmentManager,
): Promise<void> {
	const envs = await environmentManager.scanEnvironments();
	await Promise.all(
		envs.flatMap(env =>
			env.tenants.map(async t => {
				const tenantRoot = environmentManager.getTenantRootUri(env.name, t.tenantId);
				const repoConfigUri = environmentManager.getWorkflowRepoConfigUri(env.name, t.tenantId);
				try {
					await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
				} catch {
					// Best-effort sweep: one tenant's I/O failure must not block the rest, or
					// activation itself.
				}
			}),
		),
	);
}
