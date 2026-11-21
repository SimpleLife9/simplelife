# Agenda — recurrence v1 decision proposal

**Status:** PROPOSAL FOR PRODUCT/TECHNICAL REVIEW — none of the choices below are approved by this document.  
**Baseline:** main SHA 6ddf34f75e141bca266b831bd0f4cb3e44d1ff1a  
**Scope:** reconcile the recurring-series contract with the Phase 1 Agenda data contract before implementation.

This proposal does not authorize schema changes, migrations, hosted Supabase operations, scheduled jobs, Edge Function deployment, production data changes, or release.

## 1. Executive recommendation

Adopt a deliberately bounded v1 recurrence engine, preserve stable civil-slot identity, and use bounded materialization rather than generating an unlimited future. Keep all generation deterministic and idempotent. Do not implement full RFC 5545 compatibility.

The recommendations below are a starting point for acceptance. Any product-facing choice remains pending Robert's explicit approval.

## 2. Proposed decisions

### D1 — Recurrence grammar and yearly rules

**Recommendation:** include DAILY, WEEKLY, MONTHLY and YEARLY in v1, using a versioned normalized JSON grammar.

Supported selectors:
- DAILY: interval N.
- WEEKLY: interval N plus a non-empty set of weekdays.
- MONTHLY: interval N plus exactly one selector: day-of-month or ordinal weekday.
- YEARLY: interval N plus month and exactly one selector: day-of-month or ordinal weekday.
- Termination: at most one of COUNT or UNTIL (inclusive local date).
- Exceptions: excluded original local dates and occurrence-specific overrides.

Reject unsupported combinations. No arbitrary RRULE strings, BYSETPOS, multiple selectors, sub-daily recurrence, or implicit RFC 5545 claims. Preserve the original civil slot as occurrence identity.

**Reason:** yearly recurrence is already named in the Phase 1 data contract's v1 implementation default. Including a narrow YEARLY form avoids contradictory product expectations while keeping implementation bounded.

### D2 — Month-end behavior

**Recommendation:** distinguish explicit BYMONTHDAY=31 from BYMONTHDAY=LAST.

- A numbered day that does not exist in a month is skipped; do not clamp to the final day and do not roll into the next month.
- LAST explicitly means the final calendar day of each selected month.
- For yearly rules, the same distinction applies within the selected month.
- Leap-day rules such as February 29 skip non-leap years unless the user explicitly chooses a separate last-day rule.

**Reason:** skipping invalid numbered dates is deterministic and does not silently change the user's chosen day. LAST provides an intentional end-of-month pattern.

### D3 — Materialization horizon and batch size

**Recommendation:** materialize a rolling 90-day horizon, in bounded batches of at most 500 candidate occurrences per transaction. Make both values configuration constants, not user-facing settings in v1.

- Materialize only eligible future occurrences.
- Use a unique (series_id, occurrence_key) constraint and deterministic civil-slot keys.
- Re-running a window must not duplicate rows, reset overrides, or rewrite terminal states.
- If a requested calendar window extends beyond the horizon, calculate a bounded preview and extend materialization in batches before returning authoritative persisted occurrence state.
- Record the generation rule/resolver/TZDB versions used.

**Reason:** the approved TZDB policy needs materialized future occurrences to retain confirmed UTC instants and to enter needs_review when a new TZDB release changes them. Unlimited pre-generation is unnecessary.

### D4 — Materialization trigger and operational ownership

**Recommendation:** no cron or scheduled workflow in v1. Use two deterministic entry points:
1. On series create/edit, materialize the affected range within the rolling horizon.
2. On authenticated Agenda range reads, perform an idempotent top-up when the requested window approaches or exceeds the current materialized boundary.

The top-up must be bounded, concurrency-safe and observable. It must not hold the calendar response open for unbounded work. If load or reliability later requires background processing, propose a separately reviewed job with an explicit operator and Human Gate.

**Reason:** this avoids introducing an always-on scheduler before volume and operational ownership are known, while still keeping the visible calendar populated.

### D5 — DST defaults for recurring timed occurrences

**Recommendation:** use the same defaults already specified for the server resolver and one-off Event behavior:
- Gap: move to the next valid local minute; record requested local value, resolved local value and adjustment.
- Fold: choose the earlier instant by default; allow the later instant only when explicitly selected and stored.
- Resolve start and end atomically against the same loaded TZDB release and resolver version.
- All-day recurrence remains date-only and bypasses UTC resolution.

Series-level choices are inherited; an explicit occurrence override takes precedence. A later TZDB change follows the already-approved review-and-acceptance policy, never a silent shift.

**Reason:** one consistent temporal model reduces surprise and avoids divergent DST behavior between one-off and recurring Events.

### D6 — Occurrence-specific duration/end overrides

**Recommendation:** inherit duration/end semantics from the series by default, but allow an occurrence to override its end/duration. Keep the original series rule unchanged.

