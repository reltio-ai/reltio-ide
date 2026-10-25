/**
 * Known Reltio environment → Workflow Adapter host mapping.
 *
 * Why this exists: `guessWorkflowAdapterUrl()` derives `{first-label}-workflow`
 * from the environment host and probes it. That guess is right for many
 * environments and wrong for many others — Reltio runs nine *shared* adapters
 * serving multiple environments each, and several dedicated ones whose host uses
 * `-workflow-adapter` rather than `-workflow`, or a different domain entirely.
 * For anything on this table the customer should never be asked to find and type
 * a URL, and no probe should be needed to confirm it.
 *
 * Source: the "Workflow Environment to Reltio Environment Mapping" section of
 * IRD / "Enabling Workflow Streaming for DPH (Data Pipeline Hub)", cross-checked
 * and updated against `workflow-adapter-urls.csv` (an infra-generated
 * Cluster/Environment/WorkflowAdapterURL export). Where the two sources
 * disagreed, the CSV won — it is the more current and more mechanically
 * produced of the two, confirmed by resolving what the IRD had flagged as
 * ambiguous (`mpe-01`/`geu-test`/`geu-prod`/`euprod-01` — see below) exactly the
 * way the CSV's own rows do. Rows that remain ambiguous even after the CSV
 * cross-check are deliberately *not* resolved here — see `AMBIGUOUS_ADAPTERS` —
 * because a confident wrong answer is worse than a question.
 *
 * Hosts are stored bare, without a scheme. Callers pass the result through
 * `toHttpsBase()` exactly as they would a hand-typed URL, so the host allowlist
 * stays the single choke point and a bundled host gets no implicit trust. That
 * matters for the two `reltiocn.cn` entries below, which the default allowlist
 * (`reltio.com`) refuses until an operator extends `reltio.trustedHostSuffixes`.
 *
 * No `vscode` import: this is pure data plus string handling, so the unit tests
 * can import it from `dist/` directly.
 */

