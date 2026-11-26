#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-configuration-fetch
 * Tier A: extractRdmConfig over the sanitized physical-config fixture and over
 *         constructed degenerate inputs; the RDM JSON Schema accepts a real
 *         configuration and tolerates properties it does not recognize; the
 *         RDM file-naming helpers separate configurations from their baselines.
 * Tier B: package.json binds RDM files to the RDM schema, excludes them from the
 *         L3 schema, and contributes no RDM-specific command or menu entry.
 * Tier C (manual): fetch against a live tenant, drift warning, login untouched,
 *         Apply unaffected — see design.md Test plan.
 *
 * Source-text checks: the RDM flows live in closures inside activate() in extension.ts, so they
 * cannot be called directly. The text checks that remain guard rules where a regression loses
 * data or leaks state (a 403 stays quiet, connect flows keep local edits, a Git-workspace
 * placeholder is never used as a session, a sign-out forgets cached RDM addresses). Structure
 * checks (queue shape, helper names, call counts) were removed because a harmless refactor
 * broke them. Real behavior coverage of those flows needs an activate() harness like the one in
 * test-extension-activation.cjs; add it there rather than extending the text checks.
 *
 * RDM configurations vary per tenant. Assertions here are derived from whatever
 * the fixture contains rather than from hard-coded identifiers or counts, so a
 * fixture refreshed from a different tenant does not break the suite.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { importDist } = require('./lib/import-dist.cjs');

const repoRoot = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

const { extractRdmConfig } = importDist('api/reltioClient');
const {
	rdmFileName,
	legacyRdmFileName,
	legacyRdmBaselineFileName,
	isRdmConfigurationFileName,
	rdmTenantIdFromFileName,
} = importDist('workspace/environmentManager');
const { hasUnpublishedLocalChangesFromText } = importDist('util/fetchConfigurationGuard');

// ---------------------------------------------------------------------------
// Tier A — extractRdmConfig against the sanitized fixture
// ---------------------------------------------------------------------------

const physical = readJson('samples/tenant-physical-config.sample.json');
const expectedServiceUri = physical.rdmConfig.serviceUri;
const expectedIds = physical.rdmConfig.rdmTenants.map(t => t.rdmTenantId);

const extracted = extractRdmConfig(physical);
assert.strictEqual(extracted.serviceUri, expectedServiceUri);
assert.deepStrictEqual(extracted.rdmTenantIds, expectedIds);

// The physical configuration is only ever a discovery source — the extractor
// must not surface anything else from it.
assert.deepStrictEqual(Object.keys(extracted).sort(), ['rdmTenantIds', 'rejectedRdmTenantIds', 'serviceUri']);
assert.deepStrictEqual(extracted.rejectedRdmTenantIds, []);

// ---------------------------------------------------------------------------
// Tier A — extractRdmConfig is total over absent and malformed input
// ---------------------------------------------------------------------------

const empty = { serviceUri: undefined, rdmTenantIds: [], rejectedRdmTenantIds: [] };

// A tenant with no RDM at all is a normal outcome, not an error.
assert.deepStrictEqual(extractRdmConfig({}), empty);
assert.deepStrictEqual(extractRdmConfig({ rdmConfig: {} }), empty);
assert.deepStrictEqual(extractRdmConfig({ rdmConfig: null }), empty);

// Shapes that should never arrive, but must not throw if they do.
assert.deepStrictEqual(extractRdmConfig(undefined), empty);
assert.deepStrictEqual(extractRdmConfig(null), empty);
assert.deepStrictEqual(extractRdmConfig('not an object'), empty);
assert.deepStrictEqual(extractRdmConfig(42), empty);
assert.deepStrictEqual(extractRdmConfig([]), empty);

// serviceUri present but unusable.
assert.strictEqual(extractRdmConfig({ rdmConfig: { serviceUri: '' } }).serviceUri, undefined);
assert.strictEqual(extractRdmConfig({ rdmConfig: { serviceUri: '   ' } }).serviceUri, undefined);
assert.strictEqual(extractRdmConfig({ rdmConfig: { serviceUri: 123 } }).serviceUri, undefined);

