import type { MatchLabRuleInventory } from './types';

const DICTIONARY_RE = /dictionary|namedictionary/i;
const FUZZY_RE = /metaphone|soundex|fuzzy|levenshtein|damerau|organizationnames|characterscomparator|doublemetaphone/i;
const EXACT_RE = /basicstringcomparator|exactmatch/i;

function lastSeg(uri: string): string {
	const parts = uri.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? uri;
}

function valuesDiffer(a: string | undefined, b: string | undefined): boolean {
	const av = (a ?? '').trim().toLowerCase();
	const bv = (b ?? '').trim().toLowerCase();
	if (!av && !bv) return false;
	return av !== bv;
}

/**
 * Non-obvious engine behavior only (e.g. name dictionary). Blank on a plain exact hit.
 */
export function whyItMatched(
	rule: MatchLabRuleInventory,
	aValues: Record<string, string>,
	bValues: Record<string, string>,
): string {
	const notes: string[] = [];
	const hasDictionaryCleanse = rule.cleanseAdapters.some(c => DICTIONARY_RE.test(c));
	if (hasDictionaryCleanse) {
		const nameKeys = Object.keys(aValues).filter(k => /name/i.test(k));
		const nameDiffers = nameKeys.some(k => valuesDiffer(aValues[k], bValues[k]));
		if (nameDiffers || nameKeys.length === 0) {
			notes.push('Name dictionary');
		}
	}

	for (const cmp of rule.comparatorClasses) {
		const attrName = lastSeg(cmp.attributeUri);
		const a = attrName ? aValues[attrName] : undefined;
		const b = attrName ? bValues[attrName] : undefined;
		if (DICTIONARY_RE.test(cmp.className) && valuesDiffer(a, b)) {
			notes.push('Name dictionary');
			continue;
		}
		if (FUZZY_RE.test(cmp.className) && valuesDiffer(a, b)) {
			const short = cmp.className.split('.').pop() ?? cmp.className;
			notes.push(`${short} (values differ)`);
		}
	}

	if (notes.length === 0) {
		const anyFuzzyClass = rule.comparatorClasses.some(c => FUZZY_RE.test(c.className) && !EXACT_RE.test(c.className));
		if (anyFuzzyClass) {
			const fuzzyAttrs = rule.comparedAttributeUris.filter(uri => {
				const name = lastSeg(uri);
				return valuesDiffer(aValues[name], bValues[name]);
			});
			if (fuzzyAttrs.length > 0) {
				notes.push('Fuzzy / phonetic match (not a plain exact hit)');
			}
		}
	}

	return [...new Set(notes)].join('; ');
}
