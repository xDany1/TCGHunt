## M5.6 — Amazon Restock Alert & Opportunity Handoff — 2026-09-12

**M5.6 = PASS — deterministic acceptance.** M5.5 remains PASS — CLOSED. The existing Restock Engine now feeds durable in-app alerts and a separate read-only opportunity handoff. No reducer or schema change.

| Condition | Result |
|---|---|
| First unavailable, immediate or preorder observation | Baseline only; no alert |
| Fresh explicit UNAVAILABLE → AVAILABLE/IMMEDIATE | RESTOCK_DETECTED |
| Fresh explicit UNAVAILABLE → AVAILABLE/PREORDER | PREORDER_OPENED |
| AVAILABLE/PREORDER → UNAVAILABLE | PREORDER_CLOSED |
| Available with known preorder/immediate mode change | PURCHASE_MODE_CHANGED, not a fabricated restock |
| Repeated state/replay | No duplicate alert |
| Failed/challenged/denied/parser/partial/stale input | No stock alert; retain prior qualifying baseline |
| Recovery after baseline expiry | Rebaseline without event |

A brief failure followed by fresh explicit availability can still compare against a fresh unavailable baseline. The failure never implies unavailable. Existing availability-loss, approved-offer and price-range events retain their meanings. No new event types. The 60-second evidence window and source interval remain unchanged; expired comparisons are not extended to manufacture scheduled restocks.

New RestockEvent envelopes carry an optional version-1 MonitoringAlert projection: monitor/store/provider/product identity, title, old/new availability, purchase mode, independently fresh release date, expiry/provenance and immutable opportunity decision. ID/type/time remain on the event envelope. Sample/state/event/outbox share a transaction, including the existing product-monitor run/audit/product callback. SQLite remains v4. Legacy envelopes/fingerprints stay unchanged; historical events lacking alert projections remain in their original history without invented retrospective evaluations.

Optional MonitoringOpportunityContext selects an observation already in the scoped input and supplies reviewed mapping, target, cost scenario, quantity and currency. Core matchProduct, validateSeller, assessEvidence and evaluateOpportunity are reused. Missing Offer/context yields BLOCKED / INDETERMINATE with clear reasons; no financial request is fabricated. Complete reviewed fixtures can return EVALUATED / COMPLETE, meaning arithmetic only, not policy eligibility. Seller/mapping failures can coexist with COMPLETE arithmetic. The current Amazon product configuration has no reviewed acquisition context and remains blocked. The handoff never calls simulation/admission or execution.

Existing stable event IDs and local handler/event receipts deduplicate logical alerts. Delivery is at least once; the receipt effect is atomic, and outbox acknowledgement can retry. The bounded latest-100 Alerts query shows PENDING/DELIVERED/DEAD_LETTER separately from stock evidence. DELIVERED means local inbox delivery, not read/acknowledged. No acknowledgement model, native toast, external notification integration or duplicate event store is added. React escapes the presentation fields and labels expired event evidence as historical; event-time opportunity decisions do not change.

722/722 tests (694 preserved + 28 new), typecheck/build, lint, formatting and production packaging pass. New coverage proves crash/restart/outbox replay, blocked and complete handoffs without intents, authored BrowserProvider normalization/product-monitor transaction, Shopify restock projection/mixed scope isolation, and static React rendering. No new live run or real restock is claimed. No separate Windows evidence is required for these deterministic additions. Package build/static rendering are not a newly executed packaged UI interaction test.

DRY_RUN and zero private calls/request replays/mutations/purchase intents/checkout attempts for this handoff. Local event replay remains intentionally tested. Backend-first detection, controlled cart/reserve correlation, listing/merchant identity, sessions/CSRF/tokens, price/quantity guards and BrowserCartTransport/BackendCartTransport remain deferred. M5.7 NOT STARTED. [M5.6 report](../outputs/M5_6_REPORT.md).

# Restock and state transitions — M5.3

