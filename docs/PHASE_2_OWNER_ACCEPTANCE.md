# Phase 2 — Owner Acceptance (Desktop + Physical Android)

**Authoritative status (updated 27 Nov 2026 AST):** PR #97 HEAD is `21b6d228dfe7f9105bbb2635bffd8270c3247af7`; GitHub Actions CI #1024 [SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/46095529104). Unit tests 206/206 PASS; browser/mobile smoke PASS; ephemeral Supabase/Postgres/RLS/migration suites PASS; Agenda and Inbox Edge Runtime smokes PASS; production asset build, offline PWA cold-start and Cloudflare Preview cold-launch after full browser restart PASS. ROBVG Windows on the same exact SHA: `npm test` 206/206 and `npm run build` PASS. The Windows-only CRLF test issue is fixed by normalizing header line endings in the test; no application runtime behavior changed. Physical Android acceptance: Samsung SM-A165M, Android 17, Chrome 158.0.8127.92; 3/3 owner-authorized private recordings were transcribed locally with Whisper.cpp. No transcript was saved as a new capture; original audio assets were not modified or deleted. A fresh independent Preview tab opened with the owner session, Service Worker control and Dashboard → Inbox navigation without a manual refresh. PR #97 remains OPEN / DRAFT / NOT MERGED; Preview only; no production deployment. **Phase 2 is still OPEN:** model-backed Inbox classification is not active (the processor remains deterministic/heuristic and ARIA's mission-budget guard is not LIVE); Android review/save persistence for a local transcript has not been tested. ARIA Planner is Phase 3.
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
- [x] On the physical Android phone, select and locally transcribe the three owner-authorized private recordings with Whisper.cpp. **PASS 3/3 — 27 Nov 2026 AST:** Samsung SM-A165M / Android 17 / Chrome 158.0.8127.92. Original private audio assets were not modified or deleted; no audio was sent to a remote provider.
- [ ] Review/edit and explicitly save at least one of those local transcripts as a new Inbox capture; verify the owner-scoped RPC, source link, and exactly one capture/part. No Save action was taken during the physical test, so this persistence step remains unverified.
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

- **Transcription:** Whisper.cpp runs locally in the browser and does not send private audio to an external provider. On the physical Samsung SM-A165M (Android 17, Chrome 158.0.8127.92), 3/3 owner-authorized recordings were transcribed locally. This proves Android inference only: the owner did not press **Guardar transcripción como captura**, so Android save-as-capture persistence remains unverified. The original private audio assets were not changed or deleted.
- **Model-backed classification:** still OPEN. ARIA's text-generation registry is not a verified audio/STT route, and the current Inbox classifier remains deterministic. Do not send private Inbox text externally before ARIA's safety PRs, current quota/capacity evidence, exact model and data-handling controls are deployed and reviewed. No paid usage is authorized.
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

## 21. Android voice capture and private storage — owner-confirmed PASS (25 November 2026 AST)

### Physical capture and storage — PASS

