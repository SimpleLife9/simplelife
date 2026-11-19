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

async function mockSupabaseSession(page, initialData = {}) {
  const insertedTasks = [];
  const updatedTasks = [];
  const taskRows = [...(initialData.tasks || [])];
  const projects = [...(initialData.projects || [])];
  const insertedProjects = [];
  const updatedProjects = [];
  const projectLinks = [...(initialData.links || [])];
  const captures = [
    {
      id: '00000000-0000-7000-8000-000000000101',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      input_type: 'text',
      content_original: 'Llamar al proveedor antes del viernes',
      attention_status: 'needs_review',
      processing_status: 'not_started',
      sync_status: 'synced',
      captured_at: '2026-11-19T12:00:00.000Z',
      deleted_at: null,
    },
    {
      id: '00000000-0000-7000-8000-000000000102',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      input_type: 'text',
      content_original: 'Idea para mejorar el negocio',
      attention_status: 'reviewed',
      processing_status: 'not_started',
      sync_status: 'synced',
      captured_at: '2026-11-19T11:00:00.000Z',
      deleted_at: null,
    },
    {
      id: '00000000-0000-7000-8000-000000000103',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      input_type: 'text',
      content_original: 'Viaje a España en 2027',
      attention_status: 'archived',
      processing_status: 'not_started',
      sync_status: 'synced',
      captured_at: '2026-11-19T10:00:00.000Z',
      deleted_at: null,
    },
  ];
  const updatedCaptures = [];
  const insertedCaptures = [];
  const insertedCaptureParts = [];
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
      await json(200, taskRows.filter((task) => !task.deleted_at));
      return;
    }

    if (url.pathname === '/rest/v1/project' && method === 'GET') {
      await json(200, projects.filter((project) => !project.deleted_at));
      return;
    }

    if (url.pathname === '/rest/v1/project' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      projects.unshift(...rows);
      insertedProjects.push(...rows);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }

    if (url.pathname === '/rest/v1/project' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const project = projects.find((row) => idFilter === `eq.${row.id}` && ownerFilter === `eq.${row.owner_user_id}` && !row.deleted_at);
      if (!project) {
        await json(200, []);
        return;
      }
      Object.assign(project, payload);
      updatedProjects.push({ id: project.id, ...payload });
      await json(200, [{ id: project.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/task_project_link' && method === 'GET') {
      await json(200, projectLinks);
      return;
    }

    if (url.pathname === '/rest/v1/capture' && method === 'GET') {
      await json(200, captures.filter((capture) => !capture.deleted_at));
      return;
    }

    if (url.pathname === '/rest/v1/capture' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      const created = rows.map((row) => ({
        ...row,
        attention_status: row.attention_status || 'needs_review',
        processing_status: row.processing_status || 'not_started',
        sync_status: row.sync_status || 'synced',
        captured_at: row.captured_at || new Date().toISOString(),
        deleted_at: null,
      }));
      captures.unshift(...created);
      insertedCaptures.push(...created);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }

    if (url.pathname === '/rest/v1/capture' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const capture = captures.find((row) => idFilter === `eq.${row.id}` && ownerFilter === `eq.${row.owner_user_id}`);
      if (!capture) {
        await json(200, []);
        return;
      }
      Object.assign(capture, payload);
      updatedCaptures.push({ id: capture.id, ...payload });
      await json(200, [{ id: capture.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/capture_part' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      insertedCaptureParts.push(...rows);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      const createdRows = rows.map((row) => ({
        ...row,
        created_at: new Date(Date.UTC(2026, 10, 19, 12, 0, createdCount++)).toISOString(),
      }));
      insertedTasks.push(...createdRows);
      taskRows.push(...createdRows);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const task = taskRows.find((row) => idFilter === `eq.${row.id}` && ownerFilter === `eq.${row.owner_user_id}`);
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

  return { insertedTasks, updatedTasks, taskRows, projects, insertedProjects, updatedProjects, projectLinks, captures, updatedCaptures, insertedCaptures, insertedCaptureParts };
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
  await page.locator('.content-side .form-card select').first().selectOption('2');
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

  // Completed tasks are hidden in the default Active filter.
  await page.getByLabel('Filtrar por estado').selectOption('completed');
  await page.getByRole('button', { name: 'Reabrir tarea: Revisar el plan semanal' }).click();
  await expect(page.getByText('Tarea reabierta.')).toBeVisible();
  await page.getByLabel('Filtrar por estado').selectOption('open');
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
  await page.locator('.content-side .form-card select').first().selectOption('4');
  await page.getByRole('button', { name: 'Añadir tarea' }).click();
  await expect(page.getByText('Tarea creada.')).toBeVisible();

  await page.getByLabel('¿Qué necesitas hacer?').fill('Preparar reunión');
  await page.locator('.content-side .form-card select').first().selectOption('2');
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


test('Inbox supports search, review states, archiving, restore and original capture preservation', async ({ page }) => {
  const { captures, updatedCaptures, insertedCaptures, insertedCaptureParts } = await mockSupabaseSession(page);
  await page.goto('/');

  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();

  // 1) Search the original capture text and show a clear no-match state.
  await expect(page.getByText('Llamar al proveedor antes del viernes')).toBeVisible();
  await expect(page.getByText('Idea para mejorar el negocio')).toHaveCount(0);
  await page.getByLabel('Buscar capturas').fill('proveedor');
  await expect(page.getByText('Llamar al proveedor antes del viernes')).toBeVisible();
  await page.getByLabel('Buscar capturas').fill('texto que no existe');
  await expect(page.getByText('No hay coincidencias')).toBeVisible();
  await page.getByLabel('Buscar capturas').fill('');

  // 2) Filter by review lifecycle.
  await page.getByLabel('Filtrar capturas por revisión').selectOption('reviewed');
  await expect(page.getByText('Idea para mejorar el negocio')).toBeVisible();
  await expect(page.getByText('Llamar al proveedor antes del viernes')).toHaveCount(0);

  // 3) Toggle reviewed back to pending, then mark it reviewed again.
  await page.getByRole('button', { name: 'Volver a pendientes: Idea para mejorar el negocio' }).click();
  await expect(page.getByText('Captura devuelta a pendientes.')).toBeVisible();
  expect(updatedCaptures.at(-1)).toMatchObject({
    id: captures[1].id,
    attention_status: 'needs_review',
  });
  await page.getByLabel('Filtrar capturas por revisión').selectOption('needs_review');
  await page.getByRole('button', { name: 'Marcar revisada: Idea para mejorar el negocio' }).click();
  await expect(page.getByText('Captura marcada como revisada.')).toBeVisible();
  expect(updatedCaptures.at(-1)).toMatchObject({
    id: captures[1].id,
    attention_status: 'reviewed',
  });

  // 4) Archive a pending capture and restore it without changing the original text.
  await page.getByRole('button', { name: 'Archivar captura: Llamar al proveedor antes del viernes' }).click();
  await expect(page.getByText('Captura archivada.')).toBeVisible();
  expect(updatedCaptures.at(-1)).toMatchObject({
    id: captures[0].id,
    attention_status: 'archived',
  });
  expect(captures[0].content_original).toBe('Llamar al proveedor antes del viernes');
  await page.getByLabel('Filtrar capturas por revisión').selectOption('archived');
  await expect(page.getByText('Llamar al proveedor antes del viernes')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar captura: Llamar al proveedor antes del viernes' }).click();
  await expect(page.getByText('Captura devuelta a pendientes.')).toBeVisible();
  await page.getByLabel('Filtrar capturas por revisión').selectOption('needs_review');
  await expect(page.getByText('Llamar al proveedor antes del viernes')).toBeVisible();

  // Capturing a new item still preserves the exact original and its first fragment.
  const original = 'Comprar arroz para la semana';
  await page.getByPlaceholder('Escribe aquí lo que tienes en mente…').fill(original);
  await page.getByRole('button', { name: 'Guardar captura' }).click();
  await expect(page.getByText('Captura guardada.')).toBeVisible();
  expect(insertedCaptures).toHaveLength(1);
  expect(insertedCaptures[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    content_original: original,
    attention_status: 'needs_review',
  });
  expect(insertedCaptureParts).toHaveLength(1);
  expect(insertedCaptureParts[0]).toMatchObject({
    capture_id: insertedCaptures[0].id,
    part_index: 0,
    original_fragment: original,
  });
  await expect(page.getByText(original)).toBeVisible();
});


test('Projects support search, lifecycle, editing, archive, restore and linked task detail', async ({ page }) => {
  const projectA = {
    id: '00000000-0000-7000-8000-000000000701',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    name: 'Automatizar negocio',
    purpose: 'Liberar capacidad y tiempo',
    status: 'active',
    start_date: '2026-11-01',
    target_date: '2026-12-01',
    archived_at: null,
    deleted_at: null,
    created_at: '2026-11-18T12:00:00.000Z',
  };
  const projectB = {
    id: '00000000-0000-7000-8000-000000000702',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    name: 'Plan de lectura',
    purpose: 'Desarrollo personal',
    status: 'paused',
    start_date: null,
    target_date: null,
    archived_at: null,
    deleted_at: null,
    created_at: '2026-11-19T12:00:00.000Z',
  };
  const linkedTask = {
    id: '00000000-0000-7000-8000-000000000711',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    action: 'Documentar proceso de ventas',
    description: 'Dejar pasos claros para el equipo',
    status: 'in_progress',
    priority: 1,
    due_date: '2026-11-25',
    archived_at: null,
    deleted_at: null,
    created_at: '2026-11-19T09:00:00.000Z',
  };
  const link = {
    id: '00000000-0000-7000-8000-000000000721',
    task_id: linkedTask.id,
    project_id: projectA.id,
    relation_role: 'primary',
  };
  const { projects, insertedProjects, updatedProjects, taskRows, projectLinks } = await mockSupabaseSession(page, {
    projects: [projectA, projectB],
    tasks: [linkedTask],
    links: [link],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();

  await page.locator('.side-nav').getByRole('button', { name: /Proyectos/ }).click();
  await expect(page.getByRole('heading', { name: 'Proyectos', exact: true })).toBeVisible();
  const projectNames = page.locator('.project-card h3');
  await expect(projectNames).toHaveText(['Plan de lectura', 'Automatizar negocio']);

  // Search covers both project name and purpose.
  await page.getByLabel('Buscar proyectos').fill('capacidad');
  await expect(projectNames).toHaveText(['Automatizar negocio']);
  await page.getByLabel('Buscar proyectos').fill('no existe');
  await expect(page.getByText('No hay coincidencias')).toBeVisible();
  await page.getByLabel('Buscar proyectos').fill('');

  // Status filter and name sorting.
  await page.getByLabel('Filtrar proyectos por estado').selectOption('paused');
  await expect(projectNames).toHaveText(['Plan de lectura']);
  await page.getByLabel('Filtrar proyectos por estado').selectOption('all');
  await page.getByLabel('Ordenar proyectos').selectOption('name');
  await expect(projectNames).toHaveText(['Automatizar negocio', 'Plan de lectura']);
  await page.getByLabel('Ordenar proyectos').selectOption('recent');

  // The project detail exposes its existing linked tasks without duplicating them.
  await page.getByRole('button', { name: 'Ver proyecto: Automatizar negocio' }).click();
  const detail = page.getByRole('dialog', { name: 'Automatizar negocio' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Documentar proceso de ventas')).toBeVisible();
  await expect(detail.getByText('En curso', { exact: true })).toBeVisible();
  await expect(detail.locator('.project-task-summary')).toContainText(['1', '1', '0', '0']);
  await detail.getByRole('button', { name: 'Cerrar' }).click();

  // Edit all project fields and status, scoped to the signed-in owner.
  await page.getByRole('button', { name: 'Editar proyecto: Automatizar negocio' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar proyecto' });
  await editor.getByLabel('Nombre del proyecto').fill('Automatizar ventas');
  await editor.getByLabel('Propósito (opcional)').fill('Proceso operativo limpio');
  await editor.getByLabel('Fecha de inicio (opcional)').fill('2026-11-02');
  await editor.getByLabel('Fecha objetivo (opcional)').fill('2026-12-15');
  await editor.getByLabel('Estado del proyecto').selectOption('completed');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Proyecto actualizado.')).toBeVisible();
  expect(updatedProjects.at(-1)).toEqual({
    id: projectA.id,
    name: 'Automatizar ventas',
    purpose: 'Proceso operativo limpio',
    start_date: '2026-11-02',
    target_date: '2026-12-15',
    status: 'completed',
  });
  await expect(page.getByRole('button', { name: 'Ver proyecto: Automatizar ventas' })).toBeVisible();

  // Invalid date ranges are rejected before the update is sent.
  await page.getByRole('button', { name: 'Editar proyecto: Automatizar ventas' }).click();
  const invalidEditor = page.getByRole('dialog', { name: 'Editar proyecto' });
  await invalidEditor.getByLabel('Fecha de inicio (opcional)').fill('2026-12-20');
  await invalidEditor.getByLabel('Fecha objetivo (opcional)').fill('2026-12-15');
  await invalidEditor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('La fecha de inicio no puede ser posterior a la fecha objetivo.')).toBeVisible();
  expect(updatedProjects).toHaveLength(1);
  await invalidEditor.getByLabel('Fecha de inicio (opcional)').fill('2026-11-02');
  await invalidEditor.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Proyecto actualizado.')).toBeVisible();

  // Archive and restore only alter archived_at; the state and task relation survive.
  await page.getByRole('button', { name: 'Archivar proyecto: Automatizar ventas' }).click();
  await expect(page.getByText('Proyecto archivado.')).toBeVisible();
  expect(projectA.archived_at).toBeTruthy();
  expect(projectA.status).toBe('completed');
  expect(projectLinks).toHaveLength(1);
  expect(projectLinks[0]).toMatchObject({ task_id: linkedTask.id, project_id: projectA.id });
  expect(taskRows).toHaveLength(1);
  await page.getByLabel('Mostrar proyectos').selectOption('archived');
  await expect(page.getByRole('button', { name: 'Ver proyecto: Automatizar ventas' })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar proyecto: Automatizar ventas' }).click();
  await expect(page.getByText('Proyecto restaurado.')).toBeVisible();
  expect(projectA.archived_at).toBeNull();
  expect(projectA.status).toBe('completed');
  await page.getByLabel('Mostrar proyectos').selectOption('active');
  await expect(page.getByRole('button', { name: 'Ver proyecto: Automatizar ventas' })).toBeVisible();

  // Create a project with a date range.
  await page.getByLabel('Nombre').fill('Sistema SimpleLife');
  await page.getByLabel('Propósito (opcional)').fill('Organizar los próximos pasos');
  await page.getByLabel('Fecha de inicio (opcional)').fill('2026-11-20');
  await page.getByLabel('Fecha objetivo (opcional)').fill('2026-12-31');
  await page.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(page.getByText('Proyecto creado.')).toBeVisible();
  expect(insertedProjects).toHaveLength(1);
  expect(insertedProjects[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    name: 'Sistema SimpleLife',
    purpose: 'Organizar los próximos pasos',
    start_date: '2026-11-20',
    target_date: '2026-12-31',
    status: 'active',
  });
  expect(insertedProjects[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(projectLinks).toHaveLength(1);
  expect(taskRows).toHaveLength(1);
});