// rdmTenants missing, empty, or the wrong type.
assert.deepStrictEqual(extractRdmConfig({ rdmConfig: { serviceUri: 'https://x' } }).rdmTenantIds, []);
assert.deepStrictEqual(
	extractRdmConfig({ rdmConfig: { serviceUri: 'https://x', rdmTenants: [] } }).rdmTenantIds,
	[],
);
assert.deepStrictEqual(
	extractRdmConfig({ rdmConfig: { serviceUri: 'https://x', rdmTenants: 'nope' } }).rdmTenantIds,
	[],
);

// Entries without a usable id are skipped; the rest keep their order.
const mixed = extractRdmConfig({
	rdmConfig: {
		serviceUri: 'https://rdm.example.invalid',
		rdmTenants: [
			{ rdmTenantId: 'zzzFirst' },
			{},
			{ rdmTenantId: '' },
			{ rdmTenantId: 42 },
			null,
			'nope',
			{ rdmTenantId: 'aaaSecond' },
		],
	},
});
assert.deepStrictEqual(mixed.rdmTenantIds, ['zzzFirst', 'aaaSecond'], 'order must be preserved');

// Multiple RDM tenants are all returned — taking only the first would be data loss.
const many = extractRdmConfig({
	rdmConfig: { serviceUri: 'https://x', rdmTenants: [{ rdmTenantId: 'A' }, { rdmTenantId: 'B' }, { rdmTenantId: 'C' }] },
});
assert.deepStrictEqual(many.rdmTenantIds, ['A', 'B', 'C']);

// Each id becomes a folder, RDM/{id}/config.json: one that could leave the tenant folder is
// set apart, to be reported and never written.
const unsafe = extractRdmConfig({
	rdmConfig: {
		serviceUri: 'https://x',
		rdmTenants: ['ok_Id-1', '..', '../../etc', 'a/b', 'a\\b', 'C:', 'with space', '.hidden', 'ok2'].map(rdmTenantId => ({ rdmTenantId })),
	},
});
assert.deepStrictEqual(unsafe.rdmTenantIds, ['ok_Id-1', 'ok2']);
assert.deepStrictEqual(unsafe.rejectedRdmTenantIds, ['..', '../../etc', 'a/b', 'a\\b', 'C:', 'with space', '.hidden']);

// ---------------------------------------------------------------------------
// Tier A — RDM JSON Schema
// ---------------------------------------------------------------------------

const rdmSchema = readJson('schemas/reltio-rdm.schema.json');
const rdmFixture = readJson('samples/rdm-config.sample.json');
const validate = new Ajv({ allErrors: true, strict: false }).compile(rdmSchema);

assert.ok(validate(rdmFixture), `sanitized RDM fixture must validate: ${JSON.stringify(validate.errors)}`);

// The fixture is one tenant's configuration. A tenant carrying properties this
// repository has never seen must still validate — the server produced the file,
// so the user could not fix such an "error" anyway.
const withExtras = JSON.parse(JSON.stringify(rdmFixture));
withExtras.someFutureTenantKey = { nested: true };
withExtras.lookupTypes[0].someFutureItemKey = 'x';
withExtras.sources[0].anotherFutureKey = 42;
assert.ok(validate(withExtras), 'unrecognized properties must be tolerated at every level');

// uri is the identity L3 lookupCode values reference, so it stays required.
const lookupWithoutUri = JSON.parse(JSON.stringify(rdmFixture));
delete lookupWithoutUri.lookupTypes[0].uri;
assert.ok(!validate(lookupWithoutUri), 'a lookup type without uri must be rejected');

const sourceWithoutUri = JSON.parse(JSON.stringify(rdmFixture));
delete sourceWithoutUri.sources[0].uri;
assert.ok(!validate(sourceWithoutUri), 'a source without uri must be rejected');

// Recognized properties are still type-checked.
const wrongType = JSON.parse(JSON.stringify(rdmFixture));
wrongType.trackTranscodeErrors = 'yes';
assert.ok(!validate(wrongType), 'a recognized property of the wrong type must be rejected');

