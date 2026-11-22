# Agenda — recurring series and occurrence contract

**Status:** PRODUCT DECISIONS APPROVED — recurrence engine and bounded authoritative resolver batching merged; pure occurrence-resolution adapter in implementation; persistence remains gated.  
**Approval:** Robert approved the complete recurrence v1 proposal on 21 November 2026 (PR #71).  
**Scope:** This contract defines the bounded v1 recurrence behavior. It does not authorize DDL, hosted migrations, RLS/grant/Auth changes, cron, production data operations, Edge Function deployment or release.

## 1. Domain separation

A recurring series is the user's civil-time instruction. An occurrence is one dated instance produced by that instruction.

- A series owns the versioned recurrence rule, original local wall time, IANA timezone for timed Events, duration, default DST resolution and series metadata.
- An occurrence owns stable identity, original civil slot, effective local slot, resolved UTC range when timed, resolver/TZDB version, override and lifecycle state.
- An occurrence is not a new Task. Direct Task-to-occurrence linking is deferred in v1; TaskSchedule remains the Phase 1 relationship between a Task and reserved time.
- Generate civil dates first. Resolve timed instances only through the approved, versioned server authority. Runtime `Intl` is not authoritative for persistence.
- All-day recurrence stays date-only and never fabricates UTC midnight.

## 2. Approved v1 recurrence grammar

Version 1 is normalized structured data, not an arbitrary RFC 5545 string. The only supported frequencies are DAILY, WEEKLY, MONTHLY and YEARLY.

Common fields:
- `version: 1`, `frequency`, `interval` (integer 1–1000; default 1), `startDate` (inclusive local calendar date), and `temporalKind` (`all_day` or `zoned_civil`).
- Timed rules require `localTime`, IANA `timeZone`, positive `durationMinutes`, and `disambiguation` (`earlier` by default, `later` only by explicit choice). Gap strategy is fixed to `next-valid`.
- All-day rules have no clock time, timezone conversion, or duration in minutes.
- Optional termination is exactly one of `count` or `until`; `until` is an inclusive local date. COUNT counts rule-generated civil slots before exclusions; an excluded date does not extend COUNT.
- `excludedDates` excludes original local dates. Occurrence-specific changes are represented as overrides against the stable original occurrence identity.

Frequency selectors:
- DAILY: interval in calendar days; no weekday/month selectors.
- WEEKLY: interval in Monday-based weeks plus a non-empty set of ISO weekdays (`MO` through `SU`). The start date is an inclusive lower bound; earlier weekdays in its first week are not generated.
- MONTHLY: interval in calendar months plus exactly one selector: `byMonthDay` (1–31 or `LAST`) or `byOrdinalWeekday` (ordinal 1–4 or -1 for last, plus weekday).
- YEARLY: interval in calendar years, a required `byMonth` (1–12), and exactly one of the same day-of-month or ordinal-weekday selectors.
- A numeric day that does not exist in a selected month is skipped. It is not clamped or rolled forward. `LAST` explicitly means the last calendar day. February 29 therefore occurs only in leap years.
- Unsupported selectors/combinations are rejected; no sub-daily intervals, multiple selectors, BYSETPOS or implicit full-RFC compatibility.

## 3. Stable occurrence identity and idempotency

The occurrence key identifies the original intended civil slot, not its current UTC instant.

Logical key components:
- series ID;
- original local date;
- original local clock time, or `ALL_DAY`;
- occurrence-key format version.

The key must not contain UTC instants, offsets, TZDB version, current resolved local time, or DST fold choice. Moving an occurrence or changing its duration preserves its original key. Re-evaluating the same slot after a TZDB update cannot create a duplicate.

The eventual persistence layer must enforce a unique `(series_id, occurrence_key)` constraint. Repeated or concurrent materialization must not duplicate rows, overwrite an override, reset a review state or rewrite a terminal lifecycle state.

## 4. Hybrid materialization model — approved

Use a rolling 90-calendar-day horizon. Materialize eligible occurrences within that horizon in batches of at most 500 candidates per transaction.

- Timed materialized occurrences retain original civil date/time, IANA zone, resolved UTC start/end, exact resolver/TZDB versions and resolution metadata.
- All-day materialized occurrences retain date-only start/end values and no UTC instants.
- Persist occurrence lifecycle and review state, exclusions, overrides and terminal tombstones. A moved instance retains its original occurrence key.
- Occurrences beyond the horizon may be calculated as bounded calendar previews, but those previews are not persisted and must not be presented as already-confirmed materialized commitments.
- A preview must never overwrite an existing materialized occurrence or its accepted UTC instants.
- The materializer is deterministic and idempotent. It must be concurrency-safe, observable, bounded and resumable through a civil-date cursor.
- The 90-day horizon and 500-item maximum are fixed v1 operational constants, not user-facing settings.

### Trigger policy

No cron or scheduled workflow in v1.

1. Create/edit of a series materializes the affected eligible range within the horizon.
2. Authenticated Agenda range reads perform an idempotent top-up when needed.
3. A top-up must not hold a calendar request open for unbounded work. If later volume requires background processing, propose a separately reviewed job with a named operator and a new Human Gate.

## 5. Approved TZDB update behavior

1. Historical, completed, skipped and cancelled occurrences are immutable.
2. Materialized future occurrences keep their confirmed UTC instants and original rules version; no silent shift.
3. Future occurrences not yet materialized use the latest approved TZDB release when generated.
4. If a new TZDB release changes a materialized future occurrence, mark it `needs_review` and show prior and newly resolved local/UTC values.
5. Only explicit user acceptance applies the new instant. Append actor, timestamp, old/new values and accepted rules version in the trusted audit path.
6. The series keeps its original local wall time and IANA zone. A profile timezone change does not rewrite the series.
7. Edit scope remains explicit: this occurrence / this and following / entire series.

A review action is idempotent and version-bound. If the occurrence or candidate changed after the review was generated, reject the stale action and refresh the comparison.

## 6. DST defaults for recurring timed occurrences

- Gap: advance to the next valid local minute; record requested local value, resolved local value and adjustment.
- Fold: select the earlier instant by default; select the later instant only when explicitly stored.
- Series-level choice is inherited; an explicit occurrence override takes precedence.
- Resolve the start/end range atomically against one loaded TZDB release and resolver version. Validate resolved end > start.
- All-day recurrence is date-only and bypasses the UTC resolver.

## 7. Occurrence overrides

An override is attached to the original occurrence key and does not mutate the series rule.

- `cancelled`: retain a tombstone so regeneration cannot recreate the occurrence.
- `moved`: replace the effective local date and/or local clock time while retaining the original date/key.
- `modified`: change the occurrence duration/end semantics without changing its original local slot.
- Duration defaults to the series value; a single occurrence may override it. Duration must remain positive after authoritative timezone resolution.
- Overrides are audited by trusted server code. A failed domain mutation and audit append must roll back together.

## 8. Edit scopes

- This occurrence: add/change its override or exclusion; the series stays unchanged.
- This and following: split the series at the selected original civil occurrence. Preserve the selected occurrence's identity/history and link the split segment.
- Entire series: update the rule and reconcile only future nonterminal occurrences. Historical/completed/skipped/cancelled history is immutable.
- The UI must state the edit scope and preview affected future commitments before confirmation.

## 9. Lifecycle and persistence invariants

Recommended occurrence states: `scheduled`, `completed`, `cancelled`, `skipped`, `needs_review`, `superseded`.

When a separate persistence migration is authorized, it must support:
- owner-scoped series and materialized occurrence rows;
- immutable owner identity and server-derived actor fields;
- stable occurrence key and a unique series/key constraint;
- original/effective civil slot, date-only all-day semantics or timed UTC+IANA+resolver/TZDB metadata;
- override/exclusion/review/lifecycle state and optimistic versioning for stale review rejection;
- no direct browser INSERT/UPDATE/DELETE; authenticated trusted Edge Function writes with explicit owner checks;
- same-transaction append-only audit and no physical deletion needed for idempotency.

All owner/actor/canonical UTC/version values must be derived by trusted server code, never accepted from browser JSON.

## 10. Required test matrix

- Rule parser: all four frequencies, interval boundaries, weekday normalization, ordinal selectors, invalid combinations and unknown fields.
- COUNT/UNTIL: inclusive UNTIL, mutually exclusive termination, COUNT behavior with exclusions.
- Month-end/leap: numeric day skip, LAST, 28/29/30/31, leap and non-leap February.
- Identity: same civil slot and key across resolver/TZDB versions, fold choices and moved overrides.
- Materialization: 90-day boundary, 500-row ceiling, paging cursor, retry/concurrency, bounded scans, no overwriting overrides or terminal states.
- DST: Havana, gaps/folds, half-hour transitions, skipped civil date and atomic start/end.
- TZDB review: immutable history, needs_review for changed materialized future slots, fresh/stale acceptance and audit.
- Override: cancellation tombstone, moved identity, duration-only modification and positive duration.
- Real-auth isolation: two disposable users cannot read/write one another's series, occurrences or review actions.
- UI: clear recurrence rule, edit scope and TZDB review; no claim of guaranteed push delivery.

## 11. Explicit non-effects and Human Gates

The domain generator and planner are pure logic. They create no database rows, migrations, RPCs, policies, grants, triggers, cron jobs, audit entries or production data.

A separate explicit Human Gate remains mandatory before hosted DDL/migrations, RLS/grant/Auth/security changes, Edge Function deployment, creation of scheduled jobs, production data operations or release.


## 12. Bounded authoritative resolver transport

The `agenda-time-resolve` Edge Function supports a bounded atomic batch request for multiple timed ranges:

- Request shape: `{ ranges: RangeInput[] }`; each item uses the same validated shape as one atomic Event range, including its own IANA timezone and independent start/end DST choices.
- A batch contains 1–25 ranges. The HTTP body remains bounded at 32 KiB and is rejected before JSON parsing if it exceeds the byte ceiling.
- Results preserve request order and include the UTC range, canonical timezone, resolution metadata, TZDB version and resolver version. One invalid range rejects the complete batch; no partial batch result is returned.
- Every range in a batch is resolved against the same loaded, pinned TZDB release and resolver build. All-day occurrences remain date-only and are excluded from this endpoint.
- This transport limit is separate from the recurrence planner's 90-day horizon and 500-candidate planning ceiling. A planner batch must be split into transport batches of at most 25 timed ranges.
- The endpoint performs no database writes and does not authorize deployment. The trusted write/materialization path remains a separate gated implementation.


## 13. Pure occurrence-to-resolver adapter

The browser/domain adapter joins the recurrence planner with the authoritative batch resolver without performing network calls or persistence:

- It receives planned occurrences and explicit end-local-date-time endpoints keyed by stable `occurrenceKey`.
- It creates request batches of at most 25 timed ranges, preserving occurrence order and the original stable key alongside each request range.
- Start wall time is taken from the occurrence's effective local date/time, IANA zone and approved fold/gap defaults. Moved occurrences resolve their effective local slot while retaining their original key.
- All-day occurrences remain date-only output and are never placed in resolver requests or given artificial UTC instants.
- End wall time is intentionally explicit input. `durationMinutes` is retained as occurrence metadata but is not converted to an end wall time by this adapter until product semantics define elapsed-vs-civil duration over DST transitions.
- Joining validates response count, order (requested start/end local values), timezone, authoritative source, TZDB/resolver version and positive UTC interval before associating returned instants and resolution metadata with the original occurrence key.
- The adapter is pure. It makes no network request, writes no records and does not authorize migrations, Edge Function deployment or production release.
