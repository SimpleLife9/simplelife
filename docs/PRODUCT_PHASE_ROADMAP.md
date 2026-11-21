# SimpleLife — Complete Product Phase Roadmap

**Source:** ChatBending Master, Anexo 141 (20 November 2026)  
**Technical baseline:** `45e49c40e2a04d8c06c2c583ff14e6b4d8dfcc13`  
**Status:** roadmap and dependencies prepared; phases are not implemented by this document.

## Delivery sequence

### Phase 0 — Engineering stabilization and phase readiness

This is a preparation phase, not a new product module. It prevents new features from multiplying the current architectural debt.

**Deliverables**
- Baseline and test evidence recorded.
- Incremental extraction plan for the oversized `App.jsx` and E2E test file.
- Domain/service/UI boundaries established gradually, preserving existing behavior.
- Existing task, goal-relation, Inbox, project and Auth validation gates reconciled.
- Real authenticated test identity lifecycle documented before backend E2E.
- Existing Notes/Ideas, Lists and account/preferences lifecycle gaps closed or explicitly deferred.
- Navigation plan aligned with the approved structure: Hoy, Agenda, Inbox, Mi vida, Espacios.

**Exit gate:** current modules can be safely extended; behavior is covered; unresolved validation gates are explicit; no silent backend/security changes.

**Closeout decision (21 Nov 2026):** CLOSED WITH ACCEPTED DEFERRALS, on Robert's explicit instruction. Pending manual checks remain deferred—not PASS—and are itemized in `BUILD_STATUS.md`. Phase 1 Agenda may begin; its first schema migration remains blocked on the open design contracts below.

### Phase 1 — Agenda and time management (Vision Phase A)

**Objective:** make time visible and manageable without confusing tasks with calendar commitments.

**Deliverables**
- Events/commitments as their own domain, separate from tasks.
- Daily, weekly and monthly calendar views.
- Day timeline.
- Event duration, local timezone semantics and all-day events.
- Availability and overlap/conflict detection.
- Configurable protected time blocks (sleep, meals, gym, family, rest).
- Recurring events/tasks and explicit exception handling.
- Event reminders/countdowns within honest platform capabilities.
- Navigation integration as the Agenda destination.

**Exit gate:** users can create, view, edit, cancel and reschedule events; distinguish events from flexible tasks; see conflicts and protected blocks; recurring series and exceptions behave predictably; persistence, ownership and timezone tests pass.

### Phase 2 — Universal Inbox and intelligent capture (Vision Phase B)

**Objective:** capture anything with minimal friction and turn it into traceable, recoverable information.

**Deliverables**
- Global text/voice capture and transcription.
- Original capture preservation and multi-item splitting.
- Eight categories: task, event, request, habit, goal/subgoal, project, note/idea and list.
- Confidence-aware suggestions and selective clarification.
- Traceable destinations, correction history, deduplication/merge proposals.
- Processing/sync/review/authorization views.
- Recoverable trash, search and safe deletion flow.
- Offline capture, retry and idempotent synchronization design.

**Dependency:** Agenda event contracts must exist before event classification becomes a supported Inbox destination.

### Phase 3 — ARIA intelligent planner (Vision Phase C)

**Objective:** turn tasks, events, availability and user preferences into an explainable daily plan.

**Deliverables**
- Six approved priority criteria: commitments, impact, dependencies, time, context and balance.
- Adaptive Today with one lead action and two next actions.
- Plan proposals and schedule suggestions.
- Accept/edit/reject workflow.
- “Mi día cambió” replanning.
- Protected commitments and explicit Human Gates.
- Optional morning and end-of-day routines.

**Dependency:** requires stable Agenda, task duration/relations and Inbox data. Numerical priority weights remain an open design decision.

### Phase 4 — Habits and training (Vision Phase D)

**Objective:** track consistency and detailed exercise performance without conflating the two.

**Deliverables**
- Habit schedules/frequency, reminders, history, streaks, pauses and exceptions.
- Habit-to-goal relations.
- Separate training sessions/routines/exercises.
- Per-set repetitions, weight, increments and notes.
- Training history, volume and records.

