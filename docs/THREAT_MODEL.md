# V1 threat model

Review date: 2026-09-07. Scope: personal Windows desktop, approved observation sources, local persisted decisions, simulation-only execution. Future assisted/live and commercial controls are included where a V1 boundary must anticipate them. This is a design review, not a penetration-test result.

## 1. Assets, actors, and assumptions

Assets: retailer accounts/sessions, optional minimal addresses/contact details, local purchase policies and budgets, catalog mappings and seller approvals, observations and valuation evidence, audit/intent/order history, license/device credentials, backend signing/billing secrets, installed binaries, release artifacts and user trust in what a “purchase” means.

Actors: legitimate local user; other users of the same Windows machine; malicious website/seller or compromised retailer; attacker controlling a network/proxy; malicious same-user process; compromised dependency/build/release operator; abusive commercial customer; and non-malicious operator mistakes. Retailer and billing APIs can also fail or return inconsistent information without an attacker.

Assume supported patched Windows and runtime, functioning OS user separation, legitimate authorization to access a configured source, and first-party-reviewed adapter code. Do not assume the renderer, store content, imported configuration, raw responses or external identifiers are trustworthy. A local administrator or malware in the same user session can defeat significant desktop controls; the product cannot guarantee protection from that actor.

## 2. Trust boundaries and attack surfaces

| Boundary | Crossing data / surface | Required control |
|---|---|---|
| TB1 Renderer → preload/main | IPC command names, IDs, filters, profile edits, external navigation | Narrow named commands, runtime schema and sender/frame checks, ownership and size/rate limits. No arbitrary bridge. |
| TB2 Host → coordinator | Application commands, shutdown/recovery, safe OS-service requests | Private process messaging, version handshake, command authorization; one coordinator owns writes. |
| TB3 Coordinator → adapter worker/browser | URLs, capability jobs, opaque session grants, future execution permit | Registered capability/host constraints, bounded jobs, per-account binding, no DB handle/general secret access. |
| TB4 Worker/browser → retailer/network | HTTPS requests, redirects, DOM, scripts, downloaded content | TLS, DNS/redirect/host validation, browser sandbox, no privileged app bridge, no arbitrary downloads. |
| TB5 Host → OS protection/files | Secret wrapping, encrypted blobs, SQLite/WAL, captures/backups | Restrictive permissions, no plaintext fallback, protected sensitive payloads, consistent backup and recovery mode. |
| TB6 Desktop → commercial backend, future | Device activation, access tokens, leases, flags, release metadata | Authenticated HTTPS, device/user scope, signature/expiry/version verification, minimal data. |
| TB7 Backend → billing/provider, future | Webhooks, subscription state, server credentials | Signature verification, deduplication/reconciliation, server-only keys and least privilege. |
| TB8 Build/signing → updater → runtime | Dependencies, artifacts, manifests, migrations | Locked/reviewed dependencies, isolated signing, signed artifacts/metadata, staged update and rollback policy. |

An Electron utility process or Node adapter worker is a crash-containment boundary, not an OS security sandbox against arbitrary native code. Tauri capabilities can narrow frontend access, but a privileged custom command/Node sidecar still belongs to the trusted computing base. Browser contexts separate session state, not compromised same-process code. The architecture must not exaggerate these protections.

## 3. Threats, mitigations, residual risk, and verification

