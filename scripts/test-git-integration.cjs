#!/usr/bin/env node
'use strict';
/**
 * Regression: Git Integration (docs/test-proposals/git-integration.json).
 *
 * Rows: GIT-001 (clone URL allow-list, redaction, pre-spawn refusal), GIT-003 (git failure mapping),
 * GIT-004 (markers, .gitignore entries, layout constants), GIT-005 (bindTenantToGit: clone, adopt,
 * declined, new branch from default), GIT-006 (layout migration: backup first, blocked, idempotent,
 * undo), GIT-008 (git missing on bind, cleanup failures never block activation), GIT-009 (path
 * handling: win32-only case-insensitive containment, tenant paths).
 *
 * GIT-002 extends test-git-ready-tenant-folder-structure.cjs; GIT-007 is already covered there.
 *
 * `child_process.execFile` is replaced before any git module loads, because gitConfigSource.ts and
 * tenantGitBinding.ts bind `promisify(execFile)` at require time (see test-git-repository-source.cjs).
 * No real git runs: the fake records every call and simulates its effect on the memory fs.
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const childProcess = require('child_process');
let execFileHandler = () => {
	throw new Error('execFile not stubbed for this test');
};
childProcess.execFile = (...args) => execFileHandler(...args);

const gitSource = importDist('workspace/gitConfigSource');
const {
	cloneUrlProblem,
	isAllowedCloneUrl,
	redactUrl,
	cloneRepository,
	isMissingBranchFailure,
	describeGitFailure,
	BranchNotFoundError,
	GitNotFoundError,
	isPathContainedIn,
} = gitSource;
const marker = importDist('workspace/gitSourceMarker');
const structure = importDist('workspace/tenantFolderStructure');
const binding = importDist('workspace/tenantGitBinding');
const migration = importDist('workspace/layoutMigration');

const {
	BUSINESS_CONFIG_FILE,
	IDE_STATE_DIR,
	BASELINE_FILE,
	LAYOUT_FILE,
	HISTORY_DIR,
	MIGRATION_BACKUP_DIR,
	COMPONENT_FOLDERS,
	RETIRED_COMPONENT_FOLDERS,
	tenantPath,
	isTenantConfigPath,
	renderReadme,
} = structure;

const U = p => vscode.Uri.file(p);
const text = b => Buffer.from(b).toString('utf8');

/**
 * Fake git. `respond(args, cwd)` returns stdout (or a promise of it) or throws; every call is
 * recorded as `{ args, cwd }`.
 */
function fakeGit(respond) {
	const calls = [];
	execFileHandler = (_file, args, options, callback) => {
		calls.push({ args: [...args], cwd: options && options.cwd });
		Promise.resolve()
			.then(() => respond(args, options && options.cwd))
			.then(out => callback(null, { stdout: out ?? '', stderr: '' }), err => callback(err));
	};
	return calls;
}

function gitError(message, extra = {}) {
	return Object.assign(new Error(message), extra);
}

function memento() {
	const state = new Map();
	return {
		state,
		get: (k, d) => (state.has(k) ? state.get(k) : d),
		update: async (k, v) => {
			if (v === undefined) state.delete(k);
			else state.set(k, v);
		},
	};
}

const snapshot = mem => new Map([...mem._files].map(([k, v]) => [k, text(v)]));

