# Agenda — trusted Event writes and append-only audit path

**Status:** SECURITY / DATA DESIGN PROPOSAL — NOT IMPLEMENTED  
**Date:** 21 November 2026  
**Repository baseline:** `main` SHA `157aa3fce16a06d97b01519de18578a8906425ee`  
**Supabase target inspected read-only:** `Simplelife_dev` / PostgreSQL 17.12

This document defines a safe route for the first persisted Phase 1 Event. It is a design artifact only: no migration, DDL, function, trigger, grant, RLS policy, row write, Auth setting or hosted deployment is authorized by this document.

## 1. Verified baseline

### Existing `public.audit_event`

Read-only catalog inspection established:

- Columns: `id` UUID; `account_user_id` UUID NOT NULL; `actor_user_id` UUID nullable; `action`, `entity_type`, `result`, `source` text; `entity_id` UUID nullable; `correlation_id` UUID nullable; `details` JSONB NOT NULL; `occurred_at` and `recorded_at` timestamptz NOT NULL.
- `id` has a CHECK that requires UUID version 7 and the RFC 4122 variant bits.
- `details` must be a JSON object. `result` is constrained to `success`, `failure`, `denied`, or `pending`. `source` is constrained to `user`, `system`, or `ai`.
- RLS is enabled. The only current policy for `authenticated` is owner-scoped SELECT through `user_profile.auth_user_id = auth.uid()`.
- `authenticated` has SELECT only. It has no INSERT, UPDATE or DELETE. `anon` has no table grant. The existing `BEFORE UPDATE OR DELETE` trigger calls `private.reject_audit_mutation()`.
- The table has no append trigger/function today and contained zero records at the time of the read-only audit. There is no historic action/entity naming convention to preserve yet.

### UUIDv7 support

The project has `pgcrypto 1.3` and `uuid-ossp 1.1` installed in schema `extensions`, but no native or extension UUIDv7 generator was found in `pg_proc`. `extensions.gen_random_bytes(integer)` is available.

A read-only SELECT prototype composed a UUIDv7 from the database millisecond clock and 10 cryptographically random bytes. Its sample had version bits `7`, variant bits `128`, and passed the exact version/variant predicate used by `audit_event.id`. This validates the proposed bit layout only; no SQL function was created.

The existing client helper `src/lib/uuidv7.js` is useful for client-generated domain IDs, but it does not provide a trusted database-side ID for an audit row and must not imply that the browser can insert audit records.

## 2. Trust boundary for Event writes

All Phase 1 Event mutations should go through a user-authenticated Supabase Edge Function (for example, `agenda-event-write`):

1. Keep `verify_jwt = true` in `supabase/config.toml`.
2. Wrap the request with `withSupabase({ auth: "user" })`. This checks for a valid user JWT on `Authorization`.
3. Resolve the user's `user_profile.id` through `ctx.supabase`, the caller-scoped client, using `ctx.userClaims.id` / `auth_user_id`. Require an active profile.
4. Derive `owner_user_id`, `created_by_user_id`, and `updated_by_user_id` from that profile. Reject client fields that attempt to set owner, actor, canonical UTC instants, audit metadata, source, or lifecycle timestamps directly.
5. For a timed Event, call the shared `resolveLocalDateTimeRange()` inside this trusted server path. Ignore any client-supplied `starts_at` / `ends_at`; construct canonical instants and TZDB metadata from the resolver.
6. Use `ctx.supabaseAdmin` only for the mutation after authorization and identity derivation. It bypasses RLS; every SELECT/UPDATE must be explicitly filtered by the authenticated profile's `owner_user_id` and object ID. Never use it as a general client or return its credentials.
7. Use `ctx.supabase` for ordinary caller-scoped reads wherever possible.

Supabase's current Edge Function guide explicitly distinguishes `ctx.supabase` (caller-scoped RLS) from `ctx.supabaseAdmin` (bypasses RLS), and warns to filter admin queries by the caller's ID. Reference: https://supabase.com/docs/guides/functions/auth (updated 18 November 2026).

### Data API and table grants

For the future `public.calendar_event` table:

- `authenticated`: SELECT only through the Data API, with owner-scoped RLS.
- `anon`: no grant.
- `authenticated`: no direct INSERT, UPDATE or DELETE. All writes go through the authenticated Edge Function and its server-side allowlist.
- The service role is a backend-only trust boundary; never place its key in the browser or client bundle.
- The Event Edge Function must not trust `owner_user_id` or actor IDs from JSON, URL parameters, or client-controlled headers.

This keeps the browser from bypassing the authoritative timezone resolver or the audit transition path. It also means an Edge Function using `ctx.supabaseAdmin` must implement strict owner checks itself because the service client bypasses RLS.

## 3. Database-owned audit append design

Use one narrowly scoped row trigger on `public.calendar_event`, not a generic user-callable audit RPC.

### Server-owned actor columns

The future Event row should include:

- `owner_user_id`: immutable profile owner.
- `created_by_user_id`: profile ID derived by the Edge Function at creation.
- `updated_by_user_id`: profile ID derived by the Edge Function on every accepted update.

For Phase 1 personal Events, require `created_by_user_id = updated_by_user_id = owner_user_id`. Shared or delegated actors are not part of this phase. These columns must not be accepted from browser input or granted for direct authenticated writes.