// Tenants legitimately differ in how much reference data they define.
const emptyCollections = { ...rdmFixture, lookupTypes: [], sources: [] };
assert.ok(validate(emptyCollections), 'empty lookupTypes/sources must validate');

// ---------------------------------------------------------------------------
// Tier A — RDM file naming separates configurations from baselines
// ---------------------------------------------------------------------------

const sampleId = expectedIds[0];

// Configurations now live in the RDM component folder; this is the path users see.
assert.strictEqual(rdmFileName(sampleId), `RDM/${sampleId}/config.json`);

// The root-level names are kept only so relocation can find files written before
// the component tree existed.
assert.strictEqual(legacyRdmFileName(sampleId), `RDM.${sampleId}.reltio.json`);
assert.strictEqual(legacyRdmBaselineFileName(sampleId), `RDM.${sampleId}.remote-baseline.reltio.json`);

// Round-trip: a legacy name resolves back to the id that produced it.
assert.strictEqual(rdmTenantIdFromFileName(legacyRdmFileName(sampleId)), sampleId);

// The legacy baseline shares the RDM. prefix and .reltio.json suffix. Treating it as a
// second configuration would make relocation invent a phantom RDM tenant.
assert.ok(isRdmConfigurationFileName(legacyRdmFileName(sampleId)));
assert.ok(!isRdmConfigurationFileName(legacyRdmBaselineFileName(sampleId)));
assert.strictEqual(rdmTenantIdFromFileName(legacyRdmBaselineFileName(sampleId)), undefined);

// Neighbouring files in the same tenant folder must not be mistaken for RDM.
for (const name of [
	'L3.reltio.json',
	'L3.remote-baseline.reltio.json',
	'L3.reltio.layout.json',
	'RDM.reltio.json', // no id between the delimiters
	'notRDM.abc.reltio.json',
	'RDM.abc.json',
]) {
	assert.ok(!isRdmConfigurationFileName(name), `${name} must not be treated as an RDM configuration`);
}

// ---------------------------------------------------------------------------
// Tier A — drift predicate behind the pre-fetch warning
// ---------------------------------------------------------------------------

const serverCopy = JSON.stringify(rdmFixture, null, 2);
const edited = JSON.stringify({ ...rdmFixture, label: 'locally edited' }, null, 2);

// Untouched since the last fetch — no warning.
assert.strictEqual(hasUnpublishedLocalChangesFromText(serverCopy, serverCopy), false);
// Formatting-only differences are not edits.
assert.strictEqual(
	hasUnpublishedLocalChangesFromText(JSON.stringify(rdmFixture), serverCopy),
	false,
);
// Edited since the last fetch — warn before overwriting.
assert.strictEqual(hasUnpublishedLocalChangesFromText(edited, serverCopy), true);
// No baseline means no evidence the local file is safe to discard.
assert.strictEqual(hasUnpublishedLocalChangesFromText(serverCopy, undefined), true);

// ---------------------------------------------------------------------------
// Tier B — manifest wiring
// ---------------------------------------------------------------------------

const pkg = readJson('package.json');
const bindings = pkg.contributes.jsonValidation;
const asArray = v => (Array.isArray(v) ? v : [v]);

const rdmBinding = bindings.find(b => asArray(b.fileMatch).includes('RDM.*.reltio.json'));
assert.ok(rdmBinding, 'RDM files must be bound to a schema');
assert.strictEqual(rdmBinding.url, './schemas/reltio-rdm.schema.json');

// Without the exclusion, every RDM file would be validated against the L3
// schema, whose top level rejects tenantId/lookupTypes/trackTranscodeErrors.
const l3Binding = bindings.find(b => b.url === './schemas/reltio-metadata.schema.json');
assert.ok(l3Binding, 'the L3 binding must still exist');
const l3Patterns = asArray(l3Binding.fileMatch);
assert.ok(l3Patterns.includes('*.reltio.json'), 'L3 must still match *.reltio.json');
assert.ok(l3Patterns.includes('!RDM.*.reltio.json'), 'L3 must exclude RDM files');

