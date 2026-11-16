import { shortNameFromUri } from './entityUris';
import { comparisonNotes, hiddenKeysNote, labNotesText } from './recommendations';
import type { MatchLabRuleInventory } from './types';

/**
 * What L3 itself says about the rule, as Lab notes bullets (never census HTTP errors). Type and
 * scope are left out — Rule Activity gives each its own column. Plain exact comparison adds
 * nothing a reader can act on, so it is not mentioned.
 */
export function buildL3RuleNotes(rule: MatchLabRuleInventory): string {
	const bits: string[] = [];
	if (rule.hiddenAttributeUris.length > 0) {
		bits.push(hiddenKeysNote(rule.hiddenAttributeUris.map(uri => shortNameFromUri(uri))));
	}
	const howCompared = comparisonNotes(rule).join(' ');
	if (howCompared) bits.push(howCompared);
	return labNotesText(bits);
}
