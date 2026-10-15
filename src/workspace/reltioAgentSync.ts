import * as vscode from 'vscode';
import { AGENT_SKILLS_SETTING, detectHost, syncAgentSkills } from './agentSkillDiscovery';

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
	/** Workspace-relative paths of discoverable skill copies and agent guides the extension created. */
	ownedAgentFiles?: string[];
}

/** What a sync could not do, for the caller to tell the user about. */
export interface ReltioAgentSyncReport {
	/** Paths already occupied by something the extension did not create; left untouched. */
	conflicts: string[];
	/** Bundled skills an agent would reject, with the reason. */
	invalid: string[];
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
 * Then installs the discoverable skill copies and agent guides (see
 * `agentSkillDiscovery.ts`). Never touches `skills/workspace/**`.
 */
export async function syncReltioAgentAssets(
	context: vscode.ExtensionContext,
	options?: { force?: boolean; workspaceFolder?: vscode.WorkspaceFolder },
): Promise<ReltioAgentSyncReport> {
	const report: ReltioAgentSyncReport = { conflicts: [], invalid: [] };
	const force = options?.force ?? false;
	const folders = options?.workspaceFolder
		? [options.workspaceFolder]
		: vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		return report;
	}

	const assetsUri = vscode.Uri.joinPath(context.extensionUri, ...ASSETS_SEGMENTS);
	const bundled = await readJsonFile<ReltioAgentAssets>(assetsUri);
	if (!bundled?.skillsBundleVersion || !bundled?.velocityPacksBundleVersion) {
		return report;
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

		const agent = await syncAgentSkills(ws.uri, skillsSrc, stamp.ownedAgentFiles ?? [], {
			install: vscode.workspace.getConfiguration('reltio').get<boolean>(AGENT_SKILLS_SETTING, true),
			host: detectHost(vscode.env),
		});
		report.conflicts.push(...agent.conflicts);
		report.invalid.push(...agent.invalid);
		const ownershipChanged =
			JSON.stringify(agent.owned) !== JSON.stringify([...(stamp.ownedAgentFiles ?? [])].sort());

		if (skillsSynced || packsSynced || kbSynced || ownershipChanged) {
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
			next.ownedAgentFiles = agent.owned;
			await writeJsonFile(stampUri, next);
		}
	}
	return report;
}

/**
 * Decides when a workspace's mode change should sync agent assets.
 *
 * Syncing waits until a mode (tenant or repository) is chosen, because creating `.reltio/` in a
 * freshly opened folder would make it look non-empty to Connect your Repository. It syncs once per
 * mode, and losing the mode re-arms it: a user who empties the folder and connects again must get
 * the assets back, or agents are left without the skills the guides promise.
 */
export function createModeSyncTrigger(sync: () => void): (mode: string | undefined) => void {
	let synced = false;
	return mode => {
		if (mode === undefined) {
			synced = false;
			return;
		}
		if (synced) return;
		synced = true;
		sync();
	};
}
