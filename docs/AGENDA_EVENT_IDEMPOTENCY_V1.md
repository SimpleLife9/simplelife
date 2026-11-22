# Agenda Event Create Idempotency — Contract v1

**Status:** CONTRACT CLOSED FOR PHASE 1 DESIGN; DATABASE LEDGER / RPC / EDGE WRITER NOT IMPLEMENTED  
**Date:** 22 November 2026  
**Main baseline:** \`d1ff5d1d401f0e8bb0acdbe7386c5d6c18805973\`  
**Scope:** one-off Event creation only

## 1. Objective and invariants

A create request must remain safe when the browser retries after a timeout, a lost response, a mobile reconnect, or concurrent delivery. One deliberate create operation must produce at most one \`calendar_event\` row and at most one \`calendar_event.created\` audit row.

The contract is:

1. One client-generated UUIDv7 \`Idempotency-Key\` identifies one deliberate create operation. It is distinct from the server-generated Event UUIDv7.
2. The key is scoped to the verified owner profile: \`(owner_user_id, idempotency_key)\`.
3. The server computes a SHA-256 hash from the normalized user intent. A client-supplied hash is never trusted.
4. Same owner + same key + same hash replays the original creation receipt without another Event insert or audit append.
5. Same owner + same key + different hash returns HTTP \`409\`; it never silently changes the original request.
6. The idempotency receipt, Event insert and audit trigger append commit or roll back as one PostgreSQL transaction.
7. A transport failure after commit is recoverable: retrying the same key and payload returns the original receipt.

This contract is deliberately limited to one-off Event creation. Event updates, recurring-series operations, occurrence edits and TaskSchedule use their own operation-specific idempotency scopes.

## 2. HTTP request contract

The future authenticated Edge Function accepts:

- Method: \`POST\`
- Content type: \`application/json\`
- Required header: \`Idempotency-Key: <UUIDv7>\`
- Body: only the user-authored fields accepted by \`createEventDraft()\`.

The header is normalized to lowercase UUID text before lookup. Missing, malformed, or non-UUIDv7 keys return HTTP \`400\`. The key must not also be sent in the JSON body.

The client creates the key once when the user confirms a new Event. It durably stores the key with that pending draft before the first network send. All automatic retries and manual retries whose outcome is still unknown reuse the same key and same draft. A new intentional Event creation always gets a new key. The client must not replace a key merely because a request timed out or the connection was interrupted.

The Event row ID is generated separately by the trusted server after authentication. The client must never choose or provide \`id\`, \`owner_user_id\`, \`created_by_user_id\`, \`updated_by_user_id\`, timestamps, audit fields or authoritative UTC resolver output.

## 3. Canonical user-intent hash

The current pure domain normalizer \`createEventDraft()\` is the single input normalization boundary. The server performs that normalization before computing a hash.

The canonical representation is a fixed-position JSON array, not raw request JSON and not a generic object-key serializer:

\`[version, title, description, locationLabel, locationKind, eventStatus, temporalKind, ...temporalFields]\`

- Version: \`event-create-v1\`.
- Text is hashed after the existing domain trim/length validation.
- Missing optional values become explicit \`null\`.
- Missing Event status becomes the normalized default \`confirmed\`.
- JSON property order in the incoming request cannot affect the result.
- The hash is SHA-256 over UTF-8 bytes of the canonical JSON string, rendered as 64 lowercase hexadecimal characters.
- The server recomputes it; a caller-provided hash is rejected/ignored and never used as authority.

Temporal fields are intentionally different by kind:

| Kind | Included in the canonical intent |
|---|---|
| \`all_day\` | \`startDate\`, \`endDateExclusive\` |
| \`fixed_instant\` | normalized UTC \`startsAt\`, \`endsAt\`, \`sourceTimeZone\` |
| \`zoned_civil\` | requested IANA \`timeZone\`, original normalized local start/end, both fold disambiguations and both gap strategies |

For \`zoned_civil\`, exclude resolved UTC instants, canonical timezone aliases, resolver version, TZDB version, and resolver metadata. Those values are authoritative server outputs, not changes to the user's original intent. Consequently, the same key and same civil-time request can replay its original result after a TZDB/resolver upgrade without being misclassified as a different request. A genuinely changed local time, zone, fold choice, gap strategy, title, description, location or creation status changes the hash.

Do not include owner IDs, Event IDs, generated timestamps, lifecycle state, audit metadata, or other server-generated values. The owner is a separate part of the idempotency key scope.

Any future breaking change to normalization or canonical field semantics must use a new canonical version. The server must retain support for the versions already present in idempotency receipts; it must not reinterpret a stored v1 key with a new canonicalization algorithm.

The executable pure helper is \`src/features/agenda/domain/event-idempotency.js\`. It exposes \`normalizeEventIdempotencyKey()\`, \`buildEventCreateIntent()\` and \`hashEventCreateIntent()\`. These functions do not perform I/O or authorize a database write.

## 4. Durable ledger and response receipt

The next database implementation must add a server-only \`public.event_create_request\` ledger with, at minimum:

| Column | Contract |
|---|---|
| \`owner_user_id\` | Verified SimpleLife profile ID |
| \`idempotency_key\` | Client UUIDv7 |
| \`payload_version\` | Canonicalization version, initially \`event-create-v1\` |
| \`payload_hash\` | 32-byte SHA-256 digest |
| \`result_event_id\` | Server-generated Event UUIDv7 returned by the winning create |
| \`response_created_at\` | Original server creation timestamp |
| \`response_event_status\` | Original creation status |
| \`created_at\` | Server timestamp for the ledger receipt |

Primary/unique identity is \`(owner_user_id, idempotency_key)\`; \`result_event_id\` is also unique. Do not store the original JSON body, title, description, location, local timestamps or a full Event snapshot in this ledger. It is an idempotency receipt, not a second Event store. `result_event_id` is a receipt value, not a cascading foreign key to `calendar_event`; retaining the minimal receipt after a physical Event purge is what prevents a very late retry from recreating the same operation.

The record is retained while the owner profile exists, including after an Event is moved to trash or permanently purged. This small tombstone prevents a very late offline retry from creating a second Event. Account deletion must remove its idempotency receipts as part of the same approved account-purge procedure. The ledger has RLS enabled, no policy or table privileges for \`anon\` or \`authenticated\`, and only the trusted server role receives the minimum SELECT/INSERT/UPDATE privileges. No DELETE, TRUNCATE, browser access, generic client RPC or audit INSERT is granted.

## 5. Required request flow

The future Edge writer follows this order:

1. Enforce gateway JWT verification and \`withSupabase({ auth: "user" })\`. Resolve the active profile using \`resolveActiveEventProfile(ctx)\`; stop on any failure. Do not look up idempotency receipts before establishing the authenticated owner.
2. Parse bounded JSON and pass only the user draft through \`createEventDraft()\`. Reject unknown/server-owned fields. Normalize the UUIDv7 \`Idempotency-Key\` and compute the canonical hash from the un-resolved normalized draft.
3. Perform a server-only preflight lookup filtered by both verified \`owner_user_id\` and \`idempotency_key\`:
   - Existing row + matching version/hash: return its original creation receipt immediately. This happens before IANA resolution, so a replay does not depend on current TZDB availability.
   - Existing row + different version/hash: return \`409 IDEMPOTENCY_KEY_REUSED\`.
   - Lookup error: fail closed with \`503\`; do not proceed to create while key state is unknown.
   - No row: continue.
4. For \`zoned_civil\`, resolve both endpoints atomically through the authoritative IANA resolver. For all-day/fixed-instant, use the existing domain behavior. Generate the Event UUIDv7 and map the trusted owner/creator/updater fields with \`buildEventInsertRecord()\`.
5. Call one server-only PostgreSQL routine, specified as \`public.create_calendar_event_once(...)\`, with owner, key, canonical version/hash and the normalized Event record. This routine is the authoritative concurrency gate:
   - Attempt to claim the unique owner/key pair.
   - On conflict, lock/read the winning receipt and compare its version/hash. Return replay for a match or 409 for a mismatch.
   - If the claim succeeds, insert exactly one \`calendar_event\` row, allow its existing AFTER trigger to append exactly one audit row, and write the minimal creation receipt.
   - Return the receipt only after all three writes are part of the same transaction.
6. Return the stored receipt. The preliminary lookup is an optimization for fast replay; the final SQL uniqueness/transaction boundary is the correctness authority and resolves concurrent races.

The SQL routine must be \`SECURITY INVOKER\`, callable only by \`service_role\`, use a fixed \`search_path\`, and rely on explicit grants. It must never receive an owner value from the request body. The Edge Function supplies the verified profile ID from step 1. The database routine must reject a mismatched owner in the serialized Event record. \`service_role\` may write the Event and idempotency ledger but never receives direct privileges on \`audit_event\`; the existing private trigger remains the sole audit append path.

A PostgreSQL unique conflict serializes concurrent claims. A second request waits for the first transaction: if the first commits, the second reads/replays its receipt or returns 409; if the first rolls back, the second may claim and create. No externally visible \`processing\` state is needed because claim, Event, audit and receipt are one transaction.

## 6. Response and conflict semantics

First successful create:

- HTTP \`201 Created\`.
- Minimal stable JSON receipt, for example:

\`\`\`json
{
  "eventId": "0190f47a-7b2c-7abc-8def-0123456789ab",
  "createdAt": "2026-11-22T18:00:00.000Z",
  "eventStatus": "confirmed"
}
\`\`\`

A matching retry returns the same HTTP status and same body from the stored receipt, with \`Idempotency-Replayed: true\`. It does not read the current Event row to reconstruct a potentially changed response, and does not append a second audit record. The client may separately fetch the latest Event representation.

A reused key with a different canonical payload returns HTTP \`409 Conflict\` with a stable error code \`IDEMPOTENCY_KEY_REUSED\`. Do not reveal the original title, body, hash or Event details in the conflict response.

Other failures:

| Condition | HTTP | Durable receipt? |
|---|---:|---|
| Missing/malformed key or invalid JSON | 400 | No |
| Invalid normalized Event draft | 422 | No |
| JWT/profile not authorized | 401/403 | No |
| IANA rules unavailable | 503 | No |
| Idempotency preflight unavailable | 503 | No; do not continue |
| Event insert/audit append/receipt transaction fails | 5xx | No; PostgreSQL rolls back all transaction writes |
| Same key, different canonical hash | 409 | Existing receipt is unchanged |
| Same key, same canonical hash | Original 201 receipt | Existing receipt reused |

Same payload with a different key represents a new deliberate create and therefore creates a second Event. The key is a retry identity, not content-based deduplication.

## 7. Security and audit boundaries

- Authentication and active-profile resolution happen before ledger access.
- Ledger reads always include both verified owner and key; never perform an unscoped service-role lookup.
- The server-generated Event ID and owner/creator/updater fields are never accepted from client JSON.
- The browser never receives service-role credentials or direct idempotency-ledger/Event write grants.
- The SQL routine may insert the Event; the existing private trigger appends audit in the same transaction.
- The idempotency ledger never writes directly to \`audit_event\`.
- Failed requests that never commit do not produce a success audit row; the Event trigger remains evidence of a committed mutation.
- The receipt stores no original user content and is not a second source of Event details.

## 8. Required tests before writer merge

The local/ephemeral CI implementation must prove:

1. Same owner/key/hash returns the original Event ID, timestamp, status and response body; Event row count and audit row count remain one.
2. Same owner/key/different hash returns 409 and leaves the first receipt/Event/audit unchanged.
3. Different owners may independently use the same key and cannot read or replay each other's receipts.
4. JSON property order, omitted versus explicit defaults and equivalent fixed-instant offsets normalize to the same hash.
5. Any changed semantic field produces a different hash.
6. Same zoned-civil intent hashes identically across resolver/TZDB metadata changes.
7. Two concurrent same-key/same-hash requests produce exactly one Event and one audit append; the loser receives the stored receipt.
8. Two concurrent same-key/different-hash requests produce one winner and one 409.
9. A forced Event insert or audit append failure rolls back the idempotency claim and Event row together; retry with the same key can succeed.
10. A lost-response simulation after commit replays the same receipt without a second audit row.
11. Direct authenticated/anon access to the ledger is denied; service-role operations are owner-filtered; no direct audit privileges are added.
12. Replay still works without invoking IANA resolution and after a simulated resolver/TZDB version change.

## 9. Explicit non-effects and next implementation unit

This PR's contract/helper does not create the ledger, SQL routine, Edge Function, HTTP endpoint, UI, local outbox, migration, grant, policy, RPC or deployed resource. It does not apply the existing Event migration to hosted Supabase.

Next implementation unit: add the server-only idempotency ledger and atomic SQL routine, then run the concurrency/rollback/RLS integration suite against ephemeral local PostgreSQL. After that passes, build the authenticated Event writer that uses the profile resolver, domain normalizer, authoritative IANA resolver, serializer and atomic routine.

**Human Gate remains independent and mandatory** before any hosted DDL, remote privilege change or Edge Function deployment.