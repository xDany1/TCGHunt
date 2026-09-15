# Implementation roadmap

Baseline: 2026-09-07. The initial review completed documentation only. Subsequent authorized work completed Phase 0 and the bounded M1–M4 desktop slice, including M3.5 real-merchant evidence and final M4.5 Windows validation. Historical milestone evidence is retained below; final M4 closure is recorded in the current evidence section. Later product phases remain future work. Sequence depends on evidence gates, not a promise that every retailer will allow the desired integration.

## 1. Phases and exit gates

| Phase | Purpose and bounded scope | Exit gate |
|---|---|---|
| Phase 0 — architecture / spikes | Review baseline, confirm product/access assumptions, validate packaging, persistence and critical safety feasibility using synthetic/owned systems | Named spikes resolved or safely scoped out; update ADR statuses with actual evidence. |
| Phase 1 — minimal useful product | One persistent safe vertical slice, FakeStoreAdapter plus one authorized Shopify merchant, URL monitoring, explainable evaluation and simulated decision | Acceptance criteria under PHASE 1 pass; user can distinguish opportunity, simulation and actual purchase. |
| Phase 2 — multi-store validation | Amazon-first qualification of stable ASIN / multi-seller monitoring, using the validated read-only BrowserProvider; official Business access remains optional/future; Mercado Libre remains a later marketplace milestone | Core engines unchanged for normal adapter addition; marketplace evidence/negative cases work and real access is separately qualified. Fixtures alone do not establish production readiness. |
| Phase 3 — commercial readiness | Minimal backend, billing/license/device control, signed restrictive flags, secure release/update/recovery, support/privacy operations; broader store qualification | Paid beta does not rely on local license truth; outage/recovery/security tests pass; supported store/region coverage documented. |
| Phase 4 — hybrid/cloud evolution | Move permitted anonymous monitoring/market data to cloud only if usage justifies it; optional notifications and explicit sync ownership | Tenant isolation, data rights, cost targets and execution ownership established before multi-device automation. |

Real order submission is not a required milestone in any phase. It is a separately gated product capability: affirmative permitted access, reliable final quote and seller binding, documented reconciliation, tested duplicate safety, fresh control backend and explicit user opt-in. If these remain unavailable, deliver a useful observe/assist product. No milestone may be “passed” by bypassing a store control.

## 2. Phase 0: proposed spikes and assumptions

These spikes are **EXPERIMENT FIRST**. Timeboxes are planning budgets in engineer-days for an experienced developer; access review may take longer in calendar time. None was executed during the initial documentation review; subsequent local M2 evidence for S2 is recorded below and in ADR-003. Owned fixture pages/fake APIs replace real retailers for failure and checkout experiments.

| ID / timebox | Question, experiment to run later | Evidence and pass/fail decision |
|---|---|---|
| S0 — 1–2 days plus merchant response | Pick launch country/currency, product unit and cooperative Shopify merchant; confirm read/search/cart scopes, retention/commercial use, domain and permitted cadence | Recorded access matrix and actual authorized test source. If absent, Phase 1 remains synthetic prototype and must not be declared a real minimal useful product. |
| S1 — 2–3 days | Package a minimal Electron window, Node coordinator, selected SQLite driver and optional Playwright-owned page on clean supported Windows | Install/run as standard user with no developer runtime, no public debug port; graceful shutdown/restart, native module load, browser path correctness. Provisional target: <500 MB total idle without automation and <1.5 GB with two owned browser contexts; measure working set/private bytes and installed size on a recorded reference machine. If unacceptable, compare equivalent Tauri + sidecar workload before accepting ADR-001. |
| S2 — 2 days | Exercise Drizzle/SQLite candidate driver with concurrent synthetic reservations, WAL, disk failure, backup/reopen and process termination | Exactly one of two competing admissions succeeds, no committed critical audit gap, reopened state is coherent, consistent backup works. Fail: change driver/transaction strategy before schema implementation. |
| S3 — 1–2 days | Map representative sealed products and marketplace offer fixtures: pack/bundle, language, seller/fulfillment, same-title wrong variant | Reviewed fixture corpus distinguishes every unsafe near-match. Fail: keep canonical mapping manual; revise identity contract before adapters proliferate. |
| S4 — 1 day before any session persistence | Verify Windows secret wrapping and intended browser session restore on owned auth pages, standard user and second Windows user | No reusable plaintext artifacts/logs; wrong account cannot restore session; key loss means reauth. If safe persistence cannot be shown, retain memory-only session and interactive login. |
| S5 — 2–3 days | Exercise future submission protocol against a counting fake order endpoint; crash before/after fence, acceptance, response and commit; kill old worker | Replays never dispatch a second ambiguous purchase, unresolved holds persist, no new owner acts with a live old worker. Failure blocks any real mutation capability. No real store checkout. |
| S6 — 1–2 days | Synthetic scheduler load: 100 monitors, shared products, competing priorities, rate-limit responses, suspend/resume | Bounded jobs/contexts, fair service without starvation at offered capacity, dedup preserving attribution, no post-resume burst violating quota. All intervals shown honestly when overload causes delay. |
| S7 — 2 days after initial feedback | Compare plausible margin scenarios and available benchmark evidence against user-verified comparable products | User can explain why each passes/fails; identify missing tax/shipping/liquidity inputs. Numeric opportunity score stays deferred unless evidence supports calibration. |

Only S0, the relevant packaging/persistence portions of S1/S2, and S3 gate the real Phase 1 baseline. S4 gates session persistence; S5 gates future external mutations and can be modeled with fakes during safety development; S6 validates load targets before claiming monitor scale; S7 gates numeric scoring, not threshold arithmetic. HTTP-only Phase 1 need not ship an automation browser if S0 shows none is needed.

