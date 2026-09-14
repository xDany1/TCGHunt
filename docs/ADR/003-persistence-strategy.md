# ADR-003 — Persistence Strategy

## Status

ACCEPTED for local ownership, transactions and repository boundaries: DECIDE NOW. Drizzle/native-driver selection remains EXPERIMENT FIRST pending S2. Date: 2026-09-07.

## Context

The application needs durable observations and recoverable decisions, not just cached UI state. Duplicate prevention and spend limits require atomic admission across concurrent monitors/accounts. The database is local; later backend data has distinct ownership.

## Decision

Use one local SQLite database with a single write-owning coordinator, explicit integrity constraints and short transactions. Persist intent/attempt state, reservations, audit and critical event outbox atomically. Keep immutable typed ListingObservation/evaluation history; use indexed common fields and bounded versioned extensions. Use aggregate-specific repository ports and application query services. Prefer Drizzle with an Electron-compatible driver after packaged/crash/backup tests. PostgreSQL is reserved for the future backend, not a network replacement for the desktop file.

## Alternatives Considered

* JSON files/in-memory state cannot safely coordinate reservations/recovery.
* PostgreSQL from personal V1 adds administration and availability dependencies without demonstrated value.
* Prisma is a valid SQLite ORM, with a different generated-client/schema workflow; it does not remove concurrency/data migration decisions.
* Plain SQL is a viable fallback; explicit transaction correctness matters more than ORM choice.
* Generic CRUD repositories conceal critical transactional operations; separate histories for every observed field duplicate capture semantics prematurely.

## Consequences

SQLite provides simple local deployment; a serialized writer bounds throughput but fits expected desktop use. Proposed WAL plus durable critical-write settings need verification on the chosen SQLite version/driver. Use a consistent backup API, never copy only an active DB file. Keep ORM types out of domain code. Source retention restrictions may require earlier deletion or rejection of a data source; immutable does not mean unlimited retention.

## Risks

Native module packaging, disk full, long transactions, unbounded history, backup rollback and false assumptions about ORM portability. S2 must exercise atomic competing reservations, crash reopen and backup. Restores disable execution and require reconciliation. Backend sync and tenant authority are deferred, not solved by repositories.

## Future Impact and Migration Cost

HIGH for persistence ownership/history semantics (1–3 engineer-months plus data work). MEDIUM for replacing the mapper behind well-tested specific repositories (roughly 1–3 weeks initially). Multi-device/cloud ownership changes can be VERY HIGH; they require an explicit protocol. See [SQLite WAL](https://www.sqlite.org/wal.html), [backup](https://sqlite.org/backup.html) and [Drizzle transactions](https://orm.drizzle.team/docs/transactions) for underlying mechanisms; the ownership policy is this project's decision.

## M2 evidence — 2026-09-07

The non-Electron durable slice uses explicit SQL with the installed Node 24.19.0 `node:sqlite` driver (SQLite 3.53.3). No new third-party runtime dependency was required. This exercises the plain-SQL fallback above while retaining application-owned, intent-specific repository contracts. Core algorithms and application contracts contain no SQLite types. Drizzle has not been evaluated; its preference and the final packaged driver decision remain EXPERIMENT FIRST.

Actual file-backed tests verified foreign keys, unique constraints, state/version triggers, WAL and synchronous=FULL; atomic simulated intent/reservation/attempt/audit/outbox commits; bounded SQLite writer contention with two worker connections; no uncommitted facts visible to a WAL reader; process exit before commit and after commit; audit INSERT failure; restart and duplicate-operation protection; and at-least-once outbox replay with atomic consumer effect/receipt. Bigint money and unavailable ratios round-trip through bounded, version-1 snapshots. Separate tests verify UTC daily boundaries, campaign quantity, preserved consumption on policy changes and clock rollback rejection.

The SQLite backup API produced a consistent snapshot from an open WAL database. A durable recovery marker is set before backup and copied with the snapshot; a normal open of that snapshot still disables writes. Successful backup clears the source marker; failure leaves it quarantined for inspection. Missing critical audit/ledger state and unsupported/corrupt schema fail without data reset. There is no automatic restoration of execution authority.

The complete suite passes 103 tests, including the unchanged 50 M1 tests, plus strict typecheck/build, lint and formatting. This validates the local M2 transaction/recovery candidate only. Electron packaging/ABI/runtime support, Drizzle comparison, hardware power interruption, physical disk-full behavior, ACLs and production performance remain untested. S2 has relevant local evidence; S1 and the remaining S2 qualification are not declared complete. No experimental ADR status is promoted by this result.
