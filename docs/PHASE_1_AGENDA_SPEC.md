# Phase 1 — Agenda and Time Management: Product Contract

**Roadmap mapping:** Vision Phase A  
**Status:** PRODUCT CONTRACT APPROVED / TECHNICAL IMPLEMENTATION IN PROGRESS — not implemented  
**Prepared:** 21 November 2026  
**Prerequisite:** Phase 0 closed with accepted deferrals at main SHA `207ce9388f1fb192254b9212dffe9f9df273187e`

## 1. Product objective

Give the user one reliable place to see and manage time-based commitments. Agenda is a view over the user's original records, not a second task store. It must distinguish events, task reservations, flexible tasks, protected time and (in later phases) habits and requests.

The design must protect the user's commitments and personal time. It must never silently create, move, cancel or confirm a commitment.

## 2. Authority and product decisions already approved

The functional rules below are approved in ChatBending. They are not open questions and must not be re-opened as if Robert had not decided them:

- **Anexo 5:** protected time includes sleep, meals, gym/training, family, rest and user-defined blocks. ARIA may not automatically consume protected time; it must explain and ask before an exception. The user can always change their own blocks.
- **Anexo 49:** hybrid day/week/month calendar with a daily timeline; Agenda reads the same source records as Hoy; assisted planning is the starting autonomy level; commitments are protected; conflicts are explained rather than resolved by silently cancelling important items.
- **Anexo 61:** conceptual entities Event, EventOccurrence, EventParticipant, TaskSchedule, AvailabilityBlock and Reminder. A task may have multiple schedules. Agenda does not duplicate tasks or events.
- **Anexo 64:** recurring events use a series and identifiable occurrences; exceptions can skip, move or alter an occurrence without destroying the series; recurrence, synchronization and delivery are idempotent. PWA delivery is never described as guaranteed without platform evidence.
- **Anexo 71:** date-only, local civil time and fixed universal instant are distinct. Store IANA timezone identifiers, not fixed UTC offsets. Travel does not silently rebase commitments. Timezone rule changes must be respected.
- **Anexo 76:** a Request and its resulting Event are separate identities. Accepting a Request is the authoritative acceptance; event creation/linking must be idempotent.
- **Anexo 77:** Event functional states are En preparación, Propuesto, Confirmado, Cancelado and Finalizado. Functional status, planning, authorization, synchronization and lifecycle are separate dimensions.
- **Anexo 82:** TaskSchedule states are Propuesta, Confirmada, Cancelada, Liberada and Transcurrida. A schedule never changes the task's execution state.
- **Anexo 85:** physical events use the venue's timezone; online meetings default to the creator's configured timezone at creation unless an explicit timezone/UTC instant exists; international event sources keep their stated temporal reference; all-day events are calendar dates, never fabricated midnight instants.

These rules establish the product contract. Remaining technical choices are identified separately in `docs/PHASE_1_AGENDA_DATA_CONTRACT.md`.

## 3. Core domain distinction

| Object | Meaning | Time semantics |
|---|---|---|
| Task | Work that should be completed. | May have a due date/time and estimated duration. It does not occupy calendar time unless explicitly scheduled. |
| Event | A commitment or activity with its own identity. | Timed interval or calendar-date range; occupies calendar time. |
| TaskSchedule | One reserved block for an existing task. | Timed interval; a task may have multiple schedules. It is not another task. |
| ProtectedTimeBlock | Personal time the user chooses to protect or reserve. | One-off or recurring calendar interval; private by default. |
| Habit occurrence | An instance of a habit definition. | Governed by Habit and HabitOccurrence; the Habits module belongs to Phase 4. |
| Request | A proposed commitment requiring another person's response. | A pending request is not a confirmed Event. Shared request workflow belongs to Phase 7. |

Never store an Event in `task`, overload `task.due_date` as a calendar event, or create duplicate task rows to display a task in Agenda.

## 4. Primary user journeys

1. Open Agenda from the main navigation and see the current date and daily timeline.
2. Switch between day, week and month; move to previous/next period and return to today.
3. Create a timed or all-day event, preview its interpreted time and timezone, and save it.
4. Open an event, edit it, cancel it, archive it or restore it according to its separate status/lifecycle.
5. See overlapping events and conflicts with protected time; understand what overlaps and choose what to change.
6. Define one-off or recurring protected blocks such as sleep, meals, gym, family or rest.
7. Schedule an existing task into one or more time blocks without creating another task.
8. Create recurring events, inspect upcoming occurrences and choose whether an edit applies to one occurrence, this and following, or the whole series.
9. See task due dates and unscheduled tasks as tasks, distinct from events and reserved task time.
10. Navigate from a scheduled task to its original task and its existing goal/project context.

