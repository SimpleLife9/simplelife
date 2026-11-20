import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardSnapshot } from '../src/lib/dashboard.js';

const today = '2026-11-20';
const makeTask = (id, status, extra = {}) => ({
  id, action: id, status, priority: 3, deleted_at: null, archived_at: null, ...extra,
});

test('dashboard separates due, overdue, next and blocked work without counting archived rows', () => {
  const snapshot = buildDashboardSnapshot({
    today,
    tasks: [
      makeTask('late', 'todo', { due_date: '2026-11-18', priority: 1 }),
      makeTask('today', 'todo', { due_date: today, estimated_duration_minutes: 45, priority: 2 }),
      makeTask('blocked', 'blocked', { due_date: today, priority: 1 }),
      makeTask('next', 'todo', { due_date: '2026-11-24' }),
      makeTask('unscheduled', 'todo'),
      makeTask('archived', 'todo', { due_date: today, archived_at: '2026-11-19T12:00:00Z' }),
      makeTask('cancelled', 'cancelled', { due_date: today }),
    ],
  });

  assert.deepEqual(snapshot.overdue.map((task) => task.id), ['late']);
  assert.deepEqual(snapshot.dueToday.map((task) => task.id), ['blocked', 'today']);
  assert.deepEqual(snapshot.blockedTasks.map((task) => task.id), ['blocked']);
  assert.deepEqual(snapshot.nextTasks.map((task) => task.id), ['next', 'unscheduled']);
  assert.equal(snapshot.estimatedTodayMinutes, 45);
  assert.equal(snapshot.estimatedTodayCount, 1);
});

test('goal and project progress uses unique confirmed links and completed tasks as evidence', () => {
  const goal = { id: 'goal-1', title: 'Fortalecer finanzas', status: 'active', target_date: '2026-11-25' };
  const subgoal = { id: 'sub-1', goal_id: goal.id, deleted_at: null };
  const project = { id: 'project-1', name: 'Automatizar negocio', status: 'active', target_date: '2026-11-26' };
  const tasks = [
    makeTask('done', 'completed', { completed_at: '2026-11-20T14:00:00Z' }),
    makeTask('doing', 'in_progress'),
    makeTask('cancelled', 'cancelled'),
    makeTask('deleted', 'completed', { deleted_at: '2026-11-19T00:00:00Z' }),
  ];
  const snapshot = buildDashboardSnapshot({
    today,
    tasks,
    goals: [goal],
    subgoals: [subgoal],
    projects: [project],
    contributionRelations: [
      { task_id: 'done', goal_id: goal.id, relation_status: 'confirmed' },
      { task_id: 'done', goal_id: goal.id, relation_status: 'confirmed' },
      { task_id: 'doing', subgoal_id: subgoal.id, relation_status: 'confirmed' },
      { task_id: 'cancelled', goal_id: goal.id, relation_status: 'confirmed' },
      { task_id: 'doing', goal_id: goal.id, relation_status: 'removed' },
    ],
    taskProjectLinks: [
      { task_id: 'done', project_id: project.id },
      { task_id: 'doing', project_id: project.id },
      { task_id: 'doing', project_id: project.id },
      { task_id: 'deleted', project_id: project.id },
    ],
  });

  assert.deepEqual(snapshot.goalProgress[0], {
    id: 'goal-1', title: 'Fortalecer finanzas', targetDate: '2026-11-25',
    totalTasks: 2, completedTasks: 1, blockedTasks: 0, progress: 50,
  });
  assert.equal(snapshot.projectProgress[0].progress, 50);
  assert.equal(snapshot.projectProgress[0].totalTasks, 2);
});

test('weekly pulse counts completed tasks only in the last seven Havana calendar days', () => {
  const snapshot = buildDashboardSnapshot({
    today,
    tasks: [
      makeTask('today', 'completed', { completed_at: '2026-11-20T14:00:00Z' }),
      makeTask('six-days', 'completed', { completed_at: '2026-11-14T14:00:00Z' }),
      makeTask('old', 'completed', { completed_at: '2026-11-13T14:00:00Z' }),
      makeTask('future', 'completed', { completed_at: '2026-11-21T14:00:00Z' }),
      makeTask('open', 'in_progress', { completed_at: '2026-11-19T14:00:00Z' }),
    ],
  });
  assert.equal(snapshot.completedThisWeek, 2);
});
