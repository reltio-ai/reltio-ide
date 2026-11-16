import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MATCH_LAB_DIRNAME } from './matchingGate';
import type { AgentSuggestionsFile, FillRateCacheFile, FillRateScope } from './types';
import type { EntityWorkbook } from './workbook';
import { buildXlsx } from './xlsx';
import type { XlsxSheet } from './xlsx';

export const FILL_RATE_CACHE_SUFFIX = '.fill-rates.json';
export const AGENT_SUGGESTIONS_SUFFIX = '.suggestions.json';
export function entityWorkbookPath(tenantRoot: string, entityTypeShortName: string): string {
	return path.join(tenantRoot, MATCH_LAB_DIRNAME, `${entityTypeShortName}.json`);
}

export function entityWorkbookXlsxPath(tenantRoot: string, entityTypeShortName: string): string {
	return path.join(tenantRoot, MATCH_LAB_DIRNAME, `${entityTypeShortName}.xlsx`);
}

/** The panel reads the JSON; the .xlsx is the shareable copy, one sheet per tab. */
export async function writeEntityWorkbook(tenantRoot: string, workbook: EntityWorkbook): Promise<string> {
	const file = entityWorkbookPath(tenantRoot, workbook.entityType);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify(workbook, null, 2), 'utf8');
	await fs.writeFile(
		entityWorkbookXlsxPath(tenantRoot, workbook.entityType),
		buildXlsx(workbookSheets(workbook)),
	);
	return file;
}

export function workbookSheets(workbook: EntityWorkbook): XlsxSheet[] {
	const sheets: XlsxSheet[] = [];
	for (const name of workbook.tabOrder) {
		const tab = workbook.tabs[name];
		if (!tab) continue;
		// The panel shows `docs` above the table; in a spreadsheet it has to become a row.
		const rows = tab.docs
			? [{ [tab.columns[0]]: tab.docs }, Object.fromEntries(tab.columns.map(c => [c, ''])), ...tab.rows]
			: tab.rows;
		sheets.push({ name, columns: tab.columns, rows });
	}
	return sheets;
}

export function fillRateCachePath(tenantRoot: string, entityTypeShortName: string): string {
	return path.join(tenantRoot, MATCH_LAB_DIRNAME, `${entityTypeShortName}${FILL_RATE_CACHE_SUFFIX}`);
}

export function agentSuggestionsPath(tenantRoot: string, entityTypeShortName: string): string {
	return path.join(tenantRoot, MATCH_LAB_DIRNAME, `${entityTypeShortName}${AGENT_SUGGESTIONS_SUFFIX}`);
}

async function readJsonFile<T>(file: string): Promise<T | undefined> {
	try {
		return JSON.parse(await fs.readFile(file, 'utf8')) as T;
	} catch {
		return undefined;
	}
}

export async function readFillRateCache(
	tenantRoot: string,
	entityTypeShortName: string,
): Promise<FillRateCacheFile | undefined> {
	const file = await readJsonFile<FillRateCacheFile>(fillRateCachePath(tenantRoot, entityTypeShortName));
	return file && Array.isArray(file.rows) ? file : undefined;
}

/**
 * A cache answers a request only when it was taken by this engine, for this type, at a
 * scope at least as broad as the one asked for, and recently enough to still describe
 * the tenant. Anything else re-measures rather than showing stale numbers as current.
 */
export function fillRateCacheUsable(
	file: FillRateCacheFile | undefined,
	want: {
		engineVersion: string;
		entityTypeUri: string;
		scope: FillRateScope;
		maxAgeHours: number;
		now?: Date;
	},
): boolean {
	if (!file) return false;
	if (file.engineVersion !== want.engineVersion) return false;
	if (file.entityTypeUri !== want.entityTypeUri) return false;
	if (want.scope === 'all' && file.scope !== 'all') return false;
	const measured = Date.parse(file.measuredAt);
	if (!Number.isFinite(measured)) return false;
	const ageHours = ((want.now ?? new Date()).getTime() - measured) / 3_600_000;
	return ageHours >= 0 && ageHours <= want.maxAgeHours;
}

export async function writeFillRateCache(
	tenantRoot: string,
	entityTypeShortName: string,
	file: FillRateCacheFile,
): Promise<string> {
	const out = fillRateCachePath(tenantRoot, entityTypeShortName);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, JSON.stringify(file, null, 2), 'utf8');
	return out;
}

export async function readAgentSuggestions(
	tenantRoot: string,
	entityTypeShortName: string,
): Promise<AgentSuggestionsFile | undefined> {
	const file = await readJsonFile<AgentSuggestionsFile>(
		agentSuggestionsPath(tenantRoot, entityTypeShortName),
	);
	return file && Array.isArray(file.rows) ? file : undefined;
}