/** The outcome of a registry lookup. `undefined` from the lookup means "not on the table". */
export type AdapterLookupResult =
	| { readonly kind: 'url'; readonly host: string }
	| { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

/**
 * Domain suffixes stripped to turn an environment host into the bare label the
 * source table uses (`na03-prod.reltio.com` → `na03-prod`).
 *
 * Ordered longest-first because `.cloud.reltio.com` also ends in `.reltio.com`,
 * and stripping the shorter one first would leave `ap02-prod.cloud` — a label
 * that matches nothing, failing silently into the guess path.
 */
const ENVIRONMENT_DOMAIN_SUFFIXES: readonly string[] = [
	'.cloud.reltio.com',
	'.reltiocn.cn',
	'.reltio.com',
];

/**
 * Shared adapters, keyed by adapter host with the environments it serves.
 *
 * Keyed this way round because that is how the source table reads; inverting it
 * by hand is how an entry gets mistyped. `ENVIRONMENT_TO_ADAPTER` below is the
 * inverted index, built once at module load.
 */
const SHARED_ADAPTERS: Readonly<Record<string, readonly string[]>> = {
	'test-workflow.reltio.com': ['dev', 'gus-training', 'mpe-03', 'test', 'test-usg'],
	// `r361` is the same environment under its internal name; both spellings appear.
	'prod-workflow.reltio.com': ['361', 'r361', 'prod-usg'],
	'test-h360-workflow.reltio.com': ['dev-h360', 'na02-test', 'test-h360'],
	'prod-h360-workflow.reltio.com': ['na02-prod', 'prod-h360'],
	'sales-workflow.reltio.com': ['gus-sales'],
	'tst-01-workflow.reltio.com': ['eutst-01', 'idev-01', 'idev-02', 'tst-01', 'geu-tst-01'],
	// `tst-04-hf` is listed here in the source *and* as its own dedicated adapter;
	// it is therefore in AMBIGUOUS_ADAPTERS rather than on this row.
	'gtst-01-workflow.reltio.com': ['tst-01-ebf', 'tst-01-hf'],
	// Confirmed by the CSV: `eutst-dr-01` is not its own dedicated adapter (the
	// naming-convention guess would derive `eutst-dr-01-workflow.reltio.com`,
	// which is wrong) — it shares `tst-dr-01`'s adapter across two Reltio
	// clusters (`eks-iqa-us-01` and `eks-iqa-eu-01`).
	'tst-dr-01-workflow.reltio.com': ['tst-dr-01', 'eutst-dr-01'],
	// Confirmed by the CSV: this is the other half of the `mpe-01`/`geu`
	// transposition the IRD source left ambiguous (see `AMBIGUOUS_ADAPTERS`) —
	// these three environments share `mpe-01`'s namesake adapter, while `mpe-01`
	// itself uses `eu-test-workflow.reltio.com` (`DEDICATED_IRREGULAR_ADAPTERS`).
	'mpe-01-workflow.reltio.com': ['geu-test', 'geu-prod', 'euprod-01'],
};

/**
 * Dedicated adapters that follow the `{label}-workflow.reltio.com` shape.
 *
 * This is the same shape `guessWorkflowAdapterUrl()` would derive, so strictly
 * these could be left to the guess. They are listed anyway: the guess costs a
 * network round trip and is only as good as DNS on the day, whereas a table hit
 * is instant and survives an environment that is temporarily unreachable.
 */
const DEDICATED_WORKFLOW_SUFFIX_ENVIRONMENTS: readonly string[] = [
	'na05-dev', 'na05-prod', 'na05-test',
	'na07-dev', 'na07-prod', 'na07-test',
	// `na10-test` and `na10-prod` are NOT on this list — the CSV shows they use
	// an irregular host (`DEDICATED_IRREGULAR_ADAPTERS`); only `na10-dev`
	// actually follows this shape.
	'na10-dev',
	'na12-dev', 'na12-prod', 'na12-test',
	'na13-dev', 'na13-prod', 'na13-test',
	'eu02-dev', 'eu02-prod', 'eu02-test',
	'eu03-dev', 'eu03-prod', 'eu03-test', 'eu03-tst-01',
	'mpe-02',
	'gca-prod', 'gca-test',
	'guk-prod', 'guk-test',
	'ap-360',
	'gtst-01', 'gtst-01-ebf',
	// `tst-dr-01` is NOT on this list — the CSV shows it is shared with
	// `eutst-dr-01` (`SHARED_ADAPTERS`), not a solo dedicated adapter.
	// Added from the CSV, not present in the original IRD table. The other five
	// `na03-*-g` environments are NOT on this list — their host drops the `-g`
	// suffix the environment label carries, which only this one's host doesn't
	// (see `DEDICATED_IRREGULAR_ADAPTERS`).
	'na03-tst-01-ebf',
];

/**
 * Dedicated adapters whose host does **not** follow the `-workflow` convention.
 *
 * These are the reason a bundled table beats a derived guess: the `-ssrv`
 * environments use `-workflow-adapter`, and the two China environments are on
 * `reltiocn.cn` — a guess would look for `cn01-test-workflow.reltio.com`, which
 * is neither the right suffix nor the right domain.
 */
const DEDICATED_IRREGULAR_ADAPTERS: Readonly<Record<string, string>> = {
	'eprus-02-ssrv': 'eprus-02-ssrv-workflow-adapter.reltio.com',
	'eprus-04-ssrv': 'eprus-04-ssrv-workflow-adapter.reltio.com',
	'eprus-05-ssrv': 'eprus-05-ssrv-workflow-adapter.reltio.com',
	'epreu-01-ssrv': 'epreu-01-ssrv-workflow-adapter.reltio.com',
	'cn01-test': 'cn01-test-workflow-adapter.reltiocn.cn',
	'eprcnnw-01-ssrv': 'eprcnnw-01-ssrv-workflow-adapter.reltiocn.cn',
	// Confirmed by the CSV, both irregular in their own way:
	// `na10-test`/`na10-prod` use `-workflow-adapter` plus a
	// `customer-facing-na10` domain segment the naming-convention guess has no
	// way to produce; `mpe-01` is the other half of the `mpe-01`/`geu`
	// transposition — see the `SHARED_ADAPTERS` comment above it.
	'na10-test': 'na10-test-workflow-adapter.customer-facing-na10.reltio.com',
	'na10-prod': 'na10-prod-workflow-adapter.customer-facing-na10.reltio.com',
	'mpe-01': 'eu-test-workflow.reltio.com',
	// From the CSV, clusters `aks-prod-us-01-g` / `aks-iqa-us-01-g`: the host
	// drops the `-g` suffix these environment labels carry, so the
	// naming-convention guess (which would keep it) misses every one of these.
	'na03-test-g': 'na03-test-workflow.reltio.com',
	'na03-sales-g': 'na03-sales-workflow.reltio.com',
	'na03-prod-g': 'na03-prod-workflow.reltio.com',
	'na03-dev-g': 'na03-dev-workflow.reltio.com',
	'na03-tst-01-hf-g': 'na03-tst-01-hf-workflow.reltio.com',
	'na03-tst-01-g': 'na03-tst-01-workflow.reltio.com',
};

/**
 * Alternate spellings the source table gives in parentheses, mapped to the
 * canonical label. An environment folder may be named after either.
 */
const ENVIRONMENT_ALIASES: Readonly<Record<string, string>> = {
	'approd-01': 'ap-360',
};

/**
 * Environments the source tables answer two different ways.
 *
 * Resolving these by picking one would be worse than asking. The IRD source
 * originally listed `mpe-01` and the whole `geu`/`eu-360` group here as a
 * transposed pair — as written, `mpe-01` uses `eu-test-workflow` while the
 * `geu` environments use `mpe-01-workflow`. The CSV cross-check (see the
 * top-of-file comment) confirmed that reading for `mpe-01`, `geu-test`,
 * `geu-prod` and `euprod-01` — they are resolved now, in `SHARED_ADAPTERS` and
 * `DEDICATED_IRREGULAR_ADAPTERS`. `eu-360` has no corresponding CSV row, so it
 * stays here rather than being resolved by extrapolation from its siblings.
 *
 * `tst-04-hf` is unrelated: both hosts exist and answer, so the probe in
 * `guessWorkflowAdapterUrl()` would happily confirm the wrong one; that is
 * exactly why an ambiguous hit must skip the guess entirely and put the choice
 * in front of the user.
 */
const AMBIGUOUS_ADAPTERS: Readonly<Record<string, readonly string[]>> = {
	'eu-360': ['eu-test-workflow.reltio.com', 'mpe-01-workflow.reltio.com'],
	'tst-04-hf': ['tst-04-hf-workflow.reltio.com', 'gtst-01-workflow.reltio.com'],
};

/**
 * Every lookup below goes through a `Map`, never through the record literals
 * directly.
 *
 * The key is derived from a directory name in the user's workspace, and indexing
 * a plain object with an arbitrary string reaches inherited members — an
 * environment folder named `constructor` would otherwise "resolve" to a
 * function. `createKeyedMap()` in `src/ontology/webviewMessageSafety.ts` exists
 * for the same reason on the webview side. A `Map` also types the miss as
 * `undefined`, which is the case this module is mostly about.
 */
const ENVIRONMENT_TO_ADAPTER: ReadonlyMap<string, string> = buildAdapterIndex();
const AMBIGUOUS_BY_ENVIRONMENT: ReadonlyMap<string, readonly string[]> = new Map(
	Object.entries(AMBIGUOUS_ADAPTERS),
);
const ALIAS_BY_ENVIRONMENT: ReadonlyMap<string, string> = new Map(
	Object.entries(ENVIRONMENT_ALIASES),
);

function buildAdapterIndex(): ReadonlyMap<string, string> {
	const index = new Map<string, string>();
	for (const [adapterHost, environments] of Object.entries(SHARED_ADAPTERS)) {
		for (const environment of environments) index.set(environment, adapterHost);
	}
	for (const environment of DEDICATED_WORKFLOW_SUFFIX_ENVIRONMENTS) {
		index.set(environment, `${environment}-workflow.reltio.com`);
	}
	for (const [environment, adapterHost] of Object.entries(DEDICATED_IRREGULAR_ADAPTERS)) {
		index.set(environment, adapterHost);
	}
	return index;
}

/**
 * Reduce whatever the environment is called in the workspace to the bare label
 * the source table uses.
 *
 * Environment names reach this function from a folder name, so they can carry a
 * scheme, a trailing slash, mixed case, or a full domain. All four are the same
 * environment and must hit the same row.
 */
export function environmentLabel(environmentName: string): string {
	let label = environmentName.trim().toLowerCase();
	label = label.replace(/^https?:\/\//, '');
	label = label.replace(/[/?#].*$/, '');
	for (const suffix of ENVIRONMENT_DOMAIN_SUFFIXES) {
		if (label.endsWith(suffix)) {
			label = label.slice(0, -suffix.length);
			break;
		}
	}
	return ALIAS_BY_ENVIRONMENT.get(label) ?? label;
}

/**
 * The bundled adapter host for an environment, or `undefined` when it is not on
 * the table and the caller should fall back to the guess-then-prompt path.
 *
 * Ambiguity is checked first: an environment listed twice in the source must not
 * be silently satisfied by whichever index entry won.
 */
export function lookupWorkflowAdapterUrl(environmentName: string): AdapterLookupResult | undefined {
	const label = environmentLabel(environmentName);

	const candidates = AMBIGUOUS_BY_ENVIRONMENT.get(label);
	if (candidates) return { kind: 'ambiguous', candidates };

	const host = ENVIRONMENT_TO_ADAPTER.get(label);
	return host ? { kind: 'url', host } : undefined;
}

/**
 * Every environment label the registry answers for, ambiguous ones included.
 * Exported for the unit test that asserts no label resolves two ways.
 */
export function knownEnvironmentLabels(): readonly string[] {
	return [...ENVIRONMENT_TO_ADAPTER.keys(), ...AMBIGUOUS_BY_ENVIRONMENT.keys()];
}
