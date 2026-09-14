# ADR-004 — Browser Automation Strategy

## Status

ACCEPTED for HTTP-first and isolation boundaries: DECIDE NOW. Specific browser/session packaging and store feasibility: EXPERIMENT FIRST. Date: 2026-09-07.

## Context

Many monitors must not create hundreds of browsers. Authenticated contexts contain valuable credentials; browser availability does not establish permission to automate a retailer. Page and response formats will change.

## Decision

Prefer documented, authorized HTTP/API reads. Use Playwright only for a demonstrated legitimate browser requirement, through a bounded BrowserSessionPort owned by infrastructure. Separate capture, parsing, normalization and business validation. Reuse anonymous browsers with isolated read contexts; isolate store-account sessions and serialize account mutations. Never attach to the user's ordinary browser profile. No privileged store webview, public CDP port, CAPTCHA bypass, fingerprint spoofing, account/proxy rotation or rate-limit evasion.

## Alternatives Considered

* Playwright for every read: uniform tool, excessive resource/selector maintenance and credential exposure.
* Browser per monitor: simple isolation, unbounded memory and launch cost.
* Share a context across accounts: cheaper but unacceptable auth/pricing/cart leakage.
* Pure HTTP for every capability: cannot represent legitimate browser-only auth/preparation; allow optional browser capability instead.

## Consequences

NetworkManager supplies rate-aware scheduling, pooling and bounded safe retries; adapters define operation semantics. Browser manager owns quotas, leases, idle cleanup, login/session lifecycle and crash reporting. Account context restoration is optional and must be proven safe; memory-only sessions are acceptable. Playwright supports [isolated contexts](https://playwright.dev/docs/browser-contexts); this is session separation, not a sandbox against trusted-host compromise.

Keep selectors/parsers/fixtures adapter-local. DOM changes degrade the affected capability and produce typed errors. Unsupported or blocked automation falls back to permitted observation/manual navigation. No browser dependency needs to ship with an HTTP-only Phase 1 just to satisfy a stack preference.

## Risks

Browser crashes, session artifact leakage, inherited worker credentials, overly broad host permissions and misleading “healthy” status when only one capability works. Packaging/session/fairness spikes S1/S4/S6 validate boundaries. Every real store requires an independent permission/retention review.

## Future Impact and Migration Cost

MEDIUM (1–3 weeks initially) for swapping automation tooling behind the session port; HIGH after browser-specific authentication/preparation spreads. Preserving ports and parser separation reduces but does not eliminate migration. Per-account session ownership and permission boundaries should remain stable if anonymous discovery later moves to cloud.
