# Astra Alto — validated M4 DRY_RUN desktop

M1–M3.5 are preserved, including the complete authorized Kantocards evidence. **M4/M4.5 PASS; ADR-001 ACCEPTED; READY FOR NEXT PHASE.** Real packaged Windows workflow, read-only observation, truthful DRY_RUN decisions, restart and resource measurements pass. Security is accepted through verified shipped/source configuration and passing tests per the user's final instruction. The automated Electron smoke remains a non-blocking environment/harness limitation, not a passing runtime test. See `outputs/M4_5_REPORT.md` for the evidence and limits. No next phase was started and no real cart, checkout, order or purchase capability exists.

The portable artifact is `outputs/AstraAlto-M4-Windows-x64.zip`. Extract it and launch `Astra Alto/AstraAlto.exe`; no Node installation is required by the package. Default local data is `%APPDATA%/Astra Alto/astra.sqlite`. A host-only absolute `ASTRA_ALTO_DATA_DIR` override is available for local validation; database files are never placed in packaged resources. Do not point experiments at the original M3.5 evidence database; use a consistent copy.

Development requires Node 24 and pnpm 12.3.4. Install the locked dependencies with scripts disabled, then explicitly provision the pinned Electron binary with `node node_modules/electron/install.js` when a download is authorized. Run:

```text
pnpm check
pnpm desktop:build
pnpm desktop:test-build
pnpm desktop:smoke
```

The smoke package is separate from the production package and contains clearly marked authored fixtures. It runs a bounded desktop workflow twice to test persistence, with Node/pnpm removed from the launched app's PATH. It makes no retailer requests. Do not distribute the test package. `node scripts/desktop-existing-evidence.mjs` verifies the user-supplied M3.5 database on a copy without network access.

Live desktop observation is disabled unless the launching host explicitly sets both `SHOPIFY_LIVE_VALIDATION_ENABLED=1` and `SHOPIFY_STORE_DOMAIN=kantocards.com`, and the operator enables the approved store in Settings. Only the two previously authorized targets are supported. Cadence is at least 60 seconds per monitor, five seconds between store request attempts, with a persisted six-attempt budget and no automatic refill. This is limited validation configuration, not ongoing catalog monitoring permission. The user successfully exercised authorized packaged-app reads during M4.5; the final reassessment made no further requests. There is no LIVE purchase toggle.

## Historical M1–M3 implementation notes

The sections below retain the earlier milestone descriptions. Their statements about unimplemented desktop/live work describe those historical milestones; current status is above and in `outputs/M4_REPORT.md`.

This workspace implements Phase 0 through the M4 packaged DRY_RUN desktop, including M2 durability, the M3 fixture adapter, M3.5 qualified authorized Kantocards evidence and M4.5 Windows validation. The twelve architecture files in `docs/` remain authoritative. Earlier milestone-specific notes below describe their original scope; final status is in `outputs/M4_5_REPORT.md`.

The production packages have **no third-party runtime dependencies**, live HTTP transport, browser automation, UI, accounts, secrets, licensing, backend, cart mutations, or order submission. An explicitly enabled M3.5 developer preflight can attempt a fixed read-only Kantocards request; it is excluded from CI. Its two validation attempts were blocked locally before any HTTP response. M2 uses the installed Node runtime's `node:sqlite`. A DRY_RUN result is a simulation, never a purchase. `evaluateSimulation` returns an in-memory candidate; only `DurableCoordinator.run` reports a committed durable decision.

## Run

Prerequisite: Node 24. This execution used Node 24.19.0 and TypeScript 6.0.3. The Node built-in test runner is the test framework; all source, fixtures and tests are compiled with strict TypeScript and project references.

Once the development tools are provisioned:

```text
node scripts/check.mjs all
```

