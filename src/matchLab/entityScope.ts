import type { ReltioBusinessModel } from '../model/types';

/**
 * A tree node under `entityTypes[i]` scopes a Match Lab run to that one entity type.
 * Covers both the entity type itself and its Match Groups folder, whose paths are
 * `['entityTypes', i]` and `['entityTypes', i, 'matchGroups']`.
 */
export function entityTypeIndexFromJsonPath(jsonPath: readonly (string | number)[]): number | undefined {
	if (jsonPath[0] !== 'entityTypes') return undefined;
	const index = jsonPath[1];
	return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : undefined;
}

/** URI of the entity type a scoped node points at, or undefined when the path does not resolve. */
export function entityTypeUriFromJsonPath(
	model: ReltioBusinessModel,
	jsonPath: readonly (string | number)[],
): string | undefined {
	const index = entityTypeIndexFromJsonPath(jsonPath);
	if (index == null) return undefined;
	const uri = (model.entityTypes ?? [])[index]?.uri;
	return typeof uri === 'string' && uri.length > 0 ? uri : undefined;
}
