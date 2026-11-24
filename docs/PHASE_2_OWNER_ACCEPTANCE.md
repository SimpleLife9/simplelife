# Phase 2 — Owner Acceptance (Desktop + Physical Android)

**Status:** Hosted DEV scheduler/audio-retention checks PASS. HTTPS Cloudflare Preview is available from PR #97 commit `35ef1620e3241fba2d58e4c44a069c2310eadd13`; owner confirmed the login screen loads without Cloudflare Access. Actual sign-in and desktop/physical Android owner acceptance remain OPEN. Automated Playwright viewport tests are not a substitute for desktop/physical Android acceptance.
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
- [ ] Confirm scheduler failures are visible in cron/net/Edge logs without printing secrets or source audio.

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