Or use `pnpm run check`. The workspace disables pnpm's implicit pre-run dependency installation and sets offline mode. Individual scripts: `build`, `typecheck`, `lint`, `format`, `format:check`, and `test`. `test` always builds first. `typecheck` performs the declaration-producing solution build so package exports and downstream consumers are checked too. No project script fetches tools, starts a service, or calls a retailer.

### Offline provisioning

The development dependencies are exactly pinned in the root manifest. This machine had a local TypeScript installation and Node declarations, but no ESLint/Prettier. They were reused without network access or install scripts:

```text
node scripts/bootstrap.mjs <typescript-package-directory> <node-types-package-directory> <undici-types-package-directory>
```

Each argument is an existing package directory containing `package.json`. Expected versions are TypeScript 6.0.3, `@types/node` 25.9.5, and `undici-types` 7.24.6. The bootstrap validates names/versions, copies into ignored local `node_modules`, and links the four workspace packages. It never changes the source installations. It is safe to rerun with the same inputs. These copied artifacts are developer tooling, not distributed application files.

For an environment without those local packages, provision the pinned dependencies through its approved package source first. This repository does not claim a registry-installed, integrity-locked toolchain: no registry lockfile was fabricated from VS Code's trimmed compiler distribution. Before team/CI rollout, choose the approved package source, align Node declaration major with the supported runtime, and generate/check in the package-manager lockfile from that source. The current Node declarations are newer than the tested runtime; M1 uses only APIs exercised on Node 24, and domain packages have no Node/DOM ambient types.

## Minimal structure and boundaries

```text
packages/core/src/          pure value objects, identity/evidence, seller, arithmetic,
                            rules, DRY_RUN transitions
packages/application/src/   evaluation, durable contracts/coordinator, bounded read scheduler
packages/adapters/src/      FakeStoreAdapter and Shopify capture/parse/normalize
packages/infrastructure/    SQLite schema, specific repositories, local outbox consumer
tests/fixtures/             versioned synthetic scenario constructors
tests/unit/                 arithmetic, matching, seller/rules, simulation tests
tests/contracts/            reusable observation capability contract suite
tests/integration/          real SQLite mapping, integrity, limits and competing writers
tests/recovery/             rollback, process exit, outbox replay and backup recovery
scripts/                    offline bootstrap and build/check orchestration
```

Core has no outbound package imports. Application imports only core. Adapters import core and application contracts. Infrastructure implements application ports and is the only production package allowed to import `node:sqlite`. SQL rows and driver types stay there. Tests compose packages through public exports; no future packages or placeholder interfaces exist. Each package has its own declaration output and package export; project references enforce build order. Build output stays in ignored `dist` directories.

`lint` checks the import direction, package path boundaries, explicit `any`, non-null assertions, dynamic imports, ambient clock/randomness, network and other excluded global side-effect APIs. Strict compiler diagnostics additionally check unused declarations, fallthrough and return paths. This is intentionally a small M1 policy checker, not a claim of complete ESLint-equivalent coverage or a security sandbox. Formatting uses TypeScript's language-service formatter for source/tests/tooling and `.editorconfig` for repository conventions. Existing architecture documents are not reformatted.

## Domain decisions and immediate consumers

