# SimpleLife — Phase Execution Playbook

**Status:** approved execution standard for future phases  
**Baseline:** `main` at `45e49c40e2a04d8c06c2c583ff14e6b4d8dfcc13`  
**Date:** 20 November 2026

## 1. Purpose

SimpleLife will be developed as a sequence of complete product phases. A phase is a coherent capability that a user can understand, use, verify and recover—not a collection of disconnected UI patches.

This playbook complements, but does not replace, the product vision and roadmap in ChatBending (Master page, Anexo 141). It does not certify functionality as implemented.

## 2. Delivery rules

1. One active phase at a time. Keep unrelated product work out of its branch and pull request.
2. Start with evidence: inspect the current implementation, data model, grants/RLS, user flows and tests before changing them.
3. Define the phase contract before implementation: objective, personas/use cases, inputs, outputs, state transitions, permissions, dependencies, exclusions and acceptance criteria.
4. Implement vertical slices that are usable end-to-end; avoid empty scaffolding and broad rewrites.
5. Preserve current behavior while extracting shared architecture. Refactors must be incremental and covered by regression tests.
6. A successful CI run proves only the checks it actually executed. Mocked E2E is not real Supabase persistence; a deploy is not proof of user-visible behavior.
7. Do not use a global completion percentage. Report status per capability and per validation gate.
8. Do not start the next phase until the current phase is closed or its explicitly accepted open items are isolated and documented.

## 3. Mandatory phase dossier

Every phase must have these artifacts before its first functional pull request:

- **Product contract:** what problem it solves, user journeys, in-scope and out-of-scope behavior.
- **Domain contract:** entities, relations, invariants, lifecycle/state transitions, timezone/date semantics and idempotency rules.
- **UX contract:** navigation, responsive views, forms, empty/loading/error states, accessibility and recovery actions.
- **Data contract:** source of truth, read/write paths, ownership, constraints, migration and rollback plan.
- **Security contract:** authenticated roles, row visibility, allowed operations, RLS/grants impact and audit requirements.
- **Integration contract:** dependencies, events, service boundaries and external-provider limits.
- **Verification matrix:** unit, component/domain, mocked E2E, real authenticated smoke where applicable, manual desktop/mobile checks and regression suites.
- **Release dossier:** exact branch, PR, merged SHA, CI links, migration references, version, manual result, known limitations and recovery/rollback notes.

If a requirement is still unclear, record it as **OPEN DESIGN DECISION** or **PROPOSED DEFAULT**. Do not silently turn it into a permanent product rule.

## 4. Status vocabulary

| Status | Meaning |
|---|---|
| DESIGNED | Product and technical contract documented; implementation not started. |
| IMPLEMENTED | Code exists in a branch or merged commit. |
| CI PASS | The recorded automated workflow passed at the recorded SHA. |
| MANUAL PASS | Robert exercised the specified real user flow and confirmed it. |
| PERSISTENCE PASS | The behavior was verified against the real authorized backend, not only mocks. |
| RELEASED | An explicitly approved target environment serves the exact verified SHA. |
| CLOSED | All mandatory phase gates are satisfied; residual limitations are recorded. |
| OPEN / BLOCKED | A required design, access, test or external action remains unresolved. |

Never infer one status from another.

## 5. Engineering baseline and module boundaries

The current client is JavaScript (ES modules), React 19 and Vite 8. Do not introduce TypeScript or a new framework merely for architectural appearance.

Before adding substantial new domains, progressively extract the oversized `src/App.jsx` into feature modules while preserving observable behavior. The target shape is a direction, not a command to generate empty folders:

- `src/app/`: application shell, navigation, providers and cross-feature composition.
- `src/features/<domain>/components/`: domain UI.
- `src/features/<domain>/hooks/`: feature state and orchestration.
- `src/features/<domain>/services/`: backend reads/writes and adapters.
- `src/features/<domain>/domain/`: pure business rules and validation.
- `src/shared/`: reusable primitives, date/time utilities and error handling.
- `src/lib/`: infrastructure clients and narrowly scoped shared services.

Extract one bounded area at a time. Keep data access out of presentational components. Domain functions should be testable without a browser or Supabase. Avoid a generic abstraction until at least two real consumers demonstrate the same need.

## 6. Testing and evidence gates

For every functional phase, select the tests that match its risk:

1. **Domain/unit:** date calculations, recurrence, conflict rules, state transitions, validation and idempotency.
2. **Client integration:** service/query behavior, ownership filters, error paths and empty data.
3. **Browser E2E:** real observable user journeys using deterministic mocks.
4. **Backend smoke:** a controlled, disposable authenticated test identity when the feature changes persisted behavior. Prove cleanup.
5. **Security:** verify owner isolation, least privilege, cross-account denial and allowed writes.
6. **Responsive/manual:** exercise the actual interface at desktop and mobile widths; physical-device checks where platform behavior matters.
7. **Regression:** auth, Today, Inbox, tasks, goals, projects, notes, lists, PWA update/cache and other affected areas.

The required CI sequence remains `npm ci`, `npm test`, `npm run test:e2e` and `npm run build`. Do not weaken tests to make a phase green.

## 7. Data and security guardrails

- No production database, public deployment, real user data mutation, secret change or permission expansion without explicit authorization.
- No schema migration, RLS policy, grant, owner-column, trigger or RPC change until the data contract and rollback are reviewed.
- Reuse existing tables only when their semantics and permissions actually fit. Do not force a new domain into an unrelated table.
- Keep private data out of browser caches, logs and analytics. Service Worker changes require a dedicated update/cache/rollback test.
- Prefer reversible status/archive operations over physical deletion where current grants prohibit DELETE.
- Use the profile's configured timezone for calendar behavior. Do not scatter hard-coded timezone assumptions through feature components.
- All asynchronous writes must define duplicate/retry behavior and verify the rows affected.

## 8. Pull request and phase closure

Each bounded implementation batch follows:

**Recover → audit → spec → dependency map → implement → test → review → merge → re-test merged SHA → manual validation → version/snapshot → update BUILD_STATUS → update ChatBending.**

A pull request must state:
- phase and objective;
- user-visible changes;
- data/security impact (including explicit "none");
- tests and exact results;
- known limits and manual checks still required;
- rollback/recovery method.

A phase closes only when its acceptance criteria and required evidence are met. The closing record includes the exact merged SHA, CI run URLs, user validation, persistence evidence and known limitations.

## 9. Current preparation boundary

This preparation batch is documentation-only. It creates the delivery standard, verified architecture baseline, roadmap sequence and Phase 1 Agenda contract. It does **not** refactor application code, create database tables, change RLS/grants, enable notifications, deploy publicly or claim Agenda is implemented.

The first functional work after this preparation is **Phase 0 engineering stabilization** (incremental modularization and reconciliation of existing validation gaps), followed by **Phase 1 — Agenda and time management** as one complete user-facing capability.