(async () => {
	// ===================================================================== GIT-001
	{
		for (const url of ['https://h/r.git', 'http://h/r', 'ssh://git@h/r', 'git@host:org/r.git']) {
			assert.strictEqual(cloneUrlProblem(url), undefined, `GIT-001 #1: ${url} must be accepted`);
			assert.strictEqual(isAllowedCloneUrl(url), true, `GIT-001 #1: isAllowedCloneUrl mirrors cloneUrlProblem for ${url}`);
		}
		const rejected = {
			"ext::sh -c 'x'": /./,
			'fd::3': /https:\/\/, ssh:\/\/, or git@host:path/,
			'file:///x': /https:\/\/, ssh:\/\/, or git@host:path/,
			'-oProxy': /must not start with "-"/,
			'a b': /spaces or control characters/,
			'https://h/r\u0007': /spaces or control characters/,
			'https://u:pw@h/r': /must not contain credentials/,
		};
		for (const [url, why] of Object.entries(rejected)) {
			const problem = cloneUrlProblem(url);
			assert.ok(typeof problem === 'string' && why.test(problem), `GIT-001 #1: ${JSON.stringify(url)} must be rejected with a reason, got ${problem}`);
			assert.strictEqual(isAllowedCloneUrl(url), false, `GIT-001 #1: isAllowedCloneUrl mirrors cloneUrlProblem for ${JSON.stringify(url)}`);
		}

		assert.strictEqual(redactUrl('fatal: https://user:tok@host/r.git failed'), 'fatal: https://host/r.git failed', 'GIT-001 #2: user:password removed from free text');
		assert.strictEqual(redactUrl('https://user@host/r'), 'https://host/r', 'GIT-001 #2: user-only userinfo removed');
		assert.strictEqual(redactUrl('ssh://git@host/r'), 'ssh://host/r', 'GIT-001 #2: ssh:// userinfo removed');
		assert.strictEqual(
			redactUrl('from https://a:1@h1/x to http://b@h2/y'),
			'from https://h1/x to http://h2/y',
			'GIT-001 #2: every URL in the text is redacted',
		);
		assert.strictEqual(redactUrl('no url here: https://host/r'), 'no url here: https://host/r', 'GIT-001 #2: text without userinfo unchanged');
		assert.strictEqual(redactUrl('git@host:path'), 'git@host:path', 'GIT-001 #2: scp-like form unchanged');

		for (const bad of ['ext::sh -c x', 'https://u:pw@h/r']) {
			const calls = fakeGit(() => '');
			let err;
			try {
				await cloneRepository(bad, U('/dest'));
			} catch (e) {
				err = e;
			}
			assert.ok(err && /^Unsupported git URL/.test(err.message), `GIT-001 #3: ${bad} must throw 'Unsupported git URL'`);
			assert.strictEqual(calls.length, 0, `GIT-001 #3: execFile must not be called for ${bad}`);
			assert.ok(!/pw/.test(err.message), `GIT-001 #3: the refusal must not echo the password: ${err.message}`);
		}
		{
			let err;
			fakeGit(() => '');
			try {
				await cloneRepository('https://u:pw@h/r', U('/dest'));
			} catch (e) {
				err = e;
			}
			assert.ok(err.message.includes('"https://h/r"'), `GIT-001 #3: the refusal names the redacted URL: ${err.message}`);
		}

		const url = 'https://h/r.git';
		for (const branch of [undefined, 'dev']) {
			const calls = fakeGit(() => '');
			await cloneRepository(url, U('/dest'), branch);
			assert.strictEqual(calls.length, 1, 'GIT-001 #3: exactly one git call for a valid URL');
			const args = calls[0].args;
			const cloneAt = args.indexOf('clone');
			assert.deepStrictEqual(
				args.slice(0, cloneAt),
				['-c', 'protocol.ext.allow=never', '-c', 'protocol.fd.allow=never'],
				'GIT-001 #3: protocol.ext/fd.allow=never come before clone',
			);
			const dd = args.indexOf('--');
			assert.ok(dd > cloneAt && args[dd + 1] === url, 'GIT-001 #3: "--" directly precedes the URL');
			if (branch) {
				const b = args.indexOf('--branch');
				assert.ok(b > cloneAt && b < dd && args[b + 1] === 'dev', 'GIT-001 #3: --branch <b> when a branch is given');
			} else {
				assert.ok(!args.includes('--branch'), 'GIT-001 #3: no --branch when no branch is given');
			}
			assert.strictEqual(calls[0].cwd, '/dest', 'GIT-001 #3: clone runs in the destination folder');
		}
	}

	// ===================================================================== GIT-003
	{
		assert.strictEqual(isMissingBranchFailure('fatal: Remote branch X not found in upstream origin', 'X'), true, 'GIT-003 #1: "Remote branch ... not found in upstream" recognised');
		assert.strictEqual(isMissingBranchFailure('warning: Could not find remote branch dev to clone.', 'dev'), true, 'GIT-003 #1: "Could not find remote branch" recognised');
		assert.strictEqual(isMissingBranchFailure("error: pathspec 'x' did not match any file(s) known to git", 'x'), true, 'GIT-003 #1: pathspec wording recognised');
		assert.strictEqual(isMissingBranchFailure('fatal: Authentication failed for https://h/r', 'dev'), false, 'GIT-003 #1: unrelated stderr is not a missing branch');
		const pathspec = b => `error: pathspec '${b}' did not match any file(s) known to git`;
		for (const b of ['feature/(x', 'a+b']) {
			assert.doesNotThrow(() => isMissingBranchFailure(pathspec(b), b), `GIT-003 #1: ${b} must not throw`);
			assert.strictEqual(isMissingBranchFailure(pathspec(b), b), true, `GIT-003 #1: ${b} matched literally`);
		}
		assert.strictEqual(isMissingBranchFailure(pathspec('aab'), 'a+b'), false, "GIT-003 #1: 'a+b' must not match 'aab'");

		const enoent = describeGitFailure({ code: 'ENOENT' });
		assert.ok(enoent instanceof GitNotFoundError, 'GIT-003 #2: ENOENT gives GitNotFoundError');
		assert.ok(/PATH/.test(enoent.message), 'GIT-003 #2: GitNotFoundError mentions PATH');
		const killed = describeGitFailure({ killed: true });
		assert.ok(/timed out after 5 minutes/.test(killed.message), `GIT-003 #2: killed gives a timeout in minutes: ${killed.message}`);
		const withCreds = new Error('fatal: could not read https://u:p@h/r');
		const redacted = describeGitFailure(withCreds);
		assert.strictEqual(redacted.message, 'fatal: could not read https://h/r', 'GIT-003 #2: credentials removed');
		assert.notStrictEqual(redacted, withCreds, 'GIT-003 #2: a redacted error is a new object');
		assert.strictEqual(describeGitFailure('plain failure').message, 'plain failure', 'GIT-003 #2: a plain string becomes an Error');
		assert.ok(describeGitFailure('plain failure') instanceof Error, 'GIT-003 #2: a plain string becomes an Error instance');
		const clean = new Error('fatal: repository not found');
		assert.strictEqual(describeGitFailure(clean), clean, 'GIT-003 #2: a clean Error is returned as the same object');

		fakeGit(() => {
			throw gitError('Command failed', { stderr: 'fatal: Remote branch dev not found in upstream origin' });
		});
		let err;
		try {
			await cloneRepository('https://alice@h/r.git', U('/dest'), 'dev');
		} catch (e) {
			err = e;
		}
		assert.ok(err instanceof BranchNotFoundError, `GIT-003 #3: missing branch gives BranchNotFoundError, got ${err}`);
		assert.strictEqual(err.branch, 'dev', 'GIT-003 #3: BranchNotFoundError.branch');
		assert.strictEqual(err.url, 'https://alice@h/r.git', 'GIT-003 #3: BranchNotFoundError.url');
		assert.ok(err.message.includes('https://h/r.git') && !err.message.includes('alice'), `GIT-003 #3: message carries the redacted URL: ${err.message}`);

		const generic = gitError('fatal: unable to access https://alice@h/r.git', { stderr: 'fatal: unable to access' });
		fakeGit(() => {
			throw generic;
		});
		err = undefined;
		try {
			await cloneRepository('https://h/r.git', U('/dest'));
		} catch (e) {
			err = e;
		}
		assert.ok(err && !(err instanceof BranchNotFoundError), 'GIT-003 #3: a generic failure is not BranchNotFoundError');
		assert.strictEqual(err.message, 'fatal: unable to access https://h/r.git', 'GIT-003 #3: a generic failure goes through describeGitFailure');

		fakeGit(() => {
			throw gitError('Command failed', { stderr: 'fatal: Remote branch dev not found in upstream origin' });
		});
		err = undefined;
		try {
			await cloneRepository('https://h/r.git', U('/dest'));
		} catch (e) {
			err = e;
		}
		assert.ok(err && !(err instanceof BranchNotFoundError), 'GIT-003 #3: without a branch BranchNotFoundError is never thrown');

		fakeGit(() => {
			throw gitError('spawn git ENOENT', { code: 'ENOENT' });
		});
		await assert.rejects(() => cloneRepository('https://h/r.git', U('/dest'), 'dev'), e => e instanceof GitNotFoundError, 'GIT-003 #3: ENOENT with a branch still maps through describeGitFailure');
	}

	// ===================================================================== GIT-004
	{
		const mem = installMemoryFs();
		const src = { l3RelativePath: 'a/L3.json', environmentName: 'env', tenantId: 't1' };
		const src2 = { l3RelativePath: 'b/L3.json', environmentName: 'env', tenantId: 't2' };
		const put = (dir, body) => mem.writeFile(U(`${dir}/.reltio-config-source.json`), Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));

		await put('/m/legacy', src);
		assert.deepStrictEqual(await marker.readMultiGitSourceMarker(U('/m/legacy')), { sources: [src] }, 'GIT-004 #1: legacy single object wraps into {sources:[x]}');
		assert.deepStrictEqual(await marker.readGitSourceMarker(U('/m/legacy')), src, 'GIT-004 #1: readGitSourceMarker returns the first source');
		await put('/m/multi', { sources: [src, src2] });
		assert.deepStrictEqual(await marker.readMultiGitSourceMarker(U('/m/multi')), { sources: [src, src2] }, 'GIT-004 #1: valid multi returned as is');
		assert.deepStrictEqual(await marker.readGitSourceMarker(U('/m/multi')), src, 'GIT-004 #1: first of a multi marker');
		await put('/m/badentry', { sources: [src, { tenantId: 1 }] });
		await put('/m/badjson', '{not json');
		for (const dir of ['/m/badentry', '/m/badjson', '/m/missing']) {
			assert.strictEqual(await marker.readMultiGitSourceMarker(U(dir)), undefined, `GIT-004 #1: ${dir} gives undefined`);
			assert.strictEqual(await marker.readGitSourceMarker(U(dir)), undefined, `GIT-004 #1: readGitSourceMarker ${dir} gives undefined`);
		}

		const gi = dir => `${dir}/.gitignore`;
		const linesOf = dir => text(mem._files.get(gi(dir))).split(/\r?\n/).filter(Boolean);
		const REQUIRED = ['.reltio-config-source.json', '.reltio/', '.reltio-ide/', '*.bpmn20.baseline.xml'];

		await mem.createDirectory(U('/g/none'));
		await marker.ensureMarkerGitignored(U('/g/none'));
		assert.ok(mem._files.has(gi('/g/none')), 'GIT-004 #2: .gitignore created when absent');
		for (const e of REQUIRED) assert.ok(linesOf('/g/none').includes(e), `GIT-004 #2: new .gitignore has ${e}`);

		await mem.writeFile(U(gi('/g/crlf')), Buffer.from('node_modules/\r\n.reltio-ide\r\n.reltio\r\n'));
		await marker.ensureMarkerGitignored(U('/g/crlf'));
		const crlf = linesOf('/g/crlf');
		assert.ok(crlf.includes('node_modules/'), 'GIT-004 #2: unrelated lines preserved');
		assert.strictEqual(crlf.filter(l => l === '.reltio-ide' || l === '.reltio-ide/').length, 1, 'GIT-004 #2: .reltio-ide (no slash, CRLF) not duplicated');
		assert.strictEqual(crlf.filter(l => l === '.reltio' || l === '.reltio/').length, 1, 'GIT-004 #2: .reltio (no slash) not duplicated');
		assert.ok(crlf.includes('.reltio-config-source.json'), 'GIT-004 #2: missing entry appended beside CRLF content');

		await mem.writeFile(U(gi('/g/nonl')), Buffer.from('dist'));
		await marker.ensureMarkerGitignored(U('/g/nonl'));
		const nonl = text(mem._files.get(gi('/g/nonl')));
		assert.ok(nonl.startsWith('dist\n.reltio-config-source.json\n'), `GIT-004 #2: newline inserted before the append: ${JSON.stringify(nonl)}`);

		let writes = 0;
		const realWrite = mem.writeFile;
		mem.writeFile = async (...a) => {
			writes++;
			return realWrite(...a);
		};
		for (const dir of ['/g/none', '/g/crlf', '/g/nonl']) await marker.ensureMarkerGitignored(U(dir));
		assert.strictEqual(writes, 0, 'GIT-004 #2: a second run writes nothing');
		mem.writeFile = realWrite;

		await mem.createDirectory(U('/g/ws'));
		await marker.ensureWorkspaceGitignored(U('/g/ws'));
		assert.ok(linesOf('/g/ws').includes('.reltio-ide-backup/'), 'GIT-004 #2: workspace variant adds .reltio-ide-backup/');

		const tenantMarker = { kind: 'tenant', environmentName: 'dev.reltio.com', tenantId: 'T1' };
		assert.strictEqual(await marker.readTenantIdentityMarker(U('/r/t')), undefined, 'GIT-004 #3: no tenant marker gives undefined');
		await marker.writeTenantIdentityMarker(U('/r/t'), tenantMarker);
		assert.deepStrictEqual(await marker.readTenantIdentityMarker(U('/r/t')), tenantMarker, 'GIT-004 #3: tenant marker round-trips exactly');
		assert.ok(mem._files.has(gi('/r/t')) && linesOf('/r/t').includes('.reltio-config-source.json'), 'GIT-004 #3: writing the tenant marker updates .gitignore');
		assert.strictEqual(await marker.readEnvironmentIdentityMarker(U('/r/env')), undefined, 'GIT-004 #3: no environment marker gives undefined');
		await marker.writeEnvironmentIdentityMarker(U('/r/env'), 'dev.reltio.com');
		assert.deepStrictEqual(await marker.readEnvironmentIdentityMarker(U('/r/env')), { kind: 'environment', host: 'dev.reltio.com' }, 'GIT-004 #3: environment marker round-trips exactly');

		assert.strictEqual(BUSINESS_CONFIG_FILE, 'Business Config/BusinessConfig.json', 'GIT-004 #4: BUSINESS_CONFIG_FILE');
		assert.strictEqual(IDE_STATE_DIR, '.reltio-ide', 'GIT-004 #4: IDE_STATE_DIR');
		assert.strictEqual(BASELINE_FILE, '.reltio-ide/BusinessConfig.baseline.json', 'GIT-004 #4: BASELINE_FILE');
		assert.strictEqual(LAYOUT_FILE, '.reltio-ide/BusinessConfig.layout.json', 'GIT-004 #4: LAYOUT_FILE');
		assert.strictEqual(MIGRATION_BACKUP_DIR, '.reltio-ide-backup', 'GIT-004 #4: MIGRATION_BACKUP_DIR');
		for (const f of COMPONENT_FOLDERS) {
			assert.ok(typeof f.docsUrl === 'string' && f.docsUrl.startsWith('https://docs.reltio.com/'), `GIT-004 #4: ${f.path} has a docsUrl`);
			assert.ok(!RETIRED_COMPONENT_FOLDERS.includes(f.path), `GIT-004 #4: ${f.path} is not retired`);
		}
	}

	// ===================================================================== GIT-005
	const URL = 'https://bitbucket.org/acme/tenant-config.git';
	const bindOpts = (tenantRoot, confirm, branch = 'dev') => {
		const asked = [];
		return {
			asked,
			options: {
				tenantRoot,
				remoteUrl: URL,
				branch,
				environmentName: 'dev.reltio.com',
				tenantId: 'T1',
				confirmCreateBranch: async (b, u) => {
					asked.push([b, u]);
					return confirm;
				},
			},
		};
	};
	const missingBranch = () => gitError('Command failed', { stderr: 'fatal: Remote branch dev not found in upstream origin' });
	const CONFIG = '{"uri":"configuration","entityTypes":[]}';
	const MARKER = '.reltio-config-source.json';
	{
		// #1 empty folder, branch present: cloned.
		const mem = installMemoryFs();
		const root = U('/b1/env/T1');
		const calls = fakeGit(async (args, cwd) => {
			if (args.includes('clone')) await mem.createDirectory(U(`${cwd}/.git`));
			return '';
		});
		const { asked, options } = bindOpts(root, true);
		const outcome = await binding.bindTenantToGit(options);
		assert.deepStrictEqual(outcome, { kind: 'cloned', branch: 'dev' }, 'GIT-005 #1: outcome cloned');
		assert.strictEqual(calls.length, 1, 'GIT-005 #1: a single git clone');
		assert.ok(calls[0].args.includes('--branch') && calls[0].args.includes(URL), 'GIT-005 #1: clone of the branch');
		for (const d of ['Business Config', 'Workflows', 'LifeCycle Actions']) assert.ok(mem._dirs.has(`${root.fsPath}/${d}`), `GIT-005 #1: component tree written: ${d}`);
		assert.deepStrictEqual(JSON.parse(text(mem._files.get(`${root.fsPath}/${MARKER}`))), { kind: 'tenant', environmentName: 'dev.reltio.com', tenantId: 'T1' }, 'GIT-005 #1: identity marker written');
		assert.ok(text(mem._files.get(`${root.fsPath}/.gitignore`)).split('\n').includes('.reltio-ide/'), 'GIT-005 #1: .gitignore entries written');
		assert.strictEqual(asked.length, 0, 'GIT-005 #1: confirmCreateBranch not called');
	}
	{
		// #2 populated non-repo folder: adopted with a mixed reset.
		const mem = installMemoryFs();
		const root = U('/b2/env/T1');
		await mem.writeFile(U(`${root.fsPath}/${BUSINESS_CONFIG_FILE}`), Buffer.from(CONFIG));
		const calls = fakeGit(async (args, cwd) => {
			if (args[0] === 'init') await mem.createDirectory(U(`${cwd}/.git`));
			return '';
		});
		const { asked, options } = bindOpts(root, true);
		const outcome = await binding.bindTenantToGit(options);
		assert.deepStrictEqual(
			calls.map(c => c.args),
			[
				['init', '-b', 'dev'],
				['remote', 'add', 'origin', URL],
				['fetch', 'origin', 'dev'],
				['reset', 'origin/dev'],
				['branch', '--set-upstream-to=origin/dev', 'dev'],
			],
			'GIT-005 #2: adopt runs init -b, remote add, fetch, mixed reset, set-upstream-to',
		);
		assert.ok(!calls.some(c => c.args.includes('--hard')), 'GIT-005 #2: never reset --hard');
		assert.deepStrictEqual(outcome, { kind: 'adopted', branch: 'dev' }, 'GIT-005 #2: outcome adopted');
		assert.strictEqual(text(mem._files.get(`${root.fsPath}/${BUSINESS_CONFIG_FILE}`)), CONFIG, 'GIT-005 #2: BusinessConfig.json bytes unchanged');
		assert.strictEqual(asked.length, 0, 'GIT-005 #2: no branch prompt when the branch exists');

		// Same folder, already a repository: refused.
		const repo = U('/b2/env/T2');
		await mem.writeFile(U(`${repo.fsPath}/${BUSINESS_CONFIG_FILE}`), Buffer.from(CONFIG));
		await mem.createDirectory(U(`${repo.fsPath}/.git`));
		const calls2 = fakeGit(() => '');
		await assert.rejects(() => binding.bindTenantToGit(bindOpts(repo, true).options), /already a Git repository/, 'GIT-005 #2: an existing .git throws');
		assert.strictEqual(calls2.length, 0, 'GIT-005 #2: no git command on an existing repository');
	}
	{
		// #3 declined on the clone path.
		const mem = installMemoryFs();
		const root = U('/b3/env/T1');
		const calls = fakeGit(args => {
			if (args.includes('clone')) throw missingBranch();
			return '';
		});
		const { asked, options } = bindOpts(root, false);
		const outcome = await binding.bindTenantToGit(options);
		assert.deepStrictEqual(outcome, { kind: 'declined', branch: 'dev' }, 'GIT-005 #3: clone path declined');
		assert.deepStrictEqual(asked, [['dev', URL]], 'GIT-005 #3: asked once with branch and URL');
		assert.strictEqual(calls.length, 1, 'GIT-005 #3: nothing ran after declining');
		assert.ok(!mem._files.has(`${root.fsPath}/${MARKER}`), 'GIT-005 #3: no marker after declining (clone)');
		assert.ok(!mem._dirs.has(`${root.fsPath}/LifeCycle Actions`), 'GIT-005 #3: no tree after declining (clone)');

		// Declined on the adopt path: the .git it created is deleted.
		const adopt = U('/b3/env/T2');
		await mem.writeFile(U(`${adopt.fsPath}/${BUSINESS_CONFIG_FILE}`), Buffer.from(CONFIG));
		fakeGit(async (args, cwd) => {
			if (args[0] === 'init') await mem.createDirectory(U(`${cwd}/.git`));
			if (args[0] === 'fetch') throw gitError("fatal: couldn't find remote ref dev");
			return '';
		});
		const declined = await binding.bindTenantToGit(bindOpts(adopt, false).options);
		assert.deepStrictEqual(declined, { kind: 'declined', branch: 'dev' }, 'GIT-005 #3: adopt path declined');
		assert.ok(!mem._dirs.has(`${adopt.fsPath}/.git`), 'GIT-005 #3: adopt path deletes the .git it created');
		assert.ok(!mem._files.has(`${adopt.fsPath}/${MARKER}`), 'GIT-005 #3: no marker after declining (adopt)');
		assert.strictEqual(text(mem._files.get(`${adopt.fsPath}/${BUSINESS_CONFIG_FILE}`)), CONFIG, 'GIT-005 #3: config intact after declining');

		// Confirmed on the adopt path: default branch exists, push fails, then succeeds, then empty remote.
		const adoptConfirmed = async (name, { headBranch, pushFails }) => {
			const r = U(`/b3/env/${name}`);
			await mem.writeFile(U(`${r.fsPath}/${BUSINESS_CONFIG_FILE}`), Buffer.from(CONFIG));
			const c = fakeGit(async (args, cwd) => {
				if (args[0] === 'init') await mem.createDirectory(U(`${cwd}/.git`));
				if (args[0] === 'fetch' && args[2] === 'dev') throw gitError("fatal: couldn't find remote ref dev");
				if (args[0] === 'remote' && args[1] === 'show') return `* remote origin\n  HEAD branch: ${headBranch}\n`;
				if (args[0] === 'push' && pushFails) throw gitError('! [rejected] dev (permission denied)');
				return '';
			});
			const out = await binding.bindTenantToGit(bindOpts(r, true).options);
			assert.strictEqual(text(mem._files.get(`${r.fsPath}/${BUSINESS_CONFIG_FILE}`)), CONFIG, `GIT-005 #3: no data loss (${name})`);
			return { out, calls: c, root: r };
		};
		let res = await adoptConfirmed('T3', { headBranch: 'main', pushFails: true });
		assert.strictEqual(res.out.kind, 'branch-created-not-pushed', 'GIT-005 #3: push failure gives branch-created-not-pushed');
		assert.ok(/permission denied/.test(res.out.reason), 'GIT-005 #3: the push failure reason is carried');
		assert.ok(res.calls.some(c => c.args.join(' ') === 'reset origin/main'), 'GIT-005 #3: based on the default branch with a mixed reset');
		assert.ok(mem._files.has(`${res.root.fsPath}/${MARKER}`), 'GIT-005 #3: confirmed bind writes the marker');
		res = await adoptConfirmed('T4', { headBranch: 'main', pushFails: false });
		assert.deepStrictEqual(res.out, { kind: 'branch-created', branch: 'dev' }, 'GIT-005 #3: confirmed and pushed gives branch-created');
		assert.ok(res.calls.some(c => c.args.join(' ') === 'push -u origin dev'), 'GIT-005 #3: the new branch is published');
		res = await adoptConfirmed('T5', { headBranch: '(unknown)', pushFails: false });
		assert.deepStrictEqual(res.out, { kind: 'initialized-empty-remote', branch: 'dev' }, 'GIT-005 #3: an empty remote gives initialized-empty-remote');
		assert.ok(!res.calls.some(c => c.args[0] === 'reset' || c.args[0] === 'push'), 'GIT-005 #3: nothing to reset or push on an empty remote');

		// Confirmed on the clone path against an empty remote.
		const emptyClone = U('/b3/env/T6');
		const c6 = fakeGit(async (args, cwd) => {
			if (args.includes('clone')) {
				if (args.includes('--branch')) throw missingBranch();
				await mem.createDirectory(U(`${cwd}/.git`));
			}
			if (args[0] === 'rev-parse') throw gitError("fatal: ambiguous argument 'HEAD'");
			return '';
		});
		const out6 = await binding.bindTenantToGit(bindOpts(emptyClone, true).options);
		assert.deepStrictEqual(out6, { kind: 'initialized-empty-remote', branch: 'dev' }, 'GIT-005 #3: clone path, empty remote');
		assert.ok(c6.some(c => c.args.join(' ') === 'checkout -b dev'), 'GIT-005 #3: the branch is checked out on an empty remote');
	}
	{
		// #4 clone path, branch absent, default branch carries another tenant's config.
		const run = async (rmFails) => {
			const mem = installMemoryFs();
			const root = U('/b4/env/T1');
			const LCA_README = '# LifeCycle Actions\n\nTeam notes.\n';
			const WF_README = '# Workflows repository\n';
			const calls = fakeGit(async (args, cwd) => {
				if (args.includes('clone')) {
					if (args.includes('--branch')) throw missingBranch();
					await mem.createDirectory(U(`${cwd}/.git`));
					await mem.writeFile(U(`${cwd}/${BUSINESS_CONFIG_FILE}`), Buffer.from('{"other":"tenant"}'));
					await mem.writeFile(U(`${cwd}/LifeCycle Actions/README.md`), Buffer.from(LCA_README));
					await mem.writeFile(U(`${cwd}/Workflows/README.md`), Buffer.from(WF_README));
				}
				if (args[0] === 'rev-parse') return 'abc123';
				if (args[0] === 'rm') {
					if (rmFails) throw gitError("fatal: pathspec 'Business Config/BusinessConfig.json' did not match any files");
					await mem.delete(U(`${cwd}/${args[args.length - 1]}`));
				}
				return '';
			});
			const outcome = await binding.bindTenantToGit(bindOpts(root, true).options);
			return { mem, root, calls, outcome, LCA_README, WF_README };
		};
		const r = await run(false);
		assert.deepStrictEqual(r.outcome, { kind: 'branch-created', branch: 'dev' }, 'GIT-005 #4: branch-created');
		const seq = r.calls.map(c => c.args.join(' '));
		const iCheckout = seq.indexOf('checkout -b dev');
		const iRm = seq.indexOf(`rm --quiet -- ${BUSINESS_CONFIG_FILE}`);
		const iPush = seq.indexOf('push -u origin dev');
		assert.ok(iCheckout >= 0 && iRm > iCheckout && iPush > iRm, `GIT-005 #4: checkout -b, git rm of BUSINESS_CONFIG_FILE, push -u in order: ${JSON.stringify(seq)}`);
		assert.ok(!r.calls.some(c => c.args.includes('commit')), 'GIT-005 #4: the removal is staged, never committed');
		assert.strictEqual(text(r.mem._files.get(`${r.root.fsPath}/LifeCycle Actions/README.md`)), r.LCA_README, 'GIT-005 #4: component README untouched');
		assert.strictEqual(text(r.mem._files.get(`${r.root.fsPath}/Workflows/README.md`)), r.WF_README, 'GIT-005 #4: Workflows README untouched');
		for (const d of ['Business Config', 'Workflows', 'LifeCycle Actions']) assert.ok(r.mem._dirs.has(`${r.root.fsPath}/${d}`), `GIT-005 #4: component folder kept: ${d}`);

		const r2 = await run(true);
		assert.deepStrictEqual(r2.outcome, { kind: 'branch-created', branch: 'dev' }, 'GIT-005 #4: a git rm failure is ignored');
		assert.ok(r2.calls.some(c => c.args.join(' ') === 'push -u origin dev'), 'GIT-005 #4: push still happens after a git rm failure');
	}

	// ===================================================================== GIT-006
	const LEGACY = {
		'L3.reltio.json': '{"cfg":1}',
		'L3.remote-baseline.reltio.json': '{"base":1}',
		'L3.reltio.layout.json': '{"layout":1}',
		'history/L3-a---1.reltio.json': '{"h":1}',
	};
	const DEST = {
		'L3.reltio.json': BUSINESS_CONFIG_FILE,
		'L3.remote-baseline.reltio.json': BASELINE_FILE,
		'L3.reltio.layout.json': LAYOUT_FILE,
		'history/L3-a---1.reltio.json': `${HISTORY_DIR}/L3-a---1.reltio.json`,
	};
	const writeLegacy = async (mem, root) => {
		for (const [rel, body] of Object.entries(LEGACY)) await mem.writeFile(U(`${root}/${rel}`), Buffer.from(body));
	};
	const STAMP = (e, t) => `reltio.layoutMigrated::${e}::${t}`;
	{
		// #1 backup first, byte-identical moves, stamp last; a rename failure leaves no stamp.
		const mem = installMemoryFs();
		const ws = '/m1';
		const root = `${ws}/dev/T1`;
		await writeLegacy(mem, root);
		const m = memento();
		const realRename = mem.rename;
		let renames = 0;
		let failOn;
		// Recorded rather than asserted inside the hook: migrateTenant catches anything a rename throws.
		const violations = [];
		mem.rename = async (from, to, opts) => {
			if (renames === 0) {
				for (const legacy of Object.keys(LEGACY)) {
					if (!mem._files.has(`${ws}/${MIGRATION_BACKUP_DIR}/dev.reltio.com/T1/${legacy}`)) {
						violations.push(`backup of ${legacy} missing before the first move`);
					}
				}
			}
			if (m.state.size !== 0) violations.push(`stamp present while moving ${from.fsPath}`);
			if (failOn && from.fsPath.endsWith(failOn)) throw new Error('EBUSY: resource busy');
			renames++;
			return realRename(from, to, opts);
		};

		failOn = 'L3.reltio.layout.json';
		let plan = await migration.planMigration('dev.reltio.com', 'T1', U(root));
		const failed = await migration.migrateTenant(U(ws), plan, m);
		assert.ok(failed && failed.reason === 'move-failed', `GIT-006 #1: a rename failure returns move-failed, got ${JSON.stringify(failed)}`);
		assert.ok(/EBUSY/.test(failed.detail), 'GIT-006 #1: move-failed carries the detail');
		assert.strictEqual(m.state.size, 0, 'GIT-006 #1: no stamp after a move failure');

		// Re-run from the partial state.
		failOn = undefined;
		renames = 0;
		plan = await migration.planMigration('dev.reltio.com', 'T1', U(root));
		const ok = await migration.migrateTenant(U(ws), plan, m);
		assert.deepStrictEqual(violations, [], 'GIT-006 #1: backup exists before any move and the stamp comes after all moves');
		assert.strictEqual(ok, undefined, 'GIT-006 #1: the re-run succeeds');
		for (const [legacy, dest] of Object.entries(DEST)) {
			assert.strictEqual(text(mem._files.get(`${root}/${dest}`)), LEGACY[legacy], `GIT-006 #1: ${legacy} byte-identical at ${dest}`);
			assert.ok(!mem._files.has(`${root}/${legacy}`), `GIT-006 #1: ${legacy} moved away`);
		}
		assert.strictEqual(m.state.get(STAMP('dev.reltio.com', 'T1')), true, 'GIT-006 #1: stamp written after all moves');
		mem.rename = realRename;
	}
	{
		// #2 dirty worktree, and a backup failure, both block migration.
		const mem = installMemoryFs();
		const root = '/m2/dev/T1';
		await writeLegacy(mem, root);
		await mem.createDirectory(U(`${root}/.git`));
		const before = snapshot(mem);
		const calls = fakeGit(args => (args[0] === 'status' ? ' M L3.reltio.json\n' : ''));
		const m = memento();
		const dirty = await migration.migrateTenant(U('/m2'), await migration.planMigration('dev.reltio.com', 'T1', U(root)), m);
		assert.strictEqual(dirty && dirty.reason, 'dirty-worktree', 'GIT-006 #2: dirty worktree is skipped');
		assert.ok(calls.some(c => c.args.join(' ') === 'status --porcelain'), 'GIT-006 #2: dirtiness comes from git status --porcelain');
		assert.deepStrictEqual(snapshot(mem), before, 'GIT-006 #2: dirty: no files moved or written');
		assert.strictEqual(m.state.size, 0, 'GIT-006 #2: dirty: no stamp');

		const mem2 = installMemoryFs();
		const root2 = '/m3/dev/T1';
		await writeLegacy(mem2, root2);
		mem2.copy = async () => {
			throw new Error('disk full');
		};
		const m2 = memento();
		const plan2 = await migration.planMigration('dev.reltio.com', 'T1', U(root2));
		const skip = await migration.migrateTenant(U('/m3'), plan2, m2);
		assert.deepStrictEqual(
			skip && { reason: skip.reason, detail: skip.detail },
			{ reason: 'backup-failed', detail: 'disk full' },
			'GIT-006 #2: backup failure is skipped with detail',
		);
		for (const [legacy, body] of Object.entries(LEGACY)) assert.strictEqual(text(mem2._files.get(`${root2}/${legacy}`)), body, `GIT-006 #2: legacy ${legacy} intact`);
		assert.ok(!mem2._files.has(`${root2}/${BUSINESS_CONFIG_FILE}`), 'GIT-006 #2: backup failure moved nothing');
		assert.strictEqual(m2.state.size, 0, 'GIT-006 #2: backup failure: no stamp');
	}
	const envManager = (ws, tenants) => ({
		scanEnvironments: async () => [{ name: 'dev.reltio.com', tenants: tenants.map(tenantId => ({ tenantId })) }],
		getTenantRootUri: (_env, tenantId) => U(`${ws}/dev/${tenantId}`),
	});
	{
		// #3 migrateWorkspace twice.
		const mem = installMemoryFs();
		const ws = '/m4';
		await writeLegacy(mem, `${ws}/dev/L`);
		await structure.materializeTenantTree(U(`${ws}/dev/C`));
		await mem.writeFile(U(`${ws}/dev/C/${BUSINESS_CONFIG_FILE}`), Buffer.from('{"c":1}'));
		const em = envManager(ws, ['L', 'C']);
		const m = memento();
		const first = await migration.migrateWorkspace(U(ws), em, m);
		assert.deepStrictEqual(first.migrated.map(t => t.tenantId), ['L'], 'GIT-006 #3: first run migrates the legacy tenant only');
		assert.deepStrictEqual(first.skipped, [], 'GIT-006 #3: first run skips nothing');
		assert.ok(first.backupRoot && first.backupRoot.fsPath === `${ws}/${MIGRATION_BACKUP_DIR}`, 'GIT-006 #3: first run reports backupRoot');
		const after1 = snapshot(mem);
		const second = await migration.migrateWorkspace(U(ws), em, m);
		assert.strictEqual(second.migrated.length, 0, 'GIT-006 #3: second run migrates nothing');
		assert.deepStrictEqual(second.skipped, [], 'GIT-006 #3: second run skips nothing');
		assert.strictEqual(second.backupRoot, undefined, 'GIT-006 #3: second run has no backupRoot');
		assert.deepStrictEqual(snapshot(mem), after1, 'GIT-006 #3: contents unchanged by the second run');
	}
	{
		// #4 undo restores the legacy layout; no backup touches nothing.
		const mem = installMemoryFs();
		const ws = '/m5';
		const root = `${ws}/dev/T1`;
		await writeLegacy(mem, root);
		const em = envManager(ws, ['T1']);
		const m = memento();
		const report = await migration.migrateWorkspace(U(ws), em, m);
		assert.strictEqual(report.migrated.length, 1, 'GIT-006 #4: precondition, tenant migrated');
		assert.strictEqual(m.state.get(STAMP('dev.reltio.com', 'T1')), true, 'GIT-006 #4: precondition, stamp set');
		const undo = await migration.undoMigration(U(ws), em, m);
		assert.deepStrictEqual(undo.restored, ['dev.reltio.com / T1'], 'GIT-006 #4: tenant restored');
		for (const [legacy, dest] of Object.entries(DEST)) {
			assert.strictEqual(text(mem._files.get(`${root}/${legacy}`)), LEGACY[legacy], `GIT-006 #4: ${legacy} restored with original bytes`);
			assert.ok(!mem._files.has(`${root}/${dest}`), `GIT-006 #4: migrated copy ${dest} removed`);
		}
		assert.ok(!m.state.has(STAMP('dev.reltio.com', 'T1')), 'GIT-006 #4: stamp cleared');

		const memB = installMemoryFs();
		await writeLegacy(memB, '/m6/dev/T1');
		const before = snapshot(memB);
		const none = await migration.undoMigration(U('/m6'), envManager('/m6', ['T1']), memento());
		assert.deepStrictEqual(none, { restored: [] }, 'GIT-006 #4: no backup returns restored=[]');
		assert.deepStrictEqual(snapshot(memB), before, 'GIT-006 #4: no backup touches nothing');
	}

	// ===================================================================== GIT-008
	{
		// #1 git missing during bind.
		const mem = installMemoryFs();
		const root = U('/r1/env/T1');
		await mem.writeFile(U(`${root.fsPath}/.reltio/agent.json`), Buffer.from('{"keep":true}'));
		fakeGit(() => {
			throw gitError('spawn git ENOENT', { code: 'ENOENT' });
		});
		let err;
		try {
			await binding.bindTenantToGit(bindOpts(root, true).options);
		} catch (e) {
			err = e;
		}
		assert.ok(err instanceof GitNotFoundError, `GIT-008 #1: bind rejects with GitNotFoundError, got ${err}`);
		assert.ok(/Install Git/.test(err.message), 'GIT-008 #1: the message tells the user to install Git');
		assert.ok(!mem._files.has(`${root.fsPath}/${MARKER}`), 'GIT-008 #1: no marker written');
		assert.strictEqual(text(mem._files.get(`${root.fsPath}/.reltio/agent.json`)), '{"keep":true}', 'GIT-008 #1: no tenant data deleted');
	}
	{
		// #2 cleanup failures for one tenant, and an unreadable workspace root, never block.
		const mem = installMemoryFs();
		const ws = '/r2';
		const generated = renderReadme({ path: 'DTSS', title: 'DTSS', description: 'x', expectedFiles: ['a'], docsUrl: 'https://docs.reltio.com/x', managed: false });
		for (const t of ['T1', 'T2']) {
			await structure.materializeTenantTree(U(`${ws}/dev/${t}`));
			await mem.writeFile(U(`${ws}/dev/${t}/DTSS/README.md`), Buffer.from(generated));
		}
		const realReadDirectory = mem.readDirectory;
		mem.readDirectory = async uri => {
			if (uri.fsPath.replace(/\/+$/, '') === ws) throw new Error('EACCES: permission denied');
			return realReadDirectory(uri);
		};
		const realMaterialize = structure.materializeTenantTree;
		const realPrune = structure.pruneRetiredComponentFolders;
		const seen = [];
		structure.materializeTenantTree = async root => {
			if (root.fsPath.endsWith('/T1')) throw new Error('materialize exploded');
			return realMaterialize(root);
		};
		structure.pruneRetiredComponentFolders = async root => {
			seen.push(root.fsPath);
			return realPrune(root);
		};
		let report;
		try {
			report = await migration.migrateWorkspace(U(ws), envManager(ws, ['T1', 'T2']), memento());
		} catch (e) {
			assert.fail(`GIT-008 #2: migrateWorkspace must not throw: ${e && e.message}`);
		} finally {
			structure.materializeTenantTree = realMaterialize;
			structure.pruneRetiredComponentFolders = realPrune;
			mem.readDirectory = realReadDirectory;
		}
		assert.ok(report && Array.isArray(report.skipped), 'GIT-008 #2: migrateWorkspace resolves with a report');
		assert.deepStrictEqual(report.prunedFolders, ['T2/DTSS'], 'GIT-008 #2: the other tenant is still cleaned up');
		assert.ok(seen.includes(`${ws}/dev/T2`), 'GIT-008 #2: the other tenant is processed');
		assert.deepStrictEqual(report.renamedFolders, [], 'GIT-008 #2: unreadable root renames nothing');
		assert.ok(mem._files.has(`${ws}/dev/T1/DTSS/README.md`), 'GIT-008 #2: the failing tenant is left as it was');
	}

	// ===================================================================== GIT-009
	{
		const platform = Object.getOwnPropertyDescriptor(process, 'platform');
		const setPlatform = value => Object.defineProperty(process, 'platform', { ...platform, value });
		try {
			setPlatform('win32');
			assert.strictEqual(isPathContainedIn(U('/c:/Ws'), U('/C:/ws/Env/T')), true, 'GIT-009 #1: win32: differently cased path is contained');
			assert.strictEqual(isPathContainedIn(U('/c:/Ws'), U('/C:/WS')), true, 'GIT-009 #1: win32: the root itself in other case is contained');
			assert.strictEqual(isPathContainedIn(U('/c:/Ws'), U('/c:/WS2')), false, 'GIT-009 #1: win32: sibling prefix is not contained');
			setPlatform('linux');
			assert.strictEqual(isPathContainedIn(U('/c:/Ws'), U('/C:/ws/Env/T')), false, 'GIT-009 #1: linux: case difference is not contained');
			assert.strictEqual(isPathContainedIn(U('/c:/Ws'), U('/c:/Ws/Env/T')), true, 'GIT-009 #1: linux: same-case child is contained');
			assert.strictEqual(isPathContainedIn(U('/c:/Ws/'), U('/c:/Ws/Env')), true, 'GIT-009 #1: a trailing "/" on the root is ignored');
			assert.strictEqual(isPathContainedIn(U('/c:/Ws'), U('/c:/Ws2')), false, 'GIT-009 #1: linux: sibling prefix is not contained');
		} finally {
			Object.defineProperty(process, 'platform', platform);
		}

		for (const raw of ['file:///c%3A/ws/env/t', 'file:///home/u/ws']) {
			const root = vscode.Uri.parse(raw);
			const p = tenantPath(root, BUSINESS_CONFIG_FILE);
			assert.strictEqual(p.path, vscode.Uri.joinPath(root, 'Business Config', 'BusinessConfig.json').path, `GIT-009 #2: tenantPath is Uri.joinPath of segments (${raw})`);
			assert.ok(!p.path.includes('//') && !p.path.includes('\\'), `GIT-009 #2: no doubled or backslash separators: ${p.path}`);
			assert.ok(p.path.endsWith('/Business Config/BusinessConfig.json'), `GIT-009 #2: spaces preserved: ${p.path}`);
		}
		assert.strictEqual(isTenantConfigPath('C:\\ws\\env\\t\\Business Config\\BusinessConfig.json'), true, 'GIT-009 #2: backslash config path accepted');
		assert.strictEqual(isTenantConfigPath('/ws/env/t/Business Config/BusinessConfig.json'), true, 'GIT-009 #2: forward-slash config path accepted');
		assert.strictEqual(isTenantConfigPath('C:\\ws\\env\\t\\L3.reltio.json'), true, 'GIT-009 #2: backslash legacy path accepted');
		assert.strictEqual(isTenantConfigPath('C:\\ws\\env\\t\\Business Config\\Other.json'), false, 'GIT-009 #2: other file rejected');
	}

	console.log('test-git-integration: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
