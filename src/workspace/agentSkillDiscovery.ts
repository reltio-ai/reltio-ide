import * as vscode from 'vscode';
import { ensureGitignoreEntries } from './gitSourceMarker';

/**
 * Makes the bundled skills discoverable without an @-mention, and tells agents what to do when one
 * is missing.
 *
 * Every skill goes to `.claude/skills/<name>/`, the one folder Claude Code reads and which VS Code
 * Copilot and Cursor also read today. A second copy goes to the editor's own folder
 * (`.cursor/skills/` in Cursor, `.github/skills/` in VS Code), so discovery survives if an editor stops
 * reading `.claude/`. Only the running editor's folder is written; another editor's managed copies
 * are removed, so a workspace never carries folders for an editor it is not opened in.
 *
 * Skills only load when an agent decides they are relevant, so they cannot announce their own
 * absence. That job falls to a short always-on instruction file per agent, which lists the skills
 * the extension installs and says to stop and tell the user, rather than improvise, if one is not
 * there.
 *
 * Team overrides in `skills/workspace/<playbook>/` take precedence: they are laid over the default
 * before installing, and a new playbook there is installed as a skill of its own (`resolveSkills`).
 *
 * Every path here is extension-owned and recorded in the sync stamp. Anything already at a path the
 * extension did not create is left alone and reported, never overwritten.
 */

export const AGENT_SKILLS_SETTING = 'installAgentSkills';

/** Always-on instruction files, one per agent family, each in that agent's own documented format. */
export const GUIDE_FILES = {
	claude: '.claude/rules/reltio-skills.md',
	cursor: '.cursor/rules/reltio-skills.mdc',
	copilot: '.github/instructions/reltio-skills.instructions.md',
} as const;

/** The editor the extension is running in, as far as agent discovery cares. */
export type AgentHost = 'cursor' | 'vscode' | 'other';

/**
 * What each editor gets. `.claude/` is always written: Claude Code reads nothing else, and runs in
 * any editor's terminal. The editor's own folders are added on top.
 */
export const HOST_LAYOUTS: Record<AgentHost, { skillDirs: readonly string[]; guides: readonly (keyof typeof GUIDE_FILES)[] }> = {
	cursor: { skillDirs: ['.claude/skills', '.cursor/skills'], guides: ['claude', 'cursor'] },
	vscode: { skillDirs: ['.claude/skills', '.github/skills'], guides: ['claude', 'copilot'] },
	other: { skillDirs: ['.claude/skills'], guides: ['claude'] },
};

/** Identifies the editor from `vscode.env`. Forks such as Windsurf or VSCodium count as `other`. */
export function detectHost(env: { uriScheme?: string; appName?: string } | undefined): AgentHost {
	const scheme = (env?.uriScheme ?? '').toLowerCase();
	const app = (env?.appName ?? '').toLowerCase();
	if (scheme === 'cursor' || app.startsWith('cursor')) return 'cursor';
	if (scheme === 'vscode' || scheme === 'vscode-insiders' || app.startsWith('visual studio code')) return 'vscode';
	return 'other';
}

/** The Agent Skills naming rule shared by Claude Code, Cursor and VS Code. */
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;

export interface BundledSkill {
	/** Folder under `skills/reltio-default/`. */
	playbook: string;
	/** Frontmatter `name`, which must equal the installed folder name. */
	name: string;
	description: string;
}

export interface AgentSkillSyncResult {
	/** Workspace-relative paths the extension now owns. */
	owned: string[];
	/** Paths something else already occupies; left untouched. */
	conflicts: string[];
	/** Bundled skills that could not be installed, with the reason. */
	invalid: string[];
}

/** Reads `name` and `description` from YAML frontmatter. Single-line values only, as the skills use. */
export function readFrontmatter(markdown: string): { name?: string; description?: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
	if (!match) return {};
	const out: { name?: string; description?: string } = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = /^(name|description):\s*(.*)$/.exec(line);
		if (kv) out[kv[1] as 'name' | 'description'] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
	}
	return out;
}

/** Why a skill cannot be installed as-is, or undefined when it can. */
export function skillProblem(playbook: string, fm: { name?: string; description?: string }): string | undefined {
	if (!fm.name) return `${playbook}: SKILL.md has no frontmatter "name"`;
	if (!SKILL_NAME.test(fm.name) || fm.name.length > MAX_NAME) {
		return `${playbook}: name "${fm.name}" must be lowercase letters, digits and single hyphens, at most ${MAX_NAME} characters`;
	}
	if (!fm.description) return `${playbook}: SKILL.md has no frontmatter "description"`;
	if (fm.description.length > MAX_DESCRIPTION) return `${playbook}: description exceeds ${MAX_DESCRIPTION} characters`;
	return undefined;
}

