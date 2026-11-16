import type { Attribute, EntityType, MatchGroup, MatchRule, ReltioBusinessModel } from '../model/types';
import { shortNameFromUri } from './entityUris';
import { classifyAttrFamily, isSsnAttribute } from './attributeFamilies';
import { formatMatchRule } from './formatMatchRule';
import type { MatchLabAttrMeta, MatchLabRuleInventory, MatchLabTypeInventory } from './types';

function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

function isHiddenFlag(hidden: unknown): boolean {
	return hidden === true || hidden === 'true';
}

/** Hidden FERN groups are not rule tabs and not "Also matched by". */
export function isFernMatchGroup(group: MatchGroup): boolean {
	const meta = group.matchMethodMetadata;
	if (!meta) return false;
	if (typeof meta.origin === 'string' && meta.origin.trim().toLowerCase() === 'fern') return true;
	if (typeof meta.packageProfile === 'string' && meta.packageProfile.trim().toLowerCase().startsWith('fern_')) {
		return true;
	}
	return false;
}

function walkAttributes(attrs: Attribute[] | undefined, out: MatchLabAttrMeta[], parentUri?: string): void {
	for (const attr of attrs ?? []) {
		if (!attr?.uri) continue;
		const name = attr.name || shortNameFromUri(attr.uri);
		out.push({
			uri: attr.uri,
			name,
			label: attr.label || name,
			family: classifyAttrFamily(attr.uri, name, attr.label),
			hidden: isHiddenFlag(attr.hidden),
			maskSsn: isSsnAttribute(attr.uri, name, attr.label),
			...(attr.type ? { dataType: attr.type } : {}),
			...(parentUri ? { parentUri } : {}),
		});
		if (attr.attributes) walkAttributes(attr.attributes, out, attr.uri);
	}
}

function collectRuleAttributeUris(rule: MatchRule | undefined, into: Set<string>): void {
	if (!rule) return;
	for (const uri of [
		...(rule.exact ?? []),
		...(rule.fuzzy ?? []),
		...(rule.exactOrNull ?? []),
		...(rule.exactOrAllNull ?? []),
		...(rule.ignoreInToken ?? []),
	]) {
		if (typeof uri === 'string' && uri.length > 0) into.add(uri);
	}
	for (const op of rule.notExact ?? []) {
		if (op?.uri) into.add(op.uri);
	}
	for (const op of [...(rule.equals ?? []), ...(rule.notEquals ?? []), ...(rule.in ?? [])]) {
		if (op?.uri) into.add(op.uri);
	}
	for (const op of rule.multi ?? []) {
		if (op?.uri) into.add(op.uri);
		for (const a of op?.attributes ?? []) into.add(a);
	}
	for (const child of [...asArray(rule.and), ...asArray(rule.or), ...asArray(rule.not)]) {
		collectRuleAttributeUris(child, into);
	}
}

function collectCleansers(rule: MatchRule | undefined, into: string[]): void {
	if (!rule) return;
	for (const step of asArray(rule.cleanse)) {
		if (step && typeof step === 'object' && 'cleanseAdapter' in step && typeof step.cleanseAdapter === 'string') {
			into.push(step.cleanseAdapter);
		}
	}
	for (const child of [...asArray(rule.and), ...asArray(rule.or), ...asArray(rule.not)]) {
		collectCleansers(child, into);
	}
}

function collectComparators(
	rule: MatchRule | undefined,
	into: { attributeUri: string; className: string }[],
): void {
	if (!rule) return;
	const mappings = asArray(rule.comparatorClasses?.mapping);
	for (const m of mappings) {
		if (m?.attribute && m?.class) into.push({ attributeUri: m.attribute, className: m.class });
	}
	const generic = rule.comparatorClass as { class?: string } | string | undefined;
	if (typeof generic === 'string') {
		into.push({ attributeUri: '', className: generic });
	} else if (generic && typeof generic.class === 'string') {
		into.push({ attributeUri: '', className: generic.class });
	}
	for (const child of [...asArray(rule.and), ...asArray(rule.or), ...asArray(rule.not)]) {
		collectComparators(child, into);
	}
}

/**
 * Exact keys produce match tokens; exact-or-null and negative clauses do not.
 * Exact keys reached through a `not` subtree count as negative, not positive.
 */
