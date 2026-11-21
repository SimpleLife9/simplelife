# Agenda — authoritative timezone resolver

Status: server-side proof of concept only. No Event persistence or deployment is authorized.

## Design
The browser Intl database is useful for preview but has no portable version identifier. PostgreSQL AT TIME ZONE alone also does not implement the approved Agenda policy for nonexistent and repeated local times. The server resolver therefore uses a pinned IANA TZDB data release, asserts the exact dataset version at runtime, and fails closed on version drift.

This isolated proof of concept uses Supabase Edge Functions (Deno) with moment-timezone 0.6.6 only as a carrier for IANA TZDB 2026f transition data. It does not use Moment's date parser or formatter. The upstream project is in maintenance mode, so the dependency is isolated and requires an explicit supply-chain review and frozen Deno lockfile before deployment.

## Product behavior
- Exact local time resolves to its single UTC instant.
- Repeated (fold) time chooses the earlier instant by default; later is available only when explicitly selected; reject is supported.
- Nonexistent (gap) time advances to the first valid local minute; reject is supported.
- Automatic gap adjustment is bounded to 1,440 minutes.
- Response records original local value, resolved local value, requested/canonical zone, UTC instant, resolution, adjustment minutes, IANA version and resolver version.
- The original local value and IANA zone remain the durable intent. A future TZDB update must not silently rewrite a confirmed one-off Event's UTC instant.

## Why versioning matters
IANA TZDB 2026f was released 2026-10-27. Its release notes say Cuba does not fall back on 2026-11-01 and remains at UTC-04 through 2027-11-07. A stale timezone database could otherwise resolve the same local commitment to a different instant.

## Test coverage
Cuba 2026 rule; New York spring gap and fall fold; Lord Howe half-hour transitions; Apia's skipped civil date; invalid local values and unknown IANA zones.

## Gates before any hosted deployment
1. Commit and freeze the exact Deno dependency graph in deno.lock; review or vendor critical dependencies.
2. Run the Supabase CLI local Edge runtime and authenticated HTTP contract tests.
3. Define TZDB release monitoring, update review, fixture comparison and rollback.
4. Decide how future recurring occurrences react when new legal rules change.
5. Design trusted Event create/update so clients cannot bypass server resolution or submit arbitrary canonical instants.
6. Confirm append-only audit, RLS, grants and real-auth smoke fixtures before first persisted Event migration.

## Explicit non-effects
No tables, migrations, database functions, triggers, RLS, grants, audit rows, user data, Auth settings, secrets, hosted Supabase functions or deployments are changed. This is not yet integrated into the Agenda UI or Event persistence path.
