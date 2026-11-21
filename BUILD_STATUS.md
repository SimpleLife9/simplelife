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


## Corrección de navegación y orden de áreas — PR #8 (20/11/2026)

- PR integrado: https://github.com/SimpleLife9/simplelife/pull/8.
- Merge SHA en main: `ea9e73671d7a3cef70e2d94a3ae01a093f321463`.
- CI del PR, ejecución #48: PASS — 3/3 pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44672546138.
- CI post-merge, ejecución #49: PASS — 3/3 pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44672685469.
- Objetivos ahora tiene tres apartados separados y visibles: Áreas, Metas y Submetas. Las metas ya no se presentan como controles pequeños dentro de las tarjetas de áreas.
- Metas: catálogo con área asociada, resultado esperado, motivo, fecha objetivo, estado y acción explícita Editar meta.
- Submetas: catálogo independiente con meta padre, resultado esperado, fecha, estado y acción Editar submeta; filtro por todas las metas o por una meta; formulario Nueva Submeta con selección de meta.
- Áreas: tarjetas independientes con conteo de metas, acceso a Metas, edición, pausa/reactivación y orden visible. Mover arriba/abajo normaliza y persiste las posiciones de todas las áreas, también cuando las posiciones anteriores eran NULL.
- Playwright cubre navegación entre las tres vistas, creación/edición de metas y submetas, estados, nuevas submetas y reordenamiento con posiciones NULL.
- Sin cambios de esquema, migraciones, RLS, grants, secretos ni escrituras de prueba en datos reales de Supabase. Sin despliegue público.
- Validación manual de Robert en localhost con su cuenta: PENDIENTE.


## Cierre manual — Anexo 131 (20/11/2026)

Robert confirmó que la corrección funciona correctamente en localhost y autorizó continuar. Se registra VALIDACIÓN MANUAL REAL: PASS para el orden de áreas, navegación independiente, edición de metas y submetas, creación de submetas y persistencia tras recargar. Anexo 131 cerrado. Próxima etapa: iniciar el siguiente lote funcional, revisando las capacidades actuales antes de definir alcance.


## Lote 6 — Relaciones entre metas/submetas y proyectos

- PR #9 integrado en main: https://github.com/SimpleLife9/simplelife/pull/9.
- SHA integrado: `f66c0521cdb033735d7548648ffc88c16ccf51a9`.
- CI del PR: PASS — 3/3 pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44723035715.
- CI post-merge: PASS — 3/3 pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44723207284.
- Proyectos: el detalle ahora permite vincular una Meta o Submeta; la relación se crea con estado `confirmed`.
- Desvincular cambia el estado a `removed`, sin DELETE físico. Si se vuelve a vincular el mismo objetivo, se reactiva la fila existente en lugar de duplicarla.
- Metas y Submetas muestran los proyectos asociados que tienen relación confirmada.
- Un proyecto archivado no permite crear, restaurar ni quitar relaciones desde el modal.
- Se reutiliza `contribution_relation`, sus restricciones y la política RLS existente. No se crearon tablas, columnas ni migraciones y no se cambiaron RLS, grants, permisos o secretos.
- E2E usa mocks de Auth/PostgREST y cubre creación, desvinculación, restauración, vínculo directo a meta y visualización recíproca. No se escribieron datos reales de Supabase durante QA.
- Validación manual de Robert en localhost: PASS. Confirmó que puede vincular proyectos con metas y submetas, y verificó que los vínculos persisten después de recargar la aplicación.
- CI del commit documental de `BUILD_STATUS.md`: PASS — pruebas unitarias, Playwright y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44723410417.
- El comportamiento de desvincular/restaurar y el bloqueo en proyectos archivados cuenta con cobertura E2E; la validación manual comunicada cubre la vinculación y su persistencia.
- Sin despliegue público ni preview.


## Lote 7 — Organización manual del Inbox

- PR #10 integrado en main: https://github.com/SimpleLife9/simplelife/pull/10.
- SHA squash integrado: e9c1abb75b711112059b4124d6230b393718c61b.
- CI PR #61: PASS — pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44726879142.
- Desde una captura guardada se puede confirmar manualmente su conversión en Tarea, Nota, Idea, una Lista nueva con su primer elemento o un elemento dentro de una Lista existente.
- Tareas: título editable, prioridad, fecha opcional; el contenido original completo también se conserva en la descripción.
- Notas/Ideas: el contenido original completo se conserva; el título es opcional.
- Listas: se puede crear una lista con el contenido como primer elemento o añadirlo a una lista existente. El texto del elemento puede editarse respetando el límite existente de 500 caracteres; el original completo no se trunca en Inbox.
- Se registra procedencia mediante capture_part y capture_link; el vínculo confirmado permite identificar las capturas organizadas desde Inbox. El texto original de capture.content_original no se modifica.
- Inbox separa Por organizar, Organizadas, Revisadas sin organizar y Archivadas; muestra conteos y permite abrir el módulo destino.
- Archivar/restaurar una captura organizada conserva la relación confirmada y no elimina el elemento destino.
- La clasificación es manual y explícita. No se afirma que IA interprete o procese automáticamente las capturas.
- Playwright cubre conversión a tarea, idea, lista nueva, lista existente, procedencia, conservación del original y archivo/restauración de una captura organizada.
- Se reutilizan tablas, columnas, RLS, restricciones y grants existentes. Sin migraciones, cambios de esquema, RLS, grants, permisos o secretos; sin escrituras de prueba en datos reales.
- Validación manual de Robert en localhost: PASS (20/11/2026). Confirmó que puede consultar las notas/ideas y listas guardadas desde Inbox; la navegación visible y los elementos aparecen correctamente.
- Sin despliegue público ni preview.


## Corrección de descubribilidad del Inbox — PR #11 (20/11/2026)

- PR #11 integrado: https://github.com/SimpleLife9/simplelife/pull/11.
- SHA squash: `ee9c9dbfa4532d6d19726363077a864f88abdd0e`.
- CI del PR #67: PASS — pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44733379618.
- CI post-merge #68: PASS — pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44733611020.
- Se hizo visible la navegación de «Más» con pestañas para Tareas, Notas e ideas y Listas; disponible en escritorio y móvil. Antes, los enlaces quedaban ocultos dentro del submenú lateral y no existían en móvil.
- Se corrigió NotesPage para que un registro con `created_at` ausente o no válido no provoque `RangeError: Invalid time value`; muestra «Fecha no disponible».
- Playwright valida el recorrido desde Inbox hasta «Tu biblioteca» para una idea creada, la consulta de una lista recién creada y acceso móvil a los tres módulos.
- La clasificación manual, la conservación del original y la procedencia del Inbox permanecen sin cambios.
- Sin migraciones, cambios de esquema, RLS, grants, permisos ni secretos; sin escrituras de QA en datos reales. Sin despliegue público ni preview.
- Validación manual de Robert en localhost: PASS (20/11/2026). Confirmó que «Más → Notas e ideas» y «Más → Listas» muestran correctamente los registros organizados previamente desde Inbox. Anexo 134 cerrado.


## Cierre manual — Lote 7 y corrección de descubribilidad (20/11/2026)