function collectKeyRoles(
	rule: MatchRule | undefined,
	roles: { exact: Set<string>; exactOrNull: Set<string>; negative: Set<string> },
	negated = false,
): void {
	if (!rule) return;
	const exactSink = negated ? roles.negative : roles.exact;
	for (const uri of rule.exact ?? []) {
		if (typeof uri === 'string' && uri.length > 0) exactSink.add(uri);
	}
	for (const uri of [...(rule.exactOrNull ?? []), ...(rule.exactOrAllNull ?? [])]) {
		if (typeof uri !== 'string' || uri.length === 0) continue;
		(negated ? roles.negative : roles.exactOrNull).add(uri);
	}
	for (const op of [...(rule.notExact ?? []), ...(rule.notEquals ?? [])]) {
		if (op?.uri) roles.negative.add(op.uri);
	}
	for (const child of [...asArray(rule.and), ...asArray(rule.or)]) {
		collectKeyRoles(child, roles, negated);
	}
	for (const child of asArray(rule.not)) {
		collectKeyRoles(child, roles, true);
	}
}

function inventoryRule(group: MatchGroup, hiddenUris: Set<string>): MatchLabRuleInventory {
	const compared = new Set<string>();
	collectRuleAttributeUris(group.rule, compared);
	const roles = { exact: new Set<string>(), exactOrNull: new Set<string>(), negative: new Set<string>() };
	collectKeyRoles(group.rule, roles);
	const cleanseAdapters: string[] = [];
	collectCleansers(group.rule, cleanseAdapters);
	const comparatorClasses: { attributeUri: string; className: string }[] = [];
	collectComparators(group.rule, comparatorClasses);
	return {
		uri: group.uri,
		shortName: shortNameFromUri(group.uri),
		label: group.label || shortNameFromUri(group.uri),
		type: group.type || '',
		scope: group.scope ? String(group.scope) : '',
		hiddenAttributeUris: [...compared].filter(uri => hiddenUris.has(uri)),
		cleanseAdapters,
		comparatorClasses,
		comparedAttributeUris: [...compared],
		exactAttributeUris: [...roles.exact],
		exactOrNullAttributeUris: [...roles.exactOrNull].filter(uri => !roles.exact.has(uri)),
		negativeOnlyAttributeUris: [...roles.negative].filter(
			uri => !roles.exact.has(uri) && !roles.exactOrNull.has(uri),
		),
		formattedRule: formatMatchRule(group.rule),
		isFern: isFernMatchGroup(group),
	};
}

/**
 * One entity type, whether or not it declares match groups. A type with no rules still has
 * attributes worth measuring, so a scoped run can report what data exists to build a rule from.
 */
export function inventoryMatchLabType(et: EntityType): MatchLabTypeInventory {
	const attributes: MatchLabAttrMeta[] = [];
	walkAttributes(et.attributes, attributes);
	const hiddenUris = new Set(attributes.filter(a => a.hidden).map(a => a.uri));
	const groups = (et.matchGroups ?? []).filter(g => g?.uri);
	const automatic = groups.filter(isAutomaticMatchGroup);
	return {
		entityTypeUri: et.uri,
		shortName: shortNameFromUri(et.uri),
		label: et.label || shortNameFromUri(et.uri),
		matchGroups: groups.filter(g => !isAutomaticMatchGroup(g)).map(g => inventoryRule(g, hiddenUris)),
		...(automatic.length > 0 ? { automaticRuleNames: automatic.map(g => shortNameFromUri(g.uri)) } : {}),
		attributes,
	};
}

/**
 * A hand-built rule that merges what it finds instead of leaving potential matches to
 * review. FERN groups are kept either way: they are never shown as rules, but they
 * supply the FERN score on sampled pairs.
 */
export function isAutomaticMatchGroup(group: MatchGroup): boolean {
	return /^automatic/i.test(group.type ?? '') && !isFernMatchGroup(group);
}

export function inventoryMatchLabTypes(model: ReltioBusinessModel): MatchLabTypeInventory[] {
	const out: MatchLabTypeInventory[] = [];
	for (const et of model.entityTypes ?? []) {
		if ((et.matchGroups ?? []).length === 0) continue;
		out.push(inventoryMatchLabType(et));
	}
	return out;
}

export function entityTypeByUri(model: ReltioBusinessModel, uri: string): EntityType | undefined {
	return (model.entityTypes ?? []).find(et => et.uri === uri);
}
