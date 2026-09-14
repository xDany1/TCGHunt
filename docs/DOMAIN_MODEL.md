## M5.6 alert and opportunity separation

An existing RestockEvent may carry an optional version-1 MonitoringAlert display/evaluation projection, not another aggregate/event store. It freezes monitor/store/product/provider, old/new availability, purchase mode/release evidence, expiry/provenance and opportunity outcome. First observations remain baselines; PREORDER_OPENED is distinct from RESTOCK_DETECTED.

Optional MonitoringOpportunityContext supplies a selected observed Offer, reviewed mapping and cost scenario to existing financial evaluation. Missing context yields a blocked handoff without fake observations. COMPLETE arithmetic is not purchase readiness; purchaseReady=false and execution=NOT_REQUESTED always. Local receipts denote delivery, not acknowledgement. No schema/execution-authority change. [Semantics](RESTOCK_ENGINE.md), [report](../outputs/M5_6_REPORT.md).

# Domain model

## M5.5 monitoring configuration clarification

A product watch does not require a seller-specific Offer. ProductMonitorConfiguration contains a scoped product identity, source/provenance, delivery scope and DRY_RUN mode; the existing offer monitor configuration retains its simulation requirements. ProductPageObservation carries availability independently of purchaseMode/releaseDate and optional typed price/seller/fulfillment evidence. Missing facts remain UNKNOWN, and fulfillment cannot identify or approve a seller. These are store-independent application concepts, with no URLs/selectors/browser APIs in core types.

Product snapshots and comparison events reuse schema-v4 restock persistence. First observations initialize; failed/partial/stale reads cannot invent absence or a restock. Monitoring run completion and audit/outbox are durable without an acquisition intent. No variant/listing/Offer/seller rows are invented to satisfy a product watch. See [M5.5 report](../outputs/M5_5_REPORT.md) for integration and accepted Windows evidence: three durable product baselines, zero fabricated Offers/sellers, and successful reopen. M5.5 is PASS.

Architecture baseline: 2026-09-07. This is a conceptual model, not executable types, SQL, migrations, or a requirement to create every table in Phase 1. [Architecture](ARCHITECTURE.md) defines process and dependency boundaries; [Roadmap](ROADMAP.md) assigns implementation phases.

## 1. Vocabulary and relationships

| Concept | Meaning and identity | What it must not imply |
|---|---|---|
| CanonicalProduct | Internal identity for an exact commercial Pokémon product configuration: product kind, set, edition, language, packaging/unit count; sealed products first | A fuzzy title match is not proof of equivalence. |
| StoreInstance | A particular marketplace country site or a separately approved merchant/domain set | Amazon MX and US are not the same instance; neither are two Shopify merchants. |
| StoreProduct | Store-scoped catalog product/family, with its external product ID | Does not choose a seller or purchasable variant. |
| Variant | StoreProduct child representing selected dimensions/SKU: language, pack size, edition, etc. Stable external variant ID where available | A synthetic singleton variant for a store without variants does not prove the canonical mapping. |
| ProductMapping | Versioned assertion from a store Variant to a CanonicalProduct, with method, evidence, confidence and review state | It is not an immutable claim of authenticity. |
| Listing | Store-scoped advertisement/detail-page identity; may select a variant or expose multiple variants | A marketplace listing is not inherently a seller or a current price. |
| Offer | Seller-specific purchasable terms for one listing and variant, condition, fulfillment channel, delivery context and quantity basis | An offer identity does not promise that its observed terms are current. |
| Seller | Store-scoped external seller identity; reviewed first-party mapping separate from display name | Seller and fulfillment operator are not interchangeable. |
| Observation | Immutable evidence received from a capture, with per-field times/completeness | “In stock” does not reserve stock or establish purchasable quantity. |
| OpportunityEvaluation | Immutable financial/eligibility snapshot with provenance | Neither a purchase authorization nor realized profit. |
| PurchaseIntent | Explicit logical acquisition commitment with immutable identity, mode, quantity and authorization bounds | A new monitor run must not create a new commitment merely to retry. |
| CheckoutAttempt | One bounded attempt to prepare or submit for an intent | A timeout does not mean that no order exists. |
| Order | Evidence-backed external order identity and known lifecycle | A simulated decision or an opened checkout page is not an order. |

