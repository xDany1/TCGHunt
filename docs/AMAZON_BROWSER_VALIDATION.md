# Amazon browser read-only validation — corrected M5.4

## M5.5 monitoring integration addendum — 2026-09-12

**M5.5 = PASS — CLOSED.** The initial Windows monitor run navigated successfully but its generated capture ID contained a period rejected by the strict identifier grammar. The prefix is corrected to m5-5 and stable marketplace/store/ASIN comparisons plus sanitized diagnostics are added. [Correction report](../outputs/M5_5_CONTEXT_CORRECTION_REPORT.md). The new adapter-worker composition reuses the ordinary M5.4 runtime/extractor below, with no passive profiles/listeners or private evidence. Desktop host authorization is separately named `AMAZON_BROWSER_MONITORING_ENABLED=1`; the older M5.4 commands remain retired. Source resolution permits only the three approved ASINs and strict MX hosts. Playwright remains outside core/application and renderer, in the adapter worker. Each bounded read has an ephemeral anonymous browser/context; default JavaScript/XHR restrictions, linked-stylesheet limits, redirect checks, sandbox and no-interaction rules remain unchanged.

The existing scheduler applies a durable 60-second Amazon source interval and the shared six-read lifetime ceiling, with no refill. Run-now uses the same guards. Challenges/access failures latch the Amazon scope and do not disable Shopify. Cancellation closes active browser work and ignores late results. Product monitoring persists partial product evidence without an Offer and presents its timestamp/expiry alongside last-attempt failures. See [M5.5 report](../outputs/M5_5_REPORT.md) for the accepted BOUNDED_WINDOWS_LIFECYCLE_VALIDATED result: three navigations, matching context, three durable baselines and successful pause/resume/reopen. The command is completed and retired; no remaining M5.5 validation gate. No new live Amazon navigation or unattended monitoring was started during closure. The M5.4 closure and historical evidence below are unchanged.

Updated 2026-09-12. **CLOSED — PARTIAL — ACCEPTED BROWSER LIMITATION.** Windows navigation, ASIN/title, product states and durable baselines/replay are accepted; anonymous seller-specific Offer completeness and private early signals remain accepted limitations. No further M5.4/M5.4A live runs. [Closure report](../outputs/M5_4_REPORT.md).

## Historical invocation and retained boundaries (closed)

The [historical Windows command](../outputs/M5_4_CORRECTION_WINDOWS_VALIDATION.md) is retired; do not invoke it for further M5.4 validation. The correction approves B0H78BB9TY (unavailable hypothesis), B0HG3C5JK6 (preorder hypothesis), and B0GYVHLP4L (immediate-purchase hypothesis). Expected states never override observed evidence.

Live access requires AMAZON_BROWSER_LIVE_VALIDATION_ENABLED=1 and explicit URL arguments. Missing opt-in/targets stops before browser/database creation. Node 24 and pinned Playwright Core 1.62.1 use installed Edge via msedge, headless with Chromium sandbox enabled. The dependency was provisioned from the installed bundle without download; the existing lockfile is not a fully frozen fresh-machine installation guarantee. No install script runs in the harness.

Only the developer command owns Playwright. AmazonBrowserProvider receives data-only projections; packages never import Playwright or navigate. Business API and the fixture-only AmazonObservationService remain intact, with no fallback or new desktop UI authority. Existing authored HTML/v1 projections retain prior behavior. Rights metadata reflects this narrow user-directed validation, not a commercial data license.

Three-target invocation performs one initial read per target, sequentially, at most two document requests per ASIN including redirects, plus eight allowed stylesheet requests per ASIN. Legacy one/two-target invocation retains two reads separated by at least 45 seconds after capture/cleanup and three document requests per ASIN. No polling, discovery or aggressive retries. Runtime/challenge/access/parser failure stops the run; incomplete successful product observations can persist and proceed to the next target.

## Minimal rendering experiment

The old Windows captures each recorded 66 blocked subresources and no price/seller/shipper. This justifies investigation, but does not prove resource blocking caused missing fields. Selectors or genuinely missing evidence can also explain it.