Product validation record must answer: launch region/site, desired product categories/languages, minimum useful alert latency, whether desktop uptime is acceptable, reference-price credibility/rights, willingness to pay for observation/assistance, acceptable false-positive rate, and support effort per store. Interview/sample targets can remain small; do not invent favorable research results. A denied source or unviable economics is a reason to narrow scope, not add automation complexity.

## 3. Phase 2 and Phase 3 scope discipline

Phase 2 adds a marketplace to expose multiple offers/sellers, seller-versus-shipper rules, localized prices and incomplete availability. The user-authorized M5 sequence now prefers Amazon Mexico first to test ASIN identity independently of offer availability; this supersedes the original Mercado Libre-first sequencing preference in the architecture baseline without changing its boundaries. Mercado Libre remains later. A second Shopify merchant alone does not validate multi-seller semantics. Extend real keyword discovery only if the chosen source supports it. Each marketplace still requires its own access/retention/region gate; initial product scope does not promise launch support for blocked sources.

### M5 qualification evidence — 2026-09-10

**M5 PARTIAL; live AUTH_BLOCKED.** A bounded SP-API-shaped authored fixture spike demonstrates catalog/child identity, seller versus fulfillment, stable offers, exact MXN values, UNKNOWN propagation and existing M2 durable BLOCKED DRY_RUN evaluation/audit/outbox/reopen behavior. The complete deterministic suite passes 285 tests (224 existing + 61 M5), strict typecheck/build, lint and formatting. No core/application/persistence/UI boundary or schema change was needed; no new ADR is justified. No live Amazon product reads, simulated Amazon purchases or mutations occurred. M4/M4.5 PASS and ADR-001 ACCEPTED remain closed and unchanged.

Official research also identifies **Amazon Business Product Search for MX** as the preferred buyer-oriented access discussion, requiring program approval, registration, Business Product Catalog role, group consent and confirmation of monitoring/history rights. The implemented SP-API fixtures are not Business payload validation. SP-API is a conditional seller-authorized alternative; Creators standard Mexico client/retention restrictions make it unsuitable as the default durable desktop source. See [M5 report and official sources](../outputs/M5_REPORT.md) and [integration study](AMAZON_INTEGRATION.md).

Historical sequencing (superseded by the current M5.4 closure/M5.5 handoff below): resolve approved official access and confidential-client/retention scope, then separately authorize **M5.5 Amazon read-only live validation**. Only after that evidence should M6 adapter work be considered. Durable catalog-only absence history, Business payload parsing and live offer continuity remain unqualified; fixture success does not resolve those gates. **NOT READY — AMAZON API AUTHORIZATION REQUIRED.** M5.5/M6, Mercado Libre, backend/accounts/secrets and purchasing are not started by this entry.

First attempt to add the second adapter using existing public contracts. Record any core change and why it reflects a true new domain concept rather than leaked store mechanics. Do not paper over contradictory semantics with a generic JSON payload consumed by core engines. Store acceptance requires matching evidence, capability-specific health, parser fixtures, rate behavior and safe failure modes.

Phase 3 introduces one backend with license/subscription/device modules and PostgreSQL. Implement auth and activation, signed entitlement/control leases, billing reconciliation, offline behavior, renewal UI, and audited remote disable. Select the billing vendor before integration; Stripe is the preferred candidate from the brief, not an existing dependency. Test copied activation keys, device-slot races, clock rollback, expired leases, webhook replay/out-of-order delivery and backend outages.

Before external distribution, qualify installer/update signing, secret handling, dependency provenance, data retention/export/delete policies, diagnostics redaction, recovery runbooks and user support expectations. Observe-only paid beta can launch without checkout. Assisted preparation is separately evaluated per capability and must preserve truthful unknown-order reporting. Broader market sources need their own data licensing and normalization gates.

### M5.2 dual-provider evidence — 2026-09-10

**M5.2 PASS; READY FOR M5.3 RESTOCK ENGINE.** The separately authorized offline milestone corrects the M5 Business-payload gap with a documented Business Product Search fixture provider and a local semantic HTML browser provider. Explicit provider selection feeds shared normalization/domain mapping; there is no silent fallback or live networking. Equivalent fixtures share stable identities and preserve separate provider provenance through the existing SQLite/coordinator/audit/outbox path. Seller and fulfillment remain distinct; missing facts keep DRY_RUN blocked.

All **359 tests pass (285 existing + 74 M5.2)**, with strict typecheck/build, lint and formatting. Security review finds no evasion or purchase/mutation implementation. No core/application/persistence schema, desktop runtime or ADR change was required. M4/M4.5 PASS, ADR-001 ACCEPTED and the historical M5 PARTIAL/live-authorization gate remain unchanged. See [M5.2 report](../outputs/M5_2_REPORT.md) and [provider architecture](AMAZON_PROVIDER_ARCHITECTURE.md).

Next recommendation is a **separately authorized M5.3**, including explicit handling of absence/partial coverage before any restock transitions are implemented. This entry supersedes the historical M5 next-step sequencing for offline work only. Official live access, production Amazon layouts, browser runtime/permission and retained-data rights remain future gates. M5.3/M5.4/M5.5/M6 have not started.

### M5.3 restock/state-transition evidence — 2026-09-10

**M5.3 PASS; READY FOR M5.4 AMAZON BROWSER READ-ONLY VALIDATION.** The offline, provider-independent reducer now distinguishes explicit unavailable evidence, scoped absence, partial coverage, failed observation and unknown state. First observations initialize; stale evidence rebaselines; failures never imply out-of-stock. Strong explicit unavailable-to-available evidence can generate a seller-approved offer restock. Product/seller approved-offer changes and price-range crossings have separate semantics. Current Amazon subsets never establish complete product/seller absence.