* Money is an immutable signed bigint count of minor units, bounded to ±9 quadrillion. MXN and USD are the supported two-decimal currencies; USD exists to test explicit currency mismatch, not FX conversion. Decimal string parsing rejects excess precision. Acquisition inputs must be nonnegative; profits may be negative. Fees round conservatively upward once at lot level. ROI/margin are exact fractions, and comparisons use cross multiplication. No rounded display value determines eligibility.
* Store-scoped references distinguish product, variant, listing, offer and seller. Canonical matching checks sealed-product kind, set, edition, language and pack units plus a reviewed mapping and coherent relationships. Title matching does not grant equivalence. Unknown required attributes remain indeterminate.
* Observations carry field evidence, source/capture/receipt/expiry times, provenance/version and rights category. The M1 freshness limit is 60 seconds, also applied conservatively to supplied scenario assumptions. Fresh receipt cannot refresh old evidence. Missing price, shipping or tax never becomes zero; NOT_APPLICABLE on a required field also blocks.
* Seller validation has allowlist, denylist, first-party-only and manual-review policies. Deny wins. First-party status uses configured scoped seller references; fulfillment and display name cannot establish it. Approvals remain evidence-bound.
* Opportunity calculation evaluates a same-product/same-quantity manual resale scenario. Additional tax is explicitly **additional** to the quoted price, preventing the fixture from double-counting inclusive tax. The monetary scenario must declare shipping, other acquisition costs, verified discounts, selling fees, outbound costs and loss allowance. Arithmetic COMPLETE means complete cost arithmetic, not eligibility: application admission combines identity, freshness, seller, stock, quantity, cost and rule checks. Persist that distinction explicitly in M2.
* Typed rules support a bounded ALL expression (maximum 32 leaves) with price, shipping, quantity and ROI comparisons. Per-leaf explanations retain operands. A maximum order cap and hard application checks are outside the user expression. No scripting, OR, arbitrary operators or general workflow framework is introduced.
* `evaluateSimulation` consumes the only adapter interface: OfferObservationCapability. Its clock, IDs, requested offer, quantity, scope and policies are explicit inputs. It returns the exact observation used so M2 can persist it without another capture. M2's repository contracts have immediate coordinator consumers; there are no secret, network or market-source ports.
* The use case binds immutable scope and records the intent path CREATED → VALIDATING → READY → IN_PROGRESS → SIMULATED, or VALIDATING → BLOCKED. A passing attempt goes CREATED → READY → SIMULATED. Unsupported transitions and modes fail. Returned checks/transitions/audit are immutable plain data; the only emitted action is PURCHASE_WOULD_HAVE_EXECUTED or PURCHASE_BLOCKED. Core transition helpers validate edges; the application composes admission policy. They are not live purchase authorization tokens.

## Fixtures and tests

All fixtures are synthetic version `synthetic-v1` at a fixed epoch, not recorded retailer responses. They cover correct match, wrong language, wrong pack size, seller rejection/approval, missing price/shipping, stale observation, out-of-stock, ROI below threshold and a valid simulated opportunity.

Additional tests check currency/range/rounding, unknown and future evidence, mapping and offer substitution, deny precedence, first-party fulfillment confusion, negative profit, zero denominators, rule bounds, immutable modes/inputs, typed adapter failures and terminal state edges. Contract tests verify scope, provenance, immutable snapshots, missing capabilities and repeatability. Network traps around the whole scenario matrix assert zero attempted calls, alongside production import/global restrictions.

The documented 3,000 MXN resale fixture produces 300 MXN net estimate and fails 20% ROI. The distinct passing fixture uses 3,500 MXN resale. Neither is a real price or prediction.

## Durable M2 behavior

The host composes one `openDurableStore(path)` instance for an existing local directory. Its public surface provides monitor, evidence, execution and outbox repositories, a coordinator, diagnostics, consistent backup and close. No production singleton, worker process, timer or scheduler is installed. Test workers deliberately open competing connections to verify SQLite enforcement beyond the single-coordinator convention.

Configure a local owner's simulated limit policy, publish a monitor definition, and call `coordinator.run(fakeAdapter, command)`. Definitions persist the exact M1 configuration, campaign and acquisition cycle. A command supplies stable run/operation IDs, revision, trace and explicit logical time. The coordinator reads the configured observation, records immutable facts/evaluations, then requests atomic admission. M2's usage examples and all eleven fixture flows are exercised in the integration suite.

Admission uses `BEGIN IMMEDIATE`, checks the current monitor revision/status and current limit policy, then commits intent, attempt transitions, upper-bound reservation, simulated consumption/released surplus, product guard, operation receipt, safe audit and outbox together. State changes require valid M1 edges and expected state/version; SQL triggers independently enforce edges/version increments and immutable modes/scope. A blocked decision has an intent and audit/outbox but no checkout attempt or reservation. No success is returned before commit. Busy storage returns `STORAGE_BUSY`; other failures expose safe typed codes without raw driver/adapter messages.

