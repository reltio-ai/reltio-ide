/**
 * Match Lab — observational potential-match briefing (sampled).
 *
 * Out of scope (do not implement): Google Sheets, Drive, smart sampling into
 * Sheets, --full-volume, Companion, mapping-workbook coverage "try list",
 * Apply L3, rebuild match tables, FERN/vectorization apply.
 *
 * FORBIDDEN APIs: POST …/entities/_matches (drops INTERNAL-scope rules),
 * PUT …/configuration, any rebuild / tasks / match-table job.
 *
 * The extension SHALL NOT call an LLM (skills-and-enablement-packs-library D1–D3b).
 */

/**
 * Stamped into every workbook so a stale extension host is obvious — the panel
 * ignores sidecars that do not match. Bump whenever the workbook shape changes.
 */
export const MATCH_LAB_ENGINE_VERSION = '8.4.0-review-rules-tenant-fill';

/** Default sampled caps — do not scan the whole tenant on first run. */
export const MATCH_LAB_SAMPLE = {
	/** p1 — profiles per rule (min(census, 40)). */
	p1ProfilesPerRule: 40,
	/** p0 — only when a rule is explicitly marked focus (none by default). */
	p0ProfilesPerFocusRule: 100,
	/** Hard cap of unique pair rows per entity workbook. */
	maxUniquePairsPerEntity: 400,
	/** Omit By Profile when 2 × pair-tab rows would exceed this. */
	maxByEntityRows: 80_000,
	matchesPageSize: 50,
	byUrisChunk: 40,
} as const;

export const MATCH_LAB_GATE = {
	pollIntervalMs: 4_000,
	maxAttempts: 6,
} as const;
