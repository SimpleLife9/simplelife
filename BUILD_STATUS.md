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
| #29 | Tasks page `src/features/tasks/TasksPage.jsx` | PR CI PENDING | Post-merge PENDING | TBD |

- The extractions from PRs #19–#28 preserve existing APIs or behavior; the existing Playwright suite remained at 19 scenarios and passed for completed PR checks.
- No new framework/dependency, schema migration, RLS/grant, auth, secret, Service Worker or deployment change was made in these batches.
- This is incremental boundary work, not a completed rewrite. `src/App.jsx` remains a legacy composition file and additional page/service extraction is still required before Phase 0 closes.
- The real authenticated Supabase browser test and physical-device validation remain open; mocked E2E is not evidence of real persistence.