Robert confirmó PASS en localhost: puede encontrar y consultar correctamente las notas/ideas y listas creadas desde Inbox. Quedan cerrados el Lote 7 (PR #10) y la corrección de navegación/renderizado del PR #11. La persistencia de destino, el acceso visible en escritorio/móvil y la apertura desde Inbox están cubiertos por E2E; la comprobación de lectura real de sus datos quedó validada manualmente.


## Lote 8 — Convertir elementos de listas en tareas (20/11/2026)

- PR #12 integrado: https://github.com/SimpleLife9/simplelife/pull/12.
- SHA squash: `e3ec37f6a589a8cb38ae3ad8616eb6da0cf023af`.
- CI del PR #71: PASS — pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44737793897.
- En Más → Listas, cada elemento sin tarea vinculada ofrece «Convertir en tarea».
- El formulario permite ajustar título, prioridad y fecha objetivo opcional.
- La tarea conserva el contenido original completo del elemento en su descripción y registra la lista de origen.
- El elemento original permanece dentro de la lista y se vincula mediante el campo existente `list_item.task_id`.
- Las listas muestran el estado de la tarea vinculada; el acceso «Abrir tareas» lleva al módulo correspondiente. Un elemento ya vinculado no permite crear otra tarea desde la misma acción.
- Para reintentos dentro de la misma ventana, el ID estable y la comprobación de existencia permiten recuperar la creación de la tarea antes de completar el vínculo sin duplicar la fila.
- Playwright cubre creación, contenido original, prioridad/fecha, vínculo, estado visible, acceso a Tareas y prevención de segunda conversión tras navegar y volver.
- Se reutilizan tablas, columnas, grants y política RLS existentes. Sin migraciones, cambios de esquema, RLS, grants, permisos ni secretos. QA con mocks y sin escrituras en datos reales.
- CI post-merge #73 (commit documental `59a7dacd69ac4595aa82de543f88eb0e2bc3c19d`): PASS — pruebas unitarias, Playwright y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44738010979.
- Validación manual de Robert en localhost: PASS (20/11/2026). Confirmó «funciona perfecto» tras probar la conversión de elementos de lista en tareas; Anexo 135 cerrado.
- Sin despliegue público ni preview.


## Lote 9 — Planificación diaria y gestión por lotes (20/11/2026)

- PR #13 integrado: https://github.com/SimpleLife9/simplelife/pull/13.
- SHA squash en main: `bfcdeed51f7411b7a7a228ba6e82f0ad467b3a86`.
- SHA de la rama verificada por CI: `1c24ba9c380c75ac2c184c45af7b74cfd52e0729`.
- CI PR #76: PASS — tests unitarios, Playwright de navegador y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44742883966.
- La creación y edición de tareas permiten guardar `estimated_duration_minutes` (1–10080 min) mediante el campo ya existente; la duración se muestra en formato legible.
- Hoy separa las tareas atrasadas de las próximas, muestra conteo de atrasos y calcula el tiempo estimado de las tareas fechadas para hoy. Cada tarea atrasada ofrece «Pasar a hoy».
- Tareas incorpora filtros por fecha: vencidas, hoy, próximos 7 días, sin fecha y todas.
- Selección individual o de todas las tareas activas visibles; acciones en bloque para completar, fijar una fecha común o quitar las fechas. Los cambios se limitan a IDs seleccionados, estados activos y `owner_user_id`, y verifican filas afectadas.
- Playwright cubre captura/edición de duración, filtros por fecha, completar en bloque, reprogramar, quitar fecha y recuperar tareas atrasadas. Las pruebas usan mocks; no escriben datos reales.
- Reutiliza columnas, política RLS, grants y permisos existentes. Sin migraciones, cambios de esquema, RLS, grants, permisos o secretos.
- Validación manual de Robert en localhost: PASS (20/11/2026). Confirmó que el lote funciona correctamente; aclaró que la duración estimada representa tiempo previsto, no un cronómetro. Anexo 136 cerrado manualmente.
- CI posterior a la fusión: PASS — run #78 sobre el commit `96b8faf65cf5ddb5361a7bd9c0ea22f1c61b2a33`, posterior al merge y con el cambio de PR #13 integrado: https://github.com/SimpleLife9/simplelife/actions/runs/44743176433.
- Sin despliegue público ni preview.



## Lote 10 — Control del ciclo de vida de las tareas (20/11/2026)

- PR #14 integrado en main: https://github.com/SimpleLife9/simplelife/pull/14.
- SHA squash integrado: `417e0458ee5e06067d0ee2713657a5130d721c9e`.
- SHA de la rama verificada por CI: `5fb193ce9ea3c9d90f5de6f27fd23aef66106163`.
- CI PR #81: PASS — 3 pruebas unitarias, 16 E2E de navegador y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44780320046.
- CI post-merge #82 sobre el SHA integrado: PASS — pruebas unitarias, 16 E2E de navegador y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44780632456.
- Se agregan estados de trabajo editables (Pendiente, En curso, Bloqueada), archivo individual reversible, filtro Activas/Archivadas/Todas, restauración conservando estado y archivo masivo de tareas activas seleccionadas.
- El campo de duración estimada ahora pregunta «¿Cuánto tiempo crees que te llevará?» y aclara que organiza el día y no inicia un temporizador.
- Se reutilizan `task.status` y `task.archived_at`. Las operaciones se limitan por propietario, identidad, estado/archivo esperado y filas afectadas. Archivar no elimina físicamente ni altera el estado previo.
- E2E usa Auth/PostgREST mocks; no escribe datos reales de Supabase en QA.
- Sin migraciones ni cambios de esquema, RLS, grants, permisos o secretos. Sin despliegue público ni preview.
- Validación manual de Robert en localhost: PENDIENTE.

### Sesión de validación manual — Lote 10

1. Cambiar una tarea entre Pendiente, En curso y Bloqueada.
2. Archivar una tarea, filtrar por Archivadas y restaurarla comprobando que mantiene su estado.
3. Seleccionar dos tareas activas y archivarlas en bloque.
4. Archivar y restaurar una tarea completada; confirmar que sigue completada.
5. Revisar el nuevo texto de duración estimada al crear y editar una tarea.

## Lote 11 — Conectar tareas con metas y submetas (20/11/2026)

- PR #15 integrado: https://github.com/SimpleLife9/simplelife/pull/15.
- SHA squash integrado en main: `3b98fb660fbd40c70e48ea0a9ea8710b4c2494de`.
- SHA validado en la rama del PR: `f3dfca243c2550f69a057c7aa8563163a161c157`.
- CI PR #90: PASS — 3 pruebas unitarias, 17 escenarios Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44813982093.
- CI post-merge #91: PASS sobre el SHA exacto integrado en main; pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44816117392.
- Las tareas pueden vincularse a una o varias Metas y/o Submetas. Cada tarea muestra sus objetivos y permite filtrar por Meta, Submeta o «Sin objetivo».
- El filtro de una Meta incluye tareas vinculadas directamente a ella y tareas vinculadas solamente a cualquiera de sus Submetas.
- La gestión de vínculos permite desvincular mediante el estado `removed` y restaurar el mismo registro a `confirmed`, sin borrado físico ni duplicados.
- Las tarjetas de Metas y Submetas muestran las tareas contribuyentes y sus estados.
- Se reutiliza `public.contribution_relation`, sus índices únicos, restricciones, políticas RLS y grants existentes. Se verificaron las políticas y permisos en modo lectura; no se modificaron esquema, migraciones, RLS, grants, permisos ni secretos.
- Playwright utiliza mocks de Auth/PostgREST; no realiza escrituras de QA en datos reales de Supabase.
- Revisión general de Robert en localhost (20/11/2026): FAVORABLE A NIVEL GENERAL. Indicó que probó aproximadamente el flujo y que funcionó bastante bien. No se registra PASS exhaustivo porque no confirmó cada caso de la lista individualmente.
- Sin despliegue público ni preview.

### Sesión de validación manual — Lote 11

1. En Más → Tareas, vincula una tarea a una Meta y después también a una Submeta.
2. Filtra por esa Meta y por esa Submeta; comprueba que ambas muestran la tarea correspondiente.
3. Vincula otra tarea únicamente a una Submeta y comprueba que aparece al filtrar por la Meta principal.
4. Desvincula la relación directa con la Meta y restáurala desde el mismo diálogo; confirma que no se crea otra relación.
5. En Objetivos → Metas y Submetas, comprueba que aparecen las tareas contribuyentes y sus estados.


## Lote 12 — Gestión de tareas dentro de proyectos (20/11/2026)

- PR #16 integrado: https://github.com/SimpleLife9/simplelife/pull/16.
- SHA squash integrado en main: `2cb3ed2b7b002d2463221289d6ae69f6bbe7265e`.
- SHA de la rama validada: `21174606fae84b5da222b1192b0f26d81eb9c129`.
- CI PR #94: PASS — 3 pruebas unitarias, 18 escenarios Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44819984262.
- CI post-merge #95: PASS sobre el SHA exacto integrado en main — 3 pruebas unitarias, 18 escenarios Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44820234401.
- Tareas permite gestionar asociaciones con proyectos después de crear la tarea.
- Una tarea puede tener un proyecto principal y varios proyectos adicionales. Al cambiar el principal, el anterior pasa a adicional; no se elimina el vínculo.
- Cada fila de tarea muestra proyectos asociados y su rol. El filtro permite elegir un proyecto o «Sin proyecto».
- El detalle de cada proyecto muestra sus tareas y distingue si la asociación es principal o adicional.
- Auditoría de solo lectura de `public.task_project_link`: la tabla ya existía, con RLS, unicidad por pareja tarea/proyecto e índice para un único principal. `authenticated` tiene SELECT/INSERT y UPDATE únicamente sobre `relation_role`; no tiene DELETE. La interfaz no ofrece desvincular ni borrar relaciones porque el permiso no existe. Los vínculos se conservan.
- Sin cambios de esquema, migraciones, RLS, grants, permisos o secretos. E2E usa mocks de Auth/PostgREST; no se escribieron datos de QA en Supabase real.
- Validación manual de Robert en localhost: PASS (20/11/2026). Confirmó que probó todo el flujo y funciona correctamente.
- Sin despliegue público ni preview.

### Sesión de validación manual — Lote 12

1. En Más → Tareas, abre una tarea existente y pulsa «Vincular proyecto».
2. Añade un proyecto activo y comprueba que queda como principal cuando es el primero.
3. Añade un segundo proyecto y comprueba que aparece como adicional.
4. Pulsa «Hacer principal» en el segundo proyecto y confirma que el anterior pasa a adicional y ninguno desaparece.
5. Filtra tareas por cada proyecto y por «Sin proyecto».
6. Abre Proyectos y entra en ambos detalles; confirma que la misma tarea aparece en ambos y que el rol principal/adicional coincide.


## Lote 13 — Hoy como panel de ejecución (20/11/2026)

- PR #17 integrado: https://github.com/SimpleLife9/simplelife/pull/17.
- SHA squash en main: `d7063a0e11db297eecf9418a5ae4a15209611d38`.
- SHA de la rama con CI aprobada: `8826c35b7a36a4e09078951dae5ccfe4a908c0f4`.
- CI del PR #100: PASS — 6 pruebas unitarias, suite Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44823145193.
- CI post-merge #101: PASS sobre el SHA exacto `d7063a0e11db297eecf9418a5ae4a15209611d38` — pruebas unitarias, Playwright E2E y build de producción: https://github.com/SimpleLife9/simplelife/actions/runs/44823379545.
- CI documental #102: PASS sobre el SHA `d5335d55aede6fc4dbd9facfa7e78f68f9ff1fe6` — install, unit tests, Playwright E2E y production build: https://github.com/SimpleLife9/simplelife/actions/runs/44823638558.
- Hoy incorpora avance de metas y proyectos a partir de tareas relacionadas realmente completadas, con vínculos directos a metas y a través de submetas. El porcentaje es tareas vinculadas completadas / tareas vinculadas contabilizables, con IDs deduplicados.
- Las tareas eliminadas/canceladas y las abiertas archivadas no cuentan; las completadas archivadas conservan su aporte histórico.
- Nuevo pulso semanal basado en los últimos siete días del calendario `America/Havana`, panel de tareas bloqueadas y metas/proyectos atrasados o con vencimiento dentro de siete días.
- Accesos rápidos a Objetivos, Proyectos y Tareas, con diseño responsive. Playwright verifica el nuevo panel a 390 px sin desbordamiento horizontal.
- Pruebas adicionales: 3 escenarios unitarios de cálculos y un E2E del panel completo.
- Solo consultas de lectura a tablas existentes con RLS. Sin tablas, columnas, migraciones, políticas RLS, grants, permisos, secretos ni escrituras reales de QA.
- Sin despliegue público ni preview.
- Validación manual de Robert en localhost: PASS (20/11/2026). Confirmó que revisó el nuevo panel y que está todo bien. Anexo 140 / Lote 13 cerrado manualmente.


## Phase readiness and Phase 0 modularization — 20 Nov 2026

### Phase preparation
- PR #18 integrated: https://github.com/SimpleLife9/simplelife/pull/18.
- Phase playbook, verified architecture baseline, complete phase roadmap and Phase 1 Agenda specification added under `docs/`.
- PR CI #104 PASS: https://github.com/SimpleLife9/simplelife/actions/runs/44828223680.
- Post-merge CI #105 PASS on main SHA `c8b0d5b1355a6eb9a54250c565781421d9f042f0`: https://github.com/SimpleLife9/simplelife/actions/runs/44832866169.
- Notion continuity record: Anexo 142 — https://app.notion.com/p/41efeb355ec18137a1a0edb81f229554.

### Phase 0 — behavior-preserving modularization

| PR | Extracted boundary | PR CI | Post-merge CI | Integrated SHA |
|---|---|---|---|---|
| #19 | Shared date/time/duration utilities `src/lib/date-time.js` | #106 PASS | #107 PASS | `e4c02318944cff369224768d7d4eb7591969a1a7` |
| #20 | Today task row `src/features/today/components/TaskRow.jsx` | #108 PASS (19/19 Playwright) | #109 PASS | `b778587d29785d63f7d48b4fdb09588497372314` |
| #21 | Shared data hook `src/shared/hooks/useRows.js` | #110 PASS | #111 PASS | `1434b060177b205f91ad488d51f2f7b19ff9d29c` |
| #22 | Tasks open-state domain rule `src/features/tasks/domain/task-status.js` | #112 PASS | #113 PASS | `bc24b679a835671ed960264c9dac9d61d5d24495` |
| #23 | Shared UI `SectionTitle` and `EmptyState` components | #114 PASS | #115 PASS | `5cc05352727d5106aed8b18959ac669b52809cca` |
| #24 | Today page and owner-scoped task operations | #118 PASS | #119 PASS | `84f849ed761217cf9e69ed445e9536dd6da24c2e` |
| #25 | Inbox page `src/features/inbox/InboxPage.jsx` | #120 PASS | #121 PASS | `1835738d467abba2db96489f9fe4cb1558190673` |
| #26 | Goals / Areas / Subgoals page plus shared Field and StatusTag | #122 PASS | #123 PASS | `b9fe21da20d14d316678019ee36706607028573f` |
| #28 | Projects page plus shared TextAreaField and ProjectStatusTag | #126 PASS | #127 PASS | `5e8bb1c4108772b294c8c7b3be740611819e9d0f` |
| #29 | Tasks page `src/features/tasks/TasksPage.jsx` | #128 PASS | #129 PASS | `bbd23f09f18c66eeb28f072759f8c5cfa287c8b5` |
| #30 | Notes/Ideas page and shared FormCard | #131 PASS | #132 PASS | `87855169e005a71e4234ed6a94658280bd72f90d` |
| #31 | Lists page `src/features/lists/ListsPage.jsx` | #133 PASS | #134 PASS | `70ff390af213a59cdd10e26f8af9948e5b7d8073` |
| #32 | AuthScreen and shared Brand/Configuration/Loading screens | #136 PASS | #137 PASS | `33f2e2c3300c7f3a0fb5edec96cdffb7ba2d7cbb` |
| #33 | Authenticated AppShell and navigation metadata `src/app/` | #141 PASS | #142 PASS | `52e9c4eaa1ac70d3020144c05a4bc82fa9614034` |
| #34 | Shared app action orchestration `src/app/createAppActions.js` | #145 PASS | #146 PASS | `e75f9583bc97b6fe10f6e48a5a63bc2bdf388fb1` |
| #35 | Feature page composition `src/app/AppPages.jsx` | #147 PASS | #148 PASS | `7ed702a110a6ca155797c868826ea7019c06b14f` |
| #36 | Auth/session lifecycle hook `src/app/useAppAuth.js` | #151 PASS | #152 PASS | `6c0ffab3a848dfada10e01fe8691e87f9a6cf808` |
| #37 | Auth session restoration after browser reload (E2E test) | #154 PASS | #155 PASS | `c03d9bbbdfab333a3aa898863cc0d47c2eed781c` |
| #38 | Notes/Ideas search, filters, edit and archive/restore | #161 PASS | #162 PASS | `c6b681414e3f7b97a4c020632f1abacb888a4e43` |
| #39 | Lists search, rename, item editing, reorder and archive/restore | #169 PASS | #170 PASS | `50092bb8f536724fdb9bd08a06088fd0393631f8` |
| #40 | Reconcile E2E acceptance for task lifecycle and goal/subgoal contributions | #172 PASS | #173 PASS | `754d15b33bcb676636bb052cb4af491762870721` |
| #41 | Gated live Supabase Auth and Data API smoke harness | #175 PASS | #176 PASS | `966a438b3fe220c191852b158c09743d035f8b97` |

- The extractions from PRs #19–#39 preserve existing APIs or behavior. PRs #33–#35 were verified with 20 Playwright scenarios; PR #36 adds logout (21), PR #37 adds session restoration after reload (22), PR #38 adds Notes/Ideas lifecycle maintenance (24), and PR #39 adds full Lists maintenance (25). PR #34 added four isolated unit tests, bringing the unit suite to 21. PR #40 reconciles additional Lote 10/11 lifecycle/contribution assertions within the same 25 Playwright scenarios.
- No new framework/dependency, schema migration, RLS/grant, auth, secret, Service Worker or deployment change was made in these batches.
- This is incremental boundary work, not a completed rewrite. `src/App.jsx` now owns session/auth orchestration, cross-feature state and app-level composition; `src/app/` owns the authenticated shell, navigation, shared action orchestration and page mounting. Further session/service/domain extraction and validation gates remain before Phase 0 closes.
- The real authenticated Supabase browser test and physical-device validation remain open; mocked E2E is not evidence of real persistence.


## PR #33 — authenticated app shell and navigation extraction (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/33 — MERGED.
- Branch `refactor/phase0-extract-app-shell`; tested head SHA `2e5447147bd47b79ec0fd432a1d516a00d2acf14`; merge SHA `52e9c4eaa1ac70d3020144c05a4bc82fa9614034`.
- CI #141 PASS on the exact PR head: unit tests, all 20 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44848428701.
- CI post-merge #142 PASS on the exact merge SHA: https://github.com/SimpleLife9/simplelife/actions/runs/44848675770.
- `src/app/AppShell.jsx` owns the authenticated visual shell, sidebar, top bar, page heading, alerts, section tabs, footer and mobile navigation.
- `src/app/navigation.js` owns the existing navigation metadata and pure title/description mapping. Existing menu labels and destinations remain unchanged.
- `src/App.jsx` was reduced from 12,958 to 9,087 characters in this cut (3,871 fewer); session/auth, profile loading, shared action orchestration and page composition remain there.
- New Playwright coverage checks all five primary destinations and active states in desktop and mobile viewports (20 total scenarios).
- No database/schema, migration, RLS/grants, Auth configuration, secret, dependency, Service Worker, PWA cache or deployment change.

## PR #34 — shared app action orchestration (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/34 — MERGED.
- Branch `refactor/phase0-extract-action-orchestration`; tested head SHA `44ae00f77bd0b27070583ba297e23bd1de9bb485`; merge SHA `e75f9583bc97b6fe10f6e48a5a63bc2bdf388fb1`.
- CI #145 PASS on the exact PR head: 21 unit tests, 20 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44849002744.
- CI post-merge #146 PASS on the exact merge SHA: https://github.com/SimpleLife9/simplelife/actions/runs/44849425684.
- Added `src/app/createAppActions.js` to extract the existing `showNotice`, `showError` and `runAction` lifecycle.
- React state remains owned by `App`; the factory receives stable React setters and is memoized once. Existing behavior retained: busy state, shared refresh increment, 3.5-second notice, old-timeout/new-notice race guard, error clearing and fallback.
- Added four Node unit tests: successful operation, failed operation, notice timeout race and clearing a notice on error.
- `src/App.jsx` reduced from 9,087 to 8,516 characters in this cut (571 fewer).
- No Supabase Auth, data operation, schema, migration, RLS/grants, secret, dependency, Service Worker, PWA cache or deployment change.

## PR #35 — feature page composition extraction (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/35 — MERGED.
- Branch `refactor/phase0-extract-page-composition`; tested head SHA `72883c3ecefd84dd7cc1bf99d3fe75aa930d4d52`; merge SHA `7ed702a110a6ca155797c868826ea7019c06b14f`.
- CI #147 PASS on the exact PR head: unit tests, 20/20 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44849617615.
- CI post-merge #148 PASS on the exact merge SHA: https://github.com/SimpleLife9/simplelife/actions/runs/44849792618.
- `src/app/AppPages.jsx` owns the conditional mounting of Today, Inbox, Goals, Projects, Tasks, Notes and Lists.
- `src/App.jsx` delegates feature mounting and no longer imports those seven page modules or unused legacy utilities/components.
- `src/App.jsx` reduced from 8,516 to 6,509 characters (2,007 fewer).
- Existing Playwright coverage checks all primary destinations, both navigation layouts and the More submodules.
- No changes to database, data operations, Auth, schema, RLS/grants, secrets, dependencies, Service Worker, PWA or deployment.

## PR #36 — auth/session lifecycle extraction (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/36 — MERGED. Branch `refactor/phase0-extract-auth-session`; tested head SHA `763ab007c058e119592e9af102507016ab2f2ec6`; merge SHA `6c0ffab3a848dfada10e01fe8691e87f9a6cf808`.
- New `src/app/useAppAuth.js` owns the current session/profile initialization, auth-state subscription, login, registration and sign-out actions.
- `App.jsx` keeps the application error state and passes its stable setter into the hook; rendering and navigation remain in the application shell.
- Existing Auth behavior is retained: session restore, profile readiness, deferred profile work after auth callbacks, email normalization, registration confirmation message, profile preparation, Spanish error messages and sign-out result handling.
- Added explicit E2E coverage for signing out from an authenticated session and returning to the sign-in screen. The logout request is mocked and asserted; no real account is used.
- `src/App.jsx` reduced from 6,509 to 3,016 characters (3,493 fewer).
- CI #151 PASS on the exact PR head: 21 unit tests, 21/21 Playwright scenarios (including sign-out returning to login) and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44850316937.
- CI #150 initially failed only because the new test used an ambiguous heading selector matching both `Hoy` and `Para hoy`. The assertion was corrected to target `.page-heading h1`; no production behavior needed modification.
- CI post-merge #152 PASS on the exact merge SHA: https://github.com/SimpleLife9/simplelife/actions/runs/44850568173.
- No Auth configuration, credential, user data, schema, migration, RLS/grants, secret, dependency, Service Worker, PWA cache or deployment change.


## PR #37 — auth session restoration after browser reload (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/37 — MERGED.
- Branch `test/phase0-auth-session-restore`; tested head SHA `fdf26150fa6f8f39fa8b047c42ce84ff32b9eec9`; merge SHA `c03d9bbbdfab333a3aa898863cc0d47c2eed781c`.
- Test-only change in `tests/e2e/app-data.spec.js`: sign in using mocked Auth/PostgREST, reload the browser tab, verify Today and the profile are restored, then sign out and confirm return to login.
- CI #154 PASS on the exact PR head: all 22 Playwright scenarios, unit tests and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44850827033.
- CI post-merge #155 PASS on the exact merge SHA: https://github.com/SimpleLife9/simplelife/actions/runs/44850997205.
- This verifies client-side session restoration with deterministic mocks only. It is not evidence of real Supabase CRUD persistence.
- No production code, Auth config, database/data, schema, RLS/grants, secrets, dependencies, Service Worker, PWA or deployment changes.

## PR #38 — Notes/Ideas search, filters and lifecycle (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/38 — MERGED.
- Branch `feat/phase0-notes-search-filters`; tested head SHA `e585a6bd86accded257d3a995d0ce02d8b129514`; merge SHA `c6b681414e3f7b97a4c020632f1abacb888a4e43`.
- CI #161 PASS on the exact PR head: 21 unit tests, 24/24 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44851870993.
- CI post-merge #162 PASS on the exact merge SHA: https://github.com/SimpleLife9/simplelife/actions/runs/44852063433.
- `NotesPage` searches by title/content, filters by kind (all / notes / ideas) and lifecycle (active / archived / all), shows visible-versus-total count and a no-results state.
- Each note/idea can be edited (kind, optional title and content), archived and restored. Archive is reversible and retains content/relations; no hard delete is introduced.
- Responsive `notes-toolbar`, archive label and per-card actions added.
- E2E uses deterministic mock records and covers title search, content search, kind filters, editing, archive, restore and content preservation.
- Corrected read-only audit of `Simplelife_dev` (`iybnjrnysiikbtokyshg`): `public.note_idea` has RLS enabled, owner-scoped policy `note_idea_self`, and columns for `status`, `archived_at`, `deleted_at` and `purge_after`.
- The initial check of `information_schema.role_table_grants` showed only table-level `SELECT` and `INSERT`. A follow-up check of `information_schema.column_privileges` and `has_column_privilege` found existing column-level `UPDATE` for `title`, `content`, `kind`, `status`, `archived_at`, `deleted_at` and `purge_after`. Thus the required note edit/archive fields are already permitted without widening grants.
- The `note_idea_touch` trigger updates `updated_at`. Ownership RLS remains unchanged; updates include the authenticated owner filter and exclude deleted rows.
- The same column-level audit found `user_list` UPDATE for `name`, `purpose`, `status`, `archived_at`, `deleted_at`, `purge_after`; and `list_item` UPDATE for `content`, `is_checked`, `position`, `task_id`. No grants, policies, schema, data or rows changed in this audit.
- No service-role access or RLS bypass.
- The real Supabase authenticated browser CRUD smoke and physical Android/iOS validations remain independent Phase 0 gates. Mocked tests do not count as backend persistence evidence.

## PR #39 — Lists search and complete maintenance (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/39 — MERGED.
- Branch `feat/phase0-list-maintenance`; tested head SHA `beef816fd42aa4055773de07e20a177226b5bc2f`; merge SHA `50092bb8f536724fdb9bd08a06088fd0393631f8`.
- CI #169 PASS on the exact PR head: 21 unit tests, 25/25 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44855943017.
- CI post-merge #170 PASS on the exact merge SHA: 21 unit tests, 25/25 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44856099007.
- Lists can be searched by name/purpose and filtered by active/archived/all. Counters show visible versus total lists.
- Lists can be renamed and their optional purpose edited; archive/restore is reversible, keeps the list and its items, and archived lists are read-only until restored.
- Items can be edited, checked/unchecked and reordered. Item edits and reordering preserve existing `task_id` links. The established idempotent conversion-to-task flow remains intact.
- The read-only Supabase audit confirmed column-level UPDATE already present for the exact fields: `user_list` name/purpose/status/archived_at/deleted_at/purge_after; `list_item` content/is_checked/position/task_id. RLS remains owner/parent scoped, and `user_list_touch` / `list_item_touch` triggers update `updated_at`.
- Read-only index audit found no unique constraint on `position`; `list_item` has primary key on ID and non-unique indexes on list_id/task_id. Position swap does not conflict with a unique position index.
- No grant, policy, schema, data, row, Auth config, secret, dependency, Service Worker, PWA or deployment change.
- Added a deterministic E2E scenario covering list rename/purpose, item edit, reorder, checkbox state, preserving a linked task, archive/restore and archived read-only controls.
- Earlier CI #164/#166/#168 runs exposed test-only issues: immutable owner payload expectation, asynchronous checkbox state refresh, and ambiguous archive badge text. These were corrected without weakening assertions or changing production behavior.
- No hard delete; archive is reversible and retains list items and task relationships. No service-role access or RLS bypass.
- Real Supabase CRUD and physical-device Phase 0 gates remain independent; mocked E2E is not real persistence proof.

## PR #40 — Reconcile Lote 10 and Lote 11 E2E acceptance (21/11/2026)

- Test-only PR on `test/phase0-reconcile-lotes-10-11`; base main SHA `c6f2a02bd3aac2fcdd148d3650044b3e0e016b76`.
- Lote 10:
  - Extend the lifecycle E2E to archive and then restore an already-completed task.
  - Assert `status=completed`, original `completed_at` and `completion_outcome=complete` survive archive and restore.
  - Assert the estimated-duration helper explicitly says it does not start a timer in both create and edit dialogs.
- Lote 11:
  - Seed one task as blocked and another as pending.
  - Assert both the goal card and subgoal card display each contributing task with its correct status label.
  - Existing E2E already covers direct Goal and Subgoal links, subgoal-only task included by parent Goal filter, removal/restoration of the same relation, no duplicate row, and direct/subgoal filters.
- No application/runtime code change. No Supabase credentials, real user, data, schema, grant, RLS, or deployment change.
- Validation target: 21 unit tests, 25 Playwright scenarios, production build; post-merge CI on exact SHA.
- Important evidence boundary: passing mocks validates the UI/client contract only. The manual localhost checks in Anexo 137/138 remain pending, as does the real authenticated Supabase smoke.
- Do not mark either Lote 10 or 11 as manual PASS until Robert confirms the listed hands-on checks.

## PR #40 — Lote 10/11 acceptance coverage reconciliation (21/11/2026)

- PR: https://github.com/SimpleLife9/simplelife/pull/40 — MERGED.
- Branch `test/phase0-reconcile-lotes-10-11`; tested head SHA `aa069761dcc51935904ba0c5c9ae842f8ae27edc`; merge SHA `754d15b33bcb676636bb052cb4af491762870721`.
- CI #172 PASS on the exact PR head: 21 unit tests, 25/25 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44856769388.
- CI post-merge #173 PASS on the exact merge SHA: 21 unit tests, 25/25 Playwright scenarios and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44856926235.
- Lote 10 automated coverage now archives and restores a completed task while checking `status=completed`, `completed_at` and `completion_outcome=complete`; it also asserts the duration-estimate help says it does not start a timer in both create and edit dialogs.
- Lote 11 automated coverage now asserts that the Goal and Subgoal cards show the right visible task status (Pending/Blocked) for each contributor, in addition to existing direct/subgoal linking, parent Goal filter inclusion, unlink/restore of the same relation, and no duplicates.
- Test-only change; no application code, data, schema, grants, RLS, secrets, credentials or deployment change.
- Manual localhost checks for Anexos 137/138 remain pending. Passing mocks is not evidence of real Supabase persistence.

## PR #41 — Gated live Supabase authenticated smoke harness (21/11/2026)

- Test/config/workflow/docs only; based on main SHA `4627a913fd1a6b51055ce60f14d1729dcb7c63c1`.
- Adds `npm run test:e2e:live`, isolated Playwright config, a dedicated real-Auth smoke spec, and manual-only GitHub Actions workflow `.github/workflows/live-supabase-smoke.yml`.
- The normal CI only runs the live suite in list/discovery mode; it does not connect to Supabase and performs no writes.
- The live workflow is `workflow_dispatch` only, defaults its explicit `confirm_live_writes` gate to false, serializes runs, uses a single browser worker, and requires repo secrets `SIMPLELIFE_QA_EMAIL` / `SIMPLELIFE_QA_PASSWORD`.
- No sign-up, Auth admin calls, service-role/secret key, SQL writes, DELETE, schema, grants, RLS, or data changes in this PR.
- Supabase schema inspection found `user_profile.auth_user_id → auth.users.id ON DELETE RESTRICT`; user-owned records also reference profiles with RESTRICT. Do not call this a disposable account. The smoke requires a persistent, dedicated QA-only identity, provisioned by an authorized human; it never creates or deletes that identity.
- Stable canary Task/Note/List records are reused on each run and end archived. One stable list item remains under the archived canary list because list_item has no soft-delete field and authenticated has no physical DELETE privilege.
- The test checks authenticated login/profile bootstrap, Task status write/read after reload, Note insert/update/read after reload, List and ListItem insert/update/read after reload. This is scoped QA smoke, not comprehensive RLS security coverage.
- Playwright trace, screenshots and video are disabled to avoid credential-entry artifacts.
- No live workflow dispatch has been run. It must not run until the dedicated QA account exists and the secrets are configured.
- CI #175 PASS on the exact PR head: 21 unit tests, 25/25 mocked Playwright, live-suite --list validation (no connection), and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44859626984.
- CI post-merge #176 PASS on exact merge SHA `966a438b3fe220c191852b158c09743d035f8b97`: same 21 unit tests, 25/25 Playwright, live-suite --list, and build: https://github.com/SimpleLife9/simplelife/actions/runs/44859841847.
- Live workflow dispatch: NOT RUN. Pending a human-provisioned, persistent QA-only Auth account and repository Actions secrets `SIMPLELIFE_QA_EMAIL` / `SIMPLELIFE_QA_PASSWORD`.


## Continuity update — live Supabase smoke and Phase 0 open gates (21/11/2026)

### Authenticated Supabase smoke — completed gate

- Latest verified `main`: `2da04ebb88874c910fe733fa14914a5caaedad1d`.
- PR #42 — login selector and Havana date fixtures: MERGED at `7d09d23e2dfe1e494bd907b2f4c24e440ebd6a31`; PR CI #182 PASS; post-merge CI #183 PASS.
- PR #43 — accessible `Más` navigation selector: MERGED at `7135a2475699691888d8614468cc6ca21b966401`; PR CI #185 PASS; post-merge CI #186 PASS.
- PR #44 — list-item wrapper locator: MERGED at `ce9d3c68ad959245dc3a4b7c66e3701cf5b95776`; PR CI #187 PASS; post-merge CI #188 PASS.
- PR #45 — reuse active QA canaries: MERGED at `cbeff8d4854e158c121b742c62b2ef430809d300`; PR CI #189 PASS; post-merge CI #190 PASS.
- PR #46 — wait for all list data and verify checkbox persistence: MERGED at `2da04ebb88874c910fe733fa14914a5caaedad1d`; PR CI #191 PASS; post-merge CI #192 PASS.
- PR #46 CI runs use 22 unit tests, 25 Playwright scenarios, live-suite discovery and production build.
- Live smoke #2 failed after login at the More navigation selector: https://github.com/SimpleLife9/simplelife/actions/runs/44866444687.
- Live smoke #3 failed on an incorrectly scoped list-item action locator: https://github.com/SimpleLife9/simplelife/actions/runs/44894221686.
- Live smoke #4 failed because historical note canaries made the edit locator ambiguous: https://github.com/SimpleLife9/simplelife/actions/runs/44894942878.
- Live smoke #5 failed while Playwright attempted to check the controlled list-item checkbox; a read-only audit showed the latest item had nevertheless persisted as checked: https://github.com/SimpleLife9/simplelife/actions/runs/44895643770.
- **Live smoke #6: PASS** on exact main SHA `2da04ebb88874c910fe733fa14914a5caaedad1d`: https://github.com/SimpleLife9/simplelife/actions/runs/44897930442. The dedicated real-auth browser scenario passed end-to-end (1 test passed in 13.4s): Auth/profile bootstrap, task state change/reload/archive, note edit/reload/archive, list item edit/check/reload and final list archive.
- Post-run Supabase audit (read-only): QA user signed in; 3 task canaries (all archived); 3 note canaries (all archived); 2 list canaries (one archived, one older active); 2 list-item canaries (latest item `is_checked=true`, older item `false`). Counts did not increase during run #6; no new duplicates were created.
- No SQL writes, physical DELETE, cleanup, DDL, migration, RLS/grant, Auth configuration, or secret changes were made during the smoke/audit.
- **Evidence status:** real Auth sign-in/profile bootstrap and authenticated Task/Note/List/ListItem CRUD + reload persistence = PASS for this bounded QA scenario. This does not certify every account/preferences flow, all owner-isolation security cases, physical Android/iOS, or public deployment.

### Reconciled Phase 0 validation register

| Area | Existing evidence | Current state | Remaining gate |
|---|---|---|---|
| Shared date/time and app modularization PRs #19–#39 | PR and post-merge CI recorded above | CI PASS / integrated | Continue only if a concrete boundary or regression requires it; no broad rewrite |
| Lote 5 — Areas/Goals/Subgoals | Anexo 131 confirms manual validation for area ordering, separate navigation, goal/subgoal editing, subgoal creation and persistence | Manual PASS for those listed cases | Keep untested modal/edge cases separate; do not reopen confirmed checks |
| Lote 6 — Project ↔ Goal/Subgoal relations | Robert confirmed links and persistence in localhost | Manual PASS for linking/persistence | E2E covers unlink/restore and archived-project restrictions; those are not separately claimed as manual PASS |
| Lote 7 — Inbox organization and destination navigation | Anexo 134 confirms Notes/Ideas and Lists are discoverable and show organized records | Manual PASS for browsing organized destinations | Inbox review/archive lifecycle is separate and remains pending below |
| Lote 8 — List item to task conversion | Anexo 135 confirms conversion works | Manual PASS | No known blocker in this scope |
| Lote 9 — Daily planning / task batches | Anexo 136 confirms the lot and clarifies estimated duration is not a timer | Manual PASS | No known blocker in this scope |
| Lote 10 — Task lifecycle | PR #40 expanded mocked E2E for status, archive/restore completed tasks and retained completion metadata; 25 scenarios pass | Automated PASS; manual acceptance NOT COMPLETE | Execute the five localhost checks in the Lote 10 section above, including bulk archive and completed-task archive/restore |
| Lote 11 — Task ↔ Goal/Subgoal contributions | PR #40 expanded mocked E2E for direct/subgoal links, parent filtering, unlink/restore, deduplication and status display; Robert earlier gave a generally favorable but non-exhaustive review | Automated PASS; manual acceptance NOT COMPLETE | Execute the five localhost checks in the Lote 11 section above |
| Lote 12 — Task ↔ Project associations | Existing manual record confirms principal/additional roles, switching the principal, filters and project details | Manual PASS | Do not repeat |
| Lote 13 — Today execution dashboard | Anexo 140 confirms manual review PASS | Manual PASS | Do not repeat |
| Inbox review/archive (separate from Lote 7 organization) | PR #4 automated E2E/CI covers search, review/unreview, archive/restore and preservation of original capture; manual browser record is still pending | Automated PASS; manual PENDING | Validate the real user flow once in authenticated localhost |
| Project management base lifecycle / creation modals | PRs #5/#6 automated tests cover search, filters, editing, dates, archive/restore and modal behavior; original manual records remain pending | Automated PASS; manual PENDING | Validate project create/edit/filter/archive/restore and modal create/cancel behavior once |
| Auth, profile and preferences | Smoke #6 proves real Auth sign-in/profile bootstrap in the dedicated QA account; mocked E2E covers logout/session restore | Bounded real Auth PASS; broader account/preferences PENDING | Reconcile account/profile/preferences against approved scope before declaring this domain closed |
| Notes/Ideas and Lists | Mocked lifecycle E2E, plus smoke #6 real edit/check/archive/reload | Bounded automated + real persistence PASS | Search/restore edge cases retain mocked coverage; no further live canary expansion required now |
| Physical Android/iOS and PWA behavior | Not included in hosted-browser smoke | NOT RUN / PENDING | Manual physical-device check only if platform-specific behavior is in Phase 0 acceptance |

### Execution order from this register

1. Do not repeat the real Auth/CRUD smoke #6; it has a recorded PASS for its defined scope.
2. First complete the unresolved Lote 10 manual checklist, then Lote 11, using Robert's authenticated localhost session; record each as PASS only after explicit confirmation.
3. Then close the separate manual gates for Inbox review/archive and project base lifecycle/modals.
4. Reconcile account/profile/preferences and device/PWA validation against the approved Phase 0 acceptance scope. Do not expand database schema or permissions merely to satisfy a checklist.
5. Keep Phase 0 OPEN until the mandatory remaining gates are either validated or explicitly deferred with Robert's decision.



## Update — Lote 10 live-smoke readiness (21/11/2026)

- Current main verified: 8abcfa031e6f2e387b582eb933186092faac2a92.
- PR #48 integrated: https://github.com/SimpleLife9/simplelife/pull/48.
- PR CI #196 PASS on head d83efbd89bc7ddff4384874d268070bad131cea5: 22 unit tests, 25 Playwright tests, live-suite discovery and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44900996522.
- Post-merge CI #197 PASS on the exact current main SHA: 22 unit tests, 25 Playwright tests, live-suite discovery and production build: https://github.com/SimpleLife9/simplelife/actions/runs/44901157427.
- PR #48 extends only tests/live/authenticated-smoke.spec.js with a manually gated real-auth task-lifecycle scenario. It reuses the three existing task canaries and does not create additional rows or issue DELETE.
- New real scenario coverage: task status transitions among Pendiente/En curso/Bloqueada; persisted status after reload; duration-estimate explanation in create/edit forms; individual archive/restore; bulk archive preserving distinct task states; completion metadata (completed_at, completion_outcome) surviving archive/restore and reload; three rows archived at the end.
- Pre-run Supabase audit (read-only): dedicated QA profile exists; exactly three task canaries match the stable title; all three are archived with existing status in_progress, no completed_at, and no completion_outcome. This is the safe baseline before the new scenario; no writes or duplicate rows have been made.
- Live smoke #6 remains PASS for its original, bounded Auth/Task/Note/List/ListItem scenario. Do not repeat it.
- Live smoke #7: NOT RUN. It requires a manual GitHub Actions workflow_dispatch on branch main with input confirm_live_writes=true. The available GitHub connection is read-only for workflow dispatch; do not claim the run was started or bypass the gate.
- Workflow link: https://github.com/SimpleLife9/simplelife/actions/workflows/live-supabase-smoke.yml.
- Existing Actions secrets SIMPLELIFE_QA_EMAIL and SIMPLELIFE_QA_PASSWORD are already configured. Do not request new credentials, recreate the account, or paste secrets into chat/terminal.
- After smoke #7: audit by read-only SQL that there remain exactly three task canaries, all archived; verify one canary is completed with non-null completed_at and completion_outcome='complete'; verify the other two retain their prior work states; inspect timestamps and the workflow log. Do not clean up or physically delete the QA canaries.
- Automated live-smoke PASS will not by itself replace Robert's manual localhost acceptance. Lote 10 manual gate and the broader Phase 0 acceptance gates remain OPEN.
- ChatBending continuity: Anexo 142 has been updated with PR #48, CI #196/#197, baseline audit and smoke #7 gate: https://app.notion.com/p/41efeb355ec18137a1a0edb81f229554.



## Checkpoint — Live smoke #9 PASS; Lote 11 manual gate remains (21/11/2026)

### Lote 10 — evidencia de smoke autenticado real

- Main probado: `d2ade1f014d14f9747c6a8e739ee73c891fd9f0c`.
- Workflow live smoke #9: SUCCESS, evento `workflow_dispatch`, branch `main`, SHA exacto. Run: https://github.com/SimpleLife9/simplelife/actions/runs/44906906069.
- Job `live-smoke`: SUCCESS. Playwright live ejecutó 2/2 pruebas: persistencia autenticada de Task/Note/ListItem y ciclo de vida del Lote 10 con estados, archivo/restauración y metadatos de finalización. La suite reportó 18.6 s.
- Auditoría SQL posterior, solo lectura, en `public.task`: exactamente 3 canarios QA; los 3 archivados; 1 `completed` con `completed_at` no nulo y `completion_outcome=complete`; los otros 2 conservaron `blocked` y `todo`; 0 `deleted_at`; sin duplicados.
- Los fallos #7 y #8 permanecen como histórico y no se reetiquetan. El smoke #9 valida la corrección de aserciones de avisos transitorios incorporada en PR #50.
- **Límite:** este PASS cubre el smoke automatizado real del Lote 10; no reemplaza la aceptación manual punto por punto de Lote 10 ni cierra Fase 0.

### Lote 11 — estado y próxima puerta

- Implementación original PR #15 integrada en main; CI PR #90 y post-merge #91 PASS.
- Reconciliación adicional de cobertura automatizada PR #40 integrada; CI #172 y post-merge #173 PASS. Los 25 escenarios Playwright incluyen vínculos directos y por Submeta, filtro de Meta padre, retirada/restauración sin duplicados y visualización de estados Pendiente/Bloqueada en tarjetas de Meta y Submeta.
- **Aceptación manual: PENDING**, no se infiere PASS de la revisión general favorable previa. Los cinco pasos siguen siendo:
  1. En Más → Tareas, vincular una tarea a una Meta y también a una Submeta.
  2. Filtrar por esa Meta y por esa Submeta y comprobar los resultados.
  3. Vincular otra tarea únicamente a una Submeta y verificar que aparece al filtrar por su Meta principal.
  4. Desvincular la relación directa con la Meta y restaurarla desde el mismo diálogo; comprobar que no se crea otra relación.
  5. En Objetivos → Metas y Submetas, comprobar las tareas contribuyentes y sus estados.
- No se han hecho escrituras reales de QA para Lote 11 ni se ha ampliado el smoke live a relaciones Goal/Subgoal. No añadir pruebas que escriban nuevas relaciones reales sin diseñar antes canarios reversibles y una ejecución manualmente autorizada.
- Próxima acción: completar la sesión manual del Lote 11 en la aplicación autenticada/local y registrar PASS solo tras confirmación explícita. No repetir Lote 10 ni alterar canarios para conseguirlo.

### Fase 0 — registro consolidado

- Lote 10: automatización mock PASS + smoke autenticado real PASS; aceptación manual PENDING.
- Lote 11: automatización mock PASS; aceptación manual PENDING.
- Inbox review/archive y ciclo base de Proyectos/modales: automatización PASS; aceptación manual PENDING.
- Auth real y perfil: PASS dentro del alcance acotado del smoke; preferencias y cuenta más amplias pendientes de reconciliación.
- Android/iOS físico y PWA: NOT RUN; confirmar si forman parte del alcance obligatorio.
- **Fase 0 permanece OPEN.** No cerrar hasta completar o aplazar expresamente cada puerta humana obligatoria.

## UX checkpoint — creación de Notas/Ideas y Listas en diálogos (21/11/2026)

- Solicitud: retirar los formularios de creación permanentes ubicados debajo/al lado del contenido en **Más → Notas e ideas** y **Más → Listas**.
- Nueva experiencia: botón superior **Nueva nota o idea** y **Nueva lista**, respectivamente; cada botón abre un diálogo flotante con el formulario correspondiente, siguiendo el patrón usado por Nueva Tarea/Nuevo Proyecto.
- Los diálogos se pueden cerrar con Escape, el botón X, Cancelar y clic en el fondo; al cerrar se descarta el borrador y al guardar se cierran después de que Supabase confirma el INSERT.
- Se conservan las validaciones, campos, mensajes de éxito, propietario/creador, UUIDv7 y las operaciones existentes de inserción. No se cambian tablas, columnas, permisos/RLS, datos, autenticación o PWA.
- Se agregan escenarios Playwright para verificar formulario cerrado por defecto, apertura desde el botón superior, cancelación/cierre, limpieza del borrador y creación correcta de una idea y una lista.
- La nueva aceptación manual en localhost queda pendiente hasta que Robert instale y pruebe esta versión. La validación en Android físico continúa fuera del alcance de esta sesión local y no es requisito para este cambio.

## Manual acceptance — floating creation dialogs for Notes/Ideas and Lists (21 Nov 2026)

- Robert tested the PR #52 implementation on localhost and confirmed it worked correctly.
- **MANUAL PASS** is recorded specifically for:
  - More → Notes and Ideas: top-level button and floating create dialog.
  - More → Lists: top-level button and floating create dialog.
- PR #52 MERGED: https://github.com/SimpleLife9/simplelife/pull/52.
- PR CI #204 PASS: https://github.com/SimpleLife9/simplelife/actions/runs/44919008049.
- Post-merge CI #205 PASS on exact main SHA `67b43af031c96255a8140624360cd018dbd9f212`: https://github.com/SimpleLife9/simplelife/actions/runs/44919148928.
- Scope is limited to the two create-dialog UX changes; this does not imply manual acceptance of all Notes/Ideas or Lists lifecycle flows, Lote 10/11, Inbox, Projects, or account/preferences.
- Physical Android/iOS validation is not required for this localhost UI change and remains separately scoped.

## Roadmap reconciliation — master vision and Anexo 141 (21 Nov 2026)

- The master vision contains 141 annexes spanning product decisions, functional contracts, conceptual/physical models, and implementation evidence. They are not 141 independent features and do not imply implementation.
- The technical roadmap organizes work as Phase 0 plus Phases 1–10. Phase 0 stabilizes the current product and closes its validation gates; Phase 1 begins with Agenda.
- Phase 1 Agenda remains DESIGNED / OPEN DESIGN DECISIONS, not implemented. The recorded Supabase development audit found no event/calendar/protected-time domain yet.
- Future product capabilities still to build: Agenda/events/recurrence/protected time; voice/AI universal Inbox; ARIA planner and replanning; habits and training; Skill Tree/dependencies; statistics and Life Pressure; shared spaces/permissions/requests; read-only BattleCruiser/CuevaCoin integrations; offline/notifications/native mobile reliability; and the longer-term Digitalización Vital horizon.
- Phase 0 manual gates still open: exhaustive Lote 10 and Lote 11 acceptance; separate Inbox review/archive acceptance; Projects/base creation modal lifecycle; account/profile/preferences reconciliation; and decision on physical Android/iOS scope. The real authenticated Task/Note/List/ListItem smoke and Lote 10 live smoke are PASS within their bounded scopes and should not be repeated.
- Previously manually confirmed lots not to repeat absent a regression: Lote 5, Lote 6, Lote 7 navigation/destinations (distinct from Inbox review/archive), Lote 8, Lote 9, Lote 12 and Lote 13.
- Next product objective: Phase 0 closeout, resolving or explicitly deferring remaining human gates. Then begin Phase 1 using `docs/PHASE_1_AGENDA_SPEC.md`; settle its open decisions before creating migrations.


## Phase 0 closeout — approved with accepted deferrals (21/11/2026)

**Decision:** Robert explicitly instructed to close Phase 0. The phase transition is approved with the unresolved human-validation items below formally deferred. This decision does not convert any pending check into MANUAL PASS.

**Status:** CLOSED — ACCEPTED DEFERRALS. Closure is a scope/phase decision, not a claim that every listed workflow has passed manual testing. The documentation PR and exact-SHA CI remain part of the normal technical closeout.

### Evidence retained as PASS

- PR #52 Notes/Ideas and Lists floating create dialogs: merged at `67b43af031c96255a8140624360cd018dbd9f212`; Robert confirmed the two requested localhost flows work. CI #204 and post-merge CI #205 PASS.
- PR #53 roadmap/evidence reconciliation: merged at `c9907827b0a1ad561260d60e0e6e503136bc105c`; PR CI #206 PASS: https://github.com/SimpleLife9/simplelife/actions/runs/44928036552. Post-merge CI #207 on this exact SHA was still IN_PROGRESS when this closeout record was prepared: https://github.com/SimpleLife9/simplelife/actions/runs/44929798861.
- Authenticated real Supabase Auth/profile bootstrap and Task/Note/List/ListItem CRUD + reload persistence: PASS for the bounded live smoke #6 scenario. This is not comprehensive account/preferences or RLS-isolation certification.
- Lote 10 real live smoke #9: PASS for its automated task lifecycle and canary audit, including completed-task metadata and archived canaries: https://github.com/SimpleLife9/simplelife/actions/runs/44906906069. The separate exhaustive manual checklist remains deferred.
- Prior recorded manual PASS remains valid for Lotes 5, 6, 7 destination navigation, 8, 9, 12 and 13. Inbox review/archive is separate from Lote 7 navigation.
- Mocked automated coverage for Lotes 10/11 and the existing project/Inbox lifecycle remains PASS only within the scenarios covered by tests.

### Human-validation items explicitly deferred (not PASS)

1. **Lote 10 manual acceptance:** full localhost checklist for individual state changes, archive/restore, bulk archive, preservation of completed-task metadata and duration-estimate clarity.
2. **Lote 11 manual acceptance:** five real-user checks for Goal/Subgoal linking, filters, parent Goal inclusion, unlink/restore without duplicates and contributor status display. No new live QA relation writes are authorized by this closeout.
3. **Inbox review/archive:** one authenticated real-user pass for review/unreview, search and archive/restore, separate from already accepted destination navigation.
4. **Projects base lifecycle/modals:** real-user pass for create/edit/filter/archive/restore and modal create/cancel.
5. **Account/profile/preferences:** broader reconciliation beyond the bounded Auth/profile bootstrap. No assumption that all profile preferences or account recovery flows are complete.
6. **Physical Android/iOS and platform-specific PWA behavior:** not run; moved to the dedicated mobile/operational validation scope in Phase 9 unless a platform-specific defect blocks an earlier feature.

These deferrals are accepted to permit Phase 1 design/build work to begin. They remain visible as deferred acceptance debt and must be revisited before any dependent capability, before public/production release, or sooner if a regression, data-integrity issue, authorization/RLS concern or user-facing blocker appears. They must never be reported as PASS without fresh evidence.

### Phase 1 entry conditions

- Phase 1 Agenda may begin from `docs/PHASE_1_AGENDA_SPEC.md`.
- Before any Agenda schema migration, settle the open contracts: event categories and links to tasks/goals/projects; recurrence and series-edit scope; timezone/DST and timezone-change behavior; one-off/weekly protected blocks and hard/flexible semantics; events spanning midnight; task scheduling into slots; cancellation/history/audit; and reminder guarantees by platform.
- No schema migration, production deployment, secret change or broad permission change is included in this Phase 0 closeout.
- Reopen Phase 0 only for a regression or evidence that one of its accepted deferrals is a prerequisite/blocker for the next capability or release.



## Phase 1 kickoff — Agenda contract reconciliation (21/11/2026)

- Phase 0 is fully closed as **CLOSED — ACCEPTED DEFERRALS**. PR #54 MERGED at `207ce9388f1fb192254b9212dffe9f9df273187e`; CI #208 PASS and post-merge CI #209 PASS on the exact main SHA: https://github.com/SimpleLife9/simplelife/actions/runs/44930081462.
- Robert authorized continuing with Phase 1 — Agenda and time management.
- Recovered approved product contracts from ChatBending Master Anexos 5, 49, 61, 64, 69, 70, 71, 76, 77, 80, 82 and 85. The day/week/month calendar, Event/Task/TaskSchedule/Request distinctions, protected-time rules, event states, task-schedule states, recurrence exception scopes, IANA time semantics and DST gap/fold behavior are approved product rules.
- PR #55 is being prepared as a documentation/contract reconciliation: the old Agenda spec is being changed from PRODUCT/OPEN DESIGN DECISIONS to PRODUCT CONTRACT APPROVED / TECHNICAL IMPLEMENTATION IN PROGRESS; a new data/security/verification contract is being added.
- Read-only audit of `Simplelife_dev` (PostgreSQL 17.12): 17 public tables, 17/17 with RLS. Existing `task.due_date`, `due_at` and `time_zone` remain task deadline/instant semantics, not an Event or TaskSchedule. `user_preference.time_zone` already exists (default `America/Havana`). No event, protected-time or task-schedule domain is present.
- **Migration-source blocker:** the hosted project records six applied migrations (`20261119124048`, `20261119124130`, `20261119124200`, `20261119132044`, `20261119132635`, `20261119133009`), but the GitHub main tree has no `supabase/migrations/` directory. Until those migration sources or a verified replayable baseline are restored to version control, do not apply Agenda DDL or use a direct hosted migration as a substitute. No database writes/DDL/RLS/grant changes were performed during this audit.
- Other design guardrails: event overlap is a visible warning, not a global prohibition; timed intervals use half-open `[start,end)`; all-day events are calendar date ranges, not UTC midnight instants; EventParticipant/Request workflow remains Phase 7; automatic ARIA planning remains Phase 3; guaranteed notifications/offline reliability remain Phase 9.
- Current Phase 1 state: product contract reconciliation in progress; technical data/security design documented as proposal; **Agenda is NOT IMPLEMENTED**.
- Next execution: merge the contract-reconciliation PR after CI PASS; reconcile the repository migration baseline; then implement timezone-safe domain primitives and the first usable persisted Event vertical slice with RLS, real-auth smoke, rollback and exact-SHA CI.


## Supabase migration source recovery — Phase 1 prerequisite (21/11/2026)

- Recovered the six historic migration SQL bodies read-only from `supabase_migrations.schema_migrations` in `Simplelife_dev` (`iybnjrnysiikbtokyshg`, PostgreSQL 17.12).
- Added the exact forward SQL bodies to conventional versioned files under `supabase/migrations/`. All six files were read back from the branch and compared character-for-character with their remote `statements[1]` values: 6/6 EXACT MATCH.
- Added a minimal `supabase/config.toml` with local CLI project identifier `simplelife` and Postgres major version 17; no connection credentials are stored.
- Important: remote `rollback` was NULL for all six historical migrations. The recovery restores forward source only; it does not fabricate reverse SQL.
- Recovery record: `docs/SUPABASE_MIGRATION_BASELINE_RECOVERY.md`.
- Current state: baseline source recovery PR is being prepared. No SQL was executed, no DDL/data/RLS/grants/Auth/secrets were changed, and no deployment occurred.
- Before any new Agenda DDL: run the Supabase CLI migration-list/status comparison in read-only mode against the linked dev project; confirm the six local files reconcile with the six remote applied versions. New Agenda migrations require an explicit, reviewed rollback/compensation plan.