Limits use the owner across monitors/products/stores, an explicit UTC daily spend bucket and simulated attempt count, plus campaign/product quantity. Maximum order value remains M1's hard rule and the reserved upper bound. Known simulated acquisition cost becomes consumption; verified surplus is recorded. Product cooldown starts at the committed simulation's logical time. Changing caps does not erase consumption or shorten an existing guard. Currency/timezone cannot silently reset an owner ledger. M2 has no committed outstanding holds or external uncertainty: all local transitions finish in one transaction.

Owner/operation and owner/cycle uniqueness survive restart. A separate owner/product guard spans cycles and monitors during cooldown. Duplicate processing returns the original identified decision, without new audit or consumption. An operation reused for another monitor/revision or a cycle reused for another product/campaign conflicts. A later acquisition requires a deliberate new cycle after all applicable limits/guards permit it. M2 does not automatically reopen a BLOCKED cycle; its persisted result remains replayable. This conservative behavior needs an explicit revalidation command before automatic blocked-cycle retries are introduced.

The durable outbox contains only final simulated decision facts. Its one concrete local notification consumer writes the notification and `(handlerId,eventId)` receipt in one transaction, then acknowledges separately. Delivery is at least once. Receipt replay does not duplicate the local effect. Failed handlers retry after 1 and 2 seconds of supplied time, with three attempts maximum; unknown versions/dead letters stay inspectable. There is no OS notification or external delivery service.

Call `coordinator.recover(now)` once at startup, before accepting work: interrupted read runs become FAILED with an audit reason, and pending outbox notifications can resume. It never replays an adapter or creates a new acquisition identity. Completed evidence from a rolled-back admission remains readable; the caller may explicitly replay the original logical operation. Reopening rejects unsupported/corrupt schemas, missing critical records or unexplained partial simulation/ledger state without resetting data.

`backupTo(path)` uses SQLite's backup API while admission is paused. It durably marks the source before copying, so the resulting snapshot opens in recovery mode even through the normal open function. On success the source's marker clears. A backup failure/crash leaves the source marked for inspection too. Recovery snapshots permit history reads but reject writes/outbox replay; an explicit `recoveryReadOnly` option also supports inspection. M2 intentionally provides no automatic recovery-marker reset/import tool. Never copy only an active main database file or clear recovery metadata to resume hypothetical live work.

Validation: 103 tests pass (50 original M1, 4 new pure guard tests, 31 SQLite integration tests, 18 recovery tests), along with strict typecheck/build, boundary lint and format check. Tests use generated temporary files under `work/m2-tests` and remove them afterward. Actual competing worker connections, abrupt child-process exits, SQLite audit write errors, rollback, duplicate delivery, WAL backup/reopen and recovery quarantine were exercised on Node 24.19.0 / SQLite 3.53.3.

## M2 handoff evidence (historical)

The local SQLite experiment supports this M2 candidate, not packaged Electron compatibility, hardware power-loss durability, physical disk-full handling or production capacity. At that historical M2 stage ADR-001 was EXPERIMENT_REQUIRED. Subsequent M4.5 evidence accepts ADR-001 for the current HTTP-only desktop; see that ADR for the actual packaged Electron/SQLite evidence and residual limits. Drizzle/mapper selection and unrelated physical-failure/capacity qualification are not promoted. Before real reads, obtain merchant authorization and data rights and review retention/redaction and field-specific benchmark freshness. Standard-user packaging, recovery UX, OS protection and a registry-provisioned locked development toolchain remain unproven. M2 itself added no M3 or M4 code.

## M3 fixture adapter

