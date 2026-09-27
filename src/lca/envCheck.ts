import type { CloudProvider } from './cloud';

const REQUIRED: Record<CloudProvider, string[][]> = {
	aws: [['AWS_REGION'], ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID']],
	gcp: [['GOOGLE_CLOUD_PROJECT'], ['GOOGLE_CLOUD_REGION']],
	azure: [['AZURE_FUNCTIONAPP_NAME'], ['AZURE_RESOURCE_GROUP']],
	native: [],
};

/** Parse KEY names only. Values are never returned. */
export function presentEnvKeys(envText: string): Set<string> {
	const keys = new Set<string>();
	for (const line of envText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (key && value && value !== '""' && value !== "''") {
			keys.add(key);
		}
	}
	return keys;
}

export function missingEnvKeys(envText: string, provider: CloudProvider): string[] {
	const present = presentEnvKeys(envText);
	const missing: string[] = [];
	for (const group of REQUIRED[provider]) {
		if (group.length === 0) continue;
		if (!group.some(key => present.has(key))) {
			missing.push(group.join(' or '));
		}
	}
	if (provider === 'aws' && present.has('AWS_ACCESS_KEY_ID') && !present.has('AWS_SECRET_ACCESS_KEY') && !present.has('AWS_PROFILE')) {
		missing.push('AWS_SECRET_ACCESS_KEY');
	}
	return missing;
}

export function envExample(provider: CloudProvider): string {
	if (provider === 'aws') {
		return [
			'AWS_REGION=us-east-1',
			'AWS_PROFILE=your-profile',
			'# Or use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Never commit real secrets.',
			'',
		].join('\n');
	}
	if (provider === 'gcp') {
		return [
			'GOOGLE_CLOUD_PROJECT=your-project',
			'GOOGLE_CLOUD_REGION=us-central1',
			'',
		].join('\n');
	}
	if (provider === 'azure') {
		return [
			'AZURE_FUNCTIONAPP_NAME=your-function-app',
			'AZURE_RESOURCE_GROUP=your-resource-group',
			'',
		].join('\n');
	}
	return '# Native LCA Service deployment does not use cloud credentials in .env\n';
}
