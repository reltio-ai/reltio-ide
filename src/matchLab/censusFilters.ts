/** Reltio search filters to count profiles with a potential match on one match group. */

export function typeEqualsFilter(entityTypeUri: string): string {
	return `equals(type,'${entityTypeUri}')`;
}

/** Profile count (not unique pairs): type + has matches + this match group. */
export function censusFilterForRule(entityTypeUri: string, ruleUri: string): string {
	return `equals(type,'${entityTypeUri}') and gt(matches,0) and equals(matchRules,'${ruleUri}')`;
}

const ATTRIBUTE_MARKER = '/attributes/';

/**
 * Dotted search path for an attribute URI. Nested attributes carry a repeated
 * `/attributes/` segment, so `…/Contact/attributes/Phone/attributes/FormattedNumber`
 * has to become `Phone.FormattedNumber` — the last segment alone matches nothing.
 */
export function attributeSearchPath(attributeUri: string): string {
	const i = attributeUri.indexOf(ATTRIBUTE_MARKER);
	if (i === -1) return shortName(attributeUri);
	return attributeUri
		.slice(i + ATTRIBUTE_MARKER.length)
		.split(ATTRIBUTE_MARKER)
		.filter(Boolean)
		.join('.');
}

export function existsAttributeFilter(entityTypeUri: string, attributeUri: string): string {
	return `equals(type,'${entityTypeUri}') and exists(attributes.${attributeSearchPath(attributeUri)})`;
}

/** Occupancy: profiles that populate every exact key of one rule. */
export function existsAllAttributesFilter(entityTypeUri: string, attributeUris: string[]): string {
	const clauses = [...new Set(attributeUris.map(attributeSearchPath))].map(
		path => `exists(attributes.${path})`,
	);
	return [`equals(type,'${entityTypeUri}')`, ...clauses].join(' and ');
}

function shortName(ruleUri: string): string {
	const parts = ruleUri.split('/');
	return parts[parts.length - 1] || ruleUri;
}