// RDM rides on Get Configuration; a separate command for *fetching RDM
// configuration* would be a regression against the chosen trigger. Scoped to
// fetching on purpose — later changes legitimately add other RDM commands
// (e.g. reading a lookup type's values), and this guard must not block them.
const commandIds = (pkg.contributes.commands || []).map(c => c.command);
assert.ok(commandIds.includes('reltio.fetchL3'), 'Get Configuration must still be contributed');
const rdmFetchCommands = commandIds.filter(id => /(fetch|download)Rdm(Config(uration)?)?$/i.test(id));
assert.deepStrictEqual(rdmFetchCommands, [], 'no separate RDM configuration-fetch command may be contributed');
const rdmFetchMenuEntries = Object.values(pkg.contributes.menus || {})
	.flat()
	.filter(m => /(fetch|download)Rdm(Config(uration)?)?$/i.test(m.command || ''));
assert.deepStrictEqual(
	rdmFetchMenuEntries,
	[],
	'no menu entry may offer a separate RDM configuration fetch',
);

// ---------------------------------------------------------------------------
// Tier B — the schema ships in the VSIX
// ---------------------------------------------------------------------------

assert.ok(
	fs.existsSync(path.join(repoRoot, 'schemas/reltio-rdm.schema.json')),
	'RDM schema file must exist',
);
const vscodeignore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8');
assert.ok(
	vscodeignore.split(/\r?\n/).some(l => l.trim() === '!schemas/**'),
	'.vscodeignore must whitelist schemas/ so the RDM schema ships',
);

// ---------------------------------------------------------------------------
// HTTP 403 from the physical configuration (RP-195788 saw /reltio/tenants refuse
// accounts outside *.reltio.com; whether this per-tenant endpoint does is open)
// ---------------------------------------------------------------------------

// Tier B: the fetch chain runs on every Get Configuration and every connect flow, so a 403
// must end it quietly, like a tenant without RDM, before any error message is shown.
const extSource = fs.readFileSync(path.join(repoRoot, 'src', 'extension.ts'), 'utf8').replace(/\r\n/g, '\n');
const sliceFn = (name, end) => {
	const start = extSource.indexOf(`async function ${name}(`);
	assert.ok(start >= 0, `${name} must exist`);
	return extSource.slice(start, extSource.indexOf(end, start));
};
const chain = sliceFn('writeRdmFromApi', 'extractRdmConfig(physical)');
const forbidden = chain.search(/statusCode === 403\)\s*\{\s*logRdm\([\s\S]*?\);\s*return 'none';/);
assert.ok(forbidden >= 0, "writeRdmFromApi treats a 403 as 'none', after one line to the output channel");
assert.ok(forbidden < chain.indexOf('showErrorMessage'), 'the 403 returns before any error message');
assert.ok(/logRdm\(\s*`[^`]*HTTP 403/.test(chain), 'the logged line says why RDM is missing, so support can tell it from "no RDM"');

// The resolver serves commands the user ran (Get Lookup Values, Add Value, Apply RDM), so it explains a 403.
const resolver = sliceFn('resolveRdmServiceUri', 'extractRdmConfig(physical)');
assert.ok(/statusCode === 403/.test(resolver) && /HTTP 403/.test(resolver), 'resolveRdmServiceUri explains a 403');

// ---------------------------------------------------------------------------
// Tier B — connect flows (PR review)
// ---------------------------------------------------------------------------

