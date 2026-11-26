# Phase 2 — Owner Acceptance (Desktop + Physical Android)

**Authoritative status (updated 25 Nov 2026 AST; CI timestamp 26 Nov UTC):** Current code HEAD is `1f871e9a16c3723aa7f0f694f337ba45a858a1f9`; CI #914 [SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/45731058715), exact SHA, 49/49 required steps PASS, one conditional failure-artifact upload SKIPPED as expected, zero failed steps. This validates the local migrations/SQL suites, Deno, Edge Runtime, PWA offline cold-start and exact Cloudflare branch Preview restart. It does **not** close owner physical acceptance or authorize an STT provider. Section 19 supersedes older physical acceptance claims where they conflict: PC functional offline save/retry and Android physical mic/control checks remain OPEN. Android recovery-key renewal, offline cold-reopen and actual restore with the replacement key are owner-confirmed PASS (25 Nov 2026 AST). Direct ARIA read-only audit finds 26 capability records, all `text_generation`, and no approved `speech_to_text` route. Four DEV private audio assets remain `uploaded`, untranscribed, with original TTL ending 2 Dec 2026 UTC. PR #97 remains OPEN / DRAFT / NOT MERGED; CI Preview only, no production deployment.
**Target:** SimpleLife DEV deployment from the final exact PR #97 SHA.
**Required evidence:** final deployed SHA, desktop browser/version, Android model + Android version + browser/PWA mode, date, and owner PASS/FAIL for each section.

## 1. Desktop owner acceptance

- [ ] Sign in as the owner and open Inbox.
- [ ] Create a text capture with accents, emoji, leading/trailing spaces and multiple items.
- [ ] Confirm the original source is preserved exactly in the capture.
- [ ] Generate deterministic proposals and verify each remains advisory/unreviewed.
- [ ] Confirm a destination manually and verify the provenance link opens the correct destination.
- [ ] Search the entire archive and use pagination beyond the first 250 rows.
- [ ] Confirm possible duplicates are flagged but never merged or deleted automatically.
- [ ] Trash a capture, verify it is recoverable, restore it and confirm its source/provenance remain intact.
- [ ] Create the private offline vault. Save the one-time recovery key outside the device in the owner's password manager or another private safe place.
- [ ] Lock/unlock with the passphrase. Lock and recover with the recovery key, set a new passphrase, and verify queued captures still decrypt.
- [ ] Save an offline capture, reconnect and synchronize. Confirm exactly one server capture and one initial part exist.
- [ ] Simulate an interrupted sync/retry and confirm the same IDs are replayed without duplicate rows.

## 2. Physical Android acceptance

Perform on the owner's actual Android phone, not a desktop emulator.

- [ ] Install/update the DEV PWA and open it once online so the app shell is cached.
- [ ] Sign in and grant microphone permission only when prompted.
- [ ] Record a short voice sample, stop it, and confirm it appears as a private audio asset.
- [ ] Confirm the voice object is in the private bucket and another test account cannot list, read or download it.
- [ ] Confirm the app does not claim that audio was transcribed while no approved transcription provider is configured.
- [ ] Create/unlock the offline vault and save a text capture.
- [ ] Enable airplane mode. Confirm the new capture remains encrypted in local storage and the queue remains visible only while the vault is unlocked.
- [ ] Force-close and reopen the PWA in airplane mode. Unlock with the passphrase and verify the capture is still present.
- [ ] Recover with the recovery key on the same device, set a new passphrase, and verify the capture remains decryptable.
- [ ] Reconnect and synchronize. Confirm the server contains exactly one capture/part and local ciphertext is removed only after the server acknowledgement.
- [ ] Repeat the sync/retry once and verify no duplicate capture, part or destination is created.
- [ ] Confirm the voice recording flow, keyboard, dialogs and buttons remain usable on the phone's normal display scale.

## 3. Hosted scheduler acceptance (DEV only)

Deployment order: apply the ordered Inbox migrations, deploy the queue/worker/process/dispatcher/scheduled Edge Functions plus the JWT-protected `inbox-voice-finalize` function, run `scripts/sql/bootstrap-inbox-scheduler-dev.sql` against `Simplelife_dev`, then run `scripts/sql/activate-inbox-scheduler.sql`. The bootstrap script stores only the public project URL/key in Vault; the migration generates the separate random scheduler token internally.

