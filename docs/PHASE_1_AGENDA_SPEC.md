# Phase 1 — Agenda and Time Management: Product/Technical Contract

**Roadmap mapping:** Vision Phase A  
**Status:** DESIGNED / OPEN DESIGN DECISIONS — not implemented  
**Prepared:** 20 November 2026  
**Prerequisite:** Phase 0 engineering stabilization

## 1. Product objective

Give the user one reliable place to see and manage time-based commitments. The Agenda must distinguish calendar events from flexible tasks and must not silently create, move or cancel commitments.

## 2. Core domain distinction

| Object | Meaning | Time semantics |
|---|---|---|
| Task | Work that should be completed. | May have a target date and estimated duration. It does not occupy calendar time unless explicitly scheduled. |
| Event | A time-based commitment or activity. | Has a start and end, or is all-day; occupies calendar time. |
| Request | A proposal asking someone to make or accept a commitment. | Not a confirmed event until accepted. Full shared request workflow belongs to Phase 7. |

Do not implement Agenda by storing events as tasks or overloading task due dates.

## 3. User journeys

1. Open Agenda from primary navigation and see the current date with a clear daily timeline.
2. Switch between day, week and month.
3. Create an event with title, optional details, date, start/end time or all-day setting.
4. Edit, reschedule or cancel an event and see the change immediately after confirmed persistence.
5. See overlaps between events and protected time; the UI explains the conflict and offers a choice instead of silently moving either item.
6. Define protected blocks such as sleep, meals, gym, family or rest.
7. Create a recurring event, review upcoming occurrences and change one occurrence or the series according to explicit recurrence rules.
8. See tasks with due dates as tasks, separate from events; scheduling a task must be an explicit action.

## 4. Functional scope

### Calendar
- Daily, weekly and monthly views.
- Day timeline with timezone-aware labels.
- Clear all-day section.
- Navigate previous/next period and return to today.
- Responsive behavior for narrow mobile screens; avoid dense horizontal overflow.
- Empty, loading, error and no-permission states.

### Events
- Create, read, update, cancel and restore where allowed by the selected lifecycle.
- Title required; description/details optional.
- Start and end must be valid; end must be after start.
- Explicit all-day behavior.
- Event timezone is retained so a commitment does not shift unexpectedly when viewed elsewhere.
- Event status and cancellation are visible; do not physically delete records unless a separately authorized data contract permits it.

### Protected time
- User-defined blocks, including a label/category and time range.
- Private by default.
- Conflict warnings are informational until the user chooses what to do.
- The user may configure whether a block is hard-protected or flexible; exact policy/priority is an open design decision.

### Recurrence
- Recurrence rules and exceptions are part of Phase 1, but the rule format is not yet approved.
- The design must cover: one occurrence, this-and-following, entire series, skipped dates, moved occurrence and series end.
- Must avoid duplicate occurrences during retries and daylight-saving/timezone transitions.
- Do not ship an incomplete recurrence editor that can silently rewrite an entire series.

### Availability and conflicts
- Detect event overlap using timezone-normalized intervals; present the local time to the user.
- Event intervals use a consistent half-open model [start, end) so adjacent events do not conflict.
- Protected blocks participate in conflict detection.
- Future availability sharing with other people is reserved for Phase 7 and remains private by default.

## 5. Proposed logical model (not a migration)

Candidate domain concepts only; exact tables/columns and constraints must be decided after repository/schema inspection and the Phase 0 modularization work.

- **CalendarEvent:** owner, title/details, start/end, timezone, all-day flag, status, optional recurrence-series reference and audit timestamps.
- **EventRecurrenceSeries:** recurrence definition, timezone semantics, start/end boundary and series lifecycle.
- **EventOccurrenceException:** occurrence date/identity, moved/cancelled override and link to the series.
- **ProtectedTimeBlock:** owner, label/category, time range or recurrence, protection mode and active state.
- **EventAudit/History:** actor, action and relevant before/after metadata if required by the final audit model.

Potential implementation choices (RRULE, generated occurrences, materialized instances, or hybrid) remain open. Do not create tables from these nouns without the final schema/permission contract.

