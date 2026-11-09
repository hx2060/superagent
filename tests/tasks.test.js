import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TASK_STATUS_ORDER,
  nextTaskStatus,
  taskDayEntry,
  taskMonthAnchors,
  taskReviewGroups,
  taskStatusCounts,
  taskWindow,
} from '../src/tasks.js';

const TODAY = '2026-11-09';

function task(overrides = {}) {
  return { id: 'task-1', title: '示例任务', icon: '📝', status: 'todo', ...overrides };
}

/* ------------------------------------------------------------- taskWindow */

test('taskWindow：定时任务占开始当天', () => {
  assert.deepEqual(taskWindow(task({ date: '2026-11-04', start: '09:00', duration: 60 }), TODAY), {
    startKey: '2026-11-04',
    endKey: '2026-11-04',
    dateKey: '2026-11-04',
    dueKey: null,
  });
});

test('taskWindow：定时 + 更晚截止从 date 跨到 due', () => {
  assert.deepEqual(taskWindow(task({ date: '2026-11-04', due: '2026-11-12' }), TODAY), {
    startKey: '2026-11-04',
    endKey: '2026-11-12',
    dateKey: '2026-11-04',
    dueKey: '2026-11-12',
  });
});

test('taskWindow：截止不早于排期日时只占排期日', () => {
  const same = taskWindow(task({ date: '2026-11-04', due: '2026-11-04' }), TODAY);
  assert.equal(same.startKey, '2026-11-04');
  assert.equal(same.endKey, '2026-11-04');

  const earlier = taskWindow(task({ date: '2026-11-10', due: '2026-11-04' }), TODAY);
  assert.equal(earlier.startKey, '2026-11-10');
  assert.equal(earlier.endKey, '2026-11-10');
});

test('taskWindow：仅截止且截止未到从今天画到截止日', () => {
  assert.deepEqual(taskWindow(task({ due: '2026-11-20' }), TODAY), {
    startKey: TODAY,
    endKey: '2026-11-20',
    dateKey: null,
    dueKey: '2026-11-20',
  });
});

test('taskWindow：仅截止且截止已过只占截止当天', () => {
  assert.deepEqual(taskWindow(task({ due: '2026-11-05' }), TODAY), {
    startKey: '2026-11-05',
    endKey: '2026-11-05',
    dateKey: null,
    dueKey: '2026-11-05',
  });
});

test('taskWindow：截止就是今天时占今天', () => {
  const window = taskWindow(task({ due: TODAY }), TODAY);
  assert.equal(window.startKey, TODAY);
  assert.equal(window.endKey, TODAY);
});

test('taskWindow：无日期无截止返回 null，非法日期被忽略', () => {
  assert.equal(taskWindow(task({ title: '未排期' }), TODAY), null);
  assert.equal(taskWindow(null, TODAY), null);
  assert.equal(taskWindow(task({ date: 'not-a-date', due: '2026-11-20' }), TODAY).startKey, TODAY);
});

/* ------------------------------------------------------------ taskDayEntry */

test('taskDayEntry：今日到期的任务进入当日计划', () => {
  const entry = taskDayEntry(task({ due: TODAY }), TODAY, TODAY);
  assert.equal(entry.inPlan, true);
  assert.equal(entry.dueOnDay, true);
  assert.equal(entry.overdue, false);
});

test('taskDayEntry：今日定时的任务进入当日计划', () => {
  const entry = taskDayEntry(task({ date: TODAY, start: '09:00', duration: 60 }), TODAY, TODAY);
  assert.equal(entry.inPlan, true);
  assert.equal(entry.scheduledOnDay, true);
});

test('taskDayEntry：截止已过且未完成的任务不再进入后续日期', () => {
  const overdue = task({ due: '2026-11-08' });
  assert.equal(taskDayEntry(overdue, TODAY, TODAY).inPlan, false);
  assert.equal(taskDayEntry(overdue, '2026-11-25', TODAY).inPlan, false);
  assert.equal(taskDayEntry(overdue, TODAY, TODAY).overdue, true);
  // 截止当天仍保留当天记录
  assert.equal(taskDayEntry(overdue, '2026-11-08', TODAY).inPlan, true);
});

test('taskDayEntry：往日的定时任务不再进入后续日期', () => {
  const past = task({ date: '2026-11-05', start: '14:00', duration: 90, status: 'done' });
  assert.equal(taskDayEntry(past, TODAY, TODAY).inPlan, false);
  assert.equal(taskDayEntry(past, '2026-11-05', TODAY).inPlan, true);
});

test('taskDayEntry：未来截止未完成的任务在当天到截止日之间每天进入当日计划', () => {
  const future = task({ due: '2026-11-20' });
  for (const day of [TODAY, '2026-11-10', '2026-11-19', '2026-11-20']) {
    assert.equal(taskDayEntry(future, day, TODAY).inPlan, true, day);
  }
  // 截止日之后不再进入（转周 / 月回顾区）
  assert.equal(taskDayEntry(future, '2026-11-21', TODAY).inPlan, false);
  assert.equal(taskDayEntry(future, '2026-12-01', TODAY).inPlan, false);
});

