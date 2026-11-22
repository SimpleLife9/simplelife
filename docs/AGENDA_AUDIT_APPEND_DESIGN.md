# Agenda — trusted Event writes and append-only audit path

**Status:** SECURITY / DATA DESIGN PROPOSAL — NOT IMPLEMENTED  
**Date:** 22 November 2026 (read-only catalog refresh)  
**Repository baseline:** `main` SHA `3e861d5a1c17297ff99ba4e96849d8565e80fe2b`  
**Supabase target inspected read-only:** `Simplelife_dev` / `iybnjrnysiikbtokyshg` / PostgreSQL 17.12

This document defines a safe route for the first persisted Phase 1 Event. It is a design artifact only: no migration, DDL, function, trigger, grant, RLS policy, row write, Auth setting or hosted deployment is authorized by this document.

## 1. Prior read-only baseline snapshot (21 November 2026)

The observations in this section are preserved as the historical 21 November snapshot. The current catalog recheck is recorded in §7; the 22 November recheck did not inspect or count audit row contents.

### Existing `public.audit_event`

Read-only catalog inspection established:

- Columns: `id` UUID; `account_user_id` UUID NOT NULL; `actor_user_id` UUID nullable; `action`, `entity_type`, `result`, `source` text; `entity_id` UUID nullable; `correlation_id` UUID nullable; `details` JSONB NOT NULL; `occurred_at` and `recorded_at` timestamptz NOT NULL.
- `id` has a CHECK that requires UUID version 7 and the RFC 4122 variant bits.
- `details` must be a JSON object. `result` is constrained to `success`, `failure`, `denied`, or `pending`. `source` is constrained to `user`, `system`, or `ai`.
- RLS is enabled. The only current policy for `authenticated` is owner-scoped SELECT through `user_profile.auth_user_id = auth.uid()`.
- `authenticated` has SELECT only. It has no INSERT, UPDATE or DELETE. `anon` has no table grant. The existing `BEFORE UPDATE OR DELETE` trigger calls `private.reject_audit_mutation()`.
- At the 21 November snapshot, the table had no append trigger/function and contained zero records. The 22 November recheck confirms there is still no append trigger/function, but deliberately did not query audit row contents or count rows. No historic action/entity naming convention was present at the earlier snapshot.

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


## 7. Current read-only catalog verification — 22 November 2026

A new read-only inspection was made against `Simplelife_dev` on PostgreSQL 17.12. It queried migration metadata and PostgreSQL catalogs only; it did not read Event content, audit rows, personal records or write any data.

### Migration-source state

The provider's migration list returned exactly these six versions, matching the six SQL files under `supabase/migrations/` at repository `main` SHA `3e861d5a1c17297ff99ba4e96849d8565e80fe2b`:

| Version | Name |
|---|---|
| `20261119124048` | `simplelife_personal_core_v1` |
| `20261119124130` | `simplelife_core_rls_and_permissions_v1` |
| `20261119124200` | `restrict_rls_automation_function_v1` |
| `20261119132044` | `simplelife_restrict_client_column_updates_v1` |
| `20261119132635` | `simplelife_core_foreign_key_indexes_v1` |
| `20261119133009` | `simplelife_default_acl_restrictions_v1` |

The read-only `supabase migration list --linked` CLI check is still outstanding. Do not use `db push` to perform this check or reconcile history.

### Existing audit table and trust objects