- [x] Confirm the DEV Edge Function `inbox-processing-scheduled` and dispatcher are deployed from the recorded final DEV source SHA.
- [x] Confirm the named `simplelife-inbox-dispatcher` cron job is active at one-minute cadence.
- [x] Confirm the Vault token name exists without reading/decrypting it in the owner-facing evidence.
- [x] Confirm wrong scheduler tokens return 401 and do not dispatch or claim work.
- [x] Confirm a request with no `x-inbox-scheduler-token` returns 401 in the deployed DEV endpoint. Hosted DEV request 569 returned `401 SCHEDULER_TOKEN_REQUIRED`; the dispatcher was not reached.
- [x] Enqueue one disposable owner-owned DEV capture. Confirm the scheduled run processes it, persists one unreviewed proposal batch and records the expected terminal state. **Hosted DEV PASS — 24 Nov 2026:** cron request 714 returned HTTP 200; dispatcher reported `claimed=1 / succeeded=1 / retryable=0 / failed=0 / stale=0`. Read-back confirmed the capture `processed`, one run `succeeded` (attempt 1), two unreviewed proposals, exact original content preservation, and zero destination links. Reusing the idempotency key returned the same run; a new key was rejected with `CAPTURE_ALREADY_PROCESSED`. All synthetic fixtures were removed after verification.
- [x] Confirm expired private voice objects are removed before their metadata/audit receipt is deleted. **Hosted DEV PASS — 24 Nov 2026:** synthetic fixture uploaded to `inbox-voice-private`; scheduled Edge endpoint invoked through `net.http_post` request 864 returned HTTP 200 with `audioPurgedCount=1`, `audioPurgeFailed=false`, `purgeFailed=false`; queue claimed zero jobs. Read-back confirmed 0 Storage objects, 0 metadata rows and exactly 1 `capture.audio_purged` receipt (`object_removed=true`, `content_removed=true`, retention_days=7). Fixture bytes and metadata were removed; append-only receipt retained as evidence.
- [x] Confirm scheduler failures are visible in cron/net/Edge logs without printing secrets or source audio. **DEV PASS — 24/25 Nov 2026:** last 24-hour read-only checks found 1,339 scheduled Edge HTTP 200 responses, one scheduled 503, two scheduled 401 responses, 352 successful `net._http_response` HTTP 200 responses and eight DNS timeouts (null HTTP status, `timed_out=true`). The Edge log messages and inspected network response bodies contain no original capture/audio content or raw secrets. `cron.job_run_details.succeeded` means the SQL job enqueued `net.http_post`; actual delivery requires checking `net._http_response` and Edge logs. Keep the eight DNS timeouts under operational observation; later scheduled requests recovered.

**DEV evidence read back — 24 November 2026:**
- `simplelife-inbox-dispatcher` is active on `* * * * *` (one-minute cadence).
- Vault metadata contains `inbox_scheduler_token`; the token value was not read or exposed. The private audio bucket `inbox-voice-private` is non-public.
- Recent `pg_cron` executions report `succeeded`; the scheduled Edge endpoint has repeated `POST 200` responses in Edge logs.
- This confirms scheduled endpoint invocation/authentication and dispatch response, not that an owner-owned capture was processed. A disposable capture E2E is still open; queue-empty responses are not proof of processing.

## 4. Explicit limitations requiring owner/provider approval

- **Model routing:** the owner authorized Cloudflare Workers AI as a fallback, but prefers to use ARIA's canonical Model Routing after its planned recovery on 26 November. Do not call either provider or send capture/audio content externally before that integration is reviewed and approved for the exact model, region, retention terms and free-only quota.
- **Voice recording:** private audio capture/storage is implemented in DEV; transcription remains disabled until the provider route above is integrated and verified.
- The offline vault recovers with its one-time 256-bit recovery key. If the owner loses both the passphrase and the recovery key, the locally encrypted queue is unrecoverable by design.
- This DEV acceptance does not certify production deployment or production data migration.

## 5. Sign-off record

| Field | Owner entry |
|---|---|
| Final deployed SHA | |
| Desktop browser/version | |
| Desktop result | PASS / FAIL |
| Android device/model + OS | |
| Android browser/PWA mode | |
| Android result | PASS / FAIL |
| Recovery key safely stored | YES / NO |
| Scheduler DEV run verified | YES / NO |
| Owner/date | |


## 6. Private voice integrity — implementation and verification boundary

The voice upload path now calls the authenticated `inbox-voice-finalize` Edge Function after Storage upload. The browser submits only the asset ID. The function resolves the active owner from the verified JWT, loads the owner-scoped staging record, downloads the object from the private bucket using server credentials, checks the actual byte count, and computes SHA-256 over the downloaded bytes. It calls the privileged finalization RPC only when that digest matches the registered expected digest.

The former authenticated `finalize_inbox_audio_upload(uuid,integer,text)` RPC is revoked. The replacement `finalize_inbox_audio_upload_verified` RPC is executable only by `service_role`. An equal-size object with different bytes must remain in `uploading` and must not reach the finalization RPC.

**Hosted DEV deployment record — 24 November 2026:** project `Simplelife_dev` / `iybnjrnysiikbtokyshg` is ACTIVE_HEALTHY. Migration source `20261124170000_inbox_voice_server_digest_v1.sql` is applied and recorded by Supabase as migration `20261124165302`; ACL read-back confirms the retired RPC is not executable by anon/authenticated/service_role and the new verified RPC is executable only by service_role. `inbox-voice-finalize` is ACTIVE v1 with `verify_jwt=true`; `inbox-processing-dispatcher` is ACTIVE v2 with secret authentication in handler and platform JWT verification disabled as required. The real scheduled endpoint completed the hosted purge E2E described in Section 3.

