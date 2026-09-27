import * as vscode from 'vscode';

export interface ReltioAgentAssets {
	skillsBundleVersion: string;
	velocityPacksBundleVersion: string;
	lcaKnowledgeBaseBundleVersion?: string;
}

export interface ReltioAgentSyncState {
	skillsBundleVersion?: string;
	velocityPacksBundleVersion?: string;
	lcaKnowledgeBaseBundleVersion?: string;
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

function versionsDiffer(bundled: string | undefined, stamped: string | undefined): boolean {
	if (!bundled) return false;
	return (stamped ?? '') !== bundled;
}

/**
 * Copies bundled default skills, Velocity Packs, and the LCA knowledge base into
 * `.reltio/reltio-agent/` when versions in `resources/reltio-agent-assets.json`
 * advance (or when `force` is true). The LCA skill folder is copied with the
 * knowledge base so shipping it does not recopy every other default skill.
 * Never touches `skills/workspace/**`.
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
	const kbSrc = vscode.Uri.joinPath(context.extensionUri, 'resources', 'lca-knowledge-base');

	for (const ws of folders) {
		const root = managedRootUri(ws);
		await vscode.workspace.fs.createDirectory(root);

		const stampUri = vscode.Uri.joinPath(root, STAMP_FILE);
		const stamp = (await readJsonFile<ReltioAgentSyncState>(stampUri)) ?? {};

		const destSkills = vscode.Uri.joinPath(root, 'skills', 'default');
		const destPacks = vscode.Uri.joinPath(root, 'velocity-packs');
		const destKb = vscode.Uri.joinPath(root, 'lca-knowledge-base');

		const needSkills =
			force ||
			!(await pathExists(destSkills)) ||
			versionsDiffer(bundled.skillsBundleVersion, stamp.skillsBundleVersion);
		const needPacks =
			force ||
			!(await pathExists(destPacks)) ||
			versionsDiffer(bundled.velocityPacksBundleVersion, stamp.velocityPacksBundleVersion);
		const needKb =
			Boolean(bundled.lcaKnowledgeBaseBundleVersion) &&
			(force ||
				!(await pathExists(destKb)) ||
				versionsDiffer(bundled.lcaKnowledgeBaseBundleVersion, stamp.lcaKnowledgeBaseBundleVersion));

		let skillsSynced = false;
		let packsSynced = false;
		let kbSynced = false;

		if (needSkills && (await pathExists(skillsSrc))) {
			await deleteIfExists(destSkills);
			await copyDirectory(skillsSrc, destSkills);
			skillsSynced = true;
		}

		if (needPacks && (await pathExists(packsSrc))) {
			await deleteIfExists(destPacks);
			await copyDirectory(packsSrc, destPacks);
			packsSynced = true;
		}

		if (needKb && (await pathExists(kbSrc))) {
			await deleteIfExists(destKb);
			await copyDirectory(kbSrc, destKb);
			const lcaSkillSrc = vscode.Uri.joinPath(skillsSrc, 'lca-assistant');
			if (await pathExists(lcaSkillSrc)) {
				const destLcaSkill = vscode.Uri.joinPath(destSkills, 'lca-assistant');
				await deleteIfExists(destLcaSkill);
				await copyDirectory(lcaSkillSrc, destLcaSkill);
			}
			kbSynced = true;
		}

		if (skillsSynced || packsSynced || kbSynced) {
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
			if (kbSynced && bundled.lcaKnowledgeBaseBundleVersion) {
				next.lcaKnowledgeBaseBundleVersion = bundled.lcaKnowledgeBaseBundleVersion;
			} else if (stamp.lcaKnowledgeBaseBundleVersion) {
				next.lcaKnowledgeBaseBundleVersion = stamp.lcaKnowledgeBaseBundleVersion;
			}
			await writeJsonFile(stampUri, next);
		}
	}
}
