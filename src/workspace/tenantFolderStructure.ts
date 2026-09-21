import * as vscode from 'vscode';

/**
 * The Git-ready component tree that every tenant folder carries.
 *
 * The tenant folder is the git repository root, so every path here is relative to it and
 * contains no environment host or tenant ID. Two tenants cloned from one remote on different
 * branches therefore produce byte-identical tracked paths and can be diffed and merged.
 *
 * Git does not track empty directories, so each unmanaged leaf gets a generated `README.md`.
 */

/** Folder holding the tenant metadata the IDE fetches and applies. */
export const BUSINESS_CONFIG_DIR = 'Business Config';

/** Tenant metadata being edited. Replaces the legacy `L3.reltio.json`. */
export const BUSINESS_CONFIG_FILE = `${BUSINESS_CONFIG_DIR}/BusinessConfig.json`;

/** Hidden, gitignored home for IDE working state. Never part of the tracked tree. */
export const IDE_STATE_DIR = '.reltio-ide';

/** Remote snapshot at the last successful fetch; drives drift detection before a PUT. */
export const BASELINE_FILE = `${IDE_STATE_DIR}/BusinessConfig.baseline.json`;

/** Ontology node positions. */
export const LAYOUT_FILE = `${IDE_STATE_DIR}/BusinessConfig.layout.json`;

/** Configuration history snapshots. */
export const HISTORY_DIR = `${IDE_STATE_DIR}/history`;

/** Workspace-root folder holding pre-migration backups. Gitignored at the workspace root. */
export const MIGRATION_BACKUP_DIR = '.reltio-ide-backup';

/**
 * Flat-layout names from before the component tree.
 *
 * These are the only place these strings appear. Migration uses them to find what to move, and
 * `isTenantConfigPath` uses them so a tenant that migration deliberately skipped (dirty worktree)
 * still behaves correctly until it is migrated.
 */
export const LEGACY_CONFIG_FILENAME = 'L3.reltio.json';
export const LEGACY_BASELINE_FILENAME = 'L3.remote-baseline.reltio.json';
export const LEGACY_LAYOUT_FILENAME = 'L3.reltio.layout.json';
export const LEGACY_HISTORY_DIRNAME = 'history';

/**
 * True when a path points at a tenant's configuration file, in either layout.
 *
 * Accepts the legacy name because a tenant skipped by migration keeps it until the next
 * activation, and such a tenant must still be navigable and tracked as opened.
 */
export function isTenantConfigPath(fsPath: string): boolean {
	const normalized = fsPath.replace(/\\/g, '/');
	return (
		normalized.endsWith(`/${BUSINESS_CONFIG_FILE}`) ||
		normalized.endsWith(`/${LEGACY_CONFIG_FILENAME}`)
	);
}

export interface ComponentFolder {
	/** Path relative to the tenant folder root, `/`-separated. */
	path: string;
	/** Heading for the generated README. */
	title: string;
	/** One sentence on what the component is. */
	description: string;
	/** Files expected to live here, for the README. */
	expectedFiles: string[];
	/** Documentation page on docs.reltio.com. */
	docsUrl: string;
	/**
	 * True when the IDE fetches or applies content here. Managed folders get no README,
	 * because they hold a real file that keeps the directory alive in git.
	 */
	managed: boolean;
}

/**
 * Leaf folders of the component tree, in the order they appear in the tenant folder.
 *
 * Parent folders (`Workflows`, `User Management`, `Custom Code`) are implied by these paths
 * and created automatically; they hold no files of their own and get no README.
 */
