# Agenda — recurring series and occurrence contract

Status: technical design proposal following the approved TZDB-change product decision. This document does not authorize schema creation, migrations, hosted database changes, or deployment.

## 1. Domain separation

A recurring series is the user's civil-time instruction. An occurrence is one dated instance produced by that instruction.

- A series owns the recurrence rule, original local wall time, IANA timezone, duration/end semantics, default DST disambiguation, lifecycle, and series-level metadata.
- An occurrence has stable identity, original scheduled local date/time, resolved UTC start/end, TZDB/resolver versions, resolution metadata, and occurrence lifecycle.
- Exceptions and overrides belong to the occurrence identity; they must not mutate the recurrence rule unless the user explicitly chooses a series edit scope.
- A generated occurrence is not a new Task. If the user associates a Task with an occurrence, preserve the Task identity and status independently.
- A recurrence is not a fixed UTC interval. Generate civil dates first, then resolve each occurrence against the approved IANA TZDB authority.

## 2. Supported recurrence subset

Do not claim full RFC 5545 compatibility. Initial implementation should support an explicitly versioned subset only:

- Daily: every N days.
- Weekly: every N weeks, with an explicit set of weekdays.
- Monthly: every N months, with either a day-of-month or an ordinal weekday selector.
- Optional local-date end boundary or occurrence count.
- Explicit excluded dates and per-occurrence overrides.

Unsupported combinations must be rejected with a clear validation error, not silently approximated. The exact v1 rule grammar, month-end behavior (for example, day 31 in a shorter month), and whether yearly rules belong in v1 remain open design decisions before persistence.

Store the recurrence rule in a normalized, versioned representation; do not persist an opaque provider-specific string as the only source of truth.

## 3. Stable occurrence identity and idempotency

The occurrence key must identify the intended civil occurrence, not its current UTC instant.

Recommended logical identity:
- series ID;
- original scheduled local date;
- original scheduled local time;
- occurrence-key format version.

The deterministic key must not include UTC start/end, TZDB version, or current timezone offset. A TZDB update must not create a second occurrence for the same civil slot.

Enforce a unique constraint on (series_id, occurrence_key) in the eventual schema. Materialization must be idempotent: retrying the same generation window cannot duplicate rows, reset user edits, or overwrite an accepted override.

If a series edit changes the original local slot, apply the selected edit scope and create/reconcile the corresponding identities transactionally. Preserve audit evidence of replaced, cancelled, or superseded occurrences; do not physically delete audit history.

## 4. Materialization lifecycle

Recommended occurrence states (exact names may be normalized during implementation):

- scheduled: materialized and awaiting its scheduled time.
- completed: historical, immutable for TZDB recalculation.
- cancelled: explicit user cancellation; retained as a tombstone.
- skipped: intentionally omitted; retained so regeneration cannot recreate it.
- needs_review: a newer approved TZDB version resolves this already-materialized future slot differently.
- superseded: replaced by an explicit series/occurrence edit; retained for audit and idempotency.

A materializer should generate occurrences only within a bounded rolling horizon and should be safe to rerun. The horizon length, execution trigger (on series write, app open, scheduled job, or a combination), and maximum batch size are OPEN decisions. Do not create a cron or scheduled workflow until those are approved and operationally owned.

## 5. Approved TZDB update behavior

The following is an approved product decision by Robert (21 November 2026), also recorded in AGENDA_TZDB_LIFECYCLE_POLICY.md:

1. Historical, completed, skipped and cancelled occurrences are immutable.
2. Materialized future occurrences keep their confirmed UTC instants and original rules version; no silent shift.
3. Future occurrences not yet materialized use the latest approved TZDB release when generated.
4. If a new TZDB release changes a materialized future occurrence, mark it needs_review and show the prior and newly resolved instants.
5. Only explicit user acceptance applies the new instant. Record the accepted rules version, old/new instants, actor and timestamp in append-only audit evidence.
6. Keep the series' original local wall time and IANA zone. A user profile timezone change does not rewrite the series.
7. Preserve explicit edit scopes: this occurrence / this and following / entire series.

A review action must be idempotent and concurrency-safe. If the occurrence was edited or cancelled after the review was generated, reject stale acceptance and refresh the comparison.

## 6. DST behavior for generated occurrences