```text
CanonicalProduct 1 <-- N ProductMapping N --> 1 Variant N --> 1 StoreProduct
                                         |                        |
                                         +--- ListingVariant -----+
                                                 |
StoreInstance 1 --> N Listing 1 --> N Offer ------+ (one exact Variant)
       |                                |
       +--> N Seller 1 -----------------+ (soldBy)
                                        +--> fulfillment identity
                                        +--> N ListingObservation

Monitor 1 --> N MonitorRevision 1 --> N MonitorRun
MonitorRun N <--> N Observation (run attribution, shared capture allowed)
Observation(s) + Mapping + SellerEvaluation + MarketReference(s)
                          --> OpportunityEvaluation --> PurchaseIntent
PurchaseIntent 1 --> N CheckoutAttempt --> 0..N Order
PurchaseIntent 1 --> N LimitReservation --> Budget / quantity / count buckets
Every critical change --> AuditEvent; selected committed facts --> EventOutbox
```

A listing has a StoreProduct parent and zero or more known selectable variants; unresolved candidates may lack that relationship until resolution. Offer requires a single resolved variant. A first-party Shopify product can have one merchant seller, one listing and a variant-specific offer; do not drop the distinctions because the first adapter is simple. A marketplace detail page can expose offers from multiple sellers; a seller-owned item listing may expose only one seller. The same external ID string can occur across entity types or regions without being the same object.

CanonicalProduct is the exact desired sale unit, e.g. a specific-language sealed Elite Trainer Box configuration. A bundle of six boxes is not automatically one box, and a display box is not a booster pack. For independent cards later, condition and grading identity need an explicit extension; do not fill speculative card tables now. Store condition and seller-specific packaging claims remain offer evidence. Mapping corrections create a new mapping revision and preserve earlier decision references. Unresolved mapping blocks automatic/simulated buy eligibility, but not collection or manual review.

## 2. Aggregates and ownership

| Aggregate / context | Owned entities or snapshots | Invariants / lifecycle owner |
|---|---|---|
| CanonicalProduct / Catalog | Product attributes and reviewed aliases | Commercial unit identity cannot silently change under existing evaluations. Merge/split records retain mapping history. |
| StoreProduct / Catalog | Variants | External IDs unique within instance/type; variants have explicit selected dimensions. |
| Listing / Catalog | Variant associations; offer identity references | Offer term history is observed separately; no mutable seller overwrite. |
| Monitor / Discovery | Versioned definitions and rule references | URL/keyword modes are a discriminated choice; quantity positive; price bounds/currencies valid. Runs bind a revision. |
| MonitorRun / Discovery application | Lease, capture attribution, result summary | At most one active job per revision; reads may be retried under budgets. |
| SellerPolicy / Seller trust | Versioned deny/allow and mandatory evidence requirements | Deny wins; missing required evidence never approves. |
| SellerEvaluation / Seller trust | Immutable evaluated result and evidence | Approval bound to exact offer/seller context, version, and expiry. |
| Opportunity / Opportunity | Evaluation snapshot references and review disposition | Revised facts create a new evaluation; selected/dismissed is separate from validity. |
| PurchasePolicy / Purchase policy | Bounded typed eligibility rules and limit settings | Hard safeguards not represented as removable user expressions. |
| PurchaseIntent / Execution | Immutable commitment fields and status; attempt references | At most one unresolved live commitment for the guarded product scope; mode cannot change. |
| LimitLedger / Execution | Reservations and settled consumption across bucket types | Atomic admission; no overspend due to parallel local intents. |
| CheckoutAttempt / Execution | Quote/preparation/submission evidence and state version | One submission fence per attempt; unknown outcomes freeze replacement attempts. |
| Order / Execution | External order and line references; observed status updates | External identity unique; updates cannot double-count consumption. |
| StoreAccount / Accounts | Account metadata, credential/session references and health | Session identity must match instance/account; logout invalidates local leases. |
| Profile / Accounts | Revisioned minimal address/contact or retailer references | No CVV/PAN; changes invalidate bound preparation/approval. |
| License / Backend, future | Entitlement policy and device activations | Backend owns access decisions; signed cached lease is a local projection. |

