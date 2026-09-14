# ADR-008 — Internal Event Model

## Status

ACCEPTED for the design baseline. Classification: DECIDE NOW. Date: 2026-09-07.

## Context

Discovery, analysis, notifications and execution need decoupling, but no current requirement justifies a distributed broker. An in-memory event bus alone loses work if a process dies between state commit and notification. Replaying events can also duplicate actions unless semantics are explicit.

## Decision

Use explicit versioned domain facts with in-process dispatch inside the coordinator. Persist critical pending events in a small SQLite outbox in the same transaction as state and audit. Consumers record `(handlerId, eventId)` receipts atomically with their resulting state. Best-effort UI refresh and metrics can remain ephemeral. Use direct application calls for ordered validation/admission, not an event choreography that implicitly submits orders.

## Alternatives Considered

* Direct calls only are simple but couple notification and downstream processing/recovery to every writer.
* In-memory bus only is suitable for cosmetic updates, not critical workflow delivery.
* Kafka/RabbitMQ/distributed messaging adds infrastructure without solving retailer side-effect idempotency.
* Event sourcing would add replay/schema/projection complexity; normal persisted aggregate state and immutable audit suffice.

## Consequences

Delivery is at least once, not exactly once. Events carry ID/type/schema version, aggregate identity/version, correlation/causation, timestamps and safe snapshot references. Consumers tolerate duplicates/out-of-order arrival, reject unknown incompatible versions, and bound poison-event retries with visible dead-letter handling. Per-aggregate versions are meaningful; no global order is promised.

Only facts after commit are dispatched. OpportunityDetected can notify or propose an intent but cannot directly invoke submission. A handler may transactionally schedule work; all external mutation still passes the execution fence. Notifications may duplicate if an external sink lacks idempotency; purchases must not. Audit and event outbox are separate concerns and retention lifecycles, even when committed together.

## Risks

Premature event proliferation, uncontrolled replay, stale event work acting on new policies, and outbox growth. Define only current workflow consumers in Phase 1, reference immutable inputs, deduplicate and reject obsolete revisions. Test commit-before-dispatch crash, consumer rollback, duplicate deliveries and restart. A restored database cannot replay live commands.

## Future Impact and Migration Cost

MEDIUM, approximately 1–3 engineer-weeks initially, to evolve transport if envelope and consumer idempotency remain stable. Cloud delivery adds authentication, tenant scoping, ordering and ownership concerns; it is not a broker swap alone. Reversal cost becomes HIGH if raw retailer payloads or implicit exactly-once assumptions escape into consumers. Event inventory and ownership are defined in [Domain model §7](../DOMAIN_MODEL.md#7-domain-events-and-delivery-ownership).


## M5.6 implementation evidence — 2026-09-12

Schema-v4 restock event envelopes now carry an optional versioned alert/financial-decision projection. It commits with sample/state/outbox and the existing product-monitor run/audit callback. Existing restock-local-inbox-v1 receipts own logical delivery; no duplicate store or execution callback. New fault tests prove transaction rollback, commit-before-delivery recovery and receipt-before-outbox-ack replay. Historical envelopes remain readable without invented projections. 722 tests and quality gates pass. Decision/status above are unchanged. [Report](../../outputs/M5_6_REPORT.md).
