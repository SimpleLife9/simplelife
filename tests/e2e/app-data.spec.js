import { test, expect } from '@playwright/test';

async function todayInBrowserHavana(page) {
  return page.evaluate(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Havana', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts.filter((part) => ['year', 'month', 'day'].includes(part.type))
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  });
}

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
function normalizeCaptureForDuplicate(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

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
  const calendarEvents = [...(initialData.calendarEvents || [])];
  const protectedTimeBlocks = [...(initialData.protectedTimeBlocks || [])];
  const protectedTimeMutationRequests = [];
  const protectedTimeConflicts = [...(initialData.protectedTimeConflicts || [])];
  const insertedAgendaEvents = [];
  const idempotencyRequests = [];
  const mutationRequests = [];
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
  const defaultCaptures = [
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
  const captures = [...(initialData.captures || defaultCaptures)];
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
  const processingRuns = [...(initialData.processingRuns || [])];
  const queueRequests = [];
  const processingRequests = [];
  const reviewRequests = [];
  const reviewAuditEvents = [];
  const trashRequests = [];
  const offlineSyncRequests = [];
  const offlineSyncReplayFlags = [];
  const offlineSyncedCaptures = new Map();
  let offlineSyncFailuresRemaining = Number.isInteger(initialData.offlineSyncFailures)
    ? Math.max(0, initialData.offlineSyncFailures)
    : 0;
  const insertedVoiceAssets = [];
  const uploadedVoiceObjects = [];
  const voiceFinalizeRequests = [];
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
      'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info, x-supabase-api-version, prefer, idempotency-key',
      // PostgREST count=exact is read from Content-Range by supabase-js; expose it to the browser.
      'access-control-expose-headers': 'content-range',
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

    if (url.pathname === '/rest/v1/protected_time_block' && method === 'GET') {
      const archivedFilter = url.searchParams.get('archived_at') || '';
      const deletedFilter = url.searchParams.get('deleted_at') || '';
      const rows = protectedTimeBlocks.filter((row) => {
        const archivedMatch = archivedFilter === 'not.is.null'
          ? row.archived_at != null
          : archivedFilter === 'is.null' ? row.archived_at == null : true;
        const deletedMatch = deletedFilter === 'not.is.null'
          ? row.deleted_at != null
          : deletedFilter === 'is.null' ? row.deleted_at == null : true;
        return archivedMatch && deletedMatch;
      });
      await json(200, rows);
      return;
    }

    if (url.pathname === '/rest/v1/calendar_event' && method === 'GET') {
      const archivedFilter = url.searchParams.get('archived_at') || '';
      const deletedFilter = url.searchParams.get('deleted_at') || '';
      const rows = calendarEvents.filter((row) => {
        const archivedMatch = archivedFilter === 'not.is.null'
          ? row.archived_at != null
          : archivedFilter === 'is.null' ? row.archived_at == null : true;
        const deletedMatch = deletedFilter === 'not.is.null'
          ? row.deleted_at != null
          : deletedFilter === 'is.null' ? row.deleted_at == null : true;
        return archivedMatch && deletedMatch;
      });
      await json(200, rows);
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

    if (url.pathname === '/rest/v1/processing_run' && method === 'GET') {
      const captureFilter = url.searchParams.get('capture_id') || '';
      if (captureFilter && initialData.processingRunDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, initialData.processingRunDelayMs));
      }
      const rows = processingRuns.filter((row) => !captureFilter || captureFilter === 'eq.' + row.capture_id);
      await json(200, rows);
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
      if (initialData.capturePartInitialInsertError
        && rows.some((row) => !captureParts.some((existing) =>
          existing.capture_id === row.capture_id && existing.part_index === row.part_index))) {
        // The source capture was already committed; only its initial part failed.
        initialData.capturePartInitialInsertError = false;
        await json(500, { code: 'XX000', message: 'simulated initial capture_part insert failure' });
        return;
      }
      if (initialData.capturePartRecoveryConflict
        && rows.some((row) => !captureParts.some((existing) =>
          existing.capture_id === row.capture_id && existing.part_index === row.part_index))) {
        // Simulate another tab winning the unique capture_id/part_index insert.
        captureParts.push({
          ...rows[0],
          id: '00000000-0000-7000-8000-000000000210',
        });
        await json(409, { code: '23505', message: 'duplicate key value violates unique constraint capture_part_capture_id_part_index_key' });
        return;
      }
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
      // supabase-js uses offset/limit query parameters for range pagination.
      // Keep Range-header support for callers that explicitly send it.
      const rangeHeader = request.headers()['range'] || '0-99';
      const [rangeStart, rangeEnd] = rangeHeader.split('-').map(Number);
      const requestedOffset = Number(url.searchParams.get('offset'));
      const requestedLimit = Number(url.searchParams.get('limit'));
      const start = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
        ? requestedOffset
        : Number.isFinite(rangeStart) ? rangeStart : 0;
      const end = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? start + requestedLimit - 1
        : Number.isFinite(rangeEnd) ? rangeEnd : start + 99;
      if (initialData.capturePageDelayStart === start) {
        await new Promise((resolve) => setTimeout(resolve, initialData.capturePageDelayMs ?? 800));
      }
      const searchParam = url.searchParams.get('search_document');
      let filtered = [...captures];
      if (searchParam) {
        const value = searchParam.replace(/^(?:wfts|fts|plfts|phfts)\([^)]*\)\./, '');
        const normalized = value.toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const words = normalized.split(/\s+/).filter(Boolean);
        filtered = filtered.filter((capture) => {
          const content = normalizeCaptureForDuplicate(capture.content_original);
          return words.every((word) => content.includes(word));
        });
      }
      const pageRows = filtered.slice(start, end + 1);
      await json(200, pageRows, { 'content-range': pageRows.length ? `${start}-${start + pageRows.length - 1}/${filtered.length}` : `*/${filtered.length}`, 'accept-ranges': 'items' });
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

    if (url.pathname === '/functions/v1/agenda-protected-time-mutate' && method === 'POST') {
      const payload = request.postDataJSON();
      const key = request.headers()['idempotency-key'] || '';
      protectedTimeMutationRequests.push({ key, payload });
      const now = new Date(Date.now() + protectedTimeMutationRequests.length * 3).toISOString();
      let row = payload.action === 'create'
        ? null
        : protectedTimeBlocks.find((item) => item.id === payload.blockId && item.owner_user_id === profile.id);
      if (payload.action !== 'create' && !row) {
        await json(404, { error: 'PROTECTED_TIME_BLOCK_NOT_FOUND' });
        return;
      }
      if (payload.action === 'create') {
        const block = payload.block;
        row = {
          id: '0190f47a-7b2c-7abc-8def-0123456789d1',
          owner_user_id: profile.id,
          created_by_user_id: profile.id,
          updated_by_user_id: profile.id,
          label: block.label,
          category: block.category ?? null,
          protection_mode: block.protectionMode,
          pattern_kind: block.patternKind,
          time_zone: block.timeZone,
          start_local: block.startLocalDateTime ?? null,
          end_local: block.endLocalDateTime ?? null,
          starts_at: block.patternKind === 'one_off' ? '2026-11-23T14:00:00.000Z' : null,
          ends_at: block.patternKind === 'one_off' ? '2026-11-23T15:00:00.000Z' : null,
          start_disambiguation: block.startDisambiguation ?? null,
          end_disambiguation: block.endDisambiguation ?? null,
          start_gap_strategy: block.patternKind === 'one_off' ? 'next-valid' : null,
          end_gap_strategy: block.patternKind === 'one_off' ? 'next-valid' : null,
          start_date: block.startDate ?? null,
          end_date_exclusive: block.endDateExclusive ?? null,
          weekdays: block.weekdays ?? null,
          start_time_local: block.startLocalTime ?? null,
          end_time_local: block.endLocalTime ?? null,
          ends_next_day: block.endsNextDay ?? null,
          resolver_metadata: { rulesSource: 'iana-tzdb', rulesVersion: '2026f', resolverVersion: 'agenda-iana-resolver-v1', authoritative: true },
          archived_at: null,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        };
        protectedTimeBlocks.unshift(row);
      } else {
        if (row.updated_at !== payload.expectedUpdatedAt) {
          await json(409, { error: 'PROTECTED_TIME_VERSION_CONFLICT' });
          return;
        }
        if (payload.action === 'edit') {
          const block = payload.block;
          Object.assign(row, {
            label: block.label,
            category: block.category ?? null,
            protection_mode: block.protectionMode,
            pattern_kind: block.patternKind,
            time_zone: block.timeZone,
            start_local: block.startLocalDateTime ?? null,
            end_local: block.endLocalDateTime ?? null,
            start_disambiguation: block.startDisambiguation ?? null,
            end_disambiguation: block.endDisambiguation ?? null,
            start_date: block.startDate ?? null,
            end_date_exclusive: block.endDateExclusive ?? null,
            weekdays: block.weekdays ?? null,
            start_time_local: block.startLocalTime ?? null,
            end_time_local: block.endLocalTime ?? null,
            ends_next_day: block.endsNextDay ?? null,
          });
        } else if (payload.action === 'archive') {
          row.archived_at = now;
        } else if (payload.action === 'restore') {
          row.archived_at = null;
          row.deleted_at = null;
        } else if (payload.action === 'delete') {
          row.archived_at = null;
          row.deleted_at = now;
        }
        row.updated_at = now;
        row.updated_by_user_id = profile.id;
      }
      await json(payload.action === 'create' ? 201 : 200, {
        blockId: row.id, updatedAt: row.updated_at, lifecycle: row.deleted_at ? 'trash' : row.archived_at ? 'archived' : 'active', replayed: false,
      });
      return;
    }

    if (url.pathname === '/functions/v1/agenda-event-mutate' && method === 'POST') {
      const payload = request.postDataJSON();
      const key = request.headers()['idempotency-key'] || '';
      mutationRequests.push({ key, payload });
      const row = calendarEvents.find((item) => item.id === payload.eventId && item.owner_user_id === profile.id);
      if (!row) {
        await json(404, { error: 'EVENT_NOT_FOUND' });
        return;
      }
      if (row.updated_at !== payload.expectedUpdatedAt) {
        await json(409, { error: 'EVENT_VERSION_CONFLICT' });
        return;
      }
      const decisions = Array.isArray(payload.protectedTimeDecisions) ? payload.protectedTimeDecisions : [];
      if (payload.action === 'edit' && protectedTimeConflicts.length) {
        const accepted = new Map(decisions.map((item) => [item.blockId + ':' + item.occurrenceStartsAt, item]));
        const complete = protectedTimeConflicts.every((conflict) => {
          const choice = accepted.get(conflict.conflictKey);
          return choice && choice.blockUpdatedAt === conflict.blockUpdatedAt
            && choice.decision === conflict.requiredDecision;
        });
        if (!complete) {
          await json(409, { error: 'PROTECTED_TIME_CONFLICTS', conflicts: protectedTimeConflicts });
          return;
        }
      }
      const updatedAt = new Date(Date.now() + mutationRequests.length * 2).toISOString();
      if (payload.action === 'edit') {
        const event = payload.event;
        // The real authenticated writer resolves civil time to UTC on the server.
        // This browser mock preserves those derived instants when the civil intent
        // is unchanged; it must not erase them merely because the browser omits
        // server-derived startsAt/endsAt from the request.
        const unchangedZonedCivilRange = event.temporalKind === 'zoned_civil'
          && row.temporal_kind === 'zoned_civil'
          && event.startLocalDateTime === row.start_local
          && event.endLocalDateTime === row.end_local
          && event.timeZone === row.time_zone;
        Object.assign(row, {
          title: event.title,
          description: event.description ?? null,
          location_label: event.locationLabel ?? null,
          location_kind: event.locationKind ?? null,
          event_status: event.eventStatus || row.event_status,
          temporal_kind: event.temporalKind,
          start_date: event.startDate ?? null,
          end_date_exclusive: event.endDateExclusive ?? null,
          start_local: event.startLocalDateTime ?? null,
          end_local: event.endLocalDateTime ?? null,
          time_zone: event.timeZone ?? event.sourceTimeZone ?? null,
          starts_at: event.startsAt ?? (unchangedZonedCivilRange ? row.starts_at : null),
          ends_at: event.endsAt ?? (unchangedZonedCivilRange ? row.ends_at : null),
          protected_time_decisions: decisions,
        });
      } else if (payload.action === 'cancel') {
        row.event_status = 'cancelled';
      } else if (payload.action === 'reopen') {
        row.event_status = 'confirmed';
      } else if (payload.action === 'finish') {
        row.event_status = 'finished';
      } else if (payload.action === 'archive') {
        row.archived_at = updatedAt;
      } else if (payload.action === 'trash') {
        row.archived_at = null;
        row.deleted_at = updatedAt;
        row.purge_after = new Date(Date.parse(updatedAt) + 30 * 86400000).toISOString();
      } else if (payload.action === 'restore') {
        row.archived_at = null;
        row.deleted_at = null;
        row.purge_after = null;
      }
      row.updated_at = updatedAt;
      row.updated_by_user_id = profile.id;
      await json(200, {
        eventId: row.id,
        updatedAt: row.updated_at,
        eventStatus: row.event_status,
        lifecycle: row.deleted_at ? 'trash' : row.archived_at ? 'archived' : 'active',
        archivedAt: row.archived_at,
        deletedAt: row.deleted_at,
        purgeAfter: row.purge_after ?? null,
        replayed: false,
      });
      return;
    }

    if (url.pathname === '/functions/v1/agenda-event-create' && method === 'POST') {
      const requestBody = request.postDataJSON();
      const event = requestBody.event;
      const key = request.headers()['idempotency-key'] || '';
      const decisions = Array.isArray(requestBody.protectedTimeDecisions) ? requestBody.protectedTimeDecisions : [];
      idempotencyRequests.push({ key, event, protectedTimeDecisions: decisions });
      const accepted = new Map(decisions.map((item) => [
        item.blockId + ':' + item.occurrenceStartsAt,
        item,
      ]));
      const hasExplicitDecisions = protectedTimeConflicts.every((conflict) => {
        const choice = accepted.get(conflict.conflictKey);
        return choice
          && choice.blockUpdatedAt === conflict.blockUpdatedAt
          && choice.decision === conflict.requiredDecision;
      });
      if (protectedTimeConflicts.length && !hasExplicitDecisions) {
        await json(409, { error: 'PROTECTED_TIME_CONFLICTS', conflicts: protectedTimeConflicts });
        return;
      }
      const createdAt = '2026-11-22T18:00:00.000Z';
      const row = {
        id: '0190f47a-7b2c-7abc-8def-0123456789be',
        owner_user_id: profile.id,
        created_by_user_id: profile.id,
        updated_by_user_id: profile.id,
        title: event.title,
        description: event.description ?? null,
        location_label: event.locationLabel ?? null,
        location_kind: event.locationKind ?? null,
        event_status: event.eventStatus || 'confirmed',
        temporal_kind: event.temporalKind,
        start_date: event.startDate ?? null,
        end_date_exclusive: event.endDateExclusive ?? null,
        start_local: event.startLocalDateTime ?? null,
        end_local: event.endLocalDateTime ?? null,
        time_zone: event.timeZone ?? event.sourceTimeZone ?? null,
        starts_at: event.startsAt ?? null,
        ends_at: event.endsAt ?? null,
        protected_time_decisions: decisions,
        archived_at: null,
        deleted_at: null,
        created_at: createdAt,
        updated_at: createdAt,
      };
      calendarEvents.unshift(row);
      insertedAgendaEvents.push(row);
      await json(201, { eventId: row.id, createdAt, eventStatus: row.event_status, replayed: false });
      return;
    }

    if (url.pathname === '/functions/v1/inbox-processing-queue' && method === 'POST') {
      const payload = request.postDataJSON();
      const run = {
        id: '00000000-0000-7000-8000-000000000901',
        capture_id: payload.captureId,
        status: 'queued',
        created_at: new Date().toISOString(),
        result: {},
      };
      processingRuns.unshift(run);
      queueRequests.push(payload);
      await json(200, { runId: run.id, replayed: false });
      return;
    }

    if (url.pathname === '/functions/v1/inbox-processing-process' && method === 'POST') {
      const payload = request.postDataJSON();
      processingRequests.push(payload);
      const run = processingRuns.find((item) => item.id === payload.runId);
      const capture = run && captures.find((item) => item.id === run.capture_id);
      const part = capture && captureParts.find((item) => item.capture_id === capture.id);
      if (!run || !capture || !part) {
        await json(404, { error: 'PROCESSING_FIXTURE_NOT_FOUND' });
        return;
      }
      part.category = 'task';
      part.interpretation = 'Sugerencia heurística; requiere confirmación.';
      part.review_status = 'unreviewed';
      run.status = 'succeeded';
      run.result = {
        engine: 'deterministic-rules',
        processorVersion: 'inbox-rules-v1',
        classification: 'advisory-only',
        proposals: [{ partIndex: 0, category: 'task', confidence: 0.68, requiresClarification: false }],
      };
      capture.processing_status = 'processed';
      await json(200, { status: 'succeeded', engine: 'deterministic-rules', proposalCount: 1 });
      return;
    }

    if (url.pathname === '/rest/v1/rpc/find_inbox_duplicate_captures' && method === 'POST') {
      const payload = request.postDataJSON();
      const ids = Array.isArray(payload.p_capture_ids) ? payload.p_capture_ids : [];
      const duplicates = ids.map((id) => {
        const source = captures.find((capture) => capture.id === id && !capture.deleted_at);
        if (!source) return null;
        const normalized = normalizeCaptureForDuplicate(source.content_original);
        const matching = captures.filter((capture) => !capture.deleted_at
          && capture.owner_user_id === source.owner_user_id
          && normalizeCaptureForDuplicate(capture.content_original) === normalized);
        return matching.length > 1
          ? { capture_id: id, duplicate_count: matching.length, matching_capture_ids: matching.map((capture) => capture.id) }
          : null;
      }).filter(Boolean);
      await json(200, duplicates);
      return;
    }

    if (url.pathname === '/rest/v1/audit_event' && method === 'GET') {
      const entityId = url.searchParams.get('entity_id')?.replace(/^eq\./, '');
      const entityType = url.searchParams.get('entity_type')?.replace(/^eq\./, '');
      const action = url.searchParams.get('action')?.replace(/^eq\./, '');
      const matching = reviewAuditEvents.filter((entry) =>
        (!entityId || entry.entity_id === entityId)
        && (!entityType || entry.entity_type === entityType)
        && (!action || entry.action === action)
      ).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 30);
      await json(200, matching);
      return;
    }

    if (url.pathname === '/rest/v1/rpc/set_inbox_capture_attention_status' && method === 'POST') {
      const payload = request.postDataJSON();
      const capture = captures.find((item) => item.id === payload.p_capture_id);
      if (!capture || capture.deleted_at) { await json(200, false); return; }
      const before = capture.attention_status;
      if (before !== payload.p_attention_status) {
        capture.attention_status = payload.p_attention_status;
        updatedCaptures.push({ ...capture });
        reviewAuditEvents.push({
          id: payload.p_audit_id,
          entity_type: 'capture',
          entity_id: capture.id,
          action: 'capture.attention_status_changed',
          occurred_at: new Date().toISOString(),
          details: { attention_status_before: before, attention_status_after: payload.p_attention_status },
        });
      }
      await json(200, true);
      return;
    }

    if (url.pathname === '/rest/v1/rpc/review_inbox_capture_part' && method === 'POST') {
      const payload = request.postDataJSON();
      const part = captureParts.find((item) => item.id === payload.p_capture_part_id);
      reviewRequests.push(payload);
      if (!part) { await json(200, false); return; }
      const before = {
        category: part.category,
        interpretation: part.interpretation,
        review_status: part.review_status,
      };
      Object.assign(part, {
        category: payload.p_category ?? part.category,
        interpretation: payload.p_interpretation ?? part.interpretation,
        review_status: payload.p_review_status,
      });
      reviewAuditEvents.push({
        id: payload.p_audit_id,
        entity_type: 'capture_part',
        entity_id: part.id,
        action: 'capture.part_reviewed',
        occurred_at: new Date().toISOString(),
        details: {
          category_before: before.category,
          category_after: part.category,
          interpretation_before: before.interpretation,
          interpretation_after: part.interpretation,
          review_status_before: before.review_status,
          review_status_after: part.review_status,
        },
      });
      updatedCaptureParts.push({ id: part.id, category: part.category, interpretation: part.interpretation, review_status: part.review_status });
      await json(200, true);
      return;
    }

    if (url.pathname === '/rest/v1/rpc/trash_inbox_capture' && method === 'POST') {
      const payload = request.postDataJSON();
      const capture = captures.find((item) => item.id === payload.p_capture_id);
      trashRequests.push({ action: 'trash', ...payload });
      if (!capture || capture.deleted_at) { await json(200, false); return; }
      const now = Date.now();
      capture.deleted_at = new Date(now).toISOString();
      capture.purge_after = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
      await json(200, true);
      return;
    }

    if (url.pathname === '/rest/v1/rpc/restore_inbox_capture' && method === 'POST') {
      const payload = request.postDataJSON();
      const capture = captures.find((item) => item.id === payload.p_capture_id);
      trashRequests.push({ action: 'restore', ...payload });
      if (!capture || !capture.deleted_at || new Date(capture.purge_after).getTime() <= Date.now()) {
        await json(200, false);
        return;
      }
      capture.deleted_at = null;
      capture.purge_after = null;
      await json(200, true);
      return;
    }

    if (url.pathname === '/rest/v1/rpc/sync_inbox_offline_text_capture' && method === 'POST') {
      const payload = request.postDataJSON();
      offlineSyncRequests.push(payload);
      const captureId = payload.p_capture_id;
      const partId = payload.p_part_id;
      const contentOriginal = payload.p_content_original;
      if (typeof captureId !== 'string' || typeof partId !== 'string'
        || typeof contentOriginal !== 'string' || !contentOriginal.trim()) {
        await json(400, { message: 'INVALID_OFFLINE_SYNC_FIXTURE' });
        return;
      }

      const existing = offlineSyncedCaptures.get(captureId);
      if (existing && (existing.part_id !== partId || existing.content_original !== contentOriginal)) {
        await json(409, { message: 'OFFLINE_IDEMPOTENCY_PAYLOAD_MISMATCH' });
        return;
      }
      const replayed = Boolean(existing);
      if (!existing) {
        offlineSyncedCaptures.set(captureId, {
          capture_id: captureId,
          part_id: partId,
          content_original: contentOriginal,
        });
        captures.unshift({
          id: captureId,
          owner_user_id: profile.id,
          created_by_user_id: profile.id,
          input_type: 'text',
          content_original: contentOriginal,
          attention_status: 'needs_review',
          processing_status: 'not_started',
          sync_status: 'synced',
          captured_at: payload.p_captured_at,
          deleted_at: null,
        });
        captureParts.push({
          id: partId,
          capture_id: captureId,
          part_index: 0,
          original_fragment: contentOriginal,
          interpretation: null,
          category: null,
          review_status: 'unreviewed',
        });
      }
      offlineSyncReplayFlags.push(replayed);

      // Model a committed server write whose acknowledgement was lost in transit.
      // The next identical request must return the same IDs as an idempotent replay.
      if (offlineSyncFailuresRemaining > 0) {
        offlineSyncFailuresRemaining -= 1;
        await json(503, { message: 'SYNTHETIC_SYNC_ACKNOWLEDGEMENT_LOST' });
        return;
      }
      await json(200, [{
        capture_id: captureId,
        part_id: partId,
        replayed,
      }]);
      return;
    }

    if (url.pathname === '/rest/v1/capture_audio_asset' && method === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      insertedVoiceAssets.push(...rows);
      await json(201, rows, { 'content-range': '0-0/*' });
      return;
    }

    const privateAudioObjectPrefix = '/storage/v1/object/inbox-voice-private/';
    if (url.pathname.startsWith(privateAudioObjectPrefix) && method === 'POST') {
      const objectPath = decodeURIComponent(url.pathname.slice(privateAudioObjectPrefix.length));
      uploadedVoiceObjects.push({
        objectPath,
        contentType: request.headers()['content-type'] || '',
      });
      await json(200, { Key: 'inbox-voice-private/' + objectPath });
      return;
    }

    if (url.pathname === '/functions/v1/inbox-voice-finalize' && method === 'POST') {
      const payload = request.postDataJSON();
      voiceFinalizeRequests.push(payload);
      await json(200, { verified: true, assetId: payload.assetId });
      return;
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      await json(200, []);
      return;
    }

    await json(404, { message: `Unexpected mocked Supabase request: ${method} ${url.pathname}` });
  });

  return { signedOutRequests, insertedTasks, updatedTasks, calendarEvents, protectedTimeBlocks, protectedTimeMutationRequests, protectedTimeConflicts, insertedAgendaEvents, idempotencyRequests, mutationRequests, updatedNoteIdeas, updatedLists, taskRows, projects, insertedProjects, updatedProjects, projectLinks, insertedProjectLinks, updatedProjectLinks, contributionRelations, insertedContributionRelations, updatedContributionRelations, areas, insertedAreas, updatedAreas, goals, insertedGoals, updatedGoals, subgoals, insertedSubgoals, updatedSubgoals, captures, updatedCaptures, insertedCaptures, captureParts, updatedCaptureParts, insertedCaptureParts, processingRuns, queueRequests, processingRequests, reviewRequests, reviewAuditEvents, trashRequests, offlineSyncRequests, offlineSyncReplayFlags, offlineSyncedCaptures, insertedVoiceAssets, uploadedVoiceObjects, voiceFinalizeRequests, captureLinks, insertedCaptureLinks, noteIdeas, insertedNoteIdeas, lists, insertedLists, listItems, insertedListItems, updatedListItems };
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
  await expect(createTaskDialog.locator('.task-estimate-help')).toContainText('no inicia un temporizador');
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
  await expect(editor.locator('.task-estimate-help')).toContainText('no inicia un temporizador');
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

  // The capability notice must match the implemented private voice/offline behavior.
  const capabilityNotice = page.locator('.honest-note');
  await expect(capabilityNotice).toContainText('reglas locales deterministas (no con un modelo de IA)');
  await expect(capabilityNotice).toContainText('grabaciones de voz se guardan en almacenamiento privado');
  await expect(capabilityNotice).toContainText('todavía no se transcriben ni se envían a un modelo');
  await expect(capabilityNotice).toContainText('modo sin conexión cifra las capturas en este dispositivo');
  await expect(capabilityNotice).toContainText('clave de recuperación fuera del dispositivo');

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


