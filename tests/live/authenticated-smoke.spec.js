import { test, expect } from '@playwright/test';

const email = process.env.SIMPLELIFE_QA_EMAIL;
const password = process.env.SIMPLELIFE_QA_PASSWORD;

const TASK_TITLE = '__SIMPLELIFE_QA_SMOKE_TASK__';
const NOTE_TITLE = '__SIMPLELIFE_QA_SMOKE_NOTE__';
const NOTE_CONTENT = 'Registro canario de QA. Se archiva y reutiliza; no contiene datos personales.';
const LIST_TITLE = '__SIMPLELIFE_QA_SMOKE_LIST__';
const LIST_PURPOSE = 'Lista técnica estable para verificar persistencia de QA.';
const ITEM_CONTENT = '__SIMPLELIFE_QA_SMOKE_ITEM__';

async function openMoreTab(page, tabName) {
  const primaryNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
  const moreButton = primaryNavigation.getByRole('button', { name: /Más$/ });
  await expect(moreButton).toHaveCount(1);
  await expect(moreButton).toBeVisible();
  await moreButton.click();

  const moreNavigation = page.getByRole('navigation', { name: 'Secciones de Más' });
  await moreNavigation.getByRole('button', { name: tabName, exact: true }).click();
}

async function waitForPageData(page) {
  // Data controls remain visible while useRows is resolving; wait before
  // searching or creating so a slow first fetch cannot create duplicate canaries.
  await expect(page.locator('.content-main').getByText('Cargando…')).toHaveCount(0, { timeout: 15000 });
}