| Threat / severity | Likely scenario | Mitigation / owner | Residual risk / planned verification |
|---|---|---|---|
| T1 IPC privilege escalation — critical | Store title renders executable markup; compromised renderer asks main to run a script or buy | Local-only renderer, escaped text, CSP, sandbox/context isolation, no Node; main validates sender and narrow DTOs; no store page in privileged window | Runtime vulnerabilities remain. E2E hostile strings, unexpected subframes, path/URL/command fuzz inputs. |
| T2 Session theft — critical | Raw storageState, trace, HAR or browser profile exposes retailer login | Secret broker encrypts necessary reusable state; memory-first sessions; separate account contexts, no ordinary user profile; recording off | Active session is visible to its authorized worker and same-user malware. Disk/log scan and cross-account isolation tests. |
| T3 Local database tampering/theft — high | Another process reads history, changes approvals or copies an old DB | OS ACLs; encrypt necessary PII fields; backend remains entitlement authority; restore/import disables execution; no secrets in ordinary rows | Local admin/same-user compromise can rewrite data and code. Do not call audit tamper-proof. Tamper/recovery tests verify fail-safe behavior for accidental corruption. |
| T4 Credential extraction — critical | Desktop ships Stripe, provider server or license signing secrets | Backend-only signing/billing secrets; public client auth; OS wrapping for local references; no password collection by default | Reverse engineering exposes any shipped secret. Artifact inspection and secret scanning before release. |
| T5 Malicious store content / SSRF — high | User enters loopback URL, redirect reaches private service, image loads credential URL | Only reviewed HTTPS origins; reject embedded credentials, unsafe schemes/ports, private/loopback/link-local addresses; validate DNS/redirect destinations for HTTP and browser navigation/subresources as applicable | DNS rebinding and browser network behavior need integration tests. Fail closed on unverifiable destination; avoid generic URL fetch tools. |
| T6 Seller impersonation or variant substitution — critical | Familiar seller name, marketplace fulfillment badge, or bundle image disguises another seller/product | Store-scoped stable seller/variant identities, first-party evidence, deny precedence, quote binding/revalidation | Retailer data can be wrong; approved seller not authenticity guarantee. Fixtures for deceptive names, seller switches and pack-size mismatches. |
| T7 Duplicate/over-budget order — critical, future | Retry after timeout; two monitors/accounts pass stale budget read | Single-owner coordinator, atomic reservations/guards, persisted fence, one-use permit, uncertainty hold and reconciliation | Retailer may lack idempotency; user may buy manually. Crash/interleaving tests against a counting fake endpoint. |
| T8 DRY_RUN bypass — critical | Imported setting false, queued job after mode change, generic browser click reaches buy | Phase 1 read-only adapter composition, no live executor/mutation transport; immutable intent mode; later sole gate and non-upgradable permits | Malicious installed code bypasses app policy. Assert zero mutation requests under forced mode/IPC/event inputs. |
| T9 Supply-chain compromise — critical | Package/postinstall or adapter update executes with user privilege | Minimal dependencies, locked versions, review new dependencies/scripts, license/security scans, pinned CI actions, no remote executable adapters | Trusted release/build compromise remains. SBOM/reproducible provenance where practical before paid beta. |
| T10 Update compromise/rollback — critical | Forged manifest installs code or older vulnerable build opens new schema | Authenticated signed release metadata + platform code signing; monotonic/minimum versions; staged rollout; signed emergency recovery path; safe migration backup | Signing-key compromise or same-user patching remains. Test corrupted artifact, wrong key, stale release, interrupted update and database compatibility. |
| T11 License replay/abuse — medium | Copied activation key, clock rollback, cloned device token | Backend atomic device slots, high-entropy keys, rate limits, scoped short leases, revocation and rollback detection | Offline grace delays revocation; hostile desktop patches cannot be fully prevented. Simulate expiry, outage, slot races and token scope mismatch. |
| T12 PII/secret logging — high | Error object dumps request headers, full URLs, address or checkout URL | Central allowlist serializers and redaction before every sink, bounded safe error context, masked UI, export review | Redaction may miss new fields. Canary-secret fixtures scan logs, audit, notifications and exports. |
| T13 Resource exhaustion — medium | Many monitors or oversized pages exhaust RAM/disk, starving reconciliation | Queue/response/body/context caps, fairness, timeout budgets, parser limits, disk watermarks, critical-work priority | Provider outages still delay work. Sustained fake load and disk-full tests. |
| T14 Poisoned valuation — high | Old asking price used as sold-price benchmark produces false ROI | Price-kind/unit/market mapping, timestamps, completeness gates, immutable scenarios and source quality | Future resale is uncertain. Known arithmetic and mismatched-unit fixtures; user sees assumptions. |
| T15 Compromised/replayed remote flags — high, future | Old allow flag revives disabled checkout; arbitrary remote content becomes code | Signed scoped policy, expiry/version monotonicity, safe defaults; flags only restrict capabilities and cannot enable LIVE | Offline revocation latency persists. Wrong signature, expired policy and downgrade tests. |
| T16 Payment webhook fraud/order — high, future | Forged or repeated payment event activates license twice or reverses expiry | Verify raw-body signatures, dedupe IDs, reconcile authoritative subscription; idempotent state updates | Provider outage delays correct access state. Signed fake event replay and reordering tests. |

