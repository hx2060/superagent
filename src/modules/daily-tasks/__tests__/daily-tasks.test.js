import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAILY_TASK_DEFAULT_ICON,
  DAILY_TASK_TITLE_MAX_LENGTH,
  createDailyTaskStore,
  normalizeDailyTask,
} from '../index.js';

test('normalizeDailyTask trims titles, defaults icons and stamps recurrence', () => {
  assert.deepEqual(normalizeDailyTask({ title: '  喝水  ' }), {
    id: null,
    title: '喝水',
    icon: DAILY_TASK_DEFAULT_ICON,
    recurrence: 'daily',
  });
  assert.deepEqual(normalizeDailyTask({ id: '  habit-1  ', title: '阅读', icon: '  📖  ' }), {
    id: 'habit-1',
    title: '阅读',
    icon: '📖',
    recurrence: 'daily',
  });
});

test('normalizeDailyTask rejects unusable input', () => {
  assert.equal(normalizeDailyTask(null), null);
  assert.equal(normalizeDailyTask(undefined), null);
  assert.equal(normalizeDailyTask('喝水'), null);
  assert.equal(normalizeDailyTask({}), null);
  assert.equal(normalizeDailyTask({ title: '' }), null);
  assert.equal(normalizeDailyTask({ title: '   ' }), null);
  assert.equal(normalizeDailyTask({ title: 42 }), null);
  assert.equal(normalizeDailyTask({ title: 'x'.repeat(DAILY_TASK_TITLE_MAX_LENGTH + 1) }), null);
});

test('seed tasks load without emitting and keep first duplicate id', () => {
  const store = createDailyTaskStore([
    { id: 'a', title: '晨间拉伸', icon: '🧘' },
    { id: 'a', title: '重复任务', icon: '🔁' },
    { title: '' },
    { id: 'b', title: '阅读' },
  ]);
  assert.deepEqual(
    store.listTasks().map((task) => [task.id, task.title, task.icon, task.recurrence]),
    [
      ['a', '晨间拉伸', '🧘', 'daily'],
      ['b', '阅读', DAILY_TASK_DEFAULT_ICON, 'daily'],
    ]
  );
});

test('every daily task starts as todo for every date', () => {
  const store = createDailyTaskStore([{ id: 'a', title: '喝水' }]);
  assert.deepEqual(
    store.listForDate('2026-11-06').map(({ task, status }) => [task.id, status]),
    [['a', 'todo']]
  );
  assert.equal(store.getStatus('a', '2026-11-07'), 'todo');
});

test('addTask creates a recurring task, emits once and returns a copy', () => {
  let sequence = 0;
  const store = createDailyTaskStore([], { createId: () => `generated-${++sequence}` });
  const changes = [];
  store.subscribe((change) => changes.push(change));

  const task = store.addTask({ title: '写日记', icon: '📝' });
  assert.deepEqual(task, {
    id: 'generated-1',
    title: '写日记',
    icon: '📝',
    recurrence: 'daily',
  });
  assert.deepEqual(store.listTasks(), [task]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, 'add');
  assert.equal(changes[0].task.id, 'generated-1');

  task.title = '被外部改掉';
  assert.equal(store.listTasks()[0].title, '写日记');
});

test('addTask validates ids, duplicates and titles', () => {
  const store = createDailyTaskStore([{ id: 'a', title: '喝水' }]);
  assert.throws(
    () => store.addTask({ id: 'a', title: '另一个' }),
    (error) => error.code === 'DAILY_TASK_DUPLICATE_ID'
  );
  assert.throws(
    () => store.addTask({ title: '' }),
    (error) => error.code === 'DAILY_TASK_INVALID'
  );
  const blankId = store.addTask({ id: '   ', title: '有效标题' });
  assert.ok(blankId.id);
  assert.equal(blankId.title, '有效标题');
});

test('per-day status is independent and validated', () => {
  const store = createDailyTaskStore([{ id: 'a', title: '喝水' }]);

  assert.equal(store.setStatus('a', '2026-11-06', 'partial'), 'partial');
  assert.equal(store.getStatus('a', '2026-11-06'), 'partial');
  assert.equal(store.getStatus('a', '2026-11-07'), 'todo');
  assert.deepEqual(
    store.listForDate('2026-11-07').map(({ status }) => status),
    ['todo']
  );

  assert.throws(
    () => store.setStatus('a', '2026-11-06', 'unknown'),
    (error) => error.code === 'DAILY_TASK_STATUS_INVALID'
  );
  assert.throws(
    () => store.setStatus('missing', '2026-11-06', 'done'),
    (error) => error.code === 'DAILY_TASK_NOT_FOUND'
  );
  assert.throws(
    () => store.getStatus('a', '2026-02-30'),
    (error) => error.code === 'DAILY_TASK_DATE_INVALID'
  );
  assert.throws(
    () => store.listForDate('2026-1-1'),
    (error) => error.code === 'DAILY_TASK_DATE_INVALID'
  );
});

test('toggleStatus cycles the requested day only', () => {
  const store = createDailyTaskStore([{ id: 'a', title: '喝水' }]);
  const day = '2026-11-06';

  assert.equal(store.toggleStatus('a', day), 'partial');
  assert.equal(store.toggleStatus('a', day), 'done');
  assert.equal(store.getStatus('a', '2026-11-07'), 'todo');
  assert.equal(store.toggleStatus('a', day), 'todo');
  assert.equal(store.getStatus('a', day), 'todo');
});

test('statusCounts follows the shared task progress contract per day', () => {
  const store = createDailyTaskStore([
    { id: 'a', title: '喝水' },
    { id: 'b', title: '阅读' },
    { id: 'c', title: '拉伸' },
  ]);
  store.setStatus('a', '2026-11-06', 'done');
  store.setStatus('b', '2026-11-06', 'partial');

  assert.deepEqual(store.statusCounts('2026-11-06'), {
    total: 3,
    todo: 1,
    partial: 1,
    done: 1,
    percent: 33,
  });
  assert.deepEqual(store.statusCounts('2026-11-07'), {
    total: 3,
    todo: 3,
    partial: 0,
    done: 0,
    percent: 0,
  });
  assert.deepEqual(store.statusCounts('2026-11-06').percent, 33);

  const empty = createDailyTaskStore([]);
  assert.deepEqual(empty.statusCounts('2026-11-06'), {
    total: 0,
    todo: 0,
    partial: 0,
    done: 0,
    percent: 0,
  });
});

test('subscribe notifies on add and status changes and unsubscribes', () => {
  const store = createDailyTaskStore([]);
  const changes = [];
  const unsubscribe = store.subscribe((change) => changes.push(change));

  const task = store.addTask({ title: '喝水' });
  store.setStatus(task.id, '2026-11-06', 'done');

  assert.deepEqual(
    changes.map((change) => change.type),
    ['add', 'status']
  );
  assert.equal(changes[1].dateKey, '2026-11-06');
  assert.equal(changes[1].status, 'done');

  unsubscribe();
  store.addTask({ title: '阅读' });
  assert.equal(changes.length, 2);

  assert.throws(() => store.subscribe('not-a-function'), TypeError);
});
