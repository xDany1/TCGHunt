# Amazon providers — M5.2

Status: **PASS for deterministic fixture architecture**, 2026-09-10. Live Amazon access remains unqualified. This document applies to the new provider path; the historical M5 SP-API experiment remains compatibility-only.

## Boundary and selection

```text
host composition: explicit provider + offline transport + clock + reviewed mapping
  AmazonObservationService (existing resolution/observation capabilities)
    AmazonProvider.read(target, context)
      BUSINESS_API: AmazonBusinessApiProvider -> injected fixture lookup
      BROWSER: AmazonBrowserProvider -> injected local HTML capture
    normalizeAmazon(provider evidence)
    mapAmazonDomain(normalized observation, delivery scope, optional review)
  existing coordinator -> seller/opportunity/rules -> SQLite/audit/outbox
```

All new implementation lives in `packages/adapters/src/amazon/providers/`. There is no new package, store registry, scheduler, database owner or execution engine. The host constructs exactly one provider. Configuration requires `provider: BUSINESS_API | BROWSER`, `marketplace: MX` and an explicit `deliveryScope`; omitted `networkEnabled` becomes false. True is rejected, including malformed runtime configuration. Provider/config mismatch is rejected. No provider registry iteration, automatic retry, silent fallback or browser launch exists.

The injected capture ports are data-only `FIXTURE_ONLY` boundaries. Business `lookup` returns separately identified product and offers responses; browser `readPage` returns authored HTML. They expose no credential, navigation, action or session methods. These interfaces do not sandbox arbitrary trusted injected code; this milestone supplies only local deterministic implementations. A future host transport requires separately authorized implementation and the existing infrastructure scheduling/isolation boundary. No live enable switch ships here.

## Evidence and normalization

Targets carry canonical Amazon URL, ten-character ASIN, MX marketplace and delivery/pricing context. Existing M5 URL validation strips tracking and rejects seller-selection parameters. No optional locale or buyer-profile implementation is introduced.

`AmazonProviderEvidence` contains ASIN, title, canonical URL, ASIN type, child ASINs, offer subset and capture source. No parent ID is guessed when only child/type information is available. Offers contain seller ID/name, fulfillment, source offer identifier, condition/subcondition, decimal/currency evidence, quoted shipping, availability text, featured evidence and optional button presence. Providers return facts, never seller approval or opportunity eligibility.

`NormalizedAmazonObservation` adds exact MXN Money, AVAILABLE/UNAVAILABLE/UNKNOWN, availability evidence quality, separately classified seller kind and field completeness. `source` retains provider, authored fixture ID, capture/observation times, parser version and AUTHORED_FIXTURE confidence. COMPLETE_FIELDS means the selected observation fields were supplied; it does not mean complete marketplace coverage, production validation or execution eligibility.

Coverage is OBSERVED_SUBSET, NO_OFFERS_IN_RESPONSE or UNKNOWN. Empty paginated/unspecified results do not prove marketplace-wide absence. Duplicate equivalent offers collapse; contradictory same-seller/condition/fulfillment offers reject with NORMALIZATION_FAILED instead of selecting a price. This deliberately limits ambiguous same-seller offers until future source evidence supports stronger identity rules.

Decimal money uses Node 24 JSON source lexemes and core integer arithmetic. Negative, unsupported precision or mismatched currency becomes unknown. Shipping remains a quote in the Amazon DTO. The domain receives UNKNOWN buyer shipping, additional tax, exact quantity and purchase limit; no selected delivery service or verified buyer context exists yet.

## Business API provider