Use the same versioned server resolver as one-off Events. Browser Intl may preview but is never authoritative for persistence.

Recommended v1 defaults, pending confirmation in the detailed product acceptance:
- Gap: resolve to the next valid local minute and record the requested and resolved local values plus adjustment.
- Fold: choose the earlier instant by default; permit a later choice only when explicitly stored on the series or occurrence.
- A series-level DST choice is inherited by generated occurrences; an occurrence override takes precedence.
- All-day recurrence remains date-only and does not pass through UTC conversion.

Every generated timed occurrence must be resolved as one atomic start/end range against one loaded TZDB release and resolver version. Validate ends_at > starts_at after resolution.

## 7. Editing scopes

- This occurrence: create/update an occurrence override or exception; leave the series rule unchanged.
- This and following: split the series at the selected original civil occurrence. The prior series retains earlier slots; the new series begins at the selected slot with the revised rule. Preserve the selected occurrence's identity/history and link the split series.
- Entire series: update the rule and reconcile only future nonterminal occurrences. Never rewrite completed/skipped/cancelled history. Materialized future occurrences affected by the change must be previewed before confirmation if their UTC instants or local slots change.

The UI must state the selected scope before committing. A failed partial edit must roll back the complete operation and its audit append.

## 8. Required persistence and security invariants

When a separate migration is authorized, the schema should support:
- owner-scoped series and occurrence rows;
- immutable series owner and server-derived actor fields;
- stable occurrence key with a unique (series_id, occurrence_key) constraint;
- source local slot, IANA zone, UTC instants and resolver/TZDB version metadata;
- explicit override/exclusion/review state;
- no client direct INSERT/UPDATE/DELETE grants;
- authenticated Edge Function writes, strict owner checks, and same-transaction append-only audit;
- no physical deletion of occurrence history required for idempotency.

All owner/actor fields and canonical UTC/version metadata must be derived by trusted server code, never accepted from browser JSON.

## 9. Required test matrix

### Rule generation
- Daily/weekly/monthly rules, interval boundaries, weekday sets, count/until boundaries.
- Month-end behavior and leap days.
- Excluded dates, overrides, split-series boundaries and each edit scope.
- Unsupported grammar rejected deterministically.

### Idempotency and concurrency
- Same generation window executed twice creates no duplicate occurrence.
- Concurrent materializers converge on the same unique occurrence keys.
- Retries do not overwrite occurrence overrides, review state, or terminal state.
- Stale review acceptance is rejected after edit/cancel.
- TZDB re-evaluation never creates a second identity for the same civil slot.

### Timezone
- Exact local times, DST gaps/folds, 30-minute transitions, skipped civil dates, midnight crossing, all-day date-only behavior.
- Atomic start/end resolution and positive UTC duration.
- New TZDB version: historical immutable, materialized future needs_review, unmaterialized future uses new rules, acceptance updates only the selected occurrence and appends audit.

### Real-auth isolation
- Two disposable users cannot read, write, link, or review each other's series/occurrences.
- Direct Data API writes are denied.
- Tampered owner, actor, UTC instants, TZDB metadata and occurrence key are rejected or ignored.
- Audit append and domain mutation commit or roll back atomically.

## 10. Open decisions before implementation

These decisions are not included in the 21 November TZDB product approval and must be resolved before the corresponding implementation:

1. Exact v1 recurrence grammar and whether yearly rules are included.
2. Month-end behavior for monthly rules.
3. Materialization horizon and batch size.
4. Trigger strategy and operational owner for materialization; no cron is authorized.
5. DST gap/fold defaults for recurring series (the values above are recommendations).
6. Whether an occurrence can have a different duration/end rule from its series.
7. User-facing review notification and stale-review handling details.
8. Whether Task-to-occurrence linking is in v1 or deferred.

## 11. Explicit non-effects and gates

This is a design contract only. It creates no tables, columns, constraints, indexes, triggers, functions, RPCs, migrations, cron jobs, policies, grants, audit rows, Events, series, occurrences, users or secrets. It changes no remote Supabase state and deploys nothing.

A separate explicit Human Gate remains mandatory before:
- implementing or applying the first hosted schema migration;
- changing RLS, grants, Auth, triggers or audit append behavior;
- deploying the Event/series Edge Functions;
- creating scheduled materialization jobs or touching production data.
