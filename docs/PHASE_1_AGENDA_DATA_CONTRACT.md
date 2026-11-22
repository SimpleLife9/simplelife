# Phase 1 — Agenda: Domain, Data, Security and Verification Contract

**Status:** TECHNICAL DESIGN PROPOSAL — no DDL or migrations applied  
**Date:** 21 November 2026  
**Application baseline:** `main` SHA `dc321f2b4656abd4e8c1697c7eb232fc6dfd6ea5`  
**Supabase target inspected read-only:** `Simplelife_dev` / `iybnjrnysiikbtokyshg` / PostgreSQL 17.12

This document translates the approved product decisions in ChatBending Anexos 5, 49, 61, 64, 69, 70, 71, 76, 77, 80, 82, 85 into an implementable Phase 1 contract. It intentionally separates confirmed product rules from implementation defaults that still need code-level verification. No table, migration, policy, grant, data row or secret was changed while preparing this document.

## 1. Read-only evidence and baseline

### Repository

- React 19.3.1, Vite 8.3.8, JavaScript ES modules and Playwright 1.65.1.
- `src/App.jsx` is now the small app composition point (approximately 3 KB); the existing screens live under `src/features/*`.
- `src/app/navigation.js` and `src/app/AppPages.jsx` own primary navigation and page composition.
- `src/lib/date-time.js` contains date-only helpers; `src/lib/uuidv7.js` is the current client ID convention.
- There is no Agenda feature yet.
- The GitHub tree currently contains no `supabase/migrations/` directory.

### Supabase development project

- Project `Simplelife_dev`, status ACTIVE_HEALTHY, PostgreSQL 17.12.
- Six migration versions are recorded in the hosted database: `20261119124048`, `20261119124130`, `20261119124200`, `20261119132044`, `20261119132635`, `20261119133009`.
- 17 public tables were inspected; all 17 have RLS enabled.
- The existing `task` table already holds due dates, optional due instants, an IANA timezone and estimated duration. These fields describe a task's deadline/estimate; they are not an Event or a TaskSchedule.
- `user_preference.time_zone` exists and defaults to `America/Havana`; read the saved preference for rendering instead of hard-coding a timezone inside Agenda.
- `audit_event` is readable by its owner but authenticated direct inserts are intentionally blocked; the established audit append path must not be bypassed by new client writes.
- Existing core policies resolve the authenticated identity through `user_profile.auth_user_id = auth.uid()`, then scope rows by the profile ID.

### Migration-source recovery — merged and provider-reconciled

PR #58 merged the six exact historical forward SQL bodies into `supabase/migrations/` at main SHA `ba2b187009c9169973b73302a4fd50cd760307a8`. Each file was compared character-for-character with the remote `statements[1]` body (6/6 exact matches). A post-merge read-only `list_migrations` call returned the same six version/name pairs as Git (6/6 match); the linked project is ACTIVE_HEALTHY on PostgreSQL 17.12. The local Supabase CLI command `supabase migration list --linked` has not been run, so that CLI-specific check remains open if a local linked CLI environment is available. Remote `rollback` was NULL for all six historical versions; no historical down-migrations were fabricated. No SQL/DDL was executed for this recovery.

## 2. Domain model

The conceptual entities follow Anexo 61. This is not a proposal to duplicate the underlying task or event record.

| Domain entity | Phase 1 persistence concept | Key invariant |
|---|---|---|
| Event | `calendar_event` | Own identity; a commitment is not a Task. |
| EventOccurrence | Materialized occurrence row inside the rolling 90-day horizon; bounded previews outside it | Stable key from series ID + original local slot; overrides preserve that identity. All-day rows remain date-only. |
| ProtectedTimeBlock / AvailabilityBlock | `protected_time_block` | User-owned, private by default; ARIA cannot consume it automatically. |
| TaskSchedule | `task_schedule` | References the existing Task; one Task may own multiple time blocks. |
| Reminder | Deferred persisted delivery model | Any Phase 1 countdown is derived from the source Event and makes no push-delivery guarantee. |
| EventParticipant / Request | Excluded; Phase 7 | No cross-account sharing, invite or acceptance flow in Phase 1. |

### Event functional status and lifecycle

Functional states (Anexos 72/77): `preparing`, `proposed`, `confirmed`, `cancelled`, `finished`. Direct user creation in Phase 1 creates `confirmed`; the other states are reserved for controlled drafts/proposals and lifecycle transitions. Cancellation does not erase the event or its original time.

