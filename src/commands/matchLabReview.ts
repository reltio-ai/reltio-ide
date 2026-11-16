import * as vscode from 'vscode';
import {
	countEntities,
	getDataQualityStatistic,
	getEntitiesByUris,
	getEntityMatches,
	getTenantMatchingStatus,
	searchEntities,
	ReltioApiError,
} from '../matchLab/reltioApi';
import type { TokenStore } from '../api/tokenStore';
import type { EnvironmentManager } from '../workspace/environmentManager';
import { ConfigTreeItem } from '../tree/treeNodes';
import { pathTenantLocFromL3Path } from '../util/pathTenantLoc';
import { parseDocument } from '../parser/configParser';
import { runMatchLab, chatSummary } from '../matchLab/runMatchLab';
import { entityTypeIndexFromJsonPath, entityTypeUriFromJsonPath } from '../matchLab/entityScope';
import { shortNameFromUri } from '../matchLab/entityUris';
import { MatchingNotIdleError } from '../matchLab/types';
import type { FillRateScope, MatchLabApi } from '../matchLab/types';
import { MatchLabPanelManager } from '../matchLab/matchLabPanel';

export interface MatchLabReviewDeps {
	environmentManager: EnvironmentManager;
	tokenStore: TokenStore;
	extensionUri: vscode.Uri;
	panel: MatchLabPanelManager;
	getSelectedTreeItem: () => unknown;
}

/**
 * The run already wrote the .xlsx beside the JSON; this just tells the user it exists and hands
 * it to whatever they use for spreadsheets, since the webview cannot be shared with a customer.
 */
async function offerExcelExport(
	file: { entityType: string; path: string } | undefined,
	summary: string,
): Promise<void> {
	if (!file) {
		void vscode.window.showInformationMessage(summary);
		return;
	}
	const xlsx = vscode.Uri.file(file.path.replace(/\.json$/, '.xlsx'));
	const open = 'Open Excel file';
	const reveal = 'Show in folder';
	const choice = await vscode.window.showInformationMessage(summary, open, reveal);
	if (choice === open) await vscode.env.openExternal(xlsx);
	if (choice === reveal) await vscode.commands.executeCommand('revealFileInOS', xlsx);
}

export function provideTokenMessage(environmentName: string): string {
	return `Provide Token for ${environmentName}, then run Match Lab Review again.`;
}

/**
 * Said when the run started with a token that Reltio then rejected. Distinct from
 * `provideTokenMessage` on purpose: the two used to read identically, so "I pasted a
 * fresh token and nothing changed" was indistinguishable from the token never being
 * stored against this environment in the first place.
 */
export function sessionExpiredMessage(environmentName: string): string {
	return `The session for ${environmentName} was rejected during the run (HTTP 401). The token was accepted when the run started, so it has expired or it lacks read access to this tenant. Provide Token again, then rerun Match Lab Review.`;
}

export function matchingNotIdleMessage(err: MatchingNotIdleError): string {
	const last = err.gate.last;
	const matching = last.matchingQueueSize ?? 'unreadable';
	const events = last.eventsQueueSize ?? 'unreadable';
	const status = last.status ?? 'missing';
	return [
		'Matching pipeline is not idle. Match Lab stopped.',
		`Matching queue size: ${matching}`,
		`Events queue size: ${events}`,
		`Status: ${status}`,
	].join('\n');
}

/**
 * Optional and user-supplied — never bundled. An empty setting means unused keys are
 * inferred from empty occupancy only.
 */
export function matchLabOptionalFiles(): { mappingFile?: string } {
	const cfg = vscode.workspace.getConfiguration('reltio');
	const mappingFile = (cfg.get<string>('matchLab.mappingFile') ?? '').trim();
	return { mappingFile: mappingFile || undefined };
}

/** Measurement breadth for fill rates, and how long a cached full pass stays usable. */
export function matchLabFillRateSettings(): {
	fillRateScope: FillRateScope;
	fillRateMaxAgeHours: number;
} {
	const cfg = vscode.workspace.getConfiguration('reltio');
	const scope = cfg.get<string>('matchLab.fillRateScope');
	const maxAge = cfg.get<number>('matchLab.fillRateMaxAgeHours');
	return {
		fillRateScope: scope === 'all' ? 'all' : 'candidates',
		fillRateMaxAgeHours: typeof maxAge === 'number' && maxAge > 0 ? maxAge : 168,
	};
}

/**
 * Match Lab Review also sits on an entity type and on its Match Groups folder, where the
 * node is a `ConfigTreeItem` carrying a path into L3 rather than a tenant id.
 */
async function entityTypeUriForNode(
	l3Uri: vscode.Uri,
	jsonPath: readonly (string | number)[],
): Promise<string | undefined> {
	if (entityTypeIndexFromJsonPath(jsonPath) == null) return undefined;
	const bytes = await vscode.workspace.fs.readFile(l3Uri);
	const { model } = parseDocument(Buffer.from(bytes).toString('utf8'));
	return entityTypeUriFromJsonPath(model, jsonPath);
}

