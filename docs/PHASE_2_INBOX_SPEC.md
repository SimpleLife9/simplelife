# Phase 2 — Universal Inbox and Intelligent Capture

**Status:** Implementation consolidated in PR #97 (OPEN / DRAFT / NOT MERGED). The original kickoff sections below are retained as the product contract; the 24 November checkpoint records which capabilities have since been implemented and verified in DEV.  
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

The schema accepts `input_type='voice'`, while `content_original` remains text. The current integration branch now implements a private audio-object lifecycle in DEV: a non-public `inbox-voice-private` bucket, owner/asset-scoped object paths, an upload state that cannot be promoted by the browser, server-side finalization that validates the stored byte size; the SHA-256 is currently computed by the browser and stored as metadata, not recomputed against the uploaded bytes on the server, and bounded retention for abandoned/unlinked audio. The UI records audio but never places raw bytes or a public media URL in `content_original`.

**Not implemented yet:** speech-to-text/transcription and any provider request. The owner authorized Cloudflare Workers AI as a possible fallback on 24 November, but explicitly prefers ARIA's canonical Model Routing after its planned recovery on 26 November. Do not activate either provider path until that integration is assessed. Record the chosen model, processing region, data-retention terms, and free-only quota before the first real request.

## 8. Security, privacy and reliability guardrails

- Preserve RLS and owner isolation across capture, part, processing-run and link joins; add two-user tests for reads and writes.
- The browser must not write processor-owned state or audit records that are meant to be server-controlled.
- Use authenticated Edge Functions/RPC for privileged processing and destination writes; validate the user JWT and derive owner/actor IDs from the verified identity.
- Keep processing credentials server-side. Never add provider keys to Vite variables, browser bundles, Git, or client-visible logs.
- Do not widen grants, weaken RLS, expose public storage, or bypass append-only audit.
- Offline private capture is implemented behind the user-unlocked vault in the integration branch: AES-GCM ciphertext in IndexedDB, passphrase-derived key wrapping, a one-time 256-bit recovery key, stable capture/part IDs and acknowledgement-gated local deletion. Automated encryption/recovery/sync tests and SQL owner/idempotency tests pass in CI. Keep platform acceptance, conflict/recovery behavior on real devices and final owner sign-off as open gates; never bypass the locked-vault boundary.
- Permanent deletion is a separate explicit action with recoverability/retention safeguards; it is never an incidental side effect of archive or merge.

## 9. Delivery slices

1. **Contract and pure-domain validation (this kickoff):** define categories, lossless part boundaries, unreviewed proposal semantics and the provider-independent boundary.
2. **Text capture foundation:** extract the composer/capture flow into Inbox feature modules without changing behavior; test persistence, source preservation, double-submit protection and owner isolation.
3. **Processing pipeline:** authenticated server-side queue/claim/complete/retry lifecycle backed by `processing_run`; validate outputs and idempotency in ephemeral PostgreSQL/Edge Runtime tests.
4. **Review and destination flow:** confidence-aware suggestions, clarification, correction history and explicit confirmation; gate destinations that are not yet implemented.
5. **Voice capture/transcription:** private voice recording/storage is now implemented in DEV; transcription remains disabled until ARIA routing is restored or an explicitly approved fallback is selected and its region/retention/quota policy is confirmed.
6. **Search, deduplication and recoverable deletion:** traceable proposals and explicit confirmation; no destructive auto-merge.
7. **Offline and synchronization:** the encrypted local vault and idempotent sync path are implemented and covered by automated tests; finish owner acceptance on desktop and physical Android, including airplane-mode reopen, recovery-key rotation, reconnect and duplicate-free retry.

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


## 12. Implementation checkpoint — 23 November 2026