- `public.audit_event` exists, is owned by `postgres`, has RLS enabled (not FORCE RLS), and has the established owner-read policy for `authenticated`. The policy resolves `auth.uid()` through `public.user_profile.auth_user_id` to the profile ID in `account_user_id`.
- Its columns remain `id`, `account_user_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `result`, `source`, `correlation_id`, `details`, `occurred_at`, and `recorded_at`.
- Current checks still require a UUIDv7 version nibble and RFC variant bits `10`, `details` to be a JSON object, `result` in `success|failure|denied|pending`, and `source` in `user|system|ai`.
- The only non-internal trigger on `audit_event` is `audit_event_immutable` (`BEFORE UPDATE OR DELETE`, calling `private.reject_audit_mutation()`). No append trigger, `private.uuidv7()`, or audit append function exists.
- `authenticated` currently has SELECT only on `audit_event`. There is no INSERT, UPDATE or DELETE grant. `anon` has no table grant.
- Important least-privilege finding: `service_role` currently has the residual table privileges represented by ACL `Dxtm` — TRUNCATE, REFERENCES, TRIGGER and MAINTAIN — but no SELECT, INSERT, UPDATE or DELETE. A row-level immutability trigger does not protect against TRUNCATE. The proposed Event migration should revoke all direct `service_role` privileges on `audit_event`; the append trigger will write as its trusted database owner instead.
- `private` exists with schema ACL `postgres=UC/postgres`; `anon`, `authenticated` and `service_role` do not have USAGE on it. The only matching private audit routine found was `reject_audit_mutation()`, `SECURITY INVOKER`, with `search_path=pg_catalog`.
- `public.calendar_event` does not exist.

### Default-privilege asymmetry that migrations must account for

The read-only `pg_default_acl` snapshot showed different defaults by object-creating role:

- For objects created by `postgres` in `public`, table defaults include `service_role=Dxtm` but not its SELECT/INSERT/UPDATE/DELETE privileges; function defaults grant EXECUTE only to `postgres`.
- For objects created by `supabase_admin` in `public`, the observed defaults still include broad table privileges and function EXECUTE for `anon`, `authenticated` and `service_role`.

The recovered sixth migration revokes defaults from `PUBLIC`, `anon` and `authenticated`, but not `service_role`, and it does not rewrite the separate `supabase_admin` defaults. Therefore a future migration must not rely on default privileges or assume all objects have the same ACL merely because the platform defaults changed.

**Required migration rule:** explicitly `REVOKE ALL` on every new object from `PUBLIC`, `anon`, `authenticated` and `service_role`, then add only the per-object grants listed below. Also verify the actual owner and ACL after replay. The migration creating private objects must run under a role that has the reviewed `private` schema CREATE privilege; current catalog evidence shows that is `postgres`.

## 8. Refined Event persistence and audit contract

### One-way trust boundary

The proposed writer remains a user-authenticated Edge Function with `verify_jwt = true` and `withSupabase({ auth: "user" })`:

1. Verify the user's JWT and resolve an active `user_profile.id` from the verified `ctx.userClaims.id` / `auth_user_id` mapping using the caller-scoped client.
2. Derive `owner_user_id`, `created_by_user_id` and `updated_by_user_id` server-side. In Phase 1 personal Events, all three must equal the authenticated user's profile ID.
3. Validate and normalize the Event draft with the pure Event domain contract. For zoned-civil times, resolve both endpoints atomically through the pinned IANA range resolver; never trust client-supplied canonical UTC values. For fixed-instant values, require explicit offsets and normalize them server-side. All-day remains date-only.
4. Use `ctx.supabase` for ordinary caller-scoped reads. Use `ctx.supabaseAdmin` only for the narrowly authorized write path after identity derivation. Because this client bypasses RLS, every read/update performed through it must include both the verified `owner_user_id` and the target ID in its filter.
5. The service-role secret must remain server-only. No browser client receives Event INSERT/UPDATE/DELETE privileges.

**Important trust clarification:** an AFTER trigger invoked by a service-role write does not independently receive the end user's original JWT identity. The trigger therefore cannot claim that `auth.uid()` independently proves `NEW.updated_by_user_id`. The trusted Edge Function is the authentication/authorization boundary; the trigger validates that the server-authored owner/creator/updater fields are present, consistent and immutable where required, then records those values. A database-side JWT-bound write RPC would be a different architecture and is not silently introduced by this proposal.

### Explicit grants for the first Event table

For `public.calendar_event`, the intended object-level access is:

| Role | Proposed privileges | Reason |
|---|---|---|
| `anon` | none | No anonymous Event access |
| `authenticated` | SELECT only | Browser reads protected by owner-scoped RLS |
| `service_role` | SELECT, INSERT, UPDATE only | Trusted Edge Function writes; its code must filter by verified owner |
| `PUBLIC` | none | No inherited access |

No role receives DELETE or TRUNCATE. Enable RLS before API access. The authenticated SELECT policy resolves `auth.uid()` through `user_profile.auth_user_id` and matches the profile ID to `calendar_event.owner_user_id`. The service role bypasses RLS, so the Edge Function's owner checks are mandatory and must have two-user isolation tests.

For the existing `public.audit_event`, preserve authenticated owner-scoped SELECT but revoke all direct privileges from `PUBLIC`, `anon` and `service_role`. Do not grant INSERT to `authenticated` or `service_role`. The trigger function runs under its trusted owner and appends the audit row transactionally. This also removes the current residual `service_role` TRUNCATE/TRIGGER/REFERENCES/MAINTAIN privileges.

Because the Supabase Data API change was enforced for existing projects on 30 October 2026, new public tables must have deliberate explicit grants; RLS alone does not make a table reachable or secure it from privileged roles. See [Supabase's Data API grant change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) and [Securing your API](https://supabase.com/docs/guides/api/securing-your-api).

### Trigger function requirements

Use one row trigger on `public.calendar_event` for INSERT and UPDATE. It is not a general append API.

- Place the trigger function and UUIDv7 generator in the existing unexposed `private` schema, with owner `postgres`.
- Use `SECURITY DEFINER` only for the append trigger, with fixed `search_path = pg_catalog`, fully qualified object names, no dynamic SQL, and a fixed minimal body.
- Revoke function EXECUTE from `PUBLIC`, `anon`, `authenticated` and `service_role`; do not expose the `private` schema or create a generic audit RPC. Create the trigger under the trusted migration owner, then verify locally that trigger invocation still works after the direct EXECUTE revokes.
- On INSERT, require owner = creator = updater. On UPDATE, reject any owner/creator change and require updater = owner for Phase 1 personal Events.
- Append one row to `public.audit_event` in the same transaction: `account_user_id = NEW.owner_user_id`, `actor_user_id = NEW.updated_by_user_id`, `entity_type = 'calendar_event'`, `entity_id = NEW.id`, `source = 'user'`, `result = 'success'`, server-generated timestamps and a DB-generated UUIDv7.
- Use a controlled action vocabulary: `calendar_event.created`, `calendar_event.updated`, and explicit functional/lifecycle transition names when those state transitions actually occur. A cancellation keeps the original Event/time; archive and trash remain separate lifecycle transitions.
- For UPDATE, compare only approved business and lifecycle fields using null-safe equality. Do not append for a no-op or an `updated_at`-only touch. Capture changed field names and minimal before/after status/lifecycle values only; never copy descriptions, locations or full Event snapshots into audit details.
- A failed append aborts the Event mutation. A trigger-created record is evidence of a committed mutation, not a telemetry record of rejected HTTP requests.

The UUIDv7 helper must satisfy the existing `audit_event.id_check`: 48-bit Unix-millisecond timestamp, version 7 nibble, RFC variant bits `10`, and 74 random bits from the existing `extensions.gen_random_bytes(10)`. The wall clock is not a monotonic clock: require valid version/variant, valid UUID representation, uniqueness under a large test batch and plausible timestamp prefix, but do not promise strict global monotonicity under clock adjustment or same-millisecond calls. The Event UUID can be generated by the trusted Edge Function using the existing pure `src/lib/uuidv7.js` helper; it is not accepted from user JSON. An Event-create idempotency key, if adopted, must be separate from the Event ID and scoped uniquely to the owner; its persistence/response-replay contract remains an explicit implementation decision to close before CRUD.

### Required local verification before any hosted migration

- Confirm the linked CLI migration inventory read-only and match the six source versions; do not run `db push` to reconcile history.
- Apply the proposed DDL only in ephemeral local PostgreSQL after the existing six migrations and platform RLS bootstrap.
- Assert migration/object owner, schema ACL, table ACL, RLS flags and policy definitions from catalogs. Assert no grants to `anon`, no direct authenticated write grants, no direct audit-event service-role privileges and no unintended function EXECUTE.
- Test the UUIDv7 generator against the exact existing CHECK constraint and a high-volume collision sample.
- Test trigger append on INSERT and meaningful UPDATE, no append on no-op/timestamp-only UPDATE, and rollback of the Event row when audit insertion is forced to fail.
- Test that the trigger still runs after direct function EXECUTE privileges are revoked and that callers cannot invoke private functions through Data API/RPC.
- Test two disposable authenticated users: owner A can read only A, owner B only B; direct authenticated and service-role table writes have only the intended behavior; cross-owner ID guessing, owner/actor tampering and direct audit writes fail.
- Test service-role Event selects/updates always carry the verified owner filter; audit rows remain readable only under the current owner SELECT policy.
- Test retries with the selected Event-create idempotency design, if adopted; the same key/same payload must not create duplicate Events or audit rows.

No production migration, function deploy, key change, Auth/RLS/grant change, cron, row write or release is authorized by this design. A separate explicit Human Gate is required before any hosted DDL or deployment.