Lifecycle is a separate dimension: active, archived, in trash, permanently deleted subject to the 30-day retention contract. No physical DELETE is granted to the client.

### TaskSchedule status

Use the approved states from Anexo 82: `proposed`, `confirmed`, `cancelled`, `released`, `elapsed`. A cancellation/release only affects the reservation; it never changes the Task's execution status. Creating a TaskSchedule does not insert another Task.

## 3. Time storage contract

Do not model every temporal value as a UTC timestamp. The database and domain layer must preserve the temporal intention:

### A. All-day Event

- Persist `start_date` and `end_date_exclusive` as PostgreSQL `date`.
- No artificial `00:00Z` start/end instant.
- `end_date_exclusive > start_date`; one calendar day is `end_date_exclusive = start_date + 1 day`.
- Date display is not shifted when the viewer's timezone changes.

### B. Zoned civil-time Event

- Persist the original local wall-clock start/end (without timezone), the IANA `time_zone`, and resolved UTC `starts_at` / `ends_at` instants.
- Persist the chosen ambiguity resolution for each endpoint where relevant (exact, first/earlier, second/later, or next-valid for a gap).
- This preserves both the original local intent and the resolved instant used for ordering/conflict queries.
- Physical venue events use the venue's zone. Online meetings use the creator's saved zone at creation unless the source specifies a zone/instant. A later travel or preference change does not rebase the event.

### C. Fixed universal instant Event

- Persist `starts_at` and `ends_at` as `timestamptz`.
- Preserve the source reference (UTC or explicit source zone) when supplied; display the instant in the viewer's configured timezone.
- Do not re-resolve the instant merely because the user's preferred timezone changed.

### D. Recurrence

- Recurring calendar events preserve local wall-clock time and IANA zone; they are not repeated as rigid 24-hour intervals.
- Approved v1 grammar is versioned and constrained: DAILY, WEEKLY (Monday-based intervals and explicit ISO weekdays), MONTHLY (numeric day or ordinal weekday), YEARLY (selected month plus numeric day or ordinal weekday). Numeric days missing from a month are skipped; LAST is explicit. COUNT and inclusive local-date UNTIL are mutually exclusive.
- Timed recurrence defaults to gap-next-valid and fold-earlier; later fold is explicit. All-day recurrence remains date-only.
- Recurrence edits support this occurrence, this and following, and entire series. Past/completed history is not silently rewritten.
- The complete approved recurrence policy, including horizon, batch, trigger, overrides and TZDB review, is specified in `AGENDA_RECURRING_SERIES_CONTRACT.md`.

### E. Interval and conflict semantics

- Timed intervals are half-open `[start, end)`; an event ending at 10:00 and another starting at 10:00 are adjacent, not overlapping.
- An event may cross midnight and may span several dates; no arbitrary one-day truncation.
- Conflict detection is a soft domain rule, not a global exclusion constraint. The same user may intentionally confirm overlapping events after reviewing a warning.
- Fixed-instant comparisons use UTC instants. Zoned civil-time inputs are resolved through the approved timezone rules before comparison. All-day events compare calendar-date ranges.

## 4. Proposed physical tables (for review before DDL)

The names/shape below are a version-1 implementation proposal. Apply no DDL until the migration-source blocker in §1 is resolved and the schema is reviewed against the real catalog.

### `calendar_event`

Common columns:
- `id uuid primary key` generated as UUIDv7 by the client.
- `owner_user_id uuid not null`, `created_by_user_id uuid not null`, both linked to `user_profile`.
- `title text not null`, `description text null`, `location_label text null`, `location_kind text null` (physical / online / other).
- `event_status text not null` constrained to the approved Event states.
- `temporal_kind text not null` (all_day / zoned_civil / fixed_instant).
- All-day columns `start_date date`, `end_date_exclusive date`; timed columns `start_local timestamp without time zone`, `end_local timestamp without time zone`, `time_zone text`, `starts_at timestamptz`, `ends_at timestamptz`, plus DST disambiguation fields.
- Optional recurrence-series definition using the versioned schema; one-off Events leave recurrence unset.
- Lifecycle timestamps `archived_at`, `deleted_at`, `purge_after` and `created_at` / `updated_at`.

