export type CloudProvider = 'aws' | 'gcp' | 'azure' | 'native';

export interface CloudSelection {
	provider: CloudProvider;
	baseClass: string;
	defaulted: boolean;
	registrationPrefix: string | null;
}

const SELECTIONS: Record<CloudProvider, Omit<CloudSelection, 'defaulted'>> = {
	aws: {
		provider: 'aws',
		baseClass: 'LifeCycleActionHandler',
		registrationPrefix: 'Lambda/BinaryJSON/',
	},
	gcp: {
		provider: 'gcp',
		baseClass: 'LifeCycleGoogleFunction',
		registrationPrefix: 'googlefunction/BinaryJSON/',
	},
	azure: {
		provider: 'azure',
		baseClass: 'LifeCycleAzureFunction',
		registrationPrefix: 'AzureFunction/BinaryJSON/',
	},
	native: {
		provider: 'native',
		baseClass: 'LifeCycleActionBase',
		registrationPrefix: null,
	},
};

export function selectCloud(explicit?: string | null): CloudSelection | { error: string } {
	const raw = explicit?.trim();
	if (!raw) {
		return { ...SELECTIONS.aws, defaulted: true };
	}
	const key = raw.toLowerCase();
	if (key === 'aws' || key === 'lambda' || key === 'aws lambda') {
		return { ...SELECTIONS.aws, defaulted: false };
	}
	if (key === 'gcp' || key === 'google' || key === 'google cloud') {
		return { ...SELECTIONS.gcp, defaulted: false };
	}
	if (key === 'azure') {
		return { ...SELECTIONS.azure, defaulted: false };
	}
	if (key === 'native') {
		return { ...SELECTIONS.native, defaulted: false };
	}
	return { error: `Unsupported cloud platform "${explicit}". Use AWS, GCP, Azure, or Native.` };
}

/** AWS registrations use the deployed function name, never the Java class name. */
export function cloudRegistration(provider: CloudProvider, identifier: string): string {
	const id = identifier.trim();
	if (!id) {
		throw new Error('Deployed identifier is required.');
	}
	const prefix = SELECTIONS[provider].registrationPrefix;
	if (!prefix) {
		return id;
	}
	if (id.startsWith(prefix)) {
		return id;
	}
	return `${prefix}${id}`;
}

export function connectivityRequired(actionName: string): boolean {
	return !actionName.startsWith('Reltio/');
}

export const CONNECTIVITY_DOCS: Record<CloudProvider, string | null> = {
	aws: 'https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-deployment-using-aws-lambda/set-up-aws-lambda-connections-for-lcas',
	gcp: 'https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-implementation-using-google-functions/lca-as-google-functions-identity-and-access-management',
	azure: 'https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/azure-functions-for-lifecycle-actions/configure-microsoft-entra-id-authentication-for-azure-lcas',
	native: null,
};

export const LOG_LOCATIONS: Record<CloudProvider, string> = {
	aws: 'CloudWatch Logs',
	gcp: 'Cloud Logging',
	azure: 'Application Insights / Function logs',
	native: 'LCA Service logs',
};
