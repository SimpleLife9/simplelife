# Phase 2 — Universal Inbox and Intelligent Capture

**Status:** Technical kickoff / contract baseline.  
**Integration dependency:** Event destinations remain disabled until Agenda PR #93 is integrated and the authenticated Event writer is available. The provider-independent capture foundation in this PR does not depend on Agenda code.  
**Source of product requirements:** ChatBending Master, Vision Phase B, and `docs/PRODUCT_PHASE_ROADMAP.md`.

## 1. Objective

Make the Inbox the single, low-friction entry point for things the user wants to remember or act on. A capture must remain traceable to its original input, recoverable after processing failures, and safe to correct. Classification is advisory until the user confirms an organization action.

Phase 2 is not the ARIA planner. It does not select what the user should do next, schedule tasks, move commitments, or autonomously change the user's day; those belong to Phase 3.

## 2. Approved product scope

- Global quick capture by text and voice.
- Transcribe voice while preserving the original capture.
- Split one capture containing multiple ideas into independently reviewable parts without losing or rewriting the original.
- Suggest the eight approved category groups: task, event, request, habit, goal/subgoal, project, note/idea, and list.
- Use contextual confidence; ask only when ambiguity is material. Never silently create an incorrect destination.
- Show proposed destinations and preserve the link from every confirmed destination back to its source capture.
- Provide views for clarification, authorization, processing/synchronization, recent activity, and all captures.
- Support correction history, assisted duplicate detection/merge proposals, recoverable trash, search, archive, and explicit permanent deletion.
- Design offline capture, recovery, retry and idempotent synchronization so that loss or duplicate creation is prevented before enabling offline writes.

## 3. Existing baseline — reuse, do not duplicate

The first core migration already defines:

- `capture`: owner and creator, input type (`text|voice|file|import`), original content, capture timestamp, processing/attention/sync states and soft-delete/retention fields.
- `capture_part`: indexed fragments, interpretation, the eight category values and review state.
- `processing_run`: processor version, state, attempt number, idempotency key and JSON result/error evidence.
- `capture_link`: suggested/confirmed/rejected links with confidence and one existing destination FK.
- Existing destination tables for tasks, goals/subgoals, projects, notes/ideas and lists/list items.

The present Inbox already supports manual text capture, original-content search, review/archive/restore, and manual organization as a task, note/idea or list. Phase 2 must extend that flow rather than replace it or create a parallel capture table.

### Destination readiness boundary

Classification and destination creation are different operations.

- Existing destinations may be proposed and confirmed only through their existing validated creation paths.
- An Event may be a supported destination only after Agenda PR #93 is integrated and the authenticated Event contract is available.
- Habit and Request can be classified as suggestions, but cannot create records until their product phases and destination contracts exist.
- A category suggestion must never be represented as a confirmed link when the destination does not exist.

## 4. Processing contract

1. Capture the raw input and persist it before any AI work. A failed processor must never erase the capture.
2. Keep `content_original` unchanged. Transcription, normalized text, fragments, interpretations and corrections are separate derived data.
3. Run classification through a server-controlled processor. Browser code must not contain provider credentials.
4. Treat model output as untrusted input: validate category, confidence, fragment boundaries, ownership context and destination readiness before it is stored or displayed.
5. Persist proposals as unreviewed. Even a high model confidence value is not user consent.
6. Create or link a destination only after explicit user confirmation; revalidate owner scope and destination constraints at the write boundary.
7. Make retries idempotent using the existing processing-run key and destination idempotency boundaries. Replaying a completed attempt must not create extra parts or destination rows.
8. Record processor version, state, result and safe error metadata. Do not store secrets, raw prompts containing credentials, or unnecessary sensitive information in logs.

## 5. Multi-item splitting and provenance

The original capture remains the canonical source. Each proposed part has a stable index and an exact substring of the original, using JavaScript UTF-16 string offsets at the client/domain boundary. Part ranges must be contiguous, non-overlapping and cover the full original string; separators and whitespace are retained as part of adjacent fragments. If the processor cannot establish a lossless split, it must return one whole-capture part or request review rather than dropping text.

