#!/usr/bin/env node
'use strict';
/**
 * Regression: Tenant Explorer & UX.
 *
 * Rows: TREE-001 (config subtree ordering, gating, attribute grouping, parents, abstract URIs),
 * TREE-002 (config and tree node id / contextValue scheme, tenant-scoped ids), TREE-003
 * (environment and tenant node values, lazy resolveTreeItem commands), TREE-004 (tree provider
 * children, git source ordering, debounced refresh), TREE-005 (UX state derivation and context
 * publishing), TREE-006 (recents, production hosts, status bar), TREE-007 (environment context
 * menu gating; the git-workspace check for reltio.configureOAuthClient is blocked by BUG-008),
 * TREE-008 (corrupt or missing L3 gives an empty Business Config), TREE-009 (quick switch and
 * tenant row guidance; the real click flow is manual QA, Tier C), TREE-010 (no secrets in node
 * fields), TREE-011 (large-scale tree performance), TREE-012 (bad stored data, status bar timer,
 * Windows paths; real UI across OSes is manual QA, Tier C), TREE-013 (menu visibility for every
 * node type: view/item/context incl. inline, view/title and commandPalette when-clauses evaluated
 * against every contextValue the tree nodes can produce; Delete / Rename on Browse Entities is
 * blocked by BUG-012, Reset OAuth Client on a no-tenants browser-login environment by BUG-013).
 *
 * The shared vscode stub is extended at runtime only (scripts/lib is unchanged): EventEmitter
 * gets the real API's payload forwarding and dispose semantics, `window.showTextDocument` is
 * added, and individual window / commands / workspace functions are swapped per check and
 * restored afterwards.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');
const { menuEntryAppliesTo } = require('./lib/menu-when.cjs');
const { repoRoot } = require('./lib/load-sample.cjs');

// Real vscode.EventEmitter forwards the fired value and stops delivering after dispose().
vscode.EventEmitter.prototype.fire = function (data) {
	for (const l of [...this._listeners]) l(data);
};
vscode.EventEmitter.prototype.dispose = function () {
	this._listeners = [];
};
if (!vscode.window.showTextDocument) {
	vscode.window.showTextDocument = async () => undefined;
}

const configSubtree = importDist('tree/configSubtree');
const {
	getConfigRootChildren,
	getConfigNodeChildren,
	getConcreteEntityTypeUris,
	getConfigTreeItemParent,
} = configSubtree;
const { ConfigTreeItem } = importDist('tree/treeNodes');
const {
	EnvironmentNode,
	TenantNode,
	GitFolderNode,
	BusinessConfigFolderNode,
	HistoryFolderNode,
	HistorySnapshotNode,
	RdmGroupNode,
	RdmRootNode,
	RdmFolderNode,
	RdmItemNode,
} = importDist('tree/multiTenantNodes');
const { rdmSectionKeys } = importDist('tree/rdmSubtree');
const workflowNodes = importDist('tree/workflowNodes');
const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
const { TokenStore, GIT_SOURCE_TOKEN } = importDist('api/tokenStore');
const { EnvironmentManager } = importDist('workspace/environmentManager');
const uxState = importDist('ux/uxState');
const { deriveUxState, l3FileUri, UxStateBus, publishUxStateContext, publishWorkspaceSourceContext } = uxState;
const recents = importDist('ux/recents');
const { StatusBarController } = importDist('ux/statusBar');
const { quickSwitchEnvironment } = importDist('ux/quickSwitch');

const U = p => vscode.Uri.file(p);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const labels = items => items.map(i => String(i.label));
const memento = () => ({ get: () => undefined, update: async () => undefined });

/** A real Memento's contract: a missing (or undefined) key returns the default. */
class FakeMemento {
	constructor(seed = {}) {
		this.store = new Map(Object.entries(seed));
	}
	get(key, fallback) {
		const v = this.store.get(key);
		return v === undefined ? fallback : v;
	}
	async update(key, value) {
		this.store.set(key, value);
	}
}

/** Real EnvironmentManager for URI layout; scanEnvironments replaced by a fixed list. */
function stubManager(envs, gitSources = []) {
	const mgr = new EnvironmentManager(U('/ws'));
	mgr.scanEnvironments = async () => envs;
	mgr.getGitSources = () => gitSources;
	return mgr;
}

function withConfig(values, fn) {
	const original = vscode.workspace.getConfiguration;
	vscode.workspace.getConfiguration = () => ({
		get: (key, fallback) => (key in values ? values[key] : fallback),
		update: async () => {},
	});
	try {
		return fn();
	} finally {
		vscode.workspace.getConfiguration = original;
	}
}

const ENTITY_TYPE = {
	uri: 'configuration/entityTypes/Individual',
	label: 'Individual',
	attributes: [{ name: 'FirstName', type: 'String', uri: 'configuration/entityTypes/Individual/attributes/FirstName' }],
	matchGroups: [{ uri: 'configuration/entityTypes/Individual/matchGroups/ByName', rule: { exact: ['x'] } }],
	cleanseConfig: { infos: [] },
	unmerge: { enabled: true },
};

/** Members of a string-literal union type, read from the TypeScript source so the list never goes stale. */
function unionMembers(relFile, typeName) {
	const text = fs.readFileSync(path.join(repoRoot, relFile), 'utf8');
	const m = new RegExp(`export type ${typeName}\\s*=([^;]+);`).exec(text);
	assert.ok(m, `union ${typeName} found in ${relFile}`);
	const body = m[1].replace(/\/\/.*$/gm, '');
	return [...body.matchAll(/'([^']+)'/g)].map(x => x[1]);
}

/**
 * VS Code when-clause evaluation, general enough for every clause in contributes.menus:
 * `||` binds looser than `&&`, `!` negates a term or a parenthesized group, and a term is
 * `key`, `key == value`, `key != value` or `key =~ /regex/`. A key that is not in `known`
 * throws, so a clause using an unmodelled context key cannot silently evaluate to false.
 */
function evalWhenClause(when, ctx, known) {
	const src = String(when);
	const tokens = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) { i++; continue; }
		const two = src.slice(i, i + 2);
		if (['&&', '||', '==', '!=', '=~'].includes(two)) { tokens.push({ op: two }); i += 2; continue; }
		if (c === '(' || c === ')' || c === '!') { tokens.push({ op: c }); i++; continue; }
		if (c === '/' && tokens.length && tokens[tokens.length - 1].op === '=~') {
			let j = i + 1;
			while (j < src.length && src[j] !== '/') j += src[j] === '\\' ? 2 : 1;
			const flags = /^[a-z]*/.exec(src.slice(j + 1))[0];
			tokens.push({ re: new RegExp(src.slice(i + 1, j), flags) });
			i = j + 1 + flags.length;
			continue;
		}
		if (c === "'") {
			const j = src.indexOf("'", i + 1);
			tokens.push({ word: src.slice(i + 1, j) });
			i = j + 1;
			continue;
		}
		const w = /^[^\s()!=&|']+/.exec(src.slice(i));
		if (!w) throw new Error(`unparsable when clause "${src}" at ${i}`);
		tokens.push({ word: w[0] });
		i += w[0].length;
	}
	let p = 0;
	const peek = () => tokens[p];
	const isOp = op => peek() && peek().op === op;
	const lookup = key => {
		if (key === 'true') return true;
		if (key === 'false') return false;
		if (!known.includes(key)) throw new Error(`unsupported context key "${key}" in "${src}"`);
		return ctx[key];
	};
	const primary = () => {
		if (isOp('!')) { p++; return !primary(); }
		if (isOp('(')) {
			p++;
			const v = or();
			if (!isOp(')')) throw new Error(`missing ) in "${src}"`);
			p++;
			return v;
		}
		const key = tokens[p++];
		if (!key || key.word === undefined) throw new Error(`expected a key in "${src}"`);
		if (isOp('==') || isOp('!=')) {
			const op = tokens[p++].op;
			const val = tokens[p++];
			if (!val || val.word === undefined) throw new Error(`expected a value in "${src}"`);
			const eq = String(lookup(key.word) ?? '') === val.word;
			return op === '==' ? eq : !eq;
		}
		if (isOp('=~')) {
			p++;
			const re = tokens[p++];
			if (!re || !re.re) throw new Error(`expected a regex in "${src}"`);
			return re.re.test(String(lookup(key.word) ?? ''));
		}
		return Boolean(lookup(key.word));
	};
	const and = () => {
		let v = primary();
		while (isOp('&&')) { p++; v = primary() && v; }
		return v;
	};
	const or = () => {
		let v = and();
		while (isOp('||')) { p++; v = and() || v; }
		return v;
	};
	const result = or();
	if (p !== tokens.length) throw new Error(`trailing tokens in "${src}"`);
	return result;
}