Checks enforce title length, allowed status/mode, a complete all-day date range with no timed fields, or complete timed fields with end after start. Application/domain validation checks that the IANA zone is valid and that local values resolve according to Anexo 71. Do not allow clients to submit inconsistent local and UTC values without a server/domain check.

### `calendar_event_exception`

- `id uuid primary key`, `owner_user_id`, `calendar_event_id`, stable `occurrence_key` derived from the original series-local occurrence date/time. The key excludes UTC, TZDB version, offset and fold choice.
- Override kind (cancelled / moved / modified), optional override fields and timestamps.
- Unique `(calendar_event_id, occurrence_key)` makes retries idempotent.
- A moved occurrence retains its original occurrence key and EventOccurrence identity; its new actual start does not replace the original key.
- "This and following" creates a new series segment and truncates the old segment before the selected key; prior exceptions remain attached to the segment that owns their original key.

### `calendar_event_occurrence`

- Canonical row for one materialized occurrence inside the rolling horizon; unique `(calendar_event_id, occurrence_key)`.
- Stores owner, series/Event ID, stable key version, original local date/time and effective local date/time, occurrence status, override kind, and optimistic row version.
- Timed rows also store IANA zone, resolved UTC start/end, resolver/TZDB versions and resolution metadata. All-day rows store date-only values and no UTC instants.
- Series-level duration is inherited; an occurrence may override duration/end semantics. Moved and modified instances retain the original occurrence key.
- The materialized row is authoritative for that slot. Recalculation must not overwrite it; a TZDB difference moves it to `needs_review` until explicit version-bound acceptance.
- Rows are owner-scoped and written only through the trusted authenticated server path. This is a schema proposal only, not DDL authorization.

### `protected_time_block`

- `id`, owner/creator, label, optional category, one-off or recurring temporal definition, IANA zone, active/archive lifecycle, protection mode `hard` or `flexible`.
- One-off blocks use a single interval; weekly patterns retain local wall-clock start/end and their zone.
- Both modes are protected against automatic ARIA scheduling. Proposed UI behavior: hard overlap needs an explicit override; flexible overlap produces a warning and explicit user choice. The user can change or remove their own block at any time.

### `task_schedule`

- `id`, `owner_user_id`, `created_by_user_id`, `task_id`, temporal start/end + IANA timezone, `schedule_status`, timestamps and lifecycle metadata.
- Composite owner/task integrity must ensure the referenced Task belongs to the same owner. One Task may have several schedules.
- Unique request identity (client-generated stable UUID/idempotency key) prevents duplicates on a retried save.
- TaskSchedule is timed, not all-day. A Task remains flexible until a reservation is explicitly confirmed.

### Occurrence identity and materialization

**Approved hybrid model (21 November 2026):** materialize eligible occurrences in a rolling 90-calendar-day horizon, using batches of at most 500. Timed rows persist their confirmed UTC range and exact resolver/TZDB versions; all-day rows persist date-only values without UTC instants. Persist occurrence state, exceptions, overrides and review status. Calculate occurrences beyond the horizon as bounded previews only; never treat a preview as a persisted confirmed commitment or overwrite a materialized row. Stable identity is derived from (series ID + original local date + original local time, or `ALL_DAY` + key format version); it excludes UTC, offset, TZDB version and fold choice. Repeated/concurrent materialization is idempotent and must not reset overrides, reviews or terminal states.

**Triggers (approved):** materialize on series create/edit and perform bounded idempotent top-up on authenticated Agenda range reads. No cron/scheduled job in v1. A background worker requires a separate proposal, named operator and Human Gate.

### Optional event categories and cross-domain links

Do not freeze an extensive category taxonomy or relationship matrix in the first migration. V1 may have an optional user-defined category/label. Linking an Event to Goals/Projects/Tasks is deferred until the relationship meaning, cardinality and ownership rules are specified; TaskSchedule is the only Phase 1 link to an existing Task.

## 5. Security and ownership contract

All Phase 1 proposed persistence tables, including series, occurrence and exception rows, are personal owner-scoped data:

