import * as fs from 'fs';
import * as path from 'path';
import type { CloudProvider } from './cloud';

const REQUIRED: Record<CloudProvider, string[][]> = {
	aws: [['AWS_REGION'], ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID']],
	gcp: [['GOOGLE_CLOUD_PROJECT'], ['GOOGLE_CLOUD_REGION']],
	azure: [['AZURE_FUNCTIONAPP_NAME'], ['AZURE_RESOURCE_GROUP']],
	native: [],
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'samples', 'velocity-packs']);

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"'))
		|| (trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** Empty and sample values do not count as cloud access details. */
export function isPlaceholderEnvValue(value: string): boolean {
	const v = unquote(value);
	if (!v) return true;
	if (/^<[^>]*>$/.test(v)) return true;
	if (/^(your-|changeme|todo|placeholder|example|xxx+|replace-me|none|null)/i.test(v)) return true;
	if (/your-(aws-)?profile|your-project|your-function|your-resource|your-access-key|your-secret|<your-/i.test(v)) return true;
	return false;
}

function envEntries(envText: string): Map<string, string> {
	const entries = new Map<string, string>();
	for (const line of envText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = unquote(trimmed.slice(eq + 1));
		if (key && !isPlaceholderEnvValue(value)) {
			entries.set(key, value);
		}
	}
	return entries;
}

/** Parse KEY names only. Values are never returned. Placeholder values are ignored. */
export function presentEnvKeys(envText: string): Set<string> {
	return new Set(envEntries(envText).keys());
}

export function missingEnvKeys(envText: string, provider: CloudProvider): string[] {
	const entries = envEntries(envText);
	const present = new Set(entries.keys());
	const missing: string[] = [];
	for (const group of REQUIRED[provider]) {
		if (group.length === 0) continue;
		if (!group.some(key => present.has(key))) {
			missing.push(group.join(' or '));
		}
	}
	const usesAccessKey = present.has('AWS_ACCESS_KEY_ID') && !present.has('AWS_PROFILE');
	if (provider === 'aws' && usesAccessKey && !present.has('AWS_SECRET_ACCESS_KEY')) {
		missing.push('AWS_SECRET_ACCESS_KEY');
	}
	const accessKey = entries.get('AWS_ACCESS_KEY_ID') ?? '';
	if (provider === 'aws' && usesAccessKey && accessKey.startsWith('ASIA') && !present.has('AWS_SESSION_TOKEN')) {
		missing.push('AWS_SESSION_TOKEN');
	}
	return missing;
}

export function envExample(provider: CloudProvider): string {
	if (provider === 'aws') {
		return [
			'AWS_REGION=us-east-1',
			'AWS_PROFILE=your-profile',
			'# Or use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Never commit real secrets.',
			'',
		].join('\n');
	}
	if (provider === 'gcp') {
		return [
			'GOOGLE_CLOUD_PROJECT=your-project',
			'GOOGLE_CLOUD_REGION=us-central1',
			'',
		].join('\n');
	}
	if (provider === 'azure') {
		return [
			'AZURE_FUNCTIONAPP_NAME=your-function-app',
			'AZURE_RESOURCE_GROUP=your-resource-group',
			'',
		].join('\n');
	}
	return '# Native LCA Service deployment does not use cloud credentials in .env\n';
}

function walkFiles(dir: string, depth: number, visit: (file: string) => void): void {
	if (depth < 0) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkFiles(full, depth - 1, visit);
		} else if (entry.isFile()) {
			visit(full);
		}
	}
}

/** Project `.env` with real values. Never returns `.env.example`. */
export function discoverEnvFile(root: string): string | undefined {
	const direct = path.join(root, '.env');
	if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
		return direct;
	}
	const found: string[] = [];
	walkFiles(root, 4, file => {
		if (path.basename(file) === '.env') found.push(file);
	});
	found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
	return found[0];
}