The M5.3 rules below remain the legacy offer/complete-scope behavior. The explicitly authorized M5.4 correction adds the distinct product-page signal and purchase-mode rules at the end; it does not infer complete seller inventory from product HTML.

The engine is deterministic, offline and provider-independent. It consumes domain ListingObservation evidence and explicit scoped coverage, not HTML, Amazon API payloads or provider-specific stock rules. Its output is an auditable reason to reevaluate an opportunity, never permission to purchase. No live runtime, scheduling or external delivery is added.

## Inputs and scope

`RestockInput` carries a caller-assigned immutable observation ID, DRY_RUN mode, scope, source/receipt/expiry times, status, coverage, domain observations and safe provider/reference provenance. A scope includes a watch ID, StoreProduct reference and delivery/pricing context, plus one of:

| Scope | Subject | Interpretation |
|---|---|---|
| OFFER | Exact stable Offer reference | Physical availability and price of that offer. |
| SELLER | Exact Seller reference within the product/context | Whether that seller has an approved available offer in the declared scope. |
| PRODUCT | Product within its declared context | Whether any approved available offer exists in the declared scope. |

The existing identities are reused. Seller, condition, fulfillment or pricing-context changes must not reuse a stable offer ID. Price, time and provider do not enter scope identity. Product families cannot substitute for child observations. The reducer rejects mismatched identity graphs, scopes and contradictory same-offer seller/known-fulfillment changes.

Policy includes a monotonic revision, human-readable version, existing SellerPolicy, maximum unit-price Money and maximum age (positive, at most 60 seconds). A changed policy revision resets comparison; reusing a revision with different policy contents conflicts. Older revisions cannot roll state back. The full consumed policy identity is retained in the sample.

## Absence and coverage — decided before implementation

| Input | Required coverage | Effect |
|---|---|---|
| Successfully observed explicit offer stock | EXPLICIT_OFFER with exactly one matching offer, or COMPLETE_SCOPE | May establish/compare known availability when evidence is fresh. |
| Explicit unavailable stock for the tracked offer | Same as above | May support availability loss and a later literal restock. |
| NO_OFFER_OBSERVED | COMPLETE_SCOPE | Establishes no approved available offer in that exact declared scope. It is not literal stock evidence for an absent offer. |
| No offers returned by a subset/unknown source | PARTIAL or UNKNOWN | Diagnostic incomplete sample only; no absence conclusion. |
| Partial coverage, unknown stock, failed observation | Any | No business transition; previous baseline is preserved with its original expiry. |

COMPLETE_SCOPE is a positive capture-authority assertion, not a deduction from an empty array. M5.3 tests it with authored complete-scope snapshots. **Neither current Amazon provider establishes complete product/seller coverage.** The new adapter-local bridge only promotes the successfully mapped, explicitly observed matching offer to EXPLICIT_OFFER. Product/seller subsets and empty results stay partial. Missing shipping/price is different from missing stock coverage: a coherent known offer can supply stock evidence while still being an indeterminate opportunity.

Challenge, denied access, timeout, parser/auth/network failure and layout mismatch are failed/incomplete inputs. They cannot mean unavailable. The caller supplies only a safe diagnostic reference; no raw error, HTML, cookie or credential enters the durable sample. A failure can leave last-known data stale; it cannot refresh that data or invent a transition.

## State, initialization and freshness

Each scope stores its latest sample, last comparable baseline and an interrupted flag. A projected sample contains source observation/evidence IDs, stable offer/seller/fulfillment references, stock, approved-seller result, price range/value, expiry, policy identity and provider provenance.

First known AVAILABLE or UNAVAILABLE establishes INITIALIZED with no event. First unknown/partial/failed input records INCOMPLETE with no baseline. The first later known sample establishes the baseline, not a restock.

Freshness uses existing `assessEvidence` and `validateSeller`. Stock source time must equal the envelope observation time, preventing an old capture being relabeled as a new reading. Receipt time never refreshes source age. Baseline expiry is the minimum of capture, stock and seller expiries and the configured age limit. Previous price has its own expiry and cannot support a crossing after it expires.

