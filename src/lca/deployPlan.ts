import * as path from 'path';
import type { CloudProvider } from './cloud';
import { missingEnvKeys } from './envCheck';
import { redactSecrets } from './workflow';
import { isContainedPath } from './sources';

const FUNCTION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface DeployPlan {
	executable: string;
	args: string[];
	cwd: string;
	/** Safe to show. Never includes credential values. */
	summary: string;
}

export interface DeployLaunch {
	ok: true;
	plan: DeployPlan;
	/** Child process environment. Callers must not log or return it. */
	env: NodeJS.ProcessEnv;
	secretValues: string[];
}

export interface DeployRefusal {
	ok: false;
	message: string;
	missing?: string[];
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Values stay in the child environment. Only long values are treated as secrets to scrub from output. */
export function childEnv(envText: string, base: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; secretValues: string[] } {
	const env: NodeJS.ProcessEnv = { ...base };
	const secretValues: string[] = [];
	for (const line of envText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = unquote(trimmed.slice(eq + 1));
		if (!key) continue;
		env[key] = value;
		if (value.length >= 8) secretValues.push(value);
	}
	return { env, secretValues };
}

export function redactCommandOutput(text: string, secretValues: string[] = []): string {
	let redacted = redactSecrets(text);
	for (const secret of secretValues) {
		if (secret.length < 8) continue;
		redacted = redacted.split(secret).join('[redacted]');
	}
	return redacted.slice(0, 2000);
}

/**
 * Fixed argument list for the cloud CLI. The model never supplies the command line.
 * Azure is refused. `.env` values are placed only in the child environment.
 */
export function buildDeployPlan(input: {
	provider: CloudProvider;
	workingDirectory: string;
	functionName: string;
	artifactPath: string;
	envText: string;
	baseEnv?: NodeJS.ProcessEnv;
}): DeployLaunch | DeployRefusal {
	if (input.provider === 'azure') {
		return {
			ok: false,
			message: 'Azure LCA deployment is unresolved. The deploy command will not run an Azure CLI.',
		};
	}
	if (input.provider === 'native') {
		return {
			ok: false,
			message: 'Native LCA deployment does not use a cloud CLI. Register it only after a separate lifecycleActions approval.',
		};
	}
	if (!FUNCTION_NAME.test(input.functionName)) {
		return { ok: false, message: 'The cloud function name has unsupported characters. Use letters, numbers, dots, underscores, or hyphens.' };
	}
	if (!isContainedPath(input.workingDirectory, input.artifactPath)) {
		return { ok: false, message: 'The deploy artifact must be a file inside the working directory.' };
	}
	if (!/\.(jar|zip)$/i.test(input.artifactPath)) {
		return { ok: false, message: 'The deploy artifact must be a .jar or .zip file.' };
	}
	const missing = missingEnvKeys(input.envText, input.provider);
	if (missing.length > 0) {
		return { ok: false, message: `Missing .env keys: ${missing.join('; ')}. Do not paste secret values.`, missing };
	}
	const { env, secretValues } = childEnv(input.envText, input.baseEnv ?? {});
	const cwd = path.resolve(input.workingDirectory);
	const artifact = path.resolve(input.artifactPath);
	if (input.provider === 'gcp') {
		const region = env.GOOGLE_CLOUD_REGION ?? '';
		return {
			ok: true,
			secretValues,
			env,
			plan: {
				executable: 'gcloud',
				args: ['functions', 'deploy', input.functionName, '--gen2', '--region', region, '--source', path.dirname(artifact)],
				cwd,
				summary: `gcloud functions deploy ${input.functionName} --gen2 --region ${region}`,
			},
		};
	}
	return {
		ok: true,
		secretValues,
		env,
		plan: {
			executable: 'aws',
			args: ['lambda', 'update-function-code', '--function-name', input.functionName, '--zip-file', `fileb://${artifact}`],
			cwd,
			summary: `aws lambda update-function-code --function-name ${input.functionName} --zip-file fileb://<artifact>`,
		},
	};
}