## 6. Date, time and timezone contract

- Use the authenticated user's saved timezone preference for rendering and event interpretation.
- Current profile bootstrap defaults to `America/Havana`; users must not be forced to that timezone if their preference is later changed.
- Store instants in a timezone-safe representation and retain the event's IANA timezone where local wall-clock intent matters.
- All-day events are date-based, not midnight UTC timestamps.
- Define behavior for daylight-saving gaps and repeated local times before recurrence is released.
- Keep date-only task deadlines distinct from event instants.
- Avoid parsing locale-formatted date strings as machine values.

## 7. Data ownership and security

- Personal events and protected blocks are private to their owner.
- Every read/write must be scoped through the authenticated identity and verified RLS.
- No client-side service-role credential.
- Do not expose events to ARIA, other accounts, shared spaces or business connectors in Phase 1.
- Do not add schema migrations, RLS policies or grants until the final model, rollback and test identities are documented.
- Use the existing development project only after a controlled test lifecycle is prepared. No production changes.

## 8. UI/navigation contract

The approved top-level navigation is Hoy, Agenda, Inbox, Mi vida and Espacios. Agenda is introduced as a real working section in this phase; do not expose non-functional placeholder destinations for later phases.

Agenda should provide:
- day/week/month view switch;
- current period label;
- previous/next/today controls;
- a primary “Nuevo evento” action;
- event details/editing;
- conflict and protected-time explanations;
- a clear visual distinction between events and tasks.

The existing task workflow remains available and must not regress.

## 9. Explicit exclusions

- AI classification from Inbox (Phase 2).
- Automatic daily planning and task rescheduling by ARIA (Phase 3).
- Shared event participants, invitations and request acceptance workflow (Phase 7).
- Push-notification guarantees, native alarms and reliable background execution (Phase 9).
- External calendar integrations unless separately scoped and authorized.
- Public release.

## 10. Acceptance criteria

### User-visible
- [ ] User can create and edit an event with a valid time range.
- [ ] User can create an all-day event and it stays on the intended local date.
- [ ] User can navigate day/week/month and return to today.
- [ ] User sees events in the correct local timezone.
- [ ] User can cancel/restore according to the approved lifecycle.
- [ ] User can create/edit protected blocks and distinguish their protection mode.
- [ ] Event overlaps and protected-time conflicts are visible and explainable.
- [ ] Recurrence can be created and edited at occurrence/series level without duplication or unintended mass changes.
- [ ] Agenda works at desktop and 390px mobile widths.
- [ ] Tasks remain distinct and all existing task flows pass regression.

### Engineering/security
- [ ] Domain date/time/conflict/recurrence tests cover edge cases including DST transitions.
- [ ] E2E covers creation, editing, calendar navigation, conflicts, protected blocks and recurrence.
- [ ] A controlled real-auth persistence smoke is completed if database writes change.
- [ ] RLS owner isolation and allowed operations are verified for every new persisted object.
- [ ] Migration/rollback is reproducible; no hidden manual SQL.
- [ ] Merged-SHA CI passes; manual PASS is recorded separately.
- [ ] PWA update/cache behavior is unchanged unless specifically tested.

## 11. Open design decisions to resolve before the first schema migration

1. Event categories and whether events can be linked to goals/projects/tasks.
2. Event visibility/private metadata and future participant model.
3. Recurrence representation and which edit scopes are supported in v1.
4. How protected time is defined: one-off, weekly pattern, or both.
5. Hard-protected versus flexible-block behavior and warning presentation.
6. Whether events can span midnight and maximum supported duration.
7. Whether a task can be scheduled into one or multiple calendar slots.
8. Reminder channels available in the current PWA and their honest reliability guarantees.
9. Exact event history/audit requirements and soft-delete/cancel rules.
10. Timezone-change behavior for future recurring commitments.

**Implementation rule:** resolve these choices through a concise design pass using the existing database schema and user workflows as evidence. Prefer simple defaults, but explicitly record which defaults are provisional. Only then build the first complete Agenda vertical slice.