After a brief interruption, an unexpired explicit UNAVAILABLE baseline may still prove a later restock. An AVAILABLE baseline followed by failure and AVAILABLE recovers without restock. Once the prior baseline expires, the next comparable sample is RECOVERED and replaces the baseline without a business event. No outage timer or fabricated unavailable state is used.

Older or equal source times are ignored for state advancement. A policy revision change likewise requires a new baseline. This deliberately favors missed ambiguous transitions over false events; same-time contradictory captures require later evidence.

## Event vocabulary

| Durable event | Predicate |
|---|---|
| RESTOCK_DETECTED | Exact OFFER scope, comparable explicit UNAVAILABLE → AVAILABLE, current seller approved. |
| AVAILABILITY_LOST | Exact OFFER scope, approved AVAILABLE → explicit UNAVAILABLE. |
| APPROVED_OFFER_BECAME_AVAILABLE | Complete SELLER/PRODUCT scope changes from no approved available offer to at least one. |
| APPROVED_OFFER_BECAME_UNAVAILABLE | Complete SELLER/PRODUCT scope loses its last approved available offer. |
| PRICE_ENTERED_RANGE | Same approved available OFFER stays available while fresh price moves above max to at/below max. |
| PRICE_LEFT_RANGE | Same approved available OFFER stays available while fresh price moves at/below max to above max. |

All events request opportunity reevaluation. Initialization, recovery, partial coverage, failures and unchanged evidence are durable sample outcomes/diagnostics, not notification business events. Seller and fulfillment changes are visible in scoped histories rather than separate event types. Amazon Retail uses its reviewed seller scope and the same generic event vocabulary.

Strong explicit evidence can transition immediately. There is no arbitrary two-read requirement, debounce window or provider-specific timer. Repeated equal states emit nothing. Flapping that is genuinely backed by successive strong opposite observations records genuine edges; weak/incomplete evidence cannot flip state.

## Seller, price and opportunity boundaries

The existing SellerValidationEngine remains authoritative. FBA and display name do not imply approval. An unreviewed third-party offer becoming available does not produce an actionable restock event. Complete product/seller observations may establish the separate transition from no approved offer to an approved available offer.

Price comparisons use integer minor units and matching currencies. UNKNOWN, negative or different-currency prices are indeterminate. UNKNOWN → acceptable price is new knowledge, not an inferred crossing. A simultaneous stock and price change produces the stock transition; price events require availability on both sides.

No ACTIONABLE_NOW or purchase-readiness shortcut is introduced. Literal restock may be known while mapping, acquisition shipping, tax, quantity or price remains unknown. Host composition can persist the restock sample/event and invoke the existing opportunity/coordinator path; the integration test proves this still yields INDETERMINATE/BLOCKED DRY_RUN. There is no automatic execution callback in the event consumer and no new background product flow.

## Persistence and replay

SQLite schema **3 → 4** adds five tables: `restock_scopes`, `restock_samples`, `restock_events`, `restock_outbox`, `restock_receipts`, with indexes and foreign keys. Existing entities/ledger/evidence are untouched. Existing outbox rows require a PurchaseIntent and cannot truthfully represent restock-only facts, so the implementation reuses the transaction/receipt pattern in dedicated small tables rather than creating fake intents or redesigning the purchase outbox.

`RestockRepository.record` holds one BEGIN IMMEDIATE transaction across prior-state read, sample, state update, events and pending outbox entries. The receipt key is scope + policy revision + input ID. Replays compare a canonical projection fingerprint calculated at the original receipt time; later processing does not change it. Conflicting reuse fails. A duplicate returns the historical receipt outcome with no new events; `getState` remains the current state and is never rolled back by replay.

Event identity is deterministic from scope, consumed policy identity, previous/current input IDs and event type. Event history preserves both sample references, policy version, timestamp and mode. Provider provenance may change event IDs across independently authored sequences, but business meaning and stable scope are equivalent. Merely switching provider produces no event.

