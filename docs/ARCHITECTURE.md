# Pokémon TCG Opportunity & Purchase Platform — Architecture

## M5.5 application monitoring extension — 2026-09-12

The durable desktop lifecycle now accepts a store-independent product monitor configuration in addition to the existing offer simulation configuration. Product identity/availability may be known while no seller-specific Offer exists; requiring an offerRef would corrupt identity. Existing ProductPageObservation and Restock Engine semantics provide the comparison model. Optional typed price/seller/fulfillment evidence is presentation data, not acquisition permission. Core and reducer algorithms remain unchanged.

The single desktop coordinator owns scheduling and SQLite. ProductMonitoringRepository atomically commits normalized sample/baseline/transitions/outbox, stable product rows, run completion/audit and failure restriction in schema v4. Product monitoring never invokes execution admission or fabricates Offer/seller identity. The offer simulation coordinator rejects product-only configurations. Concrete source routing and AmazonBrowserProvider/Playwright composition live outside core/application; renderer sees bounded DTOs only. Historical M5.4 input fingerprints remain unchanged unless the explicit monitoring-details projection is requested.

M5.5 is PASS with accepted bounded Windows monitoring/lifecycle evidence; see [report](../outputs/M5_5_REPORT.md). The following architecture review is the original baseline. M4/M4.5, ADR-001 and closed M5.4/M5.4A remain accepted within their recorded evidence limits. No execution/backend transport or next milestone is implemented by this extension.

Review date: 2026-09-07. Scope: architecture and documentation only. No spikes have been executed and no runtime, dependencies, database, adapters, or checkout have been implemented.

## 1. Authority, interpretation, and decision status

The primary product specification is the complete user-provided `PROJECT_BRIEF.md` in Downloads. The user expressly authorized an architecture review and documentation under `docs/` only. Future implementation instructions in the brief describe later phases; they do not authorize implementation in this task.

This document is the recommended architecture baseline for subsequent implementation sessions. It records engineering decisions, not a claim of user approval of every recommendation. Read it with [Domain model](DOMAIN_MODEL.md), [Roadmap](ROADMAP.md), [Threat model](THREAT_MODEL.md), and the eight linked ADRs. ADRs explain rationale; this document owns system-wide behavior; the domain model owns entity and state semantics. Changes must update affected documents together.

`DECIDE NOW` protects an expensive boundary; `DEFER` postpones implementation or commitment; `EXPERIMENT FIRST` requires a later spike. ADR status `ACCEPTED` means selected for this design baseline, `PROPOSED` means recommended but unresolved, `EXPERIMENT_REQUIRED` means evidence is required, and `DEFERRED` means deliberately postponed. These are separate from implementation status. Migration cost bands: LOW = approximately 1–3 engineer-days, MEDIUM = 1–3 engineer-weeks, HIGH = 1–3 engineer-months, VERY HIGH = multiple months and potentially user/data migration. These are planning estimates for a small product, not promises.

Working assumptions: Windows-first, one active installation owning execution, initially sealed Pokémon TCG products, one selected market/currency for the first slice, manual canonical mapping, and no live order submission in Phase 1. MXN is used in worked examples because the brief uses it; shipping region, store country sites, and actual launch currency remain product validation items. Store regions must never be inferred from an example currency. Initial store scope is Shopify, Mercado Libre, Amazon, and Walmart across staged phases, conditional on authorized access.

## 2. Product understanding, goals, and corrections

The product turns independently collected store evidence into explainable acquisition decisions, then optionally assists a purchase. Its value is trustworthy product matching, seller checks, landed-cost estimates, and an audit trail. Faster checkout is not the primary success metric.

Goals: preserve the distinction between discovery, opportunity analysis, and execution; retain permissible observations from V1; expose uncertainty; enforce purchase limits atomically; recover conservatively from external uncertainty; maintain adapters independently; and support a paid desktop product without redesigning the core.

Non-goals for Phase 1: real orders, real cart mutation, subscriptions, cloud monitors, sync, inventory/portfolio management, individual-card grading, predictive market intelligence, automatic repricing, remote plugins, distributed queues, or universal store coverage.

Changes to the original proposal:

| Original idea or risk | Recommended correction and consequence |
|---|---|
| A single StoreAdapter with everything from search to order confirmation | Register a descriptor plus optional capability ports. Unsupported checkout is an ordinary product state, not a throwing stub. |
| ProductListing as the central identity | Separate CanonicalProduct, StoreProduct, Variant, Listing, Offer, and Seller. Marketplace offer changes must invalidate approval. |
| One checkout state machine starting at DISCOVERED | Separate opportunity snapshots, purchase intents, attempts, and orders. A newly found product is not a pending purchase. |
| “Sold by Amazon and/or ships from Amazon” | Seller identity and fulfillment are separate facts. Fulfillment alone never establishes first-party seller identity. |
| Guaranteed avoidance of every duplicate | Enforce one logical commitment and block ambiguous retries. Exactly-once effects cannot be guaranteed without equivalent external support; manual activity and hostile local changes remain outside that guarantee. |
| Stock scarcity and a 0–100 score imply opportunity | Sparse stock and asking prices can be misleading. Begin with explicit cost arithmetic and evidence coverage; postpone score weights until validated. |
| Save all source history indefinitely | Keep permitted typed observations; attach source retention rights. If a provider forbids historical retention, choose another source or disable that feature for it. |
| Many accounts can increase acquisition volume | Account isolation is supported; product limits span accounts and stores. Accounts must not be rotated to bypass store limits or rate restrictions. |
| Remote disable without a backend | A desktop-only V1 cannot receive an immediate remote kill switch. Accept this only while it has no live submission path; add a control backend before paid beta. |
| An ORM makes SQLite-to-cloud migration automatic | Repository boundaries preserve domain code. Data ownership, migrations, concurrency, and sync still need deliberate work. |

## 3. Principal risks and validation

| Priority | Risk | Design response / evidence needed |
|---|---|---|
| Critical technical | Timeout after a retailer accepts an order | Persist submission fence first; reconcile; never retry merely because no response arrived. |
| Critical technical | Concurrent monitors exceed budget or buy the same item | Durable intent deduplication, single writer, transactional reservations across accounts, and one submitting attempt. |
| Critical technical | Seller/variant/price changes between observation and checkout | Exact offer binding, freshness checks, final quote verification, approval invalidation. |
| High technical | Browser state theft, hostile content, unsafe IPC | Separate trusted UI from retailer pages; narrow validated IPC; minimize and encrypt session material. |
| High technical | Parser changes silently normalize the wrong item | Capture/parse/normalize separation; versioned adversarial fixtures; missing identity blocks execution. |
| High technical | Sleep, crash, disk full, or restored backup loses critical state | Recovery scan, durable fences, safe mode after restore, bounded queues, audit failure blocks mutations. |
| High product | No sustainable authorized data access | Validate a cooperative merchant first; do not sell universal coverage. Stop an adapter if access is unsuitable. |
| High product | Apparent margin disappears after costs or slow resale | Estimated landed cost and resale scenarios, explicit unknowns, source timestamps, no implied realized profit. |
| High product | Wrong edition, language, pack size, condition, or counterfeit item | Exact variant mapping and evidence; seller approval is not an authenticity guarantee. |
| High product | Users will not pay for alerts without autobuying | Test utility of timely, explainable opportunities before billing investment. |
| High product | Local monitoring misses releases while the PC is asleep | Clear running/asleep/offline UI; do not promise 24/7 until cloud monitoring exists. |
| Medium product | Support burden from store changes consumes subscription revenue | Track maintenance hours per adapter and approval-related support requests during Phase 2. |