Schema 3→4 adds only restock state/sample/event/outbox/receipt tables. Transactional state/event storage and replay/receipt recovery pass, including unchanged preexisting schema-3 records. Existing opportunity and execution checks remain separate; a detected restock with unknown costs stays BLOCKED DRY_RUN. Both providers and their existing fixtures remain intact. **420/420 tests pass (359 existing + 61 M5.3)**, with strict typecheck/build, lint and formatting. See [Restock Engine](RESTOCK_ENGINE.md) and [M5.3 report](../outputs/M5_3_REPORT.md).

The owner's sequencing correction makes **AmazonBrowserProvider read-only live validation the next active path**. AmazonBusinessApiProvider remains optional/future; Business onboarding is not the immediate development blocker. Historical M5 findings and M4/M4.5/ADR acceptance remain unchanged. M5.4 must be separately authorized and qualify permitted access, runtime and real layout/coverage. No live Amazon browsing, login, evasion, external notification or purchase/mutation work occurred. **M5.4 has not started.**

### M5.4 / M5.4A closed — READY FOR M5.5

**M5.4A: CLOSED — PARTIAL — ACCEPTED BROWSER LIMITATION. M5.4: CLOSED — PARTIAL — ACCEPTED BROWSER LIMITATION.** The final real Windows m5.4a-final-deep-v1 run passed three captures/navigation attempts with JavaScript and natural first-party JSON POST responses. All nine POST bodies failed DECLARED_LENGTH_UNKNOWN_OR_EMPTY qualification; no private availability/buyability, price/currency, seller/fulfillment or lead over UI was established. The audit shows some blocked first-party resources but establishes neither their necessity for offers nor causal suppression of an earlier signal.

Accepted live capabilities: Windows runtime, stable ASIN/title, explicit unavailable, preorder/release date and available/immediate states, durable product-level baselines and reopen/replay, conservative no-fake-Offer behavior and DRY_RUN. Accepted limitations: incomplete anonymous money/seller/fulfillment evidence and no qualified private early signal. Missing facts remain UNKNOWN. Business API remains optional/future, not a blocker. No AmazonPrivateApiProvider. Preserve M5.3 first-baseline, partial/failure/absence, seller and durable idempotency semantics.

**650/650 tests** and formatting/lint/strict typecheck/build pass again for closure. No production code changed and no new Amazon navigation occurred. The final actual run records zero direct private calls, replay, mutations and purchase intents. [M5.4 report](../outputs/M5_4_REPORT.md), [M5.4A report](../outputs/M5_4A_FINAL_DEEP_REPORT.md), [final Windows evidence](../outputs/M5_4A_FINAL_WINDOWS_EVIDENCE.json). No more M5.4/M5.4A diagnostic iterations or live navigations.

### M5.5 — AMAZON BROWSER MONITORING INTEGRATION

**M5.5 = PASS — CLOSED** (2026-09-12). AmazonBrowserProvider now participates in the existing desktop create/update, tick/run-now, pause/resume/archive, cancellation and restart/recovery lifecycle. A store-independent product monitor configuration admits normalized product availability without inventing an Offer. Existing schema-v4 restock samples/baselines/events/outbox, product identities and run/audit records commit atomically. First reads initialize; failures/partial evidence never imply absence; expired evidence rebaselines. Seller approval and opportunity admission remain separate and blocked; DRY_RUN creates no purchase intent merely from monitoring.

All **694/694 tests** and strict typecheck/build, lint and formatting pass for closure. [M5.5 report](../outputs/M5_5_REPORT.md), [closure log](../outputs/M5_5_CLOSURE_TESTS.txt), [accepted Windows evidence](../outputs/M5_5_WINDOWS_RESULT.json). The real Windows result is BOUNDED_WINDOWS_LIFECYCLE_VALIDATED: reopened/pauseResume true; three matching Amazon/BROWSER/MX/store/ASIN contexts; three StoreProducts and restock samples; zero Offers, sellers, restock events, purchase intents and checkout attempts. Accepted states: B0H78BB9TY UNAVAILABLE; B0HG3C5JK6 AVAILABLE/PREORDER, release 2026-11-13; B0GYVHLP4L AVAILABLE/IMMEDIATE. Unknown offer-level facts remain UNKNOWN; opportunity admission stays blocked. First observations are baselines, not restocks.

The capture-ID correction is validated; no remaining M5.5 Windows acceptance gate. The shared six-read durable ceiling and 60-second source interval remain unchanged. No live run, passive recon, unattended monitoring or product feature was started by closure. Closed M5.4/M5.4A and accepted ADR-001 are unchanged.

### M5.6 — AMAZON RESTOCK ALERT & OPPORTUNITY HANDOFF

**M5.6 = PASS — deterministic acceptance (2026-09-12). M5.5 remains PASS — CLOSED. M5.7 NOT STARTED.** The user supplied and explicitly started this milestone. Objective: connect durable monitoring/restock outcomes to the existing Restock Engine, read-only Opportunity Engine handoff and durable desktop alerts while keeping monitoring state, stock event, opportunity decision, purchase readiness and execution separate.

Implemented a versioned optional alert projection in the existing event envelope and a bounded Alerts view. Existing preorder/restock/price rules and schema v4 are reused. Event identity/local receipts survive transaction faults, outbox replay and restart. Missing Amazon Offer/context evidence yields BLOCKED / INDETERMINATE without suppressing an alert; complete reviewed fixtures reach core arithmetic without admission. No purchase intents or execution effects from this path.