**Status: OPEN / DRAFT / NOT MERGED; Phase 2 is not owner-accepted or closed.** Consolidated delivery is tracked in [PR #97](https://github.com/SimpleLife9/simplelife/pull/97). The 24 November DEV baseline and its evidence are recorded below; every subsequent branch commit still requires exact-SHA CI.

### Delivered in the integration branch

- Lossless text capture foundation, with original text retained and first fragment persisted.
- Secure processing_run queue with owner-scoped enqueue, UUIDv7 idempotency keys, leases, claim/complete/fail lifecycle, bounded retry state and stale-lease rejection.
- Owner-authenticated processing bridge. The browser can only request a run visible through its own RLS-scoped client; service-role operations remain server-side.
- Provider-free deterministic rules processor (inbox-rules-v1) that proposes the eight categories. This is explicitly **heuristic processing, not an AI model**; confidence is heuristic affinity, not a probability.
- Multi-item splitting only at explicit list/bullet boundaries. The SQL completion RPC validates that concatenating every stored fragment reconstructs content_original exactly. Parts remain unreviewed.
- Inbox UI processing/retry control, per-part review, manual correction, rejection, and explicit task, Agenda Event, existing Goal/Subgoal, Project, note/idea and list destination confirmation. Existing objectives are linked rather than duplicated; no destination is created by classification.
- Owner-scoped, audited, recoverable trash with a 30-day retention window and idempotent restore/trash RPCs.
- Authenticated Inbox → Agenda Event creation through the existing idempotent Agenda writer, with a single-target owner-scoped provenance link to `calendar_event`.
- Indexed full-text search across the complete capture archive, paginated in 100-row pages rather than limited to the latest 250 captures.
- Normalized duplicate discovery across all active captures belonging to the owner. Duplicates are never merged or deleted automatically.
- Secret-only bounded retry dispatcher (maximum 10 jobs per invocation) that reclaims due/expired leases, persists proposals atomically and marks transient failures retryable. Its scheduled invocation is now configured in `Simplelife_dev` through `pg_cron` and a Vault-held token; production remains untouched.
- CI coverage for classifier and worker contracts, browser desktop/mobile, ephemeral PostgreSQL RLS/lifecycle/audit, Edge Runtime smoke, Deno type checks and production build.


- All capture-level attention transitions (needs review → reviewed/archived and return to pending) now use an owner-authenticated, idempotent RPC with before/after audit. Repeating the same state is a no-op and does not duplicate audit records.
- Processed captures re-fetch their proposal metadata by capture ID before opening the review confirmation gate; confirmation is disabled while verification is pending or unavailable. This avoids relying on only the latest 100 queue rows and fails closed on missing metadata.
- Trash, restore and part-review RPCs validate UUIDv7 audit IDs. Part review locks the parent capture before its part so review cannot race past trash or retention deletion.
- Per-fragment correction history is exposed in the Inbox UI; it shows the prior/new category, interpretation and review status with timestamp. Audit reads are constrained by owner RLS.
- Proposals marked as materially ambiguous carry a concise contextual clarification question and require a non-empty owner-provided answer in the review dialog before confirmation; the answer is written to the audited interpretation field while `content_original` stays unchanged. Request/Habit suggestions remain their own unimplemented destination types and cannot be confirmed as Tasks by default.

### Remaining exit gates — reconciled 24 November 2026

1. **Transcription + model-backed classification:** voice recording is stored privately, but no speech-to-text or external classification call is active. The owner authorized Cloudflare Workers AI as a fallback, with ARIA's canonical Model Routing preferred after its planned recovery on 26 November. Provider integration remains deferred; maintain deterministic rules as the safe baseline. No paid usage is authorized.
2. **Offline owner acceptance:** encrypted IndexedDB vault, passphrase/recovery-key wrapping, stable IDs and idempotent sync are implemented; CI covers the cryptographic and SQL contracts. Desktop and physical Android acceptance are still pending, including secure recovery-key storage, airplane-mode restart, reconnect and duplicate-free retry.
3. **Scheduler E2E with a real owner-owned DEV capture: PASS — 24/11/2026.** The real scheduled cron processed one disposable owner capture (`claimed=1`, `succeeded=1`), preserved the source exactly, left both parts unreviewed and created zero destinations. Terminal idempotency was verified and all fixture rows were removed. A separate manual trigger returned one transient 503; the next scheduled cycle passed.
4. **Hosted retention E2E:** text-capture purge is PASS — 24/11/2026, with deletion of a disposable expired capture and a content-free audit receipt. Physical Storage deletion of an expired voice object remains unverified; the Deno suite covers Storage failure, malformed response and retry ordering, but that is not a hosted-object E2E.
5. **Manual acceptance:** desktop and physical Android acceptance remain pending. Playwright desktop/mobile viewports do not replace the owner's real devices.
6. **Provider/privacy record:** before the first AI/audio request, record the exact model, provider route, data region, retention terms, quota/free-only guard, timeout and fallback behavior. Do not send private capture/audio to a provider before that preflight.
7. **Destination readiness:** Inbox can link to existing Goal/Subgoal and Project records and create Events through Agenda. Habit and Request remain proposals only because their owning destination workflows belong to later product phases.

### DEV technical evidence — 24 November 2026

- Repository branch `feat/phase2-inbox-completion-v1`; deployed backend baseline SHA `5be9e0509d09d85ade9079a65960fa629635e997`; GitHub Actions [CI #775](https://github.com/SimpleLife9/simplelife/actions/runs/45314068626) SUCCESS, 44/44 steps, including Playwright desktop/mobile, Deno/type checks, 10 Inbox SQL suites, five Edge Runtime checks and production build. Later UI/documentation commits require their own exact-SHA CI.
- `Simplelife_dev` (`iybnjrnysiikbtokyshg`) reports all 21 repository migrations applied. Queue/worker/process/dispatcher/scheduled functions are ACTIVE. The private `inbox-voice-private` storage bucket is non-public.
- `simplelife-inbox-dispatcher` is active on `* * * * *`; the scheduler token exists in Vault without being read into owner-facing output. Recent cron runs report `succeeded`; scheduled Edge logs show repeated `POST 200` responses.
- This is DEV-only evidence. It does not certify production, physical Android behavior, actual transcription, or model-backed AI.

No production migration, production Edge deployment, provider request, billing change, merge, release or production data write was performed. Do not mark Phase 2 closed until required exit gates are implemented and evidenced or explicitly accepted as deferrals by the owner.


## 13. DEV checkpoint — 24 November 2026

- **Exact-SHA CI #781:** SUCCESS on `bcec3df93893c2ffa21f4bae2baf35313bc3e4d5`. CI #782 is validating the subsequent Storage-purge response and failure-recovery changes; record its final result separately.
- **Hosted scheduler E2E:** PASS. The real one-minute cron processed a disposable owner-owned capture on `Simplelife_dev`; one run succeeded, the exact source was reconstructed, parts remained unreviewed, and no destination was created. Replaying the terminal idempotency key returned the same run; a new key was rejected. Fixture data and audio metadata were removed.
- **Hosted text retention E2E:** PASS. The scheduled dispatcher deleted a disposable capture whose 30-day recovery window had expired and preserved only a content-free `capture.purged` system audit receipt.
- **Voice Storage boundary:** audio is uploaded directly by the authenticated browser to the private owner-scoped bucket; no provider request occurs. The server checks the stored object size before finalization. The SHA-256 field is currently a browser-computed value and is not independently recomputed server-side. Physical hosted deletion of a disposable audio object remains a separate acceptance gate.
- **Private audio purge:** the dispatcher deletes the Storage object before completing metadata/audit removal. It now requires Storage's documented array response; Storage errors or malformed responses fail closed. If Storage deletion succeeded but metadata completion failed, the next run repeats Storage removal before retrying metadata completion. Deno tests exercise these paths; CI #782 supplies the exact-SHA result.
- **Offline vault:** five automated tests passed in CI #781. Desktop and physical Android owner acceptance remain open.
- **Provider boundary:** transcription and model-backed classification remain disabled until ARIA Model Routing is available on 26 November and the provider/model/region/retention/free-quota/fallback checks are completed. Cloudflare Workers AI remains an approved but inactive fallback. No paid billing, production migration, deploy, merge or release is authorized by this checkpoint.
