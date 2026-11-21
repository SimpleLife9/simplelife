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
  const areas = [...(initialData.areas || [])];
  const insertedAreas = [];
  const goals = [...(initialData.goals || [])];
  const insertedGoals = [];
  const subgoals = [...(initialData.subgoals || [])];
  const insertedSubgoals = [];
  const updatedAreas = [];
  const updatedGoals = [];
  const updatedSubgoals = [];
  const updatedProjects = [];
  const projectLinks = [...(initialData.links || [])];
  const insertedProjectLinks = [];
  const updatedProjectLinks = [];
  const contributionRelations = [...(initialData.contributionRelations || [])];
  const insertedContributionRelations = [];
  const updatedContributionRelations = [];
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
  const captureParts = [...(initialData.captureParts || captures.map((capture, index) => ({
    id: '00000000-0000-7000-8000-00000000020' + (index + 1),
    capture_id: capture.id,
    part_index: 0,
    original_fragment: capture.content_original,
    interpretation: null,
    category: null,
    review_status: 'unreviewed',
  })))];
  const updatedCaptureParts = [];
  const captureLinks = [...(initialData.captureLinks || [])];
  const insertedCaptureLinks = [];
  const noteIdeas = [...(initialData.noteIdeas || [])];
  const insertedNoteIdeas = [];
  const updatedNoteIdeas = [];
  const lists = [...(initialData.lists || [])];
  const insertedLists = [];
  const updatedLists = [];
  const listItems = [...(initialData.listItems || [])];
  const insertedListItems = [];
  const updatedListItems = [];
  let createdCount = 0;
  const signedOutRequests = [];

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
    if (url.pathname === '/auth/v1/logout' && method === 'POST') {
      signedOutRequests.push({ authorization: request.headers().authorization || '' });
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
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

    if (url.pathname === '/rest/v1/life_area' && method === 'GET') {
      await json(200, areas.filter((area) => !area.deleted_at).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)));
      return;
    }
    if (url.pathname === '/rest/v1/life_area' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      areas.unshift(...rows); insertedAreas.push(...rows);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }
    if (url.pathname === '/rest/v1/life_area' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const row = areas.find((item) => idFilter === `eq.${item.id}` && ownerFilter === `eq.${item.owner_user_id}` && !item.deleted_at);
      if (!row) { await json(200, []); return; }
      Object.assign(row, payload); updatedAreas.push({ id: row.id, ...payload });
      await json(200, [{ id: row.id }], { 'content-range': '0-0/*' });
      return;
    }
    if (url.pathname === '/rest/v1/goal' && method === 'GET') {
      await json(200, goals.filter((goal) => !goal.deleted_at));
      return;
    }
    if (url.pathname === '/rest/v1/goal' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      goals.unshift(...rows); insertedGoals.push(...rows);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }
    if (url.pathname === '/rest/v1/goal' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const row = goals.find((item) => idFilter === `eq.${item.id}` && ownerFilter === `eq.${item.owner_user_id}` && !item.deleted_at);
      if (!row) { await json(200, []); return; }
      Object.assign(row, payload); updatedGoals.push({ id: row.id, ...payload });
      await json(200, [{ id: row.id }], { 'content-range': '0-0/*' });
      return;
    }
    if (url.pathname === '/rest/v1/subgoal' && method === 'GET') {
      await json(200, subgoals.filter((row) => !row.deleted_at));
      return;
    }
    if (url.pathname === '/rest/v1/subgoal' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      subgoals.unshift(...rows); insertedSubgoals.push(...rows);
      await route.fulfill({ status: 201, headers: corsHeaders, body: '' });
      return;
    }
    if (url.pathname === '/rest/v1/subgoal' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const goalFilter = url.searchParams.get('goal_id') || '';
      const row = subgoals.find((item) => idFilter === `eq.${item.id}` && goalFilter === `eq.${item.goal_id}` && !item.deleted_at);
      if (!row) { await json(200, []); return; }
      Object.assign(row, payload); updatedSubgoals.push({ id: row.id, ...payload });
      await json(200, [{ id: row.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'GET') {
      const idFilter = url.searchParams.get('id') || '';
      const statusFilter = url.searchParams.get('status') || '';
      const archivedFilter = url.searchParams.get('archived_at') || '';
      const deletedFilter = url.searchParams.get('deleted_at') || '';
      const statusEquals = statusFilter.startsWith('eq.') ? statusFilter.slice(3) : '';
      const excludedStatuses = statusFilter.startsWith('not.in.(')
        ? statusFilter.slice(8, -1).split(',')
        : [];
      const allowedStatuses = statusFilter.startsWith('in.(')
        ? statusFilter.slice(4, -1).split(',')
        : [];
      const rows = taskRows.filter((task) => !task.deleted_at
        && (!idFilter || idFilter === 'eq.' + task.id)
        && (!deletedFilter || deletedFilter !== 'is.null' || task.deleted_at == null)
        && (!archivedFilter || (archivedFilter === 'is.null' && task.archived_at == null) || (archivedFilter === 'not.is.null' && task.archived_at != null))
        && (!statusEquals || task.status === statusEquals)
        && (!excludedStatuses.length || !excludedStatuses.includes(task.status))
        && (!allowedStatuses.length || allowedStatuses.includes(task.status)));
      await json(200, rows);
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

    if (url.pathname === '/rest/v1/task_project_link' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      const duplicate = rows.some((row) => projectLinks.some((existing) => existing.task_id === row.task_id && existing.project_id === row.project_id));
      if (duplicate) { await json(409, { code: '23505', message: 'duplicate task/project link' }); return; }
      projectLinks.unshift(...rows);
      insertedProjectLinks.push(...rows);
      await json(201, rows, { 'content-range': `0-${rows.length - 1}/*` });
      return;
    }

    if (url.pathname === '/rest/v1/task_project_link' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const taskFilter = url.searchParams.get('task_id') || '';
      const roleFilter = url.searchParams.get('relation_role') || '';
      const link = projectLinks.find((row) => idFilter === 'eq.' + row.id
        && (!taskFilter || taskFilter === 'eq.' + row.task_id)
        && (!roleFilter || roleFilter === 'eq.' + row.relation_role));
      if (!link) { await json(200, []); return; }
      Object.assign(link, payload);
      updatedProjectLinks.push({ id: link.id, ...payload });
      await json(200, [{ id: link.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/contribution_relation' && method === 'GET') {
      await json(200, contributionRelations);
      return;
    }
    if (url.pathname === '/rest/v1/contribution_relation' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      contributionRelations.unshift(...rows);
      insertedContributionRelations.push(...rows);
      await json(201, rows, { 'content-range': '0-0/*' });
      return;
    }
    if (url.pathname === '/rest/v1/contribution_relation' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const projectFilter = url.searchParams.get('project_id') || '';
      const taskFilter = url.searchParams.get('task_id') || '';
      const relation = contributionRelations.find((row) => idFilter === 'eq.' + row.id
        && (projectFilter ? projectFilter === 'eq.' + row.project_id : taskFilter ? taskFilter === 'eq.' + row.task_id : true));
      if (!relation) { await json(200, []); return; }
      Object.assign(relation, payload);
      updatedContributionRelations.push({ id: relation.id, ...payload });
      await json(200, [{ id: relation.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/capture_part' && method === 'GET') {
      const idFilter = url.searchParams.get('id') || '';
      const captureFilter = url.searchParams.get('capture_id') || '';
      const rows = captureParts.filter((row) => (!idFilter || idFilter === 'eq.' + row.id) && (!captureFilter || captureFilter === 'eq.' + row.capture_id));
      await json(200, rows);
      return;
    }
    if (url.pathname === '/rest/v1/capture_part' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      captureParts.push(...rows);
      insertedCaptureParts.push(...rows);
      await json(201, rows, { 'content-range': '0-0/*' });
      return;
    }
    if (url.pathname === '/rest/v1/capture_part' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const row = captureParts.find((item) => idFilter === 'eq.' + item.id);
      if (!row) { await json(200, []); return; }
      Object.assign(row, payload);
      updatedCaptureParts.push({ id: row.id, ...payload });
      await json(200, [{ id: row.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/capture_link' && method === 'GET') {
      const idFilter = url.searchParams.get('id') || '';
      const rows = captureLinks.filter((row) => !idFilter || idFilter === 'eq.' + row.id);
      await json(200, rows);
      return;
    }
    if (url.pathname === '/rest/v1/capture_link' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      captureLinks.push(...rows);
      insertedCaptureLinks.push(...rows);
      await json(201, rows, { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/note_idea' && method === 'GET') {
      const idFilter = url.searchParams.get('id') || '';
      await json(200, noteIdeas.filter((row) => !row.deleted_at && (!idFilter || idFilter === 'eq.' + row.id)));
      return;
    }
    if (url.pathname === '/rest/v1/note_idea' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      noteIdeas.push(...rows);
      insertedNoteIdeas.push(...rows);
      await json(201, rows, { 'content-range': '0-0/*' });
      return;
    }
    if (url.pathname === '/rest/v1/note_idea' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const rows = noteIdeas.filter((row) => !row.deleted_at
        && (!idFilter || idFilter === 'eq.' + row.id)
        && (!ownerFilter || ownerFilter === 'eq.' + row.owner_user_id));
      rows.forEach((row) => Object.assign(row, payload));
      updatedNoteIdeas.push(...rows.map((row) => ({ id: row.id, ...payload })));
      await json(200, rows, { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/user_list' && method === 'GET') {
      const idFilter = url.searchParams.get('id') || '';
      const rows = lists.filter((row) => !row.deleted_at && (!idFilter || idFilter === 'eq.' + row.id));
      await json(200, rows);
      return;
    }
    if (url.pathname === '/rest/v1/user_list' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      lists.push(...rows);
      insertedLists.push(...rows);
      await json(201, rows, { 'content-range': '0-0/*' });
      return;
    }
    if (url.pathname === '/rest/v1/user_list' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const row = lists.find((list) => !list.deleted_at
        && idFilter === 'eq.' + list.id
        && (!ownerFilter || ownerFilter === 'eq.' + list.owner_user_id));
      if (!row) { await json(200, []); return; }
      Object.assign(row, payload);
      updatedLists.push({ id: row.id, ...payload });
      await json(200, [{ id: row.id }], { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/list_item' && method === 'GET') {
      const idFilter = url.searchParams.get('id') || '';
      const listFilter = url.searchParams.get('list_id') || '';
      await json(200, listItems.filter((row) => (!idFilter || idFilter === 'eq.' + row.id) && (!listFilter || listFilter === 'eq.' + row.list_id)));
      return;
    }
    if (url.pathname === '/rest/v1/list_item' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      listItems.push(...rows);
      insertedListItems.push(...rows);
      await json(201, rows, { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/list_item' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const listFilter = url.searchParams.get('list_id') || '';
      const taskFilter = url.searchParams.get('task_id') || '';
      const row = listItems.find((item) => idFilter === 'eq.' + item.id
        && listFilter === 'eq.' + item.list_id
        && (!taskFilter || (taskFilter === 'is.null' ? item.task_id == null : taskFilter === 'eq.' + item.task_id)));
      if (!row) { await json(200, []); return; }
      if (Object.hasOwn(payload, 'task_id') && row.task_id != null && row.task_id !== payload.task_id) {
        await json(200, []);
        return;
      }
      Object.assign(row, payload);
      updatedListItems.push({ id: row.id, ...payload });
      await json(200, [{ id: row.id }], { 'content-range': '0-0/*' });
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

    if (url.pathname === '/rest/v1/task' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      const createdRows = rows.map((row) => ({
        ...row,
        created_at: new Date(Date.UTC(2026, 10, 19, 12, 0, createdCount++)).toISOString(),
      }));
      insertedTasks.push(...createdRows);
      taskRows.push(...createdRows);
      await json(201, createdRows, { 'content-range': '0-0/*' });
      return;
    }

    if (url.pathname === '/rest/v1/task' && method === 'PATCH') {
      const payload = request.postDataJSON();
      const idFilter = url.searchParams.get('id') || '';
      const ownerFilter = url.searchParams.get('owner_user_id') || '';
      const statusFilter = url.searchParams.get('status') || '';
      const archiveFilter = url.searchParams.get('archived_at') || '';
      const deletedFilter = url.searchParams.get('deleted_at') || '';
      const targetIds = idFilter.startsWith('in.(')
        ? idFilter.slice(4, -1).split(',')
        : idFilter.startsWith('eq.') ? [idFilter.slice(3)] : [];
      const statusEquals = statusFilter.startsWith('eq.') ? statusFilter.slice(3) : '';
      const allowedStatuses = statusFilter.startsWith('in.(')
        ? statusFilter.slice(4, -1).split(',')
        : [];
      const matching = taskRows.filter((row) => targetIds.includes(row.id)
        && ownerFilter === `eq.${row.owner_user_id}`
        && (!statusEquals || row.status === statusEquals)
        && (!allowedStatuses.length || allowedStatuses.includes(row.status))
        && (!archiveFilter || (archiveFilter === 'is.null' && row.archived_at == null) || (archiveFilter === 'not.is.null' && row.archived_at != null))
        && (!deletedFilter || deletedFilter !== 'is.null' || row.deleted_at == null));
      if (!matching.length) {
        await json(200, []);
        return;
      }
      matching.forEach((task) => Object.assign(task, payload));
      if (idFilter.startsWith('in.(')) updatedTasks.push({ ids: matching.map((task) => task.id), ...payload });
      else updatedTasks.push({ ...payload });
      await json(200, matching.map((task) => ({ id: task.id })), { 'content-range': `0-${matching.length - 1}/*` });
      return;
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      await json(200, []);
      return;
    }

    await json(404, { message: `Unexpected mocked Supabase request: ${method} ${url.pathname}` });
  });

  return { signedOutRequests, insertedTasks, updatedTasks, updatedNoteIdeas, updatedLists, taskRows, projects, insertedProjects, updatedProjects, projectLinks, insertedProjectLinks, updatedProjectLinks, contributionRelations, insertedContributionRelations, updatedContributionRelations, areas, insertedAreas, updatedAreas, goals, insertedGoals, updatedGoals, subgoals, insertedSubgoals, updatedSubgoals, captures, updatedCaptures, insertedCaptures, captureParts, updatedCaptureParts, insertedCaptureParts, captureLinks, insertedCaptureLinks, noteIdeas, insertedNoteIdeas, lists, insertedLists, listItems, insertedListItems, updatedListItems };
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

  await expect(page.getByRole('button', { name: 'Nueva Tarea' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Nueva tarea' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nueva Tarea' }).click();
  const createTaskDialog = page.getByRole('dialog', { name: 'Nueva tarea' });
  await expect(createTaskDialog).toBeVisible();
  await createTaskDialog.getByLabel('¿Qué necesitas hacer?').fill('Revisar el plan del día');
  await createTaskDialog.getByLabel('Prioridad').selectOption('2');
  await createTaskDialog.getByLabel('Fecha (opcional)').fill('2026-11-20');
  await createTaskDialog.getByLabel('¿Cuánto tiempo crees que te llevará?').fill('90');
  await createTaskDialog.getByRole('button', { name: 'Añadir tarea' }).click();
  await expect(createTaskDialog).toBeHidden();

  await expect(page.getByText('Tarea creada.')).toBeVisible();
  expect(insertedTasks).toHaveLength(1);
  expect(insertedTasks[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    action: 'Revisar el plan del día',
    priority: 2,
    due_date: '2026-11-20',
    estimated_duration_minutes: 90,
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
  await editor.getByLabel('¿Cuánto tiempo crees que te llevará?').fill('120');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByText('Tarea actualizada.')).toBeVisible();
  expect(updatedTasks).toHaveLength(1);
  expect(updatedTasks[0]).toEqual({
    action: 'Revisar el plan semanal',
    description: 'Comprobar prioridades y fechas.',
    priority: 1,
    due_date: '2026-11-21',
    estimated_duration_minutes: 120,
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
  await expect(page.getByLabel('Cambiar estado: Revisar el plan semanal')).toHaveValue('todo');

  // Create two more tasks to exercise search, filters and sorting as a single batch.
  await page.getByRole('button', { name: 'Nueva Tarea' }).click();
  const secondTaskDialog = page.getByRole('dialog', { name: 'Nueva tarea' });
  await secondTaskDialog.getByLabel('¿Qué necesitas hacer?').fill('Comprar arroz');
  await secondTaskDialog.getByLabel('Prioridad').selectOption('4');
  await secondTaskDialog.getByRole('button', { name: 'Añadir tarea' }).click();
  await expect(secondTaskDialog).toBeHidden();
  await expect(page.getByText('Tarea creada.')).toBeVisible();

  await page.getByRole('button', { name: 'Nueva Tarea' }).click();
  const thirdTaskDialog = page.getByRole('dialog', { name: 'Nueva tarea' });
  await thirdTaskDialog.getByLabel('¿Qué necesitas hacer?').fill('Preparar reunión');
  await thirdTaskDialog.getByLabel('Prioridad').selectOption('2');
  await thirdTaskDialog.getByLabel('Fecha (opcional)').fill('2026-11-20');
  await thirdTaskDialog.getByRole('button', { name: 'Añadir tarea' }).click();
  await expect(thirdTaskDialog).toBeHidden();
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
  const goalForProject = { id: '00000000-0000-7000-8000-000000000731', owner_user_id: profile.id, created_by_user_id: profile.id, life_area_id: '00000000-0000-7000-8000-000000000730', title: 'Crear fondo de emergencia', reason: null, expected_result: 'Seis meses de gastos', target_date: null, status: 'active', deleted_at: null };
  const subgoalForProject = { id: '00000000-0000-7000-8000-000000000732', goal_id: goalForProject.id, created_by_user_id: profile.id, title: 'Ahorrar cada mes', expected_result: null, target_date: null, status: 'active', deleted_at: null };
  const { projects, insertedProjects, updatedProjects, taskRows, projectLinks, contributionRelations, insertedContributionRelations, updatedContributionRelations } = await mockSupabaseSession(page, {
    projects: [projectA, projectB],
    tasks: [linkedTask],
    links: [link],
    goals: [goalForProject],
    subgoals: [subgoalForProject],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();

  await page.locator('.side-nav').getByRole('button', { name: /Proyectos/ }).click();
  await expect(page.getByRole('heading', { name: 'Proyectos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo Proyecto' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Nuevo proyecto' })).toHaveCount(0);
  const projectNames = page.locator('.project-card h3');
  await expect(projectNames).toHaveText(['Plan de lectura', 'Automatizar negocio']);

  // Search covers both project name and purpose.
  await page.getByLabel('Buscar proyectos').fill('capacidad');
  await expect(projectNames).toHaveText(['Automatizar negocio']);
  await page.getByLabel('Buscar proyectos').fill('no existe');
  await expect(page.getByText('No hay coincidencias')).toBeVisible();
  await page.getByLabel('Buscar proyectos').fill('');

  // Status filter and name sorting.
  await page.getByLabel('Filtrar por estado de trabajo').selectOption('paused');
  await expect(projectNames).toHaveText(['Plan de lectura']);
  await page.getByLabel('Filtrar por estado de trabajo').selectOption('all');
  await page.getByLabel('Ordenar proyectos').selectOption('name');
  await expect(projectNames).toHaveText(['Automatizar negocio', 'Plan de lectura']);
  await page.getByLabel('Ordenar proyectos').selectOption('target');
  await expect(projectNames).toHaveText(['Automatizar negocio', 'Plan de lectura']);
  await page.getByLabel('Ordenar proyectos').selectOption('recent');

  // The project detail exposes its existing linked tasks without duplicating them.
  await page.getByRole('button', { name: 'Ver proyecto: Automatizar negocio' }).click();
  const detail = page.getByRole('dialog', { name: 'Automatizar negocio' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Documentar proceso de ventas')).toBeVisible();
  await expect(detail.getByText('En curso', { exact: true })).toBeVisible();
  expect(await detail.locator('.project-task-summary > div strong').allTextContents()).toEqual(['1', '1', '0', '0']);
  // Link a subgoal, remove it without deleting history, and restore the same relation.
  await expect(detail.getByText('Este proyecto todavía no está vinculado a ninguna meta o submeta.')).toBeVisible();
  await detail.getByRole('button', { name: 'Vincular meta o submeta' }).click();
  await detail.getByLabel('Seleccionar meta o submeta').selectOption('subgoal:' + subgoalForProject.id);
  await detail.getByRole('button', { name: 'Vincular relación' }).click();
  await expect(page.getByText('Submeta vinculada al proyecto.')).toBeVisible();
  await expect(detail.getByText('Ahorrar cada mes', { exact: true })).toBeVisible();
  expect(insertedContributionRelations).toHaveLength(1);
  expect(insertedContributionRelations[0]).toMatchObject({
    project_id: projectA.id, subgoal_id: subgoalForProject.id,
    relation_status: 'confirmed', created_by_user_id: profile.id,
  });
  expect(insertedContributionRelations[0]).not.toHaveProperty('goal_id');

  await detail.getByRole('button', { name: 'Desvincular submeta: Ahorrar cada mes' }).click();
  await expect(page.getByText('Submeta desvinculada del proyecto.')).toBeVisible();
  expect(updatedContributionRelations.at(-1)).toMatchObject({
    id: insertedContributionRelations[0].id, relation_status: 'removed',
  });
  expect(contributionRelations).toHaveLength(1);

  await detail.getByRole('button', { name: 'Vincular meta o submeta' }).click();
  await detail.getByLabel('Seleccionar meta o submeta').selectOption('subgoal:' + subgoalForProject.id);
  await detail.getByRole('button', { name: 'Vincular relación' }).click();
  await expect(page.getByText('Vínculo restaurado.')).toBeVisible();
  expect(insertedContributionRelations).toHaveLength(1);
  expect(updatedContributionRelations.at(-1)).toMatchObject({
    id: insertedContributionRelations[0].id, relation_status: 'confirmed',
  });

  // A project may also connect directly to its parent goal.
  await detail.getByRole('button', { name: 'Vincular meta o submeta' }).click();
  await detail.getByLabel('Seleccionar meta o submeta').selectOption('goal:' + goalForProject.id);
  await detail.getByRole('button', { name: 'Vincular relación' }).click();
  await expect(page.getByText('Meta vinculada al proyecto.')).toBeVisible();
  expect(insertedContributionRelations).toHaveLength(2);

  await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();

  // Edit all project fields and status, scoped to the signed-in owner.
  await page.getByRole('button', { name: 'Editar proyecto: Automatizar negocio' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar proyecto' });
  await editor.getByLabel('Nombre del proyecto').fill('Automatizar ventas');
  await editor.getByLabel('Propósito (opcional)').fill('Proceso operativo limpio');
  await editor.getByLabel('Fecha de inicio (opcional)').fill('2026-11-02');
  await editor.getByLabel('Fecha objetivo (opcional)').fill('2026-12-15');
  await editor.getByLabel('Estado de trabajo').selectOption('completed');
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
  await page.getByLabel('Filtrar proyectos por archivo').selectOption('archived');
  await expect(page.getByRole('button', { name: 'Ver proyecto: Automatizar ventas' })).toBeVisible();
  await expect(page.getByLabel('Filtrar por estado de trabajo')).toBeDisabled();
  const archivedProjectCard = page.locator('.project-card-archived').filter({ has: page.getByRole('heading', { name: 'Automatizar ventas' }) });
  await expect(archivedProjectCard.locator('.status-tag')).toHaveCount(1);
  await expect(archivedProjectCard.locator('.status-tag')).toHaveText('Archivado');
  await page.getByRole('button', { name: 'Restaurar proyecto: Automatizar ventas' }).click();
  await expect(page.getByText('Proyecto restaurado.')).toBeVisible();
  expect(projectA.archived_at).toBeNull();
  expect(projectA.status).toBe('completed');
  await page.getByLabel('Filtrar proyectos por archivo').selectOption('active');
  await expect(page.getByRole('button', { name: 'Ver proyecto: Automatizar ventas' })).toBeVisible();

  // Create a project only after opening the floating form.
  await page.getByRole('button', { name: 'Nuevo Proyecto' }).click();
  const createProjectDialog = page.getByRole('dialog', { name: 'Nuevo proyecto' });
  await expect(createProjectDialog).toBeVisible();
  await createProjectDialog.getByLabel('Nombre').fill('Sistema SimpleLife');
  await createProjectDialog.getByLabel('Propósito (opcional)').fill('Organizar los próximos pasos');
  await createProjectDialog.getByLabel('Fecha de inicio (opcional)').fill('2026-11-20');
  await createProjectDialog.getByLabel('Fecha objetivo (opcional)').fill('2026-12-31');
  await createProjectDialog.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(createProjectDialog).toBeHidden();
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


test('Objectives create areas and goals through separate floating forms', async ({ page }) => {
  const { areas, insertedAreas, insertedGoals } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();

  await page.locator('.side-nav').getByRole('button', { name: /Objetivos/ }).click();
  await expect(page.getByRole('heading', { name: 'Tus áreas de vida' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva Área' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva Meta', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Nueva área' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Nueva meta' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Nueva Área' }).click();
  const areaDialog = page.getByRole('dialog', { name: 'Nueva área' });
  await areaDialog.getByLabel('Nombre del área').fill('Finanzas');
  await areaDialog.getByRole('button', { name: 'Crear área' }).click();
  await expect(areaDialog).toBeHidden();
  await expect(page.getByText('Área creada.')).toBeVisible();
  expect(insertedAreas).toHaveLength(1);
  expect(insertedAreas[0]).toMatchObject({ owner_user_id: profile.id, created_by_user_id: profile.id, title: 'Finanzas' });

  await page.getByRole('button', { name: 'Metas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva Meta' })).toBeVisible();
  await page.getByRole('button', { name: 'Nueva Meta' }).click();
  const goalDialog = page.getByRole('dialog', { name: 'Nueva meta' });
  await goalDialog.getByLabel('Área de vida').selectOption({ label: 'Finanzas' });
  await goalDialog.getByLabel('Resultado que buscas').fill('Crear un fondo de emergencia');
  await goalDialog.getByLabel('Motivo (opcional)').fill('Tener estabilidad financiera');
  await goalDialog.getByLabel('Fecha objetivo (opcional)').fill('2027-06-30');
  await goalDialog.getByRole('button', { name: 'Crear meta' }).click();
  await expect(goalDialog).toBeHidden();
  await expect(page.getByText('Meta creada.')).toBeVisible();
  expect(areas).toHaveLength(1);
  expect(insertedGoals).toHaveLength(1);
  expect(insertedGoals[0]).toMatchObject({
    owner_user_id: profile.id, created_by_user_id: profile.id,
    life_area_id: insertedAreas[0].id, title: 'Crear un fondo de emergencia',
    reason: 'Tener estabilidad financiera', target_date: '2027-06-30', status: 'active',
  });
});


test('Objetivos permite editar áreas, metas y submetas, gestionar estados y crear submetas en todas las metas', async ({ page }) => {
  const area = { id: '00000000-0000-7000-8000-000000000201', owner_user_id: profile.id, created_by_user_id: profile.id, title: 'Finanzas', description: null, position: null, status: 'active', deleted_at: null };
  const secondArea = { id: '00000000-0000-7000-8000-000000000211', owner_user_id: profile.id, created_by_user_id: profile.id, title: 'Salud', description: null, position: null, status: 'active', deleted_at: null };
  const goals = Array.from({ length: 3 }, (_, index) => ({ id: `00000000-0000-7000-8000-00000000020${index + 2}`, owner_user_id: profile.id, created_by_user_id: profile.id, life_area_id: area.id, title: `Meta ${index + 1}`, reason: null, expected_result: null, target_date: null, status: 'active', deleted_at: null }));
  const subgoal = { id: '00000000-0000-7000-8000-000000000209', goal_id: goals[0].id, created_by_user_id: profile.id, title: 'Ahorrar cada mes', expected_result: null, target_date: null, status: 'active', deleted_at: null };
  const relatedProject = { id: '00000000-0000-7000-8000-000000000220', owner_user_id: profile.id, created_by_user_id: profile.id, name: 'Proyecto de ahorro', purpose: null, status: 'active', archived_at: null, deleted_at: null, created_at: '2026-11-20T12:00:00.000Z' };
  const contributionRelations = [
    { id: '00000000-0000-7000-8000-000000000221', project_id: relatedProject.id, task_id: null, goal_id: goals[0].id, subgoal_id: null, relation_status: 'confirmed', created_by_user_id: profile.id },
    { id: '00000000-0000-7000-8000-000000000222', project_id: relatedProject.id, task_id: null, goal_id: null, subgoal_id: subgoal.id, relation_status: 'confirmed', created_by_user_id: profile.id },
  ];
  const result = await mockSupabaseSession(page, { areas: [area, secondArea], goals, subgoals: [subgoal], projects: [relatedProject], contributionRelations });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Objetivos/ }).click();
  await expect(page.getByRole('heading', { name: 'Tus áreas de vida' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finanzas' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar área: Finanzas' }).click();
  const areaDialog = page.getByRole('dialog', { name: 'Editar área' });
  await areaDialog.getByLabel('Nombre del área').fill('Finanzas personales');
  await areaDialog.getByLabel('Descripción (opcional)').fill('Control y crecimiento del dinero.');
  await areaDialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Área actualizada.')).toBeVisible();
  expect(result.updatedAreas.at(-1)).toMatchObject({ title: 'Finanzas personales', description: 'Control y crecimiento del dinero.' });

  await page.getByRole('button', { name: 'Mover área abajo: Finanzas personales' }).click();
  await expect(page.getByText('Área movida hacia abajo.')).toBeVisible();
  expect(result.updatedAreas.some((update) => update.id === area.id && update.position === 1)).toBe(true);
  expect(result.updatedAreas.some((update) => update.id === secondArea.id && update.position === 0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Mover área arriba: Finanzas personales' })).toBeEnabled();

  await page.getByRole('button', { name: 'Metas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tus metas' })).toBeVisible();
  const relatedGoalCard = page.locator('.goal-record-card').filter({ has: page.getByRole('heading', { name: 'Meta 1' }) });
  await expect(relatedGoalCard.getByText('Proyecto de ahorro', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar meta: Meta 1' }).click();
  const goalDialog = page.getByRole('dialog', { name: 'Editar meta' });
  await goalDialog.getByLabel('Resultado que buscas').fill('Crear fondo de emergencia');
  await goalDialog.getByLabel('Resultado esperado (opcional)').fill('Seis meses de gastos.');
  await goalDialog.getByLabel('Motivo (opcional)').fill('Seguridad financiera.');
  await goalDialog.getByLabel('Fecha objetivo (opcional)').fill('2027-06-30');
  await goalDialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Meta actualizada.')).toBeVisible();
  expect(result.updatedGoals.at(-1)).toMatchObject({ title: 'Crear fondo de emergencia', expected_result: 'Seis meses de gastos.', reason: 'Seguridad financiera.', target_date: '2027-06-30' });

  await page.getByLabel('Estado de meta: Crear fondo de emergencia').selectOption('paused');
  await expect(page.getByText('Meta pausada.')).toBeVisible();
  await page.getByLabel('Estado de meta: Crear fondo de emergencia').selectOption('active');
  await expect(page.getByText('Meta reactivada.')).toBeVisible();

  await page.getByRole('button', { name: 'Submetas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tus submetas' })).toBeVisible();
  const relatedSubgoalCard = page.locator('.subgoal-record-card').filter({ has: page.getByRole('heading', { name: 'Ahorrar cada mes' }) });
  await expect(relatedSubgoalCard.getByText('Proyecto de ahorro', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar submeta: Ahorrar cada mes' }).click();
  const subgoalDialog = page.getByRole('dialog', { name: 'Editar submeta' });
  await subgoalDialog.getByLabel('Nombre de la submeta').fill('Ahorrar el 20% mensual');
  await subgoalDialog.getByLabel('Resultado esperado (opcional)').fill('Ahorro automático.');
  await subgoalDialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Submeta actualizada.')).toBeVisible();
  expect(result.updatedSubgoals.at(-1)).toMatchObject({ title: 'Ahorrar el 20% mensual', expected_result: 'Ahorro automático.' });
  await page.getByLabel('Estado de submeta: Ahorrar el 20% mensual').selectOption('completed');
  await expect(page.getByText('Submeta completada.')).toBeVisible();

  await page.getByRole('button', { name: 'Nueva Submeta' }).click();
  const newSubgoalDialog = page.getByRole('dialog', { name: 'Nueva submeta' });
  await newSubgoalDialog.getByLabel('Meta a la que pertenece').selectOption({ label: 'Meta 3' });
  await newSubgoalDialog.getByLabel('Nombre de la submeta').fill('Tercera meta sin límite');
  await newSubgoalDialog.getByRole('button', { name: 'Crear submeta' }).click();
  await expect(page.getByText('Submeta creada.')).toBeVisible();
  expect(result.insertedSubgoals).toHaveLength(1);
  expect(result.insertedSubgoals[0]).toMatchObject({ goal_id: goals[2].id, title: 'Tercera meta sin límite', status: 'active', created_by_user_id: profile.id });
});


test('Inbox converts a capture into a task and preserves its source link', async ({ page }) => {
  const { captures, captureParts, insertedTasks, captureLinks, insertedCaptureLinks, updatedCaptureParts, updatedCaptures } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const original = captures[0].content_original;
  await page.getByRole('button', { name: 'Organizar captura: ' + original }).click();
  await page.getByLabel('Tipo de destino').selectOption('task');
  await page.getByLabel('Título de la tarea').fill('Llamar al proveedor');
  await page.getByLabel('Prioridad de la tarea').selectOption('2');
  await page.getByLabel('Fecha objetivo').fill('2026-11-27');
  await page.getByRole('button', { name: 'Confirmar y organizar' }).click();

  await expect(page.getByText('Captura organizada como tarea.')).toBeVisible();
  expect(insertedTasks).toHaveLength(1);
  expect(insertedTasks[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    action: 'Llamar al proveedor',
    description: original,
    priority: 2,
    due_date: '2026-11-27',
    status: 'todo',
  });
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(insertedCaptureLinks[0]).toMatchObject({
    capture_part_id: captureParts[0].id,
    task_id: insertedTasks[0].id,
    link_status: 'confirmed',
  });
  expect(updatedCaptureParts.at(-1)).toMatchObject({ category: 'task', review_status: 'accepted' });
  expect(updatedCaptures.at(-1)).toMatchObject({ id: captures[0].id, attention_status: 'reviewed' });
  expect(captures[0].content_original).toBe(original);

  await page.getByLabel('Filtrar capturas por revisión').selectOption('organized');
  await expect(page.getByText('Organizada · Tarea')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Organizar captura: ' + original })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archivar captura: ' + original }).click();
  await expect(page.getByText('Organizada · Tarea · Archivada')).toBeVisible();
  expect(updatedCaptures.at(-1)).toMatchObject({ id: captures[0].id, attention_status: 'archived' });
  await page.getByRole('button', { name: 'Restaurar captura: ' + original }).click();
  expect(updatedCaptures.at(-1)).toMatchObject({ id: captures[0].id, attention_status: 'needs_review' });
  await page.getByLabel('Filtrar capturas por revisión').selectOption('organized');
  await expect(page.getByText('Organizada · Tarea')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir tareas →' }).click();
  await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible();
});

test('Inbox converts a capture into an idea without changing the original capture', async ({ page }) => {
  const { captures, insertedNoteIdeas, insertedCaptureLinks, captureParts, updatedCaptureParts } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const original = captures[1].content_original;
  await page.getByLabel('Filtrar capturas por revisión').selectOption('all');
  await page.getByRole('button', { name: 'Organizar captura: ' + original }).click();
  await page.getByLabel('Tipo de destino').selectOption('idea');
  await page.getByLabel('Título (opcional)').fill('Mejora del negocio');
  await page.getByRole('button', { name: 'Confirmar y organizar' }).click();

  await expect(page.getByText('Captura guardada como idea.')).toBeVisible();
  expect(insertedNoteIdeas).toHaveLength(1);
  expect(insertedNoteIdeas[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    kind: 'idea',
    title: 'Mejora del negocio',
    content: original,
  });
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(insertedCaptureLinks[0]).toMatchObject({
    capture_part_id: captureParts[1].id,
    note_idea_id: insertedNoteIdeas[0].id,
    link_status: 'confirmed',
  });
  expect(updatedCaptureParts.at(-1)).toMatchObject({ category: 'note_idea', review_status: 'accepted' });
  expect(captures[1].content_original).toBe(original);
  await page.getByLabel('Filtrar capturas por revisión').selectOption('organized');
  await expect(page.getByText('Organizada · Nota o idea')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir notas e ideas →' }).click();
  await expect(page.getByRole('heading', { name: 'Tu biblioteca' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mejora del negocio' })).toBeVisible();
});

test('Inbox turns a capture into a new list with its first item and provenance', async ({ page }) => {
  const { captures, insertedLists, insertedListItems, insertedCaptureLinks } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const original = captures[0].content_original;
  await page.getByRole('button', { name: 'Organizar captura: ' + original }).click();
  await page.getByLabel('Tipo de destino').selectOption('list');
  await page.getByLabel('Nombre de la nueva lista').fill('Pendientes del proveedor');
  await page.getByRole('button', { name: 'Confirmar y organizar' }).click();

  await expect(page.getByText('Captura añadida a una lista.')).toBeVisible();
  expect(insertedLists).toHaveLength(1);
  expect(insertedLists[0]).toMatchObject({ owner_user_id: profile.id, name: 'Pendientes del proveedor' });
  expect(insertedListItems).toHaveLength(1);
  expect(insertedListItems[0]).toMatchObject({
    list_id: insertedLists[0].id,
    content: original,
    is_checked: false,
  });
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(insertedCaptureLinks[0]).toMatchObject({
    capture_part_id: '00000000-0000-7000-8000-000000000201',
    list_item_id: insertedListItems[0].id,
    link_status: 'confirmed',
  });
  expect(captures[0].content_original).toBe(original);
  await page.getByLabel('Filtrar capturas por revisión').selectOption('organized');
  await page.getByRole('button', { name: 'Abrir listas →' }).click();
  await expect(page.getByRole('heading', { name: 'Tus listas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pendientes del proveedor' })).toBeVisible();
  await expect(page.getByText(original)).toBeVisible();
});

test('Inbox adds a capture to an existing list as a linked list item', async ({ page }) => {
  const existingList = {
    id: '00000000-0000-7000-8000-000000000301',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    name: 'Compras',
    status: 'active',
    archived_at: null,
    deleted_at: null,
  };
  const { captures, insertedListItems, insertedCaptureLinks } = await mockSupabaseSession(page, { lists: [existingList] });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const original = captures[0].content_original;
  await page.getByRole('button', { name: 'Organizar captura: ' + original }).click();
  await page.getByLabel('Tipo de destino').selectOption('list');
  await page.getByLabel('Acción de lista').selectOption('existing');
  await page.getByLabel('Lista existente').selectOption(existingList.id);
  await page.getByLabel('Texto del elemento').fill('Llamar al proveedor');
  await page.getByRole('button', { name: 'Confirmar y organizar' }).click();

  await expect(page.getByText('Captura añadida a una lista.')).toBeVisible();
  expect(insertedListItems).toHaveLength(1);
  expect(insertedListItems[0]).toMatchObject({ list_id: existingList.id, content: 'Llamar al proveedor' });
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(insertedCaptureLinks[0]).toMatchObject({
    capture_part_id: '00000000-0000-7000-8000-000000000201',
    list_item_id: insertedListItems[0].id,
    link_status: 'confirmed',
  });
  expect(captures[0].content_original).toBe(original);
});


test('primary navigation preserves page destinations in the authenticated shell', async ({ page }) => {
  await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  const destinations = [
    { label: 'Hoy', heading: 'Hoy' },
    { label: 'Inbox', heading: 'Inbox' },
    { label: 'Objetivos', heading: 'Objetivos' },
    { label: 'Proyectos', heading: 'Proyectos' },
    { label: 'Más', heading: 'Tareas' },
  ];

  const sideNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(sideNavigation).toBeVisible();

  for (const destination of destinations) {
    const sideButton = sideNavigation.getByRole('button', { name: new RegExp(destination.label) });
    await sideButton.click();
    await expect(page.locator('.page-heading h1')).toHaveText(destination.heading);
    await expect(sideButton).toHaveClass(/active/);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNavigation = page.getByRole('navigation', { name: 'Navegación móvil' });
  await expect(mobileNavigation).toBeVisible();

  for (const destination of destinations) {
    const mobileButton = mobileNavigation.getByRole('button', { name: new RegExp(destination.label) });
    await mobileButton.click();
    await expect(page.locator('.page-heading h1')).toHaveText(destination.heading);
    await expect(mobileButton).toHaveClass(/active/);
  }
});


test('Notes can be edited, archived and restored without losing their content', async ({ page }) => {
  const seedNotes = [
    {
      id: '00000000-0000-7000-8000-000000000701',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      kind: 'note',
      title: 'Plan de lectura',
      content: 'Leer veinte páginas antes de dormir.',
      status: 'active',
      archived_at: null,
      deleted_at: null,
      created_at: '2026-11-20T10:00:00.000Z',
    },
    {
      id: '00000000-0000-7000-8000-000000000702',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      kind: 'idea',
      title: 'Nueva cafetería',
      content: 'Probar una merienda cubana para los clientes.',
      status: 'active',
      archived_at: null,
      deleted_at: null,
      created_at: '2026-11-20T11:00:00.000Z',
    },
  ];
  const { noteIdeas, updatedNoteIdeas } = await mockSupabaseSession(page, { noteIdeas: seedNotes });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.locator('.side-nav').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('navigation', { name: 'Secciones de Más' }).getByRole('button', { name: 'Notas e ideas' }).click();
  await expect(page.getByRole('heading', { name: 'Plan de lectura' })).toBeVisible();

  await page.getByRole('button', { name: 'Editar nota: Plan de lectura' }).click();
  const editor = page.getByRole('dialog', { name: 'Editar nota o idea' });
  await editor.getByLabel('Título (opcional)').fill('Lectura diaria');
  await editor.getByLabel('Contenido').fill('Leer treinta páginas y tomar notas.');
  await editor.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByText('Nota actualizada.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lectura diaria' })).toBeVisible();
  expect(noteIdeas.find((note) => note.id === seedNotes[0].id)).toMatchObject({
    title: 'Lectura diaria',
    content: 'Leer treinta páginas y tomar notas.',
  });
  expect(updatedNoteIdeas[0]).toMatchObject({
    id: seedNotes[0].id,
    title: 'Lectura diaria',
    content: 'Leer treinta páginas y tomar notas.',
  });

  await page.getByRole('button', { name: 'Archivar nota: Lectura diaria' }).click();
  await expect(page.getByText('Nota archivada.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lectura diaria' })).toHaveCount(0);
  expect(noteIdeas.find((note) => note.id === seedNotes[0].id)).toMatchObject({ status: 'archived' });
  expect(updatedNoteIdeas[1]).toMatchObject({ id: seedNotes[0].id, status: 'archived' });

  await page.getByLabel('Filtrar por archivo').selectOption('archived');
  await expect(page.getByRole('heading', { name: 'Lectura diaria' })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar nota: Lectura diaria' }).click();
  await expect(page.getByText('Nota restaurada.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lectura diaria' })).toHaveCount(0);
  expect(noteIdeas.find((note) => note.id === seedNotes[0].id)).toMatchObject({ status: 'active', archived_at: null });
  expect(updatedNoteIdeas[2]).toMatchObject({ id: seedNotes[0].id, status: 'active', archived_at: null });

  await page.getByLabel('Filtrar por archivo').selectOption('active');
  await expect(page.getByRole('heading', { name: 'Lectura diaria' })).toBeVisible();
});


test('Notes and ideas can be searched by title or content and filtered by kind', async ({ page }) => {
  const seedNotes = [
    {
      id: '00000000-0000-7000-8000-000000000601',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      kind: 'note',
      title: 'Plan de lectura',
      content: 'Leer veinte páginas antes de dormir.',
      status: 'active',
      archived_at: null,
      deleted_at: null,
      created_at: '2026-11-20T10:00:00.000Z',
    },
    {
      id: '00000000-0000-7000-8000-000000000602',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      kind: 'idea',
      title: 'Nueva cafetería',
      content: 'Probar una merienda cubana para los clientes.',
      status: 'active',
      archived_at: null,
      deleted_at: null,
      created_at: '2026-11-20T11:00:00.000Z',
    },
    {
      id: '00000000-0000-7000-8000-000000000603',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      kind: 'idea',
      title: 'Catálogo de temporada',
      content: 'Preparar fotografías para el catálogo.',
      status: 'active',
      archived_at: null,
      deleted_at: null,
      created_at: '2026-11-20T12:00:00.000Z',
    },
  ];
  await mockSupabaseSession(page, { noteIdeas: seedNotes });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.locator('.side-nav').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('navigation', { name: 'Secciones de Más' }).getByRole('button', { name: 'Notas e ideas' }).click();
  await expect(page.getByRole('heading', { name: 'Tu biblioteca' })).toBeVisible();
  await expect(page.getByText('3 registros')).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Buscar notas e ideas' });
  await search.fill('Nueva cafetería');
  await expect(page.getByRole('heading', { name: 'Nueva cafetería' })).toBeVisible();
  await expect(page.getByText('Plan de lectura')).toHaveCount(0);
  await expect(page.getByText('1 de 3 registros')).toBeVisible();

  await search.fill('merienda cubana');
  await expect(page.getByRole('heading', { name: 'Nueva cafetería' })).toBeVisible();
  await expect(page.getByText('Catálogo de temporada')).toHaveCount(0);

  await search.clear();
  await page.getByLabel('Filtrar por tipo').selectOption('idea');
  await expect(page.getByRole('heading', { name: 'Nueva cafetería' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catálogo de temporada' })).toBeVisible();
  await expect(page.getByText('Plan de lectura')).toHaveCount(0);
  await expect(page.getByText('2 de 3 registros')).toBeVisible();

  await page.getByLabel('Filtrar por tipo').selectOption('note');
  await expect(page.getByRole('heading', { name: 'Plan de lectura' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nueva cafetería' })).toHaveCount(0);
  await expect(page.getByText('1 de 3 registros')).toBeVisible();
});


test('More modules remain directly accessible from the mobile navigation', async ({ page }) => {
  await mockSupabaseSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.locator('.mobile-nav').getByRole('button', { name: /Más/ }).click();
  const sectionNav = page.getByRole('navigation', { name: 'Secciones de Más' });
  await expect(sectionNav).toBeVisible();
  await expect(sectionNav.getByRole('button', { name: 'Tareas' })).toBeVisible();
  await sectionNav.getByRole('button', { name: 'Notas e ideas' }).click();
  await expect(page.getByRole('heading', { name: 'Tu biblioteca' })).toBeVisible();
  await sectionNav.getByRole('button', { name: 'Listas' }).click();
  await expect(page.getByRole('heading', { name: 'Tus listas' })).toBeVisible();
});


test('Lists support rename, purpose, item editing, reordering and reversible archive', async ({ page }) => {
  const linkedTaskId = '00000000-0000-7000-8000-000000000580';
  const existingList = {
    id: '00000000-0000-7000-8000-000000000581',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    name: 'Compras de la semana',
    purpose: 'Organizar compras para casa',
    status: 'active',
    archived_at: null,
    deleted_at: null,
  };
  const existingItems = [
    {
      id: '00000000-0000-7000-8000-000000000582',
      list_id: existingList.id,
      task_id: null,
      content: 'Comprar leche',
      position: 0,
      is_checked: false,
      created_at: '2026-11-20T10:00:00.000Z',
    },
    {
      id: '00000000-0000-7000-8000-000000000583',
      list_id: existingList.id,
      task_id: null,
      content: 'Comprar frutas',
      position: 1,
      is_checked: false,
      created_at: '2026-11-20T11:00:00.000Z',
    },
    {
      id: '00000000-0000-7000-8000-000000000584',
      list_id: existingList.id,
      task_id: linkedTaskId,
      content: 'Revisar factura',
      position: 2,
      is_checked: false,
      created_at: '2026-11-20T12:00:00.000Z',
    },
  ];
  const linkedTask = {
    id: linkedTaskId,
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    action: 'Revisar factura del proveedor',
    description: null,
    status: 'todo',
    priority: 3,
    due_date: null,
    time_zone: 'America/Havana',
    archived_at: null,
    deleted_at: null,
    created_at: '2026-11-20T12:00:00.000Z',
  };
  const { lists, listItems, updatedLists, updatedListItems } = await mockSupabaseSession(page, {
    lists: [existingList],
    listItems: existingItems,
    tasks: [linkedTask],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.locator('.side-nav').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('navigation', { name: 'Secciones de Más' }).getByRole('button', { name: 'Listas' }).click();
  await expect(page.getByRole('heading', { name: 'Compras de la semana' })).toBeVisible();
  await expect(page.getByText('Organizar compras para casa')).toBeVisible();
  await expect(page.getByText('Tarea vinculada · Pendiente')).toBeVisible();

  await page.getByRole('button', { name: 'Editar lista: Compras de la semana' }).click();
  const listDialog = page.getByRole('dialog', { name: 'Editar lista' });
  await listDialog.getByLabel('Nombre de la lista').fill('Compras y despensa');
  await listDialog.getByLabel('Propósito (opcional)').fill('Compras esenciales y reposición');
  await listDialog.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByText('Lista actualizada.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compras y despensa' })).toBeVisible();
  expect(lists[0]).toMatchObject({
    name: 'Compras y despensa',
    purpose: 'Compras esenciales y reposición',
  });
  expect(updatedLists[0]).toMatchObject({
    id: existingList.id,
    name: 'Compras y despensa',
    purpose: 'Compras esenciales y reposición',
  });
  expect(lists[0].owner_user_id).toBe(profile.id);

  await page.getByRole('button', { name: 'Editar elemento: Revisar factura' }).click();
  const itemDialog = page.getByRole('dialog', { name: 'Editar elemento' });
  await itemDialog.getByLabel('Contenido del elemento').fill('Revisar factura del proveedor');
  await itemDialog.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByText('Elemento actualizado.')).toBeVisible();
  await expect(page.getByText('Revisar factura del proveedor')).toBeVisible();
  expect(listItems.find((item) => item.id === existingItems[2].id)).toMatchObject({
    content: 'Revisar factura del proveedor',
    task_id: linkedTaskId,
  });
  expect(updatedListItems).toContainEqual({
    id: existingItems[2].id,
    content: 'Revisar factura del proveedor',
  });

  await page.getByRole('button', { name: 'Mover abajo: Comprar leche' }).click();
  await expect(page.getByText('Orden de elementos actualizado.')).toBeVisible();
  const orderedItems = page.locator('.list-card .list-items .list-item-wrap');
  await expect(orderedItems.nth(0).getByText('Comprar frutas')).toBeVisible();
  await expect(orderedItems.nth(1).getByText('Comprar leche')).toBeVisible();
  expect(listItems.find((item) => item.id === existingItems[0].id).position).toBe(1);
  expect(listItems.find((item) => item.id === existingItems[1].id).position).toBe(0);
  expect(listItems.find((item) => item.id === existingItems[2].id).task_id).toBe(linkedTaskId);

  const fruitCheckbox = page.getByRole('checkbox', { name: 'Comprar frutas' });
  await fruitCheckbox.click();
  await expect(fruitCheckbox).toBeChecked();
  expect(listItems.find((item) => item.id === existingItems[1].id).is_checked).toBe(true);
  expect(updatedListItems).toContainEqual({ id: existingItems[1].id, is_checked: true });

  await page.getByRole('button', { name: 'Archivar lista: Compras y despensa' }).click();
  await expect(page.getByText('Lista archivada.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compras y despensa' })).toHaveCount(0);
  expect(lists[0]).toMatchObject({ status: 'archived' });
  expect(updatedLists.at(-1)).toMatchObject({
    id: existingList.id,
    status: 'archived',
  });

  await page.getByLabel('Filtrar listas por archivo').selectOption('archived');
  await expect(page.getByRole('heading', { name: 'Compras y despensa' })).toBeVisible();
  await expect(page.locator('.list-archive-tag')).toHaveText('ARCHIVADA');
  await expect(page.getByRole('button', { name: 'Editar lista: Compras y despensa' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Editar elemento: Comprar frutas' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Comprar frutas' })).toBeDisabled();
  await page.getByRole('button', { name: 'Restaurar lista: Compras y despensa' }).click();
  await expect(page.getByText('Lista restaurada.')).toBeVisible();
  expect(lists[0]).toMatchObject({ status: 'active', archived_at: null });
  expect(updatedLists.at(-1)).toMatchObject({
    id: existingList.id,
    status: 'active',
    archived_at: null,
  });

  await page.getByLabel('Filtrar listas por archivo').selectOption('active');
  await expect(page.getByRole('heading', { name: 'Compras y despensa' })).toBeVisible();
  await expect(page.getByText('Revisar factura del proveedor')).toBeVisible();
  expect(listItems.find((item) => item.id === existingItems[2].id).task_id).toBe(linkedTaskId);
});


test('Lists convert an item into a task, preserve the original and avoid duplicate conversion', async ({ page }) => {
  const existingList = {
    id: '00000000-0000-7000-8000-000000000501',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    name: 'Compras de la semana',
    status: 'active',
    archived_at: null,
    deleted_at: null,
  };
  const existingItem = {
    id: '00000000-0000-7000-8000-000000000502',
    list_id: existingList.id,
    task_id: null,
    content: 'Comprar leche y avena para el desayuno',
    position: 0,
    is_checked: false,
    created_at: '2026-11-20T10:00:00.000Z',
  };
  const { insertedTasks, updatedListItems, listItems } = await mockSupabaseSession(page, {
    lists: [existingList],
    listItems: [existingItem],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('navigation', { name: 'Secciones de Más' }).getByRole('button', { name: 'Listas' }).click();

  await expect(page.getByRole('heading', { name: 'Compras de la semana' })).toBeVisible();
  await expect(page.getByText(existingItem.content)).toBeVisible();
  await page.getByRole('button', { name: 'Convertir en tarea: ' + existingItem.content }).click();
  const dialog = page.getByRole('dialog', { name: 'Convertir en tarea' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Título de la tarea').fill('Comprar leche y avena');
  await dialog.getByLabel('Prioridad de la tarea').selectOption('2');
  await dialog.getByLabel('Fecha objetivo (opcional)').fill('2026-11-23');
  await dialog.getByRole('button', { name: 'Crear y vincular tarea' }).click();

  await expect(page.getByText('Tarea creada y vinculada al elemento de la lista.')).toBeVisible();
  expect(insertedTasks).toHaveLength(1);
  expect(insertedTasks[0]).toMatchObject({
    id: updatedListItems[0].task_id,
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    action: 'Comprar leche y avena',
    description: 'Comprar leche y avena para el desayuno\n\nOrigen: elemento de la lista "Compras de la semana".',
    priority: 2,
    due_date: '2026-11-23',
    status: 'todo',
    time_zone: 'America/Havana',
  });
  expect(updatedListItems).toEqual([{ id: existingItem.id, task_id: insertedTasks[0].id }]);
  expect(listItems[0]).toMatchObject({ id: existingItem.id, content: existingItem.content, task_id: insertedTasks[0].id });

  await expect(page.getByText('Tarea vinculada · Pendiente')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convertir en tarea: ' + existingItem.content })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir tareas →' }).click();
  await expect(page.getByRole('heading', { name: 'Todas tus tareas' })).toBeVisible();
  await expect(page.getByText('Comprar leche y avena', { exact: true })).toBeVisible();

  await page.locator('.side-nav').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('navigation', { name: 'Secciones de Más' }).getByRole('button', { name: 'Listas' }).click();
  await expect(page.getByText('Tarea vinculada · Pendiente')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convertir en tarea: ' + existingItem.content })).toHaveCount(0);
  expect(insertedTasks).toHaveLength(1);
  expect(updatedListItems).toHaveLength(1);
});


test('Today separates overdue tasks, allows moving them to today and totals estimated time', async ({ page }) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const dateOffset = (offset) => {
    const [year, month, day] = today.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + offset));
    return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, '0'), String(next.getUTCDate()).padStart(2, '0')].join('-');
  };
  const task = (id, action, dueDate, estimatedDuration) => ({
    id, owner_user_id: profile.id, created_by_user_id: profile.id,
    action, description: null, status: 'todo', priority: 2,
    due_date: dueDate, estimated_duration_minutes: estimatedDuration,
    time_zone: 'America/Havana', archived_at: null, deleted_at: null,
    created_at: '2026-11-19T12:00:00.000Z',
  });
  const overdueTask = task('00000000-0000-7000-8000-000000000801', 'Pagar factura atrasada', dateOffset(-2), 90);
  const todayTask = task('00000000-0000-7000-8000-000000000802', 'Preparar reunión de hoy', today, 45);
  const laterTask = task('00000000-0000-7000-8000-000000000803', 'Comprar materiales', dateOffset(3), 30);
  const { taskRows, updatedTasks } = await mockSupabaseSession(page, { tasks: [overdueTask, todayTask, laterTask] });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atrasadas', exact: true })).toBeVisible();
  await expect(page.getByText('Pagar factura atrasada')).toBeVisible();
  await expect(page.getByText('Preparar reunión de hoy')).toBeVisible();
  await expect(page.getByText('Comprar materiales')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pasar a hoy: Pagar factura atrasada' })).toBeVisible();
  await page.getByRole('button', { name: 'Pasar a hoy: Pagar factura atrasada' }).click();

  await expect(page.getByText('Tarea movida a hoy.')).toBeVisible();
  expect(taskRows.find((row) => row.id === overdueTask.id).due_date).toBe(today);
  expect(updatedTasks.at(-1)).toEqual({ due_date: today });
  await expect(page.getByRole('heading', { name: 'Atrasadas', exact: true })).toHaveCount(0);
  await expect(page.getByText('2 h 15 min', { exact: true })).toBeVisible();
});
test('Today dashboard derives goal and project progress, weekly execution, blockers and milestones', async ({ page }) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const dateOffset = (offset) => {
    const [year, month, day] = today.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + offset));
    return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, '0'), String(next.getUTCDate()).padStart(2, '0')].join('-');
  };
  const goal = {
    id: '00000000-0000-7000-8000-000000000901', owner_user_id: profile.id, created_by_user_id: profile.id,
    life_area_id: '00000000-0000-7000-8000-000000000902', title: 'Meta de prueba', status: 'active',
    target_date: dateOffset(5), archived_at: null, deleted_at: null,
  };
  const subgoal = {
    id: '00000000-0000-7000-8000-000000000903', goal_id: goal.id, created_by_user_id: profile.id,
    title: 'Submeta de prueba', status: 'active', archived_at: null, deleted_at: null,
  };
  const project = {
    id: '00000000-0000-7000-8000-000000000904', owner_user_id: profile.id, created_by_user_id: profile.id,
    name: 'Proyecto de prueba', status: 'active', target_date: dateOffset(3), archived_at: null, deleted_at: null,
  };
  const completedTask = {
    id: '00000000-0000-7000-8000-000000000905', owner_user_id: profile.id, created_by_user_id: profile.id,
    action: 'Tarea completada esta semana', status: 'completed', priority: 2, due_date: null,
    completed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), archived_at: null, deleted_at: null,
  };
  const activeTask = {
    id: '00000000-0000-7000-8000-000000000906', owner_user_id: profile.id, created_by_user_id: profile.id,
    action: 'Tarea vinculada pendiente', status: 'in_progress', priority: 2, due_date: today,
    estimated_duration_minutes: 30, archived_at: null, deleted_at: null,
  };
  const blockedTask = {
    id: '00000000-0000-7000-8000-000000000907', owner_user_id: profile.id, created_by_user_id: profile.id,
    action: 'Esperando respuesta externa', status: 'blocked', priority: 1, due_date: today,
    archived_at: null, deleted_at: null,
  };
  await mockSupabaseSession(page, {
    tasks: [completedTask, activeTask, blockedTask],
    goals: [goal],
    subgoals: [subgoal],
    projects: [project],
    contributionRelations: [
      { id: '00000000-0000-7000-8000-000000000908', task_id: completedTask.id, goal_id: goal.id, relation_status: 'confirmed' },
      { id: '00000000-0000-7000-8000-000000000909', task_id: activeTask.id, subgoal_id: subgoal.id, relation_status: 'confirmed' },
    ],
    links: [
      { id: '00000000-0000-7000-8000-000000000910', task_id: completedTask.id, project_id: project.id, relation_role: 'primary' },
      { id: '00000000-0000-7000-8000-000000000911', task_id: activeTask.id, project_id: project.id, relation_role: 'primary' },
    ],
  });

  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('heading', { name: 'Metas y proyectos en marcha' })).toBeVisible();
  const goalProgress = page.locator('.today-progress-row').filter({ hasText: 'Meta de prueba' });
  const projectProgress = page.locator('.today-progress-row').filter({ hasText: 'Proyecto de prueba' });
  await expect(goalProgress).toContainText('50% · 1 de 2');
  await expect(projectProgress).toContainText('50% · 1 de 2');
  await expect(page.locator('.today-week-stat')).toContainText('1');
  await expect(page.locator('.today-watch-row').filter({ hasText: 'Esperando respuesta externa' })).toContainText('Bloqueada');
  await expect(page.locator('.today-watch-row').filter({ hasText: 'Meta de prueba' })).toContainText('Meta');
  await expect(page.locator('.today-watch-row').filter({ hasText: 'Proyecto de prueba' })).toContainText('Proyecto');
  await expect(page.getByText('Tarea vinculada pendiente')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(horizontalOverflow).toBe(false);
});

test('Tasks filter by due date and support bulk complete, reschedule and clear date', async ({ page }) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const dateOffset = (offset) => {
    const [year, month, day] = today.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + offset));
    return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, '0'), String(next.getUTCDate()).padStart(2, '0')].join('-');
  };
  const task = (id, action, status, dueDate) => ({
    id, owner_user_id: profile.id, created_by_user_id: profile.id,
    action, description: null, status, priority: 3,
    due_date: dueDate, estimated_duration_minutes: null,
    time_zone: 'America/Havana', archived_at: null, deleted_at: null,
    created_at: '2026-11-19T12:00:00.000Z',
  });
  const overdue = task('00000000-0000-7000-8000-000000000811', 'Enviar informe', 'todo', dateOffset(-2));
  const todayTask = task('00000000-0000-7000-8000-000000000812', 'Pagar electricidad', 'todo', today);
  const nextTask = task('00000000-0000-7000-8000-000000000813', 'Comprar pan', 'in_progress', dateOffset(3));
  const noDateTask = task('00000000-0000-7000-8000-000000000814', 'Ordenar escritorio', 'todo', null);
  const distantTask = task('00000000-0000-7000-8000-000000000815', 'Preparar viaje', 'blocked', dateOffset(10));
  const completedTask = task('00000000-0000-7000-8000-000000000816', 'Informe antiguo', 'completed', dateOffset(-5));
  const { taskRows, updatedTasks } = await mockSupabaseSession(page, {
    tasks: [overdue, todayTask, nextTask, noDateTask, distantTask, completedTask],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('button', { name: /Más/ }).click();
  await page.getByRole('button', { name: 'Tareas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todas tus tareas' })).toBeVisible();

  const dateFilter = page.getByLabel('Filtrar por fecha');
  await dateFilter.selectOption('overdue');
  await expect(page.getByText('Enviar informe', { exact: true })).toBeVisible();
  await expect(page.getByText('Pagar electricidad', { exact: true })).toHaveCount(0);
  await dateFilter.selectOption('today');
  await expect(page.getByText('Pagar electricidad', { exact: true })).toBeVisible();
  await expect(page.getByText('Enviar informe', { exact: true })).toHaveCount(0);
  await dateFilter.selectOption('next7');
  await expect(page.getByText('Comprar pan', { exact: true })).toBeVisible();
  await expect(page.getByText('Preparar viaje', { exact: true })).toHaveCount(0);
  await dateFilter.selectOption('no-date');
  await expect(page.getByText('Ordenar escritorio', { exact: true })).toBeVisible();
  await dateFilter.selectOption('all');

  // Change the dates of multiple active tasks in one owner-scoped update.
  await page.getByLabel('Seleccionar tarea: Pagar electricidad').check();
  await page.getByLabel('Seleccionar tarea: Comprar pan').check();
  await page.getByLabel('Nueva fecha para selección').fill(dateOffset(20));
  await page.getByRole('button', { name: 'Aplicar fecha' }).click();
  await expect(page.getByText('Fecha actualizada en las tareas seleccionadas.')).toBeVisible();
  expect(taskRows.find((row) => row.id === todayTask.id).due_date).toBe(dateOffset(20));
  expect(taskRows.find((row) => row.id === nextTask.id).due_date).toBe(dateOffset(20));
  expect(updatedTasks.at(-1)).toMatchObject({ due_date: dateOffset(20), ids: expect.arrayContaining([todayTask.id, nextTask.id]) });

  // Clear a date without touching the other selected rows.
  await page.getByLabel('Seleccionar tarea: Pagar electricidad').check();
  await page.getByRole('button', { name: 'Quitar fecha' }).click();
  await expect(page.getByText('Fechas eliminadas de las tareas seleccionadas.')).toBeVisible();
  expect(taskRows.find((row) => row.id === todayTask.id).due_date).toBeNull();
  expect(taskRows.find((row) => row.id === nextTask.id).due_date).toBe(dateOffset(20));

  // Complete two selected tasks at once.
  await page.getByLabel('Seleccionar tarea: Enviar informe').check();
  await page.getByLabel('Seleccionar tarea: Ordenar escritorio').check();
  await page.getByRole('button', { name: 'Completar seleccionadas' }).click();
  await expect(page.getByText('2 tareas completadas.')).toBeVisible();
  expect(taskRows.find((row) => row.id === overdue.id)).toMatchObject({ status: 'completed', completion_outcome: 'complete' });
  expect(taskRows.find((row) => row.id === noDateTask.id)).toMatchObject({ status: 'completed', completion_outcome: 'complete' });
  expect(updatedTasks.at(-1)).toMatchObject({
    status: 'completed',
    completion_outcome: 'complete',
    ids: expect.arrayContaining([overdue.id, noDateTask.id]),
  });
});


test('Tasks support work-status changes, reversible archiving and bulk archive', async ({ page }) => {
  const task = (id, action, status = 'todo', archivedAt = null) => ({
    id, owner_user_id: profile.id, created_by_user_id: profile.id,
    action, description: null, status, priority: 3,
    due_date: null, estimated_duration_minutes: 30,
    completed_at: status === 'completed' ? '2026-11-19T15:00:00.000Z' : null,
    completion_outcome: status === 'completed' ? 'complete' : null,
    time_zone: 'America/Havana', archived_at: archivedAt, deleted_at: null,
    created_at: '2026-11-19T12:00:00.000Z',
  });
  const first = task('00000000-0000-7000-8000-000000000901', 'Preparar propuesta');
  const second = task('00000000-0000-7000-8000-000000000902', 'Revisar presupuesto', 'in_progress');
  const archived = task('00000000-0000-7000-8000-000000000903', 'Pendiente antigua', 'todo', '2026-11-18T12:00:00.000Z');
  const completed = task('00000000-0000-7000-8000-000000000904', 'Informe entregado', 'completed');
  const { taskRows, updatedTasks } = await mockSupabaseSession(page, { tasks: [first, second, archived, completed] });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('button', { name: 'Más' }).click();
  await page.getByRole('button', { name: 'Tareas', exact: true }).click();

  const workStatus = page.getByLabel('Cambiar estado: Preparar propuesta');
  await expect(workStatus).toHaveValue('todo');
  await workStatus.selectOption('in_progress');
  await expect(page.getByText('Estado actualizado: En curso.')).toBeVisible();
  expect(first.status).toBe('in_progress');
  await page.getByLabel('Cambiar estado: Preparar propuesta').selectOption('blocked');
  await expect(page.getByText('Estado actualizado: Bloqueada.')).toBeVisible();
  expect(first.status).toBe('blocked');
  await page.getByLabel('Cambiar estado: Preparar propuesta').selectOption('todo');
  await expect(page.getByText('Estado actualizado: Pendiente.')).toBeVisible();
  expect(first.status).toBe('todo');

  await page.getByRole('button', { name: 'Archivar tarea: Preparar propuesta' }).click();
  await expect(page.getByText('Tarea archivada.')).toBeVisible();
  expect(first.archived_at).toBeTruthy();
  expect(first.status).toBe('todo');

  const archiveFilter = page.getByLabel('Filtrar por archivo');
  await archiveFilter.selectOption('archived');
  await expect(page.getByText('Preparar propuesta', { exact: true })).toBeVisible();
  await expect(page.getByText('Pendiente antigua', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar tarea: Preparar propuesta' }).click();
  await expect(page.getByText('Tarea restaurada.')).toBeVisible();
  expect(first.archived_at).toBeNull();
  expect(first.status).toBe('todo');
  await expect(page.getByText('Preparar propuesta', { exact: true })).toHaveCount(0);

  await archiveFilter.selectOption('active');
  await page.getByLabel('Seleccionar tarea: Preparar propuesta').check();
  await page.getByLabel('Seleccionar tarea: Revisar presupuesto').check();
  await page.getByRole('button', { name: 'Archivar seleccionadas' }).click();
  await expect(page.getByText('2 tareas archivadas.')).toBeVisible();
  expect(first.archived_at).toBeTruthy();
  expect(second.archived_at).toBeTruthy();
  expect(first.status).toBe('todo');
  expect(second.status).toBe('in_progress');
  expect(updatedTasks.at(-1)).toMatchObject({
    archived_at: expect.any(String),
    ids: expect.arrayContaining([first.id, second.id]),
  });

  await archiveFilter.selectOption('archived');
  await expect(page.getByText('Preparar propuesta', { exact: true })).toBeVisible();
  await expect(page.getByText('Revisar presupuesto', { exact: true })).toBeVisible();

  await page.getByLabel('Filtrar por estado').selectOption('completed');
  await archiveFilter.selectOption('active');
  await page.getByRole('button', { name: 'Archivar tarea: Informe entregado' }).click();
  await expect(page.getByText('Tarea archivada.')).toBeVisible();
  expect(completed.status).toBe('completed');
  await archiveFilter.selectOption('archived');
  await expect(page.getByRole('button', { name: 'Restaurar tarea: Informe entregado' })).toBeVisible();
});


test('Tasks link to goals and subgoals, filter by objective, and restore removed relations without duplicates', async ({ page }) => {
  const area = {
    id: '00000000-0000-7000-8000-000000000701',
    owner_user_id: profile.id, created_by_user_id: profile.id,
    title: 'Negocio', description: null, position: 0, status: 'active', archived_at: null, deleted_at: null,
  };
  const goal = {
    id: '00000000-0000-7000-8000-000000000702',
    owner_user_id: profile.id, created_by_user_id: profile.id,
    life_area_id: area.id, title: 'Aumentar ventas', reason: null, expected_result: 'Más clientes',
    target_date: null, status: 'active', archived_at: null, deleted_at: null,
    created_at: '2026-11-20T11:00:00.000Z',
  };
  const subgoal = {
    id: '00000000-0000-7000-8000-000000000703',
    goal_id: goal.id, created_by_user_id: profile.id,
    title: 'Contactar nuevos clientes', expected_result: null, target_date: null,
    status: 'active', archived_at: null, deleted_at: null, created_at: '2026-11-20T11:10:00.000Z',
  };
  const task = (id, action) => ({
    id, owner_user_id: profile.id, created_by_user_id: profile.id,
    action, description: null, status: 'todo', priority: 2, due_date: null,
    estimated_duration_minutes: 30, time_zone: 'America/Havana',
    archived_at: null, deleted_at: null, created_at: '2026-11-20T12:00:00.000Z',
  });
  const first = task('00000000-0000-7000-8000-000000000704', 'Preparar propuesta comercial');
  const second = task('00000000-0000-7000-8000-000000000705', 'Actualizar métricas');
  const third = task('00000000-0000-7000-8000-000000000706', 'Llamar a nuevos clientes');
  const result = await mockSupabaseSession(page, {
    areas: [area], goals: [goal], subgoals: [subgoal], tasks: [first, second, third],
    contributionRelations: [],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('button', { name: 'Más' }).click();
  await page.getByRole('button', { name: 'Tareas', exact: true }).click();

  const objectiveFilter = page.getByLabel('Filtrar por meta o submeta');
  await objectiveFilter.selectOption('none');
  await expect(page.getByText('Preparar propuesta comercial', { exact: true })).toBeVisible();
  await expect(page.getByText('Actualizar métricas', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Gestionar objetivos: Preparar propuesta comercial' }).click();
  const dialog = page.getByRole('dialog', { name: 'Objetivos de la tarea' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Seleccionar meta o submeta').selectOption('goal:' + goal.id);
  await dialog.getByRole('button', { name: 'Vincular meta o submeta' }).click();
  await expect(page.getByText('Objetivo vinculado a la tarea.')).toBeVisible();
  expect(result.insertedContributionRelations).toHaveLength(1);
  expect(result.insertedContributionRelations[0]).toMatchObject({
    task_id: first.id, goal_id: goal.id,
    relation_status: 'confirmed', created_by_user_id: profile.id,
  });
  // Close the manager before using the list filters underneath it.
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await objectiveFilter.selectOption('all');
  await expect(page.getByText('Meta: Aumentar ventas')).toBeVisible();

  await page.getByRole('button', { name: 'Gestionar objetivos: Preparar propuesta comercial' }).click();
  await dialog.getByLabel('Seleccionar meta o submeta').selectOption('subgoal:' + subgoal.id);
  await dialog.getByRole('button', { name: 'Vincular meta o submeta' }).click();
  await expect(page.getByText('Objetivo vinculado a la tarea.')).toBeVisible();
  expect(result.insertedContributionRelations).toHaveLength(2);
  await expect(page.getByText('Submeta: Contactar nuevos clientes · Aumentar ventas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

  // A task linked only to the subgoal must also contribute to the parent goal.
  await page.getByRole('button', { name: 'Gestionar objetivos: Llamar a nuevos clientes' }).click();
  const thirdDialog = page.getByRole('dialog', { name: 'Objetivos de la tarea' });
  await thirdDialog.getByLabel('Seleccionar meta o submeta').selectOption('subgoal:' + subgoal.id);
  await thirdDialog.getByRole('button', { name: 'Vincular meta o submeta' }).click();
  await expect(page.getByText('Objetivo vinculado a la tarea.')).toBeVisible();
  expect(result.insertedContributionRelations).toHaveLength(3);
  await thirdDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await objectiveFilter.selectOption('goal:' + goal.id);
  await expect(page.getByText('Preparar propuesta comercial', { exact: true })).toBeVisible();
  await expect(page.getByText('Llamar a nuevos clientes', { exact: true })).toBeVisible();
  await expect(page.getByText('Actualizar métricas', { exact: true })).toHaveCount(0);
  await objectiveFilter.selectOption('subgoal:' + subgoal.id);
  await expect(page.getByText('Preparar propuesta comercial', { exact: true })).toBeVisible();
  await expect(page.getByText('Llamar a nuevos clientes', { exact: true })).toBeVisible();
  await expect(page.getByText('Actualizar métricas', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Gestionar objetivos: Preparar propuesta comercial' }).click();
  await page.getByRole('button', { name: 'Desvincular meta: Aumentar ventas' }).click();
  await expect(page.getByText('Meta desvinculada de la tarea.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  const goalRelation = result.contributionRelations.find((row) => row.task_id === first.id && row.goal_id === goal.id);
  expect(goalRelation.relation_status).toBe('removed');

  await objectiveFilter.selectOption('goal:' + goal.id);
  // The parent-goal filter still includes tasks linked to its subgoal.
  await expect(page.getByText('Preparar propuesta comercial', { exact: true })).toBeVisible();
  await expect(page.getByText('Llamar a nuevos clientes', { exact: true })).toBeVisible();
  await objectiveFilter.selectOption('all');
  await page.getByRole('button', { name: 'Gestionar objetivos: Preparar propuesta comercial' }).click();
  await dialog.getByLabel('Seleccionar meta o submeta').selectOption('goal:' + goal.id);
  await expect(dialog.getByText('Este vínculo existe en el historial y se restaurará sin crear otro registro.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Vincular meta o submeta' }).click();
  await expect(page.getByText('Vínculo restaurado.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  expect(result.insertedContributionRelations).toHaveLength(3);
  expect(goalRelation.relation_status).toBe('confirmed');
  expect(result.updatedContributionRelations).toContainEqual({ id: goalRelation.id, relation_status: 'confirmed' });

  await objectiveFilter.selectOption('none');
  await expect(page.getByText('Actualizar métricas', { exact: true })).toBeVisible();
  await expect(page.getByText('Preparar propuesta comercial', { exact: true })).toHaveCount(0);

  await page.locator('.side-nav').getByRole('button', { name: /Objetivos/ }).click();
  await page.getByRole('button', { name: 'Metas', exact: true }).click();
  const goalCard = page.locator('.goal-record-card').filter({ has: page.getByRole('heading', { name: goal.title }) });
  await expect(goalCard.getByText('Tareas que contribuyen · 2')).toBeVisible();
  await expect(goalCard.getByText('Preparar propuesta comercial')).toBeVisible();
  await expect(goalCard.getByText('Llamar a nuevos clientes')).toBeVisible();
  await page.getByRole('button', { name: 'Submetas', exact: true }).click();
  const subgoalCard = page.locator('.subgoal-record-card').filter({ has: page.getByRole('heading', { name: subgoal.title }) });
  await expect(subgoalCard.getByText('Tareas que contribuyen · 2')).toBeVisible();
  await expect(subgoalCard.getByText('Preparar propuesta comercial')).toBeVisible();
  await expect(subgoalCard.getByText('Llamar a nuevos clientes')).toBeVisible();
});


test('Tasks can be linked to primary and additional projects and filtered by project', async ({ page }) => {
  const projectA = {
    id: '00000000-0000-7000-8000-000000000811', owner_user_id: profile.id, created_by_user_id: profile.id,
    name: 'Proyecto principal', purpose: 'Iniciativa principal', status: 'active', archived_at: null, deleted_at: null,
    created_at: '2026-11-19T12:00:00.000Z',
  };
  const projectB = {
    id: '00000000-0000-7000-8000-000000000812', owner_user_id: profile.id, created_by_user_id: profile.id,
    name: 'Proyecto relacionado', purpose: 'Iniciativa adicional', status: 'active', archived_at: null, deleted_at: null,
    created_at: '2026-11-18T12:00:00.000Z',
  };
  const linkedTask = {
    id: '00000000-0000-7000-8000-000000000813', owner_user_id: profile.id, created_by_user_id: profile.id,
    action: 'Preparar propuesta', description: null, status: 'in_progress', priority: 2, due_date: '2026-11-25',
    archived_at: null, deleted_at: null, created_at: '2026-11-19T10:00:00.000Z',
  };
  const unlinkedTask = {
    id: '00000000-0000-7000-8000-000000000814', owner_user_id: profile.id, created_by_user_id: profile.id,
    action: 'Ordenar escritorio', description: null, status: 'todo', priority: 3, due_date: null,
    archived_at: null, deleted_at: null, created_at: '2026-11-19T09:00:00.000Z',
  };
  const primaryLink = {
    id: '00000000-0000-7000-8000-000000000815', task_id: linkedTask.id, project_id: projectA.id,
    relation_role: 'primary', created_by_user_id: profile.id,
  };
  const { projectLinks, insertedProjectLinks, updatedProjectLinks } = await mockSupabaseSession(page, {
    projects: [projectA, projectB],
    tasks: [linkedTask, unlinkedTask],
    links: [primaryLink],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Más' }).click();
  await page.getByRole('button', { name: 'Tareas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible();

  const linkedRow = page.locator('.task-row').filter({ hasText: 'Preparar propuesta' });
  await expect(linkedRow).toContainText('Proyecto principal (principal)');
  await linkedRow.getByRole('button', { name: 'Gestionar proyectos: Preparar propuesta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Proyectos de la tarea' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.project-relation-row').filter({ hasText: 'Proyecto principal' })).toBeVisible();
  await dialog.getByLabel('Seleccionar proyecto').selectOption(projectB.id);
  await dialog.getByRole('button', { name: 'Vincular proyecto' }).click();
  await expect(page.getByText('Proyecto adicional vinculado a la tarea.')).toBeVisible();
  expect(insertedProjectLinks).toHaveLength(1);
  expect(insertedProjectLinks[0]).toMatchObject({
    task_id: linkedTask.id, project_id: projectB.id, relation_role: 'additional', created_by_user_id: profile.id,
  });
  await expect(dialog.locator('.project-relation-row').filter({ hasText: 'Proyecto relacionado' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Hacer principal: Proyecto relacionado' }).click();
  await expect(page.getByText('Proyecto principal actualizado. El anterior se conserva como adicional.')).toBeVisible();
  expect(updatedProjectLinks).toHaveLength(2);
  expect(updatedProjectLinks).toEqual([
    { id: primaryLink.id, relation_role: 'additional' },
    { id: insertedProjectLinks[0].id, relation_role: 'primary' },
  ]);
  expect(projectLinks.find((link) => link.project_id === projectA.id)).toMatchObject({ relation_role: 'additional' });
  expect(projectLinks.find((link) => link.project_id === projectB.id)).toMatchObject({ relation_role: 'primary' });

  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByLabel('Filtrar por proyecto').selectOption('project:' + projectA.id);
  await expect(linkedRow).toBeVisible();
  await page.getByLabel('Filtrar por proyecto').selectOption('project:' + projectB.id);
  await expect(linkedRow).toBeVisible();
  await page.getByLabel('Filtrar por proyecto').selectOption('none');
  await expect(page.locator('.task-row').filter({ hasText: 'Ordenar escritorio' })).toBeVisible();
  await expect(linkedRow).toHaveCount(0);

  await page.locator('.side-nav').getByRole('button', { name: /Proyectos/ }).click();
  await page.getByRole('button', { name: 'Ver proyecto: Proyecto principal' }).click();
  const projectADetail = page.getByRole('dialog', { name: 'Proyecto principal' });
  await expect(projectADetail.getByText('Preparar propuesta')).toBeVisible();
  await expect(projectADetail.getByText('Proyecto adicional de esta tarea')).toBeVisible();
  await projectADetail.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Ver proyecto: Proyecto relacionado' }).click();
  const projectBDetail = page.getByRole('dialog', { name: 'Proyecto relacionado' });
  await expect(projectBDetail.getByText('Preparar propuesta')).toBeVisible();
  await expect(projectBDetail.getByText('Proyecto principal de esta tarea')).toBeVisible();
});

test('authenticated session survives reload and still supports sign-out', async ({ page }) => {
  const { signedOutRequests } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.locator('.page-heading h1')).toHaveText('Hoy');
  await expect(page.locator('.profile-meta strong')).toHaveText('Playwright Test');

  await page.reload();

  await expect(page.locator('.page-heading h1')).toHaveText('Hoy');
  await expect(page.locator('.profile-meta strong')).toHaveText('Playwright Test');
  await expect(page.locator('.auth-screen')).toHaveCount(0);

  await page.getByTitle('Cerrar sesión').click();
  await expect(page.getByRole('heading', { name: 'Vuelve a enfocarte.' })).toBeVisible();
  expect(signedOutRequests).toHaveLength(1);
});


test('authenticated user can sign out and return to the sign-in screen', async ({ page }) => {
  const { signedOutRequests } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.locator('.page-heading h1')).toHaveText('Hoy');
  await page.getByTitle('Cerrar sesión').click();

  await expect(page.getByRole('heading', { name: 'Vuelve a enfocarte.' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(signedOutRequests).toHaveLength(1);
  expect(signedOutRequests[0].authorization).toContain('Bearer ');
});
