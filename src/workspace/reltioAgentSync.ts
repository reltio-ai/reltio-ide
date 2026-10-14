import * as vscode from 'vscode';

export interface ReltioAgentAssets {
	skillsBundleVersion: string;
	velocityPacksBundleVersion: string;
}

export interface ReltioAgentSyncState {
	skillsBundleVersion?: string;
	velocityPacksBundleVersion?: string;
	extensionVersion?: string;
}

const MANAGED_SEGMENTS = ['.reltio', 'reltio-agent'] as const;
const STAMP_FILE = '.sync-state.json';
const ASSETS_SEGMENTS = ['resources', 'reltio-agent-assets.json'] as const;

function managedRootUri(ws: vscode.WorkspaceFolder): vscode.Uri {
	return vscode.Uri.joinPath(ws.uri, ...MANAGED_SEGMENTS);
}

async function readJsonFile<T>(uri: vscode.Uri): Promise<T | undefined> {
	try {
		const raw = await vscode.workspace.fs.readFile(uri);
		return JSON.parse(Buffer.from(raw).toString('utf8')) as T;
	} catch {
		return undefined;
	}
}

async function writeJsonFile(uri: vscode.Uri, data: unknown): Promise<void> {
	const text = JSON.stringify(data, null, 2);
	await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function deleteIfExists(uri: vscode.Uri): Promise<void> {
	if (await pathExists(uri)) {
		await vscode.workspace.fs.delete(uri, { recursive: true });
	}
}

async function copyDirectory(src: vscode.Uri, dest: vscode.Uri): Promise<void> {
	const entries = await vscode.workspace.fs.readDirectory(src);
	await vscode.workspace.fs.createDirectory(dest);
	for (const [name, type] of entries) {
		const from = vscode.Uri.joinPath(src, name);
		const to = vscode.Uri.joinPath(dest, name);
		if (type === vscode.FileType.Directory) {
			await copyDirectory(from, to);
		} else if (type === vscode.FileType.File) {
			const data = await vscode.workspace.fs.readFile(from);
			await vscode.workspace.fs.writeFile(to, data);
		}
	}
}

/**
 * Extension versions 1.0.24–1.0.26 wrote agent-instruction files outside `.reltio/`. Nothing is written
 * outside `.reltio/reltio-agent/` any more — the entry point is the `workflow-assistant` core skill —
 * so these markers exist only to find and remove what those versions left behind.
 */
const BLOCK_START_PREFIX = '<!-- reltio-ide:begin';
const BLOCK_END = '<!-- reltio-ide:end -->';
const LEGACY_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * Pure, exported for tests: removes the extension-managed block and leaves everything else untouched.
 * Returns `undefined` when nothing but the block (and whitespace) was in the file, so the caller can delete it.
 */
export function stripManagedBlock(text: string): string | undefined {
	const start = text.indexOf(BLOCK_START_PREFIX);
	const end = text.indexOf(BLOCK_END);
	if (start === -1 || end <= start) return text;
	const rest = (text.slice(0, start) + text.slice(end + BLOCK_END.length)).replace(/\n{3,}/g, '\n\n');
	return rest.trim() === '' ? undefined : `${rest.trim()}\n`;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	} catch {
		return undefined;
	}
}

/** Removes the managed block from workspace-root AGENTS.md / CLAUDE.md; deletes the file if the block was all it held. */
async function removeLegacyInstructionBlocks(ws: vscode.WorkspaceFolder): Promise<void> {
	for (const name of LEGACY_INSTRUCTION_FILES) {
		const uri = vscode.Uri.joinPath(ws.uri, name);
		const text = await readText(uri);
		if (text === undefined || !text.includes(BLOCK_START_PREFIX)) continue;
		const next = stripManagedBlock(text);
		if (next === undefined) {
			await vscode.workspace.fs.delete(uri);
		} else if (next !== text) {
			await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
		}
	}
}

