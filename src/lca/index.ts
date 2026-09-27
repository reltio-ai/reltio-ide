export { ALL_LCA_HOOKS, validateHook, hooksForKind, isKnownHook } from './hooks';
export { buildJavaPackage, normalizePackageSegment, isForbiddenGenericPackage } from './packageName';
export { LcaContextStore, contextKey, emptyProjectContext, invalidateTenantScoped, ISOLATED_ASSUMPTION_KEYS, projectContextFile, readProjectContext, writeProjectContext } from './context';
export {
	formatObjectAttributeConfirmation,
	formatImplementationDesign,
	formatLifecycleDiff,
	formatDeploymentPreview,
	deploymentPrompt,
	OBJECT_ATTRIBUTE_CONFIRM_PROMPT,
	DESIGN_CONFIRM_PROMPT,
	L3_CONFIRM_PROMPT,
} from './present';
export { selectCloud, cloudRegistration, connectivityRequired, CONNECTIVITY_DOCS, LOG_LOCATIONS } from './cloud';
export { assessTenantConnection, discoverTenantL3, isTenantL3Path, locationsFromGitMarker, TENANT_CONNECTION_MESSAGE } from './tenantGate';
export { resolveObjectType, resolveAttributes, listObjectTypes } from './l3Lookup';
export { proposeLifecycleChange, applyLifecycleProposal } from './lifecycleConfig';
export {
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
	markTenantConfigApplied,
	requireJava,
	phaseFor,
	missingRequirements,
	step,
	extractFacts,
	workflowFromContext,
	contextPatchFromWorkflow,
	containsSecretValue,
	redactSecrets,
	isDisallowedCredentialPrompt,
	credentialPrompt,
	actionSucceeded,
} from './workflow';
export { missingEnvKeys, presentEnvKeys, envExample } from './envCheck';
export { classifyLcaIntent, classifyTurn, isAdviceQuestion, isExplicitApproval, tenantAwareIntent } from './intent';

export type { CloudProvider, CloudSelection } from './cloud';
export type { LcaWorkflow, WorkflowState, LcaPhase, Gate, StepResult, AllowedAction } from './workflow';
export type { ResolvedObjectType, ResolvedAttribute } from './l3Lookup';
export type { LifecycleProposal, LifecycleOp } from './lifecycleConfig';