JavaScript remains disabled, service workers blocked, downloads disabled and TLS verification enabled. The only resource relaxation is stylesheet GETs whose exact URLs appear in stylesheet link elements in the approved product response. Hosts are Amazon MX or static m.media-amazon.com, restricted there to /images/I/ and /images/S/ paths ending in .css. At most eight exact links/requests per ASIN are admitted. CSS redirects, unlinked assets, scripts, XHR/fetch, images, frames, third-party tracking and other requests remain blocked. The accepted three-target Windows run admitted two stylesheet requests per ASIN and exposed B/C prices and action controls. This is positive evidence for the bounded policy; it does not isolate CSS as the cause or establish complete seller/currency extraction. No resource policy change is made for v3.

Documents remain HTTPS GET only for amazon.com.mx / www.amazon.com.mx and the current approved ASIN path. Ports/credentials, non-MX/mobile hosts, short links, seller-selecting parameters and unrelated paths are rejected. Tracking normalizes away. Redirect fetch uses maxRedirects=0 and maxRetries=0; locations are checked before fulfillment and after navigation. Counts distinguish read attempts, navigations, document/stylesheet attempts and blocked resource types.

Each observation has a fresh nonpersistent context. There is no personal profile attachment, cookie import, login, account-location change, stealth, identity-header override, proxy or challenge interaction. Lifecycle steps and cleanup have bounded deadlines, and late resources are closed. Cleanup failure prevents PASS. The offline probe's terminal watchdog does not itself prove cleanup. Official references: [Browser](https://playwright.dev/docs/api/class-browser), [BrowserContext](https://playwright.dev/docs/api/class-browsercontext), [Route fetch](https://playwright.dev/docs/api/class-route#route-fetch). These API contracts do not prove Amazon compatibility.

## Availability, purchase mode and release date

Parser amazon-rendered-m5.4-v4 retains productState with independent availability, purchaseMode, optional releaseDate and bounded raw text. One confirmed ASIN/title is required. Challenge/access/mismatch outcomes have no product evidence.

| Evidence | Interpretation |
|---|---|
| Explicit ordinary available text + normal enabled purchase control | AVAILABLE + IMMEDIATE |
| Enabled reserve control + valid release statement, no unavailable/conflicting text | AVAILABLE + PREORDER |
| Explicit unavailable + preorder evidence | UNAVAILABLE + PREORDER |
| Explicit unavailable without action/mode evidence | UNAVAILABLE + UNKNOWN |
| Release statement without recorded reserve control | UNKNOWN availability + PREORDER |
| Conflicting reserve/normal controls | UNKNOWN purchaseMode |

Buttons support purchase-mode evidence, never seller approval or complete eligibility. The extractor reads labels/values/text only; it never clicks, fills or submits controls. Disabled controls and disabled ancestors are ignored. Contradictory availability stays UNKNOWN.

Spanish statements such as “Este producto saldrá a la venta el 13 de noviembre de 2026. Cómpralo en preventa ya.” normalize to 2026-11-13. V3 parses the complete date clause separately from trailing marketing text; v2 incorrectly required the whole string to end at the date. NFC and whitespace normalization accept canonical accents/NBSP without guessing mojibake. Calendar dates and leap years are validated without ambient time; malformed/conflicting dates stay UNKNOWN. The date is what the source states, not a promised delivery date or a fresh observation when replayed historically.

Current-price selectors include non-reference a-price regions and exclude a-text-price/list regions. V3 reads separate merchantInfo/fulfillerInfo feature values and semantic labels, with visible seller links in merchant regions. Hidden nodes and ambiguous combined sold-by/ships-from rows cannot establish a single identity. Bounded offerTexts preserve unmatched rendered region diagnostics. Generic third-party seller ID must come from a visible seller link. V4 additionally supports the narrowly scoped explicit Amazon Retail rule below; bare name/fulfillment alone cannot create an Offer. New selectors are authored-test qualified, not yet live qualified.