export const COMPONENT_FOLDERS: readonly ComponentFolder[] = [
	{
		path: BUSINESS_CONFIG_DIR,
		title: 'Business Config',
		description: 'Tenant metadata (the L3 configuration): entity types, relation types, attributes, match rules and survivorship.',
		expectedFiles: ['BusinessConfig.json'],
		docsUrl: 'https://docs.reltio.com/en/reltio/what-reltio-does-at-a-glance/data-unification-and-mdm-at-a-glance/data-unification-and-mdm-in-detail/reltio-information-model/data-model/tenant-configuration-inheritance-across-layers/reltio-l3-layer----customer-tenant',
		managed: true,
	},
	{
		path: 'RDM',
		title: 'RDM',
		description: 'Reference Data Management: lookup types, lookup values, source systems and transcoding.',
		expectedFiles: ['config.json', 'LookupMappings.json'],
		docsUrl: 'https://docs.reltio.com/en/applications/rdm/rdm-at-a-glance',
		managed: false,
	},
	{
		path: 'Workflows/BPMN',
		title: 'BPMN',
		description: 'Business Process Modeling Notation process definitions used by the Workflow Modeler.',
		expectedFiles: ['*.bpmn20.xml'],
		docsUrl: 'https://docs.reltio.com/en/applications/console/configuration-applications/workflow-modeler-at-a-glance',
		managed: false,
	},
	{
		path: 'Workflows/Custom Workflows',
		title: 'Custom Workflows',
		description: 'Custom workflow definitions that extend the out-of-the-box processes such as Data Change Requests.',
		expectedFiles: ['One folder or definition file per custom workflow'],
		docsUrl: 'https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-set-up/overview-of-workflow-customizations/overview-of-workflow-configuration/configure-custom-workflows',
		managed: false,
	},
	{
		path: 'Data Validation Functions',
		title: 'Data Validation Functions',
		description: 'DVFs run against entity and relationship attributes when a record is saved. Each carries a name, expression, action and message.',
		expectedFiles: ['dvf.json'],
		docsUrl: 'https://docs.reltio.com/en/objectives/cleanse-and-verify-data/data-cleansing-at-a-glance/data-cleansing-operation/define-data-validation-functions',
		managed: false,
	},
	{
		path: 'Metadata Permissions',
		title: 'Metadata Permissions',
		description: 'Metadata security applied to entity types, relationship types, interaction types and individual attributes.',
		expectedFiles: ['permissions.json'],
		docsUrl: 'https://docs.reltio.com/en/developer-resources/system-administration-apis/system-administration-apis-at-a-glance/configuration-api/role-based-security/metadata-security',
		managed: false,
	},
	{
		path: 'User Management/Users',
		title: 'Users',
		description: 'User account profiles, including the roles assigned, the tenants they can reach and the groups they belong to.',
		expectedFiles: ['users.json'],
		docsUrl: 'https://docs.reltio.com/en/applications/console/security-applications/user-management-at-a-glance/managing-user-accounts',
		managed: false,
	},
	{
		path: 'User Management/Roles',
		title: 'Roles',
		description: 'System and custom roles, each identifying access privileges for one or more services and their resources.',
		expectedFiles: ['roles.json'],
		docsUrl: 'https://docs.reltio.com/en/objectives/administer-system/system-administration-at-a-glance/access-management-at-a-glance/access-management-reference/authorization/custom-roles',
		managed: false,
	},
	{
		path: 'User Management/Groups',
		title: 'Groups',
		description: 'Groups used to assign access rights and privileges to sets of users.',
		expectedFiles: ['groups.json'],
		docsUrl: 'https://docs.reltio.com/en/objectives/administer-system/system-administration-at-a-glance/access-management-at-a-glance/access-management-reference/authorization',
		managed: false,
	},
	{
		path: 'Data Loader',
		title: 'Data Loader',
		description: 'Source-to-target mappings used by the Console Data Loader.',
		expectedFiles: ['mappings.json'],
		docsUrl: 'https://docs.reltio.com/en/applications/console/tenant-management-applications/data-loader-at-a-glance/get-started-with-data-loader',
		managed: false,
	},
	{
		path: 'Reltio Integration Hub',
		title: 'Reltio Integration Hub',
		description: 'RIH recipe manifests describing automated end-to-end integration flows.',
		expectedFiles: ['One manifest file per recipe'],
		docsUrl: 'https://docs.reltio.com/en/applications/integration-hub/integration-hub-at-a-glance',
		managed: false,
	},
	{
		path: 'LifeCycle Actions',
		title: 'LifeCycle Actions',
		description: 'LCAs mapping an action name to an action list, run against platform hooks such as beforeSave.',
		expectedFiles: ['One definition file per lifecycle action'],
		docsUrl: 'https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-configuration',
		managed: false,
	},
	{
		path: 'DTSS',
		title: 'DTSS',
		description: 'Data Tenant Subscription Service configuration for sharing data from a data tenant into this tenant.',
		expectedFiles: ['dtss_config.json'],
		docsUrl: 'https://docs.reltio.com/en/applications/data-integrations/data-enrichment-integrations-at-a-glance/reltio-data-tenant-subscription-service-dtss-at-a-glance',
		managed: false,
	},
	{
		path: 'Connectors',
		title: 'Connectors',
		description: 'Connector definitions for interacting with external SaaS provider APIs.',
		expectedFiles: ['One definition file per connector'],
		docsUrl: 'https://docs.reltio.com/en/objectives/integrate-data/data-integration-at-a-glance/reltio-connector',
		managed: false,
	},
	{
		path: 'User Interface',
		title: 'User Interface',
		description: 'Hub layout and page view configuration.',
		expectedFiles: ['config.json'],
		docsUrl: 'https://docs.reltio.com/en/objectives/configure-the-reltio-ui/ui-configuration-at-a-glance',
		managed: false,
	},
	{
		path: 'Custom Code/Custom Cleansers',
		title: 'Custom Cleansers',
		description: 'Custom cleanse functions beyond the out-of-the-box address, phone, email, name and string cleansers.',
		expectedFiles: ['One folder or definition file per cleanser'],
		docsUrl: 'https://docs.reltio.com/en/objectives/cleanse-and-verify-data/data-cleansing-at-a-glance/data-cleansing-reference/out-of-the-box-cleanse-functions',
		managed: false,
	},
	{
		path: 'Custom Code/Utilities',
		title: 'Utilities',
		description: 'Supporting custom code and helper utilities deployed alongside this tenant.',
		expectedFiles: ['One folder or file per utility'],
		docsUrl: 'https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance',
		managed: false,
	},
	{
		path: 'Physical Configuration',
		title: 'Physical Configuration',
		description: 'Tenant-level physical parameters governing storage, search indexing, relations, crosswalks, streaming and logging.',
		expectedFiles: ['pConfig.json'],
		docsUrl: 'https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/tenant-configuration-parameters-reference',
		managed: false,
	},
] as const;