test('real authenticated Supabase smoke: task, note, list item and persistence', async ({ page }) => {
  test.skip(!email || !password, 'Set SIMPLELIFE_QA_EMAIL and SIMPLELIFE_QA_PASSWORD for the opt-in live smoke.');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vuelve a enfocarte.', exact: true })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);

  // AuthScreen adds a trailing arrow to the submit button's accessible name.
  const signInButton = page.getByRole('button', { name: /^Iniciar sesión/ });
  await expect(signInButton).toBeVisible();
  await expect(signInButton).toBeEnabled();
  await signInButton.click();

  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();

  // TASK: restore the stable QA task if needed, change its state, reload and archive it.
  await openMoreTab(page, 'Tareas');
  await waitForPageData(page);
  // Prefer the active canary. Archived historical canaries stay out of the edit flow.
  await page.getByLabel('Filtrar por estado').selectOption('all');
  await page.getByLabel('Filtrar por archivo').selectOption('active');
  await page.getByLabel('Buscar tareas').fill(TASK_TITLE);

  let taskRow = page.locator('.task-row').filter({ hasText: TASK_TITLE });
  if (await taskRow.count() === 0) {
    await page.getByLabel('Filtrar por archivo').selectOption('archived');
    const archivedTaskRow = page.locator('.task-row').filter({ hasText: TASK_TITLE }).first();
    if (await archivedTaskRow.count()) {
      await archivedTaskRow.getByRole('button', { name: `Restaurar tarea: ${TASK_TITLE}` }).click();
      await expect(page.getByText('Tarea restaurada.')).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Nueva Tarea' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nueva tarea' });
      await dialog.getByLabel('¿Qué necesitas hacer?').fill(TASK_TITLE);
      await dialog.getByLabel('Prioridad').selectOption('4');
      await dialog.getByRole('button', { name: 'Añadir tarea' }).click();
      await expect(page.getByText('Tarea creada.')).toBeVisible();
    }
    await page.getByLabel('Filtrar por archivo').selectOption('active');
  }

  taskRow = page.locator('.task-row').filter({ hasText: TASK_TITLE }).first();
  await expect(taskRow).toBeVisible();
  const reopen = taskRow.getByRole('button', { name: `Reabrir tarea: ${TASK_TITLE}` });
  if (await reopen.count()) {
    await reopen.click();
    await expect(page.getByText('Tarea reabierta.')).toBeVisible();
  }
  const taskStatus = taskRow.getByLabel(`Cambiar estado: ${TASK_TITLE}`);
  await expect(taskStatus).toBeVisible();
  await taskStatus.selectOption('in_progress');
  await expect(taskStatus).toHaveValue('in_progress');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Tareas');
  await waitForPageData(page);
  await page.getByLabel('Filtrar por estado').selectOption('all');
  await page.getByLabel('Filtrar por archivo').selectOption('active');
  await page.getByLabel('Buscar tareas').fill(TASK_TITLE);
  taskRow = page.locator('.task-row').filter({ hasText: TASK_TITLE }).first();
  await expect(taskRow).toBeVisible();
  await expect(taskRow.getByLabel(`Cambiar estado: ${TASK_TITLE}`)).toHaveValue('in_progress');
  await taskRow.getByRole('button', { name: `Archivar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea archivada.')).toBeVisible();

  // NOTE: create or restore the stable note, edit it, reload and archive it.
  await page.getByRole('button', { name: 'Notas e ideas', exact: true }).click();
  await waitForPageData(page);
  await page.getByLabel('Filtrar por archivo').selectOption('active');
  await page.getByLabel('Buscar notas e ideas').fill(NOTE_TITLE);
  let noteCard = page.locator('.note-card').filter({ has: page.getByRole('heading', { name: NOTE_TITLE, exact: true }) });

  if (await noteCard.count() === 0) {
    await page.getByLabel('Filtrar por archivo').selectOption('archived');
    const archivedNoteCard = page.locator('.note-card').filter({ has: page.getByRole('heading', { name: NOTE_TITLE, exact: true }) }).first();
    if (await archivedNoteCard.count()) {
      await archivedNoteCard.getByRole('button', { name: `Restaurar nota: ${NOTE_TITLE}` }).click();
      await expect(page.getByText('Nota restaurada.')).toBeVisible();
    } else {
      await page.getByLabel('Filtrar por archivo').selectOption('active');
      await page.locator('.content-side').getByLabel('Título (opcional)').fill(NOTE_TITLE);
      await page.locator('.content-side').getByLabel('Contenido').fill(NOTE_CONTENT);
      await page.locator('.content-side').getByRole('button', { name: /Guardar/ }).click();
      await expect(page.getByText('Nota guardada.')).toBeVisible();
    }
    await page.getByLabel('Filtrar por archivo').selectOption('active');
  }

  noteCard = page.locator('.note-card').filter({ has: page.getByRole('heading', { name: NOTE_TITLE, exact: true }) }).first();
  await expect(noteCard).toBeVisible();
  await noteCard.getByRole('button', { name: `Editar nota: ${NOTE_TITLE}` }).click();
  const noteEditor = page.getByRole('dialog', { name: 'Editar nota o idea' });
  await noteEditor.getByLabel('Título (opcional)').fill(NOTE_TITLE);
  await noteEditor.getByLabel('Contenido').fill(NOTE_CONTENT);
  await noteEditor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Nota actualizada.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Notas e ideas');
  await waitForPageData(page);
  await page.getByLabel('Filtrar por archivo').selectOption('active');
  await page.getByLabel('Buscar notas e ideas').fill(NOTE_TITLE);
  noteCard = page.locator('.note-card').filter({ has: page.getByRole('heading', { name: NOTE_TITLE, exact: true }) }).first();
  await expect(noteCard).toBeVisible();
  await expect(noteCard).toContainText(NOTE_CONTENT);
  await noteCard.getByRole('button', { name: `Archivar nota: ${NOTE_TITLE}` }).click();
  await expect(page.getByText('Nota archivada.')).toBeVisible();

  // LIST: reuse one stable list/item, check it, reload to prove persistence, then archive the list.
  await page.getByRole('button', { name: 'Listas', exact: true }).click();
  await waitForPageData(page);
  await page.getByLabel('Filtrar listas por archivo').selectOption('active');
  await page.getByLabel('Buscar listas').fill(LIST_TITLE);
  let listCard = page.locator('.list-card').filter({ has: page.getByRole('heading', { name: LIST_TITLE, exact: true }) }).first();

  if (await listCard.count() === 0) {
    await page.getByLabel('Filtrar listas por archivo').selectOption('archived');
    const archivedListCard = page.locator('.list-card').filter({ has: page.getByRole('heading', { name: LIST_TITLE, exact: true }) }).first();
    if (await archivedListCard.count()) {
      await archivedListCard.getByRole('button', { name: `Restaurar lista: ${LIST_TITLE}` }).click();
      await expect(page.getByText('Lista restaurada.')).toBeVisible();
    } else {
      await page.getByLabel('Filtrar listas por archivo').selectOption('active');
      await page.locator('.content-side').getByLabel('Nombre de la lista').fill(LIST_TITLE);
      await page.locator('.content-side').getByLabel('Propósito (opcional)').fill(LIST_PURPOSE);
      await page.locator('.content-side').getByRole('button', { name: /Crear lista/ }).click();
      await expect(page.getByText('Lista creada.')).toBeVisible();
    }
    await page.getByLabel('Filtrar listas por archivo').selectOption('active');
  }

  listCard = page.locator('.list-card').filter({ has: page.getByRole('heading', { name: LIST_TITLE, exact: true }) }).first();
  await expect(listCard).toBeVisible();
  let itemRow = listCard.locator('.list-item-wrap').filter({ hasText: ITEM_CONTENT });
  if (await itemRow.count() === 0) {
    const addItem = listCard.locator('input[placeholder="Añadir elemento…"]');
    await addItem.fill(ITEM_CONTENT);
    await addItem.press('Enter');
    await expect(itemRow).toBeVisible();
  }

  itemRow = listCard.locator('.list-item-wrap').filter({ hasText: ITEM_CONTENT });
  await itemRow.first().getByRole('button', { name: `Editar elemento: ${ITEM_CONTENT}` }).click();
  const itemEditor = page.getByRole('dialog', { name: 'Editar elemento' });
  await itemEditor.getByLabel('Contenido del elemento').fill(ITEM_CONTENT);
  await itemEditor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Elemento actualizado.')).toBeVisible();
  await waitForPageData(page);

  itemRow = listCard.locator('.list-item-wrap').filter({ hasText: ITEM_CONTENT });
  const itemCheckbox = itemRow.first().locator('input[type="checkbox"]');
  if (!(await itemCheckbox.isChecked())) {
    // This is a controlled React checkbox. Click once, then wait for the
    // Supabase-backed refresh instead of Playwright's immediate check() assertion.
    await itemCheckbox.click();
    await expect(itemCheckbox).toBeChecked({ timeout: 15000 });
  }
  await expect(itemCheckbox).toBeChecked({ timeout: 15000 });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Listas');
  await waitForPageData(page);
  await page.getByLabel('Filtrar listas por archivo').selectOption('active');
  await page.getByLabel('Buscar listas').fill(LIST_TITLE);
  listCard = page.locator('.list-card').filter({ has: page.getByRole('heading', { name: LIST_TITLE, exact: true }) }).first();
  await expect(listCard).toBeVisible();
  itemRow = listCard.locator('.list-item-wrap').filter({ hasText: ITEM_CONTENT }).first();
  await expect(itemRow.locator('input[type="checkbox"]')).toBeChecked();

  await listCard.getByRole('button', { name: `Archivar lista: ${LIST_TITLE}` }).click();
  await expect(page.getByText('Lista archivada.')).toBeVisible();
});

test('real authenticated Supabase smoke: Lote 10 task lifecycle and completion metadata', async ({ page }) => {
  test.skip(!email || !password, 'Set SIMPLELIFE_QA_EMAIL and SIMPLELIFE_QA_PASSWORD for the opt-in live smoke.');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vuelve a enfocarte.', exact: true })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  const signInButton = page.getByRole('button', { name: /^Iniciar sesión/ });
  await expect(signInButton).toBeVisible();
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();

  await openMoreTab(page, 'Tareas');
  await waitForPageData(page);
  const statusFilter = page.getByLabel('Filtrar por estado');
  const archiveFilter = page.getByLabel('Filtrar por archivo');
  const search = page.getByLabel('Buscar tareas');
  const taskRows = page.locator('.task-row').filter({ hasText: TASK_TITLE });

  await statusFilter.selectOption('all');
  await archiveFilter.selectOption('all');
  await search.fill(TASK_TITLE);
  await expect(taskRows).toHaveCount(3);

  // Reuse exactly the three existing task canaries. Recover any interrupted
  // prior attempt by restoring archived rows; never seed or delete canaries.
  await archiveFilter.selectOption('archived');
  let archivedRows = page.locator('.task-row').filter({ hasText: TASK_TITLE });
  while (await archivedRows.count()) {
    await archivedRows.first().getByRole('button', { name: `Restaurar tarea: ${TASK_TITLE}` }).click();
    await expect(page.getByText('Tarea restaurada.', { exact: true })).toBeVisible();
    await waitForPageData(page);
  }
  await archiveFilter.selectOption('active');
  await expect(taskRows).toHaveCount(3);

  // If a previous interrupted attempt left a completed canary active, reopen
  // that QA record before repeating the lifecycle from a known open state.
  let completedRows = taskRows.filter({ hasText: 'Completada' });
  while (await completedRows.count()) {
    await completedRows.first().getByRole('button', { name: `Reabrir tarea: ${TASK_TITLE}` }).click();
    await expect(page.getByText('Tarea reabierta.', { exact: true })).toBeVisible();
    await waitForPageData(page);
  }
  await expect(taskRows).toHaveCount(3);

  // The duration estimate is planning information, not a running timer.
  await page.getByRole('button', { name: 'Nueva Tarea' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Nueva tarea' });
  await expect(createDialog.locator('.task-estimate-help')).toContainText('no inicia un temporizador');
  await createDialog.getByRole('button', { name: 'Cerrar nueva tarea' }).click();

  let firstRow = taskRows.first();
  await firstRow.getByRole('button', { name: `Editar tarea: ${TASK_TITLE}` }).click();
  const editDialog = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(editDialog.locator('.task-estimate-help')).toContainText('no inicia un temporizador');
  await editDialog.getByRole('button', { name: 'Cerrar edición' }).click();
  await expect(taskRows).toHaveCount(3);

  // Exercise Pendiente → En curso → Bloqueada → Pendiente on the same canary.
  const firstStatus = () => taskRows.first().getByLabel(`Cambiar estado: ${TASK_TITLE}`);
  await firstStatus().selectOption('todo');
  await expect(page.getByText('Estado actualizado: Pendiente.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await expect(firstStatus()).toHaveValue('todo');

  await firstStatus().selectOption('in_progress');
  await expect(page.getByText('Estado actualizado: En curso.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await expect(firstStatus()).toHaveValue('in_progress');

  await firstStatus().selectOption('blocked');
  await expect(page.getByText('Estado actualizado: Bloqueada.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await expect(firstStatus()).toHaveValue('blocked');

  await firstStatus().selectOption('todo');
  await expect(page.getByText('Estado actualizado: Pendiente.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await expect(firstStatus()).toHaveValue('todo');

  // Reload confirms that the work status is actually persisted.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Tareas');
  await waitForPageData(page);
  await statusFilter.selectOption('all');
  await archiveFilter.selectOption('active');
  await search.fill(TASK_TITLE);
  await expect(taskRows).toHaveCount(3);
  await expect(firstStatus()).toHaveValue('todo');

  // Individual archive/restore must preserve the existing work status.
  firstRow = taskRows.first();
  await firstRow.getByRole('button', { name: `Archivar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea archivada.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await archiveFilter.selectOption('archived');
  archivedRows = page.locator('.task-row').filter({ hasText: TASK_TITLE });
  await expect(archivedRows).toHaveCount(1);
  await archivedRows.first().getByRole('button', { name: `Restaurar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea restaurada.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await archiveFilter.selectOption('active');
  await expect(taskRows).toHaveCount(3);
  await expect(firstStatus()).toHaveValue('todo');

  // Prepare two different open states, then archive both in one bulk operation.
  await taskRows.nth(1).getByLabel(`Cambiar estado: ${TASK_TITLE}`).selectOption('blocked');
  await expect(page.getByText('Estado actualizado: Bloqueada.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await taskRows.nth(0).locator('input.task-select-checkbox').check();
  await taskRows.nth(1).locator('input.task-select-checkbox').check();
  await page.getByRole('button', { name: 'Archivar seleccionadas' }).click();
  await expect(page.getByText('2 tareas archivadas.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await expect(taskRows).toHaveCount(1);

  await archiveFilter.selectOption('archived');
  archivedRows = page.locator('.task-row').filter({ hasText: TASK_TITLE });
  await expect(archivedRows).toHaveCount(2);
  await expect(archivedRows).toContainText('Pendiente');
  await expect(archivedRows).toContainText('Bloqueada');

  // Complete the remaining canary, archive/restore it, and verify after reload.
  await archiveFilter.selectOption('active');
  await expect(taskRows).toHaveCount(1);
  const remainingStatus = taskRows.first().getByLabel(`Cambiar estado: ${TASK_TITLE}`);
  if (await remainingStatus.inputValue() !== 'todo') {
    await remainingStatus.selectOption('todo');
    await expect(page.getByText('Estado actualizado: Pendiente.', { exact: true })).toBeVisible();
    await waitForPageData(page);
  }
  await taskRows.first().getByRole('button', { name: `Completar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea completada.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await statusFilter.selectOption('completed');
  await expect(taskRows).toHaveCount(1);
  await taskRows.first().getByRole('button', { name: `Archivar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea archivada.', { exact: true })).toBeVisible();
  await waitForPageData(page);

  await archiveFilter.selectOption('archived');
  await expect(taskRows).toHaveCount(1);
  await taskRows.first().getByRole('button', { name: `Restaurar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea restaurada.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await archiveFilter.selectOption('active');
  await expect(taskRows).toHaveCount(1);
  await expect(taskRows.first()).toContainText('Completada');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Tareas');
  await waitForPageData(page);
  await statusFilter.selectOption('completed');
  await archiveFilter.selectOption('active');
  await search.fill(TASK_TITLE);
  await expect(taskRows).toHaveCount(1);
  await expect(taskRows.first()).toContainText('Completada');

  // Leave all three existing task canaries archived for the next smoke run.
  await taskRows.first().getByRole('button', { name: `Archivar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea archivada.', { exact: true })).toBeVisible();
  await waitForPageData(page);
  await statusFilter.selectOption('all');
  await archiveFilter.selectOption('archived');
  await expect(taskRows).toHaveCount(3);
});
