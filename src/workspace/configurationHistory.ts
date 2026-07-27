import * as vscode from 'vscode';
import type { ConfigurationHistoryEntry } from '../api/reltioClient';

export const HISTORY_SNAPSHOT_SUFFIX = '.reltio.json';

export interface LocalHistorySnapshot {
	readonly fileUri: vscode.Uri;
	readonly timestampMs: number;
	readonly displayUser: string;
}

function sanitizeUpdatedBy(raw: string): string {
	return raw
		.replace(/[/\\:*?"<>|]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80) || 'unknown';
}

/** Stable filename: `L3-<sanitizedUpdatedBy>---<timestamp>.reltio.json`. */
export function historySnapshotFileName(entry: ConfigurationHistoryEntry): string {
	const u = sanitizeUpdatedBy(String(entry.updatedBy ?? 'unknown'));
	const ts = String(entry.timestamp);
	return `L3-${u}---${ts}${HISTORY_SNAPSHOT_SUFFIX}`;
}

/**
 * Parse `L3-<user>---<digits>.reltio.json` (timestamp is the final digit run before the suffix).
 * `displayUser` is taken from the filename (sanitized form); good enough for tree labels.
 */
export function tryParseHistorySnapshotName(fileName: string): { displayUser: string; timestampMs: number } | undefined {
	if (!fileName.startsWith('L3-') || !fileName.endsWith(HISTORY_SNAPSHOT_SUFFIX)) return undefined;
	const core = fileName.slice('L3-'.length, -HISTORY_SNAPSHOT_SUFFIX.length);
	const idx = core.lastIndexOf('---');
	if (idx < 0) return undefined;
	const displayUser = core.slice(0, idx);
	const tsStr = core.slice(idx + 3);
	if (!/^\d+$/.test(tsStr)) return undefined;
	const timestampMs = Number(tsStr);
	if (!Number.isFinite(timestampMs)) return undefined;
	return { displayUser, timestampMs };
}

export function formatHistoryTreeLabel(timestampMs: number, displayUser: string): string {
	const d = new Date(timestampMs);
	const pad = (n: number, w: number) => String(n).padStart(w, '0');
	const dd = pad(d.getDate(), 2);
	const mm = pad(d.getMonth() + 1, 2);
	const yyyy = d.getFullYear();
	const hh = pad(d.getHours(), 2);
	const min = pad(d.getMinutes(), 2);
	return `${dd}-${mm}-${yyyy} ${hh}:${min} (${displayUser})`;
}

/**
 * Writes one snapshot: JSON body is **only** `configuration`, tab-indented.
 * Overwrites an existing file of the same name (idempotent for the same revision).
 */
export async function writeHistorySnapshot(
	historyDir: vscode.Uri,
	entry: ConfigurationHistoryEntry,
): Promise<vscode.Uri> {
	await vscode.workspace.fs.createDirectory(historyDir);
	const name = historySnapshotFileName(entry);
	const fileUri = vscode.Uri.joinPath(historyDir, name);
	const text = `${JSON.stringify(entry.configuration, null, '\t')}\n`;
	await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(text));
	return fileUri;
}

export async function listLocalHistorySnapshots(historyDir: vscode.Uri): Promise<LocalHistorySnapshot[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(historyDir);
	} catch {
		return [];
	}
	const out: LocalHistorySnapshot[] = [];
	for (const [n, t] of entries) {
		if (t !== vscode.FileType.File) continue;
		const parsed = tryParseHistorySnapshotName(n);
		if (!parsed) continue;
		out.push({
			fileUri: vscode.Uri.joinPath(historyDir, n),
			timestampMs: parsed.timestampMs,
			displayUser: parsed.displayUser,
		});
	}
	out.sort((a, b) => b.timestampMs - a.timestampMs);
	return out;
}

/**
 * `snapshots` must be newest-first (see `listLocalHistorySnapshots`).
 * Returns the on-disk revision immediately older than the selected file, if any.
 */
export function immediateOlderSnapshot(
	snapshots: readonly LocalHistorySnapshot[],
	selectedUri: vscode.Uri,
): LocalHistorySnapshot | undefined {
	const key = selectedUri.toString();
	const i = snapshots.findIndex(s => s.fileUri.toString() === key);
	if (i < 0 || i + 1 >= snapshots.length) return undefined;
	return snapshots[i + 1];
}

/** Delete every file directly under `historyDir` (not subfolders). */
export async function clearHistoryDirectory(historyDir: vscode.Uri): Promise<void> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(historyDir);
	} catch {
		return;
	}
	for (const [n, t] of entries) {
		if (t !== vscode.FileType.File) continue;
		await vscode.workspace.fs.delete(vscode.Uri.joinPath(historyDir, n));
	}
}
