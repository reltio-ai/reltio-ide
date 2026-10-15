import * as fs from 'fs';
import * as path from 'path';
import { CONNECTIVITY_DOCS, type CloudProvider } from './cloud';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'samples', 'velocity-packs']);
const PHYSICAL_NAMES = new Set([
	'physical.json',
	'physicalconfig.json',
	'physical-configuration.json',
	'physicalconfiguration.json',
	'tenantphysicalconfig.json',
	'tenant-physical.json',
	'tenant-physical-config.json',
]);

export interface PhysicalAccessCheck {
	present: boolean;
	/** Set only when the cloud access details are absent. Never contains secret values. */
	consoleUpdate?: string;
}

function walkFiles(dir: string, depth: number, visit: (file: string) => void): void {
	if (depth < 0) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkFiles(full, depth - 1, visit);
		} else if (entry.isFile()) {
			visit(full);
		}
	}
}

/** Prefer a physical config that sits inside a connected tenant folder. */
function tenantLocalScore(file: string): number {
	const normalized = file.replace(/\\/g, '/');
	if (normalized.includes('.reltio.tenant/')) return 0;
	let dir = path.dirname(file);
	for (let depth = 0; depth < 6; depth++) {
		const marker = path.join(dir, '.reltio-config-source.json');
		if (fs.existsSync(marker)) {
			try {
				const parsed = JSON.parse(fs.readFileSync(marker, 'utf8')) as { kind?: string; tenantId?: string };
				if (parsed?.kind === 'tenant' && typeof parsed.tenantId === 'string' && parsed.tenantId.trim()) return 0;
			} catch {
				// A marker that is not JSON is not a tenant folder.
			}
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return 1;
}

/** Tenant physical configuration JSON, preferring a file inside the connected tenant folder. */
export function discoverPhysicalConfig(root: string): string | undefined {
	const found: string[] = [];
	walkFiles(root, 8, file => {
		if (PHYSICAL_NAMES.has(path.basename(file).toLowerCase())) found.push(file);
	});
	found.sort((a, b) => tenantLocalScore(a) - tenantLocalScore(b) || a.length - b.length);
	return found[0];
}

function flatten(node: unknown, acc: Map<string, string>): void {
	if (!node || typeof node !== 'object') return;
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
		if (typeof value === 'string' && value.trim()) {
			acc.set(normalized, value.trim());
		} else if (typeof value === 'number' && Number.isFinite(value)) {
			acc.set(normalized, String(value));
		} else if (value && typeof value === 'object') {
			flatten(value, acc);
		}
	}
}

function field(fields: Map<string, string>, pattern: RegExp): string | undefined {
	for (const [key, value] of fields) {
		if (pattern.test(key) && value) return value;
	}
	return undefined;
}

function awsPresent(fields: Map<string, string>): boolean {
	const account = field(fields, /^(aws)?accountid$/);
	const role = field(fields, /role(arn)?$|customeriamrolearn|iamrolearn/);
	const region = field(fields, /^(aws)?region$/);
	const externalId = field(fields, /externalid/);
	return Boolean(
		account && /^\d{12}$/.test(account)
		&& role && role.includes('arn:aws:iam:')
		&& region && /^[a-z]{2}-[a-z]+-\d$/.test(region)
		&& externalId,
	);
}

function gcpPresent(fields: Map<string, string>): boolean {
	const email = field(fields, /serviceaccount(email)?$|customerserviceaccount/);
	const project = field(fields, /^(gcp)?project(id)?$/);
	return Boolean(email && email.includes('@') && project && !/^your-/i.test(project));
}

function azurePresent(fields: Map<string, string>): boolean {
	const tenant = field(fields, /customertenantid|azuretenantid/);
	const app = field(fields, /customerfunctionappid|functionappid/);
	const tokenUrl = field(fields, /tokenurl/);
	const clientId = field(fields, /clientid/);
	const entra = Boolean(tenant && app);
	const oauth = Boolean(tokenUrl && tokenUrl.startsWith('https://') && clientId);
	return entra || oauth;
}

export function consoleUpdateInstructions(provider: CloudProvider): string {
	if (provider === 'gcp') {
		return [
			'The tenant physical configuration does not include the GCP connectivity details Reltio needs to invoke the function.',
			'In Google Cloud, create a service account, grant it Cloud Run Invoker, and let the Reltio service account impersonate it (Service Account User and Service Account Token Creator).',
			'Then share the customer service account email and GCP project id with Reltio so they are stored on the tenant physical configuration.',
			CONNECTIVITY_DOCS.gcp ?? '',
		].filter(Boolean).join('\n');
	}
	if (provider === 'azure') {
		return [
			'The tenant physical configuration does not include the Azure connectivity details Reltio needs to invoke the function.',
			'In the Reltio Console, store either Entra ID details (customerTenantId and customerFunctionAppId) or OAuth2 client-credentials details (https token URL and client id).',
			'Enable authentication on the Function App, then save the configuration so it appears on the tenant physical configuration.',
			CONNECTIVITY_DOCS.azure ?? '',
		].filter(Boolean).join('\n');
	}
	return [
		'The tenant physical configuration does not include the AWS connectivity details Reltio needs to invoke the Lambda.',
		'In the Reltio Console, open Tenant management → Lifecycle Actions → Create connection → AWS, and set:',
		'- AWS Account ID (12 digits)',
		'- Customer IAM Role ARN',
		'- AWS Region',
		'- External ID',
		'Update the customer IAM role trust policy so Reltio can assume it, then choose Validate Trust Policy & Apply Configuration.',
		CONNECTIVITY_DOCS.aws ?? '',
	].filter(Boolean).join('\n');
}

/**
 * Cloud access details already stored for this tenant.
 * A missing file or missing fields is not present. Secret values are never returned.
 */
export function assessPhysicalAccess(configText: string | undefined, provider: CloudProvider): PhysicalAccessCheck {
	if (provider === 'native') return { present: true };
	const consoleUpdate = consoleUpdateInstructions(provider);
	if (!configText || !configText.trim()) return { present: false, consoleUpdate };
	let parsed: unknown;
	try {
		parsed = JSON.parse(configText);
	} catch {
		return { present: false, consoleUpdate };
	}
	const fields = new Map<string, string>();
	flatten(parsed, fields);
	const present = provider === 'aws'
		? awsPresent(fields)
		: provider === 'gcp'
			? gcpPresent(fields)
			: azurePresent(fields);
	return present ? { present: true } : { present: false, consoleUpdate };
}