The local inbox consumer inserts a unique `(handler, event)` receipt as its durable local effect, then acknowledges separately. Failure between effect and acknowledgement retries without duplicating the effect. Retries are bounded to three with visible DEAD_LETTER state; no external notification is sent. Audit events and delivery status have separate tables/lifecycles. Database recovery mode remains read-only.

Samples and replay fingerprints contain only consumed domain projections; unknown raw input fields are discarded. No raw HTML/API response, cookies or secrets are stored. Normal ListingObservation persistence remains the existing coordinator's responsibility; restock samples also support absence/failure evidence that has no ListingObservation row.

## Architecture and next milestone

Application owns the pure reducer and repository port; infrastructure owns SQLite; the adapter-local bridge translates already normalized Amazon output. No provider implementation was deleted or redesigned. ADR-002, ADR-003 and ADR-008 already cover these capability, transaction and receipt decisions; no new system-wide ADR is needed.

Business API onboarding is **not the immediate development dependency**. Preserve AmazonBusinessApiProvider as the optional future official provider. The next planned milestone is **M5.4 Amazon Browser Read-Only Validation**, separately authorized. It must establish permitted access, real layout/coverage and runtime safeguards. M5.3 neither launches a browser nor claims production Amazon compatibility.

## M5.4 three-state correction

`ProductPageObservation` is a typed, provider-independent product reference/title plus independently evidenced availability, purchase mode and release date. It is carried on a PRODUCT-scoped RestockInput with `PRODUCT_PAGE` coverage. This means explicit state of the confirmed detail page, not COMPLETE_SCOPE seller inventory. A successful challenge-free product page can explicitly say UNAVAILABLE even with zero Offers. Missing Offers by themselves still prove nothing. Product evidence must match scope and capture time and pass ordinary freshness checks; failures/unknowns preserve the old baseline without a new transition.

The corrected Amazon host always records this product scope when the projection supports it, including when a seller-specific ListingObservation is available. Thus the same product history spans unavailable/no-offer and later available states. The product snapshot, title, release-date evidence, purchase-mode evidence and provider provenance live in the existing `restock_samples` and `restock_scopes` JSON snapshots. No fake catalog Offer or seller row is inserted. A genuine mapped Offer continues through existing catalog/evaluation/coordinator persistence separately. There is no SQLite migration; schema remains v4.

Availability remains AVAILABLE / UNAVAILABLE / UNKNOWN. Purchase mode independently remains IMMEDIATE / PREORDER / UNKNOWN. PREORDER may be open, closed or of unknown availability. A release date alone does not establish an open preorder. An enabled visible reserve control plus a valid release statement can establish an open preorder; explicit unavailable evidence takes precedence. Conflicting normal/reserve signals keep mode UNKNOWN.

| Fresh comparison | Event |
|---|---|
| First known state, including PREORDER | INITIALIZED, no business event |
| Explicit UNAVAILABLE → AVAILABLE + IMMEDIATE | RESTOCK_DETECTED |
| Explicit UNAVAILABLE → AVAILABLE + PREORDER | PREORDER_OPENED |
| AVAILABLE + PREORDER → UNAVAILABLE | PREORDER_CLOSED |
| AVAILABLE + PREORDER ↔ AVAILABLE + IMMEDIATE | PURCHASE_MODE_CHANGED |
| Same preorder state repeated | UNCHANGED, no duplicate event |

For PRODUCT_PAGE comparisons these are product commerce-state signals, not assertions of an approved seller or actionable stock. Both snapshots must carry product-page evidence. For OFFER comparisons the existing seller-approval gates remain in place; an explicit unknown purchase mode cannot produce a literal restock. Legacy offer observations lacking the new field retain M5.3 behavior, including legacy stock PREORDER being non-comparable. Price crossings remain distinct and now require unchanged IMMEDIATE mode. Known purchase-mode expiry limits baseline freshness as well as availability expiry.