test('taskDayEntry：未来截止已完成的任务不再进入当日计划，截止当天显示完成', () => {
  const done = task({ due: '2026-11-20', status: 'done' });
  assert.equal(taskDayEntry(done, TODAY, TODAY).inPlan, false);
  const onDue = taskDayEntry(done, '2026-11-20', TODAY);
  assert.equal(onDue.inPlan, true);
  assert.equal(onDue.done, true);
});

test('taskDayEntry：跨天未完成任务在区间内每天进入当日计划', () => {
  const span = task({ date: TODAY, due: '2026-11-15' });
  for (const day of [TODAY, '2026-11-12', '2026-11-15']) {
    assert.equal(taskDayEntry(span, day, TODAY).inPlan, true, day);
  }
  assert.equal(taskDayEntry(span, '2026-11-16', TODAY).inPlan, false);
  assert.equal(taskDayEntry(span, '2026-11-01', TODAY).inPlan, false);
});

test('taskDayEntry：今日到期且已完成的任务当天显示', () => {
  const entry = taskDayEntry(task({ due: TODAY, status: 'done' }), TODAY, TODAY);
  assert.equal(entry.inPlan, true);
  assert.equal(entry.done, true);
  assert.equal(entry.overdue, false);
});

test('taskDayEntry：未排期任务不进入任何日期计划', () => {
  const loose = task({ title: '未排期' });
  assert.equal(taskDayEntry(loose, TODAY, TODAY).inPlan, false);
  assert.equal(taskDayEntry(loose, '2026-11-20', TODAY).inPlan, false);
});

test('taskDayEntry：非法日期不会进入计划', () => {
  assert.equal(taskDayEntry(task({ due: 'oops' }), TODAY, TODAY).inPlan, false);
});

/* --------------------------------------------------------- taskReviewGroups */

test('taskReviewGroups：按完成与否分组截止已过的任务并一直保留', () => {
  const groups = taskReviewGroups(
    [
      task({ id: 'a', due: '2026-11-08' }),
      task({ id: 'b', due: '2026-11-01', status: 'done' }),
      task({ id: 'c', due: '2026-11-20' }),
      task({ id: 'd', date: '2026-11-05', start: '09:00', duration: 30 }),
      task({ id: 'e', title: '未排期' }),
    ],
    TODAY
  );
  assert.deepEqual(
    groups.overdue.map((item) => item.id),
    ['a']
  );
  assert.deepEqual(
    groups.completed.map((item) => item.id),
    ['b']
  );
});

/* --------------------------------------------------------- taskMonthAnchors */

test('taskMonthAnchors：仅截止且截止未到在今天与截止日各一个 chip', () => {
  assert.deepEqual(taskMonthAnchors(task({ due: '2026-11-20' }), TODAY), [
    { key: TODAY, due: false },
    { key: '2026-11-20', due: true },
  ]);
});

test('taskMonthAnchors：截止已过只保留截止日 chip', () => {
  assert.deepEqual(taskMonthAnchors(task({ due: '2026-11-05' }), TODAY), [
    { key: '2026-11-05', due: true },
  ]);
});

test('taskMonthAnchors：定时任务占排期日，跨天时截止日额外一个截止 chip', () => {
  assert.deepEqual(taskMonthAnchors(task({ date: '2026-11-02', start: '09:00', duration: 60 }), TODAY), [
    { key: '2026-11-02', due: false },
  ]);
  assert.deepEqual(taskMonthAnchors(task({ date: '2026-11-02', due: '2026-11-12' }), TODAY), [
    { key: '2026-11-02', due: false },
    { key: '2026-11-12', due: true },
  ]);
});

test('taskMonthAnchors：截止与排期同日时只显示排期 chip', () => {
  assert.deepEqual(taskMonthAnchors(task({ date: '2026-11-02', due: '2026-11-02' }), TODAY), [
    { key: '2026-11-02', due: false },
  ]);
});

test('taskMonthAnchors：未排期任务不出现在月视图', () => {
  assert.deepEqual(taskMonthAnchors(task({ title: '未排期' }), TODAY), []);
});

/* ------------------------------------------------------------ status logic */

test('三态循环顺序固定', () => {
  assert.equal(nextTaskStatus('todo'), 'partial');
  assert.equal(nextTaskStatus('partial'), 'done');
  assert.equal(nextTaskStatus('done'), 'todo');
  assert.equal(nextTaskStatus('unknown'), 'todo');
  assert.deepEqual(TASK_STATUS_ORDER, ['todo', 'partial', 'done']);
});

test('taskStatusCounts 统计 done / total 百分比', () => {
  const counts = taskStatusCounts(
    [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'partial' }), task({ id: 'c', status: 'todo' })],
    new Map([['b', 'done']])
  );
  assert.deepEqual(counts, { total: 3, todo: 1, partial: 0, done: 2, percent: 67 });
  assert.deepEqual(taskStatusCounts([], new Map()), { total: 0, todo: 0, partial: 0, done: 0, percent: 0 });
});