**722/722 tests** (694 preserved + 28 new), strict typecheck/build, lint, format check and production packaging pass. Authored BrowserProvider → normalization → product monitoring transaction → event/alert → restart/outbox delivery, Shopify regressions and React rendering are covered. No new live run or actual restock is claimed. No separate Windows acceptance is required for these deterministic additions; packaging is not a new runtime interaction test. The existing 60-second cadence/comparison-age limitation remains.

[Report](../outputs/M5_6_REPORT.md), [complete validation log](../outputs/M5_6_TESTS.txt), [security review](../outputs/M5_6_SECURITY_REVIEW.json). No M5.6 acceptance blocker remains. M5.7 requires separate scope/authorization. Backend execution research below is preserved and not implemented in M5.6.

### M5.7 — CONTROLLED AMAZON CART CORRELATION & EXECUTION READINESS

**M5.7O INCONCLUSIVE — FAIL CLOSED (Outcome C)**. The immutable Run 14 proves hidden IS_BUY_NOW/NONZERO with trusted Add-to-Cart; the overwritten mutable summary is a fenced retry. One passive product navigation reached a continue-shopping interstitial, which was not bypassed. Product form/source semantics remain unavailable. 1,144 tests and quality gates pass. Routing and execution policy unchanged; all fourteen IDs consumed. No fifteenth mutation run, BackendCartTransport or next milestone prepared. [Passive attribution and exact evidence gap](../outputs/M5_7O_REPORT.md).

Earlier handoffs below are historical. M5.7 remains open and blocked on field-specific semantics.

**M5.7N IMPLEMENTED — FOURTEENTH WINDOWS BUY_NOW DIAGNOSTIC RUN PENDING**. Diagnostic-only closed candidate identity, qualified pre-click form metadata, trusted submitter projection and body correlation are implemented. ACTIVE/UNKNOWN still block; routing/native policy permissions are unchanged. 1,133 tests and configured quality gates pass. All thirteen previous IDs remain consumed. No live run, BackendCartTransport or next milestone started; M5.7 remains open. [Report and sole diagnostic command](../outputs/M5_7N_REPORT.md).

Earlier handoffs below are historical; no execution permission is expanded by N diagnostics.

**M5.7M INCONCLUSIVE — FAIL CLOSED (Outcome C)**. Run 13 proves BUY_NOW / ACTIVATION_FLAG / NONZERO / ACTIVE under the current code, but its exact key, DOM origin and field-specific meaning are not recoverable from the retained projection. The block and all runtime guards remain unchanged. No fourteenth run is prepared. All thirteen prior IDs are consumed. M5.7 remains open; no live action, BackendCartTransport or next milestone started. [Diagnosis and specific evidence gap](../outputs/M5_7M_REPORT.md).

Earlier handoffs below are historical. Execution research remains stopped; no further run is prepared.

**M5.7L IMPLEMENTED — THIRTEENTH WINDOWS CART CORRELATION RUN PENDING**. BUY_NOW presence is now separate from INACTIVE / ACTIVE / UNKNOWN activation. Only recognized inactive public flags under the complete trusted native Add-to-Cart gate can cease blocking; active/unknown states and Buy Now submissions still block. 1,080 tests and all configured quality gates pass. Run 12 proves the BUY_NOW category but its exact live key/origin/value remains unknown. All twelve previous IDs are consumed. No live run, BackendCartTransport or next milestone started; M5.7 stays open. [Report and sole thirteenth-run command](../outputs/M5_7L_REPORT.md).

Earlier handoffs below are historical.

**M5.7K IMPLEMENTED — TWELFTH WINDOWS CART CORRELATION RUN PENDING**. Explicit native form field-name semantics and category-only diagnostics replace broad substring matching. Run 11 proves FIELD_NAME rejection but redaction prevents identifying the exact live key; authored false-positive reproduction is not claimed as live evidence. Full native eligibility, sensitive value policy, routing authorities/paths and browser-only dispatch remain intact. All eleven previous IDs remain consumed. No live run, BackendCartTransport or next milestone started; M5.7 remains open. [Report and sole twelfth-run command](../outputs/M5_7K_REPORT.md).

Earlier handoffs below are historical.

**M5.7J IMPLEMENTED — ELEVENTH WINDOWS CART CORRELATION RUN PENDING**. Run 10 route failure is reproduced as an unsupported Playwright handle-binding/cleanup defect; immutable trusted-event snapshots replace live Event handles. Sanitized fail-closed route diagnostics and post-continuation dispatch accounting are implemented. 1,001 tests and all configured quality gates pass. Routing, forbidden-operation guards, hosts and production BrowserProvider are unchanged. All ten prior IDs remain consumed. No live run, BackendCartTransport or next milestone started. M5.7 remains open. [Report and sole eleventh-run command](../outputs/M5_7J_REPORT.md).

Earlier M5.7 handoffs below are historical; their operation IDs are consumed.

**M5.7I IMPLEMENTED — TENTH WINDOWS CART CORRELATION RUN PENDING**. A scoped native POST/document gate separates recognized opaque secret values from forbidden-operation semantics and requires retained-control/form trusted Event handles, ordered submit evidence and a bounded same-action envelope. 984 tests and quality gates pass. Router changes are explicit and limited to this correction; hosts/path families, confirmation, viewport and production provider remain unchanged. [Current report and sole tenth-run command](../outputs/M5_7I_REPORT.md). All nine prior IDs consumed; evidence preserved. No live run, BackendCartTransport or next milestone started. M5.7 remains open.

