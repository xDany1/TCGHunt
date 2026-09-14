# ADR-006 — Secret Storage and Data Locality

## Status

ACCEPTED for locality/minimization and broker boundary: DECIDE NOW. Windows implementation/session restore must pass S4: EXPERIMENT FIRST. Date: 2026-09-07.

## Context

Retailer sessions may authorize purchases. Accounts, credentials, browser state and auth health are distinct. Commercial license/payment-provider secrets are unrelated to retailer sessions and do not belong in a shipped desktop binary.

## Decision

Define a narrow host-side SecretStore broker using opaque purpose/account-bound references. Prefer supported OS protection on Windows via Electron safeStorage with restricted local encrypted blobs, subject to packaged validation. Never fall back to plaintext. Use memory-only sessions by default; persist only required protected session material after testing. Prefer retailer-stored payment/address references; never store CVV/PAN and avoid retailer password collection. Encrypt necessary local address/contact payloads.

Keep retailer account/session credentials local; licensing backend receives no retailer sessions. Backend alone holds billing/webhook/provider server secrets and private license/policy/update signing keys. Desktop carries public verification material and scoped revocable device/access credentials. Renderer sees masked labels and references, not reusable secret bytes.

## Alternatives Considered

* Plain configuration/SQLite values are unacceptable for reusable secrets.
* A cross-platform secret plugin or direct Windows credential API may be viable if packaging/security evidence beats safeStorage; retain the port.
* Full database encryption protects more metadata but adds key/packaging/recovery complexity and cannot defeat active same-user malware. Defer it; sensitive payload protection is not deferred.
* Uploading retailer credentials centralizes breach impact and is unnecessary for licensing.

## Consequences

The host grants only the session material needed by an authorized worker for its account/job. No general decrypt IPC is exposed to UI/adapters. Log/error/capture/export redaction is centralized. Normal backups exclude usable secrets; restored data starts safe and requires reauthentication/reconciliation. OS-bound key loss is a recoverable login event, not a reason to persist plaintext recovery copies.

## Risks

Windows DPAPI-backed protection does not protect against other applications running as the same user; decrypted material also exists transiently in memory. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). Browser storage, crash dumps and recordings can bypass a good secret abstraction unless explicitly controlled. S4 tests cross-account/session separation and disk artifacts; no claim of same-user malware immunity is permitted.

## Future Impact and Migration Cost

HIGH for reversing data locality or session identity after users connect accounts, including user reauthentication and revised data policies. Replacing the broker implementation is MEDIUM initially if encrypted records are versioned; some material may be intentionally non-migratable. Cloud discovery should not require moving local retailer sessions. See [Threat model](../THREAT_MODEL.md) for residual risks and controls.
