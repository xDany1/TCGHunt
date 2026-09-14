# M3 fixture access policy — authored-fixtures-v1

Date: 2026-09-08. Execution mode: **FIXTURE_ONLY**. This is an implementation/access record subordinate to the architecture and ADRs, not permission to contact a merchant.

## Source and authorization

No merchant authorization, approved live domain, API access grant or retailer response corpus was supplied. The M3 execution specification explicitly permits completing the controlled fixture implementation in that situation. This milestone uses newly authored synthetic payloads only. No actual retailer reads or live smoke tests occurred. Reading official Shopify documentation did not establish access rights to a merchant.

The test instance is `shopify-synthetic`, domain `merchant.invalid`, family Shopify, region unknown, and observed price currency supplied by each response. `fixture-merchant` is a configured synthetic identity, not a real seller endorsement. Access reference `authored-fixtures-v1`, retention `AUTHORED_SYNTHETIC`, rights `SYNTHETIC`, and commercial use `UNVALIDATED` travel with normalized metadata/evidence. No third-party catalog data was copied. Synthetic fixtures may be retained with the repository; no real-data retention or commercial-use permission is implied.

## Candidate interface and fixture conventions

The fixed read-only Storefront GraphQL `product(handle:)` query targets API version `2026-07` conceptually at `https://{approved-domain}/api/2026-07/graphql.json`. Only the concrete in-memory fixture transport is implemented. It does not perform an HTTP POST. The request fixes operation, query, endpoint shape and user-agent label, and has no token/header input or arbitrary URL transport.

Primary interface references: [product query](https://shopify.dev/docs/api/storefront/latest/queries/product) and [ProductVariant](https://shopify.dev/docs/api/storefront/latest/objects/ProductVariant). These explain the selected product/variant structure; they do not validate this merchant, permissions, inventory scope, tax treatment, full query execution or current payload compatibility.

`Sealed TCG` product type and `astra_m3.commercial_identity` metafield values are **authored fixture conventions**. They are not standard Shopify commercial identity guarantees. An authorized merchant would need independently reviewed structured facts or a reviewed mapping strategy. Titles, SKU resemblance and selected-option labels never establish canonical identity. Missing identity/condition stays unknown. More than 50 variants or a truncated connection is a typed failure; pagination is not silently approximated.

## Boundaries and retention

Only HTTPS product paths on the exact configured reserved `.invalid` host are accepted. Credentials, ports, unsafe/encoded paths, IP literals, other domains, unknown query parameters and all redirects are rejected. Harmless UTM parameters/fragments are removed from resolved references. Runtime configuration cannot switch to a live mode or domain. There is no network library, DNS lookup, browser or fallback scraping path. Consequently live TLS, DNS rebinding defenses and streaming body enforcement have not been qualified.

Capture bodies are bounded to 65,536 UTF-8 bytes before parsing. Raw bodies stay inside the adapter and fixture transport; only normalized observations, catalog metadata and safe typed error codes enter existing repositories. Hostile titles are retained as bounded plain data, never executed; any future renderer must escape them. Diagnostics exclude body fragments, source URLs, headers, GraphQL messages and titles. Context IDs must be bounded safe identifiers or are redacted. Logs keep at most 100 entries in memory.

One host-owned scheduler serializes each store's resolution and observation together, maintains minimum spacing and a queue bound of 64, and accepts at most three attempts. Transient/429 failures defer a durable next-allowed time; explicit blocking/auth failures close the durable circuit. No automatic unblock or catch-up polling loop exists. Health starts unprobed on restart; persisted failed runs and quota policy remain inspectable.

## Real-access gate

Before real data can be claimed, obtain a specific merchant's access and data-rights evidence, review its exact endpoint and field availability, qualify a bounded HTTP transport including DNS/TLS/redirect/stream cancellation controls, and collect attributable captures with approved retention. Then run a separate optional read-only smoke test outside deterministic CI. Fixture success is insufficient to accept the real-data gate or move to M4.