The raw amounts $589.00 and $1,099.00 already parse correctly; missing currency caused null normalized money in the Windows result. Money remains exact integer minor units with explicit currency; bare $ and the configured MX marketplace alone stay UNKNOWN. V3 also reads page price-currency metadata and standard JSON-LD Product/Offer metadata already in the response. JSON-LD must bind the confirmed ASIN and the displayed decimal-string amount. Numeric JSON prices, aggregate offers, unrelated products and mismatched amounts are not used. Scripts are never executed. With explicit MXN, the examples become 58900 and 109900 minor units. Currency conflict remains UNKNOWN. Fulfillment never approves a seller. Shipping, tax, condition, language/pack, exact quantity and purchase limits are not fabricated.

Fields are bounded to 500 characters and selector lists to 20 nodes; JSON-LD inspection is limited to 20 script nodes, at most 100,000 characters each, and 20 product/offer nodes per inspected collection; the response limit is 5 MiB after receipt, not a streaming-memory cap. No raw HTML, cookies, browser storage, profile data or authentication headers are retained. Diagnostics contain bounded public extraction text, parser/category/duration/completeness and counters.

## Product and Offer persistence

The live StoreInstance stays separate from fixtures. ASIN/product identity excludes time, price and tracking. The v2 mapper emits typed ProductPageObservation with product reference/title and independent availability, mode and release-date Evidence. These snapshots persist in existing SQLite v4 restock_samples/restock_scopes with PRODUCT_PAGE coverage. This describes a product page, not complete seller inventory. No schema migration or fabricated Offer/seller/fulfillment/price is needed.

Explicit product UNAVAILABLE establishes a baseline without an Offer. Known available/preorder state can likewise initialize. Unknown availability persists as INCOMPLETE with no comparable baseline, even when mode/date are known. Missing Offers alone never imply absence. The same product scope remains monitored when an Offer later appears.

Sufficient seller-specific identity still enables ordinary ListingObservation/catalog/coordinator persistence. Seller validation and Opportunity Engine run for that Offer. Without it, the result says no seller-specific evaluation occurred; product evidence is stored in restock tables, not invented catalog/listing rows. The validation policy approves no new sellers, uses unreviewed mapping, zero spend and unknown costs. Mapped Offers stay REVIEW_REQUIRED / INDETERMINATE / BLOCKED DRY_RUN. New PREORDER/UNKNOWN purchase modes also fail immediate-purchase admission. No preorder execution policy is introduced.

