import { test, expect } from '@playwright/test';

const projectUrl = 'https://iybnjrnysiikbtokyshg.supabase.co';
const authUser = {
  id: 'd3000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'playwright-local@example.invalid',
  email_confirmed_at: '2026-11-19T00:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-11-19T00:00:00.000Z',
  updated_at: '2026-11-19T00:00:00.000Z',
};
const profile = {
  id: '00000000-0000-7000-8000-000000000081',
  auth_user_id: authUser.id,
  display_name: 'Playwright Test',
  account_status: 'active',
  created_at: '2026-11-19T00:00:00.000Z',
  updated_at: '2026-11-19T00:00:00.000Z',
};
const preference = {
  id: '00000000-0000-7000-8000-000000000082',
  user_id: profile.id,
  time_zone: 'America/Havana',
  language: 'es',
  preferences: {},
  created_at: '2026-11-19T00:00:00.000Z',
  updated_at: '2026-11-19T00:00:00.000Z',
};

async function mockSupabaseSession(page) {
  const insertedTasks = [];
  const updatedTasks = [];
  let createdCount = 0;

  await page.route(`${projectUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    const corsHeaders = {
      'access-control-allow-origin': 'http://127.0.0.1:5173',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS, HEAD',
      'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info, prefer',
      'access-control-max-age': '86400',
    };

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
      return;
    }

    const json = async (status, body, extraHeaders = {}) => route.fulfill({
      status,
      headers: { ...corsHeaders, 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });

    if (url.pathname === '/auth/v1/token' && method === 'POST') {
      await json(200, {
        access_token: 'playwright-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'playwright-refresh-token',
        user: authUser,
      });
      return;
    }

    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      await json(200, authUser);
      return;
    }

    if (url.pathname === '/rest/v1/user_profile' && method === 'GET') {
      await json(200, profile);
      return;
    }

    if (url.pathname === '/rest/v1/user_preference' && method === 'GET') {
      await json(200, preference);
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'GET') {
      await json(200, insertedTasks);
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      insertedTasks.push(...rows.map((row) => ({
        ...row,
        created_at: new Date(Date.UTC(2026, 10, 19, 12, 0, createdCount++)).toISOString(),
      })));
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const task = insertedTasks.find((row) => idFilter === `eq.${row.id}` && ownerFilter === `eq.${row.owner_user_id}`);
      if (!task) {
        await json(200, []);
        return;
      }
      Object.assign(task, payload);
      updatedTasks.push({ ...payload });
      await json(200, [{ id: task.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      await json(200, []);
      return;
    }

    await json(404, { message: `Unexpected mocked Supabase request: ${method} ${url.pathname}` });
  });

  return { insertedTasks, updatedTasks };
}

test('mock-authenticated task creation uses the signed-in profile and Havana timezone', async ({ page }) => {
  const { insertedTasks, updatedTasks } = await mockSupabaseSession(page);
  await page.goto('/');

  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await expect(page.getByText('Playwright Test')).toBeVisible();

  await page.getByRole('button', { name: 'Más' }).click();
  await page.getByRole('button', { name: 'Tareas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible();

  await page.getByLabel('¿Qué necesitas hacer?').fill('Revisar el plan del día');
  await page.getByLabel('Prioridad').selectOption('2');
  await page.getByLabel('Fecha (opcional)').fill('2026-11-20');
  await page.getByRole('button', { name: 'Añadir tarea' }).click();

  await expect(page.getByText('Tarea creada.')).toBeVisible();
  expect(insertedTasks).toHaveLength(1);
  expect(insertedTasks[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    action: 'Revisar el plan del día',
    priority: 2,
    due_date: '2026-11-20',
    status: 'todo',
    time_zone: 'America/Havana',
  });
  expect(insertedTasks[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  await page.getByRole('button', { name: 'Editar tarea: Revisar el plan del día' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Nombre de la tarea')).toHaveValue('Revisar el plan del día');
  await editor.getByLabel('Nombre de la tarea').fill('Revisar el plan semanal');
  await editor.getByLabel('Detalles (opcional)').fill('Comprobar prioridades y fechas.');
  await editor.getByRole('combobox').selectOption('1');
  await editor.getByLabel('Fecha (opcional)').fill('2026-11-21');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByText('Tarea actualizada.')).toBeVisible();
  expect(updatedTasks).toHaveLength(1);
  expect(updatedTasks[0]).toEqual({
    action: 'Revisar el plan semanal',
    description: 'Comprobar prioridades y fechas.',
    priority: 1,
    due_date: '2026-11-21',
  });
  expect(insertedTasks[0]).toMatchObject({
    action: 'Revisar el plan semanal',
    status: 'todo',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
  });
  await expect(page.getByText('Revisar el plan semanal')).toBeVisible();

  await page.getByRole('button', { name: 'Completar tarea: Revisar el plan semanal' }).click();
  await expect(page.getByText('Tarea completada.')).toBeVisible();
  expect(insertedTasks[0]).toMatchObject({
    status: 'completed',
    completion_outcome: 'complete',
  });

  await page.getByRole('button', { name: 'Reabrir tarea: Revisar el plan semanal' }).click();
  await expect(page.getByText('Tarea reabierta.')).toBeVisible();
  expect(updatedTasks.at(-1)).toEqual({
    status: 'todo',
    completed_at: null,
    completion_outcome: null,
  });
  expect(insertedTasks[0]).toMatchObject({
    status: 'todo',
    completed_at: null,
    completion_outcome: null,
  });
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();

  // Create two more tasks to exercise search, filters and sorting as a single batch.
  await page.getByLabel('¿Qué necesitas hacer?').fill('Comprar arroz');
  await page.getByLabel('Prioridad').selectOption('4');
  await page.getByRole('button', { name: 'Añadir tarea' }).click();
  await expect(page.getByText('Tarea creada.')).toBeVisible();

  await page.getByLabel('¿Qué necesitas hacer?').fill('Preparar reunión');
  await page.getByLabel('Prioridad').selectOption('2');
  await page.getByLabel('Fecha (opcional)').fill('2026-11-20');
  await page.getByRole('button', { name: 'Añadir tarea' }).click();
  await expect(page.getByText('Tarea creada.')).toBeVisible();
  expect(insertedTasks).toHaveLength(3);

  const taskNames = page.locator('.task-list .task-row-copy strong');

  // 1) Search matches both task title and description.
  await page.getByLabel('Buscar tareas').fill('prioridades');
  await expect(page.getByText('Revisar el plan semanal', { exact: true })).toBeVisible();
  await expect(page.getByText('Comprar arroz', { exact: true })).toHaveCount(0);
  await page.getByLabel('Buscar tareas').fill('texto inexistente');
  await expect(page.getByText('No hay coincidencias')).toBeVisible();
  await page.getByLabel('Buscar tareas').fill('');

  // 2) Priority filter shows only the selected priority.
  await page.getByLabel('Filtrar por prioridad').selectOption('4');
  await expect(page.getByText('Comprar arroz', { exact: true })).toBeVisible();
  await expect(page.getByText('Revisar el plan semanal', { exact: true })).toHaveCount(0);
  await page.getByLabel('Filtrar por prioridad').selectOption('all');

  // 3) Status filter separates completed and active tasks.
  await page.getByRole('button', { name: 'Completar tarea: Revisar el plan semanal' }).click();
  await expect(page.getByText('Tarea completada.')).toBeVisible();
  await page.getByLabel('Filtrar por estado').selectOption('completed');
  await expect(page.getByText('Revisar el plan semanal', { exact: true })).toBeVisible();
  await expect(page.getByText('Comprar arroz', { exact: true })).toHaveCount(0);
  await page.getByLabel('Filtrar por estado').selectOption('all');
  await expect(page.getByText('Comprar arroz', { exact: true })).toBeVisible();

  // 4) Sorting supports priority, due date and newest first.
  await page.getByLabel('Ordenar tareas').selectOption('priority');
  await expect(taskNames).toHaveText(['Revisar el plan semanal', 'Preparar reunión', 'Comprar arroz']);
  await page.getByLabel('Ordenar tareas').selectOption('due');
  await expect(taskNames).toHaveText(['Preparar reunión', 'Revisar el plan semanal', 'Comprar arroz']);
  await page.getByLabel('Ordenar tareas').selectOption('recent');
  await expect(taskNames).toHaveText(['Preparar reunión', 'Comprar arroz', 'Revisar el plan semanal']);

  // Reopen and return to active tasks after checking the completed filter.
  await page.getByLabel('Filtrar por estado').selectOption('completed');
  await page.getByRole('button', { name: 'Reabrir tarea: Revisar el plan semanal' }).click();
  await expect(page.getByText('Tarea reabierta.')).toBeVisible();
  await page.getByLabel('Filtrar por estado').selectOption('open');
  await expect(page.getByText('Revisar el plan semanal', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Editar tarea: Revisar el plan semanal' }).click();
  const mobileEditor = page.getByRole('dialog', { name: 'Editar tarea' });
  await expect(mobileEditor).toBeVisible();
  const editorBox = await mobileEditor.boundingBox();
  expect(editorBox.width).toBeLessThanOrEqual(390);
  await mobileEditor.getByRole('button', { name: 'Cancelar' }).click();
  await expect(mobileEditor).toBeHidden();
});