test('Inbox clears the composer after a partial save so retry cannot duplicate the source capture', async ({ page }) => {
  const { captures, insertedCaptures, captureParts, queueRequests, processingRequests } =
    await mockSupabaseSession(page, {
      captures: [],
      captureParts: [],
      capturePartInitialInsertError: true,
    });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const original = 'Comprar café para la semana';
  const composer = page.getByPlaceholder('Escribe aquí lo que tienes en mente…');
  await composer.fill(original);
  await page.getByRole('button', { name: 'Guardar captura' }).click();

  await expect(page.getByText('Captura guardada.')).toBeVisible();
  await expect(composer).toHaveValue('');
  await expect(page.getByRole('alert')).toContainText('No lo vuelvas a enviar');
  expect(captures).toHaveLength(1);
  expect(insertedCaptures).toHaveLength(1);
  expect(insertedCaptures[0].content_original).toBe(original);
  expect(captureParts).toHaveLength(0);
  expect(queueRequests).toHaveLength(1);
  expect(processingRequests).toHaveLength(1);

  // The user can recover this same saved source instead of submitting it again.
  await page.getByRole('button', { name: 'Organizar captura: ' + original }).click();
  await expect(page.getByText('CAPTURA ORIGINAL · NO SE MODIFICA')).toBeVisible();
  expect(captures).toHaveLength(1);
  expect(insertedCaptures).toHaveLength(1);
  expect(captureParts).toHaveLength(1);
  expect(captureParts[0].original_fragment).toBe(original);
});