The fixture parser consumes direct `ProductsResult` and `OffersResult` shapes: product ASIN/type/title/URL and variation children; offer merchant, fulfiller, condition, price, shipping options and featured offer. It uses the documented lowercase Business money shape and recognizes fulfillment disagreement. Product responses are not SP-API `payload` envelopes. It consumes a separate offers response rather than relying on conflicting documentation terminology for embedded offer facets. These choices follow the official [model](https://docs.business.amazon.com/docs/product-search-api-v1-model) and [reference](https://docs.business.amazon.com/docs/product-search-api-v1-reference), inspected 2026-09-10.

The fixture model includes legitimate field omissions and errors. It is a projection of fields consumed, not a full SDK/schema validator. Optional quantity, buying guidance, negotiated pricing and opaque purchase-oriented IDs do not establish execution authority. No auth, header construction, OAuth or HTTP implementation is present. The existing [M5 access study](AMAZON_INTEGRATION.md) remains the prerequisite for future official access.

The old `amazon/parser.ts` and `AmazonQualificationAdapter` remain explicitly documented SP-API qualification-only compatibility code. New providers do not import that parser or qualification adapter. Existing M5 tests and report are preserved.

## Browser provider

Fifteen authored `.html` files supply semantic metadata and labeled Offer regions, including reordered/nested alternate layouts. The parser uses `itemprop` or `aria-label`, not positional CSS paths. It records presence of a labeled purchase-option button without clicking it. That signal is never used for availability or approval.

This is a bounded authored HTML grammar, **not an HTML5 engine or a validated Amazon production selector set**. It accepts quoted attributes, balanced tags and common void elements, decodes a small named entity set, removes inert script/style/template/comment contents, and executes nothing. Limits: 100,000 characters, 5,000 tokens and nesting depth 32. Unsupported markup produces PARSER_MISMATCH; conflicting field values produce unknown evidence. It does not fetch linked assets or open a browser.

Challenges yield CHALLENGE_DETECTED before product extraction; access-denied and unavailable pages have separate outcomes. Detection is conservative and may flag benign challenge-related text. Nothing attempts to solve or bypass a challenge. Unsupported layouts, missing ASIN, network abstractions and incomplete evidence remain distinct diagnostics.

## Seller, availability and domain mapping

M5.4 v4 addendum: the rendered provider also recognizes local scoped identity amazon-retail-mx from explicit, independently labeled Amazon México seller-role evidence on a confirmed Amazon MX product/offer. This is not a guessed external API ID or a generic display-name mapping. Bare display text, Amazon fulfillment and ambiguous combined roles never qualify; third-party external-ID requirements remain unchanged. The optional renderedEvidence retains the rule basis and raw role/identity facts. AMAZON_RETAIL classification does not approve a seller. Currency still requires explicit page evidence, without a host/$ default. Existing Offer mapping, schema and capability ports are unchanged. See [final M5.4 rule](AMAZON_BROWSER_VALIDATION.md#v4-final-offer-correction). The following M5.2 fixture qualification remains historical evidence.

AMAZON_RETAIL classification requires independently reviewed seller IDs. A display name of Amazon or Amazon fulfillment does not establish retailer identity. Other identified merchants remain THIRD_PARTY; absent IDs remain UNKNOWN. Core SellerValidationEngine alone approves/rejects using existing policy. Tests demonstrate third-party FBA review, explicit approval and deny precedence.

Only exact authored phrases (`In stock`, `Disponible`, `Currently unavailable`, `No disponible`) and schema.org InStock/OutOfStock values yield known availability. All other language, lead-time and conflicting text stays UNKNOWN. This is fixture phrase qualification, not observed live Amazon stock semantics. No Restock Engine is introduced.

All M5.2 evidence uses dedicated SYNTHETIC StoreInstance `amazon-mx-m5.2-fixtures`, separate from M5 and future live stores. ASIN identifies StoreProduct; `singleton:ASIN` identifies Variant; `detail:ASIN` identifies Listing. Offer identity includes ASIN, seller, fulfillment, raw condition/subcondition, reviewed sealed condition and explicit pricing/delivery scope. It excludes provider, current price, time and featured state. Different customer contexts must use different scopes; Business and browser evidence are not equivalent merely because ASIN matches.

Source external offer IDs remain adapter evidence, not purchase tokens or the cross-provider durable key. Canonical identity/sealing requires separate reviewed mapping; title and API NEW cannot establish sealed packaging. Parent/unknown variant or missing seller yields no invented domain offer. Catalog-only absence remains an adapter finding; existing persistence has no absence-event entity. That is a known input to M5.3 planning, not a hidden database redesign.

## Durability, diagnostics and security

The existing coordinator persists normal ListingObservations, evaluates seller/opportunity/rules and commits BLOCKED DRY_RUN decisions. Existing Evidence.sourceId, sourceVersion, captureId and parserVersion retain provider/fixture provenance after SQLite reopen. Equivalent cross-provider reads share stable entities but create distinct attributable observations. Duplicate capture/replay produces no duplicate commitment or outbox effect. No schema migration is needed.

The service retains at most 100 structured diagnostics: provider, ASIN, start/end, category, normalized offer count, completeness, challenge/parse/auth/timeout flags and typed error class. It uses an injected clock and discards late/cancelled results. Raw responses, unknown payload fields and exception messages are not diagnostic fields. Provider failures are auditable here; full catalog-only failure history is not added to SQLite.

There are no cart, checkout, order, payment, login, session, credential extraction, personal-profile, hidden endpoint or evasion capabilities in this implementation. Source tests enforce no browser/network/action imports. ADR-002 and ADR-004 already cover capability separation and capture/parse/normalize isolation; their statuses and ADR-001 remain unchanged.
