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
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: tabName, exact: true }).click();
}

test('real authenticated Supabase smoke: task, note, list item and persistence', async ({ page }) => {
  test.skip(!email || !password, 'Set SIMPLELIFE_QA_EMAIL and SIMPLELIFE_QA_PASSWORD for the opt-in live smoke.');

  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();

  // TASK: restore the stable QA task if needed, change its state, reload and archive it.
  await openMoreTab(page, 'Tareas');
  await page.getByLabel('Filtrar por estado').selectOption('all');
  await page.getByLabel('Filtrar por archivo').selectOption('all');
  await page.getByLabel('Buscar tareas').fill(TASK_TITLE);

  let taskRow = page.locator('.task-row').filter({ hasText: TASK_TITLE });
  if (await taskRow.count() === 0) {
    await page.getByRole('button', { name: 'Nueva Tarea' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nueva tarea' });
    await dialog.getByLabel('¿Qué necesitas hacer?').fill(TASK_TITLE);
    await dialog.getByLabel('Prioridad').selectOption('4');
    await dialog.getByRole('button', { name: 'Añadir tarea' }).click();
    await expect(page.getByText('Tarea creada.')).toBeVisible();
  } else {
    const restore = taskRow.getByRole('button', { name: `Restaurar tarea: ${TASK_TITLE}` });
    if (await restore.count()) {
      await restore.click();
      await expect(page.getByText('Tarea restaurada.')).toBeVisible();
    }
    const reopen = taskRow.getByRole('button', { name: `Reabrir tarea: ${TASK_TITLE}` });
    if (await reopen.count()) {
      await reopen.click();
      await expect(page.getByText('Tarea reabierta.')).toBeVisible();
    }
  }

  taskRow = page.locator('.task-row').filter({ hasText: TASK_TITLE });
  const taskStatus = taskRow.getByLabel(`Cambiar estado: ${TASK_TITLE}`);
  await expect(taskStatus).toBeVisible();
  await taskStatus.selectOption('in_progress');
  await expect(taskStatus).toHaveValue('in_progress');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Tareas');
  await page.getByLabel('Filtrar por estado').selectOption('all');
  await page.getByLabel('Buscar tareas').fill(TASK_TITLE);
  taskRow = page.locator('.task-row').filter({ hasText: TASK_TITLE });
  await expect(taskRow).toBeVisible();
  await expect(taskRow.getByLabel(`Cambiar estado: ${TASK_TITLE}`)).toHaveValue('in_progress');
  await taskRow.getByRole('button', { name: `Archivar tarea: ${TASK_TITLE}` }).click();
  await expect(page.getByText('Tarea archivada.')).toBeVisible();

  // NOTE: create or restore the stable note, edit it, reload and archive it.
  await page.getByRole('button', { name: 'Notas e ideas', exact: true }).click();
  await page.getByLabel('Filtrar por archivo').selectOption('all');
  await page.getByLabel('Buscar notas e ideas').fill(NOTE_TITLE);
  let noteCard = page.locator('.note-card').filter({ has: page.getByRole('heading', { name: NOTE_TITLE, exact: true }) });

  if (await noteCard.count() === 0) {
    await page.locator('.content-side').getByLabel('Título (opcional)').fill(NOTE_TITLE);
    await page.locator('.content-side').getByLabel('Contenido').fill(NOTE_CONTENT);
    await page.locator('.content-side').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Nota guardada.')).toBeVisible();
  } else {
    const restore = noteCard.getByRole('button', { name: `Restaurar nota: ${NOTE_TITLE}` });
    if (await restore.count()) {
      await restore.click();
      await expect(page.getByText('Nota restaurada.')).toBeVisible();
    }
  }

  noteCard = page.locator('.note-card').filter({ has: page.getByRole('heading', { name: NOTE_TITLE, exact: true }) });
  await noteCard.getByRole('button', { name: `Editar nota: ${NOTE_TITLE}` }).click();
  const noteEditor = page.getByRole('dialog', { name: 'Editar nota o idea' });
  await noteEditor.getByLabel('Título (opcional)').fill(NOTE_TITLE);
  await noteEditor.getByLabel('Contenido').fill(NOTE_CONTENT);
  await noteEditor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Nota actualizada.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Notas e ideas');
  await page.getByLabel('Filtrar por archivo').selectOption('all');
  await page.getByLabel('Buscar notas e ideas').fill(NOTE_TITLE);
  noteCard = page.locator('.note-card').filter({ has: page.getByRole('heading', { name: NOTE_TITLE, exact: true }) });
  await expect(noteCard).toBeVisible();
  await expect(noteCard).toContainText(NOTE_CONTENT);
  await noteCard.getByRole('button', { name: `Archivar nota: ${NOTE_TITLE}` }).click();
  await expect(page.getByText('Nota archivada.')).toBeVisible();

  // LIST: reuse one stable list/item, check it, reload to prove persistence, then archive the list.
  await page.getByRole('button', { name: 'Listas', exact: true }).click();
  await page.getByLabel('Filtrar listas por archivo').selectOption('all');
  await page.getByLabel('Buscar listas').fill(LIST_TITLE);
  let listCard = page.locator('.list-card').filter({ has: page.getByRole('heading', { name: LIST_TITLE, exact: true }) });

  if (await listCard.count() === 0) {
    await page.locator('.content-side').getByLabel('Nombre de la lista').fill(LIST_TITLE);
    await page.locator('.content-side').getByLabel('Propósito (opcional)').fill(LIST_PURPOSE);
    await page.locator('.content-side').getByRole('button', { name: 'Crear lista', exact: true }).click();
    await expect(page.getByText('Lista creada.')).toBeVisible();
  } else {
    const restore = listCard.getByRole('button', { name: `Restaurar lista: ${LIST_TITLE}` });
    if (await restore.count()) {
      await restore.click();
      await expect(page.getByText('Lista restaurada.')).toBeVisible();
    }
  }

  listCard = page.locator('.list-card').filter({ has: page.getByRole('heading', { name: LIST_TITLE, exact: true }) });
  let itemRow = listCard.locator('.list-item').filter({ hasText: ITEM_CONTENT });
  if (await itemRow.count() === 0) {
    const addItem = listCard.locator('input[placeholder="Añadir elemento…"]');
    await addItem.fill(ITEM_CONTENT);
    await addItem.press('Enter');
    await expect(itemRow).toBeVisible();
  }

  itemRow = listCard.locator('.list-item').filter({ hasText: ITEM_CONTENT });
  await itemRow.getByRole('button', { name: `Editar elemento: ${ITEM_CONTENT}` }).click();
  const itemEditor = page.getByRole('dialog', { name: 'Editar elemento' });
  await itemEditor.getByLabel('Contenido del elemento').fill(ITEM_CONTENT);
  await itemEditor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Elemento actualizado.')).toBeVisible();

  itemRow = listCard.locator('.list-item').filter({ hasText: ITEM_CONTENT });
  const itemCheckbox = itemRow.locator('input[type="checkbox"]');
  if (!(await itemCheckbox.isChecked())) await itemCheckbox.check();
  await expect(itemCheckbox).toBeChecked();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await openMoreTab(page, 'Listas');
  await page.getByLabel('Filtrar listas por archivo').selectOption('all');
  await page.getByLabel('Buscar listas').fill(LIST_TITLE);
  listCard = page.locator('.list-card').filter({ has: page.getByRole('heading', { name: LIST_TITLE, exact: true }) });
  await expect(listCard).toBeVisible();
  itemRow = listCard.locator('.list-item').filter({ hasText: ITEM_CONTENT });
  await expect(itemRow.locator('input[type="checkbox"]')).toBeChecked();

  await listCard.getByRole('button', { name: `Archivar lista: ${LIST_TITLE}` }).click();
  await expect(page.getByText('Lista archivada.')).toBeVisible();
});
