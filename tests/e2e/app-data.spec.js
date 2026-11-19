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
      await json(200, []);
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      insertedTasks.push(...rows);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      await json(200, []);
      return;
    }

    await json(404, { message: `Unexpected mocked Supabase request: ${method} ${url.pathname}` });
  });

  return insertedTasks;
}

test('authenticated task creation uses the signed-in profile and Havana timezone', async ({ page }) => {
  const insertedTasks = await mockSupabaseSession(page);
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
});