- After opening the updated Preview on Android, the owner made a short synthetic voice recording. The app now displays: “Audio original guardado en almacenamiento privado. La transcripción permanece pendiente hasta configurar un proveedor aprobado.”
- The Inbox screen shows **5** entries as “Audio original · esperando transcripción”: the four previously pending private originals plus the new synthetic test recording. This is the owner's visible app result; it is not represented as a fresh independent database audit.
- The app states that voice originals are uploaded to a private bucket, linked to the owner's profile, not public and not automatically sent to a model. The displayed limit remains 25 MiB and unlinked audio retention is 7 days.
- The new test entry displays retention until **2 Dec 2026, 20:58** (as shown by the owner's local app). Existing items retain their individually displayed expiry dates. Do not extend TTL or re-record/re-upload the four existing originals.
- Scope of PASS: Android microphone recording and successful private-storage save/upload as reported by the owner. This does **not** mean speech-to-text completed, AI classification ran, or an external provider was called.
- No private audio was downloaded, played or transmitted by this audit. Keep the transcription worker fail-closed until the separate ARIA STT approval gate is satisfied.

### Remaining Android visual acceptance — OPEN

- The owner has not yet explicitly confirmed whether the persistent “Preparando modo sin conexión” banner disappeared from the navigation area and whether all section buttons are unobstructed at normal phone display scale.
- Keep this visual/navigation acceptance separate from the successful audio-save PASS. Do not mark it complete without the owner's confirmation.

## 22. Android navigation banner and section visibility — owner-confirmed PASS (25 November 2026 AST)

- Roberto confirms that the persistent “Preparando modo sin conexión” banner no longer obstructs the navigation and that the section buttons are visible and usable.
- This closes the Android visual/navigation acceptance for the Preview fix.
- Combined Android owner acceptance now PASS for: replacement recovery key, offline cold-reopen, actual recovery while preserving pending captures, synthetic microphone recording/private-storage save, and navigation visibility.
- Still OPEN: PC fully-offline vault save, reconnect/sync, and interrupted retry without duplicates; ARIA speech-to-text provider approval remains a separate technical gate.

## 23. PC offline capture and reconnect — owner-confirmed PASS (25 November 2026 AST)

- Roberto confirms the full synthetic PC offline-write flow completed correctly in the SimpleLife Preview: the PC vault was created/unlocked while online, the vault remained unlocked offline, and the synthetic Inbox capture saved locally without network access.
- After reconnecting, the capture synchronized and appeared correctly. The owner reported the complete requested check as “todo correcto”; record this as owner-confirmed PASS for offline save and reconnect/sync, with no duplicate visible in the tested result.
- This PASS is limited to the offline save and reconnect path exercised. A separate deliberately interrupted retry/recovery test was not performed in this step and remains OPEN; do not infer retry idempotency from a normal successful sync.
- No production deployment, merge, hosted migration, billing change or provider request is implied. PR #97 remains subject to its existing release boundary.

## 24. Offline sync — ambiguous response after server commit regression (26 November 2026 UTC)

- Added a focused unit regression in `tests/inbox-offline-vault.test.js` for the failure window where the server has committed the capture and its initial part, but the HTTP response is lost before the client receives acknowledgement.
- The first attempt verifies that local encrypted ciphertext remains queued after the ambiguous failure. The retry reuses the exact same UUIDv7 capture and part IDs, receives an idempotent replay acknowledgement, and only then removes the local ciphertext.
- The simulated server asserts one capture and one initial part after both attempts; a further sync performs no third RPC. The existing ephemeral PostgreSQL test `scripts/sql/inbox-offline-sync.test.sql` independently verifies that the real RPC replays the same persisted IDs and rejects changed source content.
- This is automated regression coverage, not a claim that a physical PC network interruption was manually induced. The owner-confirmed offline save/reconnect remains PASS; the distinct physical interruption test remains OPEN unless separately performed.
- Exact-SHA CI for the commit containing this test is required before marking the regression suite PASS. No hosted DB, production, billing, or provider state is changed.

## 25. Speech-to-text provider review — updated no-cost/privacy/region gates (26 November 2026 UTC)

### Azure Speech F0 — candidate only; not approved

- Official pricing lists 5 hours/month of real-time Standard speech-to-text in Free F0; the allowance is shared with Custom and does not include Batch. F0 has a single concurrent base-model real-time request. Sources: [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/) · [quotas and limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits).
- Speech resource region is selected explicitly and is used for data processing/storage; Brazil South (`brazilsouth`) is listed for real-time transcription. Sources: [supported regions](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions).
- Real-time STT audio is processed in server memory with no data stored at rest; transit is encrypted. Audio/transcription logging is off by default but must remain off. If enabled, logs may be kept for 30 days. Sources: [Speech data privacy](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security) · [logging](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/logging-audio-transcription).
- **Eligibility is OPEN:** Microsoft's Export FAQ says products/services may not be exported to Cuba without authorization. OFAC FAQ 1175 separately authorizes certain API and cloud services supporting internet communications under specified regulations; that does not prove that this exact Speech product/account/use is covered or that Microsoft will provision it. Sources: [Microsoft Export FAQ](https://www.microsoft.com/en-us/exporting/faq) · [OFAC FAQ 1175](https://ofac.treasury.gov/faqs/1175). No false billing/location details or geographic workaround.
- No Azure subscription/resource/key/secret/provider registration has been created; no audio probe was sent.

### Cloudflare Workers AI Whisper Large V3 Turbo — not approved

- Workers Free includes 10,000 Neurons/day; over-quota requests fail on Free and Paid usage above the allocation is billable. Whisper Large V3 Turbo uses 46.63 Neurons/audio minute (published unit price $0.0005/minute), theoretically about 214 min/day if no other Workers AI usage consumes the pool. Sources: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [model card](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/).
- The current account's remaining daily quota is not verified, and the project's explicit inference-region gate remains unresolved. No request sent.

### Groq Whisper Large V3 Turbo — rejected for the $0 rule

- Official model price is $0.04/audio hour even though Free rate limits are published. It fails the strict $0 ceiling. Sources: [model card](https://console.groq.com/docs/model/whisper-large-v3-turbo) · [Speech to Text](https://console.groq.com/docs/speech-to-text).

## 26. Google Cloud Speech-to-Text V1 — additional Free candidate, gates OPEN (26 November 2026 UTC)

- Official pricing lists **60 minutes/month per account at $0** for Standard Speech Recognition both with and without data logging. The no-logging SKU costs $0.024/minute above the free 60 minutes. Do not opt into data logging. Source: [Speech-to-Text pricing](https://cloud.google.com/speech-to-text/pricing).
- Google requires billing enabled on the Cloud project even when usage stays within the free quota. This is not a no-billing service. Source: [Cloud Speech-to-Text setup](https://docs.cloud.google.com/speech-to-text/docs/setup).
- For streaming/synchronous endpoints without data-logging opt-in, Google says audio is processed in memory and no customer audio data is stored; content is used only to provide the API service. Source: [Data usage FAQ](https://docs.cloud.google.com/speech-to-text/docs/v1/data-usage-faq).
- Explicit US and EU multi-region endpoints constrain data at rest and in use to those continental boundaries. Global processing is not acceptable under this project's region gate; single-region processing is not supported. Source: [Supported regional endpoints](https://docs.cloud.google.com/speech-to-text/docs/v1/endpoints).
- Synchronous requests accept about 1 minute / 10 MiB; streaming is up to 5 minutes with audio sent near real time. Source: [V1 quotas and limits](https://docs.cloud.google.com/speech-to-text/docs/v1/quotas).
- **Country/account eligibility remains OPEN:** Google's Cloud Billing documentation says access to some services is restricted in certain territories and explicitly includes Cuba among examples; the billing country must match the real billing mailing address. A US/EU API endpoint does not bypass this. Source: [Create a Cloud Billing account](https://docs.cloud.google.com/billing/docs/how-to/create-billing-account). Do not falsify billing country or route through another territory.
- A future $0-only adapter would need to reconcile all account-shared usage, enforce a hard monthly stop below 60 minutes, avoid other billable Google Cloud services/storage and fail closed before the paid tier. No current billing account, remaining quota or eligibility evidence is available.
- No Google Cloud project, billing account, API enablement, key, ARIA provider route or secret was created/changed. No audio was sent.

### Consolidated provider decision

Google Cloud STT V1 (without logging, explicit US/EU endpoint) is now the strongest published free candidate technically, but is **not approved** until country/account eligibility, billing prerequisite, current shared free quota and enforceable $0 stop are verified. Azure F0 remains unapproved due the same unresolved eligibility requirement; Cloudflare lacks a verified inference region/current quota; Groq fails the $0 limit.

Keep the transcription worker disabled/fail-closed. The five private originals remain private and pending. The synthetic recording proves private capture/storage only, not external-processing consent. No provider request or paid billing occurred in this review.

## 27. PC offline sync — interrupted retry — owner-confirmed PASS (26 November 2026 UTC)

- The owner completed the deliberate physical interruption test in the SimpleLife branch Preview on PC using the unique synthetic capture label `PRUEBA-REINTENTO-PC-26NOV-01`.
- During `Sincronizar ahora`, connectivity was interrupted while the app was showing `Sincronizando…`. The encrypted capture remained queued locally; after connectivity was restored, the owner retried synchronization successfully.
- The owner confirmed the final Inbox search returned exactly one capture for the unique label and one initial part, with no duplicate created by the interrupted attempt. This is an owner-confirmed physical UI acceptance; no independent hosted database read was performed for this manual test.
- **PC physical offline acceptance is now PASS** for: vault prepared/unlocked online, encrypted capture saved while offline, normal reconnect/sync, and deliberate interrupted-sync retry without duplicates. The separate automated ambiguous-response regression is also covered by CI #922 at exact SHA `cdbc1f879fa726d11702d54b0c8a9afcfcc1a5b3`.
- CI #923 is **SUCCESS** at exact SHA `392359c69dded7469beec9c98c5bc395d748088f` (49 required steps passed; the conditional failure-artifact upload was skipped as expected). The documentation update in this section will trigger a new exact-SHA CI run; do not treat #923 as testing this new documentation commit.
- No production deployment, merge, hosted Supabase migration/data/secret change, paid billing, or speech-provider request is implied. The speech-to-text provider gate remains OPEN and fail-closed; the five private originals remain private and pending.



## 28. Local Whisper transcription saved as Inbox captures — owner-confirmed PASS (27 November 2026 AST)

- The owner confirmed that the two new locally transcribed captures appear in Inbox after opening the updated branch Preview.
- Exact code HEAD: `8430ea182e73a633ac44c52b0b9a0d2d881d4e1f`; CI #1017 SUCCESS on that exact SHA. Unit 205/205; browser/mobile 59/59; Preview cold-launch 8/8 after full browser restart.
- The implementation downloads only the owner-selected private audio asset to the browser, verifies its expected SHA-256, runs the pinned Whisper.cpp WASM model on-device and never sends audio bytes to an external STT provider. Saving requires the owner's explicit action and uses `public.record_inbox_voice_transcription_local` in DEV.
- Read-only DEV verification found exactly two transcribed assets, each linked to a `voice` capture and one source `capture_part`; both captures are synced and remain `needs_review`. Three other assets remain `uploaded`. The original private objects were not read or modified by this audit.
- The transcript-save UI acceptance is PASS in the owner-opened Preview. The owner did not identify the device used for these two saves; therefore this does not close the physical-Android-specific checkbox in Section 2.

## 29. ARIA model-routing safety gate — code recovered; runtime still frozen (27 November 2026 UTC)

- ARIA Supabase project is ACTIVE_HEALTHY. Its current `capability_matrix` contains 26 `text_generation` rows (16 verified, 10 unknown) and no `speech_to_text` capability.
- The Google Gemini account's recorded usage is 124 requests / 57,914 tokens, but numeric request/token ceilings and the usage reset window are unknown. The OpenRouter free-quota observation is dated 7 November 2026 and cannot establish current remaining quota. Do not treat an old 50-request snapshot as current capacity.
- Deployed ARIA runtime-gateway, agent-runtime and execution-runtime source still has `MISSION_EXECUTION_PAUSED=true`. Cron jobs 48, 49 and 50 are disabled; the read-only mission-state audit found zero running missions.
- Safety PRs remain OPEN/DRAFT/not merged: [#1474 circuit breaker](https://github.com/Robvg9/aria-worker/pull/1474), [#1475 provider quota observability](https://github.com/Robvg9/aria-worker/pull/1475), [#1476 unknown-capacity route blocking](https://github.com/Robvg9/aria-worker/pull/1476), [#1478 mission budget ledger](https://github.com/Robvg9/aria-worker/pull/1478), [#1479 runtime budget enforcement](https://github.com/Robvg9/aria-worker/pull/1479). Their CI jobs have passed, but #1478's budget tables do not exist in the ARIA LIVE database and #1479's guards are not live.
- No provider request, mission, cron, migration, secret change or deployment was performed in this audit. Keep the global freeze and crons disabled until all safety gates are reviewed, merged and deployed with an owner-approved free-only request budget.


## 31. Service Worker navigation HTTP-cache bypass — exact-SHA PASS (27 November 2026 UTC)

- The owner reported that an additional manual refresh was needed during the first rollout after the build-fingerprinted Service Worker registration change.
- The online navigation handler in `public/sw.js` now uses `new Request(request, { cache: 'no-store' })` before fetch. This explicitly bypasses the browser HTTP cache instead of relying only on the hosted HTML response's `Cache-Control: no-store` header.
- Offline navigation continues to use Cache Storage. The Service Worker shell namespace advanced from `simplelife-shell-v12` to `simplelife-shell-v13`; activation retires the previous public shell. IndexedDB, localStorage and encrypted offline-vault data are not cleared.
- Added a browser regression that serves build-1 HTML with one-year HTTP freshness, changes the document to build-2 while the Service Worker already controls the tab, then asserts that the next navigation fetches and renders build-2 without manual reload.
- Added unit coverage for the navigation cache bypass and PWA shell v12→v13 cache migration.
- Exact HEAD: `ddd4a6ce896ac9809a7902d62949cab3ca6cb9f5`; [CI #1020 SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/46004552502), 51/51 steps, 206/206 unit tests, 59/59 browser/mobile, and 9/9 hosted Preview PWA cold-launch/update tests.
- Exact Preview build: JS `/assets/index-CV7SgGFC.js`; CSS `/assets/index-DqGuvou2.css`; manifest 2 assets; Service Worker SHA-256 `3596d6977f4bc6c82fa18e489a0a6268203b60fafb4df8b757ec7fa50212f646`; app HTML byte-for-byte matches the CI build and has `Cache-Control: no-store`.
- **Owner gate remains OPEN:** the automated regression validates the mechanism; an owner opening the latest Preview after this exact build without a manual refresh has not yet been confirmed. Do not clear site data or reset the offline vault to test it.
- No merge, production deploy, hosted Supabase mutation, external provider request, paid billing, mission execution or cron reactivation.

## 30. Phase 2 closeout decision — still OPEN

- **PASS:** text/voice capture foundation, private audio lifecycle, local Whisper transcription/save in Preview, Inbox review/organization/provenance, search/deduplication/trash, idempotent processing/scheduler in DEV, encrypted offline vault and owner-confirmed Android/PC offline flows, including PC interrupted retry.
- **OPEN:** model-backed Inbox classification through an approved and budget-governed ARIA route; explicit review/save persistence of a locally transcribed Android recording; and review/merge/release of PR #97. Physical Android Whisper inference is PASS 3/3, and the owner-session Preview navigation Dashboard → Inbox is PASS in a fresh Android tab without a manual refresh.
- The ARIA Planner (daily prioritization/replanning) is Phase 3 and is not a Phase 2 blocker.
- Do not mark Phase 2 100% or begin Phase 3 until the remaining open items are either implemented and evidenced or explicitly accepted by the owner as scope deferrals. No merge/production release is implied by this checkpoint.



## 32. Exact-SHA Windows, Preview and physical Android closeout audit — 27 November 2026 AST

- Branch `feat/phase2-inbox-completion-v1`; exact HEAD `21b6d228dfe7f9105bbb2635bffd8270c3247af7`.
- GitHub Actions [CI #1024 SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/46095529104): unit tests, browser/mobile smoke, ephemeral Supabase/Postgres/RLS/migrations, Inbox and Agenda Edge Runtime smokes, production build, PWA offline cold-start and Cloudflare Preview cold-launch after full browser restart all passed. The conditional browser-trace upload was skipped because no test failed.
- Independent Windows reproduction on ROBVG at the same SHA: `npm test` 206/206 PASS; `npm run build` PASS. Root cause of the initial local false failure was `core.autocrlf=true`: Windows converted `public/_headers` to CRLF while the test parser split sections using LF only. Commit `21b6d22` normalizes CRLF in the test input. This is a test portability correction only; it does not alter the app or deployed headers. Worktree is clean.
- Physical Android: Samsung SM-A165M, Android 17 (SDK 37), Chrome 158.0.8127.92. Three owner-authorized private recordings were transcribed one by one using on-device Whisper.cpp; 3/3 completed. No **Guardar transcripción como captura** action was invoked. After re-entering Inbox, the audio cards were again ready to transcribe; unsaved review text was not treated as durable data. No original audio object was changed or deleted, and no provider received audio or transcript text.
- A new independent tab opened the Preview directly, retained the owner session, reached a Service Worker-controlled page and navigated Dashboard → Inbox without a manual refresh. The original tab was preserved. ADB remained connected and temporary CDP port-forward 9222 was removed after inspection.
- PR #97 remains OPEN / DRAFT / NOT MERGED. Preview only; no production deploy, hosted database write/migration, secret change or provider request.
- ARIA safety chain #1474–#1476 and #1478–#1484 remains OPEN / DRAFT / NOT MERGED; current PR workflows inspected in this audit were successful, but CI is not deployment evidence. The latest recorded LIVE state remains `MISSION_EXECUTION_PAUSED=true` with no LIVE mission-budget reservation enforcement. No budget policy row was created and no model call was made; an explicitly approved numeric free-only policy and deployed guard remain prerequisites.
- **Verdict:** Windows test portability PASS; 206/206 local tests PASS; CI #1024 PASS; production build PASS; Android local inference PASS 3/3; Android fresh Preview navigation PASS. Phase 2 remains OPEN for model-backed classification governance, Android transcript save/persistence acceptance, and PR review/merge/release.


## 33. Windows Inbox E2E 23/23 and ARIA classification scope audit — 28 November 2026 AST

### Exact-HEAD Windows Inbox E2E — PASS

- Exact code HEAD under test: `2087544cd4cf3c3fda0bba10a1be13628cf5e1cf` (PR #97 branch `feat/phase2-inbox-completion-v1`).
- On the authorized ROBVG PC, using already-installed Chrome 158.0.8127.92 and the repository's local Vite app server, ran the 23 Playwright tests matching `Inbox` in `tests/e2e/app-data.spec.js` with one worker and synthetic browser mocks. Final reporter: **23 passed (3.0m)**.
- Coverage includes transcript ordering, Inbox search/review/archive/restore, partial-save retry/idempotency, processing lifecycle, owner clarification, pagination, project/goal provenance, duplicate detection, event conversion, private voice asset checks, and mobile voice capture/transcription controls.
- The first isolated attempt used port 5199, but the mock's CORS response is deliberately hard-coded to `http://127.0.0.1:5173`; those failures were caused by the test harness origin mismatch. Re-running on the repository's canonical 5173 origin passed all 23 Inbox tests. No hosted DEV/production writes or provider calls occurred.
- The broader 59-test run is **NOT CERTIFIED**: it hit an unrelated task-form label locator in the first non-Inbox test and did not produce a complete final summary. Do not claim all 59 passed. CI #1025 remains exact-HEAD SUCCESS for the committed pipeline gates.
- Cleanup: temporary Playwright config/results removed; only the Vite test server started by this audit was terminated; ports 5173 and 5199 have no listening test server; git worktree clean and HEAD unchanged after the test.

### ARIA mission issuer — corrected finding

- A genuine canonical ARIA mission-intake chain exists: `aria-app-api-v3 → aria-direct-v1 → aria-mission-intake-v1 → aria_mission_create`. The earlier audit statement that no legitimate ARIA mission issuer existed was too broad.
- This does not provide a valid SimpleLife Inbox classification path today. With `MISSION_EXECUTION_PAUSED=true`, the existing intake/runtime paths remain limited to Mission Wonder 2 A4/A5 read-only scopes, the separate Gate 3 one-shot probe, Cloudflare read-only plan preview, and strict conversation-only requests. Gate 3 is bound to its own mission/step, Human Gate, short fixed probe and one-call scope; none is a general Inbox classification route.
- Normal mission execution requires a real persisted mission/step plus budget reservation. The mission-budget ledger/runtime enforcement PR chain remains OPEN/DRAFT and is not confirmed deployed LIVE. The missing component is a dedicated authorized Inbox classification scope and deployed budget enforcement, not all ARIA mission issuance.

### $0 model route and privacy — research only, not an authorization

- Google's official pricing currently lists `gemini-3.5-flash-lite` Standard Free Tier input/output as free of charge, but also states Free Tier content may be used to improve Google's products. It is not approved for personal Inbox content under privacy-by-default without explicit owner acceptance. Source: https://ai.google.dev/gemini-api/docs/pricing
- OpenRouter currently lists `nvidia/nemotron-3.5-lightning:free` at $0 input/output; its current free-model guidance warns against sending confidential/personal data and notes free capacity/rate limits vary. Synthetic fixtures only. Sources: https://openrouter.ai/es/nvidia/nemotron-3.5-lightning%3Afree and https://openrouter.ai/blog/insights/nemotron-3-5-lightning/
- Public pricing does not prove the connected account's remaining quota, route availability, current ARIA registry state, or a live budget reservation. No key was read; no provider GET/POST or inference was performed. The previously approved one-request synthetic test remains blocked until those account-specific gates and the dedicated Inbox scope are verified.

### Current owner gates — Phase 2 remains OPEN

- **PASS:** exact-HEAD CI #1025; Windows unit 206/206 and build; Windows Inbox Playwright 23/23; Android local Whisper inference 3/3; fresh Android Preview Dashboard → Inbox navigation.
- **OPEN:** explicit physical Android transcript review/save persistence; dedicated privacy-approved model classification route and LIVE budget enforcement; independent review/merge/release decision for PR #97.
- The owner must unlock the Android device and the SimpleLife private vault locally before the physical transcript-save acceptance can be performed. Never send the passphrase or recovery key in chat. No original audio has been changed or deleted.
- No merge, production deploy, hosted migration, secret/billing change, provider request, ARIA unpause or cron reactivation occurred.
