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


## Task editing — merged 19 Nov 2026

- Task editor merged into `main` by PR #1: https://github.com/SimpleLife9/simplelife/pull/1.
- Users can edit task action, description, priority and due date from **More → Tasks → Edit**.
- The update filters by task ID and authenticated profile owner. It does not modify task ID, owner, creator, status or the existing project link.
- No database schema, RLS policy or client privilege was changed.
- Playwright mock-authenticated edit flow: PASS. It verifies the update request, returned-row handling, preserved status/ownership and editor layout at 390px.
- PR CI run #9: PASS — 3/3 unit tests, 3/3 Playwright tests, Vite production build: https://github.com/SimpleLife9/simplelife/actions/runs/44563913283.
- Main CI run #10 after merge: PASS — install, 3/3 unit tests, 3/3 Playwright tests and Vite production build: https://github.com/SimpleLife9/simplelife/actions/runs/44564166540.
- Merged main commit: `3a419a499dd3ccc9f59e3d188f278f192e761155`.

### Remaining validation gates

- Manual task edit through Robert's real authenticated browser session: PENDING. The new Playwright edit coverage uses mocked Auth and PostgREST; it does not prove a live database update.
- Automated end-to-end flow using real Supabase Auth: NOT RUN.
- Physical Android/iOS PWA validation: NOT RUN.
- No deployment or public preview has been created.

## Reopening completed tasks — merged 19 Nov 2026

- Task reopening merged into `main` by PR #2: https://github.com/SimpleLife9/simplelife/pull/2.
- **Más → Tareas** shows **Reabrir** only for tasks with status `completed`.
- Reopening changes status to `todo` and clears `completed_at` and `completion_outcome`.
- The update is scoped by task ID, authenticated profile owner, and current completed status; a zero-row response is treated as an error.
- No schema, RLS policy, table privilege, or existing task data was changed.
- Playwright validates create → edit → complete → reopen, the update payload, and the resulting pending state.
- PR CI run #12: PASS — install, 3/3 unit tests, Playwright, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44571472302.
- Main post-merge CI run #13: PASS — install, 3/3 unit tests, Playwright, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44571702065.
- Merged main SHA: `2d0b9791fd1dad03ae3f056a86f914b29cd00d52`.
- Manual reopening through Robert's real authenticated browser session: PENDING.
- No deployment or public preview was created.

## Task list controls — merged 19 Nov 2026

- Task list controls merged into `main` by PR #3: https://github.com/SimpleLife9/simplelife/pull/3.
- Search matches task action/name and description.
- Status filters: active (default), completed, and all.
- Priority filter: exact levels 1–5.
- Sorting: priority, due date (tasks without a date last), and newest first.
- Results counter and a dedicated no-matches state.
- Compact responsive controls; mobile layout is included in the browser suite.
- Filtering and ordering are client-side over the authenticated user's task rows; no schema, RLS, or privilege change.
- Playwright uses a mocked Supabase session and three tasks to verify search, status filter, priority filter, sorting, and the existing create/edit/complete/reopen flow.
- PR CI run #18: PASS — 3/3 unit tests, Playwright, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44585548978.
- Main post-merge CI run #19: PASS — 3/3 unit tests, Playwright, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44585747558.
- Merged main SHA: `1a6c627f76ebc221c096da9a306c7c6c9f53f557`.
- Manual validation in the real authenticated browser session: PASS.
- No public deployment or preview was created.

## Inbox review and archive — merged 19 Nov 2026

- Inbox review and archive merged into `main` by PR #4: https://github.com/SimpleLife9/simplelife/pull/4.
- Search over the original capture text.
- Attention-state filters: needs review, reviewed, archived, and all (default: needs review).
- Reversible review state transitions: `needs_review` ↔ `reviewed`.
- Archive and restore: active capture → archived → `needs_review`.
- Each update is scoped by capture ID and authenticated owner, requests only the `attention_status` column, and treats zero updated rows as an error.
- No `content_original`, `capture_part`, schema, RLS policy, table-level grants, or existing capture data is modified by review/archive actions.
- Uses the existing column-level UPDATE permission for `capture.attention_status`; the existing owner-scoped `capture_self` RLS policy remains in place.
- Playwright validates search, no-match state, all review states, mark/unmark reviewed, archive/restore, and capture creation while preserving the original text and first fragment.
- PR CI run #22: PASS — 3/3 unit tests, Playwright, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44589486561.
- Main post-merge CI run #23: PASS — 3/3 unit tests, Playwright, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44589672743.
- Merged main SHA: `cae6dc3e352be7135f909969721c33bddc8837dd`.
- Manual validation in Robert's real authenticated browser session: PENDING.
- No public deployment or preview was created.