{
	// Connect flows write without asking, so they leave local RDM edits alone; Get Configuration
	// asks first (its drift guard) and then overwrites.
	const writer = sliceFn('writeRdmFromApi', '\n\t}\n');
	assert.ok(
		/if \(options\.keepLocalChanges && \(await hasLocalRdmChanges\(environmentName, tenantId, rdmTenantId\)\)\) \{\s*kept\.push\([^)]*\)\);\s*continue;/.test(writer),
		'an RDM configuration with local changes is skipped when asked to keep them',
	);
	assert.ok(/showWarningMessage\(\s*`Kept your local changes/.test(writer), 'the user is told which files were kept');
	const localChanges = sliceFn('hasLocalRdmChanges', '\n\t}\n');
	assert.ok(/d\.isDirty/.test(localChanges), 'unsaved edits in an editor count as local changes');
	assert.ok(/hasUnpublishedLocalChanges\(/.test(localChanges), 'so do saved edits not yet applied');

	const queue = extSource.slice(extSource.indexOf('function queueRdmFetchOnConnect('));
	const queueBody = queue.slice(0, queue.indexOf('\n\t}\n'));
	assert.ok(/keepLocalChanges: true/.test(queueBody), 'connect flows keep local changes');

	const getConfiguration = sliceFn('fetchRdmForTenant', '\n\t}\n');
	assert.ok(!/keepLocalChanges/.test(getConfiguration), 'Get Configuration overwrites once its drift guard let it');
}

// The address of the RDM service, remembered per tenant, goes when a request to it fails or the session ends.
{
	const cache = importDist('rdm/rdmServiceCache');
	cache.clearRdmServiceUriCache();
	cache.rememberRdmServiceUri('dev', 'T1', 'https://rdm-1');
	cache.rememberRdmServiceUri('dev', 'T2', 'https://rdm-2');
	cache.rememberRdmServiceUri('prod', 'T1', 'https://rdm-3');
	cache.forgetRdmServiceUri('dev', 'T1');
	assert.strictEqual(cache.recallRdmServiceUri('dev', 'T1'), undefined);
	assert.strictEqual(cache.recallRdmServiceUri('dev', 'T2'), 'https://rdm-2');
	cache.forgetRdmServiceUris('dev');
	assert.strictEqual(cache.recallRdmServiceUri('dev', 'T2'), undefined);
	assert.strictEqual(cache.recallRdmServiceUri('prod', 'T1'), 'https://rdm-3', 'another environment keeps its own');

	const { TokenStore } = importDist('api/tokenStore');
	const store = new TokenStore();
	const cleared = [];
	store.onSessionCleared(env => cleared.push(env));
	store.clearSession('prod');
	assert.deepStrictEqual(cleared, ['prod']);
	assert.ok(/tokenStore\.onSessionCleared\(forgetRdmServiceUris\)/.test(extSource), 'a session that ends takes its RDM addresses with it');

	const after = extSource.slice(extSource.indexOf('function forgetRdmServiceAfter('));
	assert.ok(/statusCode === 401\)\) \{\s*forgetRdmServiceUri\(environmentName, tenantId\)/.test(after.slice(0, 300)), 'a 401 is a session problem and keeps the address');
}

// A workspace opened from a Git repository holds a placeholder, not a session.
{
	const sessionStart = extSource.indexOf('function rdmSessionToken(');
	assert.ok(sessionStart >= 0, 'rdmSessionToken must exist');
	const session = extSource.slice(sessionStart, extSource.indexOf('\n\t}\n', sessionStart));
	assert.ok(/token === GIT_SOURCE_TOKEN/.test(session), 'the placeholder is recognized');
	const handler = extSource.slice(extSource.indexOf("'reltio.getRdmLookupValues'"));
	assert.ok(/rdmSessionToken\(node\.environmentName/.test(handler.slice(0, 1200)), 'Get Lookup Values checks for it');
	assert.ok(/rdmSessionToken\(ctx\.environmentName/.test(sliceFn('submitLookupValues', '\n\t}\n')), 'Add Value checks for it');
	assert.ok(/rdmSessionToken\(node\.environmentName/.test(sliceFn('applyRdmConfigurationForNode', '\n\t}\n')), 'Apply RDM Configuration checks for it');
}

// Tier A: the client reports a 403 as a ReltioApiError carrying the status, which both checks rely on.
(async () => {
	const { fetchTenantPhysicalConfiguration, ReltioApiError } = importDist('api/reltioClient');
	const original = globalThis.fetch;
	globalThis.fetch = async () => ({ status: 403, ok: false, json: async () => ({}), text: async () => '{}' });
	try {
		await assert.rejects(
			() => fetchTenantPhysicalConfiguration('na-dev-1.cloud.reltio.com', 'tenantAlpha', 'tok-1'),
			e => e instanceof ReltioApiError && e.statusCode === 403,
		);
	} finally {
		globalThis.fetch = original;
	}
	console.log('test-rdm-configuration-fetch: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