**HTTPS Preview — 24 November 2026:** Cloudflare Worker project `simplelife-inbox-p2-preview`, tracked branch `feat/phase2-inbox-completion-v1`, built commit `35ef1620e3241fba2d58e4c44a069c2310eadd13` (Cloudflare version shown as `834454dc`, state `Ready`). The owner opened the preview and confirmed that the SimpleLife login screen loads without Cloudflare Access and without the previous Supabase configuration error. The app's own authentication remains enabled. This confirms HTTPS frontend delivery and availability of the public DEV Supabase build configuration; it does **not** yet confirm successful owner sign-in, protected-route behavior after login, microphone permission, installed PWA behavior, or physical Android acceptance. Record the exact preview URL after the owner provides/copies it; do not infer it from a stale deployment comment.

**Acceptance boundary:** CI and the local Edge Runtime smoke tests validate the code path with disposable local fixtures; hosted DEV scheduler and private audio-purge E2E have also been separately verified with synthetic fixtures as recorded above. Owner sign-in, actual desktop and physical Android/PWA behavior remain manual acceptance gates. Production remains out of scope.

**Local expiry-purge E2E added to the CI smoke:** the test creates a disposable owner-owned audio row and a real object in the local private Storage bucket, moves only that fixture's `retention_until` into the past, invokes the actual local dispatcher Edge Runtime, and asserts that the physical Storage object is gone, the metadata row is gone, and exactly one append-only `capture.audio_purged` receipt records `object_removed=true`. The fixture is cleaned through the Storage API on failure. This proves the local code path and ordering. The separate hosted DEV audio-purge E2E is recorded as PASS in Section 3.


## 7. Owner acceptance checkpoint — 24 November 2026 (AST)