- `owner_user_id` references `public.user_profile(id)`; `created_by_user_id` references the same profile.
- RLS is enabled before any client access.
- SELECT policy: only rows whose `owner_user_id` matches the profile resolved from `auth.uid()`.
- INSERT check: both owner and creator match the authenticated profile for personal data.
- UPDATE policy: both USING and WITH CHECK enforce owner isolation; owner/creator/id/creation timestamps are immutable through client column grants.
- Authenticated receives only required SELECT/INSERT/UPDATE table/column privileges. No `anon` grants and no physical DELETE.
- For `task_schedule`, add a same-owner composite FK/integrity rule so a user cannot reserve another owner's task even by submitting their own `owner_user_id`.
- Do not infer access from a relationship, future space membership, ARIA, or shared participant.
- No client writes directly to `audit_event`. If audit history is required for event create/update/cancel/archive, add a narrowly scoped database-owned append path/trigger that derives actor and owner from trusted auth context, validates ownership, and records minimal non-sensitive details. Never expose a general audit insert RPC.

### Retention and lifecycle

- Event cancellation is a functional status, not deletion.
- Archive is recoverable and separate from cancellation.
- Trash is a logical delete/tombstone with the approved initial 30-day recovery window.
- No physical DELETE from authenticated. Do not implement a purge job until its eligibility, dependencies and audit/retention matrix are explicitly validated.
- No cascading delete/archive of tasks, goals, projects, series or exceptions without an explicit domain rule.

## 6. Query and index strategy

- Owner + time-window indexes for Events and protected blocks.
- TaskSchedule index by owner + start/end and by task ID.
- Unique occurrence exception index by series/event + occurrence key.
- Use UTC instant indexes for timed event range queries and date indexes for all-day events; do not mix all-day date comparisons with UTC midnight.
- Calendar reads query only the visible period plus a small, bounded buffer for multi-day/recurring spans. Flexible tasks use the existing task due-date/status source, not a copied calendar row.
- Re-evaluate query plans after real data volume is available; do not add speculative duplicate indexes.

## 7. Verification matrix

| Risk | Required evidence |
|---|---|
| Date semantics | Date-only/all-day ranges never move a calendar day across zones. |
| Zoned civil time | Correct resolution in `America/Havana` and at least one DST-observing IANA zone. |
| Fixed instant | Exact instant remains stable when the display timezone changes. |
| DST gap/fold | Gap shifts to next valid time; repeated time uses selected first/second occurrence; one-off choice is preserved. |
| Recurrence | Daily/weekly/monthly/yearly, interval, month boundaries, end condition, exception and three edit scopes. |
| Idempotency | Two identical loads/retries create no duplicate Event/exception/TaskSchedule. |
| Conflicts | Adjacent half-open intervals do not conflict; true overlaps and protected-time overlaps are explained. |
| Task identity | A task with multiple schedules still has one ID and one execution status; cancelled/released/elapsed schedule never mutates task status. |
| RLS | Two synthetic authenticated owners: each can read/write own events and cannot read/write the other's events/blocks/schedules or cross-link a task. |
| Privileges | No anon, no authenticated DELETE, owner/creator columns not updateable, no direct audit insert. |
| Recovery | Rollback removes only Phase 1 additions; pre-existing task data and other domain tables remain unchanged. |
| Browser | Day/week/month, create/edit/cancel, all-day, conflicts, protected blocks, task scheduling, recurrence at desktop + 390px. |

## 8. Delivery slices

1. **Foundation + one-off Events:** timezone-safe domain helpers, persisted Event CRUD, day/week/month shell and all-day/timed rendering. No recurrence until the temporal resolver tests pass.
2. **Protected time and conflicts:** one-off/weekly protected blocks, hard/flexible warning and explicit override.
3. **TaskSchedule:** multiple blocks per task, with Task identity/status unchanged.
4. **Recurring events:** versioned rules, virtual occurrences, exceptions, all three edit scopes, DST and idempotency tests.
5. **In-app upcoming indicators:** lightweight countdown/next-event presentation while app is active; no PWA alarm guarantee.

Each slice is a separate small PR with unit/domain tests, mocked Playwright, real-auth persistence smoke and post-merge exact-SHA CI where data is added.

## 9. Open implementation blockers

