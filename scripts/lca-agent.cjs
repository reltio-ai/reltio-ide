#!/usr/bin/env node
'use strict';
/**
 * CLI for the LCA workflow gates. Compile first (`npm run compile`).
 * Prints JSON. Does not print .env values.
 */
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const lca = importDist('lca/index');

function readL3(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return undefined;
	}
}

const [command, ...rest] = process.argv.slice(2);
const payload = rest[0] ? JSON.parse(rest[0]) : {};

function run() {
	switch (command) {
		case 'tenant-gate':
			return lca.assessTenantConnection(payload);
		case 'resolve-type':
			return lca.resolveObjectType(payload.model, payload.name, payload.kind);
		case 'resolve-attributes':
			return lca.resolveAttributes(payload.object, payload.names);
		case 'package':
			return { javaPackage: lca.buildJavaPackage(payload) };
		case 'cloud':
			return lca.selectCloud(payload.explicit);
		case 'hook':
			return lca.validateHook(payload.kind, payload.hook);
		case 'propose-l3':
			return lca.proposeLifecycleChange(payload);
		case 'gate': {
			if (!payload.workingDirectory) {
				return { error: 'workingDirectory is required' };
			}
			const store = new lca.LcaContextStore();
			const opened = store.open(payload.workingDirectory, payload.tenantId, { disk: true });
			return lca.gate(lca.workflowFromContext(opened.context), payload.action);
		}
		case 'env': {
			const envPath = payload.envPath || (payload.workingDirectory ? lca.discoverEnvFile(payload.workingDirectory) : undefined);
			let envText = payload.envText;
			if (envText === undefined && envPath) {
				try {
					envText = fs.readFileSync(envPath, 'utf8');
				} catch {
					envText = undefined;
				}
			}
			return {
				envFound: Boolean(envPath) || typeof payload.envText === 'string',
				missing: lca.missingEnvKeys(envText ?? '', payload.provider || 'aws'),
			};
		}
		case 'physical': {
			const configPath = payload.configPath || (payload.workingDirectory ? lca.discoverPhysicalConfig(payload.workingDirectory) : undefined);
			let configText = payload.configText;
			if (configText === undefined && configPath) {
				try {
					configText = fs.readFileSync(configPath, 'utf8');
				} catch {
					configText = undefined;
				}
			}
			const check = lca.assessPhysicalAccess(configText, payload.provider || 'aws');
			return { present: check.present, consoleUpdate: check.consoleUpdate };
		}
		case 'deploy-error':
			return lca.deployFailureGuidance(payload.error ?? '');
		case 'intent':
			return {
				intent: lca.classifyLcaIntent(payload.text ?? ''),
				act: lca.classifyTurn(payload.text ?? ''),
				tenantAware: lca.tenantAwareIntent(payload.text ?? '', lca.classifyLcaIntent(payload.text ?? '')),
			};
		case 'step': {
			if (!payload.workingDirectory) {
				return { error: 'workingDirectory is required' };
			}
			const text = payload.text ?? '';
			const intent = lca.classifyLcaIntent(text);
			const tenantAware = lca.tenantAwareIntent(text, intent);
			let tenantConnected;
			let l3Model;
			let selected;
			if (tenantAware) {
				const locations = lca.discoverTenantL3(payload.workingDirectory);
				const gate = lca.assessTenantConnection({
					tenantAware: true,
					locations,
					preferredTenantId: payload.tenantId,
				});
				if (!gate.connected) {
					tenantConnected = false;
				} else if (!gate.selected) {
					return {
						phase: 'REQUIREMENT_GATHERING',
						persistedPhase: 'REQUIREMENT_GATHERING',
						allowedActions: ['ask'],
						writeFiles: false,
						message: gate.message,
					};
				} else {
					tenantConnected = true;
					selected = gate.selected;
					l3Model = readL3(gate.selected.path);
					if (!l3Model) {
						return {
							phase: 'ASK',
							persistedPhase: 'ASK',
							allowedActions: ['ask'],
							writeFiles: false,
							message: 'The connected tenant L3 could not be read. Fetch configuration again before continuing.',
						};
					}
				}
			}
			const store = new lca.LcaContextStore();
			const opened = store.open(payload.workingDirectory, payload.tenantId, { disk: true });
			const stored = lca.workflowFromContext(opened.context);
			const envPath = lca.discoverEnvFile(payload.workingDirectory);
			const physicalPath = lca.discoverPhysicalConfig(payload.workingDirectory);
			let envText;
			let physicalConfigText;
			if (envPath) {
				try { envText = fs.readFileSync(envPath, 'utf8'); } catch { envText = undefined; }
			}
			if (physicalPath) {
				try { physicalConfigText = fs.readFileSync(physicalPath, 'utf8'); } catch { physicalConfigText = undefined; }
			}
			const result = lca.step(stored, text, {
				trust: 'persisted',
				claimed: payload.claimed,
				l3Model,
				tenantConnected,
				envText,
				physicalConfigText,
			});
			const projectDirectory = selected && result.workflow.targetType && result.workflow.hook
				? lca.lcaProjectDirectory(
					selected.path,
					result.workflow.targetType,
					result.workflow.hook,
					result.workflow.cloudFunctionIdentifier,
				)
				: undefined;
			const patched = { ...opened.context, ...lca.contextPatchFromWorkflow(result.workflow) };
			store.save(patched, { disk: true });
			if (projectDirectory && result.writeFiles === true && path.resolve(projectDirectory) !== path.resolve(payload.workingDirectory)) {
				store.save({ ...patched, workingDirectory: projectDirectory }, { disk: true });
			}
			const writeNote = result.writeFiles === true && projectDirectory
				? ` Write the Maven project only in ${projectDirectory}.`
				: '';
			return {
				phase: result.phase,
				persistedPhase: result.persistedPhase,
				allowedActions: result.allowedActions,
				writeFiles: result.writeFiles === true,
				projectDirectory,
				message: `${result.message}${writeNote}`,
				questions: result.questions,
				redacted: result.redacted === true ? true : undefined,
				facts: {
					targetType: result.workflow.targetType,
					targetTypeUri: result.workflow.targetTypeUri,
					hook: result.workflow.hook,
					attributesRead: result.workflow.attributesRead,
					attributesAdded: result.workflow.attributesAdded,
					attributesUpdated: result.workflow.attributesUpdated,
					cloudProvider: result.workflow.cloudProvider ?? 'aws',
					objectAttributesConfirmed: result.workflow.objectAttributesConfirmed === true,
					designApproved: result.workflow.designApproved === true,
					connectivityStatus: result.workflow.connectivityStatus ?? 'unknown',
					projectDirectory,
				},
				consoleUpdate: result.consoleUpdate,
				missingCredentials: result.missingCredentials,
			};
		}
		case 'java':
			return lca.requireJava(payload.language);
		case 'present-inputs':
			return { text: lca.formatObjectAttributeConfirmation(payload) };
		case 'present-design':
			return { text: lca.formatImplementationDesign(payload) };
		case 'present-diff':
			return { text: lca.formatLifecycleDiff(payload) };
		case 'context-open':
			return new lca.LcaContextStore().open(payload.workingDirectory, payload.tenantId, { disk: true });
		case 'context-save': {
			if (!payload.workingDirectory) return { error: 'workingDirectory is required' };
			const store = new lca.LcaContextStore();
			const opened = store.open(payload.workingDirectory, payload.tenantId, { disk: true });
			const preserved = {
				phase: opened.context.phase,
				workflowState: opened.context.workflowState,
				targetType: opened.context.targetType,
				targetTypeUri: opened.context.targetTypeUri,
				targetKind: opened.context.targetKind,
				hooks: opened.context.hooks,
				attributesRead: opened.context.attributesRead,
				attributesAdded: opened.context.attributesAdded,
				attributesUpdated: opened.context.attributesUpdated,
				attributesAddedOrUpdated: opened.context.attributesAddedOrUpdated,
				attributesSpecified: opened.context.attributesSpecified,
				objectAttributesConfirmed: opened.context.objectAttributesConfirmed,
				designApproved: opened.context.designApproved,
				deploymentApproved: opened.context.deploymentApproved,
				l3UpdateApproved: opened.context.l3UpdateApproved,
				pendingConfigurationPatch: opened.context.pendingConfigurationPatch,
				cloudFunctionIdentifier: opened.context.cloudFunctionIdentifier,
				connectivityStatus: opened.context.connectivityStatus,
				deploymentStatus: opened.context.deploymentStatus,
			};
			store.save({ ...opened.context, ...payload, ...preserved, implementationLanguage: 'Java' }, { disk: true });
			return { ok: true, note: 'Phase, approvals, and requirement facts are kept from the last step. Use the step command to change them.' };
		}
		default:
			return {
				error: 'Unknown command',
				commands: ['tenant-gate', 'resolve-type', 'resolve-attributes', 'package', 'cloud', 'hook', 'propose-l3', 'gate', 'env', 'physical', 'deploy-error', 'intent', 'step', 'java', 'present-inputs', 'present-design', 'present-diff', 'context-open', 'context-save'],
			};
	}
}

process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