/** Leaf folders the IDE does not yet fetch or apply. These are the ones that get a README. */
export function unmanagedFolders(): ComponentFolder[] {
	return COMPONENT_FOLDERS.filter(f => !f.managed);
}

/**
 * Every directory the tree implies, parents first, `/`-separated and relative to the tenant folder.
 *
 * This is a superset of `COMPONENT_FOLDERS`: the three container folders (`Workflows`,
 * `User Management`, `Custom Code`) appear here but are not components in their own right.
 */
export function allTreeDirectories(): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const folder of COMPONENT_FOLDERS) {
		const segments = folder.path.split('/');
		for (let i = 1; i <= segments.length; i++) {
			const prefix = segments.slice(0, i).join('/');
			if (seen.has(prefix)) continue;
			seen.add(prefix);
			out.push(prefix);
		}
	}
	return out;
}

function joinRelative(root: vscode.Uri, relativePath: string): vscode.Uri {
	return vscode.Uri.joinPath(root, ...relativePath.split('/'));
}

/** Absolute URI of a path inside a tenant folder, e.g. `BUSINESS_CONFIG_FILE`. */
export function tenantPath(tenantRoot: vscode.Uri, relativePath: string): vscode.Uri {
	return joinRelative(tenantRoot, relativePath);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/** The README written into an unmanaged component folder. */
export function renderReadme(folder: ComponentFolder): string {
	const files = folder.expectedFiles.map(f => `- \`${f}\``).join('\n');
	return `# ${folder.title}

${folder.description}

## Expected files

${files}

## Documentation

${folder.docsUrl}

---

This component is not yet managed by Reltio IDE. Files placed here are **not** fetched from or
applied to the tenant; they are version-controlled alongside the configuration so the repository
describes the whole tenant. This file exists because Git does not track empty directories.
`;
}

/**
 * Creates every missing directory of the component tree and writes a `README.md` into each
 * unmanaged leaf that does not already have one.
 *
 * Non-destructive by contract: existing directories and existing files are left untouched, so
 * this is safe to call on an already-populated tenant folder (after a clone, or on re-activation).
 */
export async function materializeTenantTree(tenantRoot: vscode.Uri): Promise<void> {
	for (const dir of allTreeDirectories()) {
		await vscode.workspace.fs.createDirectory(joinRelative(tenantRoot, dir));
	}

	const enc = new TextEncoder();
	for (const folder of unmanagedFolders()) {
		const readmeUri = joinRelative(tenantRoot, `${folder.path}/README.md`);
		if (await exists(readmeUri)) continue;
		await vscode.workspace.fs.writeFile(readmeUri, enc.encode(renderReadme(folder)));
	}
}

/**
 * True when a folder already carries the component tree.
 *
 * Presence of `Business Config/` is the marker: it is the one folder the IDE writes into, so a
 * repository that has it was either created by this extension or deliberately laid out to match.
 */
export async function isComponentTree(root: vscode.Uri): Promise<boolean> {
	return exists(joinRelative(root, BUSINESS_CONFIG_DIR));
}
