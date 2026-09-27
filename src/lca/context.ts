import * as fs from 'fs';
import * as path from 'path';

export type ConnectivityStatus = 'unknown' | 'not-required' | 'missing' | 'confirmed';

export interface ProjectContext {
	workingDirectory: string;
	tenantId?: string;
	customerName?: string;
	environment?: string;
	targetKind?: 'entity' | 'relation' | 'changeRequest';
	targetType?: string;
	targetTypeUri?: string;
	hooks?: string[];
	attributesRead?: string[];
	attributesAdded?: string[];
	attributesUpdated?: string[];
	/** Combined list kept for older context files. New writes also store the two roles separately. */
	attributesAddedOrUpdated?: string[];
	attributesSpecified?: boolean;
	phase?: string;
	workflowState?: string;
	cloudProvider?: 'aws' | 'gcp' | 'azure' | 'native';
	javaPackage?: string;
	implementationModule?: string;
	cloudFunctionIdentifier?: string;
	implementationLanguage: 'Java';
	connectivityStatus: ConnectivityStatus;
	deploymentStatus: 'none' | 'pending' | 'deployed' | 'failed';
	pendingConfigurationPatch?: Record<string, unknown>;
	objectAttributesConfirmed: boolean;
	designApproved: boolean;
	deploymentApproved: boolean;
	l3UpdateApproved: boolean;
}

/** Project decisions that must not cross a working-directory or tenant boundary. */
export const ISOLATED_ASSUMPTION_KEYS = [
	'customerName',
	'tenantId',
	'targetType',
	'targetTypeUri',
	'targetKind',
	'hooks',
	'attributesRead',
	'attributesAdded',
	'attributesUpdated',
	'attributesAddedOrUpdated',
	'attributesSpecified',
	'phase',
	'workflowState',
	'cloudProvider',
	'javaPackage',
	'implementationModule',
	'cloudFunctionIdentifier',
	'connectivityStatus',
	'deploymentStatus',
	'pendingConfigurationPatch',
	'objectAttributesConfirmed',
	'designApproved',
	'deploymentApproved',
	'l3UpdateApproved',
] as const;

/** Same directory spelling, trailing slash, and relative form share one context. */
export function normalizeWorkingDirectory(workingDirectory: string): string {
	const resolved = path.resolve(workingDirectory).replace(/\\/g, '/').replace(/\/+$/, '');
	return resolved || workingDirectory;
}

export function contextKey(workingDirectory: string, tenantId?: string): string {
	return `${normalizeWorkingDirectory(workingDirectory)}::${tenantId ?? ''}`;
}

export function emptyProjectContext(workingDirectory: string, tenantId?: string): ProjectContext {
	return {
		workingDirectory: normalizeWorkingDirectory(workingDirectory),
		tenantId,
		implementationLanguage: 'Java',
		connectivityStatus: 'unknown',
		deploymentStatus: 'none',
		objectAttributesConfirmed: false,
		designApproved: false,
		deploymentApproved: false,
		l3UpdateApproved: false,
	};
}

/**
 * LCA state keyed by working directory + tenant.
 * Memory never copies another pair. Disk files live under that directory only.
 */
export function projectContextFile(workingDirectory: string, tenantId?: string): string {
	const safe = (tenantId ?? '_none').replace(/[^a-zA-Z0-9._-]+/g, '_');
	return path.join(normalizeWorkingDirectory(workingDirectory), '.reltio', 'lca-context', `${safe}.json`);
}

export function readProjectContext(workingDirectory: string, tenantId?: string): ProjectContext | undefined {
	const dir = normalizeWorkingDirectory(workingDirectory);
	const file = projectContextFile(dir, tenantId);
	if (!fs.existsSync(file)) return undefined;
	let parsed: ProjectContext;
	try {
		parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectContext;
	} catch {
		return undefined;
	}
	if (normalizeWorkingDirectory(parsed.workingDirectory) !== dir || parsed.tenantId !== tenantId) {
		return undefined;
	}
	return { ...emptyProjectContext(dir, tenantId), ...parsed, workingDirectory: dir, implementationLanguage: 'Java' };
}

export function writeProjectContext(context: ProjectContext): void {
	const stored: ProjectContext = {
		...context,
		workingDirectory: normalizeWorkingDirectory(context.workingDirectory),
		implementationLanguage: 'Java',
	};
	const file = projectContextFile(stored.workingDirectory, stored.tenantId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
}

export class LcaContextStore {
	private readonly contexts = new Map<string, ProjectContext>();

	open(workingDirectory: string, tenantId?: string, options?: { disk?: boolean }): { key: string; context: ProjectContext; created: boolean } {
		const key = contextKey(workingDirectory, tenantId);
		const existing = this.contexts.get(key);
		if (existing) return { key, context: existing, created: false };
		const fromDisk = options?.disk ? readProjectContext(workingDirectory, tenantId) : undefined;
		const context = fromDisk ?? emptyProjectContext(workingDirectory, tenantId);
		this.contexts.set(key, context);
		return { key, context, created: !fromDisk };
	}

	save(context: ProjectContext, options?: { disk?: boolean }): void {
		const stored: ProjectContext = {
			...context,
			workingDirectory: normalizeWorkingDirectory(context.workingDirectory),
			implementationLanguage: 'Java',
		};
		this.contexts.set(contextKey(stored.workingDirectory, stored.tenantId), stored);
		if (options?.disk) writeProjectContext(stored);
	}

	get(workingDirectory: string, tenantId?: string): ProjectContext | undefined {
		return this.contexts.get(contextKey(workingDirectory, tenantId));
	}
}

/** Drop tenant-scoped data when the same directory connects to a different tenant. */
export function invalidateTenantScoped(context: ProjectContext, nextTenantId: string): ProjectContext {
	return emptyProjectContext(context.workingDirectory, nextTenantId);
}