test('Inbox recovers and organizes a saved text capture whose first fragment insert previously failed', async ({ page }) => {
  const { captures, captureParts, insertedCaptureParts, captureLinks, insertedNoteIdeas, reviewRequests, updatedCaptures } =
    await mockSupabaseSession(page, { captureParts: [] });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const capture = captures[0];
  await page.getByRole('button', { name: 'Organizar captura: ' + capture.content_original }).click();
  await expect(page.getByText('CAPTURA ORIGINAL · NO SE MODIFICA')).toBeVisible();
  expect(insertedCaptureParts).toHaveLength(1);
  expect(captureParts[0]).toMatchObject({
    capture_id: capture.id,
    part_index: 0,
    original_fragment: capture.content_original,
  });

  await page.getByRole('button', { name: 'Confirmar y organizar' }).click();
  await expect(page.getByText('Captura guardada como nota.')).toBeVisible();
  expect(insertedNoteIdeas).toHaveLength(1);
  expect(captureLinks).toHaveLength(1);
  expect(reviewRequests).toHaveLength(1);
  expect(reviewRequests[0].p_capture_part_id).toBe(insertedCaptureParts[0].id);
  expect(capture.attention_status).toBe('reviewed');
  expect(updatedCaptures.some((row) => row.id === capture.id && row.attention_status === 'reviewed')).toBe(true);
});

test('Inbox reuses the exact initial part when another session wins the recovery insert race', async ({ page }) => {
  const { captures, captureParts, insertedCaptureParts, captureLinks, insertedNoteIdeas, reviewRequests, updatedCaptures } =
    await mockSupabaseSession(page, { captureParts: [], capturePartRecoveryConflict: true });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const capture = captures[0];
  await page.getByRole('button', { name: 'Organizar captura: ' + capture.content_original }).click();
  await expect(page.getByText('CAPTURA ORIGINAL · NO SE MODIFICA')).toBeVisible();
  expect(insertedCaptureParts).toHaveLength(0);
  expect(captureParts).toHaveLength(1);
  expect(captureParts[0]).toMatchObject({
    id: '00000000-0000-7000-8000-000000000210',
    capture_id: capture.id,
    part_index: 0,
    original_fragment: capture.content_original,
  });

  await page.getByRole('button', { name: 'Confirmar y organizar' }).click();
  await expect(page.getByText('Captura guardada como nota.')).toBeVisible();
  expect(insertedNoteIdeas).toHaveLength(1);
  expect(captureLinks).toHaveLength(1);
  expect(reviewRequests).toHaveLength(1);
  expect(reviewRequests[0].p_capture_part_id).toBe(captureParts[0].id);
  expect(updatedCaptures.some((row) => row.id === capture.id && row.attention_status === 'reviewed')).toBe(true);
});

