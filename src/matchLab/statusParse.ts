import type { TenantMatchingStatusSnapshot } from './types';

const RECOGNIZED_STATUS = /^(green|yellow|red)$/i;

/** Missing, non-numeric, or negative queue sizes are unreadable (not idle). */
export function parseQueueSize(value: unknown): number | undefined {
	let n: number | undefined;
	if (typeof value === 'number' && Number.isFinite(value)) n = value;
	else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
		n = Number(value.trim());
	}
	if (n === undefined || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
	return n;
}

function pickKeyed(record: Record<string, unknown>, names: string[]): unknown {
	const lower = new Map<string, unknown>();
	for (const [k, v] of Object.entries(record)) {
		lower.set(k.toLowerCase().replace(/[_-]+/g, ' ').trim(), v);
	}
	for (const name of names) {
		const hit = lower.get(name.toLowerCase());
		if (hit !== undefined) return hit;
	}
	return undefined;
}

function parseFromRecord(record: Record<string, unknown>): TenantMatchingStatusSnapshot {
	const statusRaw = pickKeyed(record, ['status']);
	const status = typeof statusRaw === 'string' ? statusRaw.trim() : undefined;
	return {
		status: status && status.length > 0 ? status : undefined,
		matchingQueueSize: parseQueueSize(
			pickKeyed(record, ['matching queue size', 'matchingqueuesize', 'match queue size']),
		),
		eventsQueueSize: parseQueueSize(
			pickKeyed(record, ['events queue size', 'eventsqueuesize', 'event queue size']),
		),
	};
}

function parseFromText(text: string): TenantMatchingStatusSnapshot {
	const matching = /matching\s+queue\s+size\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(text);
	const events = /events?\s+queue\s+size\s*[:=]\s*(-?\d+(?:\.\d+)?)/i.exec(text);
	const status = /\bstatus\s*[:=]\s*([A-Za-z]+)/i.exec(text);
	return {
		status: status?.[1],
		matchingQueueSize: matching ? parseQueueSize(matching[1]) : undefined,
		eventsQueueSize: events ? parseQueueSize(events[1]) : undefined,
	};
}

export function parseTenantMatchingStatus(body: unknown, text?: string): TenantMatchingStatusSnapshot {
	if (body && typeof body === 'object' && !Array.isArray(body)) {
		const fromJson = parseFromRecord(body as Record<string, unknown>);
		if (
			fromJson.matchingQueueSize !== undefined ||
			fromJson.eventsQueueSize !== undefined ||
			fromJson.status
		) {
			return fromJson;
		}
	}
	if (text && text.trim()) {
		return parseFromText(text);
	}
	return { status: undefined, matchingQueueSize: undefined, eventsQueueSize: undefined };
}

export function isRecognizedStatus(status: string | undefined): boolean {
	return typeof status === 'string' && RECOGNIZED_STATUS.test(status.trim());
}

export function isDegradedStatus(status: string | undefined): boolean {
	return typeof status === 'string' && /^red$/i.test(status.trim());
}
