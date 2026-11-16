import type { MatchRule } from '../model/types';
import { shortNameFromUri } from './entityUris';

function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

function uriList(uris?: string[]): string {
	return (uris ?? []).map(shortNameFromUri).join(', ');
}

/**
 * Compact readable summary of an L3 match rule (and / exact / fuzzy).
 * Not Forge format_match_rule.py.
 */
export function formatMatchRule(rule?: MatchRule): string {
	if (!rule) return '';
	const bits: string[] = [];
	const ands = asArray(rule.and).map(formatMatchRule).filter(Boolean);
	if (ands.length) bits.push(`and(${ands.join('; ')})`);
	const ors = asArray(rule.or).map(formatMatchRule).filter(Boolean);
	if (ors.length) bits.push(`or(${ors.join('; ')})`);
	const nots = asArray(rule.not).map(formatMatchRule).filter(Boolean);
	if (nots.length) bits.push(`not(${nots.join('; ')})`);
	if (rule.exact?.length) bits.push(`exact: ${uriList(rule.exact)}`);
	if (rule.fuzzy?.length) bits.push(`fuzzy: ${uriList(rule.fuzzy)}`);
	if (rule.exactOrNull?.length) bits.push(`exactOrNull: ${uriList(rule.exactOrNull)}`);
	if (rule.exactOrAllNull?.length) bits.push(`exactOrAllNull: ${uriList(rule.exactOrAllNull)}`);
	if (rule.equals?.length) {
		bits.push(
			`equals: ${rule.equals.map(op => `${shortNameFromUri(op.uri)}=${stringifyEquals(op.value ?? op.values)}`).join(', ')}`,
		);
	}
	if (rule.ignoreInToken?.length) bits.push(`ignoreInToken: ${uriList(rule.ignoreInToken)}`);
	return bits.join('; ');
}

function stringifyEquals(value: unknown): string {
	if (Array.isArray(value)) return value.map(String).join('|');
	if (value == null) return '';
	return String(value);
}