- **Latest Preview UI corrections: OWNER PASS.** The owner confirmed the corrected top-bar connectivity label and readable passphrase error in the Preview. The label now reports browser connectivity (`Con conexión` / `Sin conexión`) and does not claim server synchronization. Wrong passphrases display `Contraseña incorrecta. Inténtalo de nuevo.`
- **Automated exact-SHA validation: PASS.** CI [#45524632163](https://github.com/SimpleLife9/simplelife/actions/runs/45524632163) completed SUCCESS with 46/46 steps on `49b5e2dab27fdb1000569e22d49dbfced7cfde14`, including unit tests, browser/mobile E2E, SQL/migration checks, Deno, local Edge Runtime and build. Cloudflare Workers Build for `simplelife-inbox-p2-preview` also completed SUCCESS for this SHA.
- **Inbox functional owner checks: PASS.** The owner signed in to Preview, captured text, generated advisory suggestions, manually confirmed a destination, and verified history, search, filters and provenance. Suggestions did not create destinations automatically.
- **Physical Android offline core flow: PASS, partial acceptance.** Two synthetic text captures were encrypted locally while airplane mode was enabled; the vault auto-locked when backgrounded; after unlocking and reconnecting, the queue returned to zero and both captures appeared once. The Android vault's one-time recovery key was not saved, so recovery-key restore/rotation was not tested. Force-close/reopen in airplane mode is also not evidenced here.
- **Desktop connectivity simulation: PASS for the indicator.** Chrome DevTools per-tab Offline/No throttling was used without disabling the computer's network. This confirms the visible connectivity indicator; it does not by itself certify a full desktop offline save → reconnect → interrupted retry cycle.
- **Still OPEN:** save and safely verify Android recovery key on a fresh test vault; force-close/reopen Android offline; complete the new desktop offline save/reconnect/retry E2E and owner manual confirmation; manually verify Android voice capture, private-object isolation and normal-scale controls; integrate and review ARIA Model Routing and voice transcription after the planned 26 Nov recovery. Scheduler failure visibility is PASS; keep the observed DNS timeouts as an operational watch item. Do not send real capture/audio content to any provider before model, region, retention, free-quota and fallback policy are reviewed and approved.
- **Release boundary:** PR #97 remains OPEN / DRAFT / NOT MERGED. Preview/DEV only. No production deployment, production migration, provider request or paid billing.


## 8. UI recovery-key path hardening — 25 November 2026

- Added Playwright UI E2E in `tests/e2e/app-data.spec.js` for a 390×844 mobile viewport: create vault; verify the one-time 256-bit recovery key format; save a synthetic encrypted capture offline; inspect IndexedDB and assert the original plaintext is absent; lock; reject a wrong recovery key; recover with the correct key; rotate to a new passphrase; lock/unlock with the rotated passphrase; and confirm the same queued capture remains readable while still offline.
- This test uses synthetic browser data and mocked Supabase. It does not read or alter the owner's real device, does not transmit the recovery key, and does not replace physical Android acceptance.
- Commit/CI exact-SHA result to be recorded after the workflow finishes.
- Physical Android acceptance still requires the owner to store the real recovery key outside the device and prove recovery after force-close/reopen in airplane mode. Do not ask the owner to paste the real key into chat or screenshots.


## 9. Authoritative closeout — 25 November 2026

This section supersedes the older status snapshots in Sections 7 and 8. Historical entries remain for audit; the exact current evidence and outstanding gates are consolidated here.

### Automated engineering — PASS

- **Current HEAD:** 29de4c6ecaa610c462e44bd6107133f968cd52dc.
- **CI #879:** [SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/45673467009), exact-SHA; 48 required workflow steps completed successfully; the conditional failure-artifact upload was skipped as expected; zero failed steps.
- CI includes recovery-key unit tests, 159 unit tests total, Playwright browser/mobile, Deno dependency/type checks, clean Postgres migrations and SQL assertions, five local Edge Runtime smokes, production asset build and exact Cloudflare Preview verification.
- Cloudflare Preview served the exact manifest and service worker; hosted cold-start suite passed 3/3, including first online visit → offline, full browser restart → offline, and browser HTTP-cache fallback.
- **Recovery-key rotation:** while unlocked, the owner can enter the current passphrase and replace the one-time 256-bit recovery key locally. The previous recovery key is invalidated; the passphrase wrap and queued ciphertext stay intact. A wrong passphrase leaves the existing recovery wrap unchanged. New unit and mobile Playwright tests prove the old key is rejected, the new key restores the same queued capture, and the updated passphrase unlocks it. These tests use synthetic browser data and mocks; they do not access the owner's actual device or real key.
- **Hosted DEV read-only checks (25 Nov):** Simplelife_dev is ACTIVE_HEALTHY; one-minute dispatcher cron and scheduler secret existence are confirmed without reading the secret; audio bucket is private; verified voice-finalizer RPC is service-role-only; old client-callable finalizer is not executable by authenticated users. No hosted data, secrets, migrations, cron or Edge Functions were changed during this audit.
- The owner physically confirmed that the PWA shell starts offline on PC and Android and that the corrected readiness indicator no longer covers navigation. Earlier Android acceptance for offline encrypted text capture, background auto-lock and reconnect/sync remains recorded in Section 7.

### Only remaining owner-side checks

1. **Desktop — functional offline transaction:** create one disposable text capture while fully offline; reconnect; confirm exactly one capture/part appears. Repeat one interrupted/retry sync and confirm no duplicate.
2. **Android — recovery and cold re-open:** while the vault is unlocked, generate a fresh recovery key using the current passphrase; store it outside the phone in a private password manager or safe place; force-close the PWA; reopen in airplane mode; unlock and verify the queued capture remains; then exercise recovery with the new key and verify the same capture remains. Never send the real key in chat or screenshots.
3. **Android — microphone and controls:** record a short non-sensitive test phrase, verify it becomes a private voice asset and the recording controls/dialogs remain usable at normal display scale. This verifies capture/storage only; it must not be described as transcription.

Already accepted tests are not to be repeated: initial offline app-shell start on both devices, repaired offline banner, sign-in and Inbox core capture/review/search/filter/provenance, and earlier Android airplane-mode encrypted text capture/background auto-lock/reconnect flow.

### Technical provider gate — not owner acceptance

- **Transcription and model-backed classification are not complete.** Deterministic local category proposals remain heuristics, not AI.
- The owner preference recorded on 24 Nov remains: use ARIA canonical Model Routing after the planned 26 Nov recovery; Cloudflare Workers AI is an authorized fallback, not automatically activated. No model request or private audio/capture was sent in this session.
- A read-only ARIA audit found Google Gemini Direct account/model/quota marked available in the database, but its evidence points to an old live probe and the model metadata says a fresh live probe is pending. Rate-limit/remaining quota numbers are unknown. GitHub's current static model registry also differs from database state. Treat the route as **not freshly certified** until ARIA reconciles that drift and completes an approved live synthetic probe.
- Privacy/cost constraint: Google's current Gemini API pricing page says Free-tier content is used to improve its products, whereas Paid-tier content is not. Therefore Free-tier Gemini must not receive private SimpleLife audio or capture content. [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Cloudflare Workers AI documents zero retention for standard non-stateful inference and says customer content is not used to train models. Its Free Workers allocation is 10,000 Neurons/day; above that Free-plan requests fail, while Paid-plan usage above the allocation is billable. The owner has previously exhausted the Cloudflare free allocation, so do not enable or assume current capacity without checking the daily reset and enforcing a no-paid fail-closed limit. [Cloudflare Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) · [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- No paid billing, provider fallback or real transcription has been enabled. This gate is technical and cannot be cleared by the owner merely checking the phone.

### Separate security observation — ARIA, not SimpleLife

Supabase's schema advisor flagged two ARIA internal Mission Wonder tables with RLS disabled. A read-only privilege check confirmed anon and authenticated lack USAGE on schema aria_internal and have no table privileges for those relations. No data access through those roles was observed. This remains a separate defense-in-depth review; no RLS or policy changes were applied.

### Release boundary

PR #97 stays OPEN / DRAFT / NOT MERGED. No production deployment, production migration, billing change, external model request or real user audio upload was performed. Do not declare Phase 2 100% closed, merge, or begin Phase 3 until the provider gate is resolved and the three owner-side checks above are recorded PASS (or the owner explicitly removes/changes an acceptance requirement).


- **CI #880 documentation-head verification:** [SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/45674747087), exact SHA `877e04724d7a221d297d99da19fcfb11a158b13a`; 48 required steps PASS, one conditional failure-artifact upload skipped as expected, zero failures. The run includes the same local Postgres/Edge Runtime/build/Cloudflare Preview verification after the documentation closeout.

- **CI #881 final documentation verification:** [SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/45675904840), exact SHA `1b6c8327db46602d94bdc67adf556923a01e0ad0`; 48 required steps PASS, one conditional failure-artifact upload skipped as expected, zero failures. This validates the final status/count correction on that SHA.

### Provider feasibility assessment — 25 Nov 2026

- Cloudflare publishes `@cf/openai/whisper-large-v3-turbo` as a hosted speech-recognition model that accepts audio and supports transcription/translation. The published rate is 46.63 Neurons per audio minute. Cloudflare Workers AI Free allocates 10,000 Neurons/day, resetting at 00:00 UTC; if the full daily allowance were reserved exclusively for this model, that would be about 214 audio minutes/day. Other Workers AI usage shares that allowance, so this is an upper bound, not guaranteed remaining quota. On Workers Free, exceeding the allowance causes requests to fail; on Workers Paid, usage above the allowance is billed. The account plan and current remaining neurons were not accessible in this audit. [Whisper model](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) · [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Cloudflare commits to zero retention for standard stateless inference and says Workers AI customer content is not used to train models. This protection does not cover content that the application itself logs, caches, uploads to stateful/batch storage or routes through another provider; implementation must avoid those paths. [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- **Region is not verified:** Cloudflare's placement docs control where a Worker fetch handler runs, not necessarily where the separate Workers AI inference backend processes the model. Regional Services only governs the configured Worker hostname and does not extend to outbound subrequests. No official evidence located in this audit guarantees the Whisper inference region. Therefore the Cloudflare fallback is not yet cleared for private SimpleLife audio. [Workers placement](https://developers.cloudflare.com/workers/configuration/placement/) · [Regional Services caveats](https://developers.cloudflare.com/data-localization/how-to/workers/)
- Gemini Direct is also not an acceptable private-content route on Free Tier because Google's pricing terms state that Free-tier content can be used to improve products. Its ARIA text-generation route also lacks an explicitly registered speech-to-text capability in the current capability matrix. [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- **Next technical step:** after the planned ARIA recovery on 26 Nov, reconcile repository/model/account/quota state with the live control plane; register and verify an explicit speech-to-text capability and approved provider/region; run a synthetic, non-sensitive audio smoke; confirm a strict free-only fail-closed budget; and only then enable server-side transcription in DEV. Classification of private capture text must also use an approved no-training/no-retention path. No provider call was made in this assessment; no audio or private capture was sent.



## 16. Owner physical-test findings and corrective actions — 25 November 2026 (AST)

### Desktop offline capture — NOT YET TESTED

- The owner's first offline save attempt returned: "No hay conexión. Para guardar sin conexión, crea o desbloquea la bóveda privada primero." No capture was saved by that attempt.
- This is the intended vault guard, but the previous test instruction omitted the setup prerequisite. Corrected procedure: while connected, open Inbox and inspect "Modo sin conexión privado". If it says "Sin configurar", create the vault with a private passphrase of at least 14 characters and store/confirm the one-time recovery key outside that PC. If it says "Bloqueada", unlock it with that PC's normal unlock passphrase. Keep it unlocked, disconnect all network access, then save the synthetic test capture with "Guardar cifrada". Reconnect and use "Sincronizar ahora"; verify one capture/part and duplicate-free retry.
- The failed attempt did not constitute a successful offline save and is not counted as owner acceptance.

### Android recovery-key clarification — OWNER ACTION STILL OPEN

- The PC and Android vaults use separate local IndexedDB stores and independently generated data-encryption keys. The PC recovery key cannot recover the Android vault.
- Losing only the Android recovery key does not prevent rotating it if the owner still knows the Android vault's normal unlock passphrase. On Android: unlock the existing vault using that passphrase, choose "Renovar clave de recuperación", enter the same current unlock passphrase in the confirmation field, generate a replacement key, and save/verify it outside the phone. This does not require the old recovery key and preserves queued ciphertext.
- If both the Android unlock passphrase and Android recovery key are lost, queued ciphertext is unrecoverable by design. Do not clear browser storage, uninstall/reset the PWA, or create a replacement vault while the old queue may contain data.

### Physical voice capture — PARTIAL PASS; storage metadata audit

- The owner reports four voice assets in Inbox: two "esperando transcripción" and two "preparándose".
- Read-only DEV metadata audit (no audio bytes read/downloaded) confirms the private inbox voice bucket is non-public, capped at 25 MiB, and the four records are split into two uploaded and two uploading. All four matching Storage objects exist and each object's stored size matches its registered metadata size.
- The two uploaded items are correctly waiting for an approved transcription provider. The two uploading items have not completed the server-side SHA-256 finalization; object existence and size match are not by themselves integrity verification.
- Added an owner-authenticated retry action to invoke the existing inbox voice finalizer endpoint for an uploading asset. The server re-downloads the private object, verifies size and SHA-256, and finalizes only when verified. This operation does not re-record, re-upload or send the audio to a model. Exact-SHA CI must pass before owner re-test.
- The provider gate remains open. No transcription or external model request was run, and no audio was listened to.

### Updated owner checklist

1. PC: prepare/unlock the local vault **while online first**, then conduct the complete offline save → reconnect → sync → interrupted retry test.
2. Android: the PC recovery key is not applicable. Use the Android normal unlock passphrase to rotate and safely store a new Android recovery key; if that passphrase is also lost, stop and do not reset local storage.
3. Android voice: after the updated Preview is available, use "Reintentar verificación" on the two pending uploading assets. Confirm they change to "esperando transcripción". No need to record duplicates.

These results do not change the release boundary: PR #97 remains OPEN / DRAFT / NOT MERGED, DEV/Preview only.

## 17. Consolidated owner acceptance and ARIA capability audit — 25 November 2026

### Owner-confirmed physical checks — PASS

- **PC offline capture + reconnect:** Roberto confirmed the encrypted offline capture saved successfully and appears correctly after reconnect. Record as owner-confirmed PASS for offline save and subsequent visibility/synchronization.
- **Android recovery key:** Roberto replied “listo” after the recovery-key renewal procedure. Record as owner-confirmed PASS for renewal. Keep the replacement recovery key stored outside the phone; the key itself is not copied into this document or chat.
- **Private voice assets:** after “Reintentar verificación”, all four records display “Audio original · esperando transcripción”. This confirms that the two records previously stuck in `uploading` completed server-side object verification/finalization and joined the two already uploaded records. No re-recording or re-upload is needed.
- **Scope of these PASS results:** the PC result confirms the save and post-reconnect appearance reported by the owner; it is not a claim that a separate manually interrupted retry was performed. The voice result confirms private-asset upload/finalization, **not** transcription or AI classification.

### Current ARIA speech-to-text gate — OPEN

- Read-only Supabase project check: ARIA project `icuqsstxfdbvjytkhlog` is `ACTIVE_HEALTHY`. No schema, rows, secrets, functions, quota or provider settings were changed.
- Read-only inspection of `aria_internal.capability_matrix` found only registered `text_generation` capabilities. A direct query for capability IDs containing `speech`, `transcrib` or `audio`, and for model capability metadata containing those terms, returned no rows.
- GitHub `Robvg9/aria-worker@main` declares `capabilities/registry.json` version `aria-capability-matrix-v1.1.1`; its canonical capability list contains only `text_generation`. `models/registry.json` is version `aria-model-registry-v1.0.5`; the inspected model references do not establish speech-to-text support.
- The SimpleLife worker at the tested HEAD continues to identify its processing engine as `deterministic-rules`. It does not call an external model. Its classification proposals remain heuristic and advisory.
- Conclusion: there is no registered, evidence-backed speech-to-text route available for SimpleLife to invoke today. A model being multimodal, an old provider probe, or a successful text-generation route does not prove transcription capability. Keep the four private assets waiting; do not send their contents to a provider.

### Next technical sequence

1. After the planned ARIA recovery on 26 Nov, reconcile the live Control Plane with the GitHub provider/model/capability registries and current account/quota state.
2. Require an explicit `speech-to-text` capability, exact model and adapter, evidence from a synthetic non-sensitive audio probe, acceptable inference region and retention terms.
3. Enforce a strict Free-only budget with fail-closed behavior. No paid fallback, billing activation, or silent provider substitution.
4. Only after all gates pass, integrate server-side transcription in DEV, preserving the original asset, idempotency, provenance and manual review; then run exact-SHA CI/E2E.
5. Keep private capture-text classification on an independently approved privacy-safe route. The current deterministic classifier remains available as a transparent heuristic fallback.

### Release boundary

- PR #97 remains OPEN / DRAFT / NOT MERGED.
- CI #886 remains the PASS for functional code SHA `40eab5b944b0e957e32b796c5b803d15edd88c78`. The documentation-only update containing this Section 17 must pass its own exact-SHA CI.
- No production deploy, production migration, paid billing, provider request, audio download/listening, or real private-content transmission occurred.
- Phase 2 is not 100% closed until the speech-to-text/provider gate is verified and the resulting DEV integration passes exact-SHA validation.


## 18. Provider alternatives re-evaluated — 25 November 2026

This section is a feasibility comparison only. No provider is enabled and no audio or private capture was transmitted.

### Candidate A — Groq Whisper Large V3 Turbo

- Official Groq docs expose a dedicated speech-to-text endpoint and model `whisper-large-v3-turbo`; supports multilingual input and the documented endpoint is `/openai/v1/audio/transcriptions`. Sources: [Speech to Text](https://console.groq.com/docs/speech-to-text) · [Model card](https://console.groq.com/docs/model/whisper-large-v3-turbo).
- Groq Trust Center says it does not use customer data to train models; all customers may enable Zero Data Retention (ZDR) in the console. When ZDR is enabled, customer inputs/outputs are not retained for reliability/abuse monitoring. Sources: [Groq Trust Center FAQ](https://trust.groq.com/faq) · [Your Data](https://console.groq.com/docs/your-data).
- Groq's published rate-limit page exposes a Free Plan tab. Its current Whisper row lists 20 RPM, 2,000 RPD, 7,200 audio seconds/hour and 28,800 audio seconds/day; Groq warns these are high-level limits and exact organization limits must be checked in the account console. Source: [Rate Limits](https://console.groq.com/docs/rate-limits).
- **Cost caveat:** the model page also lists $0.04 per audio hour. The existence of Free Plan rate limits alone is not sufficient evidence that this specific account's usage will remain $0. Do not configure this route until the actual account plan, exact free allowance, billing state and spend cap are verified; never upgrade to Developer or attach paid billing for this task.
- **Region caveat:** Groq Trust Center lists data centers in the US, Australia, Canada, Finland and Saudi Arabia. It says Enterprise customers can arrange regional API endpoints. A Free/non-Enterprise account cannot be assumed to pin inference to an approved region. The data-location statement about stored customer data in US GCP buckets is not proof of the inference region for a particular request.
- **Current status:** technically promising, privacy controls promising, region/cost/account not yet cleared. Do not add to ARIA's active capability matrix or invoke it yet.

### Candidate B — Cloudflare Workers AI Whisper Large V3 Turbo

- Official model page confirms ASR/transcription, zero-data-retention model designation and 46.63 Neurons per audio minute: [Model card](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/).
- Workers AI standard stateless inference has zero retention and Customer Content is not used to train models: [Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).
- Workers Free includes 10,000 Neurons/day; on Workers Free, exceeding quota makes requests fail. Workers Paid may bill overage at the published rate. Exact remaining account quota was not checked. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
- **Region caveat remains OPEN:** Cloudflare Regional Services constrains the Worker hostname's request handling but does not constrain outgoing subrequests; placement controls the Worker handler, not published proof of the separate model inference backend's region. Sources: [Regional Services](https://developers.cloudflare.com/data-localization/how-to/workers/) · [Placement](https://developers.cloudflare.com/workers/configuration/placement/).

### Decision

Neither candidate currently satisfies every gate simultaneously. Groq looks stronger on explicit ZDR/no-training controls and provides a dedicated speech API, but a non-Enterprise region cannot be pinned and account-specific Free usage is not proven. Cloudflare offers an explicit zero-retention/no-training commitment and a Free neuron allowance, but the model inference region is not documented as pinned.

Keep all four private audio assets in their verified waiting state. Do not send them to Groq, Cloudflare, Gemini Free or another unapproved provider. The next step is to reconcile ARIA's canonical routing after the planned recovery, confirm the acceptable region and account-specific $0 route, and only then perform a synthetic non-sensitive audio probe.

## 19. Authoritative engineering and owner-gate closeout — 25 Nov 2026 AST (CI timestamps 26 Nov UTC)

### Automated engineering — PASS

- **Exact code HEAD:** `1f871e9a16c3723aa7f0f694f337ba45a858a1f9`.
- **CI #914:** [SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/45731058715), exact HEAD; **49/49 required steps PASS**, one conditional upload of failure artifacts SKIPPED as expected, zero failed steps.
- Exact-SHA coverage: Node dependency/install; 55 browser/mobile Chromium tests; Deno 115/115 plus type-check; local RLS bootstrap; every migration including `20261125235659_inbox_voice_transcription_queue_v1.sql`; all Inbox ownership/provenance/search/retention/offline/voice SQL suites; durable voice queue SQL; scheduler Vault permissions; Event and Protected Time SQL concurrency/lifecycle suites; Agenda and Inbox actual local Edge Runtime checks; Event Create/Mutation and Protected Time Edge checks; production asset build; PWA offline cold-start; Cloudflare branch Preview synchronization to exact build; and cold launch after full browser restart.
- **Voice worker actual Edge Runtime:** PASS. The secret-only worker started from its own folder-local `deno.json`, the `@supabase/server` import resolved, and the real local endpoint returned HTTP 503 with `accepted=false`, `status=disabled`, `reason=SPEECH_ROUTE_NOT_CONFIGURED`. It performed no queue claim, audio download or provider request because no verified route/adapter is configured.
- The smoke then stopped the worker, restarted `inbox-voice-finalize`, and completed remaining owner-isolation and server-computed SHA-256 checks. This proves the fail-closed production boundary and local integration; it is not a transcription provider test.
- Commits that resolved the Edge smoke: `10ae4f5` (serialize local Edge servers), `1dc2369` (secret-only function config), `ef3757e` (worker import map/lock), and `1f871e9` (correct scalar assertions for worker disabled response).
- **Release boundary:** PR #97 remains OPEN / DRAFT / NOT MERGED. The run validated CI build and branch Preview; no production deployment or hosted migration is implied.

### Owner physical acceptance — OPEN (latest owner report supersedes conflicting historic PASS)

The PASS items below are only the independently confirmed checks. The following three completion items remain open.

1. **PC — functional offline save and retry: OPEN.** The latest offline attempt returned “No hay conexión. Para guardar sin conexión, crea o desbloquea la bóveda privada primero.” No capture was saved. PWA shell cold-open offline and the corrected connectivity indicator remain PASS, but these do not prove an offline write. Required: create/unlock the PC vault while online; retain its recovery key outside the PC; leave it unlocked; go fully offline; save a synthetic capture; reconnect/sync; verify one server capture and one part; repeat an interrupted retry and verify no duplicate.
2. **Android — recovery-key renewal, offline cold-reopen and actual recovery: PASS.** The owner confirms the replacement Android recovery key had already been generated and safely saved. After force-closing the PWA and reopening it in airplane mode, the existing vault and pending captures were accessible. The owner then completed “Recuperar y cambiar frase” with the replacement Android key; the app confirmed recovery and the pending captures remained readable. This closes the Android recovery flow end-to-end. The PC and Android vaults are independent; the PC recovery key cannot recover Android. Never send a real passphrase/recovery key to ChatGPT.
3. **Android — microphone and controls: OPEN.** On the physical phone, record a short non-sensitive test phrase; verify a private voice asset appears and that recording buttons/dialogs are usable at normal display scale. This confirms private capture/storage only, not transcription.

**PASS retained:** PWA shell opens offline on PC and Android; connectivity indicator fix; Inbox core capture/review/search/filter/provenance checks; earlier Android encrypted text capture, background auto-lock and reconnect/sync flow. These do not replace the three open tests above.

### ARIA speech-to-text provider gate — OPEN

- Direct read-only audit of ARIA Supabase project `icuqsstxfdbvjytkhlog`: provider registry 5 rows; model registry 27; capability matrix 26; account registry 5; quota registry 6. All 26 capability rows are `text_generation`; there is no `speech_to_text`, `transcription` or `audio` capability. Current provider registry contains Google, `local_windows`, Mistral, OpenRouter and xAI; no Groq or Cloudflare provider route is registered.
- The existing Google Gemini and OpenRouter routes are registered for text generation only. They are not eligible for speech-to-text by inference or model-family label.
- Groq Whisper and Cloudflare Whisper remain only candidates, not routes. Groq account-level effective Free usage/spend, ZDR configuration, inference region and jurisdictional eligibility have not been verified. Cloudflare's Workers Free daily allocation and current remaining capacity have not been verified, and public regional documentation does not prove the model inference backend is pinned to an approved region. Gemini Free is not approved for private content under this project's privacy gate.
- Therefore `inbox-voice-transcription-worker` must remain disabled/fail-closed until ARIA registers a verified STT capability, exact model/adapter/account, approved inference region, no-training/ZDR proof, actual Free quota, max billable USD $0, and no paid fallback. No speculative capability/route is to be inserted.
- The current Inbox classifier remains `deterministic-rules`; its proposals are heuristics/advisory, not AI classification. Model-backed classification requires its own privacy/cost gate.

### DEV private audio originals — read-only state / retention

- Project `Simplelife_dev` (`iybnjrnysiikbtokyshg`) read-only aggregate audit: 4 assets total; 4 `uploaded`; 4 without `capture_id`; 0 transcript; 4 objects in `inbox-voice-private`; bucket is non-public and object limit remains 25 MiB.
- The original retention window remains **2 Dec 2026 02:03–22:13 UTC** across the four uploads. No TTL was extended. No audio bytes were read/downloaded/played and no provider received any of the files.
- Do not re-record or re-upload these originals. Keep them waiting for a genuinely approved STT route; if the gate remains open near TTL expiry, owner must decide whether the originals may expire or provide another approved retention instruction.

### Final status and allowed next action

- Automated code/CI/Preview verification for SHA `1f871e9a16c3723aa7f0f694f337ba45a858a1f9`: **PASS**.
- Owner physical acceptance: **OPEN — 3 checks above**.
- ARIA STT capability/provider gate: **OPEN — no canonical route exists**.
- Supabase hosted DEV/schema/data/secrets: unchanged in this work; no hosted migration applied.
- No external provider request, audio download/listen, paid billing, production deployment or merge occurred.
- **Do not declare Phase 2 100% CLOSED or start Phase 3** until the three owner checks and approved STT route are addressed (or the owner explicitly changes the scope/acceptance requirement). The next technical action is to keep the provider worker fail-closed and to resolve the approved STT capability/account/region/cost evidence without transmitting private data.



## 20. Android recovery and offline cold-reopen — owner-confirmed PASS (25 November 2026 AST)

- The owner confirms that the Android recovery key had already been renewed and saved outside the phone. The PWA was force-closed and reopened in airplane mode; the existing vault and pending Inbox captures remained accessible.
- The owner then completed the actual “Recuperar y cambiar frase” flow using the replacement Android recovery key. SimpleLife confirmed recovery and the same pending captures remained readable.
- **PASS scope:** recovery-key renewal, offline cold-reopen/persistence and actual recovery with the replacement key. No vault reset, browser-storage deletion or reinstall.
- **Still OPEN:** PC fully-offline save + interrupted retry without duplicates; Android microphone/private-audio capture + normal-scale controls. The STT provider approval gate remains separate and OPEN.
- The real recovery key and passphrases were not shared in chat.