First comparable observations initialize without events. Fresh unavailable → available PREORDER emits PREORDER_OPENED; unavailable → available IMMEDIATE emits RESTOCK_DETECTED; open preorder → unavailable emits PREORDER_CLOSED; known PREORDER ↔ IMMEDIATE while available emits PURCHASE_MODE_CHANGED. Product signals request reevaluation only and do not approve a seller. Offer events retain existing seller gates. Unknown/partial/failure/stale inputs never manufacture absence. See [Restock Engine correction](RESTOCK_ENGINE.md#m54-three-state-correction).

Replay and receipts use existing SQLite transactions. Optional fields preserve old snapshot fingerprints. Three new event types extend the unchanged envelope; older binaries cannot be assumed to consume them. Each live invocation uses a fresh isolated database, then reopens/replays that same database; personal desktop data is untouched.

## V4 final Offer correction

Currency policy stays explicit: no hostname/$ default. V4 adds visible currency codes within current-price regions and visible priceCurrency microdata, retaining existing product meta and ASIN/amount-bound JSON-LD. Currency is resolved separately from amount parsing; malformed price can coexist with known currency. Missing/conflicting evidence remains UNKNOWN. New selectors use the same document and resource policy with no private endpoint or additional network access.

An explicit, independently labeled Vendedor / Vendido por / Sold by value of Amazon México can resolve the local identity amazon-retail-mx on an Amazon Mexico target with confirmed selected ASIN/offer region. It is a local scoped identity, not an Amazon merchant/API identifier. The label/value statement is retained in sellerStatements. Display-only Amazon México, Amazon-like names, combined Remitente / Vendedor text, contradictory seller statements, shipper-only evidence and conflicting external IDs cannot trigger the rule. Later appearance of an external link ID does not change a qualifying Retail identity; raw IDs remain evidence. Other sellers retain the normal stable-ID requirement. No seller approval is inferred.

Remitente / ships-from and Vendedor / sold-by are extracted from separately labeled rows, including visible label nodes and semantic attributes. Shipper statements remain independent of seller statements. Ambiguous duplicated names are never split positionally. Explicit third-party shipper display is retained even when the existing fulfillment classification must remain UNKNOWN.

New optional renderedEvidence is consumed by diagnostics, classification and evidence hashing. found.sellerDisplayFound versus sellerStableIdentityResolved, fulfillmentTextFound versus fulfillmentFound, and priceTextFound versus currencyResolved distinguish observation from resolution; legacy found.seller/fulfillment/price retain their meanings. Summaries also include rawPriceTexts, resolvedCurrency, sellerIdentityBasis, sellerStatements, shipperStatements, shipperDisplayEvidence and offerPersistenceReason.

Existing Offer invariants allow unknown optional monetary/fulfillment facts once identity is stable; these facts remain blocking for DRY_RUN eligibility. No mapping or schema rule was relaxed. Retail preorder/immediate fixtures persist/replay Offers and evaluations with REVIEW_REQUIRED / INDETERMINATE / BLOCKED. Overall harness PASS requires every expected observation to pass, so a later successful target cannot hide an earlier incomplete one. Missing normalized money keeps a mapped Offer PARTIAL.

## Historical correction evidence (superseded by closure)

The latest accepted run-GeQVbD used v3, with one HTTP 200 navigation/document request and two stylesheets per target, no detected challenge/denial and zero mutations. It blocked 280 requests. A has an UNAVAILABLE baseline; B is AVAILABLE/PREORDER/date 2026-11-13; C is AVAILABLE/IMMEDIATE. All three product snapshots persist/replay, with zero Offers/events.

B/C recorded $589.00/$1,099.00, Amazon México display and repeated combined Remitente / Vendedor text. No explicit currency or independent role statements were recorded. V4 historical replay keeps these monetary/identity/fulfillment gaps UNKNOWN, while exposing honest discovery flags and preserving all baselines. It does not retroactively add role evidence, refresh timestamps or claim new live navigation.

Historical v3 input and v4 reparse remain archived in outputs/M5_4_WINDOWS_V3_EVIDENCE.json and outputs/M5_4_FINAL_OFFER_REPLAY.json. The subsequent ordinary v4 run and final JS-enabled recon are now reviewed and closed with accepted limitations. No more extraction qualification is pending; raw missing facts remain UNKNOWN.

## M5.4A closed — accepted passive-network limitation

The final real Windows run completed three navigations with JS enabled and natural first-party POST JSON responses (A/B/C: 4/3/2). All nine responses were uninspected because DECLARED_LENGTH_UNKNOWN_OR_EMPTY failed the body cap qualification. No private semantic availability/buyability/price/currency/seller/fulfillment or availability lead was established. Rendered UI was earliest among qualified sources actually observed; this does not prove universal UI precedence. Grouped routing blocks do not prove offer-generation dependencies.

**M5.4A CLOSED — PARTIAL — ACCEPTED BROWSER LIMITATION. M5.4 CLOSED — PARTIAL — ACCEPTED BROWSER LIMITATION.** No more tuning or Amazon live navigation for these milestones. Diagnostic code remains opt-in but non-authoritative; no private API provider or endpoint dependency. [Final report](../outputs/M5_4A_FINAL_DEEP_REPORT.md), [actual evidence](../outputs/M5_4A_FINAL_WINDOWS_EVIDENCE.json).

Preserve product-level baselines, no fake Offer or first-observation restock/preorder event, seller/fulfillment separation, unknown monetary facts and durable restart/replay. Qualified UI/structured evidence can supply normalized observations; private hints cannot enter the durable engine as truth. No cart/backend implementation in closure.

650 deterministic tests and all normal quality gates pass. **READY FOR M5.5 — AMAZON BROWSER MONITORING INTEGRATION; NOT STARTED.** [Handoff](../outputs/M5_5_HANDOFF.md). Future backend-first cart/availability research is preserved explicitly under the later Execution Engine objective in ROADMAP, not this milestone.
