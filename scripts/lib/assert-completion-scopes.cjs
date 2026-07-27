'use strict';

const assert = require('assert');
const { walkConfigurationUriSites } = require('./walk-configuration-uris.cjs');

/**
 * Self-oracle: scoped URI property values match filter rules (no hardcoded URI lists).
 * @param {import('jsonc-parser').Node} ast
 * @param {typeof import('../../dist/navigation/uriPropertyScopes').getUriCompletionScope} getUriCompletionScope
 * @param {typeof import('../../dist/navigation/uriCompletionFilter').filterDefinitionUris} filterDefinitionUris
 * @param {string[]} allDefinitionUris
 */
function assertCompletionScopeSelfOracle(
	ast,
	getUriCompletionScope,
	filterDefinitionUris,
	allDefinitionUris,
) {
	const entityTypePattern = /^configuration\/entityTypes\/[^/]+$/;
	const relationTypePattern = /^configuration\/relationTypes\/[^/]+$/;

	const entityFiltered = filterDefinitionUris(allDefinitionUris, 'entityType', undefined);
	for (const u of entityFiltered) {
		assert.ok(entityTypePattern.test(u), `entityType filter leaked non-entity URI: ${u}`);
		assert.ok(!u.includes('/attributes/'), `entityType filter includes attribute path: ${u}`);
	}

	const attrFiltered = filterDefinitionUris(allDefinitionUris, 'attributePath', undefined);
	for (const u of attrFiltered) {
		assert.ok(u.includes('/attributes/'), `attributePath filter missing /attributes/: ${u}`);
	}

	walkConfigurationUriSites(ast, ({ uri, node, propertyKey }) => {
		if (!propertyKey) {
			return;
		}
		const scope = getUriCompletionScope(propertyKey);
		if (!scope) {
			return;
		}
		switch (scope) {
			case 'entityType':
				assert.ok(
					entityTypePattern.test(uri),
					`entityType-scoped ${propertyKey} at ${node.offset} has non-entity URI: ${uri}`,
				);
				break;
			case 'relationType':
				assert.ok(
					relationTypePattern.test(uri),
					`relationType-scoped ${propertyKey} at ${node.offset}: ${uri}`,
				);
				break;
			case 'source':
				assert.ok(
					uri.startsWith('configuration/sources/'),
					`source-scoped ${propertyKey} at ${node.offset}: ${uri}`,
				);
				break;
			case 'cleanseMapping':
				assert.ok(
					uri.includes('/cleanse/'),
					`cleanseMapping-scoped ${propertyKey} at ${node.offset}: ${uri}`,
				);
				break;
			default:
				break;
		}
	});
}

module.exports = { assertCompletionScopeSelfOracle };