### Trigger behavior

A single `AFTER INSERT OR UPDATE` trigger on `calendar_event` appends one `audit_event` row in the same database transaction:

- `account_user_id := NEW.owner_user_id`.
- `actor_user_id := NEW.updated_by_user_id` (on INSERT, this is initialized to the creator).
- `entity_type := 'calendar_event'`.
- `entity_id := NEW.id`.
- `source := 'user'`.
- `result := 'success'`.
- `action`: use a small controlled vocabulary such as `calendar_event.created` and `calendar_event.updated`; use specific status/lifecycle action names only when they correspond to real state transitions.
- `occurred_at` and `recorded_at` use database timestamps.
- `details` contains minimal transition evidence: changed field names and the old/new functional or lifecycle status where relevant. Do not duplicate full descriptions, locations or other sensitive Event text into the audit log.

The trigger function must be internal and narrowly scoped:

- Place it in the unexposed `private` schema.
- Use `SECURITY DEFINER` only because the authenticated caller intentionally lacks direct INSERT on `audit_event`; the trigger needs to append under its tightly controlled owner.
- Set a fixed `search_path = pg_catalog`; fully qualify every non-catalog object (`public.audit_event`, `private.uuidv7()`, etc.).
- Do not expose a general-purpose append function or grant EXECUTE to `PUBLIC`, `anon`, or `authenticated`. The trigger is the only intended caller.
- Validate the server-owned actor/owner fields and fail closed if they are null, inconsistent, or outside the Phase 1 personal-owner rule.
- Keep the existing immutable UPDATE/DELETE trigger on `audit_event`.
- Do not add a generic INSERT grant to `authenticated`.

If an audit append fails, the Event mutation must fail in the same transaction. The system must never report a successful Event write without its required audit row.

### UUIDv7 generator

A private `private.uuidv7()` helper can construct UUIDv7 using:

- Database milliseconds from `clock_timestamp()`.
- 10 bytes from `extensions.gen_random_bytes(10)`.
- Version nibble `7`.
- RFC variant bits `10`.
- The remaining bits filled from the cryptographic random bytes.

The implementation must be unit-tested against the exact `audit_event.id` CHECK and should not rely on `gen_random_uuid()` (UUIDv4 does not satisfy the constraint). Keep this helper private and do not expose it as a client RPC.

## 4. Mutation semantics and audit scope

- INSERT: record `calendar_event.created`.
- UPDATE: record `calendar_event.updated` only when an approved business or lifecycle field actually changes; do not produce noise for an unchanged row or a timestamp-only touch.
- Cancel, reopen, finish, archive, restore and trash changes are ordinary audited state transitions with the previous and new state captured in minimal details.
- Physical DELETE is not available to the client and is not part of Phase 1 lifecycle. No DELETE trigger is planned for Event rows.
- A trigger-generated audit record is evidence of a committed database mutation, not a log of rejected HTTP requests. Denied/failed attempts are not represented by this row trigger; any future security-event telemetry must be designed separately and must not weaken the append-only table.

## 5. Required verification before the first Event migration

### CI / local PostgreSQL

- Migration replay from the recovered six-migration baseline.
- `private.uuidv7()` tests for version/variant bits, valid UUID cast, monotonic timestamp prefix and generated IDs passing the audit table constraint.
- Trigger append on Event INSERT and meaningful UPDATE.
- No audit record on a no-op UPDATE.
- Event write and audit row commit atomically; force an audit failure and verify the Event write rolls back.
- Existing audit rows cannot be UPDATEd or DELETEd.
- Verify exact role/table grants and RLS flags after migration.

### Real-auth two-user isolation

Use two disposable authenticated test accounts, never production personal data:

1. User A creates an Event through the Edge Function. The row is owned by profile A, and the audit row has account A / actor A.
2. User A cannot read, update or archive User B's Event by guessing its ID.
3. User B cannot read User A's Event or audit record.
4. Direct authenticated REST INSERT/UPDATE/DELETE against `calendar_event` fails.
5. Direct authenticated INSERT/UPDATE/DELETE against `audit_event` fails.
6. Tampering with owner, creator, updater, starts_at/ends_at, TZDB version, source or audit details in the request is rejected or ignored; the server derives these fields.
7. The service/admin client is used only inside the authenticated Edge Function and every admin query is explicitly owner-filtered.

### Rollback and operational gates

- Migration must include a reviewed rollback/compensation plan before any hosted DDL. Rollback may remove the new Event trigger/function/table only according to the approved recovery procedure; it must not rewrite or delete existing append-only audit history.
- Run the Supabase CLI local Edge Runtime smoke with valid user JWT, expired/invalid JWT, and publishable/secret keys used incorrectly as Bearer values.
- Confirm the actual local runtime environment variables and the pinned Deno graph.
- Review the TZDB dependency/update/rollback cadence before hosted function deployment.

## 6. Explicit non-effects

This proposal has not created `calendar_event`, `private.uuidv7()`, an audit trigger, RPC, function, migration, policy or grant. It has not modified user data, Auth, secrets, Data API settings, existing audit rows, or deployed functions. A separate explicit Human Gate is required before implementing or applying the first database migration.
