/**
 * Sidecar persistence for the Custom Workflow Repository binding.
 *
 * On-disk shape (inside `{tenant}/WorkflowRepo.reltio.json`):
 * ```json
 * { "version": 1, "repoUrl": "https://bitbucket.org/acme/acme-workflows.git", "relativePath": "Workflows/Custom Workflows" }
 * ```
 *
 * Mirrors `workflowAdapterConfig.ts` exactly:
 *   - A `version` field guards future schema migrations.
 *   - All reads return `undefined` on any error (missing file, corrupt JSON,
 *     wrong version, wrong shape) — callers treat `undefined` as "not connected"
 *     and offer to connect.
 *   - `relativePath` is recorded rather than assumed to always be
 *     `Workflows/Custom Workflows` (D1/D3), so that folder can change later
 *     without a marker-format migration.
 *
 * Tracked and committed, like `WorkflowAdapter.reltio.json` — a repository URL
 * is not a secret and not tenant-identity, so every teammate who clones the
 * tenant's own repository gets the correct Custom Workflow Repository URL
 * automatically. Never added to any `.gitignore` helper (D3).
 */
import * as vscode from 'vscode';

const CURRENT_VERSION = 1;

export interface WorkflowRepoConfig {
	repoUrl: string;
	relativePath: string;
}

interface WorkflowRepoConfigFile {
	version: number;
	repoUrl: string;
	relativePath: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reads the saved Custom Workflow Repository binding for the given tenant sidecar URI.
 *
 * @param configUri  The URI returned by `environmentManager.getWorkflowRepoConfigUri()`.
 * @returns          The config, or `undefined` if the file doesn't exist, can't
 *                   be parsed, or has an unexpected version/shape.
 */
export async function loadWorkflowRepoConfig(
	configUri: vscode.Uri,
): Promise<WorkflowRepoConfig | undefined> {
	try {
		const data = await vscode.workspace.fs.readFile(configUri);
		const parsed: WorkflowRepoConfigFile = JSON.parse(
			Buffer.from(data).toString('utf-8'),
		) as WorkflowRepoConfigFile;
		if (
			parsed.version !== CURRENT_VERSION ||
			typeof parsed.repoUrl !== 'string' ||
			typeof parsed.relativePath !== 'string' ||
			!parsed.repoUrl ||
			!parsed.relativePath
		) {
			return undefined;
		}
		return { repoUrl: parsed.repoUrl, relativePath: parsed.relativePath };
	} catch {
		return undefined;
	}
}

/**
 * Saves the Custom Workflow Repository binding to the tenant sidecar file.
 * Creates intermediate directories if they do not exist.
 *
 * Always overwrites (D9: one repository per tenant — no append/multi-source
 * shape to preserve).
 *
 * @param configUri  The URI returned by `environmentManager.getWorkflowRepoConfigUri()`.
 */
export async function saveWorkflowRepoConfig(
	configUri: vscode.Uri,
	config: WorkflowRepoConfig,
): Promise<void> {
	const content: WorkflowRepoConfigFile = {
		version: CURRENT_VERSION,
		repoUrl: config.repoUrl,
		relativePath: config.relativePath,
	};
	const data = Buffer.from(JSON.stringify(content, null, 2), 'utf-8');
	await vscode.workspace.fs.writeFile(configUri, data);
}

/**
 * Removes the sidecar, leaving the cloned files untouched.
 *
 * Used by disconnect (D2.2): the repository's contents stay exactly where they
 * are — only the binding record goes.
 */
export async function deleteWorkflowRepoConfig(configUri: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.delete(configUri, { useTrash: false });
	} catch {
		// Already gone — deleting an absent sidecar is not an error.
	}
}
