import * as fs from 'fs';
import * as path from 'path';

const SOURCE_SKIP = new Set(['node_modules', '.git', 'dist', 'target', 'samples', 'velocity-packs']);
const ARTIFACT_SKIP = new Set(['node_modules', '.git', 'dist', 'samples', 'velocity-packs']);

function walkFiles(dir: string, depth: number, visit: (file: string) => void, skip: ReadonlySet<string>): void {
	if (depth < 0) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (skip.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkFiles(full, depth - 1, visit, skip);
		else if (entry.isFile()) visit(full);
	}
}

/** True when `file` is a file inside `root`, and not `root` itself. */
export function isContainedPath(root: string, file: string): boolean {
	const base = path.resolve(root);
	const target = path.resolve(file);
	const relative = path.relative(base, target);
	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** At least one `.java` file outside build output. Deploy stays closed until this is true. */
export function hasGeneratedJava(root: string): boolean {
	let found = false;
	walkFiles(root, 6, file => {
		if (found) return;
		if (file.endsWith('.java') && isContainedPath(root, file)) found = true;
	}, SOURCE_SKIP);
	return found;
}

/** Prefer a jar or zip under `target/`, then any other jar or zip in the working directory. */
export function findDeployArtifact(root: string): string | undefined {
	const found: string[] = [];
	walkFiles(root, 6, file => {
		if (!isContainedPath(root, file)) return;
		if (/\.(jar|zip)$/i.test(file)) found.push(file);
	}, ARTIFACT_SKIP);
	found.sort((a, b) => {
		const aTarget = a.includes(`${path.sep}target${path.sep}`) ? 0 : 1;
		const bTarget = b.includes(`${path.sep}target${path.sep}`) ? 0 : 1;
		return aTarget - bTarget || a.length - b.length;
	});
	return found[0];
}
