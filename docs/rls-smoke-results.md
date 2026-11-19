# SimpleLife — RLS smoke-test evidence

**Date:** 19 November 2026  
**Target:** Supabase development project `Simplelife_dev` (`iybnjrnysiikbtokyshg`)  
**Environment:** hosted development database, PostgreSQL 17.12  
**Production/deploy:** not involved

## Test method

Executed transaction-scoped SQL against the actual development database. Three synthetic Auth identities were used: two with profiles and one without a profile. JWT subject/role claims were set while running as the PostgreSQL `authenticated` role. Synthetic records were removed before commit; a follow-up query confirmed zero matching Auth users, profiles, areas, goals, captures, or lists remained.

This validates database policies and the profile bootstrap insert pattern. It is not a full browser sign-up against Supabase Auth.

## Results

| Check | Result |
| --- | --- |
| Account A reads only its profile | PASS — 1 row visible |
| Account A reads only its life area | PASS — 1 row visible |
| Account A reads only its goal | PASS — 1 row visible |
| Account A reads only its capture | PASS — 1 row visible |
| Account A reads only its list | PASS — 1 row visible |
| Account A updates its own life area | PASS — permitted update column |
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

## Cleanup verification

The follow-up SQL query returned zero for all counts:
- matching synthetic Auth users: 0
- matching UserProfile records: 0
- synthetic LifeArea records: 0
- synthetic Goal records: 0
- synthetic Capture records: 0
- synthetic List records: 0

## Remaining limits

- Browser tests cover the sign-in/sign-up interface and mobile-width layout using the app's development configuration. They do not create an Auth account or submit a real password.
- A real authenticated browser E2E against Supabase remains a separate gate; it needs a controlled test identity and a safe lifecycle for removing it.
- Physical-device Android/iOS/PWA installation and notification checks remain manual.
- Do not treat this evidence as a production security certification.
