# SimpleLife — live Supabase authenticated smoke

## Purpose

This is an opt-in browser smoke against the real Supabase development project `Simplelife_dev`. It is separate from the normal mocked Playwright suite and runs only through the dedicated manual workflow.

## Account model — read before running

Use a **dedicated, persistent QA-only Auth account**, never a personal user account. Do not create accounts through the application as part of this test, and do not add a service-role/secret key.

The current schema has `user_profile.auth_user_id → auth.users.id ON DELETE RESTRICT`; owned data also references `user_profile` with RESTRICT constraints. There is no safe assumption that deleting the Auth user at the end will work. Therefore this smoke reuses one QA account and three stable canary records; it does not claim to create a disposable identity or delete records physically.

The test account must be provisioned by an authorized human in the Supabase development project before the run. The user must have a confirmed email and a working password. The application creates/finds the matching profile and preference after successful sign-in.

## GitHub configuration

Add these repository Actions secrets (never commit the values):
- `SIMPLELIFE_QA_EMAIL`
- `SIMPLELIFE_QA_PASSWORD`

No service-role or secret API key is needed. The browser uses the same publishable key as the ordinary application.

## Run

1. Open GitHub → Actions → **SimpleLife live Supabase smoke** → Run workflow.
2. Select `confirm_live_writes = true` only after verifying the secrets point to the dedicated QA-only account in `Simplelife_dev`.
3. Inspect the run. A skipped job means the confirmation remained false; a failed credentials preflight means the two repository secrets are not configured.
4. Do not run this workflow with a personal account.

The workflow is manual-only, single-worker, and serialized. It uses no screenshots, videos, or Playwright traces, to avoid storing credential-entry data in artifacts.

## What it writes and verifies

The test creates a stable QA canary only when missing, and otherwise restores/updates the same one:
- Task: `__SIMPLELIFE_QA_SMOKE_TASK__` — changes state to In progress, reloads, verifies persistence, then archives.
- Note: `__SIMPLELIFE_QA_SMOKE_NOTE__` — saves its content, reloads, verifies persistence, then archives.
- List: `__SIMPLELIFE_QA_SMOKE_LIST__` with one `__SIMPLELIFE_QA_SMOKE_ITEM__` — checks the item, reloads, verifies its checked state, then archives the list.

The three canaries remain in the dedicated QA account as archived records and are reused by later runs. The list item remains attached to its archived list. This is intentional because authenticated users do not have physical DELETE privileges and the list-item table has no soft-delete column. The smoke must not be represented as data cleanup or Auth-user deletion.

## Safety boundaries

- No sign-up, Auth admin API, service-role/secret key, SQL writes, DDL, grant changes, RLS changes, or physical DELETE.
- Writes only via the signed-in QA account and ordinary UI flows; the UI scopes mutations to that account.
- Never run against a personal account or production.
- If the test fails, inspect the dedicated QA account's three canaries, restore/archive them as needed, then rerun only after checking that the secrets still point to the QA account.
- This proves real Auth sign-in, profile bootstrap, authenticated Data API CRUD and persistence across a browser reload for these three entities. It is not a comprehensive RLS security test and not a physical-device test.
