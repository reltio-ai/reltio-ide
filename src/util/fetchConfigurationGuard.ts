import { jsonDeepEqual } from './jsonDeepEqual';

export function tryParseJson(text: string): unknown | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * True when local L3 text differs from the on-disk remote baseline snapshot.
 * Missing or unparsable baseline is treated as "has unpublished local changes".
 */
export function hasUnpublishedLocalChangesFromText(
	localText: string,
	baselineText: string | undefined,
): boolean {
	if (baselineText === undefined) {
		return true;
	}
	const localJson = tryParseJson(localText);
	const baselineJson = tryParseJson(baselineText);
	if (localJson === undefined || baselineJson === undefined) {
		return true;
	}
	return !jsonDeepEqual(localJson, baselineJson);
}

/** True when live remote configuration still matches the last-fetch baseline. */
export function remoteMatchesBaseline(baselineText: string, remoteText: string): boolean {
	const baselineJson = tryParseJson(baselineText);
	const remoteJson = tryParseJson(remoteText);
	if (baselineJson === undefined || remoteJson === undefined) {
		return false;
	}
	return jsonDeepEqual(baselineJson, remoteJson);
}