### Phase 5 — Skill Tree and progress dependencies (Vision Phase E)

**Objective:** reveal real prerequisites and routes between goals, projects and decisions.

**Deliverables**
- Dependencies between goals/projects/decisions.
- Prerequisites using goals, metrics, resources, money, time and milestones.
- Skill Tree visualization.
- Clear blocked/unlocked reasons.
- Distinguish hard constraints from “not recommended yet”.
- ARIA suggestions remain proposals until accepted.

### Phase 6 — Statistics and Life Pressure (Vision Phase F)

**Objective:** help review outcomes and respond to repeated postponement with evidence and humane recovery.

**Deliverables**
- Daily/weekly/monthly/yearly statistics.
- Progress, completion, postponement, blocked work and time by life area.
- Weekly review.
- Four configurable states: Normal, Warning, Pressure and Intervention.
- Cause analysis before interventions.
- Reversible, optional, transparent measures and emergency escape.

### Phase 7 — Shared Spaces (Vision Phase G)

**Objective:** coordinate family/work/other groups without sacrificing personal privacy.

**Deliverables**
- Spaces, invitations, members and roles.
- Object/action-level permissions.
- Shared tasks and lists with owners, comments, dates and statuses.
- Requests with accept/reject/counter-propose; a request is not a commitment until accepted.
- Calendar/availability sharing with privacy defaults.
- Audit and revocation.

**Dependency:** requires tested identity/ownership and a granular permission model. Membership alone must not expose private data.

### Phase 8 — ARIA and external-system integrations (Vision Phase H)

**Objective:** bring authorized context from connected systems into planning and review.

**Deliverables**
- Contextual assistant and governed background operations.
- Assistant/copilot/agent autonomy by action scope.
- Initial read-only connections to BattleCruiser and CuevaCoin.
- Metrics with source, unit, period, timestamp and verification state.
- Source systems remain the systems of record.
- External writes require separate authorization and audit.

### Phase 9 — Mobile and operational reliability (Vision Phase I)

**Objective:** make the product resilient across devices and suitable for controlled release.

**Deliverables**
- Encrypted offline data where approved.
- Capture queues, retry, idempotency, conflict handling and recovery.
- Push/reminders/background behavior tested by platform.
- Native app only where PWA capabilities cannot meet required guarantees.
- Export, backup, restore and account deletion.
- Observability, safe logs, rollback, migration recovery and controlled release.

### Phase 10 — Digitalización Vital (Vision Phase J)

**Objective:** make the platform reusable for individuals, families and businesses.

**Deliverables**
- Reusable space templates and workflows.
- Modular integration contracts.
- Customer, packaging, support and commercial model.
- Tenant/privacy/security model for external use.

## Cross-phase backlog (does not replace the phase order)

- Finish the complete Notes/Ideas and Lists maintenance lifecycles.
- Global search.
- Account/profile/preferences and data export/deletion.
- Consistent empty/error/loading states, accessibility and responsive quality.
- Keep the user-approved navigation model consistent.

These items should be attached to the earliest phase whose implementation depends on them, rather than creating standalone parallel work.

## Dependency overview

- Phase 0 → all phases.
- Phase 1 → Phase 2 event classification; Phase 3 planning; Phase 7 shared calendar; Phase 9 calendar sync/offline.
- Phase 2 + Phase 1 → Phase 3.
- Existing goals/projects/tasks → Phase 5.
- Phase 1 + Phase 3 + Phase 4 → stronger Phase 6 measurement.
- Stable ownership/auth + Phase 1 → Phase 7.
- Stable contracts and scopes → Phase 8.
- Reliable sync/data recovery design → Phase 9.
- Stable platform and operating model → Phase 10.

## Rule for complete phases

A phase is delivered as one coherent product capability but may use several small pull requests internally. “Complete phase” does not mean one enormous pull request. It means all parts share one contract, integrate together, pass regression and close with one auditable phase record.