## 5. Calendar and display contract

- Day, week and month views show the same underlying entities; only presentation changes.
- Day view includes an all-day lane, a timezone-aware timeline, events, task reservations, protected blocks and a separate list of flexible/unscheduled tasks.
- Week view presents the seven-day distribution with clear event, task-schedule and protected-block distinctions.
- Month view presents event date ranges, deadlines and milestone markers without duplicating the source records.
- Clicking a date opens that day's view.
- Confirmed, proposed and provisional times must be visually distinct.
- Events, tasks, task reservations and protected time need distinguishable labels/statuses; colour alone must not communicate meaning.
- Provide loading, error, empty, offline/sync-uncertain and no-permission states.
- Responsive layout must work at desktop and 390px widths without forcing a dense horizontal calendar on a phone.

## 6. Events

### Required behavior

- Create, read, edit, cancel, reopen where authorized, archive, restore and move an Event.
- Title is required; description and location are optional.
- A timed Event has a valid start and end; its end must be after its start.
- An Event may cross midnight or span multiple days. Do not truncate it to one calendar day.
- All-day Events use inclusive start date and exclusive end date; a one-day event is represented by `end_date = start_date + 1 day`. No UTC midnight is invented.
- Direct creation by the user saves a Confirmed Event. Propuesto and En preparación remain available for future governed proposals/drafts; they are not silently treated as confirmed.
- Cancellation changes the Event's functional state; archive/trash are separate lifecycle operations. Cancellation does not erase the original time or history.
- Overlapping events are warnings, not a database prohibition: a user may intentionally confirm an overlap after reviewing it.

### Time interpretation

- Physical event with an identifiable venue: use the venue's IANA timezone.
- Online meeting with no explicit source timezone/instant: use the creator's saved timezone at creation; later travel or preference changes do not change the event.
- If an invite/source provides a timezone or UTC instant, respect it.
- International source events retain their published time reference.
- Ask a short clarification only when multiple plausible interpretations materially change the commitment.
- Before confirmation, show the resolved date/time, timezone and whether the event preserves a civil time or a fixed instant when that distinction matters.

## 7. Protected time and conflicts

- Protected blocks are personal and private by default.
- Support one-off blocks and recurring weekly patterns.
- Each block has a user-facing label and a protection mode: hard-protected or flexible-protected.
- Both modes are protected from automatic ARIA scheduling. ARIA may not consume, move or displace either mode without asking first.
- Proposed UI behavior: a hard-protected overlap requires an explicit user override before saving; a flexible-protected overlap shows a clear warning and requires the user to choose whether to keep the overlap. This is a proposed interaction default, not a new authorization for ARIA.
- The user may move/delete their own block or intentionally override it.
- Conflicts use half-open intervals `[start, end)`; adjacent blocks where one ends exactly as the next begins do not conflict.
- Do not use a PostgreSQL exclusion constraint to prohibit all overlap: conflicts must be visible and explainable, and deliberate overlaps remain possible.

## 8. Task scheduling

- Scheduling is an explicit user action; a task with only a date remains a task/deadline, not an event.
- A task can have multiple TaskSchedule blocks.
- Each TaskSchedule has its own identity, owner, time range and status: Propuesta, Confirmada, Cancelada, Liberada or Transcurrida.
- Creating, cancelling, releasing or allowing a TaskSchedule to become Transcurrida never completes, cancels or deletes its Task.
- Agenda and Hoy resolve the same original task ID; no copy is created.
- Phase 1 begins with manual scheduling. ARIA scheduling suggestions and flexible task replanning belong to Phase 3.

## 9. Recurrence and occurrences

- Support daily, weekly, monthly and yearly civil-time recurrence, with intervals, applicable weekdays/month days, start date and optional end date/count.
- A recurring series preserves its identity and IANA timezone. Each occurrence has a stable identity derived from the series and its original scheduled local date/time; moving an occurrence does not change its original occurrence key.
- Support skip/cancel, move and field override for one occurrence.
- The edit scope must be explicit: this occurrence; this and following; or the whole series.
- Editing one occurrence does not rewrite the series.
- Editing this and following splits the series at the selected original occurrence; earlier occurrences remain attached to the original series.
- Editing the whole series changes future generation only; completed/past history is never silently rewritten.
- A new occurrence does not complete, cancel or remove an overdue occurrence.
- Generation and exception writes are idempotent; unique occurrence keys prevent duplicates on repeated loads/retries.
- Civil-time recurrences keep their chosen local wall-clock time, not rigid 24-hour UTC intervals.
- Apply the approved timezone resolution: a nonexistent local occurrence moves to the next valid local time and records the adjustment; a repeated local time uses the first occurrence by default unless the user selects otherwise.
- Fixed-instant Events are not repeated as civil-time series in the initial recurrence editor; recurring commitments use a zone-bound local-time rule.

