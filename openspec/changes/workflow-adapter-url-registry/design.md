# Design — workflow-adapter-url-registry

Builds on `workflow-inspector`, which introduced the Adapter URL sidecar (`workflowAdapterConfig.ts`) and `guessWorkflowAdapterUrl()`. Everything here sits in front of those; neither is removed.

---

## D1. The table is bundled, not fetched

**Decision.** The mapping ships as a TypeScript module inside the extension. It is not fetched from Confluence, an API, or a settings file.

**Rationale.** The alternative sounds better than it is. The source is a Confluence page: not an API, requiring credentials the extension does not hold and is not going to ask for, and reachable only if a second service is up at the exact moment a user first connects a tenant. A network dependency in front of "what URL should I use" is worse than a stale row, because the failure mode is the prompt we are trying to remove.

Staleness is the real cost, and it is bounded: a new environment that is not on the table falls through to the guess and then the prompt, which is precisely today's behaviour. The table can only improve the outcome, never degrade it.

**Rejected:** a `reltio.workflowAdapterUrls` setting. It moves the maintenance burden onto every customer individually and produces no shared benefit — and the per-tenant sidecar already covers the case where someone needs a URL we do not know.

## D2. Keyed by adapter host, inverted at load

**Decision.** `SHARED_ADAPTERS` is written as adapter host → environments served, the way the source table reads. The environment → host index is built once at module load.

**Rationale.** The source lists nine shared adapters with their environments beneath them. Transcribing that into the inverse shape by hand is where a row gets mistyped, and a mistyped row is invisible: it produces a confident wrong URL rather than a miss. Keeping the literal in the source's own shape makes a line-by-line diff against the page possible, which is the only review that can actually catch an error here.

The dedicated adapters are a separate list precisely because most of them follow `{label}-workflow.reltio.com` and would be noise if written out as pairs. The six that do not follow it get their own explicit map, and that map is the part of this change with the highest value per line.

## D3. Every lookup goes through a `Map`

**Decision.** The record literals are never indexed directly. `ENVIRONMENT_TO_ADAPTER`, `AMBIGUOUS_BY_ENVIRONMENT` and `ALIAS_BY_ENVIRONMENT` are `Map`s built from them.

**Rationale.** The lookup key is derived from a directory name in the user's workspace. Indexing a plain object with an arbitrary string reaches inherited members, so an environment folder named `constructor` would "resolve" to a function and an environment named `__proto__` would reach the prototype accessor. This is the same hazard `createKeyedMap()` in `src/ontology/webviewMessageSafety.ts` exists for, arriving through a different door — there, a node id from the user's own config; here, a folder name.

A `Map` also types a miss as `undefined`, which is the case this module is mostly about: `tsconfig.json` does not set `noUncheckedIndexedAccess`, so a record index would be typed `string` and the miss would be invisible to the compiler.

## D4. Ambiguity is a question, and it suppresses the guess

**Decision.** An environment the source lists two ways returns `{ kind: 'ambiguous', candidates }`. The command shows a QuickPick. If the user dismisses it, the flow goes to the manual prompt — **not** to `guessWorkflowAdapterUrl()`.

**Rationale.** The suppression is the substance of this decision; the QuickPick is the easy half.

Both hosts in each ambiguous pair are real and both answer a probe like an Adapter. So the guess does not fail on an ambiguous environment — it *succeeds*, on whichever host it happened to construct, and saves that answer to the sidecar. The user gets no prompt, no warning, and a plausible URL that may be pointed at the wrong Reltio region's workflow engine. Falling through to a guess is strictly worse here than falling through to a question, which is the opposite of the usual ordering and the reason it is written down.

Which environments are ambiguous, and why:

| Environment | Candidates | Why the source is unclear |
|---|---|---|
| `mpe-01` | `mpe-01-workflow`, `eu-test-workflow` | As written, `mpe-01` uses `eu-test-workflow` while the `geu` environments use `mpe-01-workflow`. That reads like two transposed rows. |
| `geu-prod`, `geu-test`, `eu-360`, `euprod-01` | same pair | The other half of the same suspected transposition. |
| `tst-04-hf` | `tst-04-hf-workflow`, `gtst-01-workflow` | Listed under the shared `gtst-01` adapter *and* as its own dedicated one. |