function matchLabApi(): MatchLabApi {
	return {
		getTenantMatchingStatus,
		countEntities,
		searchEntities,
		getEntityMatches,
		getEntitiesByUris,
		getDataQualityStatistic,
	};
}

interface MatchLabTarget {
	tenantId: string;
	environmentName: string;
	l3Uri: vscode.Uri;
	entityTypeUri: string;
	scopeLabel: string;
	tenantRoot: string;
}

/**
 * Shared by Match Lab Review and the analyzer import: both hang off an entity type node
 * and both need the same tenant, L3 and entity-type resolution. Reports its own errors
 * and returns undefined rather than throwing.
 */
async function resolveMatchLabTarget(
	node: unknown,
	deps: MatchLabReviewDeps,
	action: string,
): Promise<MatchLabTarget | undefined> {
	const target = node ?? deps.getSelectedTreeItem();
	const scoped = target instanceof ConfigTreeItem ? target : undefined;
	if (!scoped || entityTypeIndexFromJsonPath(scoped.jsonPath) == null) {
		void vscode.window.showErrorMessage(`Run ${action} from an entity type or its Match Groups section.`);
		return undefined;
	}
	const loc = pathTenantLocFromL3Path(scoped.tenantL3Uri?.fsPath ?? '');
	const tenantId = loc?.tenantId;
	const environmentName = loc?.environmentName;
	if (!tenantId || !environmentName) {
		void vscode.window.showErrorMessage(`Run ${action} from a tenant that already has L3.`);
		return undefined;
	}

	const l3Uri = deps.environmentManager.getL3Uri(environmentName, tenantId);
	try {
		await vscode.workspace.fs.stat(l3Uri);
	} catch {
		void vscode.window.showErrorMessage(
			`L3 is missing for ${tenantId}. Fetch Configuration first — Match Lab does not download L3.`,
		);
		return undefined;
	}

	const entityTypeUri = await entityTypeUriForNode(l3Uri, scoped.jsonPath);
	if (!entityTypeUri) {
		void vscode.window.showErrorMessage(`Run ${action} from an entity type or its Match Groups section.`);
		return undefined;
	}
	return {
		tenantId,
		environmentName,
		l3Uri,
		entityTypeUri,
		scopeLabel: shortNameFromUri(entityTypeUri),
		tenantRoot: deps.environmentManager.getTenantRootUri(environmentName, tenantId).fsPath,
	};
}

export async function runMatchLabReviewCommand(
	node: unknown,
	deps: MatchLabReviewDeps,
): Promise<void> {
	const resolved = await resolveMatchLabTarget(node, deps, 'Match Lab Review');
	if (!resolved) return;
	const { tenantId, environmentName, l3Uri, entityTypeUri, scopeLabel, tenantRoot } = resolved;
	const entityTypeUris = [entityTypeUri];

	const token = deps.tokenStore.getToken(environmentName);
	if (!token) {
		void vscode.window.showErrorMessage(
			`No token is stored for ${environmentName}. ${provideTokenMessage(environmentName)}`,
		);
		return;
	}

	const { mappingFile } = matchLabOptionalFiles();
	const { fillRateScope, fillRateMaxAgeHours } = matchLabFillRateSettings();

	try {
		const result = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Match Lab: ${scopeLabel}`,
				cancellable: false,
			},
			() =>
				runMatchLab(environmentName, tenantId, token, l3Uri.fsPath, {
					api: matchLabApi(),
					tenantRoot,
					mappingFile,
					fillRateScope,
					fillRateMaxAgeHours,
					entityTypeUris,
					// No per-step message: VS Code appends it to the title, which turned
					// the notification into "Match Lab: Contact: Census: Contact".
				}),
		);
		const freshWorkbooks = result.entityFiles.map(f => f.workbook).filter((w): w is NonNullable<typeof w> => !!w);
		await deps.panel.show({
			tenantId,
			tenantRoot,
			extensionUri: deps.extensionUri,
			selectedEntity: result.entityFiles[0]?.entityType,
			workbooks: freshWorkbooks.length > 0 ? freshWorkbooks : undefined,
		});
		void offerExcelExport(result.entityFiles[0], chatSummary(result));
	} catch (e) {
		if (e instanceof MatchingNotIdleError) {
			void vscode.window.showWarningMessage(matchingNotIdleMessage(e));
			return;
		}
		if (e instanceof ReltioApiError && e.statusCode === 401) {
			void vscode.window.showErrorMessage(sessionExpiredMessage(environmentName));
			return;
		}
		void vscode.window.showErrorMessage(`Match Lab failed: ${(e as Error).message}`);
	}
}
