# Agenda — TZDB lifecycle, updates and recurring occurrence policy

Status: operational design proposal. No scheduled monitor, dependency update, Event persistence or deployment is enabled by this document.

## 1. Current authority

- The server-side resolver is pinned to `moment-timezone@0.6.6`, carrying IANA TZDB `2026f`.
- The resolver checks the loaded dataset against `EXPECTED_TZDB_VERSION` and fails closed on mismatch.
- The browser's `Intl` data is preview-only. It must not replace the server's versioned result for a confirmed timed Event.
- The package is isolated to the Edge Function and protected by the committed frozen Deno dependency graph. Its upstream maintenance status is a supply-chain risk that must be reviewed before deployment and every upgrade.

## 2. Release monitoring

Before hosted deployment, establish an operational owner and a recurring review:

1. Check the official IANA Time Zone Database release page and release notes at least weekly, and immediately when a government announces a time-rule change that affects a supported user/location.
2. Record the currently bundled TZDB release, the date checked, reviewer, and whether any release or relevant announcement exists.
3. If a new release is available, open a dedicated dependency-update PR. Do not update the package directly on `main` and do not combine the update with Event schema or product changes.
4. If there is no release, record the check as reviewed; do not create a no-op dependency commit.
5. Treat a release as relevant when it changes a zone used by existing or planned user commitments, not only when it changes Cuba.

This is a pre-deployment operational requirement. The current repository does not claim to run a scheduled release watcher or send automatic alerts.

## 3. Required update PR

Every TZDB update must change and review together:

- The exact `moment-timezone` package version (or an explicitly approved replacement).
- `deno.lock`, regenerated and validated with frozen dependency resolution.
- `EXPECTED_TZDB_VERSION` and any version assertions/metadata.
- The timezone authority documentation and a dated change record.

The PR checklist:

- Review upstream release notes and package provenance, maintenance/security advisories, license, transitive dependencies and whether a maintained alternative is suitable.
- Verify the loaded runtime dataset version equals the declared expected version; mismatch must fail closed.
- Run the complete resolver unit suite, Deno type-check, frozen graph validation, local Supabase Edge Runtime HTTP/auth smoke, and production build.
- Compare old and new transition data for every zone represented in regression fixtures and zones used by existing commitments when that inventory becomes available.
- Include tests for exact local times, gaps, folds, half-hour transitions, skipped civil dates, date boundaries, and atomic range ordering.
- Report any changed UTC resolution explicitly. Never hide a change behind a package-only update.
- Merge only after CI passes on the PR head; verify CI again on the exact merge SHA.

Do not deploy the updated Edge Function until its dependency review and operational acceptance are complete.

## 4. Rollback

- Roll back the resolver code, package version, lockfile and expected TZDB version together as one known-good commit.
- Do not roll back by changing an Event's stored UTC instant, original wall time, zone, or historical rules version.
- A rollback affects only future resolution requests. It must not rewrite previously confirmed one-off commitments or audit history.
- If a new legal rule makes the old dataset unsafe for a near-term commitment, do not silently continue using stale rules. Pause affected confirmation flows, communicate the limitation, and require an explicit reviewed hotfix or temporary fail-closed behavior.
- Record the reason, affected zones, before/after versions, exact deployed SHA and rollback SHA.

## 5. One-off Event semantics

Once a timed one-off Event is confirmed, persist at minimum:

- Original local date-time and IANA zone selected by the user.
- Resolved UTC start and end instants.
- TZDB rules version and resolver version used at confirmation.
- The resolution outcome for each endpoint (exact, gap adjustment or fold selection), including adjustment minutes when applicable.

A later TZDB update does not change those stored UTC instants. The Event remains the same commitment unless the user explicitly edits or reconfirms it. Rendering may show a notice if current rules would produce a different local representation, but must not silently move the commitment.

All-day Events remain date-only and must not be shifted through UTC conversion.

## 6. Recurring series and future occurrences — APPROVED DEFAULT (21 November 2026)

A recurring series is a civil-time rule, not a sequence of fixed 24-hour UTC intervals. Store the original local wall time, IANA zone, recurrence rule, and a stable occurrence key derived from the series identity and original scheduled local date/time.

Proposed conservative behavior when TZDB changes:

1. Completed, skipped, cancelled, or otherwise historical occurrences are immutable.
2. A future occurrence that has already been confirmed/materialized keeps its stored UTC instants and rules version. A new TZDB release must not move it silently.
3. Future occurrences not yet materialized are resolved using the latest approved TZDB version when generated.
4. If a new TZDB release changes the expected instant of an already materialized future occurrence, mark it as requiring review and present the old and newly resolved instants. Do not apply the shift until the user accepts it.
5. The series keeps its civil-time rule and original IANA zone. A user timezone preference change does not rewrite the series zone.
6. A user can explicitly edit the series or an occurrence; the edit scope must remain visible (this occurrence / this and following / whole series).

**Product decision: APPROVED by Robert on 21 November 2026.** This is the default product behavior. Implementation must still specify and test the materialization horizon, idempotency, stable occurrence keys, review/acceptance flow, notifications, and edit scope. Approval of this product rule does not authorize hosted database DDL, migrations, RLS/grants, Auth changes, production data changes, or deployment; those retain a separate technical Human Gate.

## 7. Browser/server mismatch

- Browser timezone calculations may be used to preview a proposed local time, clearly marked non-authoritative.
- The server returns the authoritative range and its rules/resolver versions.
- If browser preview and server resolution disagree, show the server result and explain the adjustment before confirmation. Never silently substitute one for the other.
- A confirmed Event stores the server result and version metadata.
- A server TZDB version mismatch returns a fail-closed error; the UI must offer retry after the resolver is corrected, not fall back to browser rules for persistence.

## 8. Gates before production

- [ ] Name an operational owner for weekly IANA release review and urgent rule-change review.
- [ ] Approve an automated alerting mechanism (if desired); none is claimed by this document.
- [ ] Complete package provenance/security/license review or approve a maintained alternative.
- [x] Approve the recurring-occurrence TZDB-change behavior in section 6 (Robert, 21 November 2026).
- [ ] Complete trusted Event write, audit append, RLS/grants and real-auth two-user persistence tests.
- [ ] Complete a rollback rehearsal in an isolated environment.
- [ ] Approve the hosted Edge Function deployment and database migration separately.

## 9. Explicit non-effects

This document creates no scheduled workflow, alert, issue, database object, migration, function, trigger, policy, grant, Event, audit row, user data or secret. It changes no dependencies, resolver code, Auth settings, hosted Supabase state or deployment. A separate Human Gate remains mandatory before the first hosted Event migration or function deployment.