1. **Migration baseline:** the six historic forward SQL files are now versioned and provider-reconciled 6/6 after PR #58. The provider's read-only migration list matches Git. The local CLI-only `supabase migration list --linked` check remains open; do not run `db push` as a substitute.
2. **Timezone rules authority:** the client preview remains `authoritative: false`. PR #61 has merged a server-side proof of concept (`supabase/functions/agenda-time-resolve`) pinned to IANA TZDB `2026f`, with runtime version assertion and fail-closed drift handling. This is not yet deployed or connected to Event writes. Before persisted Event confirmation, complete dependency/supply-chain review, operational TZDB release review and rollback ownership, browser/server mismatch UX, and hosted deployment acceptance. Local Edge Runtime HTTP/auth tests and the recurring TZDB-change product policy are now complete (PRs #67–#69). Never use fixed UTC offsets or silently trust stale device rules.
3. **Recurrence engine:** select a tested implementation or a small explicitly supported subset; do not claim general RFC 5545 support by implication.
4. **Audit append path:** confirm the current trusted append mechanism/trigger contract before recording new Event transitions.
5. **Real-auth smoke lifecycle:** create a reproducible, bounded QA fixture lifecycle without physical DELETE or modifying the existing canaries.
6. **Manual acceptance:** test actual desktop and narrow mobile behavior; physical Android/iOS platform-specific alarms remain out of this phase unless explicitly added.

**No DDL, schema migrations, RLS/grants, test rows or deployment are authorized by this design document.**


## 10. First executable domain slice — client temporal preview (21 November 2026)

Branch: `feat/phase1-agenda-temporal-domain-v1`.

- `src/features/agenda/domain/temporal.js` provides date-only validation, IANA timezone support checks, local wall-time resolution, DST fold selection, next-valid-minute handling for gaps, date-based all-day ranges, positive timed intervals and half-open overlap detection.
- The returned local-time resolution includes the requested and resolved wall times, selected instant, resolution reason, adjustment minutes, `rulesSource: runtime-intl`, `rulesVersion: null` and `authoritative: false`.
- The resolver samples timezone offsets around the requested date and applies the runtime IANA rules. Tests cover Havana round-tripping, New York 2026 spring-forward gap (02:30 → 03:00), fall-back repeated 01:30 (earlier by default, later on explicit request), invalid dates, all-day exclusive ranges, midnight-crossing instants, and half-open adjacency/conflicts.
- This is a pure client/domain preview layer. No Event is persisted, no RLS or database write occurs, and no UI route is exposed in this slice. Do not use the runtime rule data as a canonical persisted instant until a maintained/versioned timezone authority is implemented.


## 11. Server-side IANA timezone resolver proof of concept — PR #61 (21 November 2026)

- PR #61 merged at main SHA `ad83849eadc7dab912cf73e139f0c4cad7e19cff`; post-merge CI #230 PASS: [run #230](https://github.com/SimpleLife9/simplelife/actions/runs/44936778867).
- The isolated Supabase Edge Function `agenda-time-resolve` uses the pinned `moment-timezone@0.6.6` transition dataset carrying IANA TZDB `2026f`; `deno.lock` is committed and frozen. Runtime checks the loaded TZDB version and returns 503 on mismatch rather than silently using different rules.
- The resolver implements exact, gap and fold behavior with a 1,440-minute maximum gap adjustment. Tests cover Cuba's 2026 rule, New York DST, Lord Howe's 30-minute transition, Apia's skipped date, invalid local values and unknown zones.
- The function is only a pure calculation endpoint in source. It does not query or write tables, and has not been deployed or connected to UI/Event persistence. The `authoritative: true` response means the result came from the pinned dataset, not that the endpoint has completed production security/operational acceptance.
- Remaining gates: explicit function JWT configuration; HTTP method/body/error contract tests; authenticated local Edge Runtime smoke; dependency/vendor review (Moment Timezone is maintenance-mode); recurring TZDB update/rollback policy; browser/server mismatch UX; future recurrence recalculation policy. No DDL, migrations, hosted function deploy, Auth/secrets/RLS/grants or data changes were made.

## 12. Post-merge test-only DST coverage — PR #59 (21 November 2026)

- PR #59 merged at SHA `dc321f2b4656abd4e8c1697c7eb232fc6dfd6ea5`: [PR #59](https://github.com/SimpleLife9/simplelife/pull/59).
- CI #220 PASS on the PR head; post-merge CI #231 PASS on the exact main SHA, including unit tests, Playwright/mobile layout, offline live-smoke discovery, frozen Deno dependency validation and production build: [run #231](https://github.com/SimpleLife9/simplelife/actions/runs/44937458741).
- This PR adds client temporal-domain coverage only; it does not change runtime behavior or persistence.

