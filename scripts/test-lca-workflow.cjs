#!/usr/bin/env node
'use strict';
/**
 * LCA agent workflow gates, package naming, L3 registration, and lifecycleActions tree leaf.
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const lca = importDist('lca/index');
const { getConfigRootChildren, getConfigNodeChildren } = importDist('tree/configSubtree');

const {
	assessTenantConnection,
	discoverTenantL3,
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

console.log('test-lca-workflow: OK');
