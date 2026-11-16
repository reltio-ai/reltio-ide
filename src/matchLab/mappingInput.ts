import * as fs from 'node:fs/promises';
import type { MatchLabMappingInput } from './types';

function stringsFrom(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(v => {
			if (typeof v === 'string') return v;
			if (v && typeof v === 'object') {
				const rec = v as Record<string, unknown>;
				for (const key of ['uri', 'attribute', 'attributeUri', 'name']) {
					if (typeof rec[key] === 'string') return rec[key] as string;
				}
			}
			return '';
		})
		.filter(s => s.trim().length > 0);
}

/** Never bundled — the user points at their own file. */
export function parseMappingInput(raw: unknown, source: string): MatchLabMappingInput | undefined {
	const intended = Array.isArray(raw)
		? stringsFrom(raw)
		: raw && typeof raw === 'object'
			? [
					...stringsFrom((raw as Record<string, unknown>).intendedAttributes),
					...stringsFrom((raw as Record<string, unknown>).mappedAttributes),
					...stringsFrom((raw as Record<string, unknown>).attributes),
				]
			: [];
	if (intended.length === 0) return undefined;
	return { source, intendedAttributes: [...new Set(intended)] };
}

export async function loadMappingInput(filePath: string): Promise<MatchLabMappingInput | undefined> {
	try {
		const text = await fs.readFile(filePath, 'utf8');
		return parseMappingInput(JSON.parse(text), filePath);
	} catch {
		return undefined;
	}
}