## Atomic server-side resolution for timed Events — implementation addition (21/11/2026)

The Edge Function now supports one atomic range request for a timed Event:

```json
{
  "timeZone": "America/New_York",
  "start": { "localDateTime": "2026-11-01T01:15", "disambiguation": "earlier" },
  "end": { "localDateTime": "2026-11-01T01:45", "disambiguation": "later" }
}
```

Both endpoints are resolved in one invocation against the same already-verified TZDB release, timezone object and resolver version. Start/end have independent DST fold/gap choices. The response carries both UTC instants, each endpoint's requested and resolved local value, adjustment/resolution, and shared top-level rules/resolver versions. The server checks `endsAt > startsAt` after resolving both endpoints and returns HTTP 422 otherwise.

Do not resolve the start and end in two separate HTTP calls for one confirmed Event. All-day Events remain date-only and do not call this endpoint. The one-point resolver remains available for diagnostics, but Event persistence must use the atomic range mode.

No Event, database table, migration, RLS/grant, audit record, Auth setting, secret or hosted function has been created or changed by this implementation.

## TZDB lifecycle and recurring occurrence policy

The operational update/rollback policy and approved recurring-occurrence behavior are documented in [AGENDA_TZDB_LIFECYCLE_POLICY.md](./AGENDA_TZDB_LIFECYCLE_POLICY.md). Robert approved on 21 November 2026 that materialized future occurrences preserve confirmed UTC instants and require explicit user acceptance before applying a new TZDB resolution. The technical series/occurrence contract is in [AGENDA_RECURRING_SERIES_CONTRACT.md](./AGENDA_RECURRING_SERIES_CONTRACT.md). Remaining open decisions are listed there; the separate technical Human Gate for hosted DDL/deploy remains mandatory.

## Trusted Event write and audit append design (PR #66)

The implementation proposal is documented in [AGENDA_AUDIT_APPEND_DESIGN.md](./AGENDA_AUDIT_APPEND_DESIGN.md). The key security boundary is a user-authenticated Edge Function that derives the profile from the verified user JWT and performs writes through `ctx.supabaseAdmin` only after strict owner checks. The browser receives SELECT-only access to Event rows (owner-scoped by RLS); it receives no direct INSERT/UPDATE/DELETE grants. A narrowly scoped private `SECURITY DEFINER` row trigger appends UUIDv7 audit evidence in the same transaction. The audit actor/owner fields are set only by trusted server code, not browser input.

This is a design proposal, not a DDL authorization. It requires a separate explicit Human Gate before a migration or hosted database change.


## One-off Event domain model — PR #75 preparation

The pure domain module `src/features/agenda/domain/event.js` defines the three approved one-off Event temporal kinds without creating persistence or server-owned values:

- `all_day`: inclusive start date plus exclusive end date. It uses the date-only helper and never generates UTC midnight or a timezone.
- `zoned_civil`: original local start/end wall times, IANA zone and independent fold/gap choices. The draft has no UTC instants and is explicitly marked `needs_authoritative_resolution` until the atomic authenticated IANA range resolver returns matching start/end metadata.
- `fixed_instant`: input instants must carry an explicit UTC offset or `Z`; the domain normalizes them to UTC and optionally preserves the source IANA timezone. It does not re-resolve a fixed instant because the viewer's timezone changes.

The resolver promotion check verifies requested zone and wall values, canonical timezone, authoritative IANA source, shared TZDB and resolver versions, per-endpoint version/source metadata, requested earlier/later fold behavior, endpoint instant equality and a positive UTC interval. Runtime `Intl` preview data cannot be promoted to a canonical persisted interval.

Direct user-created Events default to `confirmed`; `preparing` and `proposed` remain valid draft states. `cancelled` and `finished` are valid functional statuses for later Event transitions, not initial creation states. Lifecycle remains a separate dimension, initialized as active. The input rejects owner/creator, ID, audit, timestamp and other server-owned/unknown fields.

Technical input bounds in this domain slice: title 200 characters, description 5,000, location label 500. They are validation safeguards for this implementation, not database constraints or a change to product behavior.

This module is pure domain code. It makes no network calls, generates no IDs/owner/actor fields, creates no audit records, writes no rows and does not alter task data. No schema, migration, RLS/grants/Auth, secrets, cron, Edge Function deployment or public release is part of this slice.
