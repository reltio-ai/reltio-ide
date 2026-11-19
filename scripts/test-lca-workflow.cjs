#!/usr/bin/env node
'use strict';
/**
 * LCA agent workflow gates, package naming, L3 registration, and lifecycleActions tree leaf.
 *
 * Regression rows (docs/test-proposals/lca.json), added at the end of this script:
 *  - LCA-003 tenantRootFromConfig marker walk, validateHook/hooksForKind, proposeLifecycleChange ops, L3 path predicates
 *  - LCA-005 isExplicitApproval/classifyTurn, ordered generate/deploy/updateL3 gates with messages
 *  - LCA-006 resolveObjectType/resolveAttributes misses and ambiguity, assessPhysicalAccess per cloud
 *  - LCA-009 package, slug, git-marker and context-file traversal guards
 *  - LCA-010 discoverTenantL3 cap, skipped folders and depth bound
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const lca = importDist('lca/index');
const { getConfigRootChildren, getConfigNodeChildren } = importDist('tree/configSubtree');

const {
	assessTenantConnection,
	discoverTenantL3,
	isComponentConfigPath,
	isTenantL3Path,
	TENANT_CONNECTION_MESSAGE,
	classifyLcaIntent,
	tenantAwareIntent,
	resolveObjectType,
	resolveAttributes,
	buildJavaPackage,
	isForbiddenGenericPackage,
	selectCloud,
	validateHook,
	proposeLifecycleChange,
	applyLifecycleProposal,
	createWorkflow,
	gate,
	markObjectAttributesConfirmed,
	markDesignPending,
	markDesignApproved,
	markImplementationGenerated,
	markDeploymentPending,
	markDeployed,
	markConnectivityConfirmed,
	beginCodeChange,
	markTenantConfigPending,
	LcaContextStore,
	workflowFromContext,
	contextPatchFromWorkflow,
	invalidateTenantScoped,
	requireJava,
	formatObjectAttributeConfirmation,
	formatImplementationDesign,
	formatDeploymentPreview,
	deploymentPrompt,
	step,
	extractFacts,
	classifyTurn,
	isDisallowedCredentialPrompt,
	credentialPrompt,
	actionSucceeded,
	connectivityRequired,
	cloudRegistration,
	missingEnvKeys,
} = lca;

const model = {
	entityTypes: [
		{
			uri: 'configuration/entityTypes/HCP',
			label: 'HCP',
			attributes: [
				{ name: 'FirstName', uri: 'configuration/entityTypes/HCP/attributes/FirstName' },
				{ name: 'MiddleName', uri: 'configuration/entityTypes/HCP/attributes/MiddleName' },
				{ name: 'LastName', uri: 'configuration/entityTypes/HCP/attributes/LastName' },
				{ name: 'CustomerId', uri: 'configuration/entityTypes/HCP/attributes/CustomerId' },
			],
			lifecycleActions: {
				beforeSave: ['Lambda/BinaryJSON/existing-action'],
			},
		},
		{
			uri: 'configuration/entityTypes/Organization',
			label: 'Organization',
			attributes: [{ name: 'Name', uri: 'configuration/entityTypes/Organization/attributes/Name' }],
		},
	],
	relationTypes: [
		{
			uri: 'configuration/relationTypes/HasAddress',
			label: 'HasAddress',
			attributes: [{ name: 'AddressType', uri: 'configuration/relationTypes/HasAddress/attributes/AddressType' }],
			lifecycleActions: {
				beforeSave: ['Lambda/BinaryJSON/has-address'],
			},
		},
	],
	changeRequestTypes: [
		{
			uri: 'configuration/changeRequestTypes/HcpDcr',
			lifecycleActions: { afterDCRSave: ['Reltio/DVFAction'] },
		},
	],
};

// Tenant connection
const connected = assessTenantConnection({
	tenantAware: true,
	l3Paths: ['/ws/.reltio/dev.reltio.environment/abc123.reltio.tenant/L3.reltio.json'],
});
assert.strictEqual(connected.connected, true);
assert.strictEqual(connected.selected.tenantId, 'abc123');

const disconnected = assessTenantConnection({
	tenantAware: true,
	l3Paths: ['/ws/samples/ppl-example.reltio.json'],
});
assert.strictEqual(disconnected.connected, false);
assert.strictEqual(disconnected.state, 'TENANT_CONNECTION_REQUIRED');
assert.strictEqual(disconnected.message, TENANT_CONNECTION_MESSAGE);

const advice = 'What does the beforeSave hook do?';
assert.strictEqual(classifyLcaIntent(advice), 'advise');
assert.strictEqual(tenantAwareIntent(advice, 'advise'), false);
assert.strictEqual(tenantAwareIntent('What attributes does Individual have?', 'advise'), true);
assert.strictEqual(tenantAwareIntent('explain Course', 'advise'), true);
assert.strictEqual(tenantAwareIntent('The team is researching LCA hooks to determine whether LCA is the right mechanism for member ID collisions.', 'advise'), false);
assert.strictEqual(isTenantL3Path('/ws/foo.reltio.tenant/notL3.reltio.json'), false);
assert.strictEqual(isTenantL3Path('/ws/.reltio/dev.reltio.environment/abc123.reltio.tenant/L3.reltio.json'), true);
const adviceGate = assessTenantConnection({ tenantAware: false, l3Paths: [] });
assert.strictEqual(adviceGate.message, undefined);

// Object lookup
const hcp = resolveObjectType(model, 'HCP');
assert.strictEqual(hcp.ok, true);
assert.strictEqual(hcp.object.kind, 'entity');
assert.strictEqual(hcp.object.uri, 'configuration/entityTypes/HCP');
const missingType = resolveObjectType(model, 'CourseTopics');
assert.strictEqual(missingType.ok, false);
assert.ok(missingType.suggestions.length > 0);

const attrs = resolveAttributes(hcp.object, ['FirstName', 'MiddleName', 'CustomerId']);
assert.strictEqual(attrs.ok, true);
const badAttr = resolveAttributes(hcp.object, ['NpiNumber']);
assert.strictEqual(badAttr.ok, false);

// Confirmation gates — no code before confirmations
let flow = createWorkflow({
	state: 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION',
	intent: 'generate',
	tenantId: 'abc123',
	customerName: 'Acme',
	targetType: 'HCP',
	targetKind: 'entity',
	hook: 'beforeSave',
	attributesRead: ['FirstName', 'LastName', 'CustomerId'],
	attributesUpdated: ['CustomerId'],
});
assert.strictEqual(gate(flow, 'generate').allowed, false);
flow = markObjectAttributesConfirmed(flow);
flow = markDesignPending(flow);
assert.strictEqual(gate(flow, 'generate').allowed, false);
flow = markDesignApproved(flow);
assert.strictEqual(gate(flow, 'generate').allowed, true);

// Package
assert.strictEqual(buildJavaPackage({ customerName: 'Acme', tenantId: 'abc123', typeName: 'HCP' }), 'com.reltio.lca.acme.hcp');
assert.strictEqual(buildJavaPackage({ customerName: 'Acme', tenantId: 'abc123', typeName: 'HasAddress' }), 'com.reltio.lca.acme.hasaddress');
assert.strictEqual(buildJavaPackage({ tenantId: 'abc123', typeName: 'HCP' }), 'com.reltio.lca.abc123.hcp');
assert.strictEqual(buildJavaPackage({ customerName: 'Acme Corp', tenantId: 'abc-123', typeName: 'HCP' }), 'com.reltio.lca.acmecorp.hcp');
assert.strictEqual(isForbiddenGenericPackage('com.example.lca'), true);
assert.ok(!buildJavaPackage({ tenantId: 'abc123', typeName: 'HCP' }).startsWith('com.example'));

// Cloud
assert.strictEqual(selectCloud(null).provider, 'aws');
assert.strictEqual(selectCloud(null).defaulted, true);
assert.strictEqual(selectCloud('AWS').provider, 'aws');
assert.strictEqual(selectCloud('GCP').baseClass, 'LifeCycleGoogleFunction');
assert.strictEqual(selectCloud('Azure').baseClass, 'LifeCycleAzureFunction');
assert.strictEqual(selectCloud('Native').baseClass, 'LifeCycleActionBase');
const afterDeploy = lca.noteDeploySuccess(createWorkflow({
	state: 'DEPLOYMENT_PENDING',
	phase: 'DEPLOY',
	deploymentApproved: true,
	hook: 'beforeSave',
	cloudProvider: 'aws',
	cloudFunctionIdentifier: 'hcp-beforesave',
}), 'hcp-beforesave');
assert.strictEqual(afterDeploy.phase, 'L3_UPDATE', 'a successful deploy opens the lifecycleActions update');
assert.strictEqual(afterDeploy.l3UpdateApproved, true);
assert.strictEqual(afterDeploy.cloudFunctionIdentifier, 'hcp-beforesave');
assert.strictEqual(lca.cloudRegistration('aws', afterDeploy.cloudFunctionIdentifier), 'Lambda/BinaryJSON/hcp-beforesave');
assert.strictEqual(cloudRegistration('aws', 'hcp-customer-id-generator'), 'Lambda/BinaryJSON/hcp-customer-id-generator');

// Validation-only does not generate
assert.strictEqual(classifyLcaIntent('Validate that NPI is exactly 10 digits.'), 'validation-only');
const dvf = createWorkflow({ intent: 'validation-only', state: 'DESIGN_APPROVED', designApproved: true, objectAttributesConfirmed: true });
assert.strictEqual(gate(dvf, 'generate').allowed, false);

// Direct registration does not generate code
assert.strictEqual(classifyLcaIntent('Add Lambda/BinaryJSON/hcp-before-save to HCP beforeSave.'), 'register');

// Existing LCA: new hook still requires the same gates, then deploy, then L3
assert.strictEqual(classifyLcaIntent('Add afterSave handling to this LCA.'), 'update');
assert.strictEqual(classifyLcaIntent('Update the HCP LCA to add afterSave notification logic.'), 'update');
assert.strictEqual(classifyLcaIntent('Create a beforeSave LCA for HCP that generates CustomerId when missing.'), 'generate');
assert.strictEqual(classifyLcaIntent('How do LCAs work?'), 'advise');
assert.strictEqual(classifyLcaIntent('The team is researching LCA hooks to determine whether LCA is the right mechanism.'), 'advise');
const incomplete = createWorkflow({
	state: 'DESIGN_APPROVED',
	intent: 'generate',
	designApproved: true,
	objectAttributesConfirmed: true,
});
assert.strictEqual(gate(incomplete, 'generate').allowed, false);
let update = createWorkflow({
	state: 'DESIGN_APPROVED',
	intent: 'update',
	designApproved: true,
	objectAttributesConfirmed: true,
	targetType: 'HCP',
	hook: 'afterSave',
	attributesSpecified: true,
	attributesRead: ['FirstName'],
});
assert.strictEqual(gate(update, 'generate').allowed, true);
update = markImplementationGenerated(update);
assert.strictEqual(gate(update, 'deploy').allowed, false);
update = markDeploymentPending(update, false);
assert.strictEqual(gate(update, 'deploy').allowed, false);
update = markDeploymentPending(update, true);
assert.strictEqual(gate(update, 'deploy').allowed, true);
update = markDeployed(update, 'hcp-lca');
assert.strictEqual(gate(update, 'updateL3').allowed, false);
update = markConnectivityConfirmed(update);
assert.strictEqual(classifyLcaIntent('Add Lambda/BinaryJSON/hcp-before-save to HCP beforeSave.'), 'register');
const registration = createWorkflow({ intent: 'register', state: 'DESIGN_APPROVED', designApproved: true, objectAttributesConfirmed: true });
assert.strictEqual(gate(registration, 'generate').allowed, false);
const proposal = proposeLifecycleChange({
	current: hcp.object.lifecycleActions,
	hook: 'afterSave',
	op: 'append',
	action: 'Lambda/BinaryJSON/hcp-lca',
});
assert.strictEqual(proposal.ok, true);
assert.deepStrictEqual(proposal.proposed.beforeSave, ['Lambda/BinaryJSON/existing-action']);
assert.deepStrictEqual(proposal.proposed.afterSave, ['Lambda/BinaryJSON/hcp-lca']);
update = markTenantConfigPending(update, proposal.proposed, false);
assert.strictEqual(gate(update, 'updateL3').allowed, false);
update = markTenantConfigPending(update, proposal.proposed, true);
assert.strictEqual(gate(update, 'updateL3').allowed, true);

// Preserve, duplicate, invalid hook, destructive
const dup = proposeLifecycleChange({
	current: hcp.object.lifecycleActions,
	hook: 'beforeSave',
	op: 'append',
	action: 'Lambda/BinaryJSON/existing-action',
});
assert.strictEqual(dup.duplicate, true);
assert.strictEqual(dup.ok, false);
const removed = proposeLifecycleChange({
	current: hcp.object.lifecycleActions,
	hook: 'beforeSave',
	op: 'remove',
	action: 'Lambda/BinaryJSON/existing-action',
});
assert.strictEqual(removed.destructive, true);
assert.strictEqual(validateHook('entity', 'beforeSave').ok, true);
assert.strictEqual(validateHook('entity', 'BeforeSave').ok, false);
assert.strictEqual(validateHook('changeRequest', 'beforeSave').ok, false);
assert.strictEqual(validateHook('changeRequest', 'afterDCRSave').ok, true);
assert.strictEqual(connectivityRequired('Reltio/DVFAction'), false);
assert.strictEqual(connectivityRequired('Lambda/BinaryJSON/hcp-lca'), true);

const relation = resolveObjectType(model, 'HasAddress', 'relation');
assert.strictEqual(relation.ok, true);
const relationProposal = proposeLifecycleChange({
	current: relation.object.lifecycleActions,
	hook: 'beforeSave',
	op: 'append',
	action: 'Lambda/BinaryJSON/has-address-extra',
});
const updatedRelation = applyLifecycleProposal(
	{ uri: relation.object.uri, label: 'HasAddress', untouched: true, lifecycleActions: relation.object.lifecycleActions },
	relationProposal.proposed,
);
assert.strictEqual(updatedRelation.untouched, true);
assert.deepStrictEqual(updatedRelation.lifecycleActions.beforeSave, [
	'Lambda/BinaryJSON/has-address',
	'Lambda/BinaryJSON/has-address-extra',
]);

const ordered = proposeLifecycleChange({
	current: { beforeSave: ['Lambda/BinaryJSON/first', 'Lambda/BinaryJSON/second'] },
	hook: 'beforeSave',
	kind: 'entity',
	op: 'append',
	action: 'Lambda/BinaryJSON/third',
});
assert.deepStrictEqual(ordered.proposed.beforeSave, [
	'Lambda/BinaryJSON/first',
	'Lambda/BinaryJSON/second',
	'Lambda/BinaryJSON/third',
]);
const badHook = proposeLifecycleChange({
	current: hcp.object.lifecycleActions,
	hook: 'BeforeSave',
	kind: 'entity',
	op: 'append',
	action: 'Lambda/BinaryJSON/hcp-lca',
});
assert.strictEqual(badHook.ok, false);
assert.deepStrictEqual(badHook.proposed.beforeSave, ['Lambda/BinaryJSON/existing-action']);

for (const language of ['Python', 'TypeScript', 'JavaScript', 'Kotlin', 'Groovy', 'C#']) {
	const refused = createWorkflow({
		state: 'DESIGN_APPROVED',
		intent: 'generate',
		designApproved: true,
		objectAttributesConfirmed: true,
		implementationLanguage: language,
	});
	assert.strictEqual(gate(refused, 'generate').allowed, false, language);
	assert.strictEqual(requireJava(language).ok, false);
}
assert.strictEqual(requireJava('Java').ok, true);
assert.strictEqual(createWorkflow().implementationLanguage, 'Java');

// Env keys exist; values are not echoed
const missing = missingEnvKeys('AWS_REGION=\nAWS_SECRET_ACCESS_KEY=super-secret\n', 'aws');
assert.ok(missing.includes('AWS_REGION'));
assert.ok(missing.includes('AWS_PROFILE or AWS_ACCESS_KEY_ID'));
assert.ok(!JSON.stringify(missing).includes('super-secret'));

// Tree: lifecycleActions leaf, read-only, no children, JSON path
const { Uri } = require('./lib/vscode-stub.cjs');
const uri = Uri.file('/tmp/L3.reltio.json');
const roots = getConfigRootChildren(model, uri);
const entityFolder = roots.find(n => n.nodeType === 'entityTypesFolder');
const entities = getConfigNodeChildren(model, entityFolder);
const hcpNode = entities.find(n => n.nodeLabel === 'HCP');
const hcpChildren = getConfigNodeChildren(model, hcpNode);
const lcaNode = hcpChildren.find(n => n.nodeType === 'lifecycleActions');
assert.ok(lcaNode, 'HCP shows lifecycleActions');
assert.strictEqual(lcaNode.collapsibleState, 0);
assert.deepStrictEqual(lcaNode.jsonPath.slice(-1), ['lifecycleActions']);
assert.deepStrictEqual(getConfigNodeChildren(model, lcaNode), []);
assert.strictEqual(lcaNode.contextValue, 'reltio.item.lifecycleActions');
const org = entities.find(n => n.nodeLabel === 'Organization');
const orgChildren = getConfigNodeChildren(model, org);
assert.ok(!orgChildren.some(n => n.nodeType === 'lifecycleActions'));

const relationFolder = roots.find(n => n.nodeType === 'relationTypesFolder');
const relations = getConfigNodeChildren(model, relationFolder);
const hasAddress = relations.find(n => n.nodeLabel === 'HasAddress');
const relChildren = getConfigNodeChildren(model, hasAddress);
assert.ok(relChildren.some(n => n.nodeType === 'lifecycleActions'));

const dcrFolder = roots.find(n => n.nodeType === 'changeRequestTypesFolder');
const dcrs = getConfigNodeChildren(model, dcrFolder);
assert.strictEqual(dcrs[0].collapsibleState, 1);
const dcrChildren = getConfigNodeChildren(model, dcrs[0]);
assert.strictEqual(dcrChildren.length, 1);
assert.strictEqual(dcrChildren[0].nodeType, 'lifecycleActions');

function valueAt(root, path) {
	return path.reduce((cur, seg) => cur?.[seg], root);
}
assert.deepStrictEqual(valueAt(model, lcaNode.jsonPath), model.entityTypes[0].lifecycleActions);

const refreshed = JSON.parse(JSON.stringify(model));
refreshed.entityTypes[0] = applyLifecycleProposal(refreshed.entityTypes[0], {
	beforeSave: ['Lambda/BinaryJSON/existing-action', 'Lambda/BinaryJSON/hcp-customer-id-generator'],
});
const refreshedEntities = getConfigNodeChildren(refreshed, entityFolder);
const refreshedHcp = getConfigNodeChildren(refreshed, refreshedEntities.find(n => n.nodeLabel === 'HCP'));
const refreshedLca = refreshedHcp.find(n => n.nodeType === 'lifecycleActions');
assert.deepStrictEqual(valueAt(refreshed, refreshedLca.jsonPath).beforeSave[1], 'Lambda/BinaryJSON/hcp-customer-id-generator');

const otherTenant = JSON.parse(JSON.stringify(model));
otherTenant.entityTypes[0].lifecycleActions = { beforeSave: ['Lambda/BinaryJSON/tenant-b-only'] };
const otherEntities = getConfigNodeChildren(otherTenant, getConfigRootChildren(otherTenant, uri).find(n => n.nodeType === 'entityTypesFolder'));
const otherHcp = getConfigNodeChildren(otherTenant, otherEntities.find(n => n.nodeLabel === 'HCP'));
const otherLca = otherHcp.find(n => n.nodeType === 'lifecycleActions');
assert.deepStrictEqual(valueAt(otherTenant, otherLca.jsonPath).beforeSave, ['Lambda/BinaryJSON/tenant-b-only']);
assert.deepStrictEqual(valueAt(model, lcaNode.jsonPath).beforeSave, ['Lambda/BinaryJSON/existing-action']);

// Context isolation: directory + tenant
const store = new LcaContextStore();
const projectA = store.open('/projects/customer-a-hcp', 'tenantA');
Object.assign(projectA.context, {
	customerName: 'Customer A',
	targetType: 'HCP',
	targetTypeUri: 'configuration/entityTypes/HCP',
	hooks: ['beforeSave'],
	attributesRead: ['FirstName'],
	cloudProvider: 'aws',
	javaPackage: 'com.reltio.lca.customera.hcp',
	cloudFunctionIdentifier: 'hcp-fn',
	connectivityStatus: 'confirmed',
	deploymentStatus: 'deployed',
	designApproved: true,
	objectAttributesConfirmed: true,
	deploymentApproved: true,
	l3UpdateApproved: true,
	pendingConfigurationPatch: { beforeSave: ['Lambda/BinaryJSON/hcp-fn'] },
});
store.save(projectA.context);

const projectB = store.open('/projects/customer-b-address', 'tenantB');
assert.strictEqual(projectB.created, true);
assert.strictEqual(projectB.context.customerName, undefined);
assert.strictEqual(projectB.context.targetType, undefined);
assert.strictEqual(projectB.context.javaPackage, undefined);
assert.strictEqual(projectB.context.cloudFunctionIdentifier, undefined);
assert.strictEqual(projectB.context.connectivityStatus, 'unknown');
assert.strictEqual(projectB.context.pendingConfigurationPatch, undefined);
assert.strictEqual(projectB.context.designApproved, false);

const sameTenantOtherDir = store.open('/projects/other-hcp', 'tenantA');
assert.strictEqual(sameTenantOtherDir.created, true);
assert.strictEqual(sameTenantOtherDir.context.targetType, undefined);
assert.strictEqual(sameTenantOtherDir.context.customerName, undefined);

const switchedTenant = store.open('/projects/customer-a-hcp', 'tenantB');
assert.strictEqual(switchedTenant.created, true);
assert.strictEqual(switchedTenant.context.tenantId, 'tenantB');
assert.strictEqual(switchedTenant.context.targetType, undefined);
assert.strictEqual(switchedTenant.context.connectivityStatus, 'unknown');
assert.strictEqual(switchedTenant.context.l3UpdateApproved, false);

const returned = store.open('/projects/customer-a-hcp', 'tenantA');
assert.strictEqual(returned.created, false);
assert.strictEqual(returned.context.customerName, 'Customer A');
assert.strictEqual(returned.context.targetType, 'HCP');
assert.strictEqual(returned.context.cloudFunctionIdentifier, 'hcp-fn');

const brandNew = store.open('/projects/brand-new', 'tenantC');
assert.strictEqual(brandNew.context.javaPackage, undefined);
assert.strictEqual(brandNew.context.hooks, undefined);
assert.strictEqual(brandNew.context.designApproved, false);

const changed = beginCodeChange(returned.context.targetType
	? createWorkflow({ ...returned.context, intent: 'update', state: 'COMPLETED', targetType: 'HCP' })
	: createWorkflow());
assert.strictEqual(changed.objectAttributesConfirmed, false);
assert.strictEqual(changed.designApproved, false);
assert.strictEqual(changed.deploymentApproved, false);
assert.strictEqual(gate(changed, 'generate').allowed, false);

const wiped = invalidateTenantScoped({
	...returned.context,
	environment: 'dev',
	implementationLanguage: 'Java',
}, 'tenantB');
assert.strictEqual(wiped.tenantId, 'tenantB');
assert.strictEqual(wiped.environment, undefined);
assert.strictEqual(wiped.customerName, undefined);
assert.strictEqual(wiped.hooks, undefined);
assert.strictEqual(wiped.connectivityStatus, 'unknown');

const fs = require('fs');
const os = require('os');
const path = require('path');
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-b-'));
const diskStore = new LcaContextStore();
const saved = diskStore.open(dirA, 'tenantA', { disk: true });
saved.context.customerName = 'Acme';
saved.context.targetType = 'HCP';
saved.context.hooks = ['beforeSave'];
saved.context.javaPackage = 'com.reltio.lca.acme.hcp';
diskStore.save(saved.context, { disk: true });
const reloaded = new LcaContextStore().open(dirA, 'tenantA', { disk: true });
assert.strictEqual(reloaded.created, false);
assert.strictEqual(reloaded.context.customerName, 'Acme');
assert.strictEqual(reloaded.context.targetType, 'HCP');
const otherTenantDisk = new LcaContextStore().open(dirA, 'tenantB', { disk: true });
assert.strictEqual(otherTenantDisk.context.customerName, undefined);
assert.strictEqual(otherTenantDisk.context.targetType, undefined);
const otherDirDisk = new LcaContextStore().open(dirB, 'tenantA', { disk: true });
assert.strictEqual(otherDirDisk.context.customerName, undefined);
assert.strictEqual(otherDirDisk.context.javaPackage, undefined);
const slashReloaded = new LcaContextStore().open(`${dirA}/`, 'tenantA', { disk: true });
assert.strictEqual(slashReloaded.context.customerName, 'Acme', 'trailing slash reopens the same context');

const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-git-'));
const gitL3 = path.join(gitRoot, 'config', 'BusinessConfig.json');
fs.mkdirSync(path.dirname(gitL3), { recursive: true });
fs.writeFileSync(gitL3, '{}\n');
fs.writeFileSync(path.join(gitRoot, '.reltio-config-source.json'), JSON.stringify({
	sources: [{ l3RelativePath: 'config/BusinessConfig.json', environmentName: 'git-dev', tenantId: 'gitTenant' }],
}));
const lookalikeDir = path.join(gitRoot, 'noise.reltio.tenant');
fs.mkdirSync(lookalikeDir, { recursive: true });
fs.writeFileSync(path.join(lookalikeDir, 'notL3.reltio.json'), '{}\n');
const packDir = path.join(gitRoot, 'resources', 'velocity-packs', 'life');
fs.mkdirSync(packDir, { recursive: true });
fs.writeFileSync(path.join(packDir, 'BusinessConfig.json'), '{}\n');
const discovered = discoverTenantL3(gitRoot);
assert.strictEqual(discovered.length, 1, 'git marker L3 is the only connected config');
assert.strictEqual(discovered[0].tenantId, 'gitTenant');
assert.strictEqual(path.resolve(discovered[0].path), path.resolve(gitL3));
const gitGate = assessTenantConnection({ tenantAware: true, locations: discovered });
assert.strictEqual(gitGate.connected, true);
assert.strictEqual(gitGate.selected.tenantId, 'gitTenant');

const treeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-tree-'));
const envDir = path.join(treeRoot, 'dev');
const tenantDir = path.join(envDir, 'abc123');
const componentL3 = path.join(tenantDir, 'Business Config', 'BusinessConfig.json');
fs.mkdirSync(path.dirname(componentL3), { recursive: true });
fs.writeFileSync(componentL3, '{}\n');
fs.writeFileSync(path.join(envDir, '.reltio-environment.json'), JSON.stringify({ kind: 'environment', host: 'dev.reltio.com' }));
fs.writeFileSync(path.join(tenantDir, '.reltio-config-source.json'), JSON.stringify({
	kind: 'tenant',
	environmentName: 'dev.reltio.com',
	tenantId: 'abc123',
}));
const packNoise = path.join(treeRoot, 'resources', 'velocity-packs', 'life');
fs.mkdirSync(packNoise, { recursive: true });
fs.writeFileSync(path.join(packNoise, 'BusinessConfig.json'), '{}\n');
const treeFound = discoverTenantL3(treeRoot);
assert.strictEqual(treeFound.length, 1, 'component-tree tenant is the only connected config');
assert.strictEqual(treeFound[0].tenantId, 'abc123');
assert.strictEqual(treeFound[0].environment, 'dev.reltio.com');
assert.strictEqual(path.resolve(treeFound[0].path), path.resolve(componentL3));
const treeGate = assessTenantConnection({ tenantAware: true, locations: treeFound });
assert.strictEqual(treeGate.connected, true);
assert.strictEqual(treeGate.selected.tenantId, 'abc123');
assert.strictEqual(isComponentConfigPath(componentL3), true);
assert.strictEqual(isTenantL3Path(componentL3), false);

assert.strictEqual(lca.lcaProjectSlug('HCP', 'beforeSave', 'CustomerId'), 'hcp-beforesave-customerid-lca');
assert.strictEqual(lca.lcaProjectSlug('Has Address', 'beforeSave'), 'has-address-beforesave-lca');
assert.strictEqual(lca.LCA_DIR, 'LifeCycle Actions');
assert.strictEqual(
	lca.lcaProjectDirectory(componentL3, 'HCP', 'beforeSave', 'CustomerId'),
	path.join(tenantDir, 'LifeCycle Actions', 'hcp-beforesave-customerid-lca'),
);
assert.notStrictEqual(
	lca.lcaProjectDirectory(componentL3, 'HCP', 'beforeSave', 'CustomerId'),
	lca.lcaProjectDirectory(componentL3, 'HCP', 'afterSave', 'CustomerId'),
	'same type with a different hook is a different project',
);
assert.notStrictEqual(
	lca.lcaProjectDirectory(componentL3, 'HCP', 'beforeSave', 'CustomerId'),
	lca.lcaProjectDirectory(componentL3, 'HCP', 'beforeSave', 'MiddleName'),
	'same type and hook with a different name is a different project',
);
const insideProject = path.join(tenantDir, 'LifeCycle Actions', 'hcp-beforesave-customerid-lca');
fs.mkdirSync(insideProject, { recursive: true });
const fromProject = discoverTenantL3(insideProject);
assert.strictEqual(fromProject.length, 1, 'a project under LifeCycle Actions still finds the tenant');
assert.strictEqual(fromProject[0].tenantId, 'abc123');
assert.strictEqual(path.resolve(fromProject[0].path), path.resolve(componentL3));
assert.strictEqual(path.resolve(lca.tenantRootFromConfig(gitL3)), path.resolve(gitRoot));

const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-legacy-'));
const legacyTenant = path.join(legacyRoot, 'dev.reltio.environment', 'acme.reltio.tenant');
const legacyL3 = path.join(legacyTenant, 'L3.reltio.json');
fs.mkdirSync(legacyTenant, { recursive: true });
fs.writeFileSync(legacyL3, '{}\n');
assert.strictEqual(path.resolve(lca.tenantRootFromConfig(legacyL3)), path.resolve(legacyTenant));
assert.strictEqual(
	lca.lcaProjectDirectory(legacyL3, 'HCP', 'beforeSave', 'CustomerId'),
	path.join(legacyTenant, 'LifeCycle Actions', 'hcp-beforesave-customerid-lca'),
);
const fromLegacyProject = discoverTenantL3(path.join(legacyTenant, 'LifeCycle Actions', 'hcp-beforesave-customerid-lca'));
assert.strictEqual(fromLegacyProject.length, 1, 'a legacy project under LifeCycle Actions still finds the tenant');
assert.strictEqual(path.resolve(fromLegacyProject[0].path), path.resolve(legacyL3));

const pkg = require('../package.json');
const itemMenus = pkg.contributes.menus['view/item/context'];
for (const command of ['reltio.deleteNode', 'reltio.renameNode']) {
	const entry = itemMenus.find(item => item.command === command);
	assert.match(entry.when, /reltio\.item\.lifecycleActions/);
	assert.match(entry.when, /!=/);
}

const inputs = formatObjectAttributeConfirmation({
	kind: 'entity',
	objectType: 'HCP',
	uri: 'configuration/entityTypes/HCP',
	attributesRead: ['FirstName', 'LastName', 'CustomerId'],
	attributesAddedOrUpdated: ['CustomerId'],
});
assert.match(inputs, /LCA Code Inputs/);
assert.match(inputs, /Should I use these values for the LCA implementation\?/);
const design = formatImplementationDesign({
	workingDirectory: '/projects/acme-hcp-lca',
	tenantLabel: 'Acme DEV',
	kind: 'entity',
	objectType: 'HCP',
	hooks: ['beforeSave'],
	cloud: 'aws',
	attributesRead: ['FirstName'],
	attributesAddedOrUpdated: ['CustomerId'],
	behavior: 'Generate CustomerId when missing before the HCP is saved.',
	javaPackage: 'com.reltio.lca.acme.hcp',
	cloudFunction: 'hcp-customer-id-generator',
	registration: 'HCP → beforeSave → Lambda/BinaryJSON/hcp-customer-id-generator',
});
assert.match(design, /LCA Implementation Design/);
assert.match(design, /Language/);
assert.match(design, /^Java$/m);
assert.ok(!/Should I proceed with Java LCA code generation\?/.test(design), 'design is information, not a second confirmation');
assert.strictEqual(deploymentPrompt('aws'), 'Would you like me to deploy this version to AWS Lambda?');
assert.ok(!design.includes('com.example.lca'));
const preview = formatDeploymentPreview({
	provider: 'aws',
	target: 'lambda:hcp-customer-id-generator',
	configuration: ['AWS_REGION', 'AWS_PROFILE'],
	changes: ['Publish the built artifact'],
});
assert.match(preview, /Target environment/);
assert.match(preview, /Would you like me to deploy/);
assert.ok(!preview.toLowerCase().includes('secret key'));

// Conversation gates. trust:'persisted' is the state saved by the previous step.
const memberQuestion = 'The team is researching LCA hooks to determine whether LCA is the right mechanism for member ID collisions.';
let turn = step(createWorkflow(), memberQuestion, { trust: 'persisted' });
assert.strictEqual(turn.phase, 'ASK', '1 question stays in ASK');
assert.deepStrictEqual(turn.allowedActions, ['answer']);
assert.strictEqual(classifyTurn('What does the beforeSave hook do?'), 'ask');

const invented = extractFacts('Generate LCA code for this requirement', turn.workflow, {
	targetType: 'Member',
	hook: 'beforeSave',
	attributesRead: ['MemberID'],
	attributesUpdated: ['MemberIdCollision'],
});
assert.strictEqual(invented.workflow.targetType, undefined);
assert.strictEqual(invented.workflow.hook, undefined);
assert.ok(!invented.workflow.attributesSpecified);
const roundTrip = workflowFromContext({
	...contextPatchFromWorkflow(turn.workflow),
	workingDirectory: '/tmp/lca',
	implementationLanguage: 'Java',
	connectivityStatus: 'unknown',
	deploymentStatus: 'none',
	objectAttributesConfirmed: false,
	designApproved: false,
	deploymentApproved: false,
	l3UpdateApproved: false,
});
assert.ok(!roundTrip.attributesSpecified, 'an answer turn must not mark attributes as known');
turn = step(invented.workflow, 'Generate LCA code for this requirement', { trust: 'persisted' });
assert.strictEqual(turn.phase, 'REQUIREMENT_GATHERING', '2 missing requirements ask');
assert.ok(turn.questions && turn.questions.length >= 3);
assert.ok(!turn.allowedActions.includes('generate'));

const stated = 'Create a beforeSave LCA for entity type HCP. Read FirstName. Update CustomerId.';
const facts = extractFacts(stated, createWorkflow({ intent: 'generate', state: 'COLLECT_REQUIREMENTS', phase: 'REQUIREMENT_GATHERING' }), {
	targetType: 'HCP',
	hook: 'beforeSave',
	attributesRead: ['FirstName'],
	attributesUpdated: ['CustomerId'],
});
assert.strictEqual(facts.workflow.targetType, 'HCP');
assert.strictEqual(facts.workflow.hook, 'beforeSave');
assert.strictEqual(facts.workflow.attributesSpecified, true);
turn = step(facts.workflow, stated, { trust: 'persisted', l3Model: model });
assert.strictEqual(turn.phase, 'GENERATE', '3 known facts generate without an extra confirmation');
assert.ok(turn.allowedActions.includes('generate'));
assert.strictEqual(turn.writeFiles, true);
assert.strictEqual(turn.persistedPhase, 'DEPLOY_PENDING_APPROVAL');
assert.ok(!turn.allowedActions.includes('deploy'));
assert.ok(!turn.allowedActions.includes('updateL3'));
const explained = step(turn.workflow, 'ok explain the hook first', { trust: 'persisted' });
assert.ok(!explained.allowedActions.includes('generate'), 'a qualified yes is not deploy approval');
assert.notStrictEqual(explained.phase, 'GENERATE');
const generated = turn;

const hostile = step(createWorkflow({
	state: 'DESIGN_APPROVED',
	phase: 'GENERATE',
	designApproved: true,
	objectAttributesConfirmed: true,
	attributesSpecified: true,
	targetType: 'HCP',
	hook: 'beforeSave',
	attributesRead: ['FirstName'],
}), 'Generate LCA code for this requirement', { trust: 'caller' });
assert.ok(!hostile.allowedActions.includes('generate'), 'caller cannot self-approve generation');

turn = step(generated.workflow, 'Deploy this to AWS', { trust: 'persisted' });
assert.strictEqual(turn.phase, 'DEPLOY_PENDING_APPROVAL', '4 deploy asks first');
assert.ok(turn.allowedActions.includes('previewDeploy'));
assert.ok(!turn.allowedActions.includes('deploy'));
const diverted = step(turn.workflow, 'What does the beforeSave hook do?', { trust: 'persisted' });
assert.strictEqual(diverted.phase, 'ASK', '10 a question leaves the deploy gate');
assert.strictEqual(diverted.workflow.deploymentApproved, false);
assert.ok(!diverted.allowedActions.includes('deploy'));
const resumed = step(diverted.workflow, 'yes', { trust: 'persisted' });
assert.ok(!resumed.allowedActions.includes('deploy'), '10 yes after a question does not deploy');

const awsEnv = 'AWS_REGION=us-east-1\nAWS_PROFILE=dev\n';
turn = step(generated.workflow, 'yes, deploy it', { trust: 'persisted' });
assert.strictEqual(turn.phase, 'DEPLOY_PENDING_APPROVAL', 'deploy waits when .env is missing');
assert.ok(!turn.allowedActions.includes('deploy'));
assert.ok(turn.missingCredentials && turn.missingCredentials.length > 0);
turn = step(turn.workflow, 'yes', { trust: 'persisted', envText: awsEnv });
assert.strictEqual(turn.phase, 'DEPLOY', '5 approval deploys with the .env credentials');
assert.ok(turn.allowedActions.includes('deploy'));
assert.ok(turn.allowedActions.includes('updateL3'), 'successful deploy may update L3 in the same turn');
assert.ok(turn.consoleUpdate, 'missing physical configuration is reported, not confirmed');
assert.match(turn.consoleUpdate, /Console/);
const silentPhysical = step(generated.workflow, 'yes', {
	trust: 'persisted',
	envText: awsEnv,
	physicalConfigText: JSON.stringify({
		awsAccountId: '123456789012',
		roleArn: 'arn:aws:iam::123456789012:role/ReltioLcaInvokerRole',
		region: 'us-east-1',
		externalId: 'ext-1',
	}),
});
assert.strictEqual(silentPhysical.consoleUpdate, undefined, 'present physical configuration is not mentioned');
assert.strictEqual(silentPhysical.workflow.connectivityStatus, 'confirmed');
assert.strictEqual(actionSucceeded(undefined), false);
assert.strictEqual(actionSucceeded({ exitCode: 1 }), false);
assert.strictEqual(actionSucceeded({ ok: true }), true);

turn = step(turn.workflow, 'Help me test this', { trust: 'persisted' });
assert.strictEqual(turn.phase, 'TEST', '6 testing guides without claiming success');
assert.ok(turn.allowedActions.includes('test'));
assert.match(turn.message, /Do not claim the test passed/);

turn = step(turn.workflow, 'Update lifecycleActions for this tenant', { trust: 'persisted' });
assert.ok(!turn.allowedActions.includes('previewL3'), '7 L3 does not ask for a connectivity confirmation');
assert.ok(!turn.allowedActions.includes('updateL3'));
assert.match(turn.message, /physical configuration/i);
assert.ok(!/already configured for this tenant\?/.test(turn.message));
turn = step(turn.workflow, 'Connectivity is already confirmed for this tenant', { trust: 'persisted' });
assert.notStrictEqual(turn.workflow.connectivityStatus, 'confirmed', 'a verbal confirmation does not count');
assert.ok(!turn.allowedActions.includes('updateL3'));
const physicalAws = JSON.stringify({
	awsAccountId: '123456789012',
	roleArn: 'arn:aws:iam::123456789012:role/ReltioLcaInvokerRole',
	region: 'us-east-1',
	externalId: 'ext-1',
});
turn = step(generated.workflow, 'Update lifecycleActions for this tenant', {
	trust: 'persisted',
	physicalConfigText: physicalAws,
});
assert.strictEqual(turn.phase, 'L3_UPDATE', '7 physical configuration allows L3 without asking');
assert.ok(turn.allowedActions.includes('updateL3'));
assert.strictEqual(turn.consoleUpdate, undefined);
const earlyYes = step(createWorkflow({
	...turn.workflow,
	connectivityStatus: 'unknown',
	phase: 'L3_PENDING_APPROVAL',
	state: 'TENANT_CONFIG_PENDING',
	l3UpdateApproved: false,
}), 'yes', { trust: 'persisted' });
assert.ok(!earlyYes.allowedActions.includes('updateL3'), 'L3 yes without physical configuration does not apply');

const leaked = 'aws_secret_access_key=AKIAIOSFODNN7EXAMPLE';
turn = step(turn.workflow, leaked, { trust: 'persisted' });
assert.strictEqual(turn.redacted, true, '9 secrets are discarded');
assert.ok(!JSON.stringify(turn).includes('AKIAIOSFODNN7EXAMPLE'));
assert.ok(!JSON.stringify(turn).includes('aws_secret_access_key='));
assert.strictEqual(isDisallowedCredentialPrompt('Please provide your AWS secret key.'), true);
assert.strictEqual(isDisallowedCredentialPrompt(credentialPrompt()), false);
assert.match(credentialPrompt(), /environment variable/i);

const done = createWorkflow({
	state: 'COMPLETED',
	phase: 'COMPLETE',
	intent: 'generate',
	designApproved: true,
	objectAttributesConfirmed: true,
	attributesSpecified: true,
	targetType: 'HCP',
	hook: 'beforeSave',
	attributesRead: ['FirstName'],
	attributesUpdated: ['CustomerId'],
});
const againText = 'Create a beforeSave LCA for entity type Organization. Read Name.';
const again = step(done, againText, {
	trust: 'persisted',
	claimed: { targetType: 'Organization', hook: 'beforeSave', attributesRead: ['Name'] },
});
assert.strictEqual(again.workflow.targetType, 'Organization', 'a new request replaces the stored type');
assert.strictEqual(again.phase, 'GENERATE', 'a new request with known facts moves on');
assert.ok(again.allowedActions.includes('generate'));
assert.strictEqual(again.writeFiles, true);

const nearText = 'Create a beforeSave LCA for entity type CourseTopics. Read Title.';
const near = step(createWorkflow({ intent: 'generate', state: 'COLLECT_REQUIREMENTS', phase: 'REQUIREMENT_GATHERING' }), nearText, {
	trust: 'persisted',
	claimed: { targetType: 'CourseTopics', hook: 'beforeSave', attributesRead: ['Title'] },
	l3Model: model,
});
assert.ok(!near.allowedActions.includes('generate'));
assert.strictEqual(near.workflow.targetType, undefined);
assert.match(near.message, /not an exact match|not in this tenant/i);
assert.ok((near.questions || []).some(q => /Course|HCP|Organization/.test(q)));

const missingAttr = step(createWorkflow({ intent: 'generate', state: 'COLLECT_REQUIREMENTS', phase: 'REQUIREMENT_GATHERING' }), 'Create a beforeSave LCA for entity type HCP. Read NpiNumber.', {
	trust: 'persisted',
	claimed: { targetType: 'HCP', hook: 'beforeSave', attributesRead: ['NpiNumber'] },
	l3Model: model,
});
assert.ok(!missingAttr.allowedActions.includes('generate'));
assert.match(missingAttr.message, /attribute/i);

const offline = step(createWorkflow({ intent: 'generate', state: 'COLLECT_REQUIREMENTS', phase: 'REQUIREMENT_GATHERING' }), stated, {
	trust: 'persisted',
	tenantConnected: false,
});
assert.ok(!offline.allowedActions.includes('generate'));
assert.match(offline.message, /connect/i);

const askedHook = step(createWorkflow(), 'What does the beforeSave hook do?', { trust: 'persisted' });
assert.strictEqual(askedHook.phase, 'ASK');
assert.strictEqual(askedHook.workflow.hook, undefined, 'a question does not select a hook');
const afterQuestion = step(askedHook.workflow, 'Generate an LCA for entity type HCP.', {
	trust: 'persisted',
	claimed: { targetType: 'HCP' },
});
assert.strictEqual(afterQuestion.workflow.hook, undefined);
assert.ok((afterQuestion.questions || []).some(q => /hook/i.test(q)));

const pendingDesign = createWorkflow({
	state: 'DESIGN_PENDING_APPROVAL',
	phase: 'REQUIREMENT_GATHERING',
	intent: 'generate',
	objectAttributesConfirmed: true,
	designApproved: false,
	attributesSpecified: true,
	targetType: 'HCP',
	targetKind: 'entity',
	hook: 'beforeSave',
	attributesRead: ['FirstName'],
	attributesAdded: ['CustomerId'],
	attributesUpdated: ['LastName'],
});
const storedRoles = workflowFromContext({
	...contextPatchFromWorkflow(pendingDesign),
	workingDirectory: '/tmp/lca',
	implementationLanguage: 'Java',
	connectivityStatus: 'unknown',
	deploymentStatus: 'none',
	objectAttributesConfirmed: true,
	designApproved: false,
	deploymentApproved: false,
	l3UpdateApproved: false,
});
assert.deepStrictEqual(storedRoles.attributesAdded, ['CustomerId'], 'added attributes stay added');
assert.deepStrictEqual(storedRoles.attributesUpdated, ['LastName'], 'updated attributes stay updated');

assert.strictEqual(classifyTurn('How do I test this beforeSave hook?'), 'ask');
const askedDuringDesign = step(pendingDesign, 'How do I test this beforeSave hook?', { trust: 'persisted' });
assert.strictEqual(askedDuringDesign.phase, 'ASK');
assert.deepStrictEqual(askedDuringDesign.allowedActions, ['answer']);
assert.strictEqual(askedDuringDesign.workflow.state, 'DESIGN_PENDING_APPROVAL');
assert.strictEqual(askedDuringDesign.persistedPhase, 'REQUIREMENT_GATHERING');
const designYes = step(askedDuringDesign.workflow, 'yes', { trust: 'persisted' });
assert.strictEqual(designYes.phase, 'GENERATE', 'a question does not clear design approval');
assert.ok(designYes.allowedActions.includes('generate'));

const qualifiedDeploy = step(createWorkflow({
	...generated.workflow,
	phase: 'DEPLOY_PENDING_APPROVAL',
	state: 'DEPLOYMENT_PENDING',
	deploymentApproved: false,
}), 'ok deploy to production instead', { trust: 'persisted' });
assert.ok(!qualifiedDeploy.allowedActions.includes('deploy'), 'a qualified yes does not approve deploy');
assert.ok(qualifiedDeploy.allowedActions.includes('previewDeploy'));

const nativeL3 = gate(createWorkflow({
	intent: 'register',
	state: 'TENANT_CONFIG_PENDING',
	phase: 'L3_UPDATE',
	l3UpdateApproved: true,
	cloudProvider: 'native',
	connectivityStatus: 'unknown',
	targetType: 'HCP',
	hook: 'beforeSave',
	attributesSpecified: true,
}), 'updateL3');
assert.strictEqual(nativeL3.allowed, true, 'native LCA does not wait on cloud connectivity');

const placeholderEnv = missingEnvKeys('AWS_REGION=us-east-1\nAWS_PROFILE=your-profile\n', 'aws');
assert.ok(placeholderEnv.includes('AWS_PROFILE or AWS_ACCESS_KEY_ID'), 'sample profile values are not credentials');
const filledEnv = missingEnvKeys('AWS_REGION=us-east-1\nAWS_PROFILE=dev\n', 'aws');
assert.deepStrictEqual(filledEnv, []);
const temporary = missingEnvKeys('AWS_REGION=us-east-1\nAWS_ACCESS_KEY_ID=ASIA0000000000000000\nAWS_SECRET_ACCESS_KEY=secret\n', 'aws');
assert.ok(temporary.includes('AWS_SESSION_TOKEN'));
assert.ok(!JSON.stringify(temporary).includes('ASIA0000000000000000'));

const expired = lca.deployFailureGuidance('ExpiredToken: The security token included in the request is expired. aws_secret_access_key=AKIAIOSFODNN7EXAMPLE');
assert.match(expired.nextAction, /expired/i);
assert.match(expired.nextAction, /\.env/);
assert.ok(!expired.error.includes('AKIAIOSFODNN7EXAMPLE'));
const denied = lca.deployFailureGuidance('AccessDeniedException: User is not authorized to perform lambda:UpdateFunctionCode');
assert.match(denied.nextAction, /permission/i);

const { assessPhysicalAccess } = lca;
const gcpMissing = assessPhysicalAccess('{"projectId":"demo"}', 'gcp');
assert.strictEqual(gcpMissing.present, false);
assert.match(gcpMissing.consoleUpdate, /service account/i);
const gcpReady = assessPhysicalAccess('{"projectId":"demo","serviceAccountEmail":"reltio@demo.iam.gserviceaccount.com"}', 'gcp');
assert.strictEqual(gcpReady.present, true);
assert.strictEqual(gcpReady.consoleUpdate, undefined);

// ===========================================================================
// Regression rows from docs/test-proposals/lca.json
// ===========================================================================

// LCA-003 #1: tenantRootFromConfig
{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-root-'));
	const tenant = path.join(root, 'acme');
	assert.strictEqual(
		path.resolve(lca.tenantRootFromConfig(path.join(tenant, 'Business Config', 'BusinessConfig.json'))),
		path.resolve(tenant),
		'LCA-003 #1: Business Config/BusinessConfig.json gives the tenant folder',
	);
	assert.strictEqual(
		path.resolve(lca.tenantRootFromConfig(path.join(tenant, 'L3.reltio.json'))),
		path.resolve(tenant),
		'LCA-003 #1: L3.reltio.json gives its folder',
	);
	const markerRoot = path.join(root, 'repo');
	const sevenDeep = path.join(markerRoot, 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7');
	fs.mkdirSync(sevenDeep, { recursive: true });
	fs.writeFileSync(path.join(markerRoot, '.reltio-config-source.json'), '{}');
	assert.strictEqual(
		path.resolve(lca.tenantRootFromConfig(path.join(sevenDeep, 'conf.json'))),
		path.resolve(markerRoot),
		'LCA-003 #1: marker directory found within 8 levels',
	);
	const nineDeep = path.join(sevenDeep, 'a8');
	fs.mkdirSync(nineDeep, { recursive: true });
	assert.strictEqual(
		path.resolve(lca.tenantRootFromConfig(path.join(nineDeep, 'conf.json'))),
		path.resolve(nineDeep),
		'LCA-003 #1: marker beyond 8 levels is not used; file dirname returned',
	);
	const plain = path.join(root, 'plain', 'x');
	fs.mkdirSync(plain, { recursive: true });
	assert.strictEqual(
		path.resolve(lca.tenantRootFromConfig(path.join(plain, 'conf.json'))),
		path.resolve(plain),
		'LCA-003 #1: no marker gives the file dirname',
	);
}

// LCA-003 #2: validateHook and hooksForKind
{
	const { hooksForKind } = lca;
	assert.strictEqual(validateHook('entity', 'validate').ok, true, 'LCA-003 #2: entity validate ok');
	const relValidate = validateHook('relation', 'validate');
	assert.strictEqual(relValidate.ok, false, 'LCA-003 #2: relation validate refused');
	assert.match(relValidate.message, /not a supported relation hook/, 'LCA-003 #2: relation validate message');
	assert.strictEqual(validateHook('relation', 'beforeSave').ok, true, 'LCA-003 #2: relation beforeSave ok');
	assert.strictEqual(validateHook('changeRequest', 'afterDCRSave').ok, true, 'LCA-003 #2: DCR afterDCRSave ok');
	const dcrBefore = validateHook('changeRequest', 'beforeSave');
	assert.strictEqual(dcrBefore.ok, false, 'LCA-003 #2: DCR beforeSave refused');
	assert.match(dcrBefore.message, /only support afterDCRSave/, 'LCA-003 #2: DCR message');
	for (const hook of ['beforesave', 'bogus']) {
		const r = validateHook('entity', hook);
		assert.strictEqual(r.ok, false, `LCA-003 #2: ${hook} refused`);
		assert.match(r.message, /case-sensitive/, `LCA-003 #2: ${hook} message mentions case-sensitive`);
	}
	assert.strictEqual(validateHook('entity', 'afterDCRSave').ok, false, 'LCA-003 #2: entity afterDCRSave refused');
	assert.ok(hooksForKind('entity').includes('validate'), 'LCA-003 #2: entity list has validate');
	assert.ok(hooksForKind('relation').includes('beforeSave'), 'LCA-003 #2: relation list has beforeSave');
	assert.ok(!hooksForKind('relation').includes('validate'), 'LCA-003 #2: relation list excludes validate');
	assert.deepStrictEqual([...hooksForKind('changeRequest')], ['afterDCRSave'], 'LCA-003 #2: DCR list is afterDCRSave only');
}

// LCA-003 #3: proposeLifecycleChange ops
{
	const current = {
		beforeSave: ['Lambda/BinaryJSON/a', { actions: ['Lambda/BinaryJSON/b', 'Lambda/BinaryJSON/c'], filter: 'equals(type,1)' }],
		afterSave: ['Lambda/BinaryJSON/only'],
	};
	const snapshot = JSON.stringify(current);
	const propose = input => proposeLifecycleChange({ current, kind: 'entity', ...input });

	const add = propose({ hook: 'beforeSave', op: 'add', action: 'Lambda/BinaryJSON/new' });
	assert.strictEqual(add.ok, true, 'LCA-003 #3: add ok');
	assert.deepStrictEqual(add.proposed.beforeSave[2], 'Lambda/BinaryJSON/new', 'LCA-003 #3: add appends');
	const filtered = propose({ hook: 'afterSave', op: 'filter', action: 'Lambda/BinaryJSON/f', filter: 'exists(attributes.X)' });
	assert.strictEqual(filtered.ok, true, 'LCA-003 #3: filter ok');
	assert.deepStrictEqual(filtered.proposed.afterSave[1], { actions: ['Lambda/BinaryJSON/f'], filter: 'exists(attributes.X)' }, 'LCA-003 #3: filter entry shape');
	const dupInFilter = propose({ hook: 'beforeSave', op: 'add', action: 'Lambda/BinaryJSON/b' });
	assert.strictEqual(dupInFilter.ok, false, 'LCA-003 #3: duplicate add (inside filter entry) refused');
	assert.strictEqual(dupInFilter.duplicate, true, 'LCA-003 #3: duplicate flagged');
	assert.deepStrictEqual(dupInFilter.proposed, current, 'LCA-003 #3: duplicate proposed equals current');

	const removeString = propose({ hook: 'beforeSave', op: 'remove', action: 'Lambda/BinaryJSON/a' });
	assert.strictEqual(removeString.ok, true, 'LCA-003 #3: remove string ok');
	assert.deepStrictEqual(removeString.proposed.beforeSave, [current.beforeSave[1]], 'LCA-003 #3: string entry removed');
	const removeInner = propose({ hook: 'beforeSave', op: 'remove', action: 'Lambda/BinaryJSON/b' });
	assert.strictEqual(removeInner.ok, true, 'LCA-003 #3: remove inside {actions, filter} ok');
	assert.deepStrictEqual(
		removeInner.proposed.beforeSave,
		['Lambda/BinaryJSON/a', { actions: ['Lambda/BinaryJSON/c'], filter: 'equals(type,1)' }],
		'LCA-003 #3: inner action removed, filter kept',
	);
	const removeLast = propose({ hook: 'afterSave', op: 'remove', action: 'Lambda/BinaryJSON/only' });
	assert.strictEqual(removeLast.ok, true, 'LCA-003 #3: remove last ok');
	assert.ok(!('afterSave' in removeLast.proposed), 'LCA-003 #3: removing the last entry deletes the hook key');
	assert.strictEqual(removeLast.destructive, true, 'LCA-003 #3: remove is destructive');
	const removeMissing = propose({ hook: 'beforeSave', op: 'remove', action: 'Lambda/BinaryJSON/none' });
	assert.strictEqual(removeMissing.ok, false, 'LCA-003 #3: remove missing refused');
	assert.deepStrictEqual(removeMissing.proposed, current, 'LCA-003 #3: remove missing proposed equals current');

	const replaced = propose({ hook: 'beforeSave', op: 'replace', replacement: ['Lambda/BinaryJSON/z'] });
	assert.strictEqual(replaced.ok, true, 'LCA-003 #3: replace ok');
	assert.strictEqual(replaced.destructive, true, 'LCA-003 #3: replace is destructive');
	assert.deepStrictEqual(replaced.proposed.beforeSave, ['Lambda/BinaryJSON/z'], 'LCA-003 #3: replace sets the list');

	const noAction = propose({ hook: 'beforeSave', op: 'add' });
	assert.strictEqual(noAction.ok, false, 'LCA-003 #3: add with no action refused');
	assert.match(noAction.message, /incomplete/, 'LCA-003 #3: add with no action reports incomplete');
	assert.deepStrictEqual(noAction.proposed, current, 'LCA-003 #3: incomplete proposed equals current');

	assert.strictEqual(JSON.stringify(current), snapshot, 'LCA-003 #3: input never mutated');
}

// LCA-003 #4: isTenantL3Path and isComponentConfigPath
{
	const tenantL3 = [
		['/ws/samples/dev.reltio.environment/t1.reltio.tenant/L3.reltio.json', false, 'samples'],
		['/ws/resources/velocity-packs/t1.reltio.tenant/L3.reltio.json', false, 'velocity-packs'],
		['/ws/dev.reltio.environment/t1.reltio.tenantx/L3.reltio.json', false, 'lookalike tenant folder'],
		['/ws/dev.reltio.environment/t1.reltio.tenant/L3.reltio.json.bak', false, 'lookalike file name'],
		['C:\\ws\\dev.reltio.environment\\t1.reltio.tenant\\L3.reltio.json', true, 'backslash path'],
		['C:\\ws\\samples\\t1.reltio.tenant\\L3.reltio.json', false, 'backslash samples path'],
		['/ws/dev.reltio.environment/t1.reltio.tenant/L3.reltio.json', true, 'valid legacy layout'],
	];
	for (const [p, want, label] of tenantL3) {
		assert.strictEqual(isTenantL3Path(p), want, `LCA-003 #4: isTenantL3Path ${label}`);
	}
	const component = [
		['/ws/samples/dev/t1/Business Config/BusinessConfig.json', false, 'samples'],
		['/ws/resources/velocity-packs/life/Business Config/BusinessConfig.json', false, 'velocity-packs'],
		['/ws/dev/t1/Business Configs/BusinessConfig.json', false, 'lookalike folder'],
		['/ws/dev/t1/MyBusiness Config/BusinessConfig.json', false, 'lookalike prefix folder'],
		['C:\\ws\\dev\\t1\\Business Config\\BusinessConfig.json', true, 'backslash path'],
		['C:\\ws\\velocity-packs\\life\\Business Config\\BusinessConfig.json', false, 'backslash pack path'],
		['/ws/dev/t1/Business Config/BusinessConfig.json', true, 'valid component layout'],
	];
	for (const [p, want, label] of component) {
		assert.strictEqual(isComponentConfigPath(p), want, `LCA-003 #4: isComponentConfigPath ${label}`);
	}
}

// LCA-005 #1: isExplicitApproval and classifyTurn
{
	const { isExplicitApproval } = lca;
	assert.strictEqual(isExplicitApproval('yes'), true, 'LCA-005 #1: plain yes is approval');
	assert.strictEqual(isExplicitApproval('Proceed'), true, 'LCA-005 #1: plain proceed is approval');
	for (const text of ['yes but wait', 'yes?', 'ok deploy it', 'yes update L3', 'What does beforeSave do?', 'Generate an LCA for HCP beforeSave']) {
		assert.strictEqual(isExplicitApproval(text), false, `LCA-005 #1: "${text}" is not approval`);
	}
	assert.strictEqual(classifyTurn('yes'), 'approve', 'LCA-005 #1: yes classifies as approve');
	for (const text of ['yes but wait', 'yes?', 'ok deploy it', 'yes update L3']) {
		assert.notStrictEqual(classifyTurn(text), 'approve', `LCA-005 #1: "${text}" does not classify as approve`);
	}
	assert.strictEqual(classifyTurn('What does beforeSave do?'), 'ask', 'LCA-005 #1: question classifies as ask');
	assert.strictEqual(classifyTurn('Generate an LCA for HCP beforeSave'), 'generate', 'LCA-005 #1: generate request');
	assert.strictEqual(classifyTurn('ok deploy it'), 'deploy', 'LCA-005 #1: deploy request');
}

// LCA-005 #2: ordered gates
{
	const ready = {
		intent: 'generate',
		targetType: 'HCP',
		hook: 'beforeSave',
		attributesRead: ['FirstName'],
	};
	const vo = createWorkflow({ ...ready, intent: 'validation-only', state: 'DESIGN_APPROVED', designApproved: true, objectAttributesConfirmed: true });
	for (const g of ['generate', 'deploy', 'updateL3']) {
		const r = gate(vo, g);
		assert.strictEqual(r.allowed, false, `LCA-005 #2: validation-only ${g} closed`);
		assert.match(r.message, /DVF/, `LCA-005 #2: validation-only ${g} names DVF`);
	}
	const reg = createWorkflow({ ...ready, intent: 'register', state: 'DESIGN_APPROVED', designApproved: true, objectAttributesConfirmed: true });
	for (const g of ['generate', 'deploy']) {
		const r = gate(reg, g);
		assert.strictEqual(r.allowed, false, `LCA-005 #2: register ${g} closed`);
		assert.match(r.message, /Direct registration/, `LCA-005 #2: register ${g} message`);
	}
	const gaps = gate(createWorkflow({ intent: 'generate', state: 'DESIGN_APPROVED', designApproved: true, objectAttributesConfirmed: true }), 'generate');
	assert.strictEqual(gaps.allowed, false, 'LCA-005 #2: missing requirements closed');
	assert.match(gaps.message, /Missing targetType, hook, attributes/, 'LCA-005 #2: message names each missing requirement');

	let wf = createWorkflow({ ...ready, state: 'OBJECT_ATTRIBUTES_PENDING_CONFIRMATION' });
	let r = gate(wf, 'generate');
	assert.strictEqual(r.allowed, false, 'LCA-005 #2: unconfirmed attributes closed');
	assert.match(r.message, /Confirm the object type and attributes/, 'LCA-005 #2: unconfirmed attributes message');
	wf = markDesignPending(markObjectAttributesConfirmed(wf));
	r = gate(wf, 'generate');
	assert.strictEqual(r.allowed, false, 'LCA-005 #2: unapproved design closed');
	assert.match(r.message, /design/i, 'LCA-005 #2: unapproved design message');
	wf = markDesignApproved(wf);
	const kotlin = gate({ ...wf, implementationLanguage: 'Kotlin' }, 'generate');
	assert.strictEqual(kotlin.allowed, false, 'LCA-005 #2: non-Java closed');
	assert.match(kotlin.message, /must be Java/, 'LCA-005 #2: non-Java message');
	assert.strictEqual(gate(wf, 'generate').allowed, true, 'LCA-005 #2: generate opens after design approval');

	wf = markImplementationGenerated(wf);
	r = gate(wf, 'deploy');
	assert.strictEqual(r.allowed, false, 'LCA-005 #2: deploy closed before DEPLOYMENT_PENDING');
	assert.match(r.message, /explicit approval/, 'LCA-005 #2: deploy message');
	assert.strictEqual(gate({ ...wf, deploymentApproved: true }, 'deploy').allowed, false, 'LCA-005 #2: approval without DEPLOYMENT_PENDING closed');
	assert.strictEqual(gate(markDeploymentPending(wf, false), 'deploy').allowed, false, 'LCA-005 #2: DEPLOYMENT_PENDING without approval closed');
	wf = markDeploymentPending(wf, true);
	assert.strictEqual(gate(wf, 'deploy').allowed, true, 'LCA-005 #2: deploy opens with DEPLOYMENT_PENDING plus approval');

	wf = markDeployed(wf, 'hcp-fn');
	const approvedNoConn = markTenantConfigPending(wf, { beforeSave: ['Lambda/BinaryJSON/hcp-fn'] }, true);
	r = gate(approvedNoConn, 'updateL3');
	assert.strictEqual(r.allowed, false, 'LCA-005 #2: updateL3 closed without connectivity even when approved');
	assert.match(r.message, /connectivity/i, 'LCA-005 #2: updateL3 message names connectivity');
	wf = markConnectivityConfirmed(wf);
	r = gate(wf, 'updateL3');
	assert.strictEqual(r.allowed, false, 'LCA-005 #2: updateL3 closed before the diff is approved');
	assert.match(r.message, /lifecycleActions diff/, 'LCA-005 #2: updateL3 message names the diff');
	assert.strictEqual(gate(markTenantConfigPending(wf, {}, false), 'updateL3').allowed, false, 'LCA-005 #2: unapproved diff closed');
	assert.strictEqual(gate(markTenantConfigPending(wf, {}, true), 'updateL3').allowed, true, 'LCA-005 #2: updateL3 opens after connectivity and approval');
}

// LCA-006 #1: lookup misses
{
	const filler = Array.from({ length: 30 }, (_, i) => ({ uri: `configuration/entityTypes/Filler${String(i).padStart(2, '0')}`, label: `Filler${i}` }));
	const lookupModel = {
		entityTypes: [
			...filler,
			{ uri: 'configuration/entityTypes/HCP', label: 'Health Care Provider', attributes: [
				{ name: 'Address', uri: 'configuration/entityTypes/HCP/attributes/Address', attributes: [
					{ name: 'City', uri: 'configuration/entityTypes/HCP/attributes/Address/attributes/City' },
				] },
			] },
			{ uri: 'configuration/entityTypes/Course', label: 'Course' },
			{ uri: 'configuration/entityTypes/Shared', label: 'Shared' },
		],
		relationTypes: [
			{ uri: 'configuration/relationTypes/Topics', label: 'Topics' },
			{ uri: 'configuration/relationTypes/Shared', label: 'Shared' },
		],
	};
	const near = resolveObjectType(lookupModel, 'CourseTopics');
	assert.strictEqual(near.ok, false, 'LCA-006 #1: near miss not resolved');
	assert.ok(near.suggestions.length <= 25, `LCA-006 #1: at most 25 suggestions, got ${near.suggestions.length}`);
	assert.strictEqual(near.suggestions.length, 25, 'LCA-006 #1: suggestions are capped at 25');
	assert.match(near.suggestions[0], /Course/, 'LCA-006 #1: near matches first (Course)');
	assert.match(near.suggestions[1], /Topics/, 'LCA-006 #1: near matches first (Topics)');
	const lower = resolveObjectType(lookupModel, 'hcp');
	assert.strictEqual(lower.ok, true, 'LCA-006 #1: wrong case resolves');
	assert.strictEqual(lower.object.uri, 'configuration/entityTypes/HCP', 'LCA-006 #1: wrong case resolves HCP');
	const byLabel = resolveObjectType(lookupModel, 'health care provider');
	assert.strictEqual(byLabel.ok, true, 'LCA-006 #1: label match (case-insensitive) resolves');
	const ambiguous = resolveObjectType(lookupModel, 'Shared');
	assert.strictEqual(ambiguous.ok, false, 'LCA-006 #1: name in two collections is ambiguous');
	assert.deepStrictEqual(
		[...ambiguous.suggestions].sort(),
		['configuration/entityTypes/Shared', 'configuration/relationTypes/Shared'],
		'LCA-006 #1: ambiguous lists the URIs',
	);
	const filteredKind = resolveObjectType(lookupModel, 'Shared', 'relation');
	assert.strictEqual(filteredKind.ok, true, 'LCA-006 #1: kind filter resolves');
	assert.strictEqual(filteredKind.object.kind, 'relation', 'LCA-006 #1: kind filter picks the relation');

	const nested = resolveAttributes(lower.object, ['Address.City']);
	assert.strictEqual(nested.ok, true, 'LCA-006 #1: nested path resolves');
	assert.deepStrictEqual(nested.attributes[0].path, ['Address', 'City'], 'LCA-006 #1: nested attribute path');
	const missingAttrs = resolveAttributes(lower.object, ['City', 'NopeOne', 'NopeTwo']);
	assert.strictEqual(missingAttrs.ok, false, 'LCA-006 #1: missing attribute fails');
	assert.match(missingAttrs.message, /NopeOne, NopeTwo/, 'LCA-006 #1: all missing attributes named');
	assert.ok(!/City,/.test(missingAttrs.message), 'LCA-006 #1: found attribute not reported missing');
}

// LCA-006 #2: assessPhysicalAccess
{
	const awsFull = { awsAccountId: '123456789012', roleArn: 'arn:aws:iam::123456789012:role/R', region: 'us-east-1', externalId: 'ext-secret-77' };
	const check = (obj, provider, want, label) => {
		const text = typeof obj === 'string' || obj === undefined ? obj : JSON.stringify(obj);
		const r = assessPhysicalAccess(text, provider);
		assert.strictEqual(r.present, want, `LCA-006 #2: ${label}`);
		if (want) {
			assert.strictEqual(r.consoleUpdate, undefined, `LCA-006 #2: ${label} has no console update`);
		} else {
			assert.ok(typeof r.consoleUpdate === 'string' && r.consoleUpdate.length > 0, `LCA-006 #2: ${label} gives a console-update instruction`);
		}
		const out = JSON.stringify(r);
		for (const value of ['123456789012', 'ext-secret-77', 'client-abc-99', 'demo-proj-42', 'tenant-guid-55']) {
			assert.ok(!out.includes(value), `LCA-006 #2: ${label} output never includes config values`);
		}
		return r;
	};
	check(awsFull, 'aws', true, 'aws complete');
	check({ ...awsFull, awsAccountId: '12345678901' }, 'aws', false, 'aws 11-digit account');
	check({ ...awsFull, roleArn: 'role/R' }, 'aws', false, 'aws role without arn');
	check({ ...awsFull, region: 'useast1' }, 'aws', false, 'aws bad region');
	check({ awsAccountId: awsFull.awsAccountId, roleArn: awsFull.roleArn, region: awsFull.region }, 'aws', false, 'aws missing externalId');
	check({ lca: { aws: awsFull } }, 'aws', true, 'aws nested fields');
	check({ projectId: 'demo-proj-42', serviceAccountEmail: 'sa@demo-proj-42.iam.gserviceaccount.com' }, 'gcp', true, 'gcp complete');
	check({ projectId: 'your-project', serviceAccountEmail: 'sa@x.iam.gserviceaccount.com' }, 'gcp', false, 'gcp placeholder project');
	check({ customerTenantId: 'tenant-guid-55', customerFunctionAppId: 'app-guid' }, 'azure', true, 'azure entra form');
	check({ tokenUrl: 'https://login.example.com/token', clientId: 'client-abc-99' }, 'azure', true, 'azure oauth form');
	check({ tokenUrl: 'http://login.example.com/token', clientId: 'client-abc-99' }, 'azure', false, 'azure oauth form without https');
	check({ customerTenantId: 'tenant-guid-55' }, 'azure', false, 'azure entra form incomplete');
	const undef = check(undefined, 'aws', false, 'undefined text');
	assert.match(undef.consoleUpdate, /Console/, 'LCA-006 #2: aws instruction points at the Console');
	check('{not json', 'gcp', false, 'invalid JSON');
}

// LCA-009 #1: package name guards
{
	const evil = buildJavaPackage({ customerName: '../Evil; Corp', typeName: 'HCP' });
	assert.strictEqual(evil, 'com.reltio.lca.evilcorp.hcp', 'LCA-009 #1: customer name stripped to [a-z0-9]');
	assert.strictEqual(buildJavaPackage({ customerName: 'Acme', typeName: 'class' }), 'com.reltio.lca.acme.nclass', 'LCA-009 #1: keyword gets n prefix');
	assert.strictEqual(buildJavaPackage({ customerName: 'Acme', typeName: '9Type' }), 'com.reltio.lca.acme.n9type', 'LCA-009 #1: leading digit gets n prefix');
	assert.strictEqual(buildJavaPackage({ customerName: 'Acme', typeName: '' }), 'com.reltio.lca.acme.lca', 'LCA-009 #1: empty segment becomes lca');
	for (const pkgName of [evil, buildJavaPackage({ customerName: '..//\\x', typeName: '../..' })]) {
		for (const seg of pkgName.split('.')) {
			assert.match(seg, /^[a-z][a-z0-9]*$/, `LCA-009 #1: segment "${seg}" is [a-z0-9]`);
		}
	}
	assert.throws(() => buildJavaPackage({ customerName: '   ', tenantId: '  ', typeName: 'HCP' }), /customer name or tenant id/, 'LCA-009 #1: blank owner throws');
	assert.strictEqual(isForbiddenGenericPackage('com.example.x'), true, 'LCA-009 #1: com.example.* flagged');
}

// LCA-009 #2: slug and project directory
{
	const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-slug-'));
	const config = path.join(tenantRoot, 'Business Config', 'BusinessConfig.json');
	const lcaRoot = path.join(tenantRoot, 'LifeCycle Actions');
	const cases = [
		['../../etc', 'beforeSave', undefined],
		['a/b', 'afterSave', '..'],
		['a\\b\\..\\c', 'beforeSave', 'x\\..\\y'],
		['  ', '  ', '  '],
	];
	for (const [type, hook, name] of cases) {
		const slug = lca.lcaProjectSlug(type, hook, name);
		assert.match(slug, /^[a-z0-9-]+$/, `LCA-009 #2: slug "${slug}" is [a-z0-9-]`);
		assert.ok(!slug.includes('..'), `LCA-009 #2: slug "${slug}" has no ..`);
		assert.ok(slug.endsWith('lca'), `LCA-009 #2: slug "${slug}" ends with lca`);
		const dir = lca.lcaProjectDirectory(config, type, hook, name);
		assert.strictEqual(path.dirname(dir), lcaRoot, `LCA-009 #2: ${slug} directory is directly under LifeCycle Actions`);
	}
	assert.strictEqual(lca.lcaProjectSlug('../../etc', 'beforeSave'), 'etc-beforesave-lca', 'LCA-009 #2: traversal slug ends -lca');
	assert.strictEqual(lca.lcaProjectSlug('  ', '  ', '  '), 'lca', 'LCA-009 #2: all-blank parts give lca');
}

// LCA-009 #3: locationsFromGitMarker
{
	const { locationsFromGitMarker } = lca;
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-marker-'));
	const repo = path.join(base, 'repo');
	const write = (p, text = '{}') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
	write(path.join(base, 'outside', 'BusinessConfig.json'));
	write(path.join(base, 'abs', 'L3.reltio.json'));
	write(path.join(repo, 'samples', 'BusinessConfig.json'));
	write(path.join(repo, 'config', 'other.json'));
	write(path.join(repo, 'config', 'BusinessConfig.json'));
	const marker = path.join(repo, '.reltio-config-source.json');
	write(marker, JSON.stringify({
		sources: [
			{ l3RelativePath: '../outside/BusinessConfig.json', tenantId: 't1' },
			{ l3RelativePath: path.join(base, 'abs', 'L3.reltio.json'), tenantId: 't2' },
			{ l3RelativePath: 'samples/BusinessConfig.json', tenantId: 't3' },
			{ l3RelativePath: 'config/other.json', tenantId: 't4' },
			{ l3RelativePath: 'config/BusinessConfig.json', tenantId: 'good', environmentName: 'dev' },
		],
	}));
	const found = locationsFromGitMarker(marker);
	assert.deepStrictEqual(found.map(f => f.tenantId), ['good'], 'LCA-009 #3: only the valid in-directory file returned');
	assert.strictEqual(path.resolve(found[0].path), path.resolve(repo, 'config', 'BusinessConfig.json'), 'LCA-009 #3: valid path');
	write(marker, '{ invalid');
	assert.deepStrictEqual(locationsFromGitMarker(marker), [], 'LCA-009 #3: invalid JSON marker returns []');
}

// LCA-009 #4: projectContextFile and LcaContextStore
{
	const { projectContextFile, readProjectContext, writeProjectContext, emptyProjectContext } = lca;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-ctxfile-'));
	const ctxDir = path.resolve(dir, '.reltio', 'lca-context');
	for (const tenantId of ['../../evil', 'a b/c\\d', 'x:y*z']) {
		const file = projectContextFile(dir, tenantId);
		assert.strictEqual(path.resolve(path.dirname(file)), ctxDir, `LCA-009 #4: "${tenantId}" stays under <dir>/.reltio/lca-context`);
		assert.match(path.basename(file), /^[a-zA-Z0-9._-]+\.json$/, `LCA-009 #4: "${tenantId}" name sanitized`);
	}
	assert.strictEqual(path.basename(projectContextFile(dir, 'a b/c\\d')), 'a_b_c_d.json', 'LCA-009 #4: slashes and spaces become _');

	const ctx = { ...emptyProjectContext(dir, '../../evil'), customerName: 'Evil Co' };
	writeProjectContext(ctx);
	assert.ok(fs.existsSync(projectContextFile(dir, '../../evil')), 'LCA-009 #4: written inside the context folder');
	assert.ok(!fs.existsSync(path.join(dir, '..', '..', 'evil.json')), 'LCA-009 #4: nothing written outside');
	assert.strictEqual(readProjectContext(dir, '../../evil').customerName, 'Evil Co', 'LCA-009 #4: read back');
	const reopened = new LcaContextStore().open(dir, '../../evil', { disk: true });
	assert.strictEqual(reopened.context.customerName, 'Evil Co', 'LCA-009 #4: store reads it back');

	// 'a/b' and 'a b' share the sanitized file name; the stored tenantId keeps them apart.
	writeProjectContext({ ...emptyProjectContext(dir, 'a/b'), customerName: 'Slash' });
	assert.strictEqual(readProjectContext(dir, 'a b'), undefined, 'LCA-009 #4: mismatched tenantId returns undefined');
	const other = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-ctxother-'));
	const otherFile = projectContextFile(other, 'a/b');
	fs.mkdirSync(path.dirname(otherFile), { recursive: true });
	fs.copyFileSync(projectContextFile(dir, 'a/b'), otherFile);
	assert.strictEqual(readProjectContext(other, 'a/b'), undefined, 'LCA-009 #4: mismatched directory returns undefined');
}

// LCA-010: discoverTenantL3 bound, skipped folders and depth
{
	const many = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-many-'));
	for (let i = 0; i < 25; i++) {
		const t = path.join(many, 'dev.reltio.environment', `t${i}.reltio.tenant`);
		fs.mkdirSync(t, { recursive: true });
		fs.writeFileSync(path.join(t, 'L3.reltio.json'), '{}');
	}
	assert.strictEqual(discoverTenantL3(many).length, 20, 'LCA-010 #1: result length capped at 20');

	const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-skip-'));
	const plant = rel => {
		const t = path.join(tree, ...rel);
		fs.mkdirSync(t, { recursive: true });
		fs.writeFileSync(path.join(t, 'L3.reltio.json'), '{}');
	};
	for (const skip of ['node_modules', '.git', 'dist', 'target', 'samples']) {
		plant([skip, `${skip.replace('.', '')}.reltio.tenant`]);
	}
	plant(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'deep.reltio.tenant']);
	plant(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'edge.reltio.tenant']);
	const found = discoverTenantL3(tree).map(f => f.tenantId);
	assert.deepStrictEqual(found, ['edge'], `LCA-010 #2: only the in-bound tenant is found, got ${JSON.stringify(found)}`);

	const project = path.join(tree, 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'edge.reltio.tenant', 'LifeCycle Actions', 'p-lca');
	fs.mkdirSync(project, { recursive: true });
	const up = discoverTenantL3(project);
	assert.deepStrictEqual(up.map(f => f.tenantId), ['edge'], 'LCA-010 #3: project subfolder walks up to its tenant folder');
}

console.log('test-lca-workflow: OK');
