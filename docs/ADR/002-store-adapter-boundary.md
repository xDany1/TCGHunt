# ADR-002 — Store Adapter and Domain Boundary

## M5.5 application, not vendor-core, extension

2026-09-12: product-level desktop monitoring now has a typed ProductMonitorConfiguration without offerRef. This is required when product availability exists but seller-specific Offer identity does not, and applies independently of store. It consumes the existing ProductPageObservation/Restock Engine and adds no store-specific reducer or core URL/selector knowledge. The desktop composition explicitly selects AmazonBrowserProvider; the adapter worker owns the ordinary M5.4 transport. No Business fallback, private provider or execution transport is added. The existing offer coordinator remains the separate simulation path and rejects product configurations. Status/decision below are unchanged; M5.5 is PASS with the accepted bounded Windows monitoring result; no architecture decision changes at closure.

## Status

ACCEPTED for the documentation baseline. Classification: DECIDE NOW. Date: 2026-09-07.

## Context

Amazon, Mercado Libre and Walmart expose marketplace seller/fulfillment distinctions; Shopify represents independent merchants. A giant search-to-confirm interface would either force unsupported operations or leak store conditionals into the core. Conflating product, variant, listing and offer would corrupt matching, history and execution approval.

## Decision

Use a desktop modular monolith with separate Discovery, Opportunity and Execution modules. Register per-instance adapter descriptors and optional read, seller-evidence, quote, cart, preparation, submission and reconciliation capabilities. Core owns canonical/variant/listing/offer/seller semantics and immutable evidence. Adapters capture, parse and normalize facts; seller/rule engines decide approval. Access permission and technical support remain separate dimensions. Keep a single execution owner until shared authority is designed.

## Alternatives Considered

* Monolithic StoreAdapter: easy initial discovery but forces stub checkout methods and store switches.
* Store-specific end-to-end workflows: quick prototype, expensive duplication of safety/monitoring/UI.
* Plugin-loaded executable integrations: extensible but expands supply-chain and privilege risk prematurely.
* Microservices per engine/store: operational overhead without current scaling need.
* One ProductListing identity: simple schema, unsafe when seller/variant changes under a URL.

## Consequences

Recommendation protects the expensive identity and dependency boundaries while allowing one adapter implementation initially. Optional capabilities make degraded/observe-only integrations useful. Use coherent offer snapshots rather than forcing independent price/stock reads. Exact canonical mapping may remain manual; unresolved facts block acquisition decisions. Typed interfaces add mapping work and tests but prevent broad rewrites later.

Adding stores normally changes adapter/configuration/fixtures/registration only. New domain concepts may require reviewed contract evolution; never hide semantic gaps in untyped core-consumed JSON. Future cloud work can reuse public contracts without turning each domain into a service.

## Risks

Over-fragmented ports and a lowest-common-denominator contract. Mitigate with FakeStoreAdapter, one cooperative Shopify merchant and then an authorized marketplace to prove multiple offers/sellers. Keep capabilities few and cohesive; no compulsory unsupported methods. Vendor access is still unvalidated and cannot be granted by this architectural decision.

## Future Impact and Migration Cost

HIGH for changing dependency/capability boundaries, approximately 1–3 engineer-months once adapters proliferate. Identity conflation would be VERY HIGH, multiple months plus remapping user history, rules and orders. Alternative identity separation is selected now because later migration may be lossy. Definitions and invariants are maintained in [Domain model](../DOMAIN_MODEL.md).