Electron hardening follows the relevant platform [security guidance](https://www.electronjs.org/docs/latest/tutorial/security). Windows secret-protection limitations are documented by [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). These are technical sources; mitigation choices and severity ratings above are this project's design judgments.

## 4. Mandatory security invariants

These requirements apply at the application boundary and are mirrored in [Domain model §6](DOMAIN_MODEL.md#6-critical-invariants-and-concurrency-protocol):

1. Phase 1 cannot produce any real order or cart mutation. DRY_RUN absence/invalidity defaults safe; a license or feature flag cannot change its mode.
2. Unapproved sellers, unknown exact product/variant, incomplete/stale required quote, exceeded limits, invalid entitlement/policy or unresolved prior submission block automatic execution.
3. Only one authorized execution coordinator admits a purchase; spend/quantity reservation, state and audit commit before effect. No catch-all retry may bypass this.
4. Unknown external state is retained until reconciled, even through restart, expiry, user cancellation, midnight or a restored backup.
5. Store content has no app IPC, Node, arbitrary file access or authority to instruct the app. Renderer commands are untrusted until validated.
6. No PAN, CVV, reusable secrets, cookies, full tokens or unredacted PII appear in ordinary database rows, logs, events, exported diagnostics or notifications.
7. Server signing/billing/provider secrets never reside in desktop bundles. The backend never needs retailer sessions for licensing.
8. Remote configuration and user policy can only narrow compiled execution authority; unknown/expired control data disables risky actions.
9. CAPTCHA/antibot/rate restrictions cause pause or manual fallback, not evasion. Manual confirmation cannot legitimize an otherwise forbidden automated step.
10. License expiry and maintenance never hide history/renewal or prevent safe reconciliation of already uncertain orders.

## 5. Incident and recovery behavior

Suspicious seller/parser changes disable affected capability pending fixture review; other permitted observation capabilities can remain healthy. Secret/session exposure invalidates local references, closes related contexts, prompts retailer session revocation/reauthentication, and does not silently restore the exposed state. Database/audit failures stop new actions and preserve evidence; never recover by deleting the ledger. Store blocking pauses affected jobs and surfaces the policy reason.

Before updates, stop admitting new risky work, persist state, and preserve unknown attempts across version changes. Do not run a schema downgrade against a newer database; use a compatible forward repair or verified backup with mandatory reconciliation. Restoring a backup never restores authority to replay purchase jobs. Signing-key compromise requires a separately protected recovery trust path; design/test it before paid distribution, not an unsigned emergency download.

Residual risks accepted for personal Phase 1: no remote emergency disable, local malware/admin compromise, opportunistic reads lost during sleep, imperfect store evidence, unknown future resale value, and read capability loss if merchant access changes. Not accepted: plaintext session dumping, real checkout in dry-run, ambiguous auto-retries, hidden unknown costs, or silent loss of critical audit/state. Revisit the threat model when adding authenticated preparation, live submission, billing, remote updates, new country sites or cloud/multi-device ownership.
