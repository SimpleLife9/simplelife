import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatUpcomingCountdown,
  formatUpcomingStart,
  getUpcomingAgendaItems,
} from '../src/features/agenda/domain/upcoming.js';

const NOW = Date.parse('2026-11-23T14:00:00.000Z');

test('upcoming list orders confirmed events and TaskSchedules by next active instant', () => {
  const items = getUpcomingAgendaItems({
    now: NOW,
    viewerTimeZone: 'America/Havana',
    events: [
      { id: 'later', title: 'Más tarde', event_status: 'confirmed', temporal_kind: 'fixed_instant', starts_at: '2026-11-23T17:00:00Z', ends_at: '2026-11-23T18:00:00Z' },
      { id: 'soon', title: 'Pronto', event_status: 'confirmed', temporal_kind: 'fixed_instant', starts_at: '2026-11-23T14:30:00Z', ends_at: '2026-11-23T15:00:00Z' },
    ],
    taskSchedules: [
      { id: 'schedule', task_id: 'task-1', schedule_status: 'confirmed', starts_at: '2026-11-23T15:00:00Z', ends_at: '2026-11-23T16:00:00Z', time_zone: 'America/Havana' },
    ],
    tasks: [{ id: 'task-1', action: 'Entrenar' }],
  });
  assert.deepEqual(items.map((item) => item.id), ['soon', 'schedule', 'later']);
  assert.equal(items[1].title, 'Entrenar');
  assert.equal(items[1].kind, 'task_schedule');
});

test('cancelled, finished, archived, deleted and already-ended commitments are omitted', () => {
  const items = getUpcomingAgendaItems({
    now: NOW,
    events: [
      { id: 'cancelled', event_status: 'cancelled', temporal_kind: 'fixed_instant', starts_at: '2026-11-23T15:00:00Z', ends_at: '2026-11-23T16:00:00Z' },
      { id: 'finished', event_status: 'finished', temporal_kind: 'fixed_instant', starts_at: '2026-11-23T15:00:00Z', ends_at: '2026-11-23T16:00:00Z' },
      { id: 'archived', event_status: 'confirmed', archived_at: '2026-11-22T00:00:00Z', temporal_kind: 'fixed_instant', starts_at: '2026-11-23T15:00:00Z', ends_at: '2026-11-23T16:00:00Z' },
      { id: 'deleted', event_status: 'confirmed', deleted_at: '2026-11-22T00:00:00Z', temporal_kind: 'fixed_instant', starts_at: '2026-11-23T15:00:00Z', ends_at: '2026-11-23T16:00:00Z' },
      { id: 'past', event_status: 'confirmed', temporal_kind: 'fixed_instant', starts_at: '2026-11-23T12:00:00Z', ends_at: '2026-11-23T13:00:00Z' },
    ],
    taskSchedules: [
      { id: 'cancelled-schedule', schedule_status: 'cancelled', starts_at: '2026-11-23T15:00:00Z', ends_at: '2026-11-23T16:00:00Z' },
    ],
  });
  assert.deepEqual(items, []);
});

test('all-day events remain date-only and appear as in-progress without inventing a UTC start', () => {
  const items = getUpcomingAgendaItems({
    now: NOW,
    viewerTimeZone: 'America/Havana',
    events: [{
      id: 'all-day',
      title: 'Día completo',
      event_status: 'confirmed',
      temporal_kind: 'all_day',
      start_date: '2026-11-23',
      end_date_exclusive: '2026-11-24',
    }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].allDay, true);
  assert.equal(items[0].startsAt, null);
  assert.equal(formatUpcomingCountdown(items[0], NOW), 'Hoy · todo el día');
  assert.equal(formatUpcomingStart(items[0]), 'Todo el día · 2026-11-23');
});

test('ongoing timed commitments are listed before later commitments', () => {
  const items = getUpcomingAgendaItems({
    now: NOW,
    events: [{
      id: 'ongoing',
      title: 'En curso',
      event_status: 'confirmed',
      temporal_kind: 'zoned_civil',
      time_zone: 'America/Havana',
      starts_at: '2026-11-23T13:30:00Z',
      ends_at: '2026-11-23T14:30:00Z',
    }, {
      id: 'later',
      title: 'Siguiente',
      event_status: 'confirmed',
      temporal_kind: 'fixed_instant',
      starts_at: '2026-11-23T16:00:00Z',
      ends_at: '2026-11-23T17:00:00Z',
    }],
  });
  assert.deepEqual(items.map((item) => item.id), ['ongoing', 'later']);
  assert.equal(formatUpcomingCountdown(items[0], NOW), 'En curso');
});

test('countdown rounds up and never claims background alarm delivery', () => {
  const item = {
    startsAt: '2026-11-23T14:05:01.000Z',
    endsAt: '2026-11-23T15:00:00.000Z',
    allDay: false,
  };
  assert.equal(formatUpcomingCountdown(item, NOW), 'Comienza en 6 min');
  assert.equal(formatUpcomingCountdown({
    startsAt: '2026-11-23T16:00:00.000Z',
    endsAt: '2026-11-23T17:00:00.000Z',
  }, NOW), 'Comienza en 2 h');
});

test('upcoming item count is bounded to ten and invalid intervals fail closed', () => {
  assert.throws(() => getUpcomingAgendaItems({ now: NOW, maxItems: 11 }), /maxItems/);
  assert.deepEqual(getUpcomingAgendaItems({
    now: NOW,
    events: [{ id: 'invalid', event_status: 'confirmed', temporal_kind: 'fixed_instant', starts_at: 'invalid', ends_at: '2026-11-23T15:00:00Z' }],
  }), []);
});