All signals request reevaluation only. Seller approval remains separate; no product signal grants it. Application admission explicitly blocks a known PREORDER or unknown purchase mode on new ListingObservations. A dedicated preorder execution policy is not implemented. Missing shipping/costs/mapping still block simulation independently.

The existing version-1 event envelope is unchanged; three event types are added to the local receipt consumer. Existing snapshots omit the new optional fields and retain their replay fingerprints. Tests verify unchanged legacy behavior, new transitions, restart/replay and receipt idempotency. Older binaries do not understand the new event types and must not be used to consume new correction data; no downgrade compatibility is claimed. The completed M5.3 tests, architecture boundaries and SQLite transaction ownership remain intact. M5.5 has not started.

## M5.4/M5.4A closure and diagnostic boundary

Both milestones are CLOSED — PARTIAL — ACCEPTED BROWSER LIMITATION. The final Windows pass observed natural POST traffic but established no qualified private availability, price/currency, seller/fulfillment or UI lead signal. No further recon is planned. [Closure](../outputs/M5_4A_FINAL_DEEP_REPORT.md).

M5.3 semantics remain unchanged. Rendered UI and independently qualified structured observations may enter normal normalization and product-state processing. First comparable observations establish baselines. Failures, partial coverage, unknown absence, stale facts and unqualified private payloads must not create fake RESTOCK_DETECTED or PREORDER_OPENED events. Seller approval remains separate; fulfillment by Amazon does not approve a seller.

Retained passive helpers have no reducer/persistence/coordinator authority. Earlier diagnostics required a prior unavailable reference; the final-pass diagnostic additionally allowed a private AVAILABLE hint while ASIN-bound UI remained unknown, explicitly recording priorUnavailableEstablished=false. That hint is not a literal restock, business event or purchase intent. Later UI confirmation records agreement only; conflicts stay UNKNOWN/non-actionable. No such qualified private hint was established in the actual final run.

M5.5 starts from product-level BrowserProvider observations with potentially UNKNOWN Offer completeness. Existing durable idempotency and freshness rules stay intact; no new event type/schema or production private-network source is introduced by closure.

Future backend availability research remains explicitly on [the roadmap](ROADMAP.md#future-execution-engine-objective--amazon-backend-first-research-not-m55). A future RESTOCK_CANDIDATE never becomes purchase-ready without ASIN match, approved seller, price guard, offer identity, fresh availability and idempotency/duplicate guard, plus existing execution safeguards. It cannot bypass the first-observation baseline or current DRY_RUN. That Execution Engine research is not M5.5 implementation.

## M5.5 desktop consumer — 2026-09-12

**M5.5 = PASS — CLOSED.** ProductMonitorConfiguration is a store-independent alternative to the offer simulation configuration. The existing desktop owner routes normalized product observations into this reducer and schema-v4 repositories. Product sample/state/transitions/outbox, run completion and linked monitor audit commit atomically; failures and their source restriction commit together. Restock receipts remain local, idempotent and disconnected from execution. No reducer rules or event types changed.

Optional typed product price/seller/fulfillment presentation fields preserve UNKNOWN; their monitor projection is opt-in so prior M5.4 replay fingerprints remain unchanged. First unavailable/preorder/immediate observations initialize only. Failed attempts preserve the earlier baseline, and the UI distinguishes older successful evidence from the latest failure. Partial successful evidence displays UNKNOWN, never invented absence. Restart delivers pending receipts without browser replay. The 60-second evidence age is not extended to accommodate the 60–86400-second cadence: expired comparisons recover/rebaseline without claiming a restock. Product availability does not grant seller approval or opportunity admission, and this monitor path creates no purchase intent.

The accepted [Windows result](../outputs/M5_5_REPORT.md) proves three durable first-observation baselines (UNAVAILABLE, AVAILABLE/PREORDER with 2026-11-13 release, AVAILABLE/IMMEDIATE), zero restock events and successful pause/resume/reopen. No Offer/seller or purchase intent was created. No new live/unattended run occurred during closure. Backend-first detection and cart transport research stays deferred; M5.6 has not started.
