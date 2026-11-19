# SimpleLife — RLS smoke-test evidence

**Date:** 19 November 2026  
**Target:** Supabase development project `Simplelife_dev` (`iybnjrnysiikbtokyshg`)  
**Environment:** hosted development database, PostgreSQL 17.12  
**Production/deploy:** not involved

## Test method

Executed transaction-scoped SQL against the actual development database. Synthetic Auth identities were created for two accounts and for a third account without a profile. JWT subject/role claims were set while running as the PostgreSQL `authenticated` role. Synthetic records were deleted before commit; follow-up checks returned zero matching synthetic users, profiles, areas, goals, captures, or lists.

These tests exercise database RLS and the profile bootstrap insert pattern. They are not a full browser sign-up against Supabase Auth.

## Database results

| Check | Result |
| --- | --- |
| Account A reads its own profile, area, goal, capture and list | PASS — 1 row visible per resource |
| Account A cannot read Account B's life area | PASS — 0 rows visible |
| Account B reads its own life area and cannot read A's | PASS — 1 own row, 0 other rows |
| Account A updates its own life area | PASS — 1 row updated |
| Account B updates its own life area | PASS — 1 row updated |
| Account A inserts its own life area | PASS — 1 row inserted |
| Account A updates Account B's life area | PASS — 0 rows affected |
| Account A inserts a life area owned by Account B | PASS — blocked by RLS |
| Account A changes the owner column | PASS — blocked by column privilege |
| Account A physically deletes a life area | PASS — blocked by table privilege |
| Account A creates a subgoal under Account B's goal | PASS — blocked by parent visibility/RLS |
| Account A creates a capture fragment under Account B's capture | PASS — blocked by parent visibility/RLS |
| Account A adds an item to Account B's list | PASS — blocked by parent visibility/RLS |
| Account A writes an AuditEvent directly | PASS — blocked; append path is reserved |
| New authenticated identity creates its UserProfile | PASS — 1 row inserted |
| New profile creates America/Havana Spanish preferences | PASS — 1 row inserted |
| New profile updates its display name | PASS — 1 row updated |
| Physical DELETE privilege for authenticated | PASS — DENIED |
| UPDATE privilege on owner_user_id | PASS — DENIED |
| UPDATE privilege on ordinary editable title | PASS — GRANTED |

## Structural inventory and advisors

- Public tables: 17.
- Tables with RLS enabled: 17/17.
- Public table grants to `anon`: 0.
- Physical DELETE grants to `authenticated`: 0.
- Supabase Security advisor: 0 warnings.
- Supabase Health advisor: 0 warnings.
- Performance advisor: 9 unused-index informational hints; no indexes were dropped.

## Cleanup verification

After the transaction-scoped test runs, follow-up checks returned zero matching synthetic records:
- matching synthetic Auth users: 0
- matching UserProfile records: 0
- synthetic LifeArea records: 0
- synthetic Goal records: 0
- synthetic Capture records: 0
- synthetic List records: 0

## Browser coverage and remaining limits

- Playwright browser tests: 3/3 PASS.
- Sign-in/registration interface, required fields and 390px layout: PASS.
- A separate mocked-auth browser test drives the Supabase JS client through a simulated session, loads profile/preferences, and posts a task. It verifies owner/creator identity, UUIDv7, date, priority and timezone.
- The mocked browser test does not contact Supabase Auth or persist any user data.
- A real authenticated browser E2E against Supabase remains pending; it needs a controlled test identity and a safe lifecycle for removing it.
- Physical-device Android/iOS/PWA installation and notification checks remain manual.
- This is development evidence, not a production security certification.
