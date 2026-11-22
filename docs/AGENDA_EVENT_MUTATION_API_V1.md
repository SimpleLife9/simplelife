# Agenda — authenticated Event mutation API v1

**Status:** source implementation in progress; no hosted migration or function deployment is included.

## Endpoint

`PATCH /functions/v1/agenda-event-mutate`

The endpoint requires a verified Supabase user JWT. It resolves the active `user_profile` from the signed-in identity, then uses `ctx.supabaseAdmin` only for operations filtered by both Event ID and that verified owner profile ID. The browser must not write directly to `calendar_event`.

Every request contains:

```json
{
  "eventId": "UUIDv7",
  "expectedUpdatedAt": "exact updated_at value returned by Supabase",
  "operation": "update | cancel | reopen | finish | archive | restore | trash"
}
```

`expectedUpdatedAt` must be copied exactly from the latest Event row. It is compared as a full-precision string; converting it through JavaScript `Date.parse` would discard Postgres microseconds and weaken optimistic concurrency.

## Operations

- `update`: requires an `event` object with the editable Event fields. It cannot change Event status, owner/creator/updater IDs, ID, audit metadata or lifecycle timestamps. Zoned-civil edits are resolved again through the pinned IANA resolver before writing.
- `cancel`: changes the functional status to `cancelled` without changing the original time.
- `reopen`: only changes `cancelled` to `confirmed`.
- `finish`: only changes `confirmed` to `finished`.
- `archive`: sets `archived_at`; archive and trash are mutually exclusive.
- `trash`: sets `deleted_at` and a 30-day `purge_after`; it does not physically delete the row.
- `restore`: clears archive/trash lifecycle fields. A trashed record cannot be restored after `purge_after`.

State/lifecycle operations are semantic no-ops when the requested destination state is already present. An identical edit is also a no-op. These replays do not append another audit row.

## Concurrency and audit

- Every read filters by `id` and `owner_user_id`.
- Every update filters by `id`, `owner_user_id` and the exact previously-read `updated_at`.
- If another mutation wins first, an identical resulting state can return a replay response; a different target returns HTTP 409 `EVENT_CHANGED_RELOAD_AND_RETRY`.
- A transition is one database UPDATE. The existing row trigger appends the audit event in the same PostgreSQL transaction.
- The audit vocabulary distinguishes `calendar_event.updated`, `calendar_event.cancelled`, `calendar_event.reopened`, `calendar_event.finished`, `calendar_event.archived`, `calendar_event.trashed` and `calendar_event.restored`.
- No physical DELETE is issued.

## Response

HTTP 200 returns the Event ID, current `updatedAt`, functional state, lifecycle timestamps and `replayed` marker. Common failures are 401/403 for authentication/profile gates, 404 for an Event not visible to that owner, 409 for stale or invalid transitions, 410 for an expired trash restore window, 413 for oversized input and 503 when timezone rules or data operations are unavailable.

## Verification boundary

The CI smoke creates two disposable Auth identities and their profiles in the local Supabase stack. It seeds one local Event, invokes the real Edge Runtime, checks update/retry/stale conflict, all status/lifecycle transitions, explicit audit actions and the second owner's 404 boundary. CI destroys the whole local Supabase stack in its cleanup step. This does not authorize or perform hosted DDL or deployment.
