import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	getTenantMatchingStatus as fetchTenantMatchingStatus,
	ReltioApiError,
	toHttpsBase,
} from './reltioApi';
import { MATCH_LAB_GATE } from './defaults';
import { isDegradedStatus, isRecognizedStatus, parseTenantMatchingStatus } from './statusParse';
import type {
	MatchingGatePoll,
	MatchingGateReason,
	MatchingGateResult,
	TenantMatchingStatusSnapshot,
} from './types';

export type { MatchingGatePoll, MatchingGateReason, MatchingGateResult };

export const MATCH_LAB_DIRNAME = 'match-lab';
export const MATCHING_PIPELINE_GATE_FILENAME = 'matching-pipeline-gate.json';

export interface MatchingPipelineGateSidecar {
	host: string;
	tenantId: string;
	idle: boolean;
	skipped: boolean;
	polls: MatchingGatePoll[];
	reason: MatchingGateReason;
}

export interface MatchingGateOptions {
	/** Default false. Only skip the wait when explicitly true. */
	skip?: boolean;
	sleep?: (ms: number) => Promise<void>;
	pollIntervalMs?: number;
	maxAttempts?: number;
	/** `{tenantId}.reltio.tenant` directory. Sidecar is written under `match-lab/`. */
	tenantRoot?: string;
	now?: () => Date;
	getTenantMatchingStatus?: (
		baseUrl: string,
		tenantId: string,
		token: string,
	) => Promise<{
		status?: string;
		matchingQueueSize?: number;
		eventsQueueSize?: number;
		body?: unknown;
		text?: string;
	}>;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function hostOf(baseUrl: string): string {
	return toHttpsBase(baseUrl).replace(/^https?:\/\//i, '');
}

export function matchingPipelineGatePath(tenantRoot: string): string {
	return path.join(tenantRoot, MATCH_LAB_DIRNAME, MATCHING_PIPELINE_GATE_FILENAME);
}

export async function writeMatchingPipelineGateSidecar(
	tenantRoot: string,
	payload: MatchingPipelineGateSidecar,
): Promise<string> {
	const file = matchingPipelineGatePath(tenantRoot);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
	return file;
}

/** Finite non-negative integer. `undefined` is unreadable — never treated as 0. */
export function isReadableQueueSize(value: number | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function describe(snapshot: TenantMatchingStatusSnapshot): string {
	const matching = isReadableQueueSize(snapshot.matchingQueueSize)
		? String(snapshot.matchingQueueSize)
		: 'unreadable';
	const events = isReadableQueueSize(snapshot.eventsQueueSize)
		? String(snapshot.eventsQueueSize)
		: 'unreadable';
	const status = snapshot.status ?? '(missing)';
	return `Matching queue size: ${matching}; Events queue size: ${events}; Status: ${status}. Console "Pending Jobs" is not this queue.`;
}

function snapshotFromStatusResult(raw: {
	status?: string;
	matchingQueueSize?: number;
	eventsQueueSize?: number;
	body?: unknown;
	text?: string;
}): TenantMatchingStatusSnapshot {
	if ('matchingQueueSize' in raw || 'eventsQueueSize' in raw) {
		return {
			status: typeof raw.status === 'string' && raw.status.trim() ? raw.status : undefined,
			matchingQueueSize: raw.matchingQueueSize,
			eventsQueueSize: raw.eventsQueueSize,
		};
	}
	return parseTenantMatchingStatus(raw.body, raw.text);
}

function toPoll(snapshot: TenantMatchingStatusSnapshot, at: string): MatchingGatePoll {
	return {
		at,
		status: snapshot.status ?? null,
		matchingQueueSize: snapshot.matchingQueueSize ?? null,
		eventsQueueSize: snapshot.eventsQueueSize ?? null,
	};
}

function lastSnapshot(polls: MatchingGatePoll[]): TenantMatchingStatusSnapshot {
	const last = polls[polls.length - 1];
	if (!last) {
		return { status: undefined, matchingQueueSize: undefined, eventsQueueSize: undefined };
	}
	return {
		status: last.status ?? undefined,
		matchingQueueSize: last.matchingQueueSize ?? undefined,
		eventsQueueSize: last.eventsQueueSize ?? undefined,
	};
}

function eventsDraining(current: number, previous: number | undefined): boolean {
	if (current === 0) return true;
	if (!isReadableQueueSize(previous)) return false;
	return current <= previous;
}

async function writeSidecar(
	tenantRoot: string | undefined,
	baseUrl: string,
	tenantId: string,
	idle: boolean,
	skipped: boolean,
	reason: MatchingGateReason,
	polls: MatchingGatePoll[],
): Promise<string | undefined> {
	if (!tenantRoot) return undefined;
	return writeMatchingPipelineGateSidecar(tenantRoot, {
		host: hostOf(baseUrl),
		tenantId,
		idle,
		skipped,
		polls,
		reason,
	});
}

function result(args: {
	idle: boolean;
	skipped: boolean;
	reason: MatchingGateReason;
	polls: MatchingGatePoll[];
	sidecarPath?: string;
	blockedReason?: string;
}): MatchingGateResult {
	const last = lastSnapshot(args.polls);
	return {
		idle: args.idle,
		skipped: args.skipped,
		reason: args.reason,
		blockedReason: args.idle ? undefined : (args.blockedReason ?? describe(last)),
		last,
		polls: args.polls,
		sidecarPath: args.sidecarPath,
	};
}

/**
 * Poll `GET /reltio/status/tenant/{tenantId}` until matching is idle, or block.
 * Undefined / NaN / fractional / negative / non-finite queues are UNREADABLE (not 0).
 * Console "Pending Jobs" is irrelevant.
 */
export async function waitForMatchingIdle(
	baseUrl: string,
	tenantId: string,
	token: string,
	options?: MatchingGateOptions,
): Promise<MatchingGateResult> {
	const skip = options?.skip === true;
	const pollIntervalMs = options?.pollIntervalMs ?? MATCH_LAB_GATE.pollIntervalMs;
	const maxAttempts = skip ? 1 : (options?.maxAttempts ?? MATCH_LAB_GATE.maxAttempts);
	const sleep = options?.sleep ?? defaultSleep;
	const now = options?.now ?? (() => new Date());
	const getStatus = options?.getTenantMatchingStatus ?? fetchTenantMatchingStatus;
	const tenantRoot = options?.tenantRoot;
	const polls: MatchingGatePoll[] = [];
	let matchingZeroStreak = 0;

	const finish = async (
		idle: boolean,
		reason: MatchingGateReason,
		blockedReason?: string,
	): Promise<MatchingGateResult> => {
		const sidecarPath = await writeSidecar(tenantRoot, baseUrl, tenantId, idle, skip, reason, polls);
		return result({ idle, skipped: skip, reason, polls, sidecarPath, blockedReason });
	};

	try {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const raw = await getStatus(baseUrl, tenantId, token);
			const current = snapshotFromStatusResult(raw);
			polls.push(toPoll(current, now().toISOString()));

			if (!isReadableQueueSize(current.matchingQueueSize) || !isReadableQueueSize(current.eventsQueueSize)) {
				return finish(
					false,
					'unreadable-queue',
					`Matching or events queue size is unreadable (missing, non-numeric, fractional, negative, or non-finite). ${describe(current)}`,
				);
			}
			if (!isRecognizedStatus(current.status) || isDegradedStatus(current.status)) {
				return finish(
					false,
					'unknown-status',
					`Tenant status is missing, unrecognized, or degraded. ${describe(current)}`,
				);
			}

			if (current.matchingQueueSize === 0) {
				matchingZeroStreak += 1;
			} else {
				matchingZeroStreak = 0;
			}

			const previousEvents =
				polls.length >= 2 ? (polls[polls.length - 2]?.eventsQueueSize ?? undefined) : undefined;
			const previousEventsNum =
				previousEvents === null || previousEvents === undefined ? undefined : previousEvents;
			const draining = eventsDraining(current.eventsQueueSize, previousEventsNum);

			if (!skip && matchingZeroStreak >= 2 && draining) {
				return finish(true, 'idle');
			}

			if (attempt < maxAttempts - 1) {
				await sleep(pollIntervalMs);
			}
		}
	} catch (e) {
		if (e instanceof ReltioApiError && e.statusCode === 401) {
			await writeSidecar(tenantRoot, baseUrl, tenantId, false, skip, 'unauthorized', polls);
			throw e;
		}
		if (e instanceof Error && /timed out/i.test(e.message)) {
			return finish(false, 'timeout', `Matching status request timed out. ${describe(lastSnapshot(polls))}`);
		}
		throw e;
	}

	const last = lastSnapshot(polls);
	if (!isReadableQueueSize(last.matchingQueueSize) || matchingZeroStreak < 2) {
		return finish(
			false,
			'matching-not-zero',
			`Matching queue size is not 0 on two consecutive successful polls. ${describe(last)}`,
		);
	}
	return finish(
		false,
		'events-not-draining',
		`Events queue is not 0 or draining. ${describe(last)}`,
	);
}
