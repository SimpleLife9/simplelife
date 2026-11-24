# Phase 2 — Owner Acceptance (Desktop + Physical Android)

**Status:** Technical DEV deployment partially verified on 24 November 2026; owner acceptance remains OPEN. Automated Playwright viewport tests are not a substitute for desktop/physical Android acceptance.
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
- [ ] Enqueue one disposable owner-owned DEV capture. Confirm the scheduled run processes it, persists one unreviewed proposal batch and records the expected terminal state.
- [ ] Confirm expired private voice objects are removed before their metadata/audit receipt is deleted.
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

**Acceptance boundary:** CI and the local Edge Runtime smoke test validate the code path with disposable local fixtures. They do not prove that the new migration or function has been deployed to hosted DEV. Apply/deploy to DEV only in a separately authorized DEV operation, then repeat with an owner-owned private object. Production remains out of scope.

**Local expiry-purge E2E added to the CI smoke:** the test creates a disposable owner-owned audio row and a real object in the local private Storage bucket, moves only that fixture's `retention_until` into the past, invokes the actual local dispatcher Edge Runtime, and asserts that the physical Storage object is gone, the metadata row is gone, and exactly one append-only `capture.audio_purged` receipt records `object_removed=true`. The fixture is cleaned through the Storage API on failure. This proves the local code path and ordering; the hosted DEV checkbox in Section 3 remains open until the same result is verified in hosted DEV under an authorized operation.
