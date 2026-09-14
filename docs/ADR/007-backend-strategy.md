# ADR-007 — Backend Introduction Strategy

## Status

ACCEPTED for timing and authority boundaries: DECIDE NOW. Backend and billing implementation: DEFER to Phase 3, or earlier if live submission is proposed. Date: 2026-09-07.

## Context

A personal read/dry-run desktop can validate value without a service. Paid subscriptions, device management and remote disabling need trustworthy backend authority. A local licensed=true setting cannot provide that authority; offline clients cannot receive immediate revocation.

## Decision

Use desktop-only Phase 1 with no real mutation path. Define EntitlementProvider and IntegrationPolicyProvider at the application edge; a personal-build provider supports only the safe development scope and is not a commercial bypass. Introduce one modular backend with PostgreSQL before paid beta or any live submission. It owns customers/users, licenses, subscriptions, device slots, signed entitlement/control leases and release metadata. Keep licensing out of domain calculations and retailer adapters.

## Alternatives Considered

* Desktop-only forever: simplest operations, unsuitable for reliable paid access/control.
* Minimal backend from V1: earlier remote disabling, but auth/operations and availability obligations arrive before core value is demonstrated.
* Separate billing/license/config microservices: unnecessary deployment and consistency complexity.

## Consequences

Personal Phase 1 has no remote kill switch; this is acceptable only within its safe scope. Commercial offline monitor access uses a signed device-scoped lease, proposed maximum 24 hours since successful validation and never past paid-through/lease expiry. New automatic checkout always requires online authority and fresh restrictive policy; offline grace does not grant it. Feature flags cannot upgrade compiled capabilities or DRY_RUN. UI, renewal, history/export and safe reconciliation remain available when monitoring access expires.

Model subscription provider status separately from license access, including paid-through cancellation. Backend verifies/deduplicates billing events and reconciles authoritative state; event ordering is not assumed. Device activation is rate-limited and slot allocation transactional. High-entropy activation keys are stored as verifiers, not logged credentials.

## Risks

Added future deployment/security work, customer impact from service outages, limited offline revocation and clock manipulation. A hostile patched desktop cannot be fully controlled. Signed policy/lease version, expiry, audience/device scope and key rotation are mandatory. Store credentials must not be uploaded as a shortcut. Stripe remains a recommended candidate pending commercial vendor selection.

## Future Impact and Migration Cost

HIGH, roughly 1–3 engineer-months for commercial auth/control integration and operational readiness after the safe slice. Moving live purchase authority across devices can be VERY HIGH and requires a shared ledger/ownership design, not generic sync. Ports reduce licensing leakage but do not make this migration free. Refer to [Architecture §15](../ARCHITECTURE.md#15-security-and-commercial-control-backend) for outage/flag semantics.