## Project management — PR batch 1

- Merged into `main` by PR #5: https://github.com/SimpleLife9/simplelife/pull/5.
- Merge SHA: `e9bdc7a45c015e15cafad090cf09b96a57fbf46c`.
- PR CI run #29: PASS — 3/3 unit tests, 5/5 Playwright tests, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44594702305.
- Main post-merge CI run #30: PASS — install, 3/3 unit tests, 5/5 Playwright tests, production build: https://github.com/SimpleLife9/simplelife/actions/runs/44594981731.
- Project search matches both name and purpose; filters support project status and active/archived lifecycle; sorting supports recent, name and target date.
- Project editor updates name, purpose, start/target dates and the project-specific status. It validates that start date is not after target date.
- Archive/restore changes only `archived_at`; it does not change project status, task rows or task-project relationships.
- Project detail displays existing linked tasks and totals for linked, active, completed and blocked tasks; navigation to the task list is available.
- All project updates are scoped by project ID, authenticated owner and non-deleted row; zero-row updates are treated as errors.
- The existing `project` table already contains the required lifecycle/date fields and column-level UPDATE privileges. No schema, RLS or database data changes are part of this batch.
- Playwright coverage uses a mocked Auth/PostgREST session; it does not represent a real Supabase database write.
- Manual validation: PENDING.
- No public deployment or preview was created.


## Creation modals and project/archive consistency — implementation in PR

- Adds section-level **Nuevo Proyecto**, **Nueva Tarea**, **Nueva Meta** and **Nueva Area** actions. Creation forms open only on request in floating, accessible dialogs.
- Project labels distinguish **Estado de trabajo** from **Archivo**; active status is labeled **En marcha**.
- An archived project displays only **Archivado**. The original work state is retained without allowing edits while archived, and becomes available again after restore.
- Archived projects cannot be selected when creating a new task; they are excluded from work-state filtering.
- No schema, RLS, grants, or live user records changed. Automated checks are pending CI.


## Lote 4 — Modales de creación y coherencia de archivo de proyectos

- PR: #6 — https://github.com/SimpleLife9/simplelife/pull/6
- Código integrado en main: `522466d0f5df72068c473aea2fbfa538d2b1c454`
- CI del PR #33: PASS — https://github.com/SimpleLife9/simplelife/actions/runs/44623324826
- CI post-merge #34: PASS — https://github.com/SimpleLife9/simplelife/actions/runs/44623469017
- Cobertura: 3/3 unit tests, 7/7 pruebas Playwright y build de producción PASS en la ejecución del PR.
- Proyectos: nomenclatura `Estado de trabajo` / `En marcha` y `Archivo` / `Sin archivar`; los archivados muestran una sola etiqueta `Archivado`, no aparecen en filtros de estado de trabajo y conservan su estado previo para restauración.
- Tareas: formulario modal abierto desde `Nueva Tarea`; selector de proyectos excluye los archivados.
- Objetivos: formularios modales separados desde `Nueva Meta` y `Nueva Area`; la creación de una meta exige un área válida.
- Formularios `Nuevo Proyecto`, `Nueva Tarea`, `Nueva Meta` y `Nueva Area` permanecen cerrados hasta accionar el botón superior; cancelar limpia campos y no escribe.
- Sin cambios de esquema, migraciones, RLS, permisos, secretos ni registros reales. Sin despliegue público.
- Validación manual del usuario: PENDIENTE.


## Lote 5 — Gestión completa de áreas, metas y submetas

- Integrado en `main` por PR #7: https://github.com/SimpleLife9/simplelife/pull/7.
- Merge SHA del código: `6efd261306e691438fa9cd7f253f76d82851178b`.
- CI del PR #41: PASS — 3/3 pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44666857088.
- CI post-merge #42: PASS — 3/3 pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44667145940.
- Áreas: editar nombre/descripción, pausar/reactivar y reordenar mediante subir/bajar persistiendo en el campo existente `position`.
- Metas: editar área asociada, título, resultado esperado, motivo y fecha objetivo; cambiar entre estados permitidos.
- Submetas: editar título, resultado esperado y fecha objetivo; cambiar estado; crear desde cualquier meta, sin límite artificial de dos.
- E2E valida la edición, el cambio de estados, reordenamiento de áreas y creación de submetas más allá de las dos primeras metas.
- No se añadieron columnas/tablas ni migraciones. Sin cambios de RLS/grants/políticas, sin DELETE físico y sin modificaciones de datos reales durante las pruebas (E2E usa mocks).
- Validación manual en la cuenta local autenticada: PENDIENTE.
- No se creó despliegue público ni preview.
