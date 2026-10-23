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

/**
 * Extension versions 1.0.24–1.0.26 wrote agent-instruction files outside `.reltio/`. Nothing is written
 * outside `.reltio/reltio-agent/` any more — the entry point is the `workflow-assistant` core skill —
 * so these markers exist only to find and remove what those versions left behind.
 */
const BLOCK_START_PREFIX = '<!-- reltio-ide:begin';
const BLOCK_END = '<!-- reltio-ide:end -->';
const LEGACY_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * Pure, exported for tests: removes every extension-managed block and leaves everything else
 * byte-for-byte as it was (blank lines included — a code fence may depend on them). A block's
 * trailing line break goes with it. When a start marker has no end marker the file is returned
 * untouched, because guessing where the block ends could delete the user's own text.
 * Returns `undefined` when nothing but blocks (and whitespace) was in the file, so the caller can delete it.
 */
export function stripManagedBlock(text: string): string | undefined {
	let out = '';
	let pos = 0;
	let removed = false;
	for (;;) {
		const start = text.indexOf(BLOCK_START_PREFIX, pos);
		if (start === -1) break;
		const end = text.indexOf(BLOCK_END, start);
		if (end === -1) return text;
		out += text.slice(pos, start);
		pos = end + BLOCK_END.length;
		if (text.startsWith('\r\n', pos)) pos += 2;
		else if (text.startsWith('\n', pos)) pos += 1;
		removed = true;
	}
	if (!removed) return text;
	out += text.slice(pos);
	return out.trim() === '' ? undefined : out;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	} catch {
		return undefined;
	}
}

/** Removes the managed block(s) from workspace-root AGENTS.md / CLAUDE.md; deletes the file if blocks were all it held. */
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

/** Exactly what 1.0.24 wrote, so a file is deleted only when it can be proven ours. */
const LEGACY_RULE_MARKER = 'description: Reltio skills are installed in this workspace';
const LEGACY_POINTER_MARKER = /^name: reltio-[\w-]+-pointer[ \t]*\r?$/m;

async function isEmptyDirectory(uri: vscode.Uri): Promise<boolean> {
	try {
		return (await vscode.workspace.fs.readDirectory(uri)).length === 0;
	} catch {
		return false;
	}
}

/**
 * Removes only what extension 1.0.24 wrote under `.cursor/`, and only files that carry its marker text. A
 * customer-owned `reltio-*` skill folder, or any other file in one, is never touched; a folder is removed
 * only when deleting our file left it empty, and likewise `rules/`, `skills/` and `.cursor/`.
 */
async function removeLegacyCursorPointers(ws: vscode.WorkspaceFolder): Promise<void> {
	const cursor = vscode.Uri.joinPath(ws.uri, '.cursor');
	const rules = vscode.Uri.joinPath(cursor, 'rules');
	const skills = vscode.Uri.joinPath(cursor, 'skills');
	let emptiedRules = false;
	let emptiedSkills = false;

	const rule = vscode.Uri.joinPath(rules, 'reltio-workflows.mdc');
	if ((await readText(rule))?.includes(LEGACY_RULE_MARKER)) {
		await vscode.workspace.fs.delete(rule);
		emptiedRules = true;
	}

	let entries: [string, vscode.FileType][] = [];
	try {
		entries = [...(await vscode.workspace.fs.readDirectory(skills))];
	} catch {
		/* no .cursor/skills */
	}
	for (const [name, type] of entries) {
		if (type !== vscode.FileType.Directory || !name.startsWith('reltio-')) continue;
		const dir = vscode.Uri.joinPath(skills, name);
		const file = vscode.Uri.joinPath(dir, 'SKILL.md');
		const text = await readText(file);
		if (text === undefined || !LEGACY_POINTER_MARKER.test(text)) continue;
		await vscode.workspace.fs.delete(file);
		emptiedSkills = true;
		if (await isEmptyDirectory(dir)) await vscode.workspace.fs.delete(dir);
	}

	if (emptiedRules && (await isEmptyDirectory(rules))) await vscode.workspace.fs.delete(rules);
	if (emptiedSkills && (await isEmptyDirectory(skills))) await vscode.workspace.fs.delete(skills);
	if ((emptiedRules || emptiedSkills) && (await isEmptyDirectory(cursor))) await vscode.workspace.fs.delete(cursor);
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
export function syncReltioAgentAssets(
	context: vscode.ExtensionContext,
	options?: { force?: boolean; workspaceFolder?: vscode.WorkspaceFolder },
): Promise<ReltioAgentSyncReport> {
	const force = options?.force ?? false;
	const shareable = !force && !options?.workspaceFolder;
	// An identical request while one is running shares it. Anything else (a forced resync, a single
	// folder) waits for the running sync to finish, then runs: two syncs never delete and copy the same
	// directories at once.
	if (shareable && sharedRun) return sharedRun;
	const run: Promise<ReltioAgentSyncReport> = tail
		.then(() => syncOnce(context, options))
		.catch(err => {
			if (!force) reportStartupFailure(err);
			throw err;
		});
	const done = run.then(() => undefined, () => undefined);
	tail = done;
	if (shareable) {
		sharedRun = run;
		void done.then(() => {
			if (sharedRun === run) sharedRun = undefined;
		});
	}
	return run;
}

let tail: Promise<void> = Promise.resolve();
let sharedRun: Promise<ReltioAgentSyncReport> | undefined;
let startupFailureReported = false;

/** Startup has no caller to show an error: log it, and tell the user once so a broken sync is not silent. */
function reportStartupFailure(err: unknown): void {
	console.error('Reltio agent asset sync failed:', err);
	if (startupFailureReported) return;
	startupFailureReported = true;
	void vscode.window.showWarningMessage(
		'Reltio could not update the agent skills under .reltio/reltio-agent/. Run "Reltio: Resync Agent Assets" to retry.',
	);
}

async function syncOnce(
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

	// Everything the agent needs lives under `.reltio/reltio-agent/`. Clear what 1.0.24–1.0.26 left outside
	// it on every sync, so a workspace that is already stamped current is cleaned too.
	for (const ws of folders) {
		await removeLegacyInstructionBlocks(ws).catch(() => undefined);
		await removeLegacyCursorPointers(ws).catch(() => undefined);
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