## D5. Bundled hosts are bare, and still pass the allowlist

**Decision.** The registry stores hostnames with no scheme. The caller runs `toHttpsBase()` on the result exactly as it does on a hand-typed URL.

**Rationale.** `toHttpsBase()` is the single choke point every outbound call passes through before a bearer token is attached (`ARCHITECTURE.md`, Dependencies and Integrations). A registry that returned `https://…` would invite a caller to treat it as pre-validated and skip that, and the first time someone did, a bundled hostname would have become an implicit trust grant.

Storing bare hosts makes skipping the check impossible to do accidentally, and gives the desired behaviour for the two `reltiocn.cn` entries for free: they are on the table, so the user is told the correct URL, and they are refused by the default allowlist, so no token goes to them until an operator sets `reltio.trustedHostSuffixes`. The prompt then opens **pre-filled with that host**, so the error message and the value it is about are visible together — the alternative, an empty box after an error, makes the user re-derive what they were just told.

## D6. Longest domain suffix stripped first

**Decision.** `ENVIRONMENT_DOMAIN_SUFFIXES` is ordered `.cloud.reltio.com`, `.reltiocn.cn`, `.reltio.com`, and the first match wins.

**Rationale.** `.cloud.reltio.com` also ends in `.reltio.com`. Stripping the shorter suffix first leaves `demo-01.cloud`, which matches no row — a silent fall-through to the guess for an environment that is on the table. The failure is invisible because the fallback path works; it just asks a question it did not need to ask.

## Test plan

**Automated (Tier A — `scripts/test-workflow-adapter-registry.cjs`)**

| # | Assertion |
|---|---|
| 1 | Label normalisation: scheme, case, trailing path and each domain suffix reduce to the same label; `.cloud.reltio.com` strips before `.reltio.com` |
| 2 | Every environment on each shared row resolves to that row's host, including ones sharing no prefix with it |
| 3 | Dedicated adapters, including the `-workflow-adapter` and `reltiocn.cn` irregulars |
| 4 | `approd-01` and `ap-360` resolve identically |
| 5 | Each ambiguous environment returns both candidates and no single host |
| 6 | No label appears twice across the index and the ambiguous map |
| 7 | An unknown environment returns `undefined`, preserving the guess-then-prompt fallback |
| 8 | Every bundled host is bare, lowercase, path-free |
| 9 | `constructor`, `__proto__`, `toString` miss rather than returning an inherited member |
| 10 | A `reltiocn.cn` host fails the default allowlist and passes an extended one; every `.reltio.com` host on the table passes the default |

**Automated (Tier B)**

| # | Assertion |
|---|---|
| 11 | The script is registered in `scripts/run-unit-tests.cjs` |

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | Connect a tenant on `gus-training` and click **Workflows** | Resolves to `test-workflow.reltio.com` with no prompt and no probe; the info message names the host |
| M2 | Connect a tenant on `mpe-01` | A QuickPick offers both documented hosts; dismissing it opens the manual prompt, not a guessed URL |
| M3 | Connect a tenant on `cn01-test` with the default allowlist | The allowlist error names `reltio.trustedHostSuffixes`, and the prompt opens pre-filled with `cn01-test-workflow-adapter.reltiocn.cn` |
| M4 | Connect a tenant on an environment not in the table | Behaviour unchanged: probe, then prompt |
| M5 | Re-open a tenant whose URL is already saved | No lookup, no prompt — the sidecar still wins |

## Open questions

These need an answer from the owner of the source table. None blocks the change: each affected environment currently asks a question rather than guessing.

1. Are the `mpe-01` and `geu`/`eu-360` rows transposed? (D4)
2. Is `tst-04-hf` on the shared `gtst-01` adapter or its own? (D4)
3. Do the `-g`-suffixed names (`na03-prod-g` and siblings) correspond to environment hosts `na03-prod` or `na03-prod-g`? They are **omitted** from the table until this is settled, so they fall through to the guess — which is correct for them either way, since their adapters follow the `-workflow` convention.
4. Should `reltiocn.cn` join the default `trustedHostSuffixes`? Currently no, per the proposal's scope note.