/** Removes only what extension 1.0.24 wrote under `.cursor/` (all `reltio-` prefixed), then any dir left empty. */
async function removeLegacyCursorPointers(ws: vscode.WorkspaceFolder): Promise<void> {
	const cursor = vscode.Uri.joinPath(ws.uri, '.cursor');
	await deleteIfExists(vscode.Uri.joinPath(cursor, 'rules', 'reltio-workflows.mdc'));
	try {
		const skills = vscode.Uri.joinPath(cursor, 'skills');
		for (const [name, type] of await vscode.workspace.fs.readDirectory(skills)) {
			if (type === vscode.FileType.Directory && name.startsWith('reltio-')) {
				await deleteIfExists(vscode.Uri.joinPath(skills, name));
			}
		}
	} catch {
		/* no .cursor/skills */
	}
	for (const dir of [['rules'], ['skills'], []]) {
		const uri = vscode.Uri.joinPath(cursor, ...dir);
		try {
			if ((await vscode.workspace.fs.readDirectory(uri)).length === 0) {
				await vscode.workspace.fs.delete(uri);
			}
		} catch {
			/* absent or not empty — leave it */
		}
	}
}

function versionsDiffer(bundled: string | undefined, stamped: string | undefined): boolean {
	if (!bundled) return false;
	return (stamped ?? '') !== bundled;
}

/**
 * Copies bundled default skills and Velocity Pack reference files into
 * `.reltio/reltio-agent/` when versions in `resources/reltio-agent-assets.json`
 * advance (or when `force` is true). Never touches `skills/workspace/**`.
 */
export async function syncReltioAgentAssets(
	context: vscode.ExtensionContext,
	options?: { force?: boolean; workspaceFolder?: vscode.WorkspaceFolder },
): Promise<void> {
	const force = options?.force ?? false;
	const folders = options?.workspaceFolder
		? [options.workspaceFolder]
		: vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		return;
	}

	const assetsUri = vscode.Uri.joinPath(context.extensionUri, ...ASSETS_SEGMENTS);
	const bundled = await readJsonFile<ReltioAgentAssets>(assetsUri);
	if (!bundled?.skillsBundleVersion || !bundled?.velocityPacksBundleVersion) {
		return;
	}

	const skillsSrc = vscode.Uri.joinPath(context.extensionUri, 'skills', 'reltio-default');
	const packsSrc = vscode.Uri.joinPath(context.extensionUri, 'resources', 'velocity-packs');

	for (const ws of folders) {
		const root = managedRootUri(ws);
		await vscode.workspace.fs.createDirectory(root);

		const stampUri = vscode.Uri.joinPath(root, STAMP_FILE);
		const stamp = (await readJsonFile<ReltioAgentSyncState>(stampUri)) ?? {};

		const destSkills = vscode.Uri.joinPath(root, 'skills', 'default');
		const destPacks = vscode.Uri.joinPath(root, 'velocity-packs');

		const needSkills =
			force ||
			!(await pathExists(destSkills)) ||
			versionsDiffer(bundled.skillsBundleVersion, stamp.skillsBundleVersion);
		const needPacks =
			force ||
			!(await pathExists(destPacks)) ||
			versionsDiffer(bundled.velocityPacksBundleVersion, stamp.velocityPacksBundleVersion);

		let skillsSynced = false;
		let packsSynced = false;

		if (needSkills && (await pathExists(skillsSrc))) {
			await deleteIfExists(destSkills);
			await copyDirectory(skillsSrc, destSkills);
			skillsSynced = true;
		}

		// Everything the agent needs lives under `.reltio/reltio-agent/`. Clear what 1.0.24–1.0.26 left outside it.
		if (skillsSynced) {
			await removeLegacyInstructionBlocks(ws).catch(() => undefined);
			await removeLegacyCursorPointers(ws).catch(() => undefined);
		}

		if (needPacks && (await pathExists(packsSrc))) {
			await deleteIfExists(destPacks);
			await copyDirectory(packsSrc, destPacks);
			packsSynced = true;
		}

		if (skillsSynced || packsSynced) {
			const next: ReltioAgentSyncState = {
				extensionVersion: String(context.extension.packageJSON?.version ?? ''),
			};
			if (skillsSynced) {
				next.skillsBundleVersion = bundled.skillsBundleVersion;
			} else if (stamp.skillsBundleVersion) {
				next.skillsBundleVersion = stamp.skillsBundleVersion;
			}
			if (packsSynced) {
				next.velocityPacksBundleVersion = bundled.velocityPacksBundleVersion;
			} else if (stamp.velocityPacksBundleVersion) {
				next.velocityPacksBundleVersion = stamp.velocityPacksBundleVersion;
			}
			await writeJsonFile(stampUri, next);
		}
	}
}
