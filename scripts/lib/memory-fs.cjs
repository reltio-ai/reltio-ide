'use strict';
/**
 * An in-memory stand-in for `vscode.workspace.fs`, so tests that exercise directory
 * discovery walk a genuine tree rather than a hand-listed array of paths.
 *
 * Extracted from `test-custom-workflow-repository.cjs`, which in turn mirrored it from
 * `test-git-ready-tenant-folder-structure.cjs`. That file's own comment flagged it as a
 * generic helper "not (yet) promoted to scripts/lib/"; a third consumer
 * (`test-workflow-repo-java-discovery.cjs`) is the point at which copying it again costs
 * more than sharing it.
 */
const vscode = require('./vscode-stub.cjs');

const FileType = vscode.FileType;

/** Directory set + file map keyed by the stub Uri's `fsPath`, normalized to forward slashes. */
function createMemoryFs() {
	const dirs = new Set();
	const files = new Map();
	const norm = u => (typeof u === 'string' ? u : u.fsPath).replace(/\\/g, '/').replace(/\/+$/, '');

	const api = {
		_dirs: dirs,
		_files: files,
		async createDirectory(uri) {
			const p = norm(uri);
			const parts = p.split('/');
			for (let i = 1; i <= parts.length; i++) {
				const prefix = parts.slice(0, i).join('/');
				if (prefix) dirs.add(prefix);
			}
		},
		async writeFile(uri, bytes) {
			const p = norm(uri);
			await api.createDirectory(p.slice(0, p.lastIndexOf('/')));
			files.set(p, Buffer.from(bytes));
		},
		async readFile(uri) {
			const p = norm(uri);
			if (!files.has(p)) {
				const e = new Error(`ENOENT ${p}`);
				e.code = 'FileNotFound';
				throw e;
			}
			return new Uint8Array(files.get(p));
		},
		async stat(uri) {
			const p = norm(uri);
			if (files.has(p)) return { type: FileType.File, size: files.get(p).length };
			if (dirs.has(p)) return { type: FileType.Directory };
			const e = new Error(`ENOENT ${p}`);
			e.code = 'FileNotFound';
			throw e;
		},
		async readDirectory(uri) {
			const p = norm(uri);
			if (!dirs.has(p)) {
				const e = new Error(`ENOENT ${p}`);
				e.code = 'FileNotFound';
				throw e;
			}
			const out = new Map();
			for (const f of files.keys()) {
				if (!f.startsWith(p + '/')) continue;
				const rest = f.slice(p.length + 1);
				const head = rest.split('/')[0];
				out.set(head, rest.includes('/') ? FileType.Directory : FileType.File);
			}
			for (const d of dirs) {
				if (!d.startsWith(p + '/')) continue;
				out.set(d.slice(p.length + 1).split('/')[0], FileType.Directory);
			}
			return [...out.entries()];
		},
		async delete(uri) {
			const p = norm(uri);
			files.delete(p);
			dirs.delete(p);
			for (const f of [...files.keys()]) if (f.startsWith(p + '/')) files.delete(f);
			for (const d of [...dirs]) if (d.startsWith(p + '/')) dirs.delete(d);
		},
	};
	return api;
}

/** Creates a fresh filesystem and installs it as `vscode.workspace.fs`. */
function installMemoryFs() {
	const mem = createMemoryFs();
	vscode.workspace.fs = mem;
	return mem;
}

module.exports = { createMemoryFs, installMemoryFs };
