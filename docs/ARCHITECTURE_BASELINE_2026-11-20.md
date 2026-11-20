# SimpleLife — Verified Architecture Baseline

**Verification date:** 20 November 2026  
**Repository:** `SimpleLife9/simplelife`  
**Branch:** `main`  
**Baseline SHA:** `45e49c40e2a04d8c06c2c583ff14e6b4d8dfcc13`

This document describes what was inspected in the repository and what remains a proposal. It is not a claim that future architecture has already been implemented.

## 1. Verified application stack

- React `19.3.1`.
- Vite `8.3.8`.
- Supabase JS `2.119.2`.
- JavaScript ES modules (`package.json` sets `type: module`).
- Playwright `1.65.1`.
- Node.js 22+ in CI; README documents 22.12+ for local Vite use.
- PWA with a Service Worker that currently caches only the public application shell.

## 2. Repository layout observed at the baseline SHA

- `src/App.jsx`: approximately 164,799 characters. It currently contains application/auth flow, primary navigation, shared operation state and a large portion of page/domain UI.
- `src/main.jsx`: application entry point.
- `src/lib/supabase.js`: Supabase client configuration.
- `src/lib/profile.js`: profile and preference bootstrap.
- `src/lib/uuidv7.js`: UUIDv7 helper.
- `src/lib/dashboard.js`: Today dashboard calculation helpers.
- `src/styles.css`: shared application styling.
- `tests/dashboard.test.js` and `tests/uuidv7.test.js`: current unit test files.
- `tests/e2e/app-data.spec.js` and `tests/e2e/auth.spec.js`: browser tests; app-data tests use mocked Auth/PostgREST.
- `.github/workflows/ci.yml`: install, unit, Playwright Chromium and production build pipeline.
- `docs/rls-smoke-results.md`: development database security/RLS test evidence.
- `BUILD_STATUS.md`: implementation history and validation register.

The current E2E app-data test file is also large (approximately 101,190 characters). Test organization should be improved alongside application boundaries, not by removing scenario coverage.

## 3. Verified quality and security evidence

- GitHub Actions run #103 passed on baseline SHA `45e49c40e2a04d8c06c2c583ff14e6b4d8dfcc13`: https://github.com/SimpleLife9/simplelife/actions/runs/44826335421
- Unit tests, Playwright E2E and Vite production build are part of that workflow.
- The 19 November 2026 development audit records 17/17 public tables with RLS enabled, zero public table grants to `anon`, zero physical DELETE grants to `authenticated`, and zero Supabase Security/Health advisor warnings.
- The RLS audit used transaction-scoped synthetic identities and cleaned them up.
- A real authenticated browser E2E against Supabase Auth and persisted CRUD remains unverified.
- Physical Android/iOS installation and notification validation remain unverified.
- The repository README explicitly describes this as a local development version; no public deployment or preview is recorded.

These results are specific to the development project and the test scope stated in the source evidence. They are not a production security certification.

## 4. Architecture constraints visible today

1. The application composition, navigation and multiple domain flows are concentrated in one very large React component file.
2. Domain behavior, UI and data access need clearer boundaries before adding calendar recurrence, availability, protected time, shared events or planning.
3. The current app has reusable infrastructure helpers, but no established feature-module boundary is visible in the inspected source tree.
4. Browser tests cover many flows, but the app-data test harness is concentrated in a single large spec and mocks the backend.
5. The current service worker is intentionally limited to public shell assets; personal data is not an offline-first capability.

## 5. Incremental target architecture

The recommended target organization is:

- `src/app/`: shell, global navigation, route/page composition and app-level providers.
- `src/features/auth/`
- `src/features/today/`
- `src/features/inbox/`
- `src/features/life-areas/`
- `src/features/goals/`
- `src/features/projects/`
- `src/features/tasks/`
- `src/features/notes/`
- `src/features/lists/`
- `src/features/agenda/` (introduced in Phase 1 only after its domain contract is accepted).
- `src/shared/`: reusable UI, formatters, date/time primitives and application-level errors.
- `src/lib/`: external clients and infrastructure adapters.

This target is intentionally incremental. Do not create empty feature folders or perform a one-shot rewrite. Extract an existing, bounded flow, preserve selectors and user-visible behavior, add regression coverage, and only then move to the next flow.

## 6. Phase 0 engineering stabilization — required before feature expansion

### 6.1 Protect the existing behavior

- Establish and record a clean baseline for unit, E2E and production build.
- Inventory the current pages, domain operations, Supabase queries, state transitions and cross-feature refresh behavior.
- Reconcile the known open manual gates for task lifecycle (Lote 10) and task-to-goal/subgoal relations (Lote 11); do not repeat checks already performed by Robert.
- Reconcile older manual gates for real Auth/CRUD, Inbox review/archive, task edit/reopen and project lifecycle.
- Design a disposable real-auth test identity and cleanup procedure before using real Supabase E2E.

### 6.2 Extract architecture without changing behavior

Suggested extraction order:
1. shared date/time/formatting helpers and pure domain rules;
2. task domain/service/UI;
3. project and goal relation flows;
4. Inbox/capture flows;
5. notes and lists;
6. Today dashboard;
7. auth/profile shell and global navigation last, after route contracts are stable.

Each extraction is a separate small pull request with regression tests. Do not mix these refactors with new Agenda behavior.

### 6.3 Stabilize the existing product

- Complete the open task and goal-relation validation records.
- Finish the full notes/ideas lifecycle (edit, search, archive/restore).
- Finish list maintenance (rename, edit/reorder items, archive/restore) without breaking task links.
- Plan global search across existing entities.
- Complete account/profile/preferences flows according to the approved product scope.
- Map current navigation to the approved top-level model: Hoy, Agenda, Inbox, Mi vida and Espacios. Agenda is introduced with its phase; inactive future sections must not appear as fake features.

## 7. Decisions not to make during preparation

- Do not change the Supabase schema, RLS, grants, triggers or RPCs.
- Do not change authentication/session behavior.
- Do not introduce an offline private-data cache or queue.
- Do not promise reliable PWA background alarms or push.
- Do not expose data to ARIA, BattleCruiser, CuevaCoin or shared users.
- Do not deploy publicly.
- Do not add a new framework or broad dependency without demonstrated need.

## 8. Source of truth and next action

The product intent and phase roadmap remain in ChatBending Master, Anexo 141. This repository document is the technical baseline for the exact SHA above.

**Next action:** execute Phase 0 as small behavior-preserving architecture/stability batches, then begin Phase 1 Agenda from `PHASE_1_AGENDA_SPEC.md`.