Earlier M5.7 handoffs are historical; their commands must not be rerun.

**M5.7H IMPLEMENTED — NINTH WINDOWS CART RUN PENDING**. Form canonical matching now covers the existing narrow opaque and legacy ref single-segment cart-add semantics. The omitted legacy branch is proven in code/tests; Run 8 raw suffix remains redacted and its exact subcause is not claimed. Routing permissions, runtime, viewport and production provider unchanged. 926 tests and quality gates pass. [Current report and sole ninth-run command](../outputs/M5_7H_REPORT.md). All eight prior IDs consumed; evidence preserved. No live run, BackendCartTransport or next milestone started. M5.7 remains open.

Earlier M5.7 handoffs are historical; their commands must not be rerun.

**M5.7G IMPLEMENTED — EIGHTH WINDOWS CART RUN PENDING**. Semantic preselection is now explicit and separate from final CLICK_QUALIFIED selection. Run 7 already had a pinnable index but failed formActionQualified; that omitted semantic failure is now reported. Invisible structural panels no longer signal active modals. 902 tests and quality gates pass. Routing/confirmation and production BrowserProvider unchanged. [Current report and sole eighth-run command](../outputs/M5_7G_REPORT.md). All seven prior IDs consumed; evidence preserved. No live run, BackendCartTransport or next milestone started. M5.7 stays open.

Earlier M5.7 handoffs are historical; their commands must not be rerun.

**M5.7F IMPLEMENTED — SEVENTH WINDOWS CART RUN PENDING**. Run 6 safely blocked before clicking; viewport and obstruction are now diagnosed separately. The pinned product/form-bound control may be normally scrolled and must pass fresh binding, stable geometry and hit tests before one native click. Blocking modals stop without interaction. Routing permissions and production BrowserProvider unchanged; unagi/fls-na remain blocked. 884 tests and quality gates pass. [Current report and sole seventh-run command](../outputs/M5_7F_REPORT.md). All six prior IDs are consumed and artifacts preserved. No live run, BackendCartTransport or next milestone started. M5.7 remains open.

Earlier M5.7 handoffs below are historical and their commands must not be rerun.

**Current: M5.7E IMPLEMENTED — SIXTH WINDOWS CAUSALITY DIAGNOSTIC RUN PENDING.** Exact control/form selection diagnostics, passive DOM events and CDP initiators added; 868 tests and all quality gates pass. [Current report and sixth-run command](../outputs/M5_7E_REPORT.md). Routing/authority rules unchanged; unagi/fls-na remain blocked. All five prior IDs consumed, artifacts unchanged. No live run, BackendCartTransport or next milestone started; M5.7 stays open. Earlier entries are historical.

**Current: M5.7D IMPLEMENTED — FIFTH WINDOWS CART CORRELATION RUN PENDING.** Explicit active-before-click/observation snapshots, bounded GET/XHR qualification and correlation correction implemented; 848 tests and quality gates pass. [Current report and fifth-run command](../outputs/M5_7D_REPORT.md). All four previous IDs consumed, evidence unchanged. M5.7 remains open. No authority expansion, unagi/fls-na approval, live run, BackendCartTransport or next milestone. Earlier handoffs below are historical.

**Current: M5.7C IMPLEMENTED — FOURTH WINDOWS CART CORRELATION RUN PENDING.** Diagnostic host/path/forbidden-source visibility added; no new subdomain authority approved because the exact hostname/path is absent from Run 3. 838 tests and quality gates pass. [Current report and fourth-run command](../outputs/M5_7C_REPORT.md). All three previous IDs are consumed; evidence unchanged. M5.7 remains open and authority qualification remains evidence-blocked. No live run, BackendCartTransport or next milestone started. Earlier handoffs below are historical.

**Current: M5.7B IMPLEMENTED — THIRD WINDOWS CART CORRELATION RUN PENDING.** Run 1 CART_OUTCOME_UNCONFIRMED and Run 2 STOPPED_SAFELY are preserved; both IDs consumed. Qualified single-segment `/cart/add-to-cart/*` browser pass-through now requires explicit research opt-in, immediate-product qualification, action/click initiation and one shared cart-dispatch fence. 825 tests and all quality gates pass. [Current report and sole third-run command](../outputs/M5_7B_REPORT.md). M5.7 remains open. No live run or next milestone started; BackendCartTransport remains deferred. Earlier handoff entries below are historical.

**Current correction: M5.7A IMPLEMENTED — SECOND WINDOWS CART CORRELATION RUN PENDING (2026-09-13).** Run 1 is preserved as CART_OUTCOME_UNCONFIRMED / NATURAL_ACTION_TRAFFIC_BLOCKED_OR_UNQUALIFIED. First operation ID consumed; no reuse. Research-only routing now separates narrowly qualified natural cart pass-through from metadata inspection, with one dispatch and confirmed-state mutation accounting. 800 deterministic tests and quality gates pass. [M5.7A report and sole current Windows command](../outputs/M5_7A_REPORT.md). M5.7 remains open, no second run executed here, BackendCartTransport and subsequent milestones remain deferred. The initial implementation record below is historical.

**M5.7 IMPLEMENTED — WINDOWS CART CORRELATION VALIDATION PENDING** (2026-09-12). Explicitly started by the user after M5.6 PASS. Implemented an isolated CLI BrowserCartTransport research path, not a desktop/production capability. Defaults non-mutating; manual CART_RESEARCH opt-in, rendered context/quantity/empty-cart proof, explicit price/seller expectations and research-only UNKNOWN acknowledgement gate one browser cart action/request. First command selects only B0GYVHLP4L / IMMEDIATE.