(async () => {
	installMemoryFs();

	// ── TREE-001: config subtree ordering, gating, attribute grouping, parents, abstract URIs ──
	{
		const tenant = U('/ws/e1/t1/Business Config/BusinessConfig.json');

		// #1 Non-empty sections only, in SECTIONS order, with counts.
		const rootModel = {
			sources: [{ uri: 'configuration/sources/S1', label: 'S1' }],
			relationTypes: [],
			entityTypes: [ENTITY_TYPE, { uri: 'configuration/entityTypes/Org', label: 'Org' }],
		};
		const root = getConfigRootChildren(rootModel, tenant);
		assert.deepStrictEqual(labels(root), ['Entity Types (2)', 'Sources (1)'],
			`TREE-001 #1: root folders in SECTIONS order with counts and no empty folder, got ${JSON.stringify(labels(root))}`);
		assert.deepStrictEqual(root.map(i => i.nodeType), ['entityTypesFolder', 'sourcesFolder'],
			'TREE-001 #1: folder node types');

		// #2 Entity type children: Browse Entities first, then sections in code order; no Hidden Config.
		const etModel = { entityTypes: [ENTITY_TYPE] };
		const etItem = getConfigNodeChildren(etModel, getConfigRootChildren(etModel, tenant)[0])[0];
		const etChildren = getConfigNodeChildren(etModel, etItem);
		assert.deepStrictEqual(labels(etChildren),
			['Browse Entities', 'Attributes (1)', 'Match Groups (1)', 'Cleanse Config', 'Unmerge'],
			`TREE-001 #2: entity type children order, got ${JSON.stringify(labels(etChildren))}`);
		assert.ok(!etChildren.some(c => c.nodeType === 'hiddenConfigFolder'), 'TREE-001 #2: absent Hidden Config is not emitted');

		// #3 Attributes grouped nested, reference, simple; each case-insensitively alphabetical;
		// jsonPath keeps the original array index.
		const mk = (name, kind) => {
			if (kind === 'nested') return { name, type: 'Nested', attributes: [{ name: 'inner', type: 'String' }] };
			if (kind === 'reference') return { name, type: 'Reference', referencedEntityTypeURI: 'configuration/entityTypes/Org' };
			return { name, type: 'String' };
		};
		const attrs = [];
		for (const name of ['b', 'A', 'c']) {
			for (const kind of ['simple', 'reference', 'nested']) attrs.push(mk(name, kind));
		}
		const attrModel = { entityTypes: [{ uri: 'configuration/entityTypes/X', attributes: attrs }] };
		const folderItem = new ConfigTreeItem('Attributes (9)', 'attributesFolder', ['entityTypes', 0, 'attributes'], 1);
		const grouped = getConfigNodeChildren(attrModel, folderItem);
		assert.deepStrictEqual(
			grouped.map(g => `${g.nodeType}:${g.label}`),
			[
				'nestedAttribute:A', 'nestedAttribute:b', 'nestedAttribute:c',
				'referenceAttribute:A', 'referenceAttribute:b', 'referenceAttribute:c',
				'simpleAttribute:A', 'simpleAttribute:b', 'simpleAttribute:c',
			],
			`TREE-001 #3: nested, reference, simple groups, alphabetical ignoring case, got ${JSON.stringify(grouped.map(g => `${g.nodeType}:${g.label}`))}`,
		);
		for (const g of grouped) {
			const idx = g.jsonPath[g.jsonPath.length - 1];
			assert.strictEqual(attrs[idx].name, String(g.label), `TREE-001 #3: jsonPath index ${idx} points at the original attribute`);
			assert.deepStrictEqual(g.jsonPath.slice(0, -1), ['entityTypes', 0, 'attributes'], 'TREE-001 #3: jsonPath base');
		}

		// #4 Abstract types resolve to concrete descendants transitively; cycles terminate.
		const abstractModel = {
			entityTypes: [
				{ uri: 'et/A', abstract: true },
				{ uri: 'et/B', extendsTypeURI: 'et/A' },
				{ uri: 'et/C', extendsTypeURI: 'et/B' },
				{ uri: 'et/D' },
				{ uri: 'et/X', extendsTypeURI: 'et/Y' },
				{ uri: 'et/Y', extendsTypeURI: 'et/X' },
			],
		};
		assert.deepStrictEqual(getConcreteEntityTypeUris(abstractModel, ['entityTypes', 0]), ['et/B', 'et/C'],
			'TREE-001 #4: abstract A returns [B, C] transitively, D and the cycle excluded');
		assert.deepStrictEqual(getConcreteEntityTypeUris(abstractModel, ['entityTypes', 1]), ['et/B'],
			'TREE-001 #4: a concrete type returns itself');
		assert.deepStrictEqual(getConcreteEntityTypeUris(abstractModel, ['entityTypes', 4]), ['et/X'],
			'TREE-001 #4: a type in a cycle returns itself');

		// #5 Parent of an entity type is its folder; root-level paths have none.
		const parent = getConfigTreeItemParent(rootModel, new ConfigTreeItem('Individual', 'entityType', ['entityTypes', 0], 1, undefined, tenant));
		assert.ok(parent, 'TREE-001 #5: entity type has a parent');
		assert.strictEqual(String(parent.label), 'Entity Types (2)', 'TREE-001 #5: parent is the Entity Types (n) folder');
		assert.strictEqual(parent.nodeType, 'entityTypesFolder', 'TREE-001 #5: parent node type');
		assert.deepStrictEqual(parent.jsonPath, ['entityTypes'], 'TREE-001 #5: parent jsonPath');
		assert.strictEqual(parent.tenantL3Uri, tenant, 'TREE-001 #5: parent keeps tenantL3Uri');
		assert.strictEqual(
			getConfigTreeItemParent(rootModel, new ConfigTreeItem('Entity Types (2)', 'entityTypesFolder', ['entityTypes'], 1, undefined, tenant)),
			undefined,
			'TREE-001 #5: a length-1 path has no parent',
		);
	}

	// ── TREE-002: id and contextValue scheme, tenant-scoped uniqueness ──
	{
		const uri = U('/ws/e1/t1/Business Config/BusinessConfig.json');
		const folder = new ConfigTreeItem('Entity Types', 'entityTypesFolder', ['entityTypes'], 1);
		const item = new ConfigTreeItem('Individual', 'entityType', ['entityTypes', 0], 1, undefined, uri);
		const relAttrs = new ConfigTreeItem('Attributes', 'attributesFolder', ['relationTypes', 0, 'attributes'], 1);
		const relNested = new ConfigTreeItem('Addr', 'nestedAttribute', ['relationTypes', 0, 'attributes', 1], 1);
		const etAttrs = new ConfigTreeItem('Attributes', 'attributesFolder', ['entityTypes', 0, 'attributes'], 1);
		const browse = new ConfigTreeItem('Browse Entities', 'entityBrowser', ['entityTypes', 0], 0, undefined, uri);
		const browseNoUri = new ConfigTreeItem('Browse Entities', 'entityBrowser', ['entityTypes', 0], 0);

		assert.strictEqual(folder.contextValue, 'reltio.folder.entityTypesFolder', 'TREE-002 #1: folder contextValue');
		assert.strictEqual(item.contextValue, 'reltio.item.entityType', 'TREE-002 #1: item contextValue');
		assert.strictEqual(relAttrs.contextValue, 'reltio.folder.attributesFolder.relationType',
			'TREE-002 #1: relation type attributes folder gets .relationType');
		assert.strictEqual(relNested.contextValue, 'reltio.item.nestedAttribute.relationType',
			'TREE-002 #1: relation type nested attribute gets .relationType');
		assert.strictEqual(etAttrs.contextValue, 'reltio.folder.attributesFolder', 'TREE-002 #1: entity type attributes folder has no suffix');
		assert.strictEqual(browse.contextValue, 'reltio.item.entityBrowser', 'TREE-002 #1: entityBrowser contextValue');
		assert.strictEqual(folder.id, 'entityTypes', 'TREE-002 #1: id without tenant is the path');
		assert.strictEqual(item.id, `${uri.toString()}|entityTypes/0`, 'TREE-002 #1: id is <uri>|<path>');
		assert.strictEqual(browse.id, `${uri.toString()}|entityTypes/0|browseEntities`, 'TREE-002 #1: entityBrowser id adds |browseEntities');
		assert.strictEqual(browseNoUri.id, 'entityTypes/0|browseEntities', 'TREE-002 #1: entityBrowser id without tenant');
		assert.notStrictEqual(browse.id, item.id, 'TREE-002 #1: browse row and entity type row never share an id');

		// #2 Same model under two tenants gives different ids; children inherit the tenant URI.
		const model = { entityTypes: [ENTITY_TYPE] };
		const uriA = U('/ws/envA/t/Business Config/BusinessConfig.json');
		const uriB = U('/ws/envB/t/Business Config/BusinessConfig.json');
		const rootA = getConfigRootChildren(model, uriA);
		const rootB = getConfigRootChildren(model, uriB);
		assert.deepStrictEqual(rootA[0].jsonPath, rootB[0].jsonPath, 'TREE-002 #2: same jsonPath');
		assert.notStrictEqual(rootA[0].id, rootB[0].id, 'TREE-002 #2: same jsonPath gives different ids per tenant URI');
		assert.strictEqual(rootA[0].tenantL3Uri, uriA, 'TREE-002 #2: root item carries its tenant URI');
		const childrenA = getConfigNodeChildren(model, rootA[0]);
		const grandA = getConfigNodeChildren(model, childrenA[0]);
		for (const c of [...childrenA, ...grandA]) {
			assert.strictEqual(c.tenantL3Uri, uriA, `TREE-002 #2: ${c.label} inherits tenantL3Uri`);
			assert.ok(c.id.startsWith(`${uriA.toString()}|`), `TREE-002 #2: ${c.label} id is tenant-scoped`);
		}

		// #3 Tree node id prefixes; same tenant in two envs gives different ids.
		const nodesFor = env => [
			new TenantNode(env, 't1', true, false, true, 'T_READY'),
			new BusinessConfigFolderNode(env, 't1'),
			new HistoryFolderNode(env, 't1', 0),
			new GitFolderNode(env, ['DP', 'dp_lif'], true),
		];
		const [ta, ba, ha, ga] = nodesFor('envA');
		const [tb, bb, hb, gb] = nodesFor('envB');
		assert.strictEqual(ta.id, 'tenant:envA/t1', 'TREE-002 #3: tenant id prefix');
		assert.strictEqual(ba.id, 'businessConfig:envA/t1', 'TREE-002 #3: businessConfig id prefix');
		assert.strictEqual(ha.id, 'history:envA/t1', 'TREE-002 #3: history id prefix');
		assert.strictEqual(ga.id, 'gitFolder:envA/DP/dp_lif', 'TREE-002 #3: gitFolder id prefix');
		for (const [a, b] of [[ta, tb], [ba, bb], [ha, hb], [ga, gb]]) {
			assert.notStrictEqual(a.id, b.id, `TREE-002 #3: ${a.id} differs between environments`);
		}
		assert.strictEqual(ha.contextValue, 'reltio.history.folder.empty', 'TREE-002 #3: History at zero snapshots gets .empty');
		assert.strictEqual(new HistoryFolderNode('envA', 't1', 2).contextValue, 'reltio.history.folder',
			'TREE-002 #3: History with snapshots has no .empty');
	}

	// ── TREE-003: environment / tenant node values and lazy tree item commands ──
	{
		const eStates = ['E_NO_AUTH', 'E_HAS_OAUTH_NO_SESSION', 'E_AUTHED_NO_TENANTS', 'E_READY'];
		const descByState = {
			E_NO_AUTH: /^Sign in to continue$/,
			E_HAS_OAUTH_NO_SESSION: /^Sign In$/,
			E_AUTHED_NO_TENANTS: /^No tenants . click \+ to add$/,
			E_READY: undefined,
		};
		for (const isAuthorized of [true, false]) {
			for (const canBrowserLogin of [true, false]) {
				for (const eState of eStates) {
					const n = new EnvironmentNode('dev', isAuthorized, canBrowserLogin, eState);
					const base = isAuthorized
						? (canBrowserLogin ? 'reltio.environment.authorized.oauthReady' : 'reltio.environment.authorized')
						: (canBrowserLogin ? 'reltio.environment.unauthorized.oauthReady' : 'reltio.environment.unauthorized.oauthBlocked');
					const want = eState === 'E_AUTHED_NO_TENANTS' ? `${base}.noTenants` : base;
					const tag = `auth=${isAuthorized} oauth=${canBrowserLogin} ${eState}`;
					assert.strictEqual(n.contextValue, want, `TREE-003 #1: contextValue for ${tag}`);
					if (descByState[eState]) {
						assert.match(String(n.description), descByState[eState], `TREE-003 #1: description for ${tag}`);
					} else {
						assert.strictEqual(n.description, undefined, `TREE-003 #1: no description for ${tag}`);
					}
					assert.ok(String(n.tooltip).startsWith('dev'), `TREE-003 #1: tooltip names the env for ${tag}`);
					if (eState === 'E_READY') assert.strictEqual(n.tooltip, 'dev', `TREE-003 #1: E_READY tooltip is the name`);
					else assert.ok(String(n.tooltip).includes('\n'), `TREE-003 #1: ${eState} tooltip carries a hint`);
					assert.strictEqual(n.id, 'env:dev', `TREE-003 #1: id for ${tag}`);
				}
			}
		}
		assert.notStrictEqual(
			new EnvironmentNode('dev', false, false, 'E_NO_AUTH').tooltip,
			new EnvironmentNode('dev', false, true, 'E_HAS_OAUTH_NO_SESSION').tooltip,
			'TREE-003 #1: tooltip follows eState',
		);

		// #2 TenantNode values.
		const tenantDesc = {
			T_NO_L3: /^L3 not fetched . click to fetch$/,
			T_L3_NEVER_OPENED: /^Open L3 to start editing$/,
			T_READY: undefined,
		};
		withConfig({ tenantSingleClickOpen: true }, () => {
			assert.strictEqual(new TenantNode('e', 't', false, false, true, 'T_NO_L3').contextValue, 'reltio.tenant', 'TREE-003 #2: no L3');
			assert.strictEqual(new TenantNode('e', 't', true, false, true, 'T_READY').contextValue, 'reltio.tenant.l3', 'TREE-003 #2: L3');
			assert.strictEqual(new TenantNode('e', 't', true, false, true, 'T_READY', false, undefined, 'dev', true).contextValue,
				'reltio.tenant.l3.gitbound', 'TREE-003 #2: L3 git-bound');
			assert.strictEqual(new TenantNode('e', 't', false, false, true, 'T_NO_L3', false, undefined, undefined, true).contextValue,
				'reltio.tenant.gitbound', 'TREE-003 #2: git-bound without L3');
			for (const tState of Object.keys(tenantDesc)) {
				const n = new TenantNode('e', 't', tState !== 'T_NO_L3', false, true, tState);
				if (tenantDesc[tState]) assert.match(String(n.description), tenantDesc[tState], `TREE-003 #2: ${tState} description`);
				else assert.strictEqual(n.description, undefined, `TREE-003 #2: ${tState} has no description`);
				assert.strictEqual(n.command && n.command.command, tState === 'T_NO_L3' ? 'reltio.fetchL3' : 'reltio.openL3',
					`TREE-003 #2: ${tState} click command`);
			}
			const stale = new TenantNode('e', 't', true, true, false, 'T_L3_NEVER_OPENED');
			assert.strictEqual(stale.description, '(local)', 'TREE-003 #2: stale and unauthenticated shows (local)');
			const staleAuthed = new TenantNode('e', 't', true, true, true, 'T_L3_NEVER_OPENED');
			assert.match(String(staleAuthed.description), tenantDesc.T_L3_NEVER_OPENED, 'TREE-003 #2: stale but authed shows the state hint');
			const branched = new TenantNode('e', 't', true, false, true, 'T_L3_NEVER_OPENED', false, undefined, 'feature/x', true);
			assert.match(String(branched.description), /^Open L3 to start editing\s+⎇ feature\/x$/, 'TREE-003 #2: state hint plus branch marker');
			const branchedReady = new TenantNode('e', 't', true, false, true, 'T_READY', false, undefined, 'main', true);
			assert.strictEqual(branchedReady.description, '⎇ main', 'TREE-003 #2: branch marker alone when ready');
		});
		withConfig({ tenantSingleClickOpen: false }, () => {
			for (const tState of Object.keys(tenantDesc)) {
				assert.strictEqual(new TenantNode('e', 't', true, false, true, tState).command, undefined,
					`TREE-003 #2: no click command for ${tState} when tenantSingleClickOpen is false`);
			}
		});

		// #3 resolveTreeItem.
		const provider = new MultiTenantTreeProvider(null, new TokenStore(), memento(), null);
		const uri = U('/ws/e/t/Business Config/BusinessConfig.json');
		const browse = new ConfigTreeItem('Browse Entities', 'entityBrowser', ['entityTypes', 0], 0, undefined, uri);
		const resolvedBrowse = provider.resolveTreeItem(browse, browse, undefined);
		assert.strictEqual(resolvedBrowse.command.command, 'reltio.browseEntities', 'TREE-003 #3: entityBrowser gets reltio.browseEntities');
		assert.strictEqual(resolvedBrowse.command.arguments[0], browse, 'TREE-003 #3: browse command carries the item');
		const plain = new ConfigTreeItem('Individual', 'entityType', ['entityTypes', 0], 1, undefined, uri);
		assert.strictEqual(provider.resolveTreeItem(plain, plain, undefined).command.command, 'reltio.revealInEditor',
			'TREE-003 #3: config items get reltio.revealInEditor');
		const snapUri = U('/ws/e/t/.reltio-ide/history/1.reltio.json');
		const snap = new HistorySnapshotNode('e', 't', snapUri, 'snap');
		const resolvedSnap = provider.resolveTreeItem(snap, snap, undefined);
		assert.strictEqual(resolvedSnap.command.command, 'vscode.open', 'TREE-003 #3: snapshots get vscode.open');
		assert.strictEqual(resolvedSnap.command.arguments[0], snapUri, 'TREE-003 #3: vscode.open opens the snapshot fileUri');
		const tenantNode = withConfig({ tenantSingleClickOpen: false }, () => new TenantNode('e', 't', true, false, true, 'T_READY'));
		assert.strictEqual(provider.resolveTreeItem(tenantNode, tenantNode, undefined).command, undefined,
			'TREE-003 #3: TenantNode is left alone');
		const preset = { command: 'custom.cmd', title: 'Custom' };
		const withCmd = new ConfigTreeItem('Individual', 'entityType', ['entityTypes', 0], 1, undefined, uri);
		withCmd.command = preset;
		assert.strictEqual(provider.resolveTreeItem(withCmd, withCmd, undefined).command, preset,
			'TREE-003 #3: an existing config item command is not overwritten');
		const snap2 = new HistorySnapshotNode('e', 't', snapUri, 'snap');
		snap2.command = preset;
		assert.strictEqual(provider.resolveTreeItem(snap2, snap2, undefined).command, preset,
			'TREE-003 #3: an existing snapshot command is not overwritten');
	}

	// ── TREE-004: provider children, git source ordering, debounced refresh ──
	{
		// #1 Root and environment children.
		const envs = [
			{ name: 'envA', tenants: [{ tenantId: 't1', hasL3: true }, { tenantId: 't2', hasL3: false }] },
			{ name: 'envB', tenants: [{ tenantId: 't3', hasL3: true }] },
		];
		const tokens = new TokenStore();
		tokens.setToken('envA', 'tok');
		const provider = new MultiTenantTreeProvider(stubManager(envs), tokens, memento(), null);
		const roots = await provider.getChildren();
		assert.deepStrictEqual(roots.map(r => r.constructor.name), ['EnvironmentNode', 'EnvironmentNode'], 'TREE-004 #1: one EnvironmentNode per env');
		assert.deepStrictEqual(roots.map(r => [r.environmentName, r.isAuthorized]), [['envA', true], ['envB', false]],
			'TREE-004 #1: authorized flag comes from TokenStore');
		provider.setUxState({
			global: 'G_READY',
			perEnv: new Map(),
			perTenant: new Map([['envA/t1', 'T_READY']]),
			envCount: 2,
			tenantCount: 3,
		});
		const tenants = await provider.getChildren(roots[0]);
		assert.deepStrictEqual(tenants.map(t => t.constructor.name), ['TenantNode', 'TenantNode'], 'TREE-004 #1: env children are TenantNodes');
		assert.deepStrictEqual(tenants.map(t => [t.tenantId, t.tState]), [['t1', 'T_READY'], ['t2', 'T_NO_L3']],
			'TREE-004 #1: TState from uxState, else T_NO_L3');
		assert.deepStrictEqual(await provider.getChildren(new EnvironmentNode('unknown', false, false)), [],
			'TREE-004 #1: unknown env returns []');

		// #2 Tenant children.
		const withL3 = await provider.getChildren(new TenantNode('envA', 't1', true, false, true, 'T_READY'));
		assert.deepStrictEqual(withL3.map(c => c.constructor.name), ['BusinessConfigFolderNode', 'WorkflowsFolderNode'],
			'TREE-004 #2: with L3, Business Config then Workflows');
		const noL3 = await provider.getChildren(new TenantNode('envA', 't2', false, false, true, 'T_NO_L3'));
		assert.deepStrictEqual(noL3.map(c => c.constructor.name), ['WorkflowsFolderNode'], 'TREE-004 #2: without L3, Workflows only');
		tokens.setToken('gitEnv', GIT_SOURCE_TOKEN);
		const gitTenant = await provider.getChildren(new TenantNode('gitEnv', 'cfg', true, false, true, 'T_READY'));
		assert.deepStrictEqual(gitTenant.map(c => c.constructor.name), ['BusinessConfigFolderNode'], 'TREE-004 #2: git tenants get no Workflows');

		// #3 Git source ordering.
		const gitSources = [
			{ environmentName: 'repo', tenantId: 'DP/dp_lif/BusinessConfig.json', label: 'dp_lif', folders: ['DP', 'dp_lif'] },
			{ environmentName: 'repo', tenantId: 'DP/BusinessConfig.json', label: 'dpcfg', folders: ['DP'] },
			{ environmentName: 'repo', tenantId: 'Alpha/x.json', label: 'x', folders: ['Alpha'] },
			{ environmentName: 'repo', tenantId: 'zeta-id', label: 'zeta', folders: [] },
			{ environmentName: 'repo', tenantId: 'alpha-id', folders: [] },
			{ environmentName: 'other', tenantId: 'elsewhere', label: 'aaa', folders: [] },
		];
		const gitTokens = new TokenStore();
		gitTokens.setToken('repo', GIT_SOURCE_TOKEN);
		const gitProvider = new MultiTenantTreeProvider(
			stubManager([{ name: 'repo', tenants: [] }], gitSources), gitTokens, memento(), null);
		const [repoEnv] = await gitProvider.getChildren();
		const top = await gitProvider.getChildren(repoEnv);
		assert.deepStrictEqual(top.map(r => [r.constructor.name, String(r.label)]), [
			['GitFolderNode', 'Alpha'],
			['GitFolderNode', 'DP'],
			['TenantNode', 'alpha-id'],
			['TenantNode', 'zeta'],
		], `TREE-004 #3: folders first (sorted, de-duplicated), then configs by label else tenantId, got ${JSON.stringify(top.map(r => String(r.label)))}`);
		for (const t of top.filter(r => r instanceof TenantNode)) {
			assert.strictEqual(t.collapsibleState, vscode.TreeItemCollapsibleState.Expanded, 'TREE-004 #3: git configs are Expanded');
			assert.strictEqual(t.tState, 'T_READY', 'TREE-004 #3: git configs default to T_READY');
		}
		const dp = await gitProvider.getChildren(top[1]);
		assert.deepStrictEqual(dp.map(r => [r.constructor.name, String(r.label)]), [['GitFolderNode', 'dp_lif'], ['TenantNode', 'dpcfg']],
			'TREE-004 #3: GitFolderNode children are nested folders then configs');
		assert.strictEqual(top[1].collapsibleState, vscode.TreeItemCollapsibleState.Expanded, 'TREE-004 #3: git folders are Expanded');

		// #4 Debounced refresh: one event about 150 ms after a burst; notes.txt never triggers.
		const debounced = new MultiTenantTreeProvider(null, new TokenStore(), memento(), null);
		const fired = [];
		debounced.onDidChangeTreeData(() => fired.push(Date.now()));
		const doc = p => ({ uri: U(p) });
		for (let i = 0; i < 5; i++) {
			debounced.onL3DocumentChanged(doc('/ws/e/t/Business Config/BusinessConfig.json'));
			await sleep(20);
		}
		const lastCall = Date.now();
		assert.strictEqual(fired.length, 0, 'TREE-004 #4: no event fires during the burst');
		await sleep(400);
		assert.strictEqual(fired.length, 1, `TREE-004 #4: exactly one change event after a burst of 5 (got ${fired.length})`);
		assert.ok(fired[0] - lastCall >= 120, `TREE-004 #4: event fires about 150 ms after the last change (${fired[0] - lastCall} ms)`);
		debounced.onL3DocumentChanged(doc('/ws/e/t/notes.txt'));
		await sleep(250);
		assert.strictEqual(fired.length, 1, 'TREE-004 #4: notes.txt never triggers a refresh');
		debounced.onL3DocumentChanged(doc('/ws/e/t/Business Config/businessconfig.JSON'));
		await sleep(250);
		assert.strictEqual(fired.length, 2, 'TREE-004 #4: businessconfig.json matches case-insensitively');
	}

	// ── TREE-005: UX state derivation, global ladder, context publishing ──
	{
		const env = (name, tenants = []) => ({ name, tenants });
		// #1
		const oauthOnly = await deriveUxState({
			environments: [env('e1')],
			hasToken: () => false,
			hasOAuthClient: async () => true,
			openedL3Files: new Set(),
		});
		assert.strictEqual(oauthOnly.perEnv.get('e1'), 'E_HAS_OAUTH_NO_SESSION', 'TREE-005 #1: OAuth client and no token');
		assert.strictEqual(oauthOnly.global, 'G_NEEDS_AUTH', 'TREE-005 #1: nothing authed gives G_NEEDS_AUTH');
		const git = await deriveUxState({
			environments: [env('repo', [{ tenantId: 'c', hasL3: true }])],
			hasToken: () => false,
			hasOAuthClient: async () => false,
			getToken: () => GIT_SOURCE_TOKEN,
			openedL3Files: new Set(),
		});
		assert.strictEqual(git.perEnv.get('repo'), 'E_READY', 'TREE-005 #1: a git source is always E_READY');
		const gitEmpty = await deriveUxState({
			environments: [env('repo')],
			hasToken: () => false,
			hasOAuthClient: async () => true,
			getToken: () => GIT_SOURCE_TOKEN,
			openedL3Files: new Set(),
		});
		assert.strictEqual(gitEmpty.perEnv.get('repo'), 'E_READY', 'TREE-005 #1: a git source is E_READY even with no configs');
		const ready = await deriveUxState({
			environments: [env('e1', [{ tenantId: 't', hasL3: false }])],
			hasToken: () => true,
			hasOAuthClient: async () => false,
			openedL3Files: new Set(),
		});
		assert.strictEqual(ready.perEnv.get('e1'), 'E_READY', 'TREE-005 #1: token with tenants is E_READY');

		// #2
		const noTenants = await deriveUxState({
			environments: [env('e1')],
			hasToken: () => true,
			hasOAuthClient: async () => false,
			openedL3Files: new Set(),
		});
		assert.strictEqual(noTenants.global, 'G_NEEDS_TENANT', 'TREE-005 #2: authed env without tenants');
		const inputs = {
			environments: [env('e1', [{ tenantId: 't1', hasL3: true }, { tenantId: 't2', hasL3: false }]), env('e2')],
			hasToken: () => true,
			hasOAuthClient: async () => false,
			openedL3Files: new Set(),
		};
		const neverOpened = await deriveUxState(inputs);
		assert.strictEqual(neverOpened.perTenant.get('e1/t1'), 'T_L3_NEVER_OPENED', 'TREE-005 #2: L3 present but not opened');
		assert.strictEqual(neverOpened.global, 'G_READY', 'TREE-005 #2: G_READY once any L3 exists');
		assert.strictEqual(neverOpened.tenantCount, 2, 'TREE-005 #2: tenantCount');
		assert.strictEqual(neverOpened.envCount, 2, 'TREE-005 #2: envCount');
		inputs.openedL3Files = new Set([l3FileUri('e1', 't1')]);
		const opened = await deriveUxState(inputs);
		assert.strictEqual(opened.perTenant.get('e1/t1'), 'T_READY', 'TREE-005 #2: opened L3 gives T_READY');
		assert.strictEqual(opened.perTenant.get('e1/t2'), 'T_NO_L3', 'TREE-005 #2: no L3 stays T_NO_L3');

		// #3
		const bus = new UxStateBus();
		const got1 = [];
		const got2 = [];
		bus.onChange((...args) => got1.push(args));
		bus.onChange((...args) => got2.push(args));
		bus.fire();
		assert.strictEqual(got1.length, 1, 'TREE-005 #3: first listener fires once');
		assert.strictEqual(got2.length, 1, 'TREE-005 #3: second listener fires once');
		assert.strictEqual(got1[0][0], undefined, 'TREE-005 #3: no payload');
		bus.dispose();
		bus.fire();
		assert.strictEqual(got1.length + got2.length, 2, 'TREE-005 #3: dispose stops events');

		const calls = [];
		const originalExec = vscode.commands.executeCommand;
		vscode.commands.executeCommand = async (...args) => { calls.push(args); };
		try {
			await publishUxStateContext(opened);
			await publishWorkspaceSourceContext('git');
			await publishWorkspaceSourceContext(undefined);
		} finally {
			vscode.commands.executeCommand = originalExec;
		}
		assert.deepStrictEqual(calls, [
			['setContext', 'reltio.uxState', 'G_READY'],
			['setContext', 'reltio.workspaceSource', 'git'],
			['setContext', 'reltio.workspaceSource', null],
		], 'TREE-005 #3: setContext keys and values');
	}

	// ── TREE-006: recents, production hosts, status bar ──
	{
		// #1
		const m = new FakeMemento();
		for (let i = 1; i <= 12; i++) await recents.pushRecentHost(m, `h${i}.com`);
		await recents.pushRecentHost(m, 'h5.com');
		const hosts = recents.loadRecentHosts(m);
		assert.strictEqual(hosts.length, 10, `TREE-006 #1: hosts capped at 10 (got ${hosts.length})`);
		assert.strictEqual(hosts[0], 'h5.com', 'TREE-006 #1: re-pushed host is newest');
		assert.deepStrictEqual(hosts.slice(1, 4), ['h12.com', 'h11.com', 'h10.com'], 'TREE-006 #1: newest first');
		assert.strictEqual(new Set(hosts).size, hosts.length, 'TREE-006 #1: no duplicate hosts');
		for (let i = 1; i <= 12; i++) await recents.pushRecentTenant(m, 'X', `t${i}`);
		await recents.pushRecentTenant(m, 'Y', 'y1');
		const xs = recents.loadRecentTenants(m, 'X');
		assert.strictEqual(xs.length, 10, 'TREE-006 #1: tenants capped at 10 per host');
		assert.strictEqual(xs[0], 't12', 'TREE-006 #1: newest tenant first');
		assert.deepStrictEqual(recents.loadRecentTenants(m, 'Y'), ['y1'], 'TREE-006 #1: per-host lists are independent');
		assert.deepStrictEqual(recents.loadRecentTenants(m, 'Z'), [], 'TREE-006 #1: unknown host has no tenants');

		// #2
		const ws = new FakeMemento();
		await recents.saveLastAuthMethod(ws, 'browser');
		assert.strictEqual(recents.loadLastAuthMethod(ws), 'browser', 'TREE-006 #2: auth method round-trips');
		await recents.saveLastAuthMethod(ws, 'token');
		assert.strictEqual(recents.loadLastAuthMethod(ws), 'token', 'TREE-006 #2: token round-trips');
		await ws.update('reltio.lastAuthMethod', 'garbage');
		assert.strictEqual(recents.loadLastAuthMethod(ws), undefined, 'TREE-006 #2: unknown value loads undefined');
		assert.deepStrictEqual([...recents.loadOpenedL3Files(new FakeMemento())], [], 'TREE-006 #2: empty Memento gives empty Set');
		await recents.saveOpenedL3Files(ws, new Set(['a', 'b']));
		assert.deepStrictEqual([...recents.loadOpenedL3Files(ws)].sort(), ['a', 'b'], 'TREE-006 #2: opened L3 Set round-trips');

		// #3 loadProductionHosts: parse, cache, failure.
		const ctx = { extensionUri: U('/ext') };
		const originalRead = vscode.workspace.fs.readFile;
		let reads = 0;
		vscode.workspace.fs.readFile = async () => { reads++; return new TextEncoder().encode('a.com\r\n\r\n b.com \r\n'); };
		try {
			assert.deepStrictEqual(await recents.loadProductionHosts(ctx), ['a.com', 'b.com'], 'TREE-006 #3: CRLF, blanks and spaces handled');
			await recents.loadProductionHosts(ctx);
			assert.strictEqual(reads, 1, 'TREE-006 #3: cached after first read');
			// Fresh module instance for the failure path (the cache is module-level).
			const distRecents = require.resolve(path.join(__dirname, '..', 'dist', 'ux', 'recents.js'));
			delete require.cache[distRecents];
			const freshRecents = importDist('ux/recents');
			vscode.workspace.fs.readFile = async () => { throw new Error('EACCES'); };
			assert.deepStrictEqual(await freshRecents.loadProductionHosts(ctx), [], 'TREE-006 #3: failure yields [] without throwing');
		} finally {
			vscode.workspace.fs.readFile = originalRead;
		}

		// #4 / #5 Status bar.
		const originalCreate = vscode.window.createStatusBarItem;
		const item = { text: '', tooltip: '', command: '', visible: false, disposed: false,
			show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.disposed = true; } };
		vscode.window.createStatusBarItem = () => item;
		try {
			const bar = new StatusBarController();
			const st = (global, envCount = 1, tenantCount = 1) => ({ global, perEnv: new Map(), perTenant: new Map(), envCount, tenantCount });
			const cases = [
				['G_EMPTY', 'Reltio: Add an environment', 'reltio.launchSetupWizard'],
				['G_NEEDS_AUTH', 'Reltio: Sign in required', 'reltio.signInToFirstEnvironment'],
				['G_NEEDS_TENANT', 'Reltio: Add a tenant', 'workbench.view.extension.reltioExplorer'],
				['G_NEEDS_L3', 'Reltio: Fetch L3', 'workbench.view.extension.reltioExplorer'],
			];
			for (const [g, label, command] of cases) {
				bar.render(st(g), true);
				assert.strictEqual(item.text, label, `TREE-006 #4: ${g} label`);
				assert.strictEqual(item.command, command, `TREE-006 #4: ${g} command`);
				assert.ok(item.visible, `TREE-006 #4: ${g} shown`);
			}
			bar.render(st('G_READY', 1, 1), true);
			assert.strictEqual(item.text, 'Reltio: 1 env, 1 tenant', 'TREE-006 #4: singular');
			assert.strictEqual(item.command, 'workbench.view.extension.reltioExplorer', 'TREE-006 #4: G_READY command');
			bar.render(st('G_READY', 2, 3), true);
			assert.strictEqual(item.text, 'Reltio: 2 envs, 3 tenants', 'TREE-006 #4: pluralized');
			assert.ok(item.visible, 'TREE-006 #4: G_READY shown');
			bar.render(st('G_READY', 1, 0), true);
			assert.strictEqual(item.visible, false, 'TREE-006 #4: 1 env / 0 tenants hides the item');

			// #5
			bar.render(st('G_EMPTY', 0, 0), false);
			assert.strictEqual(item.visible, false, 'TREE-006 #5: G_EMPTY without a workspace folder is hidden');
			bar.render(st('G_EMPTY', 0, 0), true);
			assert.ok(item.visible, 'TREE-006 #5: G_EMPTY with a workspace folder is shown');
			assert.strictEqual(item.text, 'Reltio: Add an environment', 'TREE-006 #5: label');
			assert.strictEqual(item.command, 'reltio.launchSetupWizard', 'TREE-006 #5: bound to reltio.launchSetupWizard');
		} finally {
			vscode.window.createStatusBarItem = originalCreate;
		}
	}

	// ── TREE-007: environment context menu gating ──
	{
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		const menu = pkg.contributes.menus['view/item/context'];
		const declared = new Set(pkg.contributes.commands.map(c => c.command));
		const envEntries = menu.filter(e => /reltio\\?\.environment/.test(String(e.when ?? '')));
		assert.ok(envEntries.length > 0, 'TREE-007 #1: environment menu entries exist');

		// Every contextValue an EnvironmentNode can carry.
		const variants = new Set();
		for (const a of [true, false]) for (const o of [true, false]) {
			for (const s of ['E_NO_AUTH', 'E_HAS_OAUTH_NO_SESSION', 'E_AUTHED_NO_TENANTS', 'E_READY']) {
				variants.add(new EnvironmentNode('e', a, o, s).contextValue);
			}
		}

		// VS Code when-clause evaluation: `&&` binds tighter than `||`.
		const evalTerm = (term, ctx) => {
			const t = term.trim();
			let m;
			if ((m = /^viewItem\s*(==|=~)/.exec(t))) return menuEntryAppliesTo({ when: t }, ctx.viewItem);
			if ((m = /^reltio\.workspaceSource\s*(==|!=)\s*'(\w+)'$/.exec(t))) {
				const eq = ctx.workspaceSource === m[2];
				return m[1] === '==' ? eq : !eq;
			}
			throw new Error(`TREE-007: unsupported when term "${t}"`);
		};
		const evalWhen = (when, ctx) => {
			assert.ok(!/[()]/.test(when.replace(/\/[^/]*\//g, '')), `TREE-007: parentheses not supported in "${when}"`);
			return when.split('||').some(conj => conj.split('&&').every(term => evalTerm(term, ctx)));
		};
		const appliesIn = (entry, workspaceSource) =>
			[...variants].filter(v => evalWhen(entry.when, { viewItem: v, workspaceSource }));

		for (const e of envEntries) {
			assert.ok(declared.has(e.command), `TREE-007 #1: ${e.command} is declared in contributes.commands`);
		}

		// No tenant-connectivity entry shows in a git workspace (only Remove Repository does).
		// reltio.configureOAuthClient is excluded: blocked by BUG-008.
		for (const e of envEntries) {
			if (e.command === 'reltio.removeGitSource' || e.command === 'reltio.configureOAuthClient') continue;
			assert.deepStrictEqual(appliesIn(e, 'git'), [], `TREE-007 #1: ${e.command} (${e.group}) must not show in a git workspace`);
		}

		// Browser sign-in only on unauthorized.oauthReady.
		for (const e of envEntries.filter(x => x.command === 'reltio.loginWithBrowser')) {
			assert.deepStrictEqual(appliesIn(e, 'tenant'), ['reltio.environment.unauthorized.oauthReady'],
				`TREE-007 #1: loginWithBrowser (${e.group}) matches only unauthorized.oauthReady`);
		}
		// Token / OAuth configuration reachable on oauthBlocked.
		for (const command of ['reltio.configureOAuthClient', 'reltio.provideToken', 'reltio.signInEnvironment']) {
			const entries = envEntries.filter(x => x.command === command);
			assert.ok(entries.length > 0, `TREE-007 #1: ${command} has an environment entry`);
			assert.ok(entries.some(e => appliesIn(e, 'tenant').includes('reltio.environment.unauthorized.oauthBlocked')),
				`TREE-007 #1: ${command} matches unauthorized.oauthBlocked`);
		}
	}

	// ── TREE-008: corrupt or missing L3 gives empty Business Config ──
	{
		const mem = installMemoryFs();
		const mgr = stubManager([{ name: 'e', tenants: [{ tenantId: 't', hasL3: true }] }]);
		const provider = new MultiTenantTreeProvider(mgr, new TokenStore(), memento(), null);
		const folder = new BusinessConfigFolderNode('e', 't');
		const l3 = mgr.getL3Uri('e', 't');
		const isConfig = n => n instanceof ConfigTreeItem;

		const originalRead = vscode.workspace.fs.readFile;
		vscode.workspace.fs.readFile = async () => { throw new Error('EIO: read failed'); };
		let missing;
		try {
			missing = await provider.getChildren(folder);
		} finally {
			vscode.workspace.fs.readFile = originalRead;
		}
		assert.ok(!missing.some(isConfig), 'TREE-008 #1: unreadable L3 gives no config sections');
		assert.ok(missing.every(n => n instanceof HistoryFolderNode), 'TREE-008 #1: only History may appear');

		await mem.writeFile(l3, new TextEncoder().encode('this is not json {{{'));
		const corrupt = await provider.getChildren(folder);
		assert.ok(!corrupt.some(isConfig), 'TREE-008 #1: invalid JSON gives no config sections');
		const orphan = new ConfigTreeItem('Entity Types (1)', 'entityTypesFolder', ['entityTypes'], 1, undefined, l3);
		assert.deepStrictEqual(await provider.getChildren(orphan), [], 'TREE-008 #1: expanding a config folder over a corrupt L3 gives []');

		provider.markHistoryExposed('e', 't');
		const withHistory = await provider.getChildren(folder);
		assert.deepStrictEqual(withHistory.map(n => n.constructor.name), ['HistoryFolderNode'], 'TREE-008 #1: History may appear');

		// Open editor text wins over disk.
		const originalDocs = vscode.workspace.textDocuments;
		vscode.workspace.textDocuments = [{ uri: l3, getText: () => JSON.stringify({ entityTypes: [ENTITY_TYPE] }) }];
		try {
			const fromEditor = await provider.getChildren(folder);
			assert.deepStrictEqual(labels(fromEditor.filter(isConfig)), ['Entity Types (1)'],
				'TREE-008 #1: an already-open editor document is preferred over disk');
		} finally {
			vscode.workspace.textDocuments = originalDocs;
		}
	}

	// ── TREE-009: quick switch and tenant row guidance ──
	{
		const rec = { info: [], picks: [], exec: [], opened: [], shown: [] };
		const original = {
			info: vscode.window.showInformationMessage,
			pick: vscode.window.showQuickPick,
			exec: vscode.commands.executeCommand,
			open: vscode.workspace.openTextDocument,
			show: vscode.window.showTextDocument,
		};
		let choose = () => undefined;
		vscode.window.showInformationMessage = async msg => { rec.info.push(msg); };
		vscode.window.showQuickPick = async (items, opts) => { rec.picks.push({ items, opts }); return choose(items); };
		vscode.commands.executeCommand = async (...args) => { rec.exec.push(args); };
		vscode.workspace.openTextDocument = async uri => { rec.opened.push(uri); return { uri }; };
		vscode.window.showTextDocument = async doc => { rec.shown.push(doc); };
		const reset = () => { for (const k of Object.keys(rec)) rec[k] = []; };
		try {
			// #1 Zero envs.
			const zero = stubManager([]);
			await quickSwitchEnvironment(zero);
			assert.deepStrictEqual(rec.info, ['No Reltio environments configured.'], 'TREE-009 #1: zero envs message');
			assert.strictEqual(rec.picks.length, 0, 'TREE-009 #1: zero envs shows no pick');

			const envs = [
				{ name: 'none', tenants: [] },
				{ name: 'single', tenants: [{ tenantId: 's1', hasL3: true }] },
				{ name: 'three', tenants: [{ tenantId: 'a', hasL3: true }, { tenantId: 'b', hasL3: true }, { tenantId: 'c', hasL3: false }] },
			];
			const mgr = stubManager(envs);
			reset();
			await quickSwitchEnvironment(mgr);
			assert.deepStrictEqual(rec.picks[0].items.map(i => [i.label, i.description]),
				[['none', 'No tenants'], ['single', '1 tenant'], ['three', '3 tenants']], 'TREE-009 #1: pick item descriptions');
			assert.deepStrictEqual(rec.exec, [], 'TREE-009 #1: cancel does nothing');
			assert.deepStrictEqual(rec.opened, [], 'TREE-009 #1: cancel opens nothing');

			// #2 Single-L3 env opens its L3; two-L3 env only focuses.
			reset();
			choose = items => items.find(i => i.label === 'single');
			await quickSwitchEnvironment(mgr);
			assert.deepStrictEqual(rec.exec, [['workbench.view.extension.reltioExplorer']], 'TREE-009 #2: focuses the Reltio view');
			assert.deepStrictEqual(rec.opened.map(u => u.toString()), [mgr.getL3Uri('single', 's1').toString()],
				'TREE-009 #2: single-L3 env opens its getL3Uri document');
			assert.strictEqual(rec.shown.length, 1, 'TREE-009 #2: the document is shown');
			reset();
			choose = items => items.find(i => i.label === 'three');
			await quickSwitchEnvironment(mgr);
			assert.deepStrictEqual(rec.exec, [['workbench.view.extension.reltioExplorer']], 'TREE-009 #2: focuses the Reltio view');
			assert.deepStrictEqual(rec.opened, [], 'TREE-009 #2: an env with two L3 tenants opens nothing');
		} finally {
			vscode.window.showInformationMessage = original.info;
			vscode.window.showQuickPick = original.pick;
			vscode.commands.executeCommand = original.exec;
			vscode.workspace.openTextDocument = original.open;
			vscode.window.showTextDocument = original.show;
		}

		// #3 UxState drives the tenant row description and click command.
		installMemoryFs();
		const tokens = new TokenStore();
		tokens.setToken('e', 'tok');
		const provider = new MultiTenantTreeProvider(
			stubManager([{ name: 'e', tenants: [{ tenantId: 't', hasL3: true }] }]), tokens, memento(), null);
		const [envNode] = await provider.getChildren();
		const expectations = [
			['T_NO_L3', /^L3 not fetched . click to fetch$/, 'reltio.fetchL3'],
			['T_L3_NEVER_OPENED', /^Open L3 to start editing$/, 'reltio.openL3'],
			['T_READY', undefined, 'reltio.openL3'],
		];
		for (const [tState, desc, command] of expectations) {
			provider.setUxState({ global: 'G_READY', perEnv: new Map(), perTenant: new Map([['e/t', tState]]), envCount: 1, tenantCount: 1 });
			const [row] = await provider.getChildren(envNode);
			if (desc) assert.match(String(row.description), desc, `TREE-009 #3: ${tState} description`);
			else assert.strictEqual(row.description, undefined, `TREE-009 #3: ${tState} has no description`);
			assert.strictEqual(row.command.command, command, `TREE-009 #3: ${tState} command`);
		}
	}

	// ── TREE-010: node fields never include tokens or secrets ──
	{
		const mem = installMemoryFs();
		const envName = 'eyJhbGciOiJIUzI1NiJ9.envname';
		const tenantId = 'ghp_TenantLooksLikeToken123';
		const accessToken = 'SECRET-ACCESS-TOKEN-7f3a9';
		const fileSecret = 'FILE-CONTENT-SECRET-55e1';
		const tokens = new TokenStore();
		tokens.setToken(envName, accessToken);
		const mgr = stubManager([{ name: envName, tenants: [{ tenantId, hasL3: true }] }]);
		await mem.writeFile(mgr.getL3Uri(envName, tenantId), new TextEncoder().encode(JSON.stringify({ description: fileSecret })));
		const provider = new MultiTenantTreeProvider(mgr, tokens, memento(), null);
		const states = ['T_NO_L3', 'T_L3_NEVER_OPENED', 'T_READY'];
		const fixedTooltipHints = new Set([
			'',
			'\nL3 configuration not yet fetched. Click the download icon or row to fetch.',
			'\nL3 is downloaded. Open it to start editing.',
		]);
		const fixedDescHints = new Set([undefined, '(local)', 'L3 not fetched — click to fetch', 'Open L3 to start editing']);

		const strings = node => {
			const out = [node.label, node.description, node.id, node.contextValue,
				typeof node.tooltip === 'string' ? node.tooltip : node.tooltip?.value];
			if (node.command) {
				out.push(node.command.command, node.command.title);
				for (const a of node.command.arguments ?? []) if (a !== node) out.push(JSON.stringify(a));
			}
			return out.filter(s => s !== undefined).map(String);
		};

		const [envNode] = await provider.getChildren();
		const rows = [];
		for (const tState of states) {
			provider.setUxState({ global: 'G_READY', perEnv: new Map([[envName, 'E_READY']]), perTenant: new Map([[`${envName}/${tenantId}`, tState]]), envCount: 1, tenantCount: 1 });
			rows.push(...(await provider.getChildren(envNode)));
		}
		rows.push(new TenantNode(envName, tenantId, true, false, true, 'T_READY', false, undefined, 'feature/x', true));
		rows.push(new TenantNode(envName, tenantId, true, true, false, 'T_NO_L3'));

		for (const node of [envNode, ...rows]) {
			for (const s of strings(node)) {
				assert.ok(!s.includes(accessToken), `TREE-010 #1: no access token in node field "${s}"`);
				assert.ok(!s.includes(fileSecret), `TREE-010 #1: no file contents in node field "${s}"`);
			}
		}
		assert.strictEqual(envNode.id, `env:${envName}`, 'TREE-010 #1: env id is only the env name');
		assert.ok(String(envNode.tooltip).startsWith(envName), 'TREE-010 #1: env tooltip starts with the env name');
		const [readyEnv] = await provider.getChildren();
		assert.strictEqual(readyEnv.tooltip, envName, 'TREE-010 #1: a ready env tooltip is only the env name');
		for (const row of rows) {
			assert.strictEqual(row.id, `tenant:${envName}/${tenantId}`, 'TREE-010 #1: tenant id is only env name and tenant id');
			assert.ok(String(row.tooltip).startsWith(tenantId), 'TREE-010 #1: tooltip starts with the tenant id');
			assert.ok(fixedTooltipHints.has(String(row.tooltip).slice(tenantId.length)),
				`TREE-010 #1: tooltip is tenant id plus fixed hint text, got ${JSON.stringify(row.tooltip)}`);
			const desc = row.branch
				? String(row.description).replace(`⎇ ${row.branch}`, '').trim() || undefined
				: row.description;
			assert.ok(fixedDescHints.has(desc), `TREE-010 #1: description is fixed hint text (plus branch), got ${JSON.stringify(row.description)}`);
			if (row.command) {
				assert.strictEqual(row.command.arguments.length, 1, 'TREE-010 #1: command arguments carry only the node');
				assert.strictEqual(row.command.arguments[0], row, 'TREE-010 #1: command argument is the node itself');
			}
		}
	}

	// ── TREE-011: large-scale tree performance ──
	{
		// #1 5,000 entity types of 20 attributes.
		const entityTypes = [];
		for (let i = 0; i < 5000; i++) {
			const attributes = [];
			for (let j = 0; j < 20; j++) attributes.push({ name: `a${j}`, type: 'String', uri: `configuration/entityTypes/T${i}/attributes/a${j}` });
			entityTypes.push({ uri: `configuration/entityTypes/T${i}`, label: `T${i}`, attributes });
		}
		const model = { entityTypes };
		const uri = U('/ws/big/t/Business Config/BusinessConfig.json');
		const t0 = Date.now();
		const root = getConfigRootChildren(model, uri);
		const types = getConfigNodeChildren(model, root[0]);
		const typeChildren = getConfigNodeChildren(model, types[4321]);
		const attrItems = getConfigNodeChildren(model, typeChildren.find(c => c.nodeType === 'attributesFolder'));
		const elapsed = Date.now() - t0;
		assert.ok(elapsed < 1000, `TREE-011 #1: big model expands in under 1 s (took ${elapsed} ms)`);
		assert.strictEqual(types.length, entityTypes.length, 'TREE-011 #1: item count equals array length');
		assert.strictEqual(attrItems.length, 20, 'TREE-011 #1: attribute count equals array length');
		assert.strictEqual(new Set(types.map(t => t.id)).size, types.length, 'TREE-011 #1: entity type ids unique');
		assert.strictEqual(new Set(attrItems.map(t => t.id)).size, attrItems.length, 'TREE-011 #1: attribute ids unique');

		// #2 200 tenants, each lookup delayed 5 ms.
		const tenants = [];
		for (let i = 0; i < 200; i++) tenants.push({ tenantId: `t${i}`, hasL3: i % 2 === 0 });
		const mgr = stubManager([{ name: 'many', tenants }]);
		const tokens = new TokenStore();
		tokens.setToken('many', 'tok');
		const provider = new MultiTenantTreeProvider(mgr, tokens, memento(), null);
		const [envNode] = await provider.getChildren();
		let lookups = 0;
		const slowFail = async () => { lookups++; await sleep(5); throw new Error('ENOENT'); };
		const originalFs = vscode.workspace.fs;
		vscode.workspace.fs = { ...originalFs, readFile: slowFail, stat: slowFail };
		let rows;
		const t1 = Date.now();
		try {
			rows = await provider.getChildren(envNode);
		} finally {
			vscode.workspace.fs = originalFs;
		}
		const took = Date.now() - t1;
		const serialSum = lookups * 5;
		assert.strictEqual(rows.length, 200, `TREE-011 #2: 200 TenantNodes (got ${rows.length})`);
		assert.strictEqual(new Set(rows.map(r => r.id)).size, 200, 'TREE-011 #2: TenantNode ids unique');
		assert.ok(lookups >= 200, `TREE-011 #2: lookups ran per tenant (${lookups})`);
		assert.ok(took < serialSum / 4, `TREE-011 #2: ${took} ms is far below the serial sum ${serialSum} ms`);

		// #3 1,000 changes in a tight loop: one event, timer reset per call.
		const debounced = new MultiTenantTreeProvider(null, new TokenStore(), memento(), null);
		let events = 0;
		debounced.onDidChangeTreeData(() => { events++; });
		const realSet = global.setTimeout;
		const realClear = global.clearTimeout;
		let sets = 0;
		let clears = 0;
		global.setTimeout = (...a) => { sets++; return realSet(...a); };
		global.clearTimeout = (...a) => { clears++; return realClear(...a); };
		try {
			for (let i = 0; i < 1000; i++) debounced.onL3DocumentChanged({ uri: U('/ws/e/t/l3.reltio.json') });
		} finally {
			global.setTimeout = realSet;
			global.clearTimeout = realClear;
		}
		assert.strictEqual(sets, 1000, 'TREE-011 #3: one timer per call');
		assert.strictEqual(clears, 999, 'TREE-011 #3: each new call clears the previous timer (not stacked)');
		await sleep(400);
		assert.strictEqual(events, 1, `TREE-011 #3: one change event total (got ${events})`);
	}

	// ── TREE-012: bad stored data, status bar timer, Windows paths ──
	{
		// #1
		const empty = new FakeMemento({ 'reltio.recentTenants': undefined, 'reltio.recentHosts': undefined });
		await recents.pushRecentTenant(empty, 'h.com', 't1');
		await recents.pushRecentHost(empty, 'h.com');
		assert.deepStrictEqual(recents.loadRecentTenants(empty, 'h.com'), ['t1'], 'TREE-012 #1: tenant push succeeds on an empty store');
		assert.deepStrictEqual(recents.loadRecentHosts(empty), ['h.com'], 'TREE-012 #1: host push succeeds on an empty store');

		const seeded = { bad: 'not-an-array', other: ['o1'] };
		const snapshot = JSON.parse(JSON.stringify(seeded));
		const m = new FakeMemento({ 'reltio.recentTenants': seeded });
		await recents.pushRecentTenant(m, 'h.com', 't1');
		const stored = m.store.get('reltio.recentTenants');
		assert.notStrictEqual(stored, seeded, 'TREE-012 #1: a copy is written, not the original map');
		assert.deepStrictEqual(seeded, snapshot, 'TREE-012 #1: the stored map is not mutated');
		assert.deepStrictEqual(stored['h.com'], ['t1'], 'TREE-012 #1: only the tenant string is stored for the host');
		for (const [k, v] of Object.entries(stored)) {
			assert.strictEqual(typeof k, 'string', 'TREE-012 #1: host keys are strings');
			if (k === 'h.com') assert.ok(v.every(x => typeof x === 'string'), 'TREE-012 #1: tenant values are strings');
		}
		assert.ok(recents.loadRecentHosts(empty).every(h => typeof h === 'string'), 'TREE-012 #1: hosts are strings');

		// #2 flashSuccess with fake timers; dispose.
		const originalCreate = vscode.window.createStatusBarItem;
		const original = new vscode.ThemeColor('statusBarItem.original');
		const item = { backgroundColor: original, disposed: false, show() {}, hide() {}, dispose() { this.disposed = true; } };
		vscode.window.createStatusBarItem = () => item;
		const realSet = global.setTimeout;
		const timers = [];
		try {
			const bar = new StatusBarController();
			global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
			try {
				bar.flashSuccess();
			} finally {
				global.setTimeout = realSet;
			}
			assert.ok(item.backgroundColor instanceof vscode.ThemeColor, 'TREE-012 #2: background is a ThemeColor');
			assert.strictEqual(item.backgroundColor.id, 'statusBarItem.warningBackground', 'TREE-012 #2: warning background while flashing');
			assert.strictEqual(timers.length, 1, 'TREE-012 #2: one restore timer');
			assert.strictEqual(timers[0].ms, 1500, 'TREE-012 #2: restore after 1500 ms');
			timers[0].fn();
			assert.strictEqual(item.backgroundColor, original, 'TREE-012 #2: background restored after 1500 ms');
			bar.dispose();
			assert.strictEqual(item.disposed, true, 'TREE-012 #2: dispose disposes the item');
		} finally {
			vscode.window.createStatusBarItem = originalCreate;
		}

		// #3 Windows paths.
		const winA = vscode.Uri.file('C:\\ws\\a b\\BusinessConfig.json');
		const winB = vscode.Uri.file('C:\\ws\\a b\\other\\BusinessConfig.json');
		const model = { entityTypes: [ENTITY_TYPE] };
		const idsA1 = getConfigRootChildren(model, winA).map(i => i.id);
		const idsA2 = getConfigRootChildren(model, vscode.Uri.file('C:\\ws\\a b\\BusinessConfig.json')).map(i => i.id);
		const idsB = getConfigRootChildren(model, winB).map(i => i.id);
		assert.deepStrictEqual(idsA1, idsA2, 'TREE-012 #3: ids are deterministic for a Windows path with spaces');
		assert.notDeepStrictEqual(idsA1, idsB, 'TREE-012 #3: ids are unique per Windows path');
		assert.ok(idsA1[0].includes('a b') && idsA1[0].endsWith('|entityTypes'), `TREE-012 #3: id keeps the path, got ${idsA1[0]}`);

		const provider = new MultiTenantTreeProvider(null, new TokenStore(), memento(), null);
		let events = 0;
		provider.onDidChangeTreeData(() => { events++; });
		provider.onL3DocumentChanged({ uri: { path: '/c:/ws/a b/Business Config/BUSINESSCONFIG.json' } });
		await sleep(250);
		assert.strictEqual(events, 1, 'TREE-012 #3: a Windows-style document path matches on the lowercased suffix');
		provider.onL3DocumentChanged({ uri: winA });
		await sleep(250);
		assert.strictEqual(events, 2, 'TREE-012 #3: a backslash path matches on the lowercased suffix');
		provider.onL3DocumentChanged({ uri: { path: '/c:/ws/a b/BusinessConfig.json.bak' } });
		await sleep(250);
		assert.strictEqual(events, 2, 'TREE-012 #3: a lookalike suffix does not match');
	}

	// ── TREE-013: menu visibility for every node type ──
	{
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		const menus = pkg.contributes.menus;
		const declared = new Set(pkg.contributes.commands.map(c => c.command));
		const KNOWN_KEYS = ['view', 'viewItem', 'reltio.workspaceSource', 'resourceFilename', 'resourceExtname'];
		const VIEW = 'reltioConfigTree';
		const shows = (entry, ctx) => entry.when === undefined || evalWhenClause(entry.when, ctx, KNOWN_KEYS);

		// #1 Every command a menu references is declared, and every when clause parses with known keys.
		for (const [location, entries] of Object.entries(menus)) {
			for (const e of entries) {
				assert.ok(declared.has(e.command), `TREE-013 #1: ${location} ${e.command} is declared in contributes.commands`);
				if (e.when !== undefined) {
					assert.doesNotThrow(() => evalWhenClause(e.when, {}, KNOWN_KEYS),
						`TREE-013 #1: ${location} ${e.command} when clause parses: ${e.when}`);
				}
			}
		}

		// #2 Every contextValue the tree can produce, built from the real node classes. Each record
		// carries the constructor facts the intended visibility depends on.
		const W = workflowNodes;
		const records = [];
		const add = (kind, node, facts = {}) => {
			assert.ok(typeof node.contextValue === 'string' && node.contextValue.startsWith('reltio.'),
				`TREE-013 #2: ${kind} contextValue is a reltio.* string, got ${node.contextValue}`);
			if (records.some(r => r.value === node.contextValue)) return;
			records.push({ kind, value: node.contextValue, node, ...facts });
		};
		const eStates = unionMembers('src/ux/uxState.ts', 'EState');
		assert.ok(eStates.length >= 4, 'TREE-013 #2: EState members read from src');
		for (const authorized of [true, false]) for (const browser of [true, false]) {
			for (const s of eStates.filter(x => /AUTHED|READY/.test(x) === authorized)) {
				add('env', new EnvironmentNode('e', authorized, browser, s),
					{ authorized, browser, noTenants: s === 'E_AUTHED_NO_TENANTS' });
			}
		}
		for (const hasL3 of [true, false]) for (const gitBound of [true, false]) {
			add('tenant', new TenantNode('e', 't', hasL3, false, true, hasL3 ? 'T_READY' : 'T_NO_L3', false, undefined, undefined, gitBound),
				{ hasL3, gitBound });
		}
		add('gitFolder', new GitFolderNode('e', ['repo', 'DP'], false));
		add('businessConfig', new BusinessConfigFolderNode('e', 't'));
		for (const n of [0, 2]) add('historyFolder', new HistoryFolderNode('e', 't', n), { empty: n === 0 });
		for (const hasOlder of [true, false]) {
			add('snapshot', new HistorySnapshotNode('e', 't', U('/h/s.json'), 's', hasOlder), { hasOlder });
		}
		const configTypes = unionMembers('src/tree/treeNodes.ts', 'ConfigNodeType');
		assert.ok(configTypes.includes('entityType') && configTypes.includes('lifecycleActions'),
			'TREE-013 #2: ConfigNodeType members read from src');
		for (const root of ['entityTypes', 'relationTypes']) {
			for (const t of configTypes) {
				add('config', new ConfigTreeItem(t, t, [root, 0, 'x'], 0), { nodeType: t, underRelation: root === 'relationTypes' });
			}
		}
		// The canonical fixture's real tree yields nothing outside that set.
		{
			const { model } = require('./lib/load-canonical-fixture.cjs').loadCanonicalFixture();
			const walked = new Set();
			const walk = items => {
				for (const it of items) {
					walked.add(it.contextValue);
					walk(getConfigNodeChildren(model, it));
				}
			};
			walk(getConfigRootChildren(model, U('/ws/first-test.json')));
			assert.ok(walked.size > 5, 'TREE-013 #2: canonical fixture tree walked');
			for (const v of walked) {
				assert.ok(records.some(r => r.value === v), `TREE-013 #2: fixture contextValue ${v} is in the derived set`);
			}
		}
		for (const hasUrl of [true, false]) for (const hasRepo of [true, false]) {
			add('wfFolder', new W.WorkflowsFolderNode('e', 't', hasUrl ? 'https://a' : undefined, hasRepo ? { repoUrl: 'https://git/r.git', relativePath: 'Workflows' } : undefined),
				{ hasUrl, hasRepo });
		}
		add('wfFetchAction', new W.WorkflowFetchActionNode('e', 't'));
		add('wfConnectRepoAction', new W.WorkflowConnectRepoActionNode('e', 't'));
		add('wfProcessDefsFolder', new W.ProcessDefinitionsFolderNode('e', 't', []));
		add('wfJarsFolder', new W.JarDeploymentsFolderNode('e', 't', []));
		add('wfUnregisteredJarsFolder', new W.UnregisteredJarsFolderNode('e', 't', []));
		const definition = { type: 'p', displayName: 'P', generic: false };
		for (const localState of ['none', 'clean', 'changed']) {
			add('wfProcessDef', new W.ProcessDefinitionNode('e', 't', definition, localState), { changed: localState === 'changed' });
		}
		add('wfJar', new W.JarDeploymentNode('e', 't', { name: 'j', module: 'm' }));
		add('wfUnregisteredJar', new W.UnregisteredJarNode('e', 't', { module: 'm.jar' }));
		for (const kind of unionMembers('src/tree/workflowNodes.ts', 'WorkflowRepoGroupKind')) {
			add('wfRepoGroup', new W.WorkflowRepoGroupNode('e', 't', kind, 1), { groupKind: kind });
			add('wfRepoModule', new W.WorkflowRepoModuleNode('e', 't', kind, 'mod', 1), { groupKind: kind });
		}
		add('wfRepoJavaFile', new W.WorkflowRepoJavaFileNode('e', 't', {
			simpleName: 'A', packageName: 'x', fileUri: U('/r/A.java'), fullyQualifiedName: 'x.A', moduleName: 'm', relativePath: 'A.java',
		}));
		const draft = { processId: 'p', processName: 'P', fileName: 'p.bpmn20.xml', fileUri: U('/w/p.bpmn20.xml') };
		for (const source of ['local', 'repo']) add('wfDraft', new W.WorkflowDraftNode('e', 't', draft, source), { local: source === 'local' });
		// RDM rows live in their own reltio.rdm.* namespace (multiTenantNodes.ts). Section keys are read
		// from the real tree code, so a new section is picked up here.
		const rdmFile = U('/ws/dev/t1/RDM_Config.json');
		add('rdmGroup', new RdmGroupNode('e', 't'));
		for (const unreadable of [false, true]) add('rdmRoot', new RdmRootNode('e', 't', 'rdm1', rdmFile, unreadable));
		const rdmKeys = rdmSectionKeys();
		assert.ok(rdmKeys.includes('lookupTypes') && rdmKeys.includes('sources'), 'TREE-013 #2: RDM section keys read from src');
		for (const key of rdmKeys) {
			add('rdmFolder', new RdmFolderNode('e', 't', 'rdm1', rdmFile, key, key, 1, 'folder'), { sectionKey: key });
			add('rdmItem', new RdmItemNode('e', 't', 'rdm1', rdmFile, key, [key, 0], 'x', `rdm/${key}/x`, 'symbol-enum', 'x'), { sectionKey: key });
		}

		// Evaluate each view/item/context entry against each producible value. Inline entries are
		// keyed `<command>@inline`; right-click entries by the command alone.
		const itemMenu = menus['view/item/context'];
		const keyOf = e => (String(e.group ?? '').startsWith('inline') ? `${e.command}@inline` : e.command);
		const ctxFor = (r, ws) => ({ view: VIEW, viewItem: r.value, 'reltio.workspaceSource': ws });
		const matched = (ws, filter = () => true) => {
			const out = new Map();
			for (const e of itemMenu) {
				const k = keyOf(e);
				if (!out.has(k)) out.set(k, new Set());
				for (const r of records.filter(filter)) if (shows(e, ctxFor(r, ws))) out.get(k).add(r.value);
			}
			return out;
		};
		const tenantWs = matched('tenant');
		const gitWs = matched('git');
		const sorted = s => [...s].sort();
		const valuesWhere = pred => sorted(new Set(records.filter(pred).map(r => r.value)));

		// #3 No orphan entry; node types with actions have them; documented action-less rows have none.
		for (const e of itemMenu) {
			const hit = records.some(r => shows(e, ctxFor(r, 'tenant')) || shows(e, ctxFor(r, 'git')));
			assert.ok(hit, `TREE-013 #3: ${e.command} (${e.group}) matches at least one producible contextValue: ${e.when}`);
		}
		// Rows that carry no context actions by design: structural git folders (GitFolderNode doc),
		// the Business Config grouping row, click-to-act workflow rows, and the read-only repository
		// rows (WorkflowRepo* docs, D6).
		const ACTIONLESS = ['gitFolder', 'businessConfig', 'wfFetchAction', 'wfConnectRepoAction', 'wfRepoGroup', 'wfRepoModule', 'wfRepoJavaFile'];
		for (const r of records) {
			// The RDM grouping row matches the RDM "Show in Editor" regex but its handler does nothing
			// for it; that is reported to the developer, so its action list is not pinned here.
			if (r.kind === 'rdmGroup') continue;
			const entries = itemMenu.filter(e => shows(e, ctxFor(r, 'tenant')));
			if (ACTIONLESS.includes(r.kind)) {
				assert.deepStrictEqual(entries.map(keyOf), [], `TREE-013 #3: ${r.value} carries no context actions`);
			} else {
				assert.ok(entries.length > 0, `TREE-013 #3: ${r.value} (${r.kind}) has at least one context action`);
			}
		}

		// #3b RDM rows: each RDM command shows on exactly the RDM rows it is meant for, and the L3
		// Delete / Rename (which attach to reltio.item.*) never reach an RDM row.
		{
			const rdmCmds = r => itemMenu.filter(e => shows(e, ctxFor(r, 'tenant'))).map(e => e.command);
			for (const r of records.filter(x => x.kind.startsWith('rdm') && x.kind !== 'rdmGroup')) {
				const cmds = rdmCmds(r);
				for (const c of ['reltio.deleteNode', 'reltio.renameNode']) {
					assert.ok(!cmds.includes(c), `TREE-013 #3b: ${c} must not show on RDM row ${r.value}`);
				}
				assert.ok(cmds.includes('reltio.revealInEditor'), `TREE-013 #3b: ${r.value} offers Show in Editor`);
			}
			for (const r of records.filter(x => x.kind === 'rdmRoot')) {
				for (const c of ['reltio.addRdmLookupType', 'reltio.addRdmSource', 'reltio.applyRdmConfiguration']) {
					assert.ok(rdmCmds(r).includes(c), `TREE-013 #3b: ${c} shows on the RDM root`);
				}
			}
			const lookupItem = records.find(x => x.kind === 'rdmItem' && x.sectionKey === 'lookupTypes');
			const sourceItem = records.find(x => x.kind === 'rdmItem' && x.sectionKey === 'sources');
			assert.ok(rdmCmds(lookupItem).includes('reltio.getRdmLookupValues'), 'TREE-013 #3b: Get Lookup Values shows on a lookup type');
			assert.ok(!rdmCmds(sourceItem).includes('reltio.getRdmLookupValues'), 'TREE-013 #3b: Get Lookup Values does not show on a source');
			const lookupFolder = records.find(x => x.kind === 'rdmFolder' && x.sectionKey === 'lookupTypes');
			const sourceFolder = records.find(x => x.kind === 'rdmFolder' && x.sectionKey === 'sources');
			assert.deepStrictEqual(
				[rdmCmds(lookupFolder).includes('reltio.addRdmLookupType'), rdmCmds(lookupFolder).includes('reltio.addRdmSource')],
				[true, false], 'TREE-013 #3b: the Lookup Types folder offers only Add Lookup Type');
			assert.deepStrictEqual(
				[rdmCmds(sourceFolder).includes('reltio.addRdmSource'), rdmCmds(sourceFolder).includes('reltio.addRdmLookupType')],
				[true, false], 'TREE-013 #3b: the Sources folder offers only Add Source');
		}

		// #4 Signed-out / signed-in gating on environment rows (tenant workspace).
		const envOf = k => sorted(tenantWs.get(k) ?? []).map(v => records.find(r => r.value === v)).filter(r => r.kind === 'env');
		for (const k of ['reltio.loginWithBrowser', 'reltio.loginWithBrowser@inline', 'reltio.signInEnvironment@inline']) {
			const envs = envOf(k);
			assert.ok(envs.length > 0, `TREE-013 #4: ${k} shows on some environment`);
			for (const r of envs) assert.ok(!r.authorized, `TREE-013 #4: sign-in ${k} must not show on signed-in ${r.value}`);
		}
		for (const k of ['reltio.reLoginWithBrowser', 'reltio.addTenant', 'reltio.addTenant@inline']) {
			const envs = envOf(k);
			assert.ok(envs.length > 0, `TREE-013 #4: ${k} shows on some environment`);
			for (const r of envs) assert.ok(r.authorized, `TREE-013 #4: signed-in action ${k} must not show on signed-out ${r.value}`);
		}
		for (const r of records.filter(x => x.kind === 'env' && !x.authorized)) {
			const inline = itemMenu.filter(e => String(e.group ?? '').startsWith('inline') && shows(e, ctxFor(r, 'tenant')));
			assert.ok(inline.some(e => /signIn|login/i.test(e.command)), `TREE-013 #4: signed-out ${r.value} has an inline sign-in action`);
		}

		// #5 Git workspace: on environment, tenant and history rows only Remove Repository / Remove
		// Tenant, Open L3 and the L3 create actions remain. configureOAuthClient is excluded: BUG-008.
		const isEnvTenantHistory = r => ['env', 'tenant', 'historyFolder', 'snapshot'].includes(r.kind);
		const gitScoped = matched('git', isEnvTenantHistory);
		const L3_INSERTS = {
			'reltio.addEntityType': 'entityTypesFolder', 'reltio.addRelationType': 'relationTypesFolder',
			'reltio.insertInteractionType': 'interactionTypesFolder', 'reltio.insertHierarchyType': 'hierarchyTypesFolder',
			'reltio.insertGraphType': 'graphTypesFolder', 'reltio.insertGroupingType': 'groupingTypesFolder',
			'reltio.insertSource': 'sourcesFolder',
		};
		for (const [k, got] of gitScoped) {
			let expected = [];
			if (k === 'reltio.removeGitSource') expected = valuesWhere(r => r.kind === 'env');
			else if (k === 'reltio.removeGitTenant') expected = valuesWhere(r => r.kind === 'tenant');
			else if (k === 'reltio.openL3@inline' || L3_INSERTS[k]) expected = valuesWhere(r => r.kind === 'tenant' && r.hasL3);
			if (k === 'reltio.configureOAuthClient') continue; // BUG-008
			assert.deepStrictEqual(sorted(got), expected, `TREE-013 #5: ${k} in a git workspace`);
		}
		for (const k of ['reltio.removeGitSource', 'reltio.removeGitTenant']) {
			assert.deepStrictEqual(sorted(tenantWs.get(k)), [], `TREE-013 #5: ${k} is git-workspace only`);
		}

		// #6 view/title: Setup Wizard unless the workspace is git-sourced, Remove Repository only then.
		for (const ws of ['tenant', 'git', undefined]) {
			for (const view of [VIEW, 'explorer']) {
				const got = menus['view/title'].filter(e => shows(e, { view, 'reltio.workspaceSource': ws })).map(e => e.command);
				const expected = view !== VIEW ? [] : ws === 'git' ? ['reltio.removeGitSource'] : ['reltio.launchSetupWizard'];
				assert.deepStrictEqual(got, expected, `TREE-013 #6: view/title in view ${view}, workspaceSource ${ws}`);
			}
		}

		// #7 commandPalette: tree-only commands are hidden everywhere, and each stays reachable from
		// a tree row (a context entry or the row's click command).
		const clickCommands = new Set(records.map(r => r.node.command?.command).filter(Boolean));
		for (const e of menus.commandPalette) {
			for (const ws of ['tenant', 'git', undefined]) {
				assert.strictEqual(shows(e, { 'reltio.workspaceSource': ws }), false,
					`TREE-013 #7: ${e.command} is hidden from the command palette (workspaceSource ${ws})`);
			}
			assert.ok(itemMenu.some(x => x.command === e.command) || clickCommands.has(e.command),
				`TREE-013 #7: palette-hidden ${e.command} is reachable from a tree row`);
		}

		// #8 Full intended-visibility matrix in a tenant workspace, per entry key.
		const cfg = (...types) => r => r.kind === 'config' && types.includes(r.nodeType);
		const attrTargets = ['entityType', 'relationType', 'nestedAttribute', 'attributesFolder'];
		const spec = {
			'reltio.revealInEditor': r => r.kind === 'config' || r.kind.startsWith('rdm'),
			'reltio.getRdmLookupValues': r => r.kind === 'rdmItem' && r.sectionKey === 'lookupTypes',
			'reltio.addRdmLookupType': r => r.kind === 'rdmRoot' || (r.kind === 'rdmFolder' && r.sectionKey === 'lookupTypes'),
			'reltio.addRdmSource': r => r.kind === 'rdmRoot' || (r.kind === 'rdmFolder' && r.sectionKey === 'sources'),
			'reltio.applyRdmConfiguration': r => r.kind === 'rdmRoot',
			'reltio.showOntologyFromTree': cfg('entityTypesFolder', 'relationTypesFolder'),
			'reltio.insertSimpleAttribute': cfg(...attrTargets),
			'reltio.insertNestedAttribute': cfg(...attrTargets),
			// Reference attributes are not supported on relation types (treeNodes.ts contextValueFor).
			'reltio.insertReferenceAttribute': r => cfg('entityType', 'nestedAttribute', 'attributesFolder')(r) && !r.value.endsWith('.relationType'),
			'reltio.insertMatchGroup': cfg('entityType'),
			'reltio.insertSurvivorshipGroup': cfg('entityType', 'relationType'),
			'reltio.insertCleanseConfig': cfg('entityType'),
			// lifecycleActions is read-only in the tree; Browse Entities is not a JSON node.
			'reltio.deleteNode': r => r.kind === 'config' && !r.nodeType.endsWith('Folder') && !['lifecycleActions', 'entityBrowser'].includes(r.nodeType),
			'reltio.renameNode': r => r.kind === 'config' && !r.nodeType.endsWith('Folder') && !['lifecycleActions', 'entityBrowser'].includes(r.nodeType),
			'reltio.configureOAuthClient': r => r.kind === 'env' && !r.browser,
			'reltio.resetOAuthClient': r => r.kind === 'env' && r.browser,
			'reltio.loginWithBrowser': r => r.kind === 'env' && !r.authorized && r.browser,
			'reltio.loginWithBrowser@inline': r => r.kind === 'env' && !r.authorized && r.browser,
			'reltio.reLoginWithBrowser': r => r.kind === 'env' && r.authorized && r.browser,
			'reltio.provideToken': r => r.kind === 'env',
			'reltio.refreshEnvironment': r => r.kind === 'env',
			'reltio.removeEnvironment': r => r.kind === 'env',
			'reltio.addTenant': r => r.kind === 'env' && r.authorized,
			'reltio.addTenant@inline': r => r.kind === 'env' && r.authorized && r.noTenants,
			'reltio.signInEnvironment@inline': r => r.kind === 'env' && !r.authorized && !r.browser,
			'reltio.connectTenantToGit': r => r.kind === 'tenant' && !r.gitBound,
			'reltio.tenantNewBranch': r => r.kind === 'tenant' && r.gitBound,
			'reltio.disconnectTenantFromGit': r => r.kind === 'tenant' && r.gitBound,
			'reltio.removeTenant': r => r.kind === 'tenant',
			'reltio.copyTenantId': r => r.kind === 'tenant',
			'reltio.fetchL3': r => r.kind === 'tenant' && r.hasL3,
			'reltio.fetchL3@inline': r => r.kind === 'tenant' && !r.hasL3,
			'reltio.fetchConfigurationHistory': r => r.kind === 'tenant' && r.hasL3,
			'reltio.applyL3Configuration': r => r.kind === 'tenant' && r.hasL3,
			'reltio.openL3@inline': r => r.kind === 'tenant' && r.hasL3,
			'reltio.fetchMoreConfigurationHistory': r => r.kind === 'historyFolder',
			'reltio.historyCompareWithCurrent': r => r.kind === 'snapshot',
			'reltio.historyCompareWithPrevious': r => r.kind === 'snapshot' && r.hasOlder,
			'reltio.historySelectForCompare': r => r.kind === 'snapshot',
			'reltio.historyCompareSelected': r => r.kind === 'snapshot',
			'reltio.removeGitSource': () => false,
			'reltio.removeGitTenant': () => false,
			'reltio.fetchWorkflows@inline': r => r.kind === 'wfFolder',
			'reltio.refreshWorkflows': r => r.kind === 'wfFolder' && r.hasUrl,
			'reltio.refreshWorkflows@inline': r => r.kind === 'wfFolder' && r.hasUrl,
			'reltio.editWorkflowAdapterUrl': r => r.kind === 'wfFolder',
			'reltio.connectWorkflowRepository': r => r.kind === 'wfFolder' && !r.hasRepo,
			'reltio.connectWorkflowRepository@inline': r => r.kind === 'wfFolder' && !r.hasRepo,
			'reltio.refreshWorkflowRepoSync': r => r.kind === 'wfFolder' && r.hasRepo,
			'reltio.openWorkflowRepoFolder': r => r.kind === 'wfFolder' && r.hasRepo,
			'reltio.openWorkflowRepoInBrowser': r => r.kind === 'wfFolder' && r.hasRepo,
			'reltio.disconnectWorkflowRepository': r => r.kind === 'wfFolder' && r.hasRepo,
			'reltio.refreshProcessDefinitions': r => r.kind === 'wfProcessDefsFolder',
			'reltio.refreshProcessDefinitions@inline': r => r.kind === 'wfProcessDefsFolder',
			'reltio.newWorkflowDraft': r => r.kind === 'wfProcessDefsFolder',
			'reltio.newWorkflowDraft@inline': r => r.kind === 'wfProcessDefsFolder',
			'reltio.duplicateWorkflowDraft': r => r.kind === 'wfProcessDef',
			'reltio.duplicateWorkflowDraft@inline': r => r.kind === 'wfProcessDef',
			'reltio.deployWorkflow': r => (r.kind === 'wfProcessDef' && r.changed) || r.kind === 'wfDraft',
			'reltio.deployWorkflow@inline': r => (r.kind === 'wfProcessDef' && r.changed) || r.kind === 'wfDraft',
			'reltio.compareWorkflowBpmn': r => r.kind === 'wfProcessDef' && r.changed,
			'reltio.discardWorkflowBpmnChanges': r => r.kind === 'wfProcessDef' && r.changed,
			'reltio.refreshJarDeployments': r => r.kind === 'wfJarsFolder' || r.kind === 'wfUnregisteredJarsFolder',
			'reltio.refreshJarDeployments@inline': r => r.kind === 'wfJarsFolder' || r.kind === 'wfUnregisteredJarsFolder',
			'reltio.copyJarModulePath': r => r.kind === 'wfJar',
			'reltio.copyJarModulePath@inline': r => r.kind === 'wfJar',
			'reltio.registerJarDeployment': r => r.kind === 'wfUnregisteredJar',
			'reltio.registerJarDeployment@inline': r => r.kind === 'wfUnregisteredJar',
			'reltio.deleteWorkflowDraft': r => r.kind === 'wfDraft' && r.local,
			'reltio.previewWorkflowDiagram': r => r.kind === 'wfProcessDef' || r.kind === 'wfDraft',
		};
		for (const k of Object.keys(L3_INSERTS)) {
			spec[k] = r => cfg(L3_INSERTS[k])(r) || (r.kind === 'tenant' && r.hasL3);
		}
		for (const k of tenantWs.keys()) {
			assert.ok(spec[k], `TREE-013 #8: view/item/context entry ${k} has a stated intended target (add it to the spec)`);
		}
		for (const k of Object.keys(spec)) {
			assert.ok(tenantWs.has(k), `TREE-013 #8: intended menu entry ${k} exists in package.json`);
		}
		// Known product bugs, left out of the comparison only for the affected value.
		const SKIP = {
			'reltio.deleteNode': ['reltio.item.entityBrowser'], // BUG-012
			'reltio.renameNode': ['reltio.item.entityBrowser'], // BUG-012
			'reltio.resetOAuthClient': ['reltio.environment.authorized.oauthReady.noTenants'], // BUG-013
			// The RDM grouping row offers Show in Editor, whose handler does nothing for it (reported to the developer).
			'reltio.revealInEditor': ['reltio.rdm.group'],
		};
		for (const [k, got] of tenantWs) {
			const skip = SKIP[k] ?? [];
			assert.deepStrictEqual(sorted(got).filter(v => !skip.includes(v)), valuesWhere(spec[k]).filter(v => !skip.includes(v)),
				`TREE-013 #8: ${k} shows exactly on its intended rows`);
		}
	}

	console.log('test-tenant-explorer-ux: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
