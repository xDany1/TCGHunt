# ADR-005 — Execution Safety Model

## Status

ACCEPTED for the design baseline. Classification: DECIDE NOW. Date: 2026-09-07. Real mutation feasibility is unvalidated and not authorized in this task.

## Context

The worst failure is an unintended, duplicate or over-budget purchase. Browser/network errors cannot establish whether a retailer accepted an order. A single procedural checkout service and a scattered dry-run boolean cannot reliably protect the irreversible boundary.

## Decision

Separate immutable opportunity evaluations, PurchaseIntent, CheckoutAttempt and Order lifecycles. Make one execution coordinator the sole authority. Admission transactionally reserves spend/quantity/count limits across local accounts and guards the canonical product commitment. Bind final approval to exact offer/seller/variant/quantity/account/profile, expiring total quote, policies and immutable mode. Persist and audit a one-use submission fence before any dispatch. Unknown outcomes freeze commitments and require authoritative reconciliation; no timeout-based retry or reservation release.

Phase 1 composes only read capabilities and SimulationExecutionPort and emits `PURCHASE_WOULD_HAVE_EXECUTED` after passing checks. It has no real cart, submission or order-writing path. `DRY_RUN=true` always forces safe mode; false does not grant live authority. Future LIVE requires an explicit audited local transition, eligible compiled capability, reviewed permission, fresh backend control/entitlement and all hard safeguards. Events/UI cannot bypass that gate.

## Alternatives Considered

* Scattered dry-run checks are easy to miss; composition plus final authority is stronger.
* Blind retries can duplicate orders; choose reconciliation and missed-purchase risk instead.
* Only an in-memory mutex cannot survive crashes or protect atomic budgets.
* Provider idempotency alone does not cover unsupported retailers, changed bodies, key expiry or multiple user intents.
* A distributed lock/service adds complexity before multi-device execution and cannot fence a retailer that ignores it.

## Consequences

Safety takes precedence over purchase speed. Crash after a fence but before send can create a blocked false uncertainty; this is accepted. Acknowledgement differs from confirmation. Manual retailer handoff cannot guarantee the user's final cost or automatic tracking. Local lease expiry never authorizes a replacement submission; previous executor termination and reconciliation are mandatory. Simulated limits/history are isolated from real consumption and cannot be upgraded to live work.

## Risks

Retailers may lack authoritative lookup/idempotency and therefore remain observe/assist only. Same-user malware, user manual purchases and multiple uncoordinated devices are outside the guarantee. Do not claim universal exactly-once behavior. S5 tests fault boundaries against a counting fake endpoint before any real mutation is considered.

## Future Impact and Migration Cost

VERY HIGH: changing commitment identity or state/ledger semantics after real purchases can require multiple months, manual reconciliation and user impact. Design these boundaries now. Multi-device live execution requires central reservation authority and explicit ownership fencing before enablement. Detailed persisted transitions and invariants are in [Domain model §§5–6](../DOMAIN_MODEL.md#5-state-machines-and-state-ownership).