Every confirmed destination must retain a traceable `capture_link`. Corrections and future merges must preserve source identity and history; merging is a proposal, never a destructive automatic rewrite.

## 6. Confidence and clarification

The model's numeric confidence is metadata, not a calibrated probability or authorization. Do not invent a universal confidence threshold in this phase kickoff. The processor may mark an interpretation as materially ambiguous and provide a concise clarification prompt. The UI must keep the part unreviewed until the user accepts, edits, rejects or resolves it.

## 7. Voice and media boundary

The schema accepts `input_type='voice'`, but `content_original` is text and there is not yet an established private audio-object lifecycle in the current Inbox implementation. Do not put raw audio bytes or a public media URL in `content_original`.

Before voice recording/transcription is persisted, specify and test: private owner-scoped object storage, upload authorization, short-lived access, transcription provider and region, retention/deletion, retry behavior, offline queue behavior, and how the original audio remains linked to its transcript. No recording/transcription provider or paid API is selected by this kickoff.

## 8. Security, privacy and reliability guardrails

- Preserve RLS and owner isolation across capture, part, processing-run and link joins; add two-user tests for reads and writes.
- The browser must not write processor-owned state or audit records that are meant to be server-controlled.
- Use authenticated Edge Functions/RPC for privileged processing and destination writes; validate the user JWT and derive owner/actor IDs from the verified identity.
- Keep processing credentials server-side. Never add provider keys to Vite variables, browser bundles, Git, or client-visible logs.
- Do not widen grants, weaken RLS, expose public storage, or bypass append-only audit.
- Do not enable offline private-data persistence until encryption, recovery, idempotency, conflict handling and deletion semantics are tested.
- Permanent deletion is a separate explicit action with recoverability/retention safeguards; it is never an incidental side effect of archive or merge.

## 9. Delivery slices

1. **Contract and pure-domain validation (this kickoff):** define categories, lossless part boundaries, unreviewed proposal semantics and the provider-independent boundary.
2. **Text capture foundation:** extract the composer/capture flow into Inbox feature modules without changing behavior; test persistence, source preservation, double-submit protection and owner isolation.
3. **Processing pipeline:** authenticated server-side queue/claim/complete/retry lifecycle backed by `processing_run`; validate outputs and idempotency in ephemeral PostgreSQL/Edge Runtime tests.
4. **Review and destination flow:** confidence-aware suggestions, clarification, correction history and explicit confirmation; gate destinations that are not yet implemented.
5. **Voice capture/transcription:** only after the private audio lifecycle and provider/region/retention choices are testable and approved.
6. **Search, deduplication and recoverable deletion:** traceable proposals and explicit confirmation; no destructive auto-merge.
7. **Offline and synchronization:** design first, then implement only after encryption, retries, conflict recovery and no-duplicate guarantees pass.

Each slice should be a focused PR with exact-SHA CI. The phase closes only when the full end-to-end capability is usable and the required manual acceptance is recorded.

## 10. Acceptance criteria

- Text and voice captures preserve their original source and can be recovered after a processing failure.
- Multi-item captures split without omissions, overlaps or altered source text.
- All eight classifications are validated; suggestions never silently become confirmed destinations.
- Clarification is requested only for materially ambiguous cases; the user can correct or reject proposals.
- Every created destination has a verified owner-scoped provenance link to the original capture.
- Retried processing and synchronization do not duplicate parts, links or destinations.
- Two-user isolation, server-only processor permissions, audit integrity and deletion/retention rules pass automated tests.
- Desktop and physical Android acceptance are recorded separately from Playwright viewport tests.
- No feature is called offline-ready or voice-complete without its platform-specific tests and evidence.

## 11. Explicitly out of scope

- ARIA daily prioritization, scheduling and "my day changed" replanning (Phase 3).
- Habit tracking and exercise logging as a destination system (Phase 4).
- Request acceptance/shared participant workflows (Phase 7).
- Guaranteed background recording, offline private synchronization or push delivery (Phase 9).
- Automatic creation of Event, Habit or Request records before their destination contracts are integrated.