`ShopifyAdapter` exposes URL resolution and coherent observation only. Its concrete `ShopifyFixtureTransport` reads authored in-memory responses for `merchant.invalid`; it cannot open a network connection. The fixed Storefront GraphQL query is a candidate interface, not proof that a merchant permits it or exposes every requested field. The access policy documents this distinction.

Composition is exercised in `tests/fixtures/shopify.ts` and `tests/integration/shopify-durable.test.ts`: create one host-owned `LocalReadScheduler(store.readQuotas, clock, jitter)` shared by all adapters/monitors for that store, construct the fixture transport and adapter, resolve the approved product URL, and publish a monitor using the selected offer and canonical `sourceReference`. Supply a manually reviewed canonical mapping and ordinary seller policy. `coordinator.run` then uses the M2 persistence and DRY_RUN flow. A persisted source reference allows a newly constructed adapter to observe after restart without an in-memory handle cache. No production polling loop or wall-clock host is installed.

Resolution never guesses among multiple variants. Observations retain unknown shipping, additional tax and purchase limits, so these product-only fixtures produce explained BLOCKED decisions even with an approved seller. The existing complete FakeStoreAdapter fixtures continue to exercise SIMULATED decisions. Price/availability changes append history under the same offer identity; duplicate logical operations avoid another read. A new observation of an existing blocked acquisition cycle preserves M2's original cycle decision while storing the new evaluation.

SQLite schema 2 migrates v1 in a transaction, retaining old IDs, observations, ledgers and receipts. It adds normalized store/observation metadata and read quotas, and permits UNKNOWN offer condition. Recovery-marked v1 snapshots remain read-only and unmigrated. New history methods return normalized observations and optional metadata; no raw provider body is persisted. Health and bounded diagnostics are process-local; cadence, backoff, blocking circuits and failed run reasons are durable.

Final M3 validation and historical limitations are recorded in `outputs/M3_REPORT.md`. Subsequent authorized M3.5 evidence is recorded below. No experimental ADR was promoted.

## M3.5 historical preflight-only validation — superseded

The user supplied a successful Kantocards preflight summary from their Windows machine: HTTP 200, served API 2026-07, product `9600895451379`, variant `49183411208435`. The prior agent attempts failed locally with EACCES. The summary is real authorized evidence, but omits the response body and commercial/merchant fields. Its IDs now pass through the existing M3 normalizer and M2 SQLite/coordinator path with explicit summary provenance and omitted facts UNKNOWN: seller REVIEW_REQUIRED, opportunity INDETERMINATE, durable BLOCKED, one outbox delivery and no duplicate replay effect. See `outputs/M3_5_REPORT.md`, `outputs/M3_5_SUMMARY_RESULT.json` and `docs/KANTOCARDS_M3_5_ACCESS.md`. M4 was unopened at that preflight stage; the later full M3.5 result and final M4.5 report supersede that status.

`node scripts/shopify-summary-validation.mjs` replays the saved user summary entirely offline into a new local validation database. It prints PARTIAL; it cannot establish the missing live facts. Build the workspace first.

`node scripts/shopify-live-validation.mjs` skips without both `SHOPIFY_LIVE_VALIDATION_ENABLED=1` and `SHOPIFY_STORE_DOMAIN=kantocards.com`. When explicitly configured on the authorized user's network-enabled host, it performs at most four sequential reads (two per approved product), separated by at least five seconds, with no credentials, redirects or retries. It asserts full normalized evidence, merchant binding, repeated stable identity, M2 persistence, seller/DRY_RUN decisions, reopen/dedup and audit/outbox. Only completed assertions print PASS and save `outputs/M3_5_LIVE_RESULT.json`; failures save a sanitized failure record. The user subsequently executed the full live run successfully; its actual result is retained in `outputs/M3_5_LIVE_RESULT.json`. No normal build/test command makes live requests. No mutation operation exists. The existing fixture adapter remains offline; the validation snapshot adapter reuses its parser/normalizer through the existing observation port. All 201 deterministic tests pass.
