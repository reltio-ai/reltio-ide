#!/usr/bin/env node
'use strict';
/**
 * Regression: LCA.
 *
 * Rows: LCA-001 (isContainedPath, findTypeJsonPath, replaceLifecycleActions on the shared fixture),
 * LCA-002 (buildDeployPlan aws/gcp args, presentEnvKeys placeholder handling), LCA-004 (deploy
 * refusals for azure/native and missing .env keys, deployFailureGuidance redaction and per-class
 * next action), LCA-008 (function-name injection, artifact path containment, childEnv secret values,
 * redactCommandOutput), LCA-011 (readProjectContext on corrupt, mismatched and partial files),
 * LCA-018 (missingEnvKeys for gcp/azure/native, discoverEnvFile, discoverPhysicalConfig, physical
 * access edge cases), LCA-019 (hasGeneratedJava, findDeployArtifact), LCA-020 (formatLifecycleDiff).
 *
 * LCA-003, LCA-005, LCA-006, LCA-009, LCA-010 and LCA-012..LCA-017 extend test-lca-workflow.cjs.
 * LCA-007 is manual (Tier C).
 * No cloud CLI runs: buildDeployPlan only returns the argument list.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseTree, findNodeAtLocation } = require('jsonc-parser');
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');

const { isContainedPath } = importDist('lca/sources');
const { findTypeJsonPath, replaceLifecycleActions } = importDist('lca/l3Edit');
const { buildDeployPlan, childEnv, redactCommandOutput } = importDist('lca/deployPlan');
const { presentEnvKeys, isPlaceholderEnvValue } = importDist('lca/envCheck');
const lca = importDist('lca/index');
const { deployFailureGuidance, readProjectContext, projectContextFile } = lca;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-reg-'));

// ---------------------------------------------------------------------------
// LCA-001 #1: isContainedPath
// ---------------------------------------------------------------------------
{
	const root = path.join(tmp, 'root');
	assert.strictEqual(isContainedPath(root, root), false, 'LCA-001 #1: root itself is not contained');
	assert.strictEqual(isContainedPath(root, `${root}${path.sep}`), false, 'LCA-001 #1: root with trailing separator is not contained');
	assert.strictEqual(isContainedPath(root, path.join(root, 'a.jar')), true, 'LCA-001 #1: root/a.jar is contained');
	assert.strictEqual(isContainedPath(root, path.join(root, 'sub', 'deep', 'a.jar')), true, 'LCA-001 #1: nested file is contained');
	assert.strictEqual(isContainedPath(root, `${root}/../x`), false, 'LCA-001 #1: root/../x is outside');
	assert.strictEqual(isContainedPath(root, `${root}-evil/a.jar`), false, 'LCA-001 #1: sibling-prefix root-evil is outside');
	assert.strictEqual(isContainedPath(root, `${root}/sub/../a.jar`), true, 'LCA-001 #1: normalized in-root path is contained');
	if (process.platform === 'win32') {
		const drive = path.parse(path.resolve(root)).root.toUpperCase().startsWith('Z') ? 'Y:\\' : 'Z:\\';
		assert.strictEqual(isContainedPath(root, `${drive}a.jar`), false, 'LCA-001 #1: a different drive is outside');
	}
}

// ---------------------------------------------------------------------------
// LCA-001 #2: findTypeJsonPath + replaceLifecycleActions on samples/first-test.json
// ---------------------------------------------------------------------------
{
	const { text } = loadCanonicalFixture();
	const original = JSON.parse(text);
	const entityIndex = original.entityTypes.findIndex(t => t.lifecycleActions);
	assert.ok(entityIndex >= 0, 'LCA-001 #2: fixture has an entity type with lifecycleActions');
	const entityUri = original.entityTypes[entityIndex].uri;
	assert.deepStrictEqual(findTypeJsonPath(original, entityUri), ['entityTypes', entityIndex, 'lifecycleActions'], 'LCA-001 #2: entity path');
	const relIndex = original.relationTypes.length - 1;
	assert.deepStrictEqual(
		findTypeJsonPath(original, original.relationTypes[relIndex].uri),
		['relationTypes', relIndex, 'lifecycleActions'],
		'LCA-001 #2: relation path',
	);
	assert.deepStrictEqual(
		findTypeJsonPath(original, 'configuration/changeRequestTypes/default'),
		['changeRequestTypes', 0, 'lifecycleActions'],
		'LCA-001 #2: change-request path',
	);
	assert.strictEqual(findTypeJsonPath(original, 'configuration/entityTypes/NoSuchType'), undefined, 'LCA-001 #2: unknown URI gives undefined');

	const jsonPath = findTypeJsonPath(original, entityUri);
	const proposal = { ...original.entityTypes[entityIndex].lifecycleActions, beforeSave: ['Lambda/BinaryJSON/regression-fn'] };
	const edited = replaceLifecycleActions(text, jsonPath, proposal);
	assert.notStrictEqual(edited, text, 'LCA-001 #2: the edit changes the text');
	let parsed;
	assert.doesNotThrow(() => { parsed = JSON.parse(edited); }, 'LCA-001 #2: edited text still parses as JSON');
	const expected = JSON.parse(text);
	expected.entityTypes[entityIndex].lifecycleActions = proposal;
	assert.deepStrictEqual(parsed, expected, 'LCA-001 #2: only that type\'s lifecycleActions changed');

	// Text-level: every changed character lies inside the original lifecycleActions node.
	const node = findNodeAtLocation(parseTree(text), jsonPath);
	assert.ok(node, 'LCA-001 #2: lifecycleActions node found in fixture text');
	let prefix = 0;
	while (prefix < text.length && text[prefix] === edited[prefix]) prefix++;
	let suffix = 0;
	while (suffix < text.length - prefix && text[text.length - 1 - suffix] === edited[edited.length - 1 - suffix]) suffix++;
	assert.ok(prefix >= node.offset, `LCA-001 #2: edit starts inside lifecycleActions (${prefix} >= ${node.offset})`);
	assert.ok(text.length - suffix <= node.offset + node.length, 'LCA-001 #2: edit ends inside lifecycleActions');
}

// ---------------------------------------------------------------------------
// LCA-002 #1/#2: buildDeployPlan argument lists
// ---------------------------------------------------------------------------
const workDir = path.join(tmp, 'work');
fs.mkdirSync(path.join(workDir, 'target'), { recursive: true });
const zip = path.join(workDir, 'target', 'hcp.zip');
fs.writeFileSync(zip, 'zip');
{
	const env = 'AWS_REGION=us-east-1\nAWS_PROFILE=dev-profile-name\n';
	const aws = buildDeployPlan({ provider: 'aws', workingDirectory: workDir, functionName: 'hcp-before-save', artifactPath: zip, envText: env });
	assert.strictEqual(aws.ok, true, `LCA-002 #1: aws plan ok (${aws.message})`);
	assert.strictEqual(aws.plan.executable, 'aws', 'LCA-002 #1: aws executable');
	assert.deepStrictEqual(
		aws.plan.args,
		['lambda', 'update-function-code', '--function-name', 'hcp-before-save', '--zip-file', `fileb://${path.resolve(zip)}`],
		'LCA-002 #1: aws args',
	);
	assert.strictEqual(aws.plan.cwd, path.resolve(workDir), 'LCA-002 #1: cwd is the working directory');
	assert.ok(!aws.plan.summary.includes('dev-profile-name'), 'LCA-002 #1: summary has no profile value');
	assert.ok(!aws.plan.summary.includes('us-east-1'), 'LCA-002 #1: summary has no .env values');
	assert.strictEqual(aws.env.AWS_PROFILE, 'dev-profile-name', 'LCA-002 #1: .env value goes to the child env');

	const gcpEnv = 'GOOGLE_CLOUD_PROJECT=acme-prod\nGOOGLE_CLOUD_REGION=us-central1\n';
	const unresolved = `${workDir}${path.sep}target${path.sep}..`;
	const gcp = buildDeployPlan({ provider: 'gcp', workingDirectory: unresolved, functionName: 'hcp-fn', artifactPath: zip, envText: gcpEnv });
	assert.strictEqual(gcp.ok, true, `LCA-002 #2: gcp plan ok (${gcp.message})`);
	assert.strictEqual(gcp.plan.executable, 'gcloud', 'LCA-002 #2: gcloud executable');
	assert.deepStrictEqual(
		gcp.plan.args,
		['functions', 'deploy', 'hcp-fn', '--gen2', '--region', 'us-central1', '--source', path.dirname(path.resolve(zip))],
		'LCA-002 #2: gcloud args',
	);
	assert.strictEqual(gcp.plan.cwd, path.resolve(workDir), 'LCA-002 #2: cwd is the resolved working directory');
	assert.ok(!gcp.plan.summary.includes('acme-prod'), 'LCA-002 #2: summary has no project value');
}

// ---------------------------------------------------------------------------
// LCA-002 #3: presentEnvKeys skips placeholders, empty, comment and malformed lines
// ---------------------------------------------------------------------------
{
	const text = [
		'AWS_PROFILE=your-profile',
		'AWS_REGION=<region>',
		'GOOGLE_CLOUD_PROJECT=changeme',
		'EMPTY_QUOTED=""',
		'EMPTY_PLAIN=',
		'# COMMENTED=real-value',
		'NO_EQUALS_LINE',
		'=orphan-value',
		'REAL_KEY="real-value-123"',
		'',
	].join('\n');
	const keys = [...presentEnvKeys(text)];
	assert.deepStrictEqual(keys, ['REAL_KEY'], `LCA-002 #3: only the real-valued key, got ${JSON.stringify(keys)}`);
	assert.ok(!JSON.stringify(keys).includes('real-value-123'), 'LCA-002 #3: key names only, never values');
	for (const v of ['your-profile', '<region>', 'changeme', '""', '', '  ']) {
		assert.strictEqual(isPlaceholderEnvValue(v), true, `LCA-002 #3: "${v}" is a placeholder`);
	}
	assert.strictEqual(isPlaceholderEnvValue('prod-account'), false, 'LCA-002 #3: real value is not a placeholder');
}

// ---------------------------------------------------------------------------
// LCA-004 #1/#2: deploy refusals
// ---------------------------------------------------------------------------
{
	const env = 'AWS_REGION=us-east-1\nAWS_PROFILE=dev\n';
	const azure = buildDeployPlan({ provider: 'azure', workingDirectory: workDir, functionName: 'fn', artifactPath: zip, envText: env });
	assert.strictEqual(azure.ok, false, 'LCA-004 #1: azure refused');
	assert.match(azure.message, /Azure LCA deployment is unresolved/, 'LCA-004 #1: azure message');
	assert.strictEqual(azure.plan, undefined, 'LCA-004 #1: azure returns no plan');
	assert.strictEqual(azure.env, undefined, 'LCA-004 #1: azure returns no env');
	const native = buildDeployPlan({ provider: 'native', workingDirectory: workDir, functionName: 'fn', artifactPath: zip, envText: env });
	assert.strictEqual(native.ok, false, 'LCA-004 #1: native refused');
	assert.match(native.message, /does not use a cloud CLI/, 'LCA-004 #1: native message');
	assert.strictEqual(native.plan, undefined, 'LCA-004 #1: native returns no plan');
	assert.strictEqual(native.env, undefined, 'LCA-004 #1: native returns no env');

	const cases = [
		{ env: 'AWS_REGION=us-east-1\n', missing: ['AWS_PROFILE or AWS_ACCESS_KEY_ID'], secret: 'us-east-1' },
		{ env: 'AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP\n', missing: ['AWS_SECRET_ACCESS_KEY'], secret: 'AKIAABCDEFGHIJKLMNOP' },
		{
			env: 'AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=ASIAABCDEFGHIJKLMNOP\nAWS_SECRET_ACCESS_KEY=topsecretvalue\n',
			missing: ['AWS_SESSION_TOKEN'],
			secret: 'topsecretvalue',
		},
	];
	for (const c of cases) {
		const r = buildDeployPlan({ provider: 'aws', workingDirectory: workDir, functionName: 'fn', artifactPath: zip, envText: c.env });
		assert.strictEqual(r.ok, false, `LCA-004 #2: refused for ${c.missing}`);
		assert.deepStrictEqual(r.missing, c.missing, `LCA-004 #2: missing names ${c.missing}`);
		for (const name of c.missing) assert.ok(r.message.includes(name), `LCA-004 #2: message names ${name}`);
		assert.ok(!r.message.includes(c.secret), `LCA-004 #2: message has no .env value (${c.missing})`);
		assert.ok(!r.message.includes('ASIAABCDEFGHIJKLMNOP'), 'LCA-004 #2: message has no access key');
		assert.strictEqual(r.plan, undefined, 'LCA-004 #2: no plan on refusal');
	}
}

// ---------------------------------------------------------------------------
// LCA-004 #3: deployFailureGuidance
// ---------------------------------------------------------------------------
{
	const leak = 'aws_secret_access_key=abcSECRETxyz';
	const classes = {
		expired: `ExpiredToken: The security token included in the request is expired. ${leak}`,
		invalid: `InvalidClientTokenId: The security token included in the request is invalid. ${leak}`,
		denied: `AccessDeniedException: status code: 403 ${leak}`,
		notFound: `ResourceNotFoundException: Function not found ${leak}`,
		unknown: `Something odd happened ${leak}`,
	};
	const results = {};
	for (const [name, text] of Object.entries(classes)) {
		const g = deployFailureGuidance(text);
		results[name] = g;
		assert.ok(g.error.includes('[redacted]'), `LCA-004 #3: ${name} error shows [redacted]`);
		assert.ok(!g.error.includes('abcSECRETxyz'), `LCA-004 #3: ${name} error drops the secret`);
		assert.ok(!g.nextAction.includes('abcSECRETxyz'), `LCA-004 #3: ${name} next action drops the secret`);
	}
	const distinct = new Set(Object.values(results).map(r => r.nextAction));
	assert.strictEqual(distinct.size, 5, 'LCA-004 #3: next action differs per failure class');
	assert.match(results.expired.nextAction, /expired/i, 'LCA-004 #3: expired guidance');
	assert.match(results.invalid.nextAction, /rejected/i, 'LCA-004 #3: invalid credential guidance');
	assert.match(results.denied.nextAction, /permission/i, 'LCA-004 #3: access denied guidance');
	assert.match(results.notFound.nextAction, /not found/i, 'LCA-004 #3: not found guidance');
	for (const name of ['expired', 'invalid']) {
		assert.match(results[name].nextAction, /Do not paste the secret/, `LCA-004 #3: ${name} says not to paste secrets`);
	}
	assert.match(results.unknown.nextAction, /Do not update tenant L3 until the deploy succeeds/, 'LCA-004 #3: unknown says do not update L3');
	assert.match(deployFailureGuidance('HTTP 403').nextAction, /permission/i, 'LCA-004 #3: bare 403 is access denied');
}

// ---------------------------------------------------------------------------
// LCA-008 #1: function-name injection
// ---------------------------------------------------------------------------
const goodEnv = 'AWS_REGION=us-east-1\nAWS_PROFILE=dev\n';
{
	for (const name of ['a; rm -rf /', '--profile evil', 'a b', '$(id)', '-x', '', 'a'.repeat(129)]) {
		const r = buildDeployPlan({ provider: 'aws', workingDirectory: workDir, functionName: name, artifactPath: zip, envText: goodEnv });
		assert.strictEqual(r.ok, false, `LCA-008 #1: "${name.slice(0, 20)}" refused`);
		assert.match(r.message, /unsupported characters/, `LCA-008 #1: "${name.slice(0, 20)}" gets the unsupported-characters message`);
	}
	const ok = buildDeployPlan({ provider: 'aws', workingDirectory: workDir, functionName: 'hcp.before-save_1', artifactPath: zip, envText: goodEnv });
	assert.strictEqual(ok.ok, true, 'LCA-008 #1: hcp.before-save_1 accepted');
	assert.strictEqual(ok.plan.args[3], 'hcp.before-save_1', 'LCA-008 #1: name passed as one argument');
	const max = buildDeployPlan({ provider: 'aws', workingDirectory: workDir, functionName: 'a'.repeat(128), artifactPath: zip, envText: goodEnv });
	assert.strictEqual(max.ok, true, 'LCA-008 #1: 128-char name accepted');
}

// ---------------------------------------------------------------------------
// LCA-008 #2: artifact path guards
// ---------------------------------------------------------------------------
{
	const otherDir = path.join(tmp, 'other');
	fs.mkdirSync(otherDir, { recursive: true });
	fs.writeFileSync(path.join(otherDir, 'app.zip'), 'zip');
	fs.writeFileSync(path.join(tmp, 'outside.zip'), 'zip');
	const outside = [`${workDir}${path.sep}..${path.sep}outside.zip`, path.join(otherDir, 'app.zip'), workDir];
	for (const artifactPath of outside) {
		const r = buildDeployPlan({ provider: 'aws', workingDirectory: workDir, functionName: 'fn', artifactPath, envText: goodEnv });
		assert.strictEqual(r.ok, false, `LCA-008 #2: ${artifactPath} refused`);
		assert.strictEqual(r.message, 'The deploy artifact must be a file inside the working directory.', `LCA-008 #2: ${artifactPath} containment message`);
		assert.strictEqual(r.plan, undefined, `LCA-008 #2: ${artifactPath} never reaches CLI args`);
	}
	const txt = buildDeployPlan({ provider: 'aws', workingDirectory: workDir, functionName: 'fn', artifactPath: path.join(workDir, 'build', 'app.txt'), envText: goodEnv });
	assert.strictEqual(txt.ok, false, 'LCA-008 #2: .txt refused');
	assert.strictEqual(txt.message, 'The deploy artifact must be a .jar or .zip file.', 'LCA-008 #2: .txt extension message');
}

// ---------------------------------------------------------------------------
// LCA-008 #3: childEnv secret values and redactCommandOutput
// ---------------------------------------------------------------------------
{
	const text = 'QUOTED="quoted-secret-1"\nPLAIN=plain-secret-2\nSHORT=abc1234\nEIGHT=12345678\n# NOTE=commented-long-value\n';
	const { env, secretValues } = childEnv(text, { BASE: 'kept' });
	assert.strictEqual(env.QUOTED, 'quoted-secret-1', 'LCA-008 #3: quotes stripped');
	assert.strictEqual(env.PLAIN, 'plain-secret-2', 'LCA-008 #3: unquoted value kept');
	assert.strictEqual(env.BASE, 'kept', 'LCA-008 #3: base env kept');
	assert.deepStrictEqual(secretValues, ['quoted-secret-1', 'plain-secret-2', '12345678'], 'LCA-008 #3: only values of 8+ chars are secrets');

	const output = [
		'deploy using quoted-secret-1 and plain-secret-2',
		'key AKIAIOSFODNN7EXAMPLE',
		'password=x',
		'short abc1234',
	].join('\n') + '\n' + 'z'.repeat(5000);
	const redacted = redactCommandOutput(output, [...secretValues, 'abc1234']);
	assert.ok(!redacted.includes('quoted-secret-1'), 'LCA-008 #3: quoted secret scrubbed');
	assert.ok(!redacted.includes('plain-secret-2'), 'LCA-008 #3: plain secret scrubbed');
	assert.ok(!redacted.includes('AKIAIOSFODNN7EXAMPLE'), 'LCA-008 #3: AKIA key scrubbed');
	assert.ok(!redacted.includes('password=x'), 'LCA-008 #3: password=x scrubbed');
	assert.ok((redacted.match(/\[redacted\]/g) || []).length >= 4, 'LCA-008 #3: [redacted] per secret');
	assert.ok(redacted.includes('short abc1234'), 'LCA-008 #3: shorter values are not scrubbed');
	assert.strictEqual(redacted.length, 2000, 'LCA-008 #3: output cut to 2000 chars');
}

// ---------------------------------------------------------------------------
// LCA-011: readProjectContext on corrupt, mismatched and partial files
// ---------------------------------------------------------------------------
{
	const dir = path.join(tmp, 'ctx');
	const file = projectContextFile(dir, 'tenantA');
	fs.mkdirSync(path.dirname(file), { recursive: true });

	fs.writeFileSync(file, '{ not json !!');
	let result;
	assert.doesNotThrow(() => { result = readProjectContext(dir, 'tenantA'); }, 'LCA-011 #1: garbage does not throw');
	assert.strictEqual(result, undefined, 'LCA-011 #1: garbage returns undefined');

	fs.writeFileSync(file, JSON.stringify({ workingDirectory: path.join(tmp, 'elsewhere'), tenantId: 'tenantA', customerName: 'Other' }));
	assert.doesNotThrow(() => { result = readProjectContext(dir, 'tenantA'); }, 'LCA-011 #2: mismatched does not throw');
	assert.strictEqual(result, undefined, 'LCA-011 #2: another workingDirectory returns undefined');

	fs.writeFileSync(file, JSON.stringify({ workingDirectory: dir, tenantId: 'tenantA', customerName: 'Acme', implementationLanguage: 'Python' }));
	result = readProjectContext(dir, 'tenantA');
	assert.ok(result, 'LCA-011 #3: partial file is read');
	assert.strictEqual(result.customerName, 'Acme', 'LCA-011 #3: stored field kept');
	assert.strictEqual(result.implementationLanguage, 'Java', 'LCA-011 #3: implementationLanguage forced to Java');
	assert.strictEqual(result.connectivityStatus, 'unknown', 'LCA-011 #3: missing connectivityStatus from emptyProjectContext');
	assert.strictEqual(result.deploymentStatus, 'none', 'LCA-011 #3: missing deploymentStatus from emptyProjectContext');
	assert.strictEqual(result.designApproved, false, 'LCA-011 #3: missing designApproved is false');
	assert.strictEqual(result.l3UpdateApproved, false, 'LCA-011 #3: missing l3UpdateApproved is false');
}

// ---------------------------------------------------------------------------
// LCA-018: deploy prerequisites (.env keys per cloud, .env and physical config discovery)
// ---------------------------------------------------------------------------
{
	const { missingEnvKeys, discoverEnvFile, discoverPhysicalConfig, assessPhysicalAccess } = lca;
	assert.deepStrictEqual(missingEnvKeys('', 'gcp'), ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_REGION'], 'LCA-018 #1: gcp keys');
	assert.deepStrictEqual(missingEnvKeys('', 'azure'), ['AZURE_FUNCTIONAPP_NAME', 'AZURE_RESOURCE_GROUP'], 'LCA-018 #1: azure keys');
	assert.deepStrictEqual(missingEnvKeys('', 'native'), [], 'LCA-018 #1: native needs no keys');

	const envRoot = path.join(tmp, 'env');
	const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
	write(path.join(envRoot, '.env.example'), 'AWS_PROFILE=your-profile\n');
	write(path.join(envRoot, 'node_modules', '.env'), 'AWS_PROFILE=hidden\n');
	write(path.join(envRoot, 'velocity-packs', '.env'), 'AWS_PROFILE=pack\n');
	write(path.join(envRoot, 'sub', '.env'), 'AWS_PROFILE=nested\n');
	assert.strictEqual(discoverEnvFile(envRoot), path.join(envRoot, 'sub', '.env'), 'LCA-018 #2: skips .env.example, node_modules and packs');
	write(path.join(envRoot, '.env'), 'AWS_PROFILE=root\n');
	assert.strictEqual(discoverEnvFile(envRoot), path.join(envRoot, '.env'), 'LCA-018 #2: root .env wins');

	const physicalRoot = path.join(tmp, 'physical');
	write(path.join(physicalRoot, 'physical.json'), '{"region":"us-east-1"}\n');
	write(path.join(physicalRoot, 'tenant-config.json'), '{}\n');
	write(path.join(physicalRoot, 'velocity-packs', 'life', 'physical.json'), '{}\n');
	const tenantDir = path.join(physicalRoot, 'dev', 'abc123');
	write(path.join(tenantDir, '.reltio-config-source.json'), JSON.stringify({ kind: 'tenant', environmentName: 'dev', tenantId: 'abc123' }));
	write(path.join(tenantDir, 'physical.json'), '{"awsAccountId":"123456789012"}\n');
	assert.strictEqual(discoverPhysicalConfig(physicalRoot), path.join(tenantDir, 'physical.json'), 'LCA-018 #3: tenant physical.json wins');
	const onlyUnknown = path.join(tmp, 'physical-unknown');
	write(path.join(onlyUnknown, 'tenant-config.json'), '{}\n');
	assert.strictEqual(discoverPhysicalConfig(onlyUnknown), undefined, 'LCA-018 #3: unrelated JSON is not physical config');

	assert.strictEqual(
		assessPhysicalAccess(JSON.stringify({ projectId: 'demo', serviceAccountEmail: 'reltio-demo' }), 'gcp').present,
		false,
		'LCA-018 #4: gcp service account without @ is incomplete',
	);
	assert.strictEqual(assessPhysicalAccess('   ', 'aws').present, false, 'LCA-018 #4: blank text is incomplete');
	assert.strictEqual(assessPhysicalAccess(undefined, 'native').present, true, 'LCA-018 #4: native needs no physical config');
}

// ---------------------------------------------------------------------------
// LCA-019: hasGeneratedJava and findDeployArtifact
// ---------------------------------------------------------------------------
{
	const { hasGeneratedJava, findDeployArtifact } = importDist('lca/sources');
	const srcRoot = path.join(tmp, 'src-root');
	fs.mkdirSync(path.join(srcRoot, 'src'), { recursive: true });
	fs.writeFileSync(path.join(srcRoot, 'src', 'A.java'), 'class A {}\n');
	assert.strictEqual(hasGeneratedJava(srcRoot), true, 'LCA-019 #1: Java under src counts');
	const targetOnly = path.join(tmp, 'target-only');
	fs.mkdirSync(path.join(targetOnly, 'target'), { recursive: true });
	fs.writeFileSync(path.join(targetOnly, 'target', 'A.java'), 'class A {}\n');
	fs.mkdirSync(path.join(targetOnly, 'samples'), { recursive: true });
	fs.writeFileSync(path.join(targetOnly, 'samples', 'S.java'), 'class S {}\n');
	assert.strictEqual(hasGeneratedJava(targetOnly), false, 'LCA-019 #1: Java only under target or samples does not count');

	fs.writeFileSync(path.join(srcRoot, 'short.zip'), 'z');
	fs.mkdirSync(path.join(srcRoot, 'target'), { recursive: true });
	fs.writeFileSync(path.join(srcRoot, 'target', 'long-name-artifact.jar'), 'j');
	assert.ok(findDeployArtifact(srcRoot).includes(`${path.sep}target${path.sep}`), 'LCA-019 #2: build output under target is preferred');
}

// ---------------------------------------------------------------------------
// LCA-020: formatLifecycleDiff
// ---------------------------------------------------------------------------
{
	const diff = lca.formatLifecycleDiff({ hook: 'beforeSave', current: [], proposed: ['Lambda/BinaryJSON/hcp-fn'] });
	assert.match(diff, /Current/, 'LCA-020 #1: diff shows the current list');
	assert.match(diff, /\(none\)/, 'LCA-020 #1: an empty current list shows (none)');
	assert.match(diff, /Lambda\/BinaryJSON\/hcp-fn/, 'LCA-020 #1: diff shows the proposed action');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test-lca: OK');
