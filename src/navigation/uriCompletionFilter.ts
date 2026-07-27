import type { UriCompletionScope } from './uriPropertyScopes';

export function filterDefinitionUris(
	defs: string[],
	scope: UriCompletionScope,
	entityTypeUriForAttributes: string | undefined,
): string[] {
	switch (scope) {
		case 'entityType':
			return defs.filter(u => /^configuration\/entityTypes\/[^/]+$/.test(u));
		case 'relationType':
			return defs.filter(u => /^configuration\/relationTypes\/[^/]+$/.test(u));
		case 'attributeUnderEntity': {
			if (entityTypeUriForAttributes) {
				const prefix = `${entityTypeUriForAttributes}/attributes/`;
				return defs.filter(u => u.startsWith(prefix));
			}
			return defs.filter(u => u.includes('/attributes/'));
		}
		case 'attributePath':
			return defs.filter(u => u.includes('/attributes/'));
		case 'source':
			return defs.filter(u => u.startsWith('configuration/sources/'));
		case 'matchGroup':
			return defs.filter(u => u.includes('/matchGroups/'));
		case 'survivorshipStrategy':
			return defs.filter(u => u.startsWith('configuration/survivorshipStrategies/'));
		case 'cleanseMapping':
			return defs.filter(u => u.includes('/cleanse/'));
		case 'extendsType':
			return defs.filter(
				u =>
					/^configuration\/entityTypes\/[^/]+$/.test(u) ||
					/^configuration\/relationTypes\/[^/]+$/.test(u) ||
					/^configuration\/attributeTypes\/[^/]+$/.test(u),
			);
		case 'verticalReference':
			return defs.filter(u => u.startsWith('configuration/_vertical/'));
		case 'role':
			return defs.filter(u => /^configuration\/roles\/[^/]+$/.test(u));
		case 'anyDefinition':
		default:
			return defs.slice();
	}
}
