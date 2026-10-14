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
 *
 * Because it is committed, a cloned repository controls its content: it is validated on
 * read (see `inspectWorkflowRepoConfig`) before any field reaches git, `.gitignore`, the
 * file system or a browser.
 */
import * as vscode from 'vscode';
import { cloneUrlProblem } from './gitConfigSource';

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

/** Control characters, including the newline that would inject extra `.gitignore` lines. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Why a `relativePath` is unsafe, or `undefined` when it is fine. It is joined onto the tenant
 * folder and written into `.gitignore`, so `..` or an absolute path would point outside the tenant
 * and a newline would inject further ignore rules.
 */
export function relativePathProblem(relativePath: string): string | undefined {
	if (CONTROL_CHARS.test(relativePath)) return 'relativePath contains control characters.';
	if (/^[\\/]/.test(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
		return 'relativePath must be relative.';
	}
	if (relativePath.split(/[\\/]/).some(segment => segment === '..')) {
		return 'relativePath must not contain "..".';
	}
	return undefined;
}

export type WorkflowRepoConfigRead =
	| { readonly config: WorkflowRepoConfig; readonly invalidReason?: undefined }
	| { readonly config?: undefined; readonly invalidReason?: string };

/**
 * Like `loadWorkflowRepoConfig`, but says WHY a sidecar was ignored. `invalidReason` is set only
 * when the file parses and has the right shape yet fails validation — an absent or unreadable
 * file is simply "not connected" — so the UI can warn once about a tampered sidecar instead of
 * silently treating it as unbound.
 */
export async function inspectWorkflowRepoConfig(
	configUri: vscode.Uri,
): Promise<WorkflowRepoConfigRead> {
	let parsed: Partial<WorkflowRepoConfigFile> | null;
	try {
		const data = await vscode.workspace.fs.readFile(configUri);
		parsed = JSON.parse(Buffer.from(data).toString('utf-8')) as Partial<WorkflowRepoConfigFile> | null;
	} catch {
		return {};
	}
	if (
		parsed === null ||
		typeof parsed !== 'object' ||
		parsed.version !== CURRENT_VERSION ||
		typeof parsed.repoUrl !== 'string' ||
		typeof parsed.relativePath !== 'string' ||
		!parsed.repoUrl ||
		!parsed.relativePath
	) {
		return {};
	}
	const urlProblem = cloneUrlProblem(parsed.repoUrl);
	if (urlProblem) return { invalidReason: `repoUrl is not allowed: ${urlProblem}` };
	const pathProblem = relativePathProblem(parsed.relativePath);
	if (pathProblem) return { invalidReason: pathProblem };
	return { config: { repoUrl: parsed.repoUrl, relativePath: parsed.relativePath } };
}

/**
 * The https URL to open in a browser for a repository, or `undefined` when there is none.
 * Only `https` is ever opened: `openExternal` would otherwise follow whatever scheme the
 * committed sidecar names. ssh and scp-style remotes have no page to open — copy them instead.
 */
export function toOpenableHttpsUrl(repoUrl: string): string | undefined {
	if (cloneUrlProblem(repoUrl)) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(repoUrl);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== 'https:') return undefined;
	parsed.username = '';
	return parsed.toString();
}

/**
 * What to write into the committed sidecar. A username in an https URL is accepted for cloning
 * (Bitbucket's own clone button produces one, and git asks for the password), but it can also be
 * a token. The sidecar is committed and shared with teammates and the remote, so it never keeps
 * userinfo for http(s); ssh and scp-style remotes keep theirs, because `git@` is the account.
 */
export function storableRepoUrl(repoUrl: string): string {
	const scheme = repoUrl.slice(0, repoUrl.indexOf(':') + 1).toLowerCase();
	if (scheme !== 'https:' && scheme !== 'http:') return repoUrl;
	try {
		const parsed = new URL(repoUrl);
		parsed.username = '';
		parsed.password = '';
		return parsed.toString();
	} catch {
		return repoUrl;
	}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reads the saved Custom Workflow Repository binding for the given tenant sidecar URI.
 *
 * @param configUri  The URI returned by `environmentManager.getWorkflowRepoConfigUri()`.
 * @returns          The config, or `undefined` if the file doesn't exist, can't
 *                   be parsed, has an unexpected version/shape, or fails validation
 *                   (call `inspectWorkflowRepoConfig` to learn why).
 */
export async function loadWorkflowRepoConfig(
	configUri: vscode.Uri,
): Promise<WorkflowRepoConfig | undefined> {
	return (await inspectWorkflowRepoConfig(configUri)).config;
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
