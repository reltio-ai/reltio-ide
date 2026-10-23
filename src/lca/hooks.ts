import type { TargetKind } from './l3Lookup';

/** Entity and relation hooks. Change-request types use only `afterDCRSave`. */
export const ENTITY_RELATION_HOOKS = [
	'rawDataBeforeCleanse',
	'rawDataAfterCleanse',
	'beforeUpdate',
	'afterUpdateBeforeCleanse',
	'beforeSave',
	'afterSave',
	'beforeDelete',
	'afterDelete',
	'beforeOverride',
	'afterOverrideBeforeCleanse',
	'beforeMerge',
	'afterMerge',
	'beforeUnmerge',
	'afterUnmerge',
	'potentialMatchesFound',
	'potentialMatchesRemoved',
	'beforeNotAMatchSet',
	'afterNotAMatchSet',
	'beforeNotAMatchReset',
	'afterNotAMatchReset',
	'beforeMarkAsMatch',
	'afterMarkAsMatch',
	'beforeUnmarkAsMatch',
	'afterUnmarkAsMatch',
	'beforeReferenceAttributeAdded',
	'afterReferenceAttributeAdded',
	'beforeReferenceAttributeChanged',
	'afterReferenceAttributeChanged',
	'beforeReferenceAttributeRemoved',
	'afterReferenceAttributeRemoved',
	'validate',
] as const;

export const DCR_HOOKS = ['afterDCRSave'] as const;

export const ALL_LCA_HOOKS = [...ENTITY_RELATION_HOOKS, ...DCR_HOOKS];

const ENTITY = new Set<string>(ENTITY_RELATION_HOOKS);
const RELATION = new Set<string>(ENTITY_RELATION_HOOKS.filter(hook => hook !== 'validate'));
const DCR = new Set<string>(DCR_HOOKS);

export function hooksForKind(kind: TargetKind): readonly string[] {
	if (kind === 'changeRequest') return DCR_HOOKS;
	if (kind === 'relation') return ENTITY_RELATION_HOOKS.filter(hook => hook !== 'validate');
	return ENTITY_RELATION_HOOKS;
}

export function isKnownHook(hook: string): boolean {
	return (ALL_LCA_HOOKS as readonly string[]).includes(hook);
}

/** Case-sensitive. DCR types do not accept entity or relation hooks. */
export function validateHook(kind: TargetKind, hook: string): { ok: boolean; message?: string } {
	const allowed = kind === 'changeRequest' ? DCR : kind === 'relation' ? RELATION : ENTITY;
	if (allowed.has(hook)) return { ok: true };
	if (kind === 'changeRequest') {
		return { ok: false, message: `Change-request types only support afterDCRSave. "${hook}" is not valid.` };
	}
	if (kind === 'relation' && hook === 'validate') {
		return { ok: false, message: 'validate is not a supported relation hook. Use beforeSave or an entity validate hook.' };
	}
	if (isKnownHook(hook)) {
		return { ok: false, message: `"${hook}" does not apply to ${kind} types.` };
	}
	return { ok: false, message: `"${hook}" is not a supported LCA hook. Hook names are case-sensitive.` };
}