The bounded harness separates baseline/action traffic, retains sanitized semantic evidence, requires product-bound browser cart confirmation, consumes a durable one-use operation fence and never replays requests. No login/profile import, checkout, payment, order, backend transport, schema change or production monitoring mutation. 784/784 tests (722 preserved + 62 new), typecheck/build, lint and formatting pass. No live cart action was executed here.

[Report and single Windows command](../outputs/M5_7_REPORT.md), [pending result artifact](../outputs/M5_7_CART_CORRELATION_RESULT.json), [tests](../outputs/M5_7_TESTS.txt). Cart/network success and backend feasibility remain unvalidated. M5.7 is not PASS. Prior milestone decisions remain closed. BackendCartTransport qualification is only a potential later separately authorized milestone; no next milestone was started.

### Future Execution Engine objective — Amazon backend-first research (not M5.5)

Preserve Amazon backend-first detection and execution as explicit future research objectives. During the separately scoped Execution Engine phase, correlate baseline page-load traffic with controlled **Add to Cart**, **Buy Now**, and **Reserve Now / preorder** actions. This task and M5.5 do not implement or perform those actions.

Investigate whether a controlled cart action exposes offer/listing identifiers, merchant/seller identifiers, cart mutation endpoints, session requirements, CSRF/token requirements, price/quantity guards, and preorder-specific behavior. Record supported versus unknown semantics; no current passive endpoint is promoted into a production dependency by this roadmap entry.

The intended future architecture permits **BrowserCartTransport** and **BackendCartTransport** behind the Execution Engine's capability boundary. Both must produce store-independent results and share execution safety/idempotency rules; Amazon URLs, request signatures, tokens and payload internals stay inside the transport/adapter boundary. These are future design options, not new packages/interfaces or an AmazonPrivateApiProvider. BackendCartTransport denotes the prospective store-facing backend/HTTP path; hosting and session ownership remain a later decision, not implicit cloud-service implementation.

Future backend availability evidence may emit **RESTOCK_CANDIDATE** only as a reevaluation signal. It must not become purchase-ready without **ASIN match, approved seller, price guard, offer identity, fresh availability, and idempotency / duplicate guard**. Preserve all additional existing cost/mode/permission/reservation and ADR-005 execution gates; a candidate alone never dispatches a purchase. Session/CSRF handling remains subject to the existing secret boundary and must not leak reusable secrets into core, logs or persisted evidence.

M5.7 now prepares only the explicitly bounded browser cart-correlation experiment described above. Backend-first detection and production BrowserCartTransport/BackendCartTransport execution, session ownership and purchase-readiness integration remain deferred to a separately authorized future phase. No cart/backend transport, login/session/token work, checkout/order/payment capability or private API provider is implemented by this closure or by the M5.5 monitoring handoff.


## 4. What stays simple and what stays deferred

Keep simple: one desktop data owner; one SQLite database; a small static adapter registry; explicit function/transition tables; local structured logs/metrics; native local notifications; manual mapping/benchmark; direct application calls where order matters; a small transactional outbox. No general workflow designer, scripting rules, custom DI framework, generic repository hierarchy, custom updater protocol, or process per monitor.

Defer: multi-device synchronization, cloud job scheduling, mobile push, reseller inventory/portfolio, realized profit accounting, release calendar, sealed-versus-single-card expansion, prediction/ML, liquidity/reprint scoring, central market aggregation, broker infrastructure, remote adapter code loading, distributed locks and tenant-aware shared execution. Reserve clear IDs/contracts, not speculative implementation.

Before Phase 4, choose authoritative owner per data type: cloud may own licensed aggregate market facts and anonymous jobs; desktop owns retailer session and local profile refs; purchase commitment and shared spend authority must be singular. Moving a monitor to cloud requires permission/ownership/retention changes, not just a PostgreSQL driver. Never synchronize the SQLite file or replay desktop submission events in the cloud.

## 5. Decision gates and documentation upkeep

High-cost boundaries selected now: commercial identity, snapshot/evidence semantics, module dependency direction, safe execution authority, immutable modes, atomic budget reservation, unknown-state recovery, secret locality and event delivery guarantees. The ADRs record alternatives and reversal costs.

Reversible/deferred choices: UI toolkit details, styling/navigation polish, chart library, state-machine library, exact scheduler tuning, log exporter, backend hosting vendor, billing vendor, ORM driver after spike, and future score weights. A specific vendor choice must not leak into domain rules.

At each gate update the affected ADR's status and dated evidence, this roadmap's acceptance status, and domain/architecture contracts if changed. Do not mark a recommendation experimentally validated because this documentation exists. Stop broadening tests once the relevant acceptance checks pass unless a new change/failure introduces risk.

# ARCHITECTURAL DECISIONS

