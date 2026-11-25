# Phase 2 — Owner Acceptance (Desktop + Physical Android)

**Authoritative status (updated 25 Nov 2026 AST):** PR #97 HEAD 29de4c6ecaa610c462e44bd6107133f968cd52dc; CI #879 exact-SHA **SUCCESS (49/49 steps; zero failures)**. CI includes recovery-key rotation, browser/mobile, local Postgres/migrations, Deno, local Edge Runtime, build and exact Cloudflare Preview cold-start tests. Physical owner acceptance remains partial; see the consolidated current gate list in Section 9. Voice transcription/model-backed classification remains a **technical provider gate**, not a user check: do not send private captures/audio to a model until route, model, region, retention and free-only capacity are verified. PR #97 remains OPEN / DRAFT / NOT MERGED; DEV/Preview only.
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
- **CI #879:** [SUCCESS](https://github.com/SimpleLife9/simplelife/actions/runs/45673467009), exact-SHA; all 49 workflow steps completed successfully, zero failed steps.
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