Validate market/locale, willing merchant, data retention rights, realistic monitoring intervals, trusted benchmark sources, acceptable memory footprint, and willingness to pay before broad implementation. Branding and redistribution rights need launch review; do not assume an official Pokémon affiliation.

## 4. Stack recommendation: Electron versus Tauri

**Recommendation:** TypeScript strict mode, Electron shell, React renderer, a Node-capable background coordinator, HTTP/API-first adapters, Playwright only for demonstrated legitimate browser needs, SQLite with aggregate-specific repositories, and Drizzle as the preferred persistence mapper pending packaging tests. Use supported stable versions selected and pinned during Phase 0; do not freeze version numbers in this architecture review.

| Concern for this product | Electron | Tauri | Judgment |
|---|---|---|---|
| Existing TS / Node / Playwright path | Fits one main application language; Node utility process available | Rust host plus packaged Node sidecar, or a substantial automation rewrite | Electron reduces coordination and packaging work for this workload. |
| Windows UI | Bundled browser engine makes renderer behavior more predictable | Uses WebView2 on Windows; bootstrap and supported versions require verification | Either is viable; test installation on a clean Windows account. |
| Memory and download | Additional browser/runtime footprint, especially with Playwright | Potentially smaller UI host, but a Node sidecar and automation browser still add footprint | Measure the full idle and monitoring process tree, not empty-window marketing numbers. |
| Security | Requires explicit renderer isolation and tightly scoped bridges | Capability configuration helps scope frontend privileges; custom commands and sidecar remain sensitive | Neither protects against a compromised privileged host automatically. |
| Background work | Node utility process provides familiar lifecycle and messaging | Sidecar lifecycle, packaging, and Rust-to-Node contract add work | Electron preferred for current team assumptions. |
| Packaging/updates | Native SQLite module and browser distribution need packaged-app validation | Sidecar target binaries and WebView dependency need equivalent validation | Both require signed updates and recovery design. |
| Velocity/ecosystem | Strong alignment with proposed TS skill set | Attractive if Rust experience or strict footprint requirements dominate | Revisit only if the runtime spike rejects Electron. |