The significant decision register is maintained in [ARCHITECTURE.md](ARCHITECTURE.md#architectural-decisions) and ADR-001 through ADR-008. It distinguishes accepted boundaries from unexecuted experiments; roadmap sequencing does not override safety invariants.

# PHASE 1

## Scope

One standard-user Windows application and one local database. One selected currency/region, sealed products, exact manually reviewed canonical mapping, local seller policy, a manually entered dated resale benchmark, typed price/shipping/ROI/quantity rules, and simulated budget/quantity/attempt limits. A real URL monitor reads one approved Shopify merchant; FakeStoreAdapter also exercises keyword monitors, multiple sellers, errors and incomplete fields. Real keyword search is optional only when authorized by S0; unsupported search is visibly unavailable.

Required flow:

```text
monitor definition/revision
  -> scheduled run -> candidate/capture -> typed observation
  -> exact canonical/variant/offer normalization
  -> seller evaluation -> financial scenario
  -> eligibility + hard safeguard + simulated limit evaluation
  -> immutable DRY_RUN intent/attempt
  -> PURCHASE_WOULD_HAVE_EXECUTED (or explained blocked decision)
  -> persistent audit/history and local notification
```

Use anonymous reads; no saved passwords, real session store, real cart operations, payment methods, checkout navigation, order submission, real Order rows, real spend, backend or subscription. Conceptual Account/Profile ports are represented by an anonymous execution context and delivery-cost assumptions where appropriate. Unknown required delivery cost/limit blocks the simulated buy decision and remains visible as an opportunity for review. This is stricter than merely displaying an estimated opportunity.

## Milestones

1. **M1 — deterministic domain slice.** FakeStoreAdapter, fixtures, identity/money/evidence types, seller engine, cost arithmetic, typed rules, explicit simulation state transitions. Demonstrate both passing and blocked decisions without external effects.
2. **M2 — durable slice.** SQLite repositories, monitor revision/run records, observations/evaluations, simulated intent and isolated simulated limit ledger, durable audit and critical work outbox. Reopen/replay safely after injected failures.
3. **M3 — first authorized data.** Shopify URL resolution/observation with capture/parse/normalize separation, access policy, rate-aware scheduler and per-capability health. Show current and historical observations with evidence quality.
4. **M4 — usable packaged desktop.** Minimal monitor editor, dashboard, opportunities and drill-down history; safe settings, start/pause and clearly visible DRY_RUN. Complete Windows packaging smoke check and demonstrate the end-to-end flow.

## Acceptance criteria

### Recorded M2 evidence — 2026-09-07

M2's synthetic durable slice is complete: local SQLite repositories persist monitor revisions/runs, exact catalog/evidence/evaluation snapshots, isolated simulated intent/attempt/limit history, critical audit, outbox, consumer receipts and a local notification projection. The original domain calculations remain independent of persistence. M3/M4 code was not introduced.

Validation passed 103 tests: 50 original M1 tests, 4 pure durable-guard tests, 31 real SQLite integration tests and 18 recovery tests; strict typecheck/build, lint and formatting also pass. Real competing writer transactions cannot both acquire the constrained budget/product scope; abrupt process exits and injected audit/transaction failures preserve atomicity; reopen/replay retains identity; consumer receipts prevent duplicate local effects; consistent backups open without write authority. ADR-003 records the tested Node/SQLite versions and remaining qualification limits.

M2 scope choices: explicit UTC daily buckets, owner-scoped spend/attempt counts, campaign-scoped product quantity, stable owner/cycle and operation identities, and a separate product cooldown guard. All local simulation transitions commit together, so no externally uncertain or outstanding held commitment is introduced. Blocked cycles remain replayable; automatic revalidation of an existing blocked cycle needs a separate future command. Recovery marks interrupted reads failed for explicit retry and drains pending local notifications without replaying adapter calls.

This is evidence to start M3 planning/implementation when separately authorized. It does not satisfy the real-merchant, scheduler/load, UI or packaged Windows acceptance gates below. S0 authorization/data rights, S1 packaged runtime evidence, and the remaining physical disk/power-loss and packaging portions of S2 remain open. Other experimental ADR statuses are unchanged.

### Recorded M3 fixture evidence — 2026-09-08

M3's explicitly permitted fixture fallback is implemented: Shopify URL resolution and observation, isolated capture/parser/normalization, exact store/product/variant/listing/offer/seller references, normalized metadata, bounded FIFO reads with durable cadence/backoff/blocking circuits, per-capability health and safe local diagnostics. Authored `.invalid` fixtures flow through existing M2 repositories, seller rules, opportunity arithmetic and DRY_RUN decisions. Product-only shipping/tax/purchase limits remain unknown and block simulated acquisition; no approval is manufactured. SQLite schema 2 migration retains M2 evidence and commitments, and restart preserves read throttling and identity.

This is local fixture evidence, not real HTTP/store feasibility evidence. No approved live merchant or real response corpus was available; no retailer read occurred. The concrete transport cannot access the network. `docs/SHOPIFY_FIXTURE_ACCESS.md` records the access assumptions and `outputs/M3_REPORT.md` records validation and remaining acceptance gaps. Existing experimental ADR statuses are unchanged; no system-wide architecture or universal Shopify semantic decision is inferred from authored fixtures.

**M3 real-data acceptance remains incomplete; NOT READY FOR M4.** Complete S0 authorization/data rights and an independently qualified real read before proceeding. M4 implementation was not started. M2's packaging, power-loss, toolchain and recovery UX limitations remain open.

### Recorded M3.5 partial authorized evidence — 2026-09-09

The user supplied a successful authorized Kantocards tokenless GraphQL 2026-07 preflight summary: HTTP 200 and parsed primary-product/variant IDs. This changes the earlier absence of live access evidence for this exact merchant/query; it establishes no universal Shopify contract or commercial reuse rights. Its omitted price/currency/availability/merchant body fields remain unverified. The secondary product has no supplied live result.

The reported IDs/timestamps now persist through the existing M2 path with explicit summary provenance and omitted facts UNKNOWN. Seller REVIEW_REQUIRED, opportunity INDETERMINATE and a durable BLOCKED DRY_RUN decision survive reopen; the outbox delivers once with no replay effect or consumption. All 201 deterministic tests pass. The opt-in four-read full validation composition is implemented and locally tested with authored scaffolding, but its full real run remains pending. See `outputs/M3_5_REPORT.md` for evidence and limitations. **PARTIAL; NOT READY FOR M4.** No experimental ADR or other roadmap gate is promoted.

### Current Phase 1 milestone evidence — M4 closed

Latest milestone evidence (2026-09-09): the full user-run M3.5 result and its database supersede the preflight-only PARTIAL record above. Both authorized products passed real interface/identity/durability checks; their blocked decisions and unknown costs remain truthful. M4 independently verified unchanged row hashes on a schema-3 copy. The M3.5 gate is satisfied; see the current addendum in `outputs/M3_5_REPORT.md`.

**M4 PASS; M4.5 PASS; ADR-001 ACCEPTED; READY FOR NEXT PHASE** (final review 2026-09-09, local date). The real target-Windows package demonstrates Electron/React/SQLite/coordinator operation, prominent DRY_RUN, authorized Kantocards observation at 95.00 MXN, truthful UNKNOWN and INELIGIBLE / Simulation Blocked results, visible product/history/audit, pause/resume and persisted graceful close/reopen. Network authorization is required per launch; its absence safely disables reads without removing data.

Five processes remain stable (main/GPU/renderer/two utilities). Idle working set/private memory approximately 367.5 / 218.4 MB; during/after observation 381.1 / 251.8 MB. Idle CPU: 0.0625 CPU-seconds over 10 seconds, equivalent to 0.625% of one logical core. Cold/warm process-launch timings: 30.7648 / 11.1073 ms; graceful shutdown: 102.5134 ms. Launch timings are not time to interactive UI. Applicable HTTP-only S1 packaged/lifecycle/resource evidence meets the provisional 500 MB idle target; browser/large-workload claims remain outside this experiment.

All 224 deterministic tests, strict build/typecheck, lint and formatting pass again; production/test packages previously built successfully and all 79 production files still match. Independent SQLite inspection verifies stable identities, four observations/evaluations, one blocked intent, delivered audit/outbox receipt and no checkout attempts. The user's final direction permits security acceptance through source/configuration/tests, verified against the actual shipped ASAR's isolation, sandbox, DevTools, CSP, IPC and navigation wiring.

The automated Electron smoke remains failed before dynamic assertions, including in an automated run on the user's target where normal packaged launch works. Record this as a **non-blocking automated-launch environment/harness limitation**, with unresolved root cause; do not call it a passing test. Dynamic security probes and true UI-readiness timing remain follow-up coverage. No production safeguard was weakened. See `outputs/M4_5_REPORT.md`, `outputs/M4_5_FINAL_USER_EVIDENCE.json` and ADR-001 for the evidence basis and limits.

Only M4 and the applicable runtime experiment are closed here. S4 sessions/secrets, S5 future mutation safety, S6 scale/load and commercial/distribution work keep their separate gates; no unmeasured capacity or future capability is accepted. Readiness permits planning the next separately authorized scope; **no subsequent phase was started**.

* A persisted monitor resumes after restart and respects its revision, pause state and store rate policy; suspend/resume coalesces missed runs.
* A permitted real Shopify observation passes through every stage with attributable IDs. If access cannot be obtained, the fake prototype can pass technical tests but Phase 1's real-data acceptance remains incomplete.
* Exact variant/pack/language and seller are visible. Wrong/unknown mapping, denied seller, unknown/stale required facts, out-of-stock, exceeded limits and low ROI all produce explicit blocked results.
* On a complete passing fixture and on qualifying real evidence if available, the system persists exactly one simulated decision per active acquisition cycle with `PURCHASE_WOULD_HAVE_EXECUTED`, input references and mode. The UI does not claim a purchase happened.
* Repeated observations, overlapping monitors, duplicate events and restart do not duplicate the same simulated commitment. A separate future cycle follows configured cooldown; simulated records cannot become live work.
* Adversarial mode inputs, UI commands and replay produce zero outbound cart/checkout/order mutations, zero real orders and zero real spend. An isolated test transport proves this, beyond merely checking an audit message.
* For the synthetic calculation in Architecture §10, output net estimate is 300 MXN, ROI approximately 14.2857%, margin 10%; a 20% ROI requirement fails. Missing cost is indeterminate, not zero.
* A reviewer can follow monitor/run → observation → seller → scenario → rule → intent/attempt → audit, including versions and failure reasons, without raw secrets/PII.
* On recorded S6 hardware/workload, workers/contexts stay within caps; lower-priority work progresses at available capacity and overload is visible. Do not describe this as proven capacity before measuring it.
* Installation, launch, local data persistence and graceful stop work under a standard Windows account without a development toolchain.

## Minimum tests

Unit: exact money/currency/rounding and unknowns; seller deny precedence and fulfillment distinction; variant matching; typed rule conjunction; invalid transitions and immutable modes. Contract: fake and Shopify read capabilities, partial results, parser failure, field provenance and scoped IDs. Integration: actual temporary SQLite transactions, concurrent simulated reservations, duplicate run/event delivery, outbox recovery, audit/disk failure and restart. E2E: packaged app/fake endpoint flow plus negative renderer commands; approved real read smoke check separately. Fixtures are versioned and sanitized. No test makes a real purchase.

## Minimum observability and risks validated

Structured redacted logs with trace/operation/run/offer/evaluation/intent IDs; counters for checks/failures/discovery/seller results/simulated decisions; request and queue latency; last-success/capability health; persistent audit with decision inputs and versions. Local metrics and a diagnostics view are sufficient; no telemetry backend required.

This slice validates access viability, product matching, seller evidence, truthful cost uncertainty, deterministic rules, durable replay, UI/domain separation and utility of explainable opportunities. It does **not** validate production live checkout, cross-device budgets, commercial retention rights beyond the selected source, or profitability of buying Pokémon products. Those remain explicit later gates.