Aggregates are consistency boundaries, not mandatory classes or one repository per table. The application coordinates transactions spanning the intent, limit ledger, audit and outbox because their safety invariants must be atomic in one local database. Catalog/discovery facts can be stored incrementally and evaluated asynchronously.

## 3. Value objects and evidence semantics

* **Money:** amount in integer minor units and ISO currency; explicit currency exponent and rounding policy. Use bounded integer/decimal serialization over IPC, not unsafe JSON numeric precision. Arithmetic must reject currency mismatches. Ratios/fees use decimal or rational representation, with a specified final rounding rule. Display precision cannot change policy outcomes.
* **Quantity:** positive integer plus sale-unit basis. Desired, observed available, and allowed-per-purchase quantities are different fields. `UNKNOWN` available quantity is not unlimited. Phase 1 requires known allowed quantity for a passing simulated buy decision.
* **ProductIdentity:** exact language, edition, product kind and pack/unit count. Unknown attributes remain unknown; absent language never defaults to English.
* **StoreReference:** store instance, entity type, external ID. SKU is scoped to its seller/store context, not globally unique. Normalized URL is a locator, not the main database key.
* **Observed<T>:** `KNOWN(value)` / `UNKNOWN(reason)` / `NOT_APPLICABLE(reason)`, capture/receive time, evidence ID, source field and validity period where known. Distinguish explicit zero shipping from unobserved shipping.
* **Evidence:** source ID, source rights/version, allowed uses/retention, capture ID, parser/adapter version, normalized field, confidence reason and optional sanitized artifact reference. Full raw response retention is not required for an audit explanation.
* **StockStatus:** IN_STOCK, OUT_OF_STOCK, PREORDER, BACKORDER, UNKNOWN. Preorder/backorder require a dedicated policy; default deny for purchase simulation. An old IN_STOCK can be displayed with age but cannot pass freshness gates.