Electron documents Node-enabled [utility processes](https://www.electronjs.org/docs/latest/api/utility-process) and specific [security hardening requirements](https://www.electronjs.org/docs/latest/tutorial/security). Tauri documents [Node sidecars](https://v2.tauri.app/learn/sidecar-nodejs/), [capabilities](https://v2.tauri.app/security/capabilities/), and its [WebView dependency](https://v2.tauri.app/reference/webview-versions/). The preference above is a product-specific engineering inference, not a measured performance claim.

.NET/WPF or WinUI could be compelling for an experienced Windows/.NET team, but would introduce a different core language or an additional TS service boundary here. No demonstrated advantage justifies that switch today. React is a replaceable presentation choice; it does not own business state. A lightweight explicit transition table is sufficient initially; adopting a state-machine framework is deferred.

See [ADR-001](ADR/001-desktop-runtime.md) and [ADR-003](ADR/003-persistence-strategy.md).

## 5. Architecture overview and runtime topology

The system is one deployable desktop modular monolith with a few process boundaries for responsiveness and containment. Bounded contexts are modules, not network services.

```text
                   WINDOWS DESKTOP — one active data owner
 +-------------------------+        +--------------------------------+
 | Local React renderer    |        | Electron main / trusted host   |
 | dashboard, commands,    |--IPC-->| sender validation, navigation, |
 | paged read models       |<-------| secret broker, lifecycle       |
 | no store pages/secrets  |        +----------------+---------------+
 +-------------------------+                         | private IPC
                                                     v
 +------------------------------------------------------------------+
 | Background application coordinator — single DB write owner        |
 |                                                                  |
 | Monitor scheduler -> Discovery -> Catalog normalization           |
 |                                      |                           |
 |                              Seller validation                   |
 |                                      v                           |
 |                              Opportunity analysis                |
 |                                      v                           |
 |                              Purchase policy                     |
 |                                      v                           |
 |                         Execution coordinator / state machines   |
 |                         Simulation | Assisted | future Live gate |
 |                                                                  |
 | Aggregate repositories | durable work + audit | event dispatcher |
 +--------------+----------------------------+----------------------+
                |                            | constrained job IPC
                v                            v
 +-----------------------------+  +--------------------------------+
 | SQLite: local user data      |  | Bounded adapter I/O worker(s)   |
 | state, observations, audit,  |  | registry / capability ports    |
 | jobs, critical event outbox  |  | HTTP pool | Browser manager     |
 +-----------------------------+  +-------------+------------------+
                                                | HTTPS / pages
 +-----------------------------+                v
 | OS secret protection        |         Untrusted retailer systems
 | only broker unwraps secrets |         account-isolated contexts
 +-----------------------------+

 BEFORE PAID BETA (not Phase 1):
 Desktop --authenticated HTTPS--> Modular backend + PostgreSQL
                                  licensing / devices / remote policy
                                  billing webhooks / signed releases
                                  server signing secrets stay here
```

The background coordinator owns all write transactions and trusted safety policy. A bounded adapter worker hosts first-party maintained integration code; it has no database connection or unrestricted secret-store interface. Process separation limits crashes, but a Node process is not an OS sandbox. The trusted codebase and supported browser sandbox remain part of the security assumption.

Initially use one coordinator and one adapter I/O worker, with bounded asynchronous HTTP operations, rather than one process per monitor. The adapter worker must not be restarted into a live retry after a crash. Future submitting work is serialized and accepted only with a one-use execution permit. UI loss cannot trigger an action; host/coordinator loss drains or terminates worker jobs and recovers persisted uncertainty.

Main process remains small: window management, update lifecycle, validation of renderer calls, and OS services. Expensive parsing, database access, scheduling, and domain work stay off the renderer and main event loops. No local web server or publicly listening debug port is necessary.

## 6. Bounded contexts, dependencies, and conceptual repository layout

| Context | Owns | May consume |
|---|---|---|
| Catalog | Canonical identities, store products/variants, mappings, listing/offer identity | Normalized adapter evidence |
| Discovery | Monitor definitions, runs, observations, deduplicated candidates | Adapter read capabilities and catalog mappings |
| Seller trust | Versioned seller policies and evidence-backed evaluations | Seller/fulfillment observations and user policy |
| Opportunity | Market references, cost scenarios, immutable evaluations | Catalog identity, observations, seller result |
| Purchase policy | Eligibility, preferences, hard limits, evaluated rule decisions | Versioned facts and risk settings |
| Execution | Intents, attempts, reservations, orders, final action authorization | Explicit approved snapshots; no direct discovery commands |
| Accounts/profiles | Account identity, profile references, session metadata | OS secret and session ports |
| Entitlements/control | License access and integration restrictions at application edge | Signed backend policy; never embedded licensing logic in money calculations |

Audit, networking, scheduling, persistence, and notifications are supporting modules. Avoid creating a separate service for each engine.

Conceptual future layout only; none of these directories are created in this task:

```text
apps/desktop/                 composition root, Electron main/preload/renderer
apps/backend/                 only before commercial beta
packages/core/                catalog, discovery, seller, opportunity, policy,
                              execution, accounts; pure modules with public APIs
packages/application/         use cases, port definitions, transaction boundaries
packages/contracts/           versioned IPC DTOs and integration event envelopes
packages/adapters/            fake, shopify, mercadolibre, amazon, walmart
packages/infrastructure/      sqlite, network, scheduler, browser, audit sinks
packages/test-support/        deterministic clock, fixtures, fake transport
docs/                         current source of truth
```

Do not mechanically create every listed folder in Phase 1. A core package can hold multiple modules with enforced imports. Domain code depends only on its own types and a small explicit shared vocabulary: Money, IDs, timestamps, evidence, and result classifications. Application orchestrates domain modules and declares outbound ports. Infrastructure and store adapters implement those ports and depend inward. Composition roots alone wire implementations. Renderer imports DTO contracts, never repositories, adapters, secret brokers, or domain mutation functions. Domain modules reference other contexts by IDs and immutable public snapshots, not writable foreign entities.

Cross-context workflows are application use cases. Use direct calls when validation order matters; publish events after committed facts. Never let an OpportunityDetected subscriber directly submit an order. Build-time import checks and contract tests enforce boundaries. No circular package dependencies; no dependency injection framework or generic base service needed.

Interfaces worth defining from V1: store capability ports, MarketPriceSource, aggregate repositories, TransactionRunner, Clock, IdGenerator, SecretStore, NotificationSink, NetworkTransport, ExecutionPort, and Entitlement/IntegrationPolicyProvider. BrowserSessionPort is needed when browser work starts. Pure calculations, parsers, UI components, and static configuration need no ceremonial interfaces.

## 7. Store adapter architecture and access policy

Register a `StoreAdapterDescriptor` with adapter ID/version, contract version, supported country sites, store-instance identification, capability declarations, health, and tested access-policy reference. `StoreInstance` identifies a marketplace region or one merchant domain, not just a brand. Shopify is an adapter family serving separately approved merchants.

| Capability | Conceptual operation and result | Constraints |
|---|---|---|
| ProductDiscovery | search(query, cursor, context) → candidate page | Explicit pagination/completeness; keywords can be unsupported. |
| ListingResolution | resolve(URL or external reference) → product, variant and listing references | Resolution does not imply a purchasable offer or exact canonical match. |
| OfferObservation | observe(listing/variant, context) → coherent offer snapshots | Combine price/inventory/seller evidence when they come from one capture; do not invent atomicity across requests. |
| SellerEvidence | inspect(seller reference) → evidence | Emits facts, never APPROVED. |
| PurchaseQuote | revalidate(exact offer, quantity, destination reference) → expiring quote | Complete landed cost, seller, fulfillment, limits, stock evidence; unknowns explicit. |
| Cart | reconcileCart(desired exact lines, account) → cart receipt | Only where safe and permitted; set/reconcile quantities instead of blindly incrementing. |
| CheckoutPreparation | prepare(cart, profile references) → handoff/preparation receipt | No submission or one-click purchase behavior. |
| OrderSubmission | submit(authorized request, operation key) → external acknowledgement or unknown | Optional, separately registered behind the sole execution gate. |
| OrderReconciliation | reconcile(submission evidence) → found / definitively absent / inconclusive | Lookup by external reference or conservative evidence; not a generic “confirmOrder.” |

Price, inventory, and seller can be independently queried internally, but exposing only unrelated reads encourages inconsistent checkout snapshots. OfferObservation returns field-level evidence times and coherent capture IDs. Capability interfaces evolve only when a second integration demonstrates a real semantic gap.

Every call includes deadline, cancellation, trace/operation IDs, region, currency, delivery context, and optional account/session reference. Results identify capture/receive times, adapter/parser version, source provenance, freshness, completeness, and typed errors. External IDs are strings scoped by store instance; secrets and raw browser handles never enter domain DTOs. Unsupported capability is discoverable before scheduling; it is not an exception retry loop.

The stages are capture → parse → normalize → business validation. Networking failure, selector failure, schema mismatch, authentication, and seller rejection must remain distinguishable. Keep selectors, response schemas, parsers, and fixtures inside each adapter; prefer documented APIs and stable semantic page signals where permitted. No remote configuration may inject selectors as executable code.

Effective automation level is the intersection of compiled capabilities, reviewed access policy, local user mode, account health, backend restrictions when applicable, and current evidence:

* `OBSERVE_ONLY`: permitted reads and product links; no cart mutation.
* `ASSISTED_CHECKOUT`: permitted preparation with the user completing purchase in retailer UI. Manual confirmation does not authorize forbidden automation.
* `AUTOMATED_CHECKOUT_ALLOWED`: requires affirmative evidence of permitted submission, final quote verification, reconciliation support, and all safety gates. No initial integration is assigned this level by this review.

An integration may also be disabled entirely. Observe-only does not mean scraping is allowed. If even reads are disallowed, retain configuration/history as permitted and offer a validated link for manual navigation without automated collection. CAPTCHA or blocking stops automation; never use fingerprint spoofing, proxy rotation, CAPTCHA evasion, or account rotation.

### Initial integration ordering and difficulty

These are relative engineering estimates, conditional on access in the chosen country, not retailer permissions or calendar commitments.

| Integration | Authorized discovery / normalization | Assisted checkout | Automatic checkout | Recommendation |
|---|---|---|---|---|
| One cooperative Shopify merchant | Low–medium; known catalog, explicit variants, reproducible fixtures | Medium; cart/handoff if merchant scope allows | High / unproven; do not infer a submit API | First real adapter after FakeStoreAdapter. |
| Mercado Libre | Medium–high; marketplace seller and catalog semantics, API eligibility/fields to validate | High / unproven; default manual product handoff | Very high / unproven | Preferred second if selected market access is viable. |
| Amazon | High; marketplace offers, fulfillment, locality, licensed catalog access | Very high / unproven | Very high / not committed | Later feasibility gate, not a first adapter. |
| Walmart | High; region, location, seller and fulfillment distinctions | Very high / unproven | Very high / not committed | Later feasibility gate; disallowed collection stays disabled. |

Shopify's documented Cart returns a checkout URL for buyer completion; that is useful evidence for an assisted boundary, not proof of a universal buyer order-submission API. Access must be configured for the merchant and permitted scopes. [Shopify Cart](https://shopify.dev/docs/api/storefront/latest/objects/Cart), [API access scopes](https://shopify.dev/docs/api/usage/access-scopes).

Amazon's official documentation now names Creators API as the replacement for PA-API 5; do not base a new adapter on the deprecated endpoint. Eligibility, use, and retention require locale-specific review. [Deprecation notice](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation), [locale license entry points](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/license-agreement).

Walmart Marketplace Orders documentation describes seller fulfillment operations, which do not establish buyer purchase capability. Walmart.com's US terms restrict automated collection; these terms cannot be assumed to describe another country site. An approved data path is a prerequisite. [Orders documentation](https://developer.walmart.com/us-marketplace/docs/choose-an-orders-api), [US terms](https://www.walmart.com/help/article/walmart-com-terms-of-use/3b75080af40340d6bbd596f116fae5a0).

Mercado Libre documents item/search and order resources; resource existence does not prove this app's buyer access or broad search entitlement. Its current item documentation also signals endpoint changes, supporting adapter-local versioning. [Items and searches](https://developers.mercadolibre.com.mx/es_mx/items-y-busquedas), [Orders](https://developers.mercadolibre.com.mx/gestiona-ventas).

Adding a normal store should require descriptor, capabilities, configuration, fixtures/contracts, and registration only. New country selection, auth UI instructions, or metadata-driven capability labels are acceptable configuration work. A genuinely new concept such as auctions or mandatory bundles may require a reviewed core contract change; pretending all stores are identical is worse than an explicit versioned extension. A second adapter must validate the abstraction before extensive generalization.

## 8. MonitorEngine, workers, networking, and browser lifecycle

A monitor definition expresses user intent; a run records one scheduled execution; captures produce observations; candidates are possible matches; normalized listings/offers are identified commercial objects. One observation may satisfy several monitors. Edits create a new monitor revision; an old run may store evidence but cannot authorize the new revision's purchase rules.

URL monitors resolve known store references and selected variants. Keyword monitors carry include/exclude terms, price bounds, selected store instances, approved seller references, requested quantity, priority, and purchase-policy version. Query normalization is deterministic and locale-aware; text matching only proposes canonical mappings. Partial results and unavailable search capabilities appear explicitly in monitor health.

Scheduler: persisted `nextDueAt`, definition revision, and bounded job records; one active job per monitor revision; coalesce missed checks after sleep rather than replaying every interval. Lease expiry permits re-running reads only. Purchase recovery is a different queue. Use a monotonic clock for elapsed time and UTC timestamps for evidence; resume triggers health/freshness checks and jittered rescheduling.

Initial tunable caps, subject to load spike: four concurrent HTTP jobs globally, one per store instance, one authenticated read per account, two active anonymous browser contexts, and one cart/preparation/submission operation per account. Reads and reconciliation have separate fair queues; unknown orders receive priority without starving safe monitoring. Weighted round-robin across stores plus aging across monitor priority levels prevents a high-priority group monopolizing workers. User settings may lower limits, never exceed approved store limits. Multiple Shopify domains sharing a provider quota must share that budget too.

Deduplication/cache keys include store instance, operation, product/variant, seller or offer if selected, locale, currency, destination context, and account-specific price scope. Anonymous cache may be shared; personalized results never leak across accounts. Coalesced requests keep monitor-run attribution. An expired cache can be shown as history, not accepted as live purchase evidence. Canonical observations deduplicate by capture identity; repeated fresh checks with unchanged values remain distinguishable from reuse of one capture.

NetworkManager owns connection pooling, TLS validation, host allowlists, timeouts, retry budgets, backoff with jitter, Retry-After handling, and request health. Suggested initial read deadline 15 seconds and at most two bounded read retries, subject to permitted provider policy. The adapter owns operation semantics; no blanket HTTP-method retry policy because a read-like request may mutate or a POST may only query. Unsafe cart/submission calls have no transparent retries. Rate responses reduce scheduling globally for the affected quota; do not create replacement accounts or proxies. A static explicitly configured corporate proxy is acceptable for legitimate networking, with its credentials protected and the same rate budgets.

Circuit breaker scope is store instance + capability, refined by account for auth. Transport failures can degrade a capability without marking the whole store down. Track `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `AUTH_REQUIRED`, `BLOCKED`, last check and evidence time separately for provider/store, adapter, account/session, and capability. Unknown/unprobed health is displayed as such, not green.

Use HTTP first; start a browser only when the permitted capability requires it. Browser manager owns launch, liveness, leases, page limits, idle eviction, context teardown, and crash handling. Reuse an anonymous browser across isolated read contexts. Use separate contexts per store-account; initially use a dedicated browser process for authenticated execution where introduced, with no sharing of the user's ordinary browser profile. Limit authenticated browser count and queue work rather than opening one per saved account.

Playwright documents independent non-persistent contexts; authenticated state can contain reusable impersonation material. Therefore prefer memory-only sessions and broker-encrypted state when persistence is necessary. [BrowserContext](https://playwright.dev/docs/api/class-browsercontext), [Authentication](https://playwright.dev/docs/auth). Context isolation is not a defense against a compromised host process. Do not persist raw HARs or browser profiles by default; a later authentication spike must test which session types can be restored safely. Unsupported restoration means interactive login again.

On user close, make tray-versus-stop behavior explicit. No hidden service in Phase 1. On shutdown stop new work, persist safe progress, terminate workers within a deadline, and preserve uncertain submissions. Never keep a database transaction open while waiting on browser/network I/O.

## 9. SellerValidationEngine and PurchaseRuleEngine

Adapter facts identify seller, fulfillment operator, first-party evidence, domain, official-store claim, reputation, and their sources/times. Policies contain allow/deny references and requirements. Product safeguards supply mandatory evidence/freshness rules. The engine alone produces `APPROVED`, `REJECTED`, or `REVIEW_REQUIRED` plus reason codes, referenced evidence, policy version, evaluated time, expiry, and confidence. Confidence is evidence quality, not a probability of authenticity.

Evaluation order: explicit deny or known conflict rejects; missing/stale/contradictory mandatory identity requires review; configured positive requirements must all pass; otherwise review. A deny overrides allow. FIRST_PARTY_ONLY uses stable seller IDs and reviewed first-party mapping for the particular region. “Ships from Amazon” is never substituted for “Sold by Amazon.” Walmart seller and shipper are separately checked. Mercado Libre official-store and reputation claims supplement identity. Shopify requires an approved merchant instance and exact reviewed domains; a familiar title or redirect is insufficient. MANUAL_REVIEW requires a recorded scoped decision or policy change, then reevaluation; it cannot override platform restrictions or hard limits.

Rules are a typed bounded expression tree with versioned operators, not eval, JavaScript, SQL, or a scripting language. Separate:

| Layer | Examples | Enforcement |
|---|---|---|
| Eligibility | price <= 1200 MXN, shipping <= 100 MXN, ROI >= 20%, approved seller | All configured requirements must pass on the same snapshot. |
| Preferences | desired quantity <= 2, store preference, priority | Rank eligible choices; never widen safeguards. |
| Risk limits | max checkout attempts, cooldown per canonical product | Enforced by execution coordinator and durable counters. |
| Spend/quantity limits | maximumOrderValue, maximumDailySpend, maximumMonthlySpend, maximumQuantityPerProduct, maximumPurchasesPerDay | Transactional reservations plus committed consumption, spanning all local accounts. |
| Hard safeguards | no unknown seller/identity, no stale required quote, no ambiguous retry, mode and permission gates | Cannot be removed by user rule structure, imports, flags, or UI. |

Result is `PASS`, `FAIL`, or `INDETERMINATE`, with per-rule operands and reason codes. Unknown tax/shipping/ROI does not become zero or pass. Positive preferences cannot OR around hard checks. Final execution reruns rules against refreshed facts and current stricter safety settings. A relaxed policy requires a fresh intent/approval; an old approval never silently expands. Budgets use the intent's configured currency and owner timezone, with persisted bucket dates. Cross-currency automatic execution is deferred; FX estimates may be shown but cannot silently convert an enforceable cap.

## 10. OpportunityEngine

Use immutable evaluations rather than mutable “current profit.” Inputs include exact mapped variant and pack quantity, listing/offer observation IDs, seller result, benchmark references, cost assumptions, confidence/completeness, and calculation version. Retail price, MSRP, seller asking price, observed sold price, and forecast resale price are different price kinds. Record market, condition, language, pack/unit basis, timestamp, source/license, sample size where available, and source quality.

For a lot of q units, define acquisition cost C = q × unit purchase price + inbound shipping + acquisition taxes/duties + other acquisition costs − verified discounts. Let R be estimated gross resale receipts on the same unit basis; F(R) marketplace/payment fees; O outbound shipping, packaging, and other selling costs; L estimated loss/returns allowance. Gross profit here is R − C; net estimated profit is R − C − F(R) − O − L; ROI = net/C; margin = net/R. Zero denominators yield unavailable metrics. If fees are a simple fraction f of R plus fixed k, break-even R = (C + O + L + k)/(1 − f), valid only for 0 <= f < 1. Tiered fees require an explicit solver/scenario later.

Synthetic calculation fixture, not a pricing recommendation: two units at 1,000 MXN, 100 inbound shipping, and 0 explicitly known additional acquisition tax give C = 2,100. With R = 3,000, fees = 390 (13%), O = 150, and L = 60: gross profit 900, net estimate 300, ROI 14.2857%, margin 10%. The continuous break-even is 2,655.1724… MXN; a conservative whole-cent target is 2,655.18 MXN, rounded upward before applying any provider-specific fee rounding. The zero tax value is a fixture assumption, not a tax rule. Display rounding must not round a failing ROI upward into approval. Use decimal/rational calculation and defined minor-unit rounding, never binary float for spend enforcement. Tax-inclusive store totals must not be taxed twice.

Phase 1 uses a manually supplied, dated benchmark and simple threshold evaluation. No external market data is assumed available or licensed. Missing costs produce an incomplete scenario and block an affected rule, while still allowing an informational opportunity card.

Future `MarketPriceSource` returns comparable observations, provenance, currency, confidence, retention rights, and completeness; it does not own purchase approval. TCGplayer, PriceCharting, eBay sold data, Cardmarket, and Mercado Libre are candidate sources only. Their access, comparable-product coverage, and commercial rights require later validation.

The optional score is `EXPERIMENT FIRST`: versioned factor definitions and weights, input values and references, per-factor normalized contribution, missing-factor list, and coverage. Keep confidence separate from score; do not silently renormalize missing factors into a high score. Initially no numeric score is emitted. Once calibrated, use fixed weights summing to 1 and documented 0–100 normalization, require minimum evidence coverage, and show contributions. Seller rejection and hard rule failure remain gates outside scoring. Scarcity, popularity, release date, liquidity, velocity, and reprint risk cannot influence a score until there is defensible data. [Domain model](DOMAIN_MODEL.md) defines snapshot ownership.

## 11. Execution safety, state, idempotency, and manual fallback

Execution takes an explicit PurchaseIntent, never a discovery event alone. Opportunity lifecycle, intent lifecycle, checkout attempt lifecycle, and external order lifecycle are separate. All authoritative states and transitions are persisted; “busy,” dashboard badges, and current freshness are projections. Exact transition tables live in [DOMAIN_MODEL.md](DOMAIN_MODEL.md); [ADR-005](ADR/005-execution-safety-model.md) owns the irreversible boundary.

Architecture modes:

* `DRY_RUN` is the default, including missing/invalid configuration. Phase 1 composes only read capabilities and SimulationExecutionPort. It creates a simulated intent/attempt and persists `PURCHASE_WOULD_HAVE_EXECUTED` only after all required simulated decision checks pass; it creates no Order and no real budget consumption.
* `ASSISTED` is a later explicit, audited user choice. Authorized cart preparation and retailer handoff may be offered. The app cannot guarantee limits on a purchase the user changes and submits outside its control. Mark handed-off attempts for reconciliation/manual tracking and do not report success from a URL launch.
* `LIVE` is future and requires an explicit local mode transition, eligible build, reviewed submission capability, valid entitlement and fresh remote policy, fresh complete quote, approved seller, passed rules, available reservations, and a one-use permit. Phase 1 cannot transition to it.

`DRY_RUN=true` is a force-safe startup input; `false` alone never enables LIVE. Phase 1 omits the live executor and write-capable store operations entirely. Later, the composition root provides either simulation or an authorized executor. Arbitrary browser script execution is not an execution port. A per-intent immutable mode prevents queued dry-run work from becoming live after a settings change. Live-to-safe transition invalidates unconsumed permits, stops new mutations, and preserves reconciliation for work already sent.

Future live protocol:

1. Persist a purchase intent with a stable operation key, exact canonical variant/offer/seller, quantity, account, profile revision, policy versions, and maximum approved landed cost. Duplicate monitor detections refer to the existing active commitment.
2. In a short single-writer transaction enforce active product commitment/cooldown, reserve all applicable budgets/quantity/purchase counters, and create the attempt. Persist state and audit together. No external I/O within the transaction.
3. Perform permitted preparation with bounded leases. Re-read seller, offer, selected variant, stock/quantity limit, shipping/tax and total. A substitution, unknown final amount, or material change requires reevaluation; never auto-select a different seller. Bind final approval to an expiring quote digest and exact cart lines, account, profile, mode, policy versions and reservation.
4. Immediately before dispatch check current gates again. Atomically record `SUBMITTING`, the one-use permit consumption, and a submission fence/audit record. The constrained executor rejects duplicated permit IDs. If this transaction cannot commit, nothing is sent.
5. Submit once with the same stable logical key, and a provider idempotency key only where its semantics are documented. Persist the response and external references. An acknowledgement is `SUBMITTED`, not confirmed payment or fulfillment.
6. Any uncertain response, crash after the fence, or response-persistence failure becomes `UNKNOWN`. Keep reservations, product commitment, and duplicate guards. Reconcile by authoritative external ID/client key when supported; otherwise use account/time/amount/line evidence conservatively. Empty search results or elapsed time alone are not proof of absence.
7. A found order is linked uniquely and settled once. Only documented definitive non-creation permits a new attempt under the same intent after fresh checks. Inconclusive results require user review; no automatic timeout releases the reservation. Manual acknowledgement of risk alone is not proof of absence and cannot reopen automatic retry.

Final dispatch is serialized with local mode/policy revocation in the coordinator. Permits include the policy epoch, quote expiry, worker-session identity and exact request digest; worker dispatch rejects expired, mismatched or already-consumed permits. Revocation cancels unconsumed work and is checked again at dispatch. A revocation arriving after a retailer request is already in flight cannot retract that request; persist the outcome or uncertainty and reconcile it.

Guarantee boundary: this design prevents repeated app dispatch for a logical commitment under the trusted single-owner execution model, favors missed purchases over duplicates, and cannot promise exactly-once effects in arbitrary retailers. A crash after the durable fence but before network send may block an order that was never sent; that is the deliberate safety trade-off. Local leases serialize work but do not fence a retailer. Before a replacement owner can act, terminate/verify the previous executor and reconcile every fenced attempt. If termination cannot be established, remain blocked.

Order values and counters include held, unknown, submitted, and confirmed commitments; confirmed cancellation releases only what authoritative evidence permits. No automatic purchase retries from notification/event replay. Cross-device live execution is forbidden until there is an authoritative shared reservation ledger and ownership protocol. Restored backups start in safe recovery mode; old idempotency state is never trusted to authorize new purchases.

## 12. Accounts, profiles, secrets, and data locality

Account identity is a local label plus store-scoped external identity, not a password or browser profile. Credential reference identifies an encrypted secret; session reference identifies a separately scoped browser/API session; auth state and health record validation time and reason. Multiple accounts can coexist, but budgets and product limits span them. Store authentication uses interactive login or supported public-client OAuth; an OAuth client secret must not be embedded in the desktop.

Profile contains name, optional minimal address/contact data if actually needed, and references to retailer-stored address/payment methods. Prefer retailer references in V1 and fetch/display masked labels only when authorized. Never store PAN, CVV, full payment instrument data, or retailer passwords by default. No account secrets, browser cookies, or payment references go to the commercial backend. Backend-only secrets include Stripe secret/webhook keys, license and remote-policy signing keys, update signing material, and provider credentials licensed for server use.

The trusted host exposes a narrow SecretStore broker with purpose/account authorization and opaque references. Proposed Windows implementation uses Electron safeStorage/OS protection, encrypted blobs with restricted local permissions, and no plaintext fallback. DPAPI-based protection does not isolate secrets from malicious processes running as the same Windows user. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). This limitation is explicit in [ADR-006](ADR/006-secret-storage.md) and the threat model. Broker grants only short-lived required session material to the correct worker; never through the renderer or general logs.

Defer full database encryption until threat/packaging evidence warrants it, but encrypt any necessary address/contact payload and reusable session material from the start. OS encryption cannot make local audit records tamper-proof. Secret loss after machine/account migration requires reauthentication. Backups exclude usable secrets by default; imported/restored data is quarantined for execution review.

## 13. Persistence, repository boundaries, and internal events

SQLite is a local single-owner database, not a shared network file. Use foreign keys, explicit uniqueness, short transactions, schema versioning, safe backup/restore, and disk-capacity checks. WAL is proposed for reader concurrency, with durable settings for safety records and serialized writes; it is not a multi-writer scalability solution. SQLite documents [WAL behavior](https://www.sqlite.org/wal.html) and a supported [backup API](https://sqlite.org/backup.html). Never copy just an active database file while ignoring WAL state.

Prefer Drizzle because explicit SQL/transaction control suits atomic budget reservation and analytical queries without making domain objects ORM records. Prisma remains viable for teams prioritizing its schema/client workflow; it offers SQLite support, so rejecting it solely for “no SQLite” would be incorrect. Plain SQL is the fallback if ORM mapping adds friction. Native driver compatibility, packaged Electron loading, migrations, backup and crash recovery must be tested before accepting a driver. [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [Drizzle SQLite](https://orm.drizzle.team/docs/sqlite/get-started-sqlite), [Prisma SQLite](https://www.prisma.io/docs/orm/v6/overview/databases/sqlite). Neither choice removes separate PostgreSQL migration and ownership work.

Aggregate repositories expose purposeful operations such as saveMonitorRevision, appendObservation, saveEvaluation, reserveIntent, advanceAttempt, and recordReconciledOrder. Critical operations share a TransactionRunner/unit of work so reservations, state, audit and critical event outbox commit together. A generic CRUD repository would hide those invariants. Read-only dashboard query services may join projections without loading aggregates.

Use an append-only typed ListingObservation with indexed common price/stock/seller fields and bounded versioned extension data. PriceObservation, StockObservation, and SellerObservation are typed components/views, not three duplicate histories. Partial seller-only evidence may be referenced by an observation. Raw captures are optional, redacted, size limited, and short-lived. Latest-offer projections can be rebuilt; audit/order facts cannot be silently replaced by a new observation. See the domain model for conceptual tables and indexes; no schema or migrations are generated now.

Events are explicit versioned facts dispatched inside the coordinator after commit. A small SQLite outbox plus handler receipts is justified for critical workflow work so a crash between commit and dispatch cannot lose an evaluation or duplicate a decision. UI refresh/metrics events may be ephemeral. No event sourcing, Kafka, RabbitMQ, or standalone message service. At-least-once delivery requires idempotent consumers; record handler receipts atomically with domain changes. External I/O is never performed as a replayable event handler side effect without the execution protocol. [ADR-008](ADR/008-internal-event-model.md) specifies delivery and recovery.

## 14. Observability, error model, and UI

Structured operational logs explain failures; bounded metrics show health; durable audit explains decisions and transitions. Central allowlisted serializers redact before any log, trace, crash report, notification, or export. Do not log raw URLs with query credentials, headers, store bodies, full addresses, cookies, tokens, secrets, or card information. Use pseudonymous local IDs. Debug capture is explicit, bounded and scrubbed; production browser recording is off by default.

Correlation envelope: traceId, operationId, monitor/run IDs, canonical product/variant ID, listing/offer ID, store instance/adapter version, opaque accountId, intentId, checkoutAttemptId, and orderId when present. High-cardinality IDs belong in logs/traces, not metric labels. Metrics: request counts/latency, successes/failures, queue delay, skipped/coalesced checks, discovered products, seller decisions, capability/auth health, rate-limit responses, active contexts/memory, and audit failures. Later add cart/checkout rates, reconciliations, unknown orders and reservation age. A simulated decision must never increment real-order or real-spend metrics.

Audit writes include actor, action, state before/after, reason, referenced facts, policy/calculation/adapter version, execution mode, correlation IDs and timestamp. A critical audit write shares the state transaction; disk full therefore prevents new mutation. Notifications are retryable durable local records, not permission to execute. Redact notification previews. Export should let a user trace one opportunity through rules and simulated decision without exposing reusable credentials.

Typed error envelope: stable code, category, operation, phase, safe context, retryAfter if applicable, and external-effect status (`NOT_SENT`, `DEFINITIVELY_NOT_APPLIED`, `MAY_HAVE_APPLIED`, `APPLIED`). Preserve internal sanitized cause chains. UI maps codes to actionable copy; unknown exceptions are logged as defects and default to uncertainty if the action may have escaped.

| Category | Typical codes | Action |
|---|---|---|
| Retryable read | StoreUnavailableError, RateLimitError, bounded timeout before mutation | Backoff within deadline/quota. |
| Non-retryable for this evaluation | ProductNotFoundError, ListingUnavailableError, SellerRejectedError, OutOfStockError | Finish run/decision; later scheduled observations may change facts. |
| Revalidation required | PriceChangedError, OfferChangedError, IncompleteQuoteError | Refresh facts and rules; never generic checkout retry. |
| User action required | AuthenticationError, SessionExpiredError, confirmed PaymentError, PolicyReviewRequiredError | Pause affected capability, explain action. |
| Ambiguous external state | OrderUnknownError, transport failure after dispatch, failed response persistence | Freeze commitment, reconcile, escalate review. |
| Local integrity defect | DatabaseUnavailableError, AuditWriteError, InvalidTransitionError, ParserSchemaError | Block relevant work; preserve diagnosis and safe state. |

CartError/CheckoutError must retain phase and effect certainty; their class name alone cannot determine retry safety. Payment failures can be ambiguous and must not always be categorized as user-action-only. No catch-all conversion to “something went wrong” that erases the uncertainty.

Phase 1 UI: Dashboard, Monitors, Opportunities, History/decision detail, Store Health and safe Settings. Catalog mapping can be part of opportunity review. Later Accounts, Profiles, Orders, Notifications, Logs, and License screens use the same application commands/read models. Estimated profit is labeled as a scenario; purchases/spend today refer only to known orders; monitor health displays last successful check and delayed/asleep state. Account/profile UI never becomes a backdoor to secret export or direct adapter calls.

## 15. Security and commercial control backend

Trust boundaries: local renderer → preload/main → coordinator; coordinator → integration worker; worker → untrusted retailer content; host → OS secret provider; local process → database/files; desktop → commercial API; backend → payment provider; release signer → update distribution → executable. The [threat model](THREAT_MODEL.md) specifies assets, threats and residual risk at each boundary.

Renderer uses local packaged content, no Node access, context isolation, sandboxing, restrictive CSP and no remote content in privileged windows. Validate IPC schemas, sender/frame origin, allowed commands, ownership, size and frequency. Renderer cannot request arbitrary URLs, paths, SQL, shell commands or script execution. Validate navigation and redirects against reviewed HTTPS hosts; block loopback/private/link-local destinations, credentials in URLs, unsafe protocols and open redirects into privileged surfaces. Network allowlists include approved dependencies needed by each retailer without granting app privileges to them. Treat stored text as untrusted on every render.

Compare backend timing:

| Option | Benefit | Cost/risk | Decision |
|---|---|---|---|
| Desktop-only indefinitely | Simple local privacy and operations | Cannot reliably enforce subscription or remotely disable installed clients | Reject for commercial release. |
| Minimal backend from personal V1 | Early remote config, devices and entitlements | Adds auth, deployment, billing/control availability before core value is tested | Unnecessary for strictly read-only/dry-run validation. |
| Desktop-only Phase 1; backend before paid beta | Validates product cheaply while preserving commercial ports | No immediate remote control in Phase 1; later integration work is mandatory | Recommended. |

Future backend is one modular monolith and PostgreSQL, initially owning customers/users, subscriptions, licenses, device activations, entitlements, signed remote policy, and release metadata. Notification relay, market aggregation, sync and cloud monitors are separate later investment decisions. No retailer credentials are uploaded to enable licensing.

Activation key is a high-entropy redeemable secret, represented in human-friendly groups; formatting is not the security mechanism. Backend stores a keyed verifier/hash, rate-limits activation, and enforces device slots transactionally. Use a random installation identity and protected device key rather than invasive hardware fingerprinting. Authenticate the desktop as a public client using appropriate user authentication/device activation, short-lived access credentials and revocable refresh credentials. Backend signing keys never ship in the app; client contains only trusted public verification keys with rotation support.

License states ACTIVE, EXPIRED, SUSPENDED and CANCELLED describe access policy, while subscription provider statuses remain separate. Scheduled cancellation may retain access until paid-through expiry; distinguish scheduled cancellation from effective revocation. Subscription creation alone never grants paid access. Verify billing webhooks, deduplicate event IDs, and reconcile authoritative subscription/payment state without assuming event order. [Stripe webhook guidance](https://docs.stripe.com/webhooks).

Signed entitlement lease includes subject/device, plan/features, issuedAt, expiresAt, schema/policy version and audience. Recommended initial commercial policy: monitor access can continue for up to 24 hours since the last successful validation, never beyond the paid-through time or signed lease expiry. First activation requires online validation. Suspected clock rollback pauses gated work pending revalidation. Known suspension revokes access immediately when received. Cached authorization is never a local licensed=true boolean; a patched hostile client still cannot be made fully trustworthy.

Remote policy includes store/capability disables, automaticCheckoutEnabled, minimumSupportedVersion, maintenanceMode/message, expiry, monotonic version and signature. Defaults restrict risk. No received flag can add compiled capability, change DRY_RUN to LIVE, or override user/hard limits. A commercial live permit needs online authorization and policy no older than five minutes, bound to the exact request; the five-minute value is a proposed safety budget to validate. Backend unavailable/stale/invalid policy means no new automatic checkout, even during the monitor offline lease. Valid cached observe permissions may continue within their lease; missing policy disables automated store access. Reconciliation remains available when safe even if paid monitoring stops. Instant revocation while offline is impossible; disclose bounded propagation rather than claim otherwise.

Expiry or maintenance stops new gated jobs and risky mutations, but keeps UI, renewal, export, history and reconciliation accessible. Do not strand an unknown order behind a paywall. Enabling LIVE is distinct from obtaining a license. Before any external distribution, sign the installer and implement authenticated signed updates, staged rollout, schema compatibility, and recovery checks; a custom insecure updater is not acceptable.

## 16. Testing strategy and evolution

Unit tests cover money, incomplete facts, seller policy precedence, mapping constraints, rules and state transitions. Integration tests use temporary real SQLite databases for contention, reservations, transaction rollback, replay, disk/audit failure, and reopen recovery. Fake adapters cover multiple offers, seller switches, out-of-order evidence and ambiguous effects; deterministic clocks/IDs make fixtures reproducible.

Adapter contract tests verify declared capabilities, identity scoping, money/currency, freshness/completeness, error certainty, pagination, rate behavior and no hidden mutation in read/prepare operations. Use sanitized versioned recorded responses only when retention permits. Parser/selector smoke tests target owned or explicitly authorized test pages; never run paid purchase tests. E2E tests exercise a packaged Windows app against FakeStoreAdapter or owned test endpoints with real store traffic disabled.

The required safety suite injects crashes before and after each submission fence/response boundary, duplicate delivery, parallel monitor triggers, stale locks, clock shifts, disk full, offer substitutions, policy revocation and restored backups. Phase 1 proves DRY_RUN emits no outbound mutations even under hostile mode inputs, replay and UI calls; later suites test live orchestration only against a fake order endpoint that counts submissions. [Roadmap](ROADMAP.md) gives concrete acceptance criteria and planned spikes.

Evolution: personal desktop owns all data and runs only while awake → paid desktop adds a small control backend and operational discipline → hybrid moves permissible anonymous monitoring/market analysis to cloud while retaining local session-bearing execution. Local and cloud share versioned public contracts and pure calculations, not a synchronized SQLite file. Before multiple execution owners, centralize intent/budget authority and device fencing; before multi-tenant cloud data, add tenant scope and authorization tests at the actual cloud boundary. Do not build sync protocols or reserve cloud infrastructure now.

Hundreds of paying users do not require hundreds of workers on one PC, but their aggregate store traffic may still exceed a provider-wide quota. Before paid beta, establish provider/credential quota ownership across installations and reduce or centrally coordinate traffic if necessary. Do not distribute a shared provider credential in desktop clients or multiply local rate budgets to evade an aggregate restriction. A provider-approved shared observation service can be considered later only when access/retention rights and measured demand justify it.

## 17. Coverage of the brief's 46 review questions

| Brief questions | Documentation |
|---|---|
| 1–4 product understanding, corrections, technical/product risks | Architecture §§2–3 |
| 5–8 stack, runtime comparison, complete architecture, ASCII diagram | Architecture §§4–5; ADR-001 |
| 9–15 domains and six engines | Architecture §§6–11; Domain model |
| 16–17 states and idempotency | Domain model §§5–6; Architecture §11; ADR-005 |
| 18–21 accounts/profiles, secrets, data and repositories | Architecture §§12–13; Domain model §§2–4; ADR-003/006 |
| 22–25 workers, browser lifecycle, observability, errors | Architecture §§8, 14; ADR-004 |
| 26–28 security, licensing/backend, testing | Architecture §§15–16; Threat model; Roadmap |
| 29–30 monorepo/dependency boundaries | Architecture §6 |
| 31–33 roadmap, first implementation, exclusions | Roadmap §§1–4 and PHASE 1 |
| 34 store difficulty | Architecture §7 |
| 35–38 reversibility, deferred decisions, ports, simplicity | ADRs; Architecture §§1, 6 and decision table below; Roadmap |
| 39–42 evolution, final recommendation, first adapter, spikes | Architecture §§4–7, 16; Roadmap §2 |
| 43 domain events | Domain model §7; ADR-008 |
| 44–45 trust boundaries and safety invariants | Threat model; Domain model §6 |
| 46 unvalidated product assumptions | Architecture §3; Roadmap §2 |

# ARCHITECTURAL DECISIONS

| Decision | Classification | Recommendation | Reversal Cost |
|---|---|---|---|
| Domain and ownership boundaries | DECIDE NOW | Desktop modular monolith; separate discovery, opportunity and execution; one execution owner | HIGH |
| Identity model and evidence | DECIDE NOW | Canonical/variant/listing/offer/seller separation; immutable typed observations and decisions | VERY HIGH |
| Adapter boundary | DECIDE NOW | Capabilities per store instance; policy separate from technical support | HIGH |
| Execution guarantees | DECIDE NOW | Durable state, atomic reservations, submission fence, unknown-state reconciliation | VERY HIGH |
| DRY_RUN boundary | DECIDE NOW | Simulation-only composition in Phase 1; immutable per-intent mode; sole future live gate | VERY HIGH |
| Secret locality | DECIDE NOW | OS-protected local references; no retailer credentials or payment secrets on backend | HIGH |
| Persistence ownership | DECIDE NOW | SQLite single writer, specific repositories and transactional audit/outbox | HIGH |
| Event semantics | DECIDE NOW | Explicit post-commit facts; durable critical delivery; idempotent handlers | MEDIUM |
| Backend timing | DECIDE NOW | Personal dry-run desktop first; control backend required before paid beta or live submission | HIGH |
| Runtime/toolchain | EXPERIMENT FIRST | Prefer Electron/TS, Drizzle/SQLite, optional Playwright; validate packaged Windows behavior | HIGH |
| First real adapter access | EXPERIMENT FIRST | One authorized Shopify merchant, preceded by FakeStoreAdapter | MEDIUM |
| Calibrated opportunity score | EXPERIMENT FIRST | Establish credible comparable data and explainable factors before numeric scoring | MEDIUM |
| Cloud, sync, subscriptions implementation | DEFER | Commercial control in Phase 3; hybrid services only after measured need | HIGH |

# PHASE 1

Build the smallest persistent vertical slice: URL monitor → authorized Shopify observation → exact variant normalization → seller validation → dated manual benchmark/cost evaluation → typed purchase rules → simulated execution decision → durable audit, with a fake-adapter keyword path to test monitor semantics. Show history, evidence quality and store health in a minimal Windows UI. No real cart, checkout, order submission, billing or cloud infrastructure.

Milestones, acceptance criteria, minimum tests/observability, and the risks this slice validates are specified in [ROADMAP.md, PHASE 1](ROADMAP.md#phase-1). Start only after the access, identity and packaged-runtime gates are resolved. The architecture review itself does not execute those spikes.