test('Inbox refuses to invent fragments for an already processed capture', async ({ page }) => {
  const capture = {
    id: '00000000-0000-7000-8000-000000000777',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    input_type: 'text',
    content_original: 'Processed capture with missing part history',
    attention_status: 'needs_review',
    processing_status: 'processed',
    sync_status: 'synced',
    captured_at: '2026-11-23T12:00:00.000Z',
    deleted_at: null,
  };
  const { captures, captureParts, insertedCaptureParts } = await mockSupabaseSession(page, {
    captures: [capture],
    captureParts: [],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await page.getByRole('button', { name: 'Organizar captura: ' + capture.content_original }).click();
  await expect(page.getByRole('alert')).toContainText('ya fue procesada');
  await expect(page.getByText(capture.content_original)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(insertedCaptureParts).toHaveLength(0);
  expect(captureParts).toHaveLength(0);
  expect(captures).toHaveLength(1);
});

test('Inbox runs advisory processing, records review, and restores soft-deleted captures', async ({ page }) => {
  const { captures, captureParts, processingRuns, queueRequests, processingRequests, reviewRequests, trashRequests, insertedTasks } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const original = captures[0].content_original;
  await page.getByRole('button', { name: 'Generar sugerencias' }).first().click();
  await expect(page.getByText('Propuestas preparadas. Revisa cada fragmento; no se creó ningún destino automáticamente.')).toBeVisible();
  expect(queueRequests).toHaveLength(1);
  expect(processingRequests).toHaveLength(1);
  expect(processingRuns[0].result).toMatchObject({
    engine: 'deterministic-rules',
    classification: 'advisory-only',
  });
  expect(captureParts[0]).toMatchObject({ category: 'task', review_status: 'unreviewed', original_fragment: original });
  expect(insertedTasks).toHaveLength(0);
  await expect(page.getByText('Afinidad heurística: 68%')).toBeVisible();

  await page.getByRole('button', { name: 'Descartar sugerencia' }).click();
  await expect(page.getByText('Sugerencia descartada y decisión registrada en auditoría.')).toBeVisible();
  expect(reviewRequests.at(-1)).toMatchObject({
    p_capture_part_id: captureParts[0].id,
    p_review_status: 'rejected',
  });
  expect(captureParts[0].review_status).toBe('rejected');

  await page.getByRole('button', { name: 'Enviar a papelera' }).first().click();
  await expect(page.getByText('Captura movida a la papelera. Se conservará durante 30 días antes de poder purgarse.')).toBeVisible();
  expect(trashRequests.at(-1).action).toBe('trash');
  expect(captures[0].deleted_at).toBeTruthy();
  expect(new Date(captures[0].purge_after).getTime() - new Date(captures[0].deleted_at).getTime()).toBe(30 * 24 * 60 * 60 * 1000);

  await page.getByLabel('Filtrar capturas por revisión').selectOption('trash');
  await expect(page.getByText(original)).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar desde papelera' }).click();
  await expect(page.getByText('Captura restaurada desde la papelera.')).toBeVisible();
  expect(trashRequests.at(-1).action).toBe('restore');
  expect(captures[0].deleted_at).toBeNull();
  expect(captures[0].purge_after).toBeNull();
  await page.getByLabel('Filtrar capturas por revisión').selectOption('needs_review');
  await expect(page.getByText(original)).toBeVisible();
  expect(insertedTasks).toHaveLength(0);
});


test('Inbox keeps Request and Habit suggestions unavailable until the owner chooses a supported destination', async ({ page }) => {
  const captures = [
    {
      id: '00000000-0000-7000-8000-000000000701',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      input_type: 'text',
      content_original: 'Solicitud: coordinar con el proveedor',
      attention_status: 'needs_review',
      processing_status: 'processed',
      sync_status: 'synced',
      captured_at: '2026-11-19T14:00:00.000Z',
      deleted_at: null,
    },
    {
      id: '00000000-0000-7000-8000-000000000702',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      input_type: 'text',
      content_original: 'Hábito: entrenar cuatro veces por semana',
      attention_status: 'needs_review',
      processing_status: 'processed',
      sync_status: 'synced',
      captured_at: '2026-11-19T13:00:00.000Z',
      deleted_at: null,
    },
  ];
  const captureParts = [
    {
      id: '00000000-0000-7000-8000-000000000711',
      capture_id: captures[0].id,
      part_index: 0,
      original_fragment: captures[0].content_original,
      category: 'request',
      review_status: 'unreviewed',
    },
    {
      id: '00000000-0000-7000-8000-000000000712',
      capture_id: captures[1].id,
      part_index: 0,
      original_fragment: captures[1].content_original,
      category: 'habit',
      review_status: 'unreviewed',
    },
  ];
  const processingRuns = captures.map((capture, index) => ({
    id: '00000000-0000-7000-8000-00000000073' + index,
    capture_id: capture.id,
    created_at: capture.captured_at,
    result: { proposals: [{ partIndex: 0, requiresClarification: false, clarificationPrompt: null }] },
  }));
  const { insertedTasks, insertedCaptureLinks, reviewRequests } = await mockSupabaseSession(page, {
    captures,
    captureParts,
    processingRuns,
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await page.getByRole('button', { name: 'Organizar captura: Solicitud: coordinar con el proveedor' }).click();
  let organizer = page.getByRole('dialog', { name: 'Organizar captura' });
  await expect(organizer.getByLabel('Tipo de destino')).toHaveValue('request');
  await expect(organizer.getByText(/La clasificación se conserva como Solicitud/)).toBeVisible();
  await expect(organizer.getByRole('button', { name: /Destino aún no disponible/ })).toBeDisabled();
  expect(insertedTasks).toHaveLength(0);
  expect(insertedCaptureLinks).toHaveLength(0);
  await organizer.getByLabel('Tipo de destino').selectOption('task');
  await organizer.getByRole('button', { name: 'Confirmar y organizar' }).click();
  await expect(page.getByText('Captura organizada como tarea.')).toBeVisible();
  expect(insertedTasks).toHaveLength(1);
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(reviewRequests.at(-1)).toMatchObject({
    p_capture_part_id: captureParts[0].id,
    p_category: 'task',
    p_review_status: 'accepted',
  });

  await page.getByRole('button', { name: 'Organizar captura: Hábito: entrenar cuatro veces por semana' }).click();
  organizer = page.getByRole('dialog', { name: 'Organizar captura' });
  await expect(organizer.getByLabel('Tipo de destino')).toHaveValue('habit');
  await expect(organizer.getByText(/La clasificación se conserva como Hábito/)).toBeVisible();
  await expect(organizer.getByRole('button', { name: /Destino aún no disponible/ })).toBeDisabled();
  expect(insertedTasks).toHaveLength(1);
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(reviewRequests).toHaveLength(1);
});


test('Inbox requires an explicit clarification before accepting an ambiguous proposal', async ({ page }) => {
  const capture = {
    id: '00000000-0000-7000-8000-000000000721',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    input_type: 'text',
    content_original: 'Pensar en cómo mejorar mi rutina',
    attention_status: 'needs_review',
    processing_status: 'processed',
    sync_status: 'synced',
    captured_at: '2026-11-19T15:00:00.000Z',
    deleted_at: null,
  };
  const part = {
    id: '00000000-0000-7000-8000-000000000722',
    capture_id: capture.id,
    part_index: 0,
    original_fragment: capture.content_original,
    category: 'note_idea',
    review_status: 'unreviewed',
  };
  const processingRun = {
    id: '00000000-0000-7000-8000-000000000723',
    capture_id: capture.id,
    created_at: '2026-11-19T15:01:00.000Z',
    result: {
      proposals: [{
        partIndex: 0,
        confidence: 0.42,
        requiresClarification: true,
        clarificationPrompt: '¿Qué quieres hacer o recordar con este texto?',
      }],
    },
  };
  const { insertedNoteIdeas, reviewRequests } = await mockSupabaseSession(page, {
    captures: [capture],
    captureParts: [part],
    processingRuns: [processingRun],
    processingRunDelayMs: 350,
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await expect(page.getByText(/necesita aclaración/)).toBeVisible();
  await page.getByRole('button', { name: 'Organizar captura: Pensar en cómo mejorar mi rutina' }).click();
  const organizer = page.getByRole('dialog', { name: 'Organizar captura' });
  const confirm = organizer.getByRole('button', { name: 'Confirmar y organizar' });
  await expect(organizer.getByText('Verificando si la sugerencia necesita aclaración…')).toBeVisible();
  await expect(confirm).toBeDisabled();
  await expect(organizer.getByText('¿Qué quieres hacer o recordar con este texto?')).toBeVisible();
  await expect(organizer.getByLabel('Aclaración / interpretación')).toBeVisible();
  await expect(confirm).toBeDisabled();
  await organizer.getByLabel('Aclaración / interpretación').fill('Es una idea para diseñar una rutina semanal sostenible.');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText('Captura guardada como nota.')).toBeVisible();
  expect(insertedNoteIdeas).toHaveLength(1);
  expect(reviewRequests.at(-1)).toMatchObject({
    p_capture_part_id: part.id,
    p_category: 'note_idea',
    p_review_status: 'accepted',
    p_interpretation: 'Es una idea para diseñar una rutina semanal sostenible.',
  });
  expect(capture.content_original).toBe('Pensar en cómo mejorar mi rutina');
});

test('Inbox searches and paginates the complete capture archive beyond the first 250 rows', async ({ page }) => {
  const olderCaptures = Array.from({ length: 257 }, (_, index) => ({
    id: `00000000-0000-7000-8000-${String(1000000000 + index).padStart(12, '0')}`,
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    input_type: 'text',
    content_original: index === 256 ? 'ARCHIVE_TAIL_UNIQUE_TERM' : `Historical capture ${index + 1}`,
    attention_status: 'needs_review',
    processing_status: 'not_started',
    sync_status: 'synced',
    captured_at: new Date(Date.UTC(2026, 10, 23 - index)).toISOString(),
    deleted_at: null,
  }));
  const { captures } = await mockSupabaseSession(page, { captures: olderCaptures });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await expect(page.getByText('Historical capture 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Historical capture 257', { exact: true })).toHaveCount(0);
  // Initial page is 0–99; two more pages cover rows 100–256.
  await page.getByRole('button', { name: 'Cargar más capturas' }).click();
  await page.getByRole('button', { name: 'Cargar más capturas' }).click();
  await expect(page.getByText('ARCHIVE_TAIL_UNIQUE_TERM')).toBeVisible();

  await page.getByLabel('Buscar capturas').fill('ARCHIVE_TAIL_UNIQUE_TERM');
  await expect(page.getByText('ARCHIVE_TAIL_UNIQUE_TERM')).toBeVisible();
  expect(captures).toHaveLength(257);
});

test('Inbox ignores a delayed pagination response after the archive search changes', async ({ page }) => {
  const captures = Array.from({ length: 120 }, (_, index) => ({
    id: `00000000-0000-7000-8000-${String(1000001000 + index).padStart(12, '0')}`,
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    input_type: 'text',
    content_original: index === 110 ? 'SEARCH_RACE_TARGET_UNIQUE' : `Historical capture ${index + 1}`,
    attention_status: 'needs_review',
    processing_status: 'not_started',
    sync_status: 'synced',
    captured_at: new Date(Date.UTC(2026, 10, 23 - index)).toISOString(),
    deleted_at: null,
  }));
  await mockSupabaseSession(page, {
    captures,
    capturePageDelayStart: 100,
    capturePageDelayMs: 900,
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await expect(page.getByText('Historical capture 1', { exact: true })).toBeVisible();
  const delayedPageRequest = page.waitForRequest((request) =>
    request.url().includes('/rest/v1/capture')
      && new URL(request.url()).searchParams.get('offset') === '100'
      && new URL(request.url()).searchParams.get('limit') === '100'
  );
  await page.getByRole('button', { name: 'Cargar más capturas' }).click();
  await delayedPageRequest;
  await page.getByLabel('Buscar capturas').fill('SEARCH_RACE_TARGET_UNIQUE');
  await expect(page.getByText('SEARCH_RACE_TARGET_UNIQUE')).toBeVisible();
  await page.waitForTimeout(1100);

  await expect(page.getByText('SEARCH_RACE_TARGET_UNIQUE')).toBeVisible();
  await expect(page.getByText('Historical capture 101')).toHaveCount(0);
  await expect(page.getByText('Historical capture 1')).toHaveCount(0);
});

test('Inbox can link a capture to an existing Project and preserve provenance', async ({ page }) => {
  const project = {
    id: '019b6000-0000-7000-8000-000000000501',
    owner_user_id: profile.id, created_by_user_id: profile.id,
    name: 'Automatizar el negocio', purpose: 'Proyecto existente',
    status: 'active', archived_at: null, deleted_at: null,
  };
  const { captures, captureParts, insertedCaptureLinks, reviewRequests } = await mockSupabaseSession(page, { projects: [project] });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();
  await page.getByRole('button', { name: 'Organizar captura: Llamar al proveedor antes del viernes' }).click();
  const organizer = page.getByRole('dialog', { name: 'Organizar captura' });
  await organizer.getByLabel('Tipo de destino').selectOption('project');
  await organizer.getByLabel('Proyecto existente').selectOption(project.id);
  await organizer.getByRole('button', { name: 'Confirmar y organizar' }).click();
  await expect(page.getByText('Captura vinculada al proyecto existente.')).toBeVisible();
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(insertedCaptureLinks[0]).toMatchObject({ capture_part_id: captureParts[0].id, project_id: project.id, link_status: 'confirmed' });
  expect(reviewRequests.at(-1)).toMatchObject({ p_category: 'project', p_review_status: 'accepted' });
  await page.getByLabel('Filtrar capturas por revisión').selectOption('organized');
  await expect(page.getByRole('button', { name: 'Abrir proyectos' })).toBeVisible();
  expect(captures[0].content_original).toBe('Llamar al proveedor antes del viernes');
});

test('Inbox can link captures to existing Goals and Subgoals without duplicating objectives', async ({ page }) => {
  const goal = {
    id: '019b6000-0000-7000-8000-000000000601',
    owner_user_id: profile.id, created_by_user_id: profile.id,
    life_area_id: '019b6000-0000-7000-8000-000000000602',
    title: 'Alcanzar libertad financiera', status: 'active', archived_at: null, deleted_at: null,
  };
  const subgoal = {
    id: '019b6000-0000-7000-8000-000000000603',
    goal_id: goal.id, created_by_user_id: profile.id,
    title: 'Incrementar ingresos mensuales', status: 'active', archived_at: null, deleted_at: null,
  };
  const { captureParts, insertedCaptureLinks, reviewRequests } = await mockSupabaseSession(page, { goals: [goal], subgoals: [subgoal] });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await page.getByRole('button', { name: 'Organizar captura: Llamar al proveedor antes del viernes' }).click();
  let organizer = page.getByRole('dialog', { name: 'Organizar captura' });
  await organizer.getByLabel('Tipo de destino').selectOption('goal');
  await organizer.getByLabel('Meta existente').selectOption(goal.id);
  await organizer.getByRole('button', { name: 'Confirmar y organizar' }).click();
  await expect(page.getByText('Captura vinculada a la meta existente.')).toBeVisible();
  expect(insertedCaptureLinks[0]).toMatchObject({ capture_part_id: captureParts[0].id, goal_id: goal.id });
  expect(reviewRequests.at(-1)).toMatchObject({ p_category: 'goal_subgoal', p_review_status: 'accepted' });

  await page.getByLabel('Filtrar capturas por revisión').selectOption('organized');
  await expect(page.getByRole('button', { name: 'Abrir metas' })).toBeVisible();

  // This fixture starts as reviewed; the first capture is now organized and
  // excluded from this filter, so the second capture remains independently reviewable.
  await page.getByLabel('Filtrar capturas por revisión').selectOption('reviewed');
  await page.getByRole('button', { name: 'Organizar captura: Idea para mejorar el negocio' }).click();
  organizer = page.getByRole('dialog', { name: 'Organizar captura' });
  await organizer.getByLabel('Tipo de destino').selectOption('subgoal');
  await organizer.getByLabel('Submeta existente').selectOption(subgoal.id);
  await organizer.getByRole('button', { name: 'Confirmar y organizar' }).click();
  await expect(page.getByText('Captura vinculada a la submeta existente.')).toBeVisible();
  expect(insertedCaptureLinks[1]).toMatchObject({ capture_part_id: captureParts[1].id, subgoal_id: subgoal.id });
  expect(reviewRequests.at(-1)).toMatchObject({ p_category: 'goal_subgoal', p_review_status: 'accepted' });
});

test('Inbox marks normalized duplicate text without merging or deleting captures', async ({ page }) => {
  const { captures, captureParts, captureLinks } = await mockSupabaseSession(page);
  const duplicate = {
    ...captures[0],
    id: '00000000-0000-7000-8000-000000000111',
    content_original: 'LLAMAR AL PROVEEDOR ANTES DEL VIERNES!',
    captured_at: '2026-11-20T12:00:00.000Z',
  };
  captures.push(duplicate);
  captureParts.push({
    ...captureParts[0], id: '00000000-0000-7000-8000-000000000211',
    capture_id: duplicate.id,
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();
  await expect(page.getByText('Posible duplicado normalizado · revisar antes de combinar')).toHaveCount(2);
  expect(captures).toHaveLength(4);
  expect(captureLinks).toHaveLength(0);
  expect(captures.every((capture) => !capture.deleted_at)).toBe(true);
});

test('Inbox can turn a reviewed capture into an Agenda Event with an owner-scoped provenance link', async ({ page }) => {
  const { captures, captureParts, idempotencyRequests, insertedAgendaEvents, insertedCaptureLinks, reviewRequests, reviewAuditEvents } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hoy', exact: true })).toBeVisible();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await page.getByRole('button', { name: 'Organizar captura: Llamar al proveedor antes del viernes' }).click();
  const organizer = page.getByRole('dialog', { name: 'Organizar captura' });
  await organizer.getByLabel('Tipo de destino').selectOption('event');
  await organizer.getByLabel('Nombre del evento').fill('Llamar al proveedor');
  await organizer.getByLabel('Fecha del evento').fill('2026-11-27');
  await organizer.getByRole('button', { name: 'Confirmar y organizar' }).click();
  await expect(page.getByText('Evento creado en Agenda y vinculado al Inbox.')).toBeVisible();

  expect(idempotencyRequests).toHaveLength(1);
  expect(idempotencyRequests[0].event).toEqual({
    title: 'Llamar al proveedor',
    temporalKind: 'all_day',
    startDate: '2026-11-27',
    endDateExclusive: '2026-11-28',
  });
  expect(idempotencyRequests[0].key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(insertedAgendaEvents).toHaveLength(1);
  expect(insertedCaptureLinks).toHaveLength(1);
  expect(insertedCaptureLinks[0]).toMatchObject({
    capture_part_id: captureParts[0].id,
    calendar_event_id: insertedAgendaEvents[0].id,
    link_status: 'confirmed',
  });
  expect(reviewRequests.at(-1)).toMatchObject({
    p_capture_part_id: captureParts[0].id,
    p_category: 'event',
    p_review_status: 'accepted',
  });
  await page.getByLabel('Filtrar capturas por revisión').selectOption('organized');
  await page.getByRole('button', { name: 'Ver historial' }).click();
  await expect(page.getByText('Sin categoría → Evento')).toBeVisible();
  await expect(page.getByText('Después: Clasificación manual confirmada: evento de Agenda.')).toBeVisible();
  expect(reviewAuditEvents).toHaveLength(2);
  expect(reviewAuditEvents.map((event) => event.action).sort()).toEqual(['capture.attention_status_changed', 'capture.part_reviewed'].sort());
  expect(reviewAuditEvents.find((event) => event.action === 'capture.attention_status_changed').details).toMatchObject({ attention_status_before: 'needs_review', attention_status_after: 'reviewed' });
  await expect(page.getByRole('button', { name: 'Abrir Agenda' })).toBeVisible();
  expect(captures[0].content_original).toBe('Llamar al proveedor antes del viernes');
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
  const initialCaptureRow = page.locator('.capture-row').filter({ hasText: original });
  await expect(initialCaptureRow.getByRole('button', { name: 'Descartar sugerencia' })).toHaveCount(0);
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
  const organizedCaptureRow = page.locator('.capture-row').filter({ hasText: original });
  await expect(organizedCaptureRow.getByRole('button', { name: 'Generar sugerencias' })).toHaveCount(0);
  await expect(organizedCaptureRow.getByRole('button', { name: 'Reintentar procesamiento' })).toHaveCount(0);
  await expect(organizedCaptureRow.getByRole('button', { name: 'Descartar sugerencia' })).toHaveCount(0);
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
    { label: 'Agenda', heading: 'Agenda' },
    { label: 'Inbox', heading: 'Inbox' },
    { label: 'Objetivos', heading: 'Objetivos' },
    { label: 'Proyectos', heading: 'Proyectos' },
    { label: 'Más', heading: 'Tareas' },
  ];

  const sideNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(sideNavigation).toBeVisible();

  for (const destination of destinations) {
    const sideButton = destination.label === 'Más'
      ? sideNavigation.getByRole('button', { name: /Más$/ })
      : sideNavigation.getByRole('button', { name: new RegExp(destination.label) });
    await expect(sideButton).toHaveCount(1);
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

  const invoiceItemRow = page.locator('.list-card .list-items .list-item-wrap')
    .filter({ hasText: 'Revisar factura' });
  await expect(invoiceItemRow).toHaveCount(1);
  await invoiceItemRow.getByRole('button', { name: 'Editar elemento: Revisar factura' }).click();
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
  const today = await todayInBrowserHavana(page);
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
  const today = await todayInBrowserHavana(page);
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
  const today = await todayInBrowserHavana(page);
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
  await page.getByRole('button', { name: 'Restaurar tarea: Informe entregado' }).click();
  await expect(page.getByText('Tarea restaurada.')).toBeVisible();
  expect(completed.archived_at).toBeNull();
  expect(completed.status).toBe('completed');
  expect(completed.completed_at).toBe('2026-11-19T15:00:00.000Z');
  expect(completed.completion_outcome).toBe('complete');
  await archiveFilter.selectOption('active');
  await expect(page.getByText('Informe entregado', { exact: true })).toBeVisible();
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
  const task = (id, action, status = 'todo') => ({
    id, owner_user_id: profile.id, created_by_user_id: profile.id,
    action, description: null, status, priority: 2, due_date: null,
    estimated_duration_minutes: 30, time_zone: 'America/Havana',
    archived_at: null, deleted_at: null, created_at: '2026-11-20T12:00:00.000Z',
  });
  const first = task('00000000-0000-7000-8000-000000000704', 'Preparar propuesta comercial');
  const second = task('00000000-0000-7000-8000-000000000705', 'Actualizar métricas');
  const third = task('00000000-0000-7000-8000-000000000706', 'Llamar a nuevos clientes', 'blocked');
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
  const goalPendingTag = goalCard.locator('.goal-related-task-tag').filter({ has: page.getByText('Preparar propuesta comercial', { exact: true }) });
  const goalBlockedTag = goalCard.locator('.goal-related-task-tag').filter({ has: page.getByText('Llamar a nuevos clientes', { exact: true }) });
  await expect(goalPendingTag.locator('small')).toHaveText('Pendiente');
  await expect(goalBlockedTag.locator('small')).toHaveText('Bloqueada');
  await page.getByRole('button', { name: 'Submetas', exact: true }).click();
  const subgoalCard = page.locator('.subgoal-record-card').filter({ has: page.getByRole('heading', { name: subgoal.title }) });
  await expect(subgoalCard.getByText('Tareas que contribuyen · 2')).toBeVisible();
  await expect(subgoalCard.getByText('Preparar propuesta comercial')).toBeVisible();
  await expect(subgoalCard.getByText('Llamar a nuevos clientes')).toBeVisible();
  const subgoalPendingTag = subgoalCard.locator('.goal-related-task-tag').filter({ has: page.getByText('Preparar propuesta comercial', { exact: true }) });
  const subgoalBlockedTag = subgoalCard.locator('.goal-related-task-tag').filter({ has: page.getByText('Llamar a nuevos clientes', { exact: true }) });
  await expect(subgoalPendingTag.locator('small')).toHaveText('Pendiente');
  await expect(subgoalBlockedTag.locator('small')).toHaveText('Bloqueada');
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

test('Notes and ideas creation opens in a top-level dialog and saves from the dialog', async ({ page }) => {
  const { insertedNoteIdeas } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.locator('.side-nav').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('navigation', { name: 'Secciones de Más' }).getByRole('button', { name: 'Notas e ideas' }).click();

  const createButton = page.getByRole('button', { name: 'Nueva nota o idea' });
  await expect(createButton).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Nueva nota o idea' })).toHaveCount(0);

  await createButton.click();
  const dialog = page.getByRole('dialog', { name: 'Nueva nota o idea' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Tipo de nota').selectOption('idea');
  await dialog.getByLabel('Título (opcional)').fill('Idea desde diálogo');
  await dialog.getByLabel('Contenido').fill('Probar la ventana flotante de notas e ideas.');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await createButton.click();
  const reopenedDialog = page.getByRole('dialog', { name: 'Nueva nota o idea' });
  await expect(reopenedDialog.getByLabel('Título (opcional)')).toHaveValue('');
  await expect(reopenedDialog.getByLabel('Contenido')).toHaveValue('');
  await reopenedDialog.getByLabel('Tipo de nota').selectOption('idea');
  await reopenedDialog.getByLabel('Título (opcional)').fill('Idea desde diálogo');
  await reopenedDialog.getByLabel('Contenido').fill('Probar la ventana flotante de notas e ideas.');
  await reopenedDialog.getByRole('button', { name: /Guardar/ }).click();

  await expect(page.getByText('Idea guardada.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Nueva nota o idea' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Idea desde diálogo' })).toBeVisible();
  expect(insertedNoteIdeas).toHaveLength(1);
  expect(insertedNoteIdeas[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    kind: 'idea',
    title: 'Idea desde diálogo',
    content: 'Probar la ventana flotante de notas e ideas.',
    status: 'active',
  });
});

test('List creation opens in a top-level dialog and saves from the dialog', async ({ page }) => {
  const { lists, insertedLists } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await page.locator('.side-nav').getByRole('button', { name: /Más/ }).click();
  await page.getByRole('navigation', { name: 'Secciones de Más' }).getByRole('button', { name: 'Listas' }).click();

  const createButton = page.getByRole('button', { name: 'Nueva lista' });
  await expect(createButton).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Crear una lista' })).toHaveCount(0);

  await createButton.click();
  const dialog = page.getByRole('dialog', { name: 'Crear una lista' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nombre de la lista').fill('Lista desde diálogo');
  await dialog.getByLabel('Propósito (opcional)').fill('Comprobar la creación en ventana flotante.');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);

  await createButton.click();
  const reopenedDialog = page.getByRole('dialog', { name: 'Crear una lista' });
  await expect(reopenedDialog.getByLabel('Nombre de la lista')).toHaveValue('');
  await expect(reopenedDialog.getByLabel('Propósito (opcional)')).toHaveValue('');
  await reopenedDialog.getByLabel('Nombre de la lista').fill('Lista desde diálogo');
  await reopenedDialog.getByLabel('Propósito (opcional)').fill('Comprobar la creación en ventana flotante.');
  await reopenedDialog.getByRole('button', { name: /Crear lista/ }).click();

  await expect(page.getByText('Lista creada.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Crear una lista' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Lista desde diálogo' })).toBeVisible();
  expect(insertedLists).toHaveLength(1);
  expect(lists[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    name: 'Lista desde diálogo',
    purpose: 'Comprobar la creación en ventana flotante.',
    status: 'active',
  });
});


test('Agenda navigates day, week and month views and creates a confirmed all-day Event through the authenticated Edge writer', async ({ page }) => {
  const today = await todayInBrowserHavana(page);
  const tomorrow = await page.evaluate((value) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }, today);
  const seedEvents = [{
    id: '0190f47a-7b2c-7abc-8def-0123456789bf',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    updated_by_user_id: profile.id,
    title: 'Día de familia',
    description: null,
    location_label: null,
    location_kind: null,
    event_status: 'confirmed',
    temporal_kind: 'all_day',
    start_date: today,
    end_date_exclusive: tomorrow,
    archived_at: null,
    deleted_at: null,
    created_at: '2026-11-22T17:00:00.000Z',
    updated_at: '2026-11-22T17:00:00.000Z',
  }];
  const { calendarEvents, insertedAgendaEvents, idempotencyRequests } = await mockSupabaseSession(page, {
    calendarEvents: seedEvents,
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  const sideNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await sideNavigation.getByRole('button', { name: /Agenda/ }).click();
  await expect(page.locator('.page-heading h1')).toHaveText('Agenda');
  await expect(page.getByText('Día de familia')).toBeVisible();

  await page.getByRole('button', { name: 'Día', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agenda diaria' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Día de familia/ })).toBeVisible();

  await page.getByRole('button', { name: 'Mes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agenda mensual' })).toBeVisible();
  await expect(page.getByText('Día de familia')).toBeVisible();

  await page.getByRole('button', { name: 'Nuevo evento' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear evento' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nombre del evento').fill('Mi compromiso nuevo');
  await dialog.getByLabel('Descripción (opcional)').fill('Evento creado desde Agenda.');
  await dialog.getByLabel('Desde', { exact: true }).fill(today);
  await dialog.getByLabel('Hasta (incluido)', { exact: true }).fill(today);
  await dialog.getByRole('button', { name: 'Guardar evento' }).click();

  await expect(page.getByText('Evento guardado en Agenda.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Mi compromiso nuevo')).toBeVisible();
  expect(insertedAgendaEvents).toHaveLength(1);
  expect(calendarEvents).toHaveLength(2);
  expect(insertedAgendaEvents[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    updated_by_user_id: profile.id,
    title: 'Mi compromiso nuevo',
    event_status: 'confirmed',
    temporal_kind: 'all_day',
    start_date: today,
    end_date_exclusive: tomorrow,
  });
  expect(idempotencyRequests).toHaveLength(1);
  expect(idempotencyRequests[0].key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(idempotencyRequests[0].event).toMatchObject({
    title: 'Mi compromiso nuevo',
    temporalKind: 'all_day',
    startDate: today,
    endDateExclusive: tomorrow,
  });
});

test('Agenda keeps day, week and month controls usable on a 390px mobile screen without page overflow', async ({ page }) => {
  await mockSupabaseSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  const mobileNavigation = page.getByRole('navigation', { name: 'Navegación móvil' });
  await mobileNavigation.getByRole('button', { name: /Agenda/ }).click();
  await expect(page.locator('.page-heading h1')).toHaveText('Agenda');
  for (const view of ['Día', 'Semana', 'Mes']) {
    const control = page.getByRole('button', { name: view, exact: true });
    await expect(control).toBeVisible();
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'true');
  }
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.getByRole('button', { name: 'Nuevo evento' })).toBeVisible();
});


test('Agenda edits, cancels, reopens, finishes, archives, trashes and restores Events through the authenticated mutation endpoint', async ({ page }) => {
  const today = await todayInBrowserHavana(page);
  const tomorrow = await page.evaluate((value) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }, today);
  const seedEvent = {
    id: '0190f47a-7b2c-7abc-8def-0123456789c1',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    updated_by_user_id: profile.id,
    title: 'Evento de prueba',
    description: 'Compromiso original',
    location_label: 'Casa',
    location_kind: 'physical',
    event_status: 'confirmed',
    temporal_kind: 'all_day',
    start_date: today,
    end_date_exclusive: tomorrow,
    start_local: null,
    end_local: null,
    time_zone: null,
    starts_at: null,
    ends_at: null,
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    created_at: '2026-11-22T17:00:00.000Z',
    updated_at: '2026-11-22T17:00:00.000000Z',
  };
  const { calendarEvents, mutationRequests } = await mockSupabaseSession(page, {
    calendarEvents: [seedEvent],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  const navigation = page.getByRole('navigation', { name: 'Navegación principal' });
  await navigation.getByRole('button', { name: /Agenda/ }).click();

  const openEvent = async (title) => {
    await page.locator('.agenda-event-chip').filter({ hasText: title }).first().click();
  };
  await openEvent('Evento de prueba');
  let detail = page.getByRole('dialog', { name: 'Evento de prueba' });
  await detail.getByRole('button', { name: 'Editar' }).click();

  const editDialog = page.getByRole('dialog', { name: 'Editar evento' });
  await editDialog.getByLabel('Nombre del evento').fill('Evento editado');
  await editDialog.getByLabel('Descripción (opcional)').fill('Compromiso actualizado');
  await editDialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  await expect(page.locator('.agenda-event-chip').filter({ hasText: 'Evento editado' })).toBeVisible();
  expect(mutationRequests[0].payload).toMatchObject({
    action: 'edit',
    eventId: seedEvent.id,
    event: { title: 'Evento editado', temporalKind: 'all_day', startDate: today, endDateExclusive: tomorrow },
  });
  expect(mutationRequests[0].key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(calendarEvents[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    updated_by_user_id: profile.id,
    title: 'Evento editado',
    description: 'Compromiso actualizado',
  });

  await openEvent('Evento editado');
  detail = page.getByRole('dialog', { name: 'Evento editado' });
  await detail.getByRole('button', { name: 'Cancelar evento' }).click();
  let confirm = page.getByRole('alertdialog', { name: 'Cancelar evento' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Confirmar cancelación' }).click();
  await expect(page.getByText('Evento cancelado.')).toBeVisible();
  expect(calendarEvents[0].event_status).toBe('cancelled');

  await openEvent('Evento editado');
  detail = page.getByRole('dialog', { name: 'Evento editado' });
  await detail.getByRole('button', { name: 'Reabrir' }).click();
  await expect(page.getByText('Evento reabierto.')).toBeVisible();
  expect(calendarEvents[0].event_status).toBe('confirmed');

  await openEvent('Evento editado');
  detail = page.getByRole('dialog', { name: 'Evento editado' });
  await detail.getByRole('button', { name: 'Finalizar' }).click();
  confirm = page.getByRole('alertdialog', { name: 'Finalizar evento' });
  await confirm.getByRole('button', { name: 'Confirmar finalización' }).click();
  await expect(page.getByText('Evento finalizado.')).toBeVisible();
  expect(calendarEvents[0].event_status).toBe('finished');

  await openEvent('Evento editado');
  detail = page.getByRole('dialog', { name: 'Evento editado' });
  await expect(detail.getByRole('button', { name: 'Cancelar evento' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Archivar' }).click();
  confirm = page.getByRole('alertdialog', { name: 'Archivar evento' });
  await confirm.getByRole('button', { name: 'Archivar' }).click();
  await expect(page.getByText('Evento archivado.')).toBeVisible();
  expect(calendarEvents[0].archived_at).not.toBeNull();

  await page.getByRole('navigation', { name: 'Estado de los eventos' }).getByRole('button', { name: 'Archivados' }).click();
  await openEvent('Evento editado');
  detail = page.getByRole('dialog', { name: 'Evento editado' });
  await expect(detail.getByRole('button', { name: 'Restaurar evento' })).toBeVisible();
  await detail.getByRole('button', { name: 'Restaurar evento' }).click();
  await expect(page.getByText('Evento restaurado.')).toBeVisible();
  expect(calendarEvents[0].archived_at).toBeNull();

  await page.getByRole('navigation', { name: 'Estado de los eventos' }).getByRole('button', { name: 'Activos' }).click();
  await openEvent('Evento editado');
  detail = page.getByRole('dialog', { name: 'Evento editado' });
  await detail.getByRole('button', { name: 'Papelera' }).click();
  confirm = page.getByRole('alertdialog', { name: 'Mover a papelera' });
  await confirm.getByRole('button', { name: 'Mover a papelera' }).click();
  await expect(page.getByText('Evento movido a la papelera.')).toBeVisible();
  expect(calendarEvents[0].deleted_at).not.toBeNull();
  expect(Date.parse(calendarEvents[0].purge_after) - Date.parse(calendarEvents[0].deleted_at)).toBe(30 * 86400000);

  await page.getByRole('navigation', { name: 'Estado de los eventos' }).getByRole('button', { name: 'Papelera' }).click();
  await openEvent('Evento editado');
  detail = page.getByRole('dialog', { name: 'Evento editado' });
  await expect(detail.getByText('En papelera')).toBeVisible();
  await detail.getByRole('button', { name: 'Restaurar evento' }).click();
  await expect(page.getByText('Evento restaurado.')).toBeVisible();
  expect(calendarEvents[0].deleted_at).toBeNull();
  expect(calendarEvents[0].purge_after).toBeNull();

  expect(mutationRequests.map((request) => request.payload.action)).toEqual([
    'edit', 'cancel', 'reopen', 'finish', 'archive', 'restore', 'trash', 'restore',
  ]);
  expect(new Set(mutationRequests.map((request) => request.key)).size).toBe(mutationRequests.length);
});


test('Agenda editing preserves the original zoned-civil seconds and milliseconds when only the description changes', async ({ page }) => {
  const today = await todayInBrowserHavana(page);
  const startLocal = today + 'T09:30:45.250';
  const endLocal = today + 'T10:15:30.125';
  const timedEvent = {
    id: '0190f47a-7b2c-7abc-8def-0123456789c2',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    updated_by_user_id: profile.id,
    title: 'Cita con precisión',
    description: 'Descripción original',
    location_label: null,
    location_kind: null,
    event_status: 'confirmed',
    temporal_kind: 'zoned_civil',
    start_date: null,
    end_date_exclusive: null,
    start_local: startLocal,
    end_local: endLocal,
    time_zone: 'America/Havana',
    starts_at: today + 'T14:30:45.250Z',
    ends_at: today + 'T15:15:30.125Z',
    start_disambiguation: 'earlier',
    end_disambiguation: 'earlier',
    start_gap_strategy: 'next-valid',
    end_gap_strategy: 'next-valid',
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    created_at: '2026-11-22T17:00:00.000Z',
    updated_at: '2026-11-22T17:00:00.000000Z',
  };
  const { calendarEvents, mutationRequests } = await mockSupabaseSession(page, {
    calendarEvents: [timedEvent],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: /Agenda/ }).click();

  await page.locator('.agenda-event-chip').filter({ hasText: 'Cita con precisión' }).click();
  await page.getByRole('dialog', { name: 'Cita con precisión' }).getByRole('button', { name: 'Editar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar evento' });
  // Chromium canonicalizes datetime-local values by trimming trailing fractional zeros.
  // The state and mutation payload must still preserve the original precision below.
  const browserValue = (value) => value.replace(/(\.\d*?[1-9])0+$/, '$1');
  await expect(dialog.getByLabel('Comienza')).toHaveValue(browserValue(startLocal));
  await expect(dialog.getByLabel('Termina')).toHaveValue(browserValue(endLocal));
  await dialog.getByLabel('Descripción (opcional)').fill('Descripción revisada');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  expect(mutationRequests).toHaveLength(1);
  expect(mutationRequests[0].payload.event).toMatchObject({
    temporalKind: 'zoned_civil',
    startLocalDateTime: startLocal,
    endLocalDateTime: endLocal,
    timeZone: 'America/Havana',
  });
  expect(calendarEvents[0]).toMatchObject({
    description: 'Descripción revisada',
    start_local: startLocal,
    end_local: endLocal,
    time_zone: 'America/Havana',
    starts_at: timedEvent.starts_at,
    ends_at: timedEvent.ends_at,
  });
});


test('Agenda crea, edita, archiva, restaura y envía a papelera bloques semanales por el writer autenticado', async ({ page }) => {
  const { protectedTimeBlocks, protectedTimeMutationRequests } = await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: /Agenda/ }).click();
  await page.getByRole('button', { name: 'Tiempo protegido', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tiempo protegido' })).toBeVisible();

  await page.getByRole('button', { name: 'Nuevo bloque' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Proteger tiempo' });
  await createDialog.getByLabel('Nombre del bloque').fill('Entrenamiento matutino');
  await createDialog.getByLabel('Categoría (opcional)').fill('Salud');
  await createDialog.getByLabel('Protección').selectOption('flexible');
  await createDialog.getByLabel('Patrón').selectOption('weekly');
  await createDialog.getByLabel('Hora de inicio').fill('07:00');
  await createDialog.getByLabel('Hora de fin').fill('08:15');
  await createDialog.getByLabel('Termina al día siguiente').uncheck();
  await createDialog.getByRole('button', { name: 'Guardar bloque' }).click();

  await expect(page.getByText('Tiempo protegido guardado.')).toBeVisible();
  await expect(createDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Entrenamiento matutino' })).toBeVisible();
  expect(protectedTimeBlocks).toHaveLength(1);
  expect(protectedTimeBlocks[0]).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    updated_by_user_id: profile.id,
    label: 'Entrenamiento matutino',
    category: 'Salud',
    protection_mode: 'flexible',
    pattern_kind: 'weekly',
    time_zone: 'America/Havana',
    weekdays: [1, 2, 3, 4, 5],
    start_time_local: '07:00',
    end_time_local: '08:15',
    ends_next_day: false,
  });
  expect(protectedTimeMutationRequests[0].payload.action).toBe('create');
  expect(protectedTimeMutationRequests[0].key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const initialUpdatedAt = protectedTimeBlocks[0].updated_at;

  let card = page.locator('.protected-time-card').filter({ hasText: 'Entrenamiento matutino' });
  await card.getByRole('button', { name: 'Editar' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Editar tiempo protegido' });
  await editDialog.getByLabel('Nombre del bloque').fill('Entrenamiento actualizado');
  await editDialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Tiempo protegido actualizado.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entrenamiento actualizado' })).toBeVisible();
  expect(protectedTimeMutationRequests[1].payload).toMatchObject({
    action: 'edit',
    blockId: protectedTimeBlocks[0].id,
    expectedUpdatedAt: initialUpdatedAt,
    block: { label: 'Entrenamiento actualizado', patternKind: 'weekly' },
  });

  card = page.locator('.protected-time-card').filter({ hasText: 'Entrenamiento actualizado' });
  await card.getByRole('button', { name: 'Archivar' }).click();
  const archiveDialog = page.getByRole('alertdialog', { name: 'Archivar bloque' });
  await archiveDialog.getByRole('button', { name: 'Archivar', exact: true }).click();
  await expect(page.getByText('Bloque archivado.')).toBeVisible();
  expect(protectedTimeBlocks[0].archived_at).not.toBeNull();

  const lifecycle = page.getByRole('navigation', { name: 'Estado de los bloques protegidos' });
  await lifecycle.getByRole('button', { name: 'Archivados' }).click();
  card = page.locator('.protected-time-card').filter({ hasText: 'Entrenamiento actualizado' });
  await card.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Bloque restaurado.')).toBeVisible();
  expect(protectedTimeBlocks[0].archived_at).toBeNull();

  await lifecycle.getByRole('button', { name: 'Activos' }).click();
  card = page.locator('.protected-time-card').filter({ hasText: 'Entrenamiento actualizado' });
  await card.getByRole('button', { name: 'Papelera' }).click();
  const deleteDialog = page.getByRole('alertdialog', { name: 'Enviar a papelera' });
  await deleteDialog.getByRole('button', { name: 'Mover a papelera' }).click();
  await expect(page.getByText('Bloque enviado a la papelera.')).toBeVisible();
  expect(protectedTimeBlocks[0].deleted_at).not.toBeNull();

  await lifecycle.getByRole('button', { name: 'Papelera' }).click();
  card = page.locator('.protected-time-card').filter({ hasText: 'Entrenamiento actualizado' });
  await card.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Bloque restaurado.')).toBeVisible();
  expect(protectedTimeBlocks[0].deleted_at).toBeNull();

  expect(protectedTimeMutationRequests.map((item) => item.payload.action)).toEqual([
    'create', 'edit', 'archive', 'restore', 'delete', 'restore',
  ]);
  expect(new Set(protectedTimeMutationRequests.map((item) => item.key)).size).toBe(protectedTimeMutationRequests.length);
});

test('Tiempo protegido funciona en móvil a 390px sin desbordar el documento', async ({ page }) => {
  const today = await todayInBrowserHavana(page);
  await mockSupabaseSession(page, {
    protectedTimeBlocks: [{
      id: '0190f47a-7b2c-7abc-8def-0123456789d2',
      owner_user_id: profile.id,
      created_by_user_id: profile.id,
      updated_by_user_id: profile.id,
      label: 'Descanso nocturno',
      category: 'Salud',
      protection_mode: 'hard',
      pattern_kind: 'weekly',
      time_zone: 'America/Havana',
      start_local: null,
      end_local: null,
      starts_at: null,
      ends_at: null,
      start_date: today,
      end_date_exclusive: null,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      start_time_local: '22:00:00',
      end_time_local: '06:30:00',
      ends_next_day: true,
      resolver_metadata: { rulesSource: 'iana-tzdb', rulesVersion: '2026f', resolverVersion: 'agenda-iana-resolver-v1', authoritative: true },
      archived_at: null,
      deleted_at: null,
      created_at: '2026-11-22T18:00:00.000Z',
      updated_at: '2026-11-22T18:00:00.000Z',
    }],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('navigation', { name: 'Navegación móvil' })
    .getByRole('button', { name: /Agenda/ }).click();
  await page.getByRole('button', { name: 'Tiempo protegido', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Descanso nocturno' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.getByRole('button', { name: 'Nuevo bloque' })).toBeVisible();
});


test('Agenda requires one explicit Protected Time decision per hard/flexible overlap before Event creation', async ({ page }) => {
  const today = await todayInBrowserHavana(page);
  const occurrenceStartsAt = today + 'T14:00:00.000Z';
  const occurrenceEndsAt = today + 'T15:00:00.000Z';
  const overlapStartsAt = today + 'T14:15:00.000Z';
  const overlapEndsAt = today + 'T14:45:00.000Z';
  const hardBlock = {
    id: '019a0000-0000-7000-8000-000000000211',
    updated_at: '2026-11-20T10:00:00.000000+00:00',
    label: 'Sueño protegido',
    category: 'Salud',
    protection_mode: 'hard',
    pattern_kind: 'one_off',
    time_zone: 'America/Havana',
  };
  const flexibleBlock = {
    id: '019a0000-0000-7000-8000-000000000212',
    updated_at: '2026-11-20T11:00:00.000000+00:00',
    label: 'Lectura',
    category: 'Personal',
    protection_mode: 'flexible',
    pattern_kind: 'one_off',
    time_zone: 'America/Havana',
  };
  const protectedTimeConflicts = [
    {
      conflictKey: hardBlock.id + ':' + occurrenceStartsAt,
      blockId: hardBlock.id,
      blockUpdatedAt: hardBlock.updated_at,
      label: hardBlock.label,
      category: hardBlock.category,
      protectionMode: hardBlock.protection_mode,
      patternKind: hardBlock.pattern_kind,
      occurrenceDate: today,
      occurrenceStartsAt,
      occurrenceEndsAt,
      overlapStartsAt,
      overlapEndsAt,
      timeZone: 'America/Havana',
      requiredDecision: 'override_hard',
    },
    {
      conflictKey: flexibleBlock.id + ':' + occurrenceStartsAt,
      blockId: flexibleBlock.id,
      blockUpdatedAt: flexibleBlock.updated_at,
      label: flexibleBlock.label,
      category: flexibleBlock.category,
      protectionMode: flexibleBlock.protection_mode,
      patternKind: flexibleBlock.pattern_kind,
      occurrenceDate: today,
      occurrenceStartsAt,
      occurrenceEndsAt,
      overlapStartsAt,
      overlapEndsAt,
      timeZone: 'America/Havana',
      requiredDecision: 'keep_flexible',
    },
  ];
  const { calendarEvents, insertedAgendaEvents, idempotencyRequests } = await mockSupabaseSession(page, {
    protectedTimeConflicts,
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: /Agenda/ }).click();

  await page.getByRole('button', { name: 'Nuevo evento' }).click();
  const composer = page.getByRole('dialog', { name: 'Crear evento' });
  await composer.getByLabel('Nombre del evento').fill('Reunión que cruza tiempo protegido');
  await composer.getByLabel('Desde', { exact: true }).fill(today);
  await composer.getByLabel('Hasta (incluido)', { exact: true }).fill(today);
  await composer.getByRole('button', { name: 'Guardar evento' }).click();

  const decisionDialog = page.getByRole('alertdialog', { name: 'Hay compromisos que se cruzan' });
  await expect(decisionDialog).toBeVisible();
  await expect(decisionDialog.getByText('Sueño protegido')).toBeVisible();
  await expect(decisionDialog.getByText('Lectura')).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel('Nombre del evento')).toHaveValue('Reunión que cruza tiempo protegido');
  expect(idempotencyRequests).toHaveLength(1);
  expect(idempotencyRequests[0].protectedTimeDecisions).toEqual([]);
  expect(insertedAgendaEvents).toHaveLength(0);
  expect(calendarEvents).toHaveLength(0);

  const choices = decisionDialog.getByLabel('Tu decisión para este cruce');
  await choices.nth(0).selectOption('override_hard');
  await choices.nth(1).selectOption('keep_flexible');
  await decisionDialog.getByRole('button', { name: 'Guardar con estas decisiones' }).click();

  await expect(page.getByText('Evento guardado en Agenda.')).toBeVisible();
  await expect(decisionDialog).toHaveCount(0);
  await expect(page.getByText('Reunión que cruza tiempo protegido')).toBeVisible();
  expect(idempotencyRequests).toHaveLength(2);
  expect(idempotencyRequests[1].key).toBe(idempotencyRequests[0].key);
  expect(idempotencyRequests[1].protectedTimeDecisions).toMatchObject([
    {
      blockId: hardBlock.id,
      blockUpdatedAt: hardBlock.updated_at,
      occurrenceStartsAt,
      decision: 'override_hard',
    },
    {
      blockId: flexibleBlock.id,
      blockUpdatedAt: flexibleBlock.updated_at,
      occurrenceStartsAt,
      decision: 'keep_flexible',
    },
  ]);
  expect(insertedAgendaEvents).toHaveLength(1);
  expect(insertedAgendaEvents[0].protected_time_decisions).toHaveLength(2);
});


test('Agenda Event edits recheck Protected Time and persist the selected hard override', async ({ page }) => {
  const today = await todayInBrowserHavana(page);
  const tomorrow = await page.evaluate((value) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }, today);
  const blockId = '019a0000-0000-7000-8000-000000000221';
  const blockUpdatedAt = '2026-11-20T10:00:00.000000+00:00';
  const occurrenceStartsAt = today + 'T14:00:00.000Z';
  const conflict = {
    conflictKey: blockId + ':' + occurrenceStartsAt,
    blockId,
    blockUpdatedAt,
    label: 'Sueño protegido',
    category: 'Salud',
    protectionMode: 'hard',
    patternKind: 'one_off',
    occurrenceDate: today,
    occurrenceStartsAt,
    occurrenceEndsAt: today + 'T15:00:00.000Z',
    overlapStartsAt: today + 'T14:15:00.000Z',
    overlapEndsAt: today + 'T14:45:00.000Z',
    timeZone: 'America/Havana',
    requiredDecision: 'override_hard',
  };
  const seedEvent = {
    id: '0190f47a-7b2c-7abc-8def-0123456789c5',
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    updated_by_user_id: profile.id,
    title: 'Evento anterior al bloque',
    description: 'Antes no existía este bloque protegido',
    location_label: null,
    location_kind: null,
    event_status: 'confirmed',
    temporal_kind: 'all_day',
    start_date: today,
    end_date_exclusive: tomorrow,
    start_local: null,
    end_local: null,
    time_zone: null,
    starts_at: null,
    ends_at: null,
    protected_time_decisions: [],
    archived_at: null,
    deleted_at: null,
    purge_after: null,
    created_at: '2026-11-22T17:00:00.000Z',
    updated_at: '2026-11-22T17:00:00.000000Z',
  };
  const { calendarEvents, mutationRequests } = await mockSupabaseSession(page, {
    calendarEvents: [seedEvent],
    protectedTimeConflicts: [conflict],
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: /Agenda/ }).click();

  await page.locator('.agenda-event-chip').filter({ hasText: seedEvent.title }).first().click();
  await page.getByRole('dialog', { name: seedEvent.title }).getByRole('button', { name: 'Editar' }).click();
  const composer = page.getByRole('dialog', { name: 'Editar evento' });
  await composer.getByLabel('Descripción (opcional)').fill('Detalles actualizados; el horario sigue protegido.');
  await composer.getByRole('button', { name: 'Guardar cambios' }).click();

  const decisionDialog = page.getByRole('alertdialog', { name: 'Hay compromisos que se cruzan' });
  await expect(decisionDialog).toBeVisible();
  expect(mutationRequests).toHaveLength(1);
  expect(mutationRequests[0].payload.action).toBe('edit');
  expect(calendarEvents[0].description).toBe(seedEvent.description);

  await decisionDialog.getByLabel('Tu decisión para este cruce').selectOption('override_hard');
  await decisionDialog.getByRole('button', { name: 'Guardar con estas decisiones' }).click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  await expect(decisionDialog).toHaveCount(0);
  expect(mutationRequests).toHaveLength(2);
  expect(mutationRequests[1].key).toBe(mutationRequests[0].key);
  expect(mutationRequests[1].payload.protectedTimeDecisions).toMatchObject([{
    blockId,
    blockUpdatedAt,
    occurrenceStartsAt,
    decision: 'override_hard',
  }]);
  expect(calendarEvents[0].description).toBe('Detalles actualizados; el horario sigue protegido.');
  expect(calendarEvents[0].protected_time_decisions).toHaveLength(1);
});



test('topbar reports network connectivity instead of claiming that data is synchronized', async ({ page }) => {
  await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.connection-state')).toHaveText('Con conexión');
  await expect(page.locator('.connection-state')).toHaveClass(/is-online/);

  await page.context().setOffline(true);
  await expect(page.locator('.connection-state')).toHaveText('Sin conexión');
  await expect(page.locator('.connection-state')).toHaveClass(/is-offline/);

  await page.context().setOffline(false);
  await expect(page.locator('.connection-state')).toHaveText('Con conexión');
});


test('offline vault displays a human-readable message for an incorrect passphrase', async ({ page }) => {
  await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await page.getByLabel('Nueva frase de desbloqueo offline').fill('clave-de-prueba-segura-2026');
  await page.getByRole('button', { name: 'Crear bóveda privada' }).click();
  await expect(page.getByText('Guarda ahora tu clave de recuperación')).toBeVisible();
  const recoveryCode = await page.locator('.offline-vault-recovery code').innerText();
  const confirmRecovery = page.getByLabel('Confirmar clave de recuperación offline');
  const dismissRecovery = page.getByRole('button', { name: 'Ya la guardé' });
  await expect(dismissRecovery).toBeDisabled();
  const wrongRecoveryCode = (recoveryCode[0] === '0' ? '1' : '0') + recoveryCode.slice(1);
  await confirmRecovery.fill(wrongRecoveryCode);
  await expect(dismissRecovery).toBeDisabled();
  await confirmRecovery.fill(recoveryCode);
  await expect(dismissRecovery).toBeEnabled();
  await dismissRecovery.click();
  await page.getByRole('button', { name: 'Bloquear' }).click();

  await page.getByLabel('Frase de desbloqueo offline').fill('contraseña-incorrecta-2026');
  await page.getByRole('button', { name: 'Desbloquear bóveda' }).click();
  await expect(page.locator('.offline-vault-panel .form-error[role="alert"]'))
    .toHaveText('Contraseña incorrecta. Inténtalo de nuevo.');
});


test('desktop offline capture survives a lost sync acknowledgement and retries with the same IDs', async ({ page }) => {
  const { offlineSyncRequests, offlineSyncReplayFlags, offlineSyncedCaptures, captures, captureParts } =
    await mockSupabaseSession(page, { offlineSyncFailures: 1 });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  await page.getByLabel('Nueva frase de desbloqueo offline').fill('desktop-offline-passphrase-2026');
  await page.getByRole('button', { name: 'Crear bóveda privada' }).click();
  await expect(page.getByText('Guarda ahora tu clave de recuperación')).toBeVisible();
  const recoveryCode = await page.locator('.offline-vault-recovery code').innerText();
  const confirmRecovery = page.getByLabel('Confirmar clave de recuperación offline');
  const dismissRecovery = page.getByRole('button', { name: 'Ya la guardé' });
  await expect(dismissRecovery).toBeDisabled();
  const wrongRecoveryCode = (recoveryCode[0] === '0' ? '1' : '0') + recoveryCode.slice(1);
  await confirmRecovery.fill(wrongRecoveryCode);
  await expect(dismissRecovery).toBeDisabled();
  await confirmRecovery.fill(recoveryCode);
  await expect(dismissRecovery).toBeEnabled();
  await dismissRecovery.click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Desbloqueada');

  const source = 'PRUEBA DESKTOP OFFLINE — reintento idempotente.';
  await page.context().setOffline(true);
  await expect(page.locator('.connection-state')).toHaveText('Sin conexión');
  await page.locator('.inbox-composer textarea').fill(source);
  await page.getByRole('button', { name: 'Guardar cifrada' }).click();
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('1 captura(s) cifrada(s) pendiente(s)');
  await expect(page.locator('.offline-vault-queue')).toContainText(source);
  expect(offlineSyncRequests).toHaveLength(0);

  await page.context().setOffline(false);
  await expect(page.locator('.connection-state')).toHaveText('Con conexión');
  const syncButton = page.getByRole('button', { name: 'Sincronizar ahora' });
  await expect(syncButton).toBeEnabled();

  // The mocked server commits the capture once, but the first acknowledgement is lost.
  await syncButton.click();
  await expect(page.locator('.alert.alert-error'))
    .toContainText('1 permanecen cifradas para reintentar');
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('1 captura(s) cifrada(s) pendiente(s)');
  expect(offlineSyncRequests).toHaveLength(1);

  await syncButton.click();
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('0 captura(s) cifrada(s) pendiente(s)');
  await expect(page.locator('.offline-vault-queue')).toHaveCount(0);
  await expect(page.locator('.alert.alert-success'))
    .toContainText('Capturas offline sincronizadas.');

  expect(offlineSyncRequests).toHaveLength(2);
  expect(offlineSyncRequests[1]).toMatchObject({
    p_capture_id: offlineSyncRequests[0].p_capture_id,
    p_part_id: offlineSyncRequests[0].p_part_id,
    p_content_original: source,
  });
  expect(offlineSyncReplayFlags).toEqual([false, true]);
  expect(offlineSyncedCaptures.size).toBe(1);
  expect(offlineSyncedCaptures.get(offlineSyncRequests[0].p_capture_id))
    .toMatchObject({
      capture_id: offlineSyncRequests[0].p_capture_id,
      part_id: offlineSyncRequests[0].p_part_id,
      content_original: source,
    });
  expect(captures.filter((capture) => capture.id === offlineSyncRequests[0].p_capture_id)).toHaveLength(1);
  expect(captureParts.filter((part) => part.id === offlineSyncRequests[0].p_part_id)).toHaveLength(1);
});


test('offline reopen restores the same owner vault and encrypted queue without Supabase', async ({ page }) => {
  await mockSupabaseSession(page);
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();

  const cachedProfile = await page.evaluate((authId) => {
    const raw = localStorage.getItem('simplelife:offline-profile:v1:' + authId);
    return raw ? JSON.parse(raw) : null;
  }, authUser.id);
  expect(cachedProfile).toMatchObject({
    version: 1,
    authUserId: authUser.id,
    profileId: profile.id,
  });

  await page.getByLabel('Nueva frase de desbloqueo offline').fill('offline-reopen-passphrase-2026');
  await page.getByRole('button', { name: 'Crear bóveda privada' }).click();
  await expect(page.getByText('Guarda ahora tu clave de recuperación')).toBeVisible();
  const recoveryCode = await page.locator('.offline-vault-recovery code').innerText();
  const confirmRecovery = page.getByLabel('Confirmar clave de recuperación offline');
  await confirmRecovery.fill(recoveryCode);
  await page.getByRole('button', { name: 'Ya la guardé' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Desbloqueada');

  const source = 'CAPTURA CIFRADA PERSISTENTE — reapertura sin conexión.';
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.locator('.connection-state')).toHaveText('Sin conexión');
  await page.locator('.inbox-composer textarea').fill(source);
  await page.getByRole('button', { name: 'Guardar cifrada' }).click();
  await expect(page.locator('.offline-vault-queue')).toContainText(source);
  await page.getByRole('button', { name: 'Bloquear' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Bloqueada');

  // Keep the local Vite document reachable, but make every Supabase request fail.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  });
  const blockSupabase = (route) => route.abort();
  await page.route(`${projectUrl}/**`, blockSupabase);
  await page.reload();
  // A full reload restores the app's default section (Today); navigate back
  // to Inbox before asserting its private vault state.
  await page.locator('.side-nav').getByRole('button', { name: /Inbox/ }).click();
  await expect(page.locator('.connection-state')).toHaveText('Sin conexión');
  await expect(page.locator('.offline-vault-state')).toHaveText('Bloqueada');
  await expect(page.getByLabel('Frase de desbloqueo offline')).toBeVisible();
  await expect(page.getByText(/No se pudo preparar tu perfil/)).toHaveCount(0);

  await page.getByLabel('Frase de desbloqueo offline').fill('offline-reopen-passphrase-2026');
  await page.getByRole('button', { name: 'Desbloquear bóveda' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Desbloqueada');
  await expect(page.locator('.offline-vault-queue')).toContainText(source);
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('1 captura(s) cifrada(s) pendiente(s)');
  await expect(page.getByRole('button', { name: 'Sincronizar ahora' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Grabar audio/ })).toBeDisabled();

  // Reconnect and allow the same authenticated owner to revalidate against DEV.
  await page.unroute(`${projectUrl}/**`, blockSupabase);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.locator('.connection-state')).toHaveText('Con conexión');
  await expect(page.getByText('Llamar al proveedor antes del viernes')).toBeVisible();
  const syncButton = page.getByRole('button', { name: 'Sincronizar ahora' });
  await expect(syncButton).toBeEnabled();
  await syncButton.click();
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('0 captura(s) cifrada(s) pendiente(s)');
  await expect(page.locator('.alert.alert-success'))
    .toContainText('Capturas offline sincronizadas.');
});

test('mobile vault recovery key restores queued encrypted capture and rotates the passphrase', async ({ page }) => {
  await mockSupabaseSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.mobile-nav').getByRole('button', { name: /Inbox/ }).click();

  await page.getByLabel('Nueva frase de desbloqueo offline').fill('offline-vault-original-passphrase-2026');
  await page.getByRole('button', { name: 'Crear bóveda privada' }).click();
  await expect(page.getByText('Guarda ahora tu clave de recuperación')).toBeVisible();

  const recoveryKey = await page.locator('.offline-vault-recovery code').innerText();
  expect(recoveryKey).toMatch(/^[0-9a-f]{64}$/);
  await page.getByLabel('Confirmar clave de recuperación offline').fill(recoveryKey);
  await page.getByRole('button', { name: 'Ya la guardé' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Desbloqueada');

  const source = 'CAPTURA RECUPERABLE — debe sobrevivir a la rotación de clave.';
  await page.context().setOffline(true);
  await expect(page.locator('.connection-state')).toHaveText('Sin conexión');
  await page.locator('.inbox-composer textarea').fill(source);
  await page.getByRole('button', { name: 'Guardar cifrada' }).click();
  await expect(page.locator('.offline-vault-queue')).toContainText(source);
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('1 captura(s) cifrada(s) pendiente(s)');

  const storedRecords = await page.evaluate(async (profileId) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('simplelife-private-offline-v1-' + profileId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('captures', 'readonly')
          .objectStore('captures').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, profile.id);
  expect(storedRecords).toHaveLength(1);
  expect(JSON.stringify(storedRecords)).not.toContain(source);

  // A lost one-time key can be replaced safely while the owner still knows the current passphrase.
  await page.getByRole('button', { name: 'Bloquear' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Bloqueada');
  await page.getByLabel('Frase de desbloqueo offline')
    .fill('offline-vault-original-passphrase-2026');
  await page.getByRole('button', { name: 'Desbloquear bóveda' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Desbloqueada');

  await page.getByRole('button', { name: 'Renovar clave de recuperación' }).click();
  await page.getByLabel('Frase actual de desbloqueo offline')
    .fill('offline-vault-original-passphrase-2026');
  await page.getByRole('button', { name: 'Generar nueva clave de recuperación' }).click();
  await expect(page.getByText('Guarda tu nueva clave de recuperación')).toBeVisible();
  const newRecoveryKey = await page.locator('.offline-vault-recovery code').innerText();
  expect(newRecoveryKey).toMatch(/^[0-9a-f]{64}$/);
  expect(newRecoveryKey).not.toBe(recoveryKey);
  await page.getByLabel('Confirmar clave de recuperación offline').fill(newRecoveryKey);
  await page.getByRole('button', { name: 'Ya la guardé' }).click();

  await page.getByRole('button', { name: 'Bloquear' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Bloqueada');
  await page.getByRole('button', { name: 'Perdí mi frase de desbloqueo' }).click();

  const keyInput = page.getByLabel('Clave de recuperación offline');
  const newPassphrase = page.getByLabel('Nueva frase offline');
  const recoverButton = page.getByRole('button', { name: 'Recuperar y cambiar frase' });
  await keyInput.fill(recoveryKey);
  await newPassphrase.fill('offline-vault-rotated-passphrase-2026');
  await recoverButton.click();
  await expect(page.locator('.offline-vault-panel .form-error[role="alert"]'))
    .toHaveText('Clave de recuperación incorrecta. Comprueba la clave e inténtalo de nuevo.');
  await expect(page.locator('.offline-vault-state')).toHaveText('Bloqueada');

  await keyInput.fill(newRecoveryKey);
  await recoverButton.click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Desbloqueada');
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('Bóveda recuperada. La frase de desbloqueo se ha actualizado.');
  await expect(page.locator('.offline-vault-queue')).toContainText(source);

  // Lock and unlock again to prove the new passphrase, not only the recovery
  // operation, can reopen the same encrypted queue on this browser profile.
  await page.getByRole('button', { name: 'Bloquear' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Bloqueada');
  await page.getByLabel('Frase de desbloqueo offline')
    .fill('offline-vault-rotated-passphrase-2026');
  await page.getByRole('button', { name: 'Desbloquear bóveda' }).click();
  await expect(page.locator('.offline-vault-state')).toHaveText('Desbloqueada');
  await expect(page.locator('.offline-vault-queue')).toContainText(source);
  await expect(page.locator('.offline-vault-panel'))
    .toContainText('1 captura(s) cifrada(s) pendiente(s)');
  await expect(page.locator('.connection-state')).toHaveText('Sin conexión');
});

test('mobile voice capture uploads a private original and leaves transcription pending', async ({ page }) => {
  await page.addInitScript(() => {
    const track = { stop: () => { window.__voiceMicrophoneTrackStopped = true; } };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [track] }),
      },
    });
    class FakeMediaRecorder {
      static isTypeSupported(type) {
        return type === 'audio/webm;codecs=opus';
      }
      constructor(stream, options = {}) {
        this.stream = stream;
        this.mimeType = options.mimeType || 'audio/webm';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.ondataavailable?.({
          data: new Blob(['synthetic private voice bytes'], { type: this.mimeType }),
        });
        this.onstop?.();
      }
    }
    window.MediaRecorder = FakeMediaRecorder;
  });

  const { insertedVoiceAssets, uploadedVoiceObjects, voiceFinalizeRequests } =
    await mockSupabaseSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(authUser.email);
  await page.getByLabel('Contraseña').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.locator('.mobile-nav').getByRole('button', { name: /Inbox/ }).click();

  const voicePanel = page.getByRole('region', { name: 'Captura de voz privada' });
  const recordButton = voicePanel.getByRole('button', { name: 'Grabar audio' });
  await expect(recordButton).toBeEnabled();
  await recordButton.click();
  await expect(voicePanel.getByText('Grabando…')).toBeVisible();
  await voicePanel.getByRole('button', { name: 'Detener y guardar' }).click();

  await expect(voicePanel)
    .toContainText('La transcripción permanece pendiente hasta configurar un proveedor aprobado.');
  expect(insertedVoiceAssets).toHaveLength(1);
  expect(uploadedVoiceObjects).toHaveLength(1);
  expect(voiceFinalizeRequests).toHaveLength(1);

  const asset = insertedVoiceAssets[0];
  const upload = uploadedVoiceObjects[0];
  expect(asset).toMatchObject({
    owner_user_id: profile.id,
    created_by_user_id: profile.id,
    bucket_id: 'inbox-voice-private',
    mime_type: 'audio/webm',
    status: 'uploading',
  });
  expect(asset.file_size_bytes).toBeGreaterThan(0);
  expect(asset.sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  expect(upload.objectPath).toBe(profile.id + '/' + asset.id + '/source.webm');
  expect(upload.contentType).toContain('multipart/form-data');
  expect(voiceFinalizeRequests[0]).toEqual({ assetId: asset.id });
  expect(await page.evaluate(() => window.__voiceMicrophoneTrackStopped)).toBe(true);
});
