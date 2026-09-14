# Kantocards M3.5 validation access record

Recorded before merchant requests, 2026-09-08.

- Merchant: Kantocards. Exact approved HTTPS host: `kantocards.com`.
- Authorization evidence: the user explicitly states merchant permission for limited read-only technical product validation, naming two product URLs. This record summarizes that attestation; it does not claim independent verification of a written merchant agreement.
- Permitted work: minimal product reads, normalized evidence persistence, identity/restart checks and local DRY_RUN evaluation. No cart/checkout mutations, orders, load testing or restriction bypass.
- Planned interface: tokenless Storefront GraphQL `2026-07`, fixed product-only query plus shop name/primary domain, POST `/api/2026-07/graphql.json`. No credentials, cookies, sessions or custom buyer-IP identity. Quantity and metafields requiring token access are omitted, never guessed.
- Product handles: `perfect-order-booster-pack-espanol`, `booster-astral-radiance-espanol`. Collection paths and `_pos`, `_fid`, `_ss` are locator/tracking details, not identity.
- Request budget: at most six requests; one at a time; minimum five-second start interval; 15-second deadline; no automatic retries; no redirect following. Stop on denial, blocking, throttling or unexpected sensitive data. Provider cadence beyond these conservative local limits is unknown.
- Retention: only the minimum normalized product/decision evidence needed for this expressly requested validation, its local database and sanitized report. No raw response files, cookies, tokens, private/customer fields or complete headers. Commercial use, redistribution and ongoing catalog retention are not granted by this task. Regression schemas should be newly authored from discovered shapes rather than copied full responses.
- Live enablement: explicit `SHOPIFY_LIVE_VALIDATION_ENABLED=1` and `SHOPIFY_STORE_DOMAIN=kantocards.com`; disabled by default and excluded from CI. No token configuration is needed for this planned tokenless path. If access requires credentials, stop rather than collect/extract credentials or try another route.
- PASS: authorized real IDs/price/currency/availability/merchant evidence traverses the existing M2 persistence and DRY_RUN path; unknowns remain unknown; repeats/reopen/dedup and audit/outbox hold; deterministic regressions pass. An explained blocked acquisition is acceptable.
- BLOCKED_BY_ACCESS: required credentials, explicit denial/rate block, prohibited redirect, or execution environment unable to reach the approved endpoint. Do not substitute a random store or browser.

The original M3 fixture policy remains valid for synthetic tests. This separately authorized validation does not promote experimental desktop, secret, backend or browser ADRs, nor authorize M4 implementation.

## Initial execution outcome — historical, 2026-09-08

Two manually invoked attempts were made to the primary product's fixed GraphQL query; neither received an HTTP response. The initial diagnostic lacked a cause code. A second, instrumented attempt reported `NETWORK_UNAVAILABLE` with local cause `EACCES`. This is a local network-operation permission failure, not evidence that the merchant denied access or that Shopify requires a token. No alternative host, proxy, browser, endpoint or privilege escalation was attempted. Live validation stopped.

At that time M3.5 was BLOCKED_BY_ACCESS, with no real product evidence retained. The initial preflight intentionally returned PARTIAL on parse success, pending durable integration.

## User-supplied authorized success and continuation — 2026-09-09

The user reports running that preflight successfully from their local Windows machine and explicitly instructs us to treat its supplied JSON as real M3.5 evidence. It records one primary-product POST, HTTP 200, served API 2026-07, JSON UTF-8, 607 bytes, product `9600895451379`, variant `49183411208435`, start `1788935699868` and receipt `1788935700090`. No token was used by the preflight. No deprecated/version warning or rate-limit metadata was reported. This resolves basic read-access uncertainty for that query at that time; the omitted body still prevents validation of actual price, currency, availability, SKU and returned merchant identity.

This continuation makes zero new network requests. It retains the exact sanitized summary, normalizes only the reported IDs/times, marks every omitted commercial field UNKNOWN, and exercises existing M2 persistence/seller/opportunity/DRY_RUN/audit/outbox paths. Summary provenance is explicit and never claims a captured-body hash. Current status is PARTIAL, NOT READY FOR M4.

The updated opt-in script is ready for the remaining validation on the user's authorized network-enabled machine. Its continuation budget is **four additional requests maximum**, primary twice and secondary twice, at least five seconds apart. Historical agent failures and the user's one successful preflight are recorded separately; do not repeatedly invoke the script or add automatic retries. All approved host/query, deadline, body-size, redaction, retention and stop rules above continue to apply. No cart, checkout or order endpoint will be used.

The expected fields and full PASS gate are unchanged. A fresh complete capture must pass the existing parser, exact configured shop name/domain check, price/currency/availability checks, M2 persistence, seller evaluation, truthful blocked DRY_RUN decision, repeat/reopen/dedup and audit/outbox assertions. Unknown mapping, quantity, shipping, taxes and benchmark remain unknown. This script saves only sanitized normalized findings; it never saves the raw response. At this historical stage, full live PASS remained unobserved. No architecture/ADR status was promoted by preparing this tool.

## Full user-run qualification, inspected during M4 — 2026-09-09

`outputs/M3_5_LIVE_RESULT.json` now records PASS with the four authorized continuation reads: primary twice, secondary twice, all HTTP 200 at the fixed 2026-07 endpoint. The associated SQLite database independently confirms two stable product/variant/listing/offer identities, one StoreInstance/seller, four observations/evaluations, two BLOCKED intents and exactly two delivered notification receipts. The current `outputs/M3_5_REPORT.md` addendum records the observed prices/SKU/availability and identity findings. This clears the M3.5 gate without broadening authorization.

M4 used a read-only connection and consistent local copy to verify the evidence; it made zero additional retailer requests. The desktop retains explicit host opt-in, exact approved URLs, a persisted six-attempt local validation budget and the existing transport's bounds. A per-database counter is an operational guard, not permission to create new databases to extend merchant authorization. The planned single M4 network smoke was withheld after packaged Electron failed its local runtime qualification. Any eventual M4 smoke remains limited to the previously authorized read-only scope.
