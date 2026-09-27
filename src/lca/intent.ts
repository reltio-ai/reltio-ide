import { ALL_LCA_HOOKS } from './hooks';

export type LcaIntent = 'advise' | 'inspect' | 'generate' | 'update' | 'register' | 'validation-only';

export type TurnAct = 'ask' | 'generate' | 'update' | 'register' | 'validation-only' | 'deploy' | 'test' | 'update-l3' | 'approve' | 'inspect';

const REGISTER = /\b(lambda\/binaryjson\/|googlefunction\/binaryjson\/|azurefunction\/binaryjson\/|reltio\/)/i;
const INSPECT = /\b(what lcas|show lifecycleactions|lifecycleactions for|which lcas|list lifecycle)\b/i;
const UPDATE = /\b(update|modify|change)\b[\s\S]{0,80}\blca\b|\b(update the existing|add another hook|add aftersave|add beforesave|modify|change the current)\b/i;
const GENERATE = /\b(create|generate|scaffold|write|build|implement)\b.*\blca\b|\blca\b.*\b(for|on)\b/i;
const VALIDATION = /\bvalidate\b|\bmust be\b|\bexactly \d+ digits\b|\brequired field\b/i;
const MUTATION = /\b(generate|populate|set|add|update|enrich|call|send|api|lambda|beforeSave|afterSave)\b/i;
const DEPLOY = /\b(deploy|publish)\b/i;
const TEST = /\b(unit test|integration test|invoke|sample request|check the logs|how do i test|help me test|test this|test the)\b/i;
const UPDATE_L3 = /\b(update|patch|apply|change|register|link)\b[\s\S]{0,48}\b(l3|lifecycleactions|tenant)\b|\blifecycleactions\b[\s\S]{0,48}\b(update|patch|apply|change|register)\b/i;

function isImperativeAction(text: string): boolean {
	const value = text.trim();
	if (/^(please\s+)?(generate|create|scaffold|write|build|implement|deploy|publish|apply|register|update|add)\b/i.test(value)) {
		return true;
	}
	return /\b(generate|create|scaffold|write|build|implement)\b.*\blca\b/i.test(value);
}

/**
 * A question or explanation is not a build request.
 * Mentioning LCA, a hook, or a tenant problem does not start implementation.
 */
export function isAdviceQuestion(text: string): boolean {
	const value = text.trim();
	if (isImperativeAction(value)) return false;
	if (/[?]\s*$/.test(value)) return true;
	if (/^(what|how|why|when|where|which|who|explain|describe|tell me|can you explain)\b/i.test(value)) return true;
	if (/\b(whether|right mechanism|understand the capability|looking to understand|have never implemented|researching)\b/i.test(value)) return true;
	return false;
}

const APPROVAL_START = /^(yes|yep|yeah|y|ok|okay|approve|approved|go ahead|proceed|confirmed|confirm|lgtm|do it)\b/i;
const APPROVAL_CAVEAT = /\b(but|however|first|wait|explain|don't|do not|not yet|hold on|what|how|why|when|where|which|who)\b/i;

/**
 * Yes / proceed for the gate that is already waiting.
 * A leading yes that asks a question, adds a correction, or starts deploy or an L3 edit is not approval.
 */
export function isExplicitApproval(text: string): boolean {
	const value = text.trim();
	if (!APPROVAL_START.test(value) || /[?]/.test(value) || APPROVAL_CAVEAT.test(value)) return false;
	if (DEPLOY.test(value) || UPDATE_L3.test(value)) return false;
	return true;
}

/** Classify the user request. Validation-only stays on DVF and does not start LCA generation. */
export function classifyLcaIntent(text: string): LcaIntent {
	const value = text.trim();
	if (REGISTER.test(value) && /\b(add|register|append)\b/i.test(value)) {
		return 'register';
	}
	if (INSPECT.test(value)) return 'inspect';
	if (VALIDATION.test(value) && !MUTATION.test(value) && !/\blca\b/i.test(value)) {
		return 'validation-only';
	}
	if (isAdviceQuestion(value)) return 'advise';
	if (UPDATE.test(value)) return 'update';
	if (GENERATE.test(value)) return 'generate';
	return 'advise';
}

/** What this utterance is trying to do. Questions stay `ask` even when they mention testing or LCA. */
export function classifyTurn(text: string): TurnAct {
	const value = text.trim();
	if (isAdviceQuestion(value)) return 'ask';
	if (TEST.test(value) && !/\b(generate|create|scaffold|write|build|implement)\b/i.test(value)) return 'test';
	if (isExplicitApproval(value) && !DEPLOY.test(value) && !UPDATE_L3.test(value) && !GENERATE.test(value)) {
		return 'approve';
	}
	const intent = classifyLcaIntent(value);
	if (intent === 'register') return 'register';
	if (UPDATE_L3.test(value) && !isAdviceQuestion(value)) return 'update-l3';
	if (intent === 'inspect') return 'inspect';
	if (intent === 'validation-only') return 'validation-only';
	if (DEPLOY.test(value) && !isAdviceQuestion(value)) return 'deploy';
	if (TEST.test(value)) return 'test';
	if (intent === 'update') return 'update';
	if (intent === 'generate') return 'generate';
	if (isExplicitApproval(value)) return 'approve';
	return 'ask';
}

const GENERIC_TOKENS = new Set([
	'A', 'An', 'API', 'AWS', 'Azure', 'Can', 'Could', 'DVF', 'Do', 'Does', 'Explain', 'For', 'GCP',
	'How', 'HTTP', 'HTTPS', 'I', 'ID', 'JSON', 'JVM', 'KB', 'L3', 'LCA', 'OK', 'Please', 'SDK', 'SQL',
	'The', 'URI', 'URL', 'What', 'When', 'Where', 'Which', 'Who', 'Why', 'Would', 'XML',
]);

/** Advice that names a tenant object, not only HCP / HCO / HasAddress. */
function mentionsTenantObject(text: string): boolean {
	if (/\b(our|this|my|connected)\s+tenant\b|\blifecycleactions\b|\b(entity|relation|change[- ]request|dcr|object)\s+types?\b|\btypes?\s+[A-Za-z][A-Za-z0-9_]*\b/i.test(text)) {
		return true;
	}
	const hooks = new Set(ALL_LCA_HOOKS.map(hook => hook.toLowerCase()));
	const tokens = text.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? [];
	const quoted = [...text.matchAll(/`([^`]+)`/g)].map(match => match[1]);
	for (const token of [...tokens, ...quoted]) {
		const name = token.trim();
		if (!name || GENERIC_TOKENS.has(name) || hooks.has(name.toLowerCase())) continue;
		if (/^[A-Z0-9_]+$/.test(name) && name.length <= 2) continue;
		return true;
	}
	return false;
}

export function tenantAwareIntent(text: string, intent: LcaIntent): boolean {
	if (intent === 'advise' && !mentionsTenantObject(text)) {
		return false;
	}
	return true;
}
