# Inbox voice transcription queue

## Purpose

Keep a verified private audio upload durable between upload finalization and a future approved speech-to-text worker. A transcription is not complete until the derived capture, original transcript part, audio provenance, and normal Inbox processing run are committed together.

## Lifecycle

- `queued`: a private upload changed to `uploaded`; the database trigger inserts one job per audio asset.
- `leased`: one worker owns the job under a lease token and bounded expiry.
- `retryable`: a lease ended before `request_started`; another attempt may safely claim it after backoff.
- `succeeded`: transcript, capture, part, audio provenance, and `processing_run` committed atomically.
- `manual_review`: a provider request may already have been sent, the result is ambiguous, or the bounded attempt limit was reached. This state is never auto-claimed again.
- `expired`: the source asset is no longer eligible or its existing retention window elapsed.

The queue allows at most three claims. A lease that expires before request start may be reclaimed. Once request start is recorded, lease expiry or worker failure moves the job to manual review instead of silently sending the same audio again. This is intentionally conservative because a timed-out inference may already have been accepted or billed.

## Trusted operations

The queue and attempt tables live in the non-API `private` schema, have RLS enabled, and grant no direct table access to browser or service roles. Only the service-role RPCs can claim, record request start, fail, or complete a job. Each attempt stores provider/model/adapter/region identifiers and evidence identifiers only; it does not store credentials, audio bytes, or transcript text.

Before a future worker calls a provider, it must evaluate the fail-closed speech route policy at request time and pass verified evidence identifiers to `mark_inbox_voice_transcription_request_started`. The policy helper is not yet connected to a provider worker, and this queue migration does not make an external request.

## Atomic Inbox hand-off

The completion RPC creates a voice `capture`, its original `capture_part`, updates `capture_audio_asset` with provider/model/region provenance, and inserts a queued `processing_run` in one database transaction. The audio asset ID is the processing idempotency key. An exact replay returns the original IDs; a conflicting transcript is rejected. The processing worker remains deterministic and advisory-only; the owner still reviews proposals.

The new completion path replaces the older transcript-only RPC because that function could persist a voice capture without enqueuing normal Inbox processing.

## Retention and rollout

Queueing and retrying never extend the original seven-day retention window for an untranscribed source. Expired assets cannot be claimed. When a transcript succeeds, the audio asset follows the existing capture-retention rules.

This is schema and lifecycle groundwork only. No provider adapter, scheduler, route discovery, or real transcription call is enabled by this change. No hosted Supabase project or production deployment is changed by CI; the required tests run against ephemeral local Postgres. Merge and hosted migration application remain separate gates.