function guideBody(skills: readonly BundledSkill[], skillDirs: readonly string[]): string {
	const list = skills.map(s => `- \`${s.name}\`: ${s.description}`).join('\n');
	return [
		'# Reltio configuration skills',
		'',
		'Managed by the Reltio IDE extension and regenerated on every sync. Edits here are overwritten.',
		'',
		'This workspace holds Reltio tenant configuration. The Reltio IDE installs these skills for it:',
		'',
		list,
		'',
		`Use the matching skill for any request one of them covers. Each lives at ${skillDirs.map(d => `\`${d}/<name>/SKILL.md\``).join(' and ')}.`,
		'',
		'If the skill a request needs is not available to you, or its `SKILL.md` cannot be read, do not write the',
		'configuration from general knowledge. Tell the user the Reltio skill is missing, and that running',
		'**Reltio: Resync agent assets (skills & Velocity Packs)** from the Command Palette restores it',
		'(the `reltio.installAgentSkills` setting must be on). Continue only if the user asks you to go ahead',
		'without it.',
		'',
	].join('\n');
}

/** The host's always-on files, each wrapped in the frontmatter its agent expects. */
export function renderGuides(skills: readonly BundledSkill[], host: AgentHost = 'other'): Record<string, string> {
	const layout = HOST_LAYOUTS[host];
	const body = guideBody(skills, layout.skillDirs);
	const all: Record<keyof typeof GUIDE_FILES, string> = {
		// No `paths`: Claude Code loads an unscoped rule at launch, like CLAUDE.md.
		claude: body,
		cursor: `---\ndescription: Reltio configuration skills and what to do when one is missing\nalwaysApply: true\n---\n\n${body}`,
		copilot: `---\napplyTo: '**'\n---\n\n${body}`,
	};
	return Object.fromEntries(layout.guides.map(g => [GUIDE_FILES[g], all[g]]));
}

const toUri = (root: vscode.Uri, rel: string): vscode.Uri => vscode.Uri.joinPath(root, ...rel.split('/'));

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return undefined;
	}
}

/** Every file under `dir`, keyed by its `/`-joined path relative to `dir`. Empty when `dir` is absent. */
async function readTree(dir: vscode.Uri, prefix = ''): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>();
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return out;
	}
	for (const [name, type] of entries) {
		const child = vscode.Uri.joinPath(dir, name);
		const rel = prefix ? `${prefix}/${name}` : name;
		if (type === vscode.FileType.Directory) {
			for (const [k, v] of await readTree(child, rel)) out.set(k, v);
		} else if (type === vscode.FileType.File) {
			out.set(rel, await vscode.workspace.fs.readFile(child));
		}
	}
	return out;
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
	return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

async function listDirectories(dir: vscode.Uri): Promise<string[]> {
	try {
		return (await vscode.workspace.fs.readDirectory(dir))
			.filter(([, type]) => type === vscode.FileType.Directory)
			.map(([name]) => name)
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

const decode = (bytes: Uint8Array | undefined): string | undefined =>
	bytes ? new TextDecoder().decode(bytes) : undefined;

/** A skill as it will be installed: the bundled default, a team override, or the two overlaid. */
export interface ResolvedSkill extends BundledSkill {
	source: 'bundled' | 'override' | 'bundled+override';
	files: Map<string, Uint8Array>;
}

/**
 * Resolves what each skill should contain, applying the `skills/workspace/` precedence.
 *
 * An override of a bundled playbook is laid over the default file by file: the team's files win,
 * and defaults it does not replace (such as `reference.md`) stay, so links between them keep
 * working. It must keep the default's `name`, because that name is the installed folder and what
 * agents and the guides refer to. An override folder with no bundled counterpart is a new skill.
 *
 * A skill agents would reject is reported and not installed, never silently replaced by the
 * default: installing the default would ignore the team's override without anyone noticing.
 */
export async function resolveSkills(
	skillsSrc: vscode.Uri,
	overridesRoot: vscode.Uri | undefined,
): Promise<{ skills: ResolvedSkill[]; invalid: string[] }> {
	const skills: ResolvedSkill[] = [];
	const invalid: string[] = [];
	const bundled = await listDirectories(skillsSrc);
	const overrides = overridesRoot ? await listDirectories(overridesRoot) : [];

	for (const playbook of [...new Set([...bundled, ...overrides])].sort((a, b) => a.localeCompare(b))) {
		const isBundled = bundled.includes(playbook);
		const isOverride = overrides.includes(playbook);
		const defaults = isBundled ? await readTree(vscode.Uri.joinPath(skillsSrc, playbook)) : new Map<string, Uint8Array>();
		const files = new Map(defaults);
		if (isOverride) {
			for (const [k, v] of await readTree(vscode.Uri.joinPath(overridesRoot!, playbook))) files.set(k, v);
		}
		const where = isOverride ? `skills/workspace/${playbook}` : playbook;

		const text = decode(files.get('SKILL.md'));
		if (text === undefined) {
			invalid.push(`${where}: no SKILL.md`);
			continue;
		}
		const fm = readFrontmatter(text);
		const problem = skillProblem(where, fm);
		if (problem) {
			invalid.push(problem);
			continue;
		}
		const defaultName = readFrontmatter(decode(defaults.get('SKILL.md')) ?? '').name;
		if (isBundled && isOverride && defaultName && fm.name !== defaultName) {
			invalid.push(`${where}: an override must keep the default's name "${defaultName}" (found "${fm.name}")`);
			continue;
		}
		skills.push({
			playbook,
			name: fm.name!,
			description: fm.description!,
			source: isBundled && isOverride ? 'bundled+override' : isOverride ? 'override' : 'bundled',
			files,
		});
	}
	return { skills, invalid };
}