- The override is attached to the stable original occurrence key.
- Validate positive duration after timezone resolution.
- Record actor, timestamp and old/new values in append-only audit evidence.
- Editing one occurrence must not rewrite adjacent occurrences.
- A series-wide duration change previews affected future occurrences and follows the selected edit scope.

**Reason:** real schedules occasionally need a single longer or shorter instance; forcing a series split for every exception would be cumbersome. Audit and stable identity preserve traceability.

### D7 — Task-to-occurrence linking

**Recommendation:** defer direct Task-to-occurrence linking from recurrence v1.

- A recurring Event remains independent of Task identity.
- Existing TaskSchedule remains the only Phase 1 relationship between a Task and a reserved time block.
- Do not create a Task automatically for each occurrence.
- Revisit only after the product defines whether a Task links to a whole series, one occurrence, or both, and how completion/cancellation should propagate.

**Reason:** the current contracts intentionally separate Event and Task lifecycles. An ambiguous relationship would create coupling and status-propagation risks.

### D8 — TZDB review notification and stale-review behavior

**Recommendation:** use an in-app Agenda review queue with a visible count and side-by-side prior/new local and UTC resolutions. No push, email, or guaranteed PWA alarm is promised in v1.

- A review item remains visible until accepted or dismissed through an explicit supported action.
- Acceptance is bound to the exact occurrence version and comparison that the user reviewed.
- If the occurrence changed, was cancelled, or the TZDB candidate changed after the review was generated, reject the stale action and refresh the comparison.
- Acceptance updates only that occurrence and appends audit evidence atomically.
- Dismissal must not silently accept the new instant; the occurrence retains its confirmed instant until a later explicit decision.

**Reason:** this honors the approved no-silent-shift policy without introducing an unreliable notification delivery promise.

## 3. Contract reconciliation required

The current documents describe two different occurrence strategies:

- PHASE_1_AGENDA_DATA_CONTRACT.md recommends calculating ordinary occurrences for the requested calendar window and persisting only exceptions/overrides.
- AGENDA_RECURRING_SERIES_CONTRACT.md describes persisted occurrence lifecycle states, rolling-horizon materialization, and stable stored UTC instants.

These approaches cannot both be the authoritative persistence model for the same future occurrence. The TZDB policy approved on 21 November requires already-materialized future occurrences to preserve confirmed UTC instants and enter review if a new TZDB release changes their resolution.

**Recommendation:** use a hybrid bounded model:
- Persist the series definition.
- Materialize timed occurrences inside the rolling horizon so confirmed UTC instants and TZDB versions are durable.
- Persist exceptions, exclusions, overrides, review states and terminal lifecycle states.
- Calculate farther-future occurrences as previews only; do not represent those previews as confirmed persisted commitments.
- Keep occurrence keys based on the original local civil slot, independent of UTC/TZDB.
- Never silently replace an existing materialized occurrence with a recomputed preview.

Before implementation, reconcile the two contracts explicitly and remove the conflicting virtual-only recommendation if this hybrid model is accepted.

## 4. Acceptance checklist

- [ ] D1 — grammar and yearly support accepted.
- [ ] D2 — month-end and leap-day behavior accepted.
- [ ] D3 — horizon and batch accepted.
- [ ] D4 — triggers and operational ownership accepted.
- [ ] D5 — recurring DST defaults accepted.
- [ ] D6 — occurrence duration override accepted.
- [ ] D7 — Task link deferred accepted.
- [ ] D8 — in-app TZDB review behavior accepted.
- [ ] Hybrid materialization model accepted and both contracts reconciled.

## 5. Required tests before persistence implementation

- Grammar parser: every supported selector, invalid combinations, COUNT/UNTIL boundaries, yearly leap-day cases.
- Month-end: day 28/29/30/31, explicit LAST, leap and non-leap February.
- Materialization: exact horizon boundary, 500-row batch boundary, retry, concurrent workers, partial failure and continuation.
- Identity: same civil slot across TZDB versions has the same key; moved override retains original key.
- DST: gap, fold earlier/later, 30-minute transition, skipped civil date, atomic start/end range.
- TZDB review: historical immutable, materialized future review, unmaterialized future uses approved rules, stale acceptance rejected, accepted change audited.
- Duration override: one occurrence only, positive duration, series unchanged, audit append.
- Ownership: two real-auth disposable users cannot read/write each other's series, occurrences or review actions.
- UI: recurrence editor states the rule and edit scope clearly; review queue explains prior/new resolution without implying push delivery.

## 6. Explicit gates and non-effects

This is a proposal only. It creates no schema, migrations, policies, grants, triggers, RPCs, Edge Functions, cron jobs, audit records, users, series or occurrences. It changes no hosted Supabase state and deploys nothing.

A separate explicit Human Gate remains mandatory before any hosted DDL/migration, RLS/grant/Auth/security change, Edge Function deployment, scheduled job, production data operation, or release.
