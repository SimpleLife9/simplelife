# Agenda — Event create idempotency contract

**Status:** SOURCE IMPLEMENTATION + EPHEMERAL TESTS — NOT APPLIED TO HOSTED SUPABASE  
**Date:** 22 November 2026  
**Main baseline:** `d1ff5d1d401f0e8bb0acdbe7386c5d6c18805973`

This contract defines idempotent creation of one-off `calendar_event` records before the authenticated Event writer is implemented. It prevents a network retry or concurrent duplicate POST from creating multiple Events or multiple creation-audit records.

## 1. Request key and owner scope

- Every intentional Event-create action gets one client-generated UUIDv4 idempotency key, separate from the server-generated UUIDv7 Event ID.
- The same key is reused only for transport retries of that one action. A new intentional create receives a new key.
- The uniqueness scope is `(owner_user_id, idempotency_key)`. Two different owners may independently use the same key.
- The future authenticated Edge Function derives `owner_user_id` from verified JWT -> active `user_profile`; it never accepts owner/actor IDs from the request body.
- The server computes SHA-256 itself. It never trusts a client-supplied payload hash.

## 2. Canonical request hash

The hash covers the normalized, user-authored Event intent after `createEventDraft()` validation and before any persistence attempt.

Included:
- Contract version marker, title, description, location label/type and initial functional status.
- `all_day`: start date and exclusive end date only.
- `fixed_instant`: normalized UTC start/end plus optional source timezone.
- `zoned_civil`: requested IANA zone, original local wall times and independent fold/gap choices.

Excluded:
- Event ID, owner/creator/updater IDs and server timestamps.
- Derived UTC instants for zoned-civil Events.
- Resolver/TZDB versions and resolver metadata.

Excluding server-derived timezone results is intentional: after an uncertain network response, a retry with the same key and same local-time intent must replay the committed Event even if the IANA dataset has since been upgraded. A different title/date/instant/zone/fold choice/status produces a different hash.

The current pure helper is `src/features/agenda/domain/event-idempotency.js`; its JSON property order is explicit and versioned by `simplelife.agenda.event.create.v1`. It uses Web Crypto SHA-256 and produces a lowercase 64-character hex digest.

## 3. Atomic database reservation

The source migration `20261122140000_agenda_event_create_idempotency_v1.sql` adds a private ledger with only:
- owner profile UUID,
- UUIDv4 request key,
- canonical SHA-256 hash,
- Event UUIDv7,
- server creation timestamp.

It stores no title, description, location, request JSON or response-body snapshot. The composite primary key is `(owner_user_id, idempotency_key)`; the deferred owner/Event foreign key keeps the reservation attached to its Event and prevents a future physical Event delete from silently freeing the key.

A public-schema RPC exists only because the PostgREST server endpoint needs a callable function. Its security boundary is narrow:
- `SECURITY DEFINER`, owner `postgres`, fixed `search_path = pg_catalog`, fully qualified non-catalog objects.
- EXECUTE revoked from `PUBLIC`, `anon`, and `authenticated`; granted only to backend `service_role`.
- The private ledger has no direct privileges for any API role and the `private` schema remains unexposed.
- Direct `service_role` INSERT on `calendar_event` is revoked. Event creates must enter through this atomic function; backend SELECT/UPDATE remain for later owner-filtered operations.
- The RPC accepts a server-prepared Event record. The trusted Edge Function remains responsible for JWT verification, active profile resolution, request validation, IANA range resolution, UUIDv7 generation and server-owned actor fields.

## 4. Transaction and response semantics

The function reserves the unique owner/key pair before inserting the Event. Its foreign key is deferred until commit, so reservation, Event row and audit trigger append are one transaction.

| Situation | Database result | Future HTTP behavior |
|---|---|---|
| First owner/key/hash | Insert reservation + Event; audit trigger appends exactly once | HTTP 201; `{ id, createdAt }` |
| Same owner/key/hash retry | Return original Event ID and immutable created timestamp; no insert/update/audit | Replay the same HTTP 201 body and `Location` |
| Same owner/key, different hash | No write | HTTP 409 `IDEMPOTENCY_KEY_REUSED` |
| Same key, different owner | Independent reservation | Normal create for that owner |
| Audit append fails | Entire transaction rolls back, including reservation and Event | Error; safe retry with same key |

The create response is intentionally small and stable: `id` and immutable `createdAt` only, with the same `Location` header on replay. Event detail is loaded through the separate owner-scoped read path. The ledger does not duplicate personal content to preserve a larger response snapshot.

There is no expiry window in v1. The reservation remains while the Event row exists, so a delayed retry can never create a duplicate after an arbitrary TTL. A new intentional Event must use a new UUIDv4 key. Any future physical purge must respect the foreign key and retention policy.

Concurrency relies on the database unique constraint. A simultaneous retry waits for the first transaction: if it commits, the retry sees the saved result; if the first transaction rolls back, the retry can obtain the reservation and create the Event. A failed audit trigger aborts both rows in the same transaction.

## 5. Verification

The ephemeral SQL suite verifies:
- UUIDv4 key bits and SHA-256 format constraints.
- Backend-only RPC EXECUTE; no client execution grant.
- No direct API-role access to the private ledger.
- No direct `service_role` Event INSERT privilege.
- First create produces one Event and one audit row.
- Same owner/key/hash replays the original Event ID and created timestamp, even with a different candidate Event ID.
- Same owner/key with another hash returns conflict and creates nothing.
- Same key can be independently used by another owner.
- A failed audit append rolls back the Event and its idempotency reservation.
- Existing Event update/no-op and audit append-only behavior remain intact.

JavaScript tests verify UUIDv4 key shape, canonical input normalization, SHA-256 output, all three temporal kinds, and stability across resolver/TZDB metadata changes.

## 6. Explicit non-claims and remaining work

This slice does not implement or deploy an Event Edge Function, does not call Supabase from the browser and does not make Agenda persistent or LIVE. It adds only a pure intent/hash helper and a source migration that CI applies to an ephemeral local PostgreSQL instance.

A future writer must authenticate, resolve the active owner, validate the draft, atomically resolve zoned-civil endpoints, compute the hash server-side, generate a server UUIDv7 Event ID, serialize the row and call this RPC with the service-role client. It must map `replayed` to the same response as `created`, and map `conflict` to HTTP 409. No admin read may omit the verified owner + Event ID filter.

Hosted migration application, grants/RLS/Auth changes, Edge Function deployment and production smoke remain separate explicit Human Gates.