/** Lists the bundled skills only, splitting off any whose frontmatter agents would reject. */
export async function readBundledSkills(skillsSrc: vscode.Uri): Promise<{ skills: BundledSkill[]; invalid: string[] }> {
	return resolveSkills(skillsSrc, undefined);
}

/** Makes `dir` hold exactly `files`, writing only what differs. */
async function converge(dir: vscode.Uri, files: Map<string, Uint8Array>): Promise<void> {
	const current = await readTree(dir);
	for (const rel of current.keys()) {
		if (!files.has(rel)) await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, ...rel.split('/')));
	}
	for (const [rel, bytes] of files) {
		if (sameBytes(current.get(rel), bytes)) continue;
		const parts = rel.split('/');
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dir, ...parts.slice(0, -1)));
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, ...parts), bytes);
	}
}

/**
 * Deletes an owned path, then any parent folders that are left empty, stopping at the workspace
 * root. A parent that still holds anything (a team's CI workflows in `.github/`, their own Cursor
 * rules) is kept, so only folders the removal emptied disappear.
 */
async function removeOwned(workspaceRoot: vscode.Uri, rel: string): Promise<void> {
	const uri = toUri(workspaceRoot, rel);
	if (await exists(uri)) await vscode.workspace.fs.delete(uri, { recursive: true });
	const parts = rel.split('/');
	for (let depth = parts.length - 1; depth > 0; depth--) {
		const dir = toUri(workspaceRoot, parts.slice(0, depth).join('/'));
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(dir);
		} catch {
			continue;
		}
		if (entries.length > 0) return;
		await vscode.workspace.fs.delete(dir, { recursive: false });
	}
}

/** Where team overrides live, relative to the workspace root. */
export const OVERRIDES_SEGMENTS = ['skills', 'workspace'] as const;

/**
 * Brings the workspace's managed skill copies and guides in line with the bundle and the team's
 * overrides under `skills/workspace/`.
 *
 * Each managed folder is converged on its resolved content: only files that differ are written and
 * stray files are removed. An unchanged workspace is therefore not rewritten, an edited override
 * reaches agents on the next sync, and a hand-edited managed copy is restored (managed copies are
 * generated; durable edits belong in `skills/workspace/`).
 */
export async function syncAgentSkills(
	workspaceRoot: vscode.Uri,
	skillsSrc: vscode.Uri,
	previouslyOwned: readonly string[],
	options: { install: boolean; host?: AgentHost },
): Promise<AgentSkillSyncResult> {
	const host = options.host ?? 'other';
	const owned = new Set(previouslyOwned);

	if (!options.install) {
		for (const rel of owned) await removeOwned(workspaceRoot, rel);
		return { owned: [], conflicts: [], invalid: [] };
	}

	const { skills, invalid } = await resolveSkills(skillsSrc, vscode.Uri.joinPath(workspaceRoot, ...OVERRIDES_SEGMENTS));
	const desired = new Map<string, { kind: 'skill'; files: Map<string, Uint8Array> } | { kind: 'guide'; text: string }>();
	for (const dir of HOST_LAYOUTS[host].skillDirs) {
		for (const s of skills) desired.set(`${dir}/${s.name}`, { kind: 'skill', files: s.files });
	}
	for (const [rel, text] of Object.entries(renderGuides(skills, host))) desired.set(rel, { kind: 'guide', text });

	// Retire what we installed earlier and no longer ship, including another editor's copies.
	for (const rel of [...owned]) {
		if (desired.has(rel)) continue;
		await removeOwned(workspaceRoot, rel);
		owned.delete(rel);
	}

	const conflicts: string[] = [];
	for (const [rel, item] of desired) {
		const uri = toUri(workspaceRoot, rel);
		if (!owned.has(rel) && (await exists(uri))) {
			conflicts.push(rel);
			continue;
		}
		if (item.kind === 'skill') {
			await converge(uri, item.files);
		} else if ((await readText(uri)) !== item.text) {
			await vscode.workspace.fs.createDirectory(toUri(workspaceRoot, rel.slice(0, rel.lastIndexOf('/'))));
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(item.text));
		}
		owned.add(rel);
	}

	// Generated copies never belong in the user's history, whichever repository encloses the workspace.
	const ownedList = [...owned].sort();
	if (ownedList.length > 0) {
		await ensureGitignoreEntries(
			workspaceRoot,
			ownedList.map(rel => (desired.get(rel)?.kind === 'skill' ? ([`${rel}/`, [rel]] as const) : ([rel, []] as const))),
		);
	}
	return { owned: ownedList, conflicts, invalid };
}