## 10. Reminder and notification boundary

- Phase 1 may show in-app upcoming-event indicators/countdowns while the application is active.
- Do not claim guaranteed PWA alarms, exact-time delivery, background execution, or that a push was displayed/read.
- Persisted reminder preferences, delivery jobs, native alarms and cross-platform reliability belong to the later operational/mobile scope unless a separate bounded slice is approved.
- A reminder never changes the status of its source Event or Task.

## 11. Data ownership, privacy and security

- Phase 1 Events, ProtectedTimeBlocks and TaskSchedules are personal and private to their owner.
- Do not expose them to other accounts, Spaces, ARIA background operations or business connectors in this phase.
- Every query/write is owner-scoped and additionally enforced by RLS through the authenticated identity's `user_profile`.
- No client-side service-role key. No direct authenticated insert into `audit_event`; its existing append path is protected.
- No physical DELETE privilege. Use the approved lifecycle/tombstone and recovery behavior.
- No sharing/participants, Request processing or external calendar access in Phase 1.
- The exact migration, rollback and real-auth smoke plan must be reproducible from the repository before any DDL is applied.

## 12. Navigation and exclusions

Agenda is introduced as a real primary-navigation destination alongside Hoy, Inbox and the existing working sections. Do not add non-functional placeholders for later destinations Mi vida or Espacios.

Explicit exclusions:
- Inbox AI classification / voice capture (Phase 2).
- Automatic daily planning, ARIA scheduling and replanning (Phase 3).
- Habits and training (Phase 4).
- Shared EventParticipants, invitations and Request acceptance (Phase 7).
- External calendar integrations (later governed integration phase).
- Guaranteed push notifications, native alarms and reliable background execution (Phase 9).
- Offline private-data synchronization (Phase 9).
- Public release.

## 13. Acceptance criteria

### Product
- [ ] Day/week/month show coherent representations of the same events and task identities.
- [ ] User can create/edit/cancel/reopen/archive/restore a timed Event.
- [ ] All-day Events remain on the intended calendar dates and never shift through UTC conversion.
- [ ] Physical/online/international temporal defaults follow the approved context rules.
- [ ] Travel or a preference change does not silently move confirmed commitments.
- [ ] Midnight-spanning and multi-day events render correctly.
- [ ] User can create one-off and recurring protected blocks and override them intentionally.
- [ ] Hard/flexible protection and conflict warnings are understandable.
- [ ] One Task can have multiple TaskSchedule blocks without duplication or changing Task status.
- [ ] Recurrence can be created and edited at the required scopes; exceptions and retries do not duplicate/rewrite unrelated occurrences.
- [ ] Tasks with dates and flexible tasks remain distinct from calendar Events.
- [ ] Mobile and desktop layouts remain usable.

### Engineering and security
- [ ] Domain tests cover civil-time conversion, fixed instants, all-day ranges, DST gaps/folds, multi-day intervals, half-open conflicts, occurrence identity and idempotency.
- [ ] E2E covers Event CRUD, calendar navigation, protected blocks, conflicts, TaskSchedule and recurrence scope behavior.
- [ ] Owner isolation and allowed operations pass real Postgres/RLS tests for every new table.
- [ ] Rollback is reproducible; schema changes are tracked in repository migrations.
- [ ] Controlled real-auth persistence smoke passes for each new persisted capability.
- [ ] CI passes on PR head and exact merged SHA; manual PASS and persistence evidence remain separate.
- [ ] PWA cache/service-worker behavior is unchanged unless specifically tested.

## 14. Remaining technical decisions

Product decisions above are approved. The remaining engineering decisions are tracked in `docs/PHASE_1_AGENDA_DATA_CONTRACT.md`: versioned recurrence serialization and exception storage; deterministic occurrence identity; storage/validation of local civil time versus fixed UTC instant; source and versioning of timezone rules; query/index/retention details; RLS/grants and the append-only audit path; and a reproducible migration baseline.

**Implementation rule:** finish the domain/data/security verification dossier and restore a repository-tracked migration baseline before the first functional database PR. Do not apply SQL manually or create a new hosted migration that cannot be replayed and rolled back from the repository.