M5.4 correction: new Amazon product-page observations separate `availability` (AVAILABLE / UNAVAILABLE / UNKNOWN) from `purchaseMode` (IMMEDIATE / PREORDER / UNKNOWN), with optional evidence-backed release date. Legacy StockStatus values remain supported for existing adapters. New ListingObservations carry optional independently evidenced purchaseMode; PREORDER and UNKNOWN modes cannot pass the immediate-purchase simulation gate. A confirmed product-page state may persist without a seller-specific Offer; it must not manufacture seller, price, fulfillment or complete marketplace-offer coverage. See [Restock Engine correction](RESTOCK_ENGINE.md#m54-three-state-correction) for scope and event semantics.
* **Quote:** exact cart lines/offer/seller/variant, quantity, fulfillment and destination scope, currency, taxes-inclusive flags, shipping, discounts and total, observedAt/expiresAt, evidence IDs and digest. Digest binds content; it does not authenticate untrusted retailer content by itself.
* **EvaluationContext:** monitor revision, policy versions, clock time, account/delivery pricing scope and source/mapping versions. Snapshot can be reproduced with the recorded inputs even if present-day policies differ.
* **Reason:** stable machine code, parameterized safe explanation and evidence references. Free text from a store is never executable or a policy instruction.

Observation timestamps include sourceObservedAt when supplied, capturedAt, and receivedAt. Receipt time does not turn stale source data into fresh evidence. Reject implausible future times or mark them uncertain. A stale late-arriving observation is retained but must not overwrite a newer current-offer projection. Conflicting sources are preserved separately; do not choose the convenient lower price.

Freshness thresholds are capability- and field-specific reviewed configuration. Initial Phase 1 simulator uses at most 60 seconds for quote-required price/stock/seller evidence and requires all configured cost fields; this is a provisional test target, not a store promise or universal live TTL. A future live action always revalidates at its final boundary, using the stricter of source expiry and tested policy.

## 4. Conceptual persistence design

Recommended logical records are below. Physical tables may combine small owned values where integrity remains clear. JSON extensions are versioned and size limited; identity, currency, key evidence state and safety query fields remain typed/indexed.

| Records | Key fields / important constraints | First needed |
|---|---|---|
| store_instances, adapter_configuration | instance ID, family, region, reviewed domains, access-policy reference, adapter version | Phase 1 |
| canonical_products, store_products, variants, product_mappings | internal stable IDs; store-scoped external uniqueness; mapping revision and review evidence | Phase 1 |
| listings, listing_variants, offers, sellers | external/source keys; exact variant/seller/fulfillment scope; identity confidence | Phase 1 |
| monitors, monitor_revisions | mode, query/URL, schedule, filters, quantity, priority, policy refs | Phase 1 |
| monitor_runs, observation_run_links | revision, due/start/end times, status, shared capture attribution | Phase 1 |
| listing_observations | IDs/scope, times, typed price/shipping/tax/stock/seller components, field completeness, bounded source extension | Phase 1 |
| seller_policies, seller_evaluations | policy revision, offer/seller, decision, reasons, evidence, expiry | Phase 1 |
| market_references, opportunity_evaluations, opportunity_dispositions | price kind, comparable unit/currency, provenance; scenario inputs/outputs, algorithm version | Phase 1, manual benchmark only |
| purchase_policies, rule_evaluations | typed rules/version; per-rule operands/result and safety result | Phase 1 |
| purchase_intents, checkout_attempts | mode, commitment key, bound evaluation/approval, versioned state and reason | Phase 1 simulation subset |
| limit_buckets, limit_reservations, consumption_entries | owner/product/time scope, currency/count units, held/settled status, unique source intent/order | Phase 1 simulated ledger tests; real ledger before mutations |
| jobs, event_outbox, handler_receipts | due time, lease/owner, correlation, schema version; unique event/handler receipt | Phase 1 |
| audit_events, notifications | immutable safe action facts; notification delivery/retry state | Phase 1 |
| store_accounts, session_metadata, profiles, encrypted_payload_refs | opaque secret refs, masked labels, auth and profile revision | Add real metadata only when needed; Phase 1 uses non-secret anonymous/local context |
| orders, order_lines, order_observations | unique instance/account/external order ID; links to intent/submission; provider status evidence | Before real assisted tracking/submission |
| users, subscriptions, licenses, devices, control_policies | backend-owned IDs/status/paid-through/device slots/policy version | Phase 3 backend only |

A ListingObservation is immutable and can contain multiple typed sub-observations with distinct field timestamps/capture IDs. A seller-only observation can have unknown price/stock rather than inventing values. PriceObservation/StockObservation/SellerObservation are typed views/components over this common stream. If independent high-volume market-series data later warrants a separate table, introduce it from measured query needs.

When no external offer ID exists, derive a source-scoped fingerprint from listing, variant, seller, condition, fulfillment and delivery/pricing context; record that it is synthetic. Do not include changing price in the durable offer identity, and do not use an uncertain synthetic key to authorize automatic substitution. Price/stock changes produce new observations.

Indexes planned: observation `(offerId, capturedAt)` and `(canonicalProductId, capturedAt)` where mapped; run `(monitorId, startedAt)`; due jobs `(status, nextDueAt)`; unresolved attempts `(state, updatedAt)`; audit `(intentId, timestamp)` and `(operationId, timestamp)`; source-scoped external IDs; unique order identity; unique `(handlerId, eventId)`; active commitment guard and reservation source IDs. Enforce foreign keys and state versions. No time-series database, sharding or full event-store schema in V1.

Retention policy proposals: source-permitted normalized observations 90 days by default, with explicit user retention/export choices and later compaction; operational logs 14 days / bounded size; sanitized diagnostic captures disabled by default and at most 24 hours when enabled; audit, intent and order history retained until explicit deletion/export policy. Provider limits always shorten retention. Critical decisions copy only permitted minimum typed inputs so deletion of an observation does not produce a dangling or misleading audit. If a provider forbids even that required decision evidence, disable the affected feature/source. Financial audit retention for a paid service is a launch policy decision, not silently asserted as a legal requirement.

Disk low/full: pause new captures and execution before integrity is lost, retain critical audit over disposable logs, expose actionable status. Corrupt database opens in recovery/read-only mode if feasible, with no auto-reset to an empty spend ledger. Backups use a consistent database snapshot. Restore creates a recovery epoch, disables live action, and requires reconciliation of historical commitments. Never export/import active jobs or permits as runnable authority.

Repository contracts return domain snapshots, not ORM models. `IntentRepository.reserveAndCreate` and `AttemptRepository.transitionWithAudit` express safety operations through a common transaction context. Application read models may use direct indexed SQL behind query ports. Cross-context writes are not accomplished by mutating objects returned from another module.

## 5. State machines and state ownership

All states named in the following tables are persisted unless explicitly labeled derived. State changes require an expected current state/version plus an audit record. Invalid/stale transitions fail without external I/O.

### Monitor and run

Monitor status: ACTIVE ↔ PAUSED; ACTIVE/PAUSED → ARCHIVED. Changing a definition adds a revision. Health (delayed, blocked, auth-required) is a separately timestamped projection, not a replacement for configured ACTIVE.

MonitorRun: QUEUED → RUNNING → SUCCEEDED / PARTIAL / FAILED / CANCELLED. A read retry uses the same run with numbered job attempts and bounded deadline. After crash, expired read jobs can be requeued with an audited recovery reason. PARTIAL records valid evidence plus missing pages/fields; it cannot pretend search was complete.

### Opportunity

Evaluation outcome is persisted: ELIGIBLE, INELIGIBLE, or INDETERMINATE. It records what was concluded at evaluatedAt. User disposition is separately OPEN, DISMISSED, or SELECTED. Current `STALE`, “seller now rejected,” and latest opportunity card are derived from evidence age/current policy. A past ELIGIBLE snapshot does not become a live approval forever. New evidence creates a new evaluation ID.

### PurchaseIntent

| From | To | Guard / effect |
|---|---|---|
| New | CREATED | Immutable identity/mode, stable commitment key and evaluation recorded. |
| CREATED | VALIDATING | Application explicitly requests evaluation of the commitment. |
| VALIDATING | READY | Required checks PASS; approved scope and reservation recorded (simulation ledger in DRY_RUN). |
| VALIDATING | BLOCKED / CANCELLED | Missing/failed required facts or explicit cancellation. |
| BLOCKED | VALIDATING | New valid evidence or resolved review; no unresolved submitted attempt. |
| READY | IN_PROGRESS | Attempt created/claimed atomically; scope still current. |
| READY | VALIDATING / CANCELLED | Evidence/policy expires or user cancels before action. |
| IN_PROGRESS | SIMULATED | DRY_RUN result and audit committed; simulated reservation closed. |
| IN_PROGRESS | RECONCILIATION_REQUIRED | Ambiguous submission or retailer handoff with unknown outcome. |
| IN_PROGRESS | COMPLETED | Confirmed external order set satisfies the intent. |
| IN_PROGRESS | BLOCKED / CANCELLED | Only when no order was submitted and no external ambiguity exists. |
| RECONCILIATION_REQUIRED | COMPLETED | Matching external order(s) established and recorded. |
| RECONCILIATION_REQUIRED | BLOCKED | Definitive non-creation established; fresh validation required for another attempt. |

SIMULATED, COMPLETED and CANCELLED are terminal. There is no transition from SIMULATED to live. Unknown outcomes cannot be cancelled into “safe to retry”; user can stop waiting in UI while the safety hold remains. For assisted handoff use RECONCILIATION_REQUIRED with reason HANDOFF_UNTRACKED; it truthfully represents the app's lack of authority over the external checkout.

### CheckoutAttempt

| From | To | Guard / interpretation |
|---|---|---|
| New | CREATED | Bound to exactly one intent and immutable mode. |
| CREATED | PREPARING | Optional authorized cart/quote work; Phase 1 uses local simulation only. |
| CREATED / PREPARING | READY | Required quote/decision context recorded; simulated readiness clearly labeled. |
| READY | SIMULATED | DRY_RUN: persist PURCHASE_WOULD_HAVE_EXECUTED; no OrderSubmission port. |
| READY | AWAITING_USER | Assisted handoff or future explicit confirmation is required. |
| AWAITING_USER | HANDED_OFF | User opens a validated retailer destination; intent waits for reconciliation. |
| AWAITING_USER | READY | App-bound confirmation received, still fresh; run final validation again. |
| READY | SUBMITTING | Future LIVE only; atomic fence/permit consumption and all final gates. |
| SUBMITTING | SUBMITTED | Store acknowledges an order/submission reference; still not confirmed. |
| SUBMITTING | UNKNOWN | Any possibility an effect occurred without sufficient recorded acknowledgement. |
| SUBMITTING | FAILED_SAFE | Definitive non-creation evidence, not merely a transport error. |
| SUBMITTED | CONFIRMED / UNKNOWN / FAILED_SAFE | Authoritative result; FAILED_SAFE only for a preliminary submission acknowledgement followed by definitive proof that no order was created. An existing cancelled order stays an Order lifecycle fact. |
| UNKNOWN / HANDED_OFF | CONFIRMED / FAILED_SAFE | Evidence-backed reconciliation; otherwise state remains and review flag is set. |
| CREATED / PREPARING / READY / AWAITING_USER | FAILED_SAFE / CANCELLED | No submission possible; ambiguous cart mutation instead needs cart reconciliation before another preparation. |

SIMULATED, CONFIRMED, FAILED_SAFE and CANCELLED are terminal attempt states. A retry creates a numbered new attempt under the original intent only after non-creation/revalidation; there is no generic RETRYABLE_FAILURE state that shortcuts guards. A restart seeing SUBMITTING converts it to UNKNOWN without dispatch. SUBMITTED is reconciled, never re-submitted. `reviewRequired` and reason identify human work without erasing UNKNOWN. Cart mutations may be ambiguous even before submission; preserve cart reconciliation evidence and never blindly add the same quantity again.

### Order

Order records require external identity or explicit manual evidence with `verification=USER_REPORTED`. Authoritative status observations map to PENDING, CONFIRMED, CANCELLED, FULFILLED, or UNKNOWN, preserving provider status and observed time. Partial cancellation/fulfillment belongs to line-level observations. A cancellation request alone does not mean CANCELLED. Confirmed order can later be cancelled or fulfilled. Out-of-order provider updates cannot regress a newer authoritative status without a recorded correction. USER_REPORTED order evidence helps tracking but cannot by itself release an uncertain automatic purchase hold.

One retailer submission can return several order IDs or later split fulfillment; support order groups and allocate costs/quantities without double-counting. A confirmed intent means the acquisition was confirmed, not delivered or profitable. Cancelling an existing order never rewinds its attempt into a safe automatic retry; any deliberate replacement is a new acquisition cycle subject to all limits and fresh authorization. Actual resale/inventory lifecycle is deferred.

### Other state owners

Account authentication: UNKNOWN → AUTHENTICATING → AUTHENTICATED / AUTH_REQUIRED / REVOKED; session expiry changes auth state and cancels unused execution leases. Capability health is independent. ExecutionModeTransition is an audited application record; mode is frozen onto each intent. Backend License owns ACTIVE/EXPIRED/SUSPENDED/CANCELLED; cached signed lease validity is a derived local access decision, never a mutable license truth.

## 6. Critical invariants and concurrency protocol

1. **Exact subject:** acquisition decisions bind product, exact store variant, offer, seller, quantity, currency, account/destination context and policy revision. Missing identity prevents a passing execution decision.
2. **Evidence completeness:** unknown/stale/conflicting required values do not default to safe values; seller APPROVED is mandatory but not sufficient.
3. **Mode isolation:** DRY_RUN never invokes real submission, never writes a real Order, and never consumes the real spend ledger. Phase 1 has no network mutation path at all.
4. **One authority:** only the execution coordinator can issue/consume a live permit; renderer, generic job retry, adapter parser and event subscriber cannot authorize purchase.
5. **Atomic admission:** all applicable limits are checked and reserved in the same transaction that establishes intent readiness. Multiple accounts/monitors cannot race separate read-then-write budget checks.
6. **Durable before effect:** submission state/fence and audit commit before network dispatch. Failed audit/persistence means no new effect.
7. **Uncertainty is sticky:** unknown outcomes hold quantity, spend and product guards until authoritative resolution; elapsed time, lease expiry or UI cancellation cannot imply failure.
8. **Safe recovery:** process restart, backup restore, duplicate event or clock rollback never creates a new live authority.
9. **Rules narrow authority:** preferences, feature flags and allowlists cannot bypass platform restrictions, denied sellers, missing evidence or hard limits.
10. **No secret propagation:** logs/events/DTOs store opaque refs and redacted evidence, never reusable session/payment credentials.
11. **Single execution owner:** Phase 1 and initial commercial live design assume one installation owns a purchase account's execution. Cloud/multi-device expansion is gated on shared authority.
12. **Truthful reporting:** simulation, acknowledgement, confirmed purchase and estimated resale profit are separate facts.

Logical idempotency key is created once when the user/monitor acquisition policy opens a purchase cycle. It includes owner scope and a durable cycle ID, not only a timestamp or observation ID. All retries and overlapping monitors resolving to that active cycle reuse it. A separate product commitment guard keyed by owner + CanonicalProduct (or conservative exact product scope before mapping) blocks simultaneous equivalent acquisition across stores/accounts. Phase 1 chooses one target product per intent and one product acquisition at a time; multi-line bundling is deferred.

Cooldown starts at committed dispatch/known purchase time and remains blocked indefinitely while outcome is unknown. Simulation deduplication has its own namespace and can close after its simulated terminal result/cooldown; it must not affect real purchase history. A deliberate later purchase requires a new cycle after product limits/cooldown allow it. Changing monitor IDs or policy revision does not erase an existing product guard.

Spend admission for each daily/monthly/order bucket uses settled consumption + unresolved/held commitments + proposed maximum landed cost <= cap. Quantity and purchases-per-day use corresponding units, not money. Product quantity limits default to the current acquisition campaign plus any configured lifetime cap; scope must be displayed explicitly, never an undefined “per product.” Limits aggregate across local stores/accounts for the same owner. User external purchases are outside automatic accounting unless imported; disclose that limitation.

Reservations hold the approved upper bound, not merely the last observed item price. Before dispatch, adjust to a fresh exact quote only if all affected limits still pass; otherwise block. On confirmation convert held amount to actual committed consumption exactly once and release verified surplus. Unexpected higher actual total creates an incident and blocks further purchase; do not silently approve it retroactively. Cancellation/refund adjustments use separate idempotent entries and do not rewrite original consumption.

Daily/monthly buckets use a chosen owner timezone and stored boundaries; a queued intent crossing a boundary must reserve the current buckets again before dispatch. An unknown commitment from a previous bucket remains a conservative carry-forward hold for new admission until resolved; do not reset its risk at midnight. Max checkout attempts counts actual preparation/submission attempts as configured, with separate network read retries. Changes to timezone, currency or caps are audited, cannot erase existing holds, and require revalidation. Limits lowered beneath existing consumption block new actions rather than retroactively deleting history.

Single writer transactions, expected-version checks and unique active-guard constraints enforce admission. Local lease owner/session epoch helps recovery but is not external idempotency. Provider idempotency keys are scoped and retained according to documented behavior; do not reuse a key with changed request body or assume its lifetime is infinite. Definitive absence proof must specify provider consistency and lookup coverage; if unavailable, the integration remains assisted/observe-only for cases requiring that guarantee.

## 7. Domain events and delivery ownership

Envelope: eventId, eventType, schemaVersion, aggregateType/id/version, occurredAt, recordedAt, traceId, correlation/operationId, causationId, execution mode where relevant, and a bounded safe payload. IDs and immutable snapshot references are preferred to copied sensitive content. Phase 1 events use schema version 1; unknown major versions fail to a visible dead-letter state, never guessed interpretation.

| Event | Producer / payload | Consumer and durability |
|---|---|---|
| ProductDiscovered | Catalog; store product/variant IDs, mapping state | UI/catalog review; durable when scheduling downstream work. |
| ListingObserved | Discovery; observation ID, listing/offer IDs and completeness | Evaluation workflow; durable. |
| PriceChanged / StockChanged | Discovery projection; previous/new comparable observation IDs | Notification/analysis; derive only within same offer/context and known comparable values. Durable if an alert must survive restart. |
| SellerValidated | Seller trust; evaluation ID, result/reasons | Opportunity workflow/audit; durable; event name does not mean approved. |
| OpportunityDetected | Opportunity; eligible evaluation ID | UI/notification, eligible intent proposal; durable. Never direct submit. |
| PurchaseIntentCreated | Execution; intent ID, bound scope and mode | Execution workflow/audit; durable. |
| CheckoutStarted | Execution; attempt ID and intent | Audit/UI; durable. |
| CheckoutPrepared | Execution; preparation reference, expiry/mode | UI/workflow; durable, no secret checkout URL in event body. |
| PurchaseWouldHaveExecuted | Execution; serialized audit action `PURCHASE_WOULD_HAVE_EXECUTED`, evaluation/rule refs | Audit/UI; durable; not an OrderSubmitted alias. |
| OrderSubmitted | Execution; external acknowledgement reference | Reconciliation/audit; durable, future only. |
| OrderConfirmed | Execution; verified order group/reference | Ledger/notifications via idempotent transaction; durable, future only. |
| OrderFailed | Execution; definitive non-creation/failure evidence | Audit/review; durable, never emitted to simplify uncertainty. |
| OrderStateUnknown | Execution; attempt and certainty reason | Reconciliation/review; durable. |
| ExecutionModeChanged / IntegrationPolicyChanged | Application control; safe before/after metadata | Invalidate unconsumed permits; audit durable. |

Define all contracts conceptually now; implement only those the current slice emits/consumes. Order events remain future contract reservations and are tested with fakes when safety work starts, not fabricated in Phase 1.

Commit aggregate change, audit fact and critical outbox entry together. Dispatcher runs locally after commit. Handler transaction records its receipt with resulting state; a crash before receipt replays safely. Notification delivery may duplicate at the external sink if it lacks idempotency, but must not duplicate a purchase. Per-aggregate ordering uses versions; consumers may load referenced snapshots and reject obsolete work. There is no global event ordering assumption. Poison events are bounded-retry, retained for inspection, and cannot unblock purchases by being discarded. Event payloads and audit records have different purposes and retention; neither is the entire source of system state.
