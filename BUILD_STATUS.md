# Build status — 19 Nov 2026

## Automated application checks

- UUIDv7 unit tests: PASS (3/3).
- GitHub Actions CI run #6: PASS.
- Reproducible dependency install (`npm ci`): PASS.
- Playwright Chromium tests: PASS (3/3).
- Login/registration form toggle and required-field validation: PASS.
- Mobile layout at 390px, without horizontal overflow: PASS.
- Mock-authenticated task creation through the Supabase client: PASS.
  - The browser receives a simulated Auth session and mocked PostgREST responses.
  - The app sends a task with the expected owner/creator IDs, UUIDv7, priority, date and `America/Havana` timezone.
  - This verifies the UI/client request path; it is not a real Supabase Auth session or a database write.
- Vite 8.3.8 production build: PASS (62 modules transformed).
- Run: https://github.com/SimpleLife9/simplelife/actions/runs/44553932618
- Tested commit: `3ee4fc4f3f54e38e9a71dbe938ae0b8804ffeb59`.

## Supabase development security checks

- PostgreSQL 17.12 project `Simplelife_dev`.
- Public tables with RLS enabled: 17/17.
- Public table grants to `anon`: 0.
- Physical DELETE table grants to `authenticated`: 0.
- Security advisor: 0 warnings.
- Health advisor: 0 warnings.
- Transaction-scoped two-account isolation and write checks: PASS.
- Cross-owner INSERT/UPDATE and parent-reference writes: BLOCKED.
- Owner-column changes and physical DELETE: BLOCKED.
- Direct client AuditEvent insertion: BLOCKED.
- New authenticated profile and America/Havana preference creation: PASS.
- Synthetic Auth identities and records were removed; cleanup query returned zero matches.
- Performance advisor: 9 unused-index informational hints. No indexes were removed.

## Remaining validation gates

- Real browser sign-up/sign-in and CRUD with an actual authenticated Supabase session: NOT RUN. Playwright uses a mocked Auth/PostgREST session for the task-creation flow; it does not submit a real password or write to Supabase.
- Physical Android/iOS device install, PWA behavior, and notifications: NOT RUN.
- No deployment or public preview has been created.

No `service_role` key or database password is present in the frontend. `.env.example` contains only the project URL and public publishable key. The service worker does not cache authenticated responses or personal data.
