import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWeekChart, eventChartBar, taskChartBar } from '../chart.js';

const WEEK_START = '2026-11-02';
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should be ${expected}`);

function task(overrides = {}) {
  return {
    id: 'task-1',
    title: '示例任务',
    icon: '📝',
    status: 'todo',
    ...overrides,
  };
}

test('周图：单日定时任务占一天，并显示准确时间', () => {
  const bar = taskChartBar(
    task({ date: '2026-11-04', start: '10:00', duration: 90, end: '11:30' }),
    WEEK_START
  );

  near(bar.left, 2 / 7);
  near(bar.width, 1 / 7);
  assert.equal(bar.startDay, 2);
  assert.equal(bar.endDay, 2);
  assert.equal(bar.openDate, '2026-11-04');
  assert.equal(bar.label, '10:00–11:30');
  assert.equal(bar.clippedStart, false);
  assert.equal(bar.clippedEnd, false);
});

test('周图：只有截止日期的任务占满截止当天', () => {
  const bar = taskChartBar(task({ due: '2026-11-06' }), WEEK_START);
  near(bar.left, 4 / 7);
  near(bar.width, 1 / 7);
  assert.equal(bar.startDay, 4);
  assert.equal(bar.endDay, 4);
  assert.equal(bar.label, '截止 11/6');
  assert.equal(bar.openDate, '2026-11-06');
});

test('周图：开始日期到截止日期跨越多天', () => {
  const bar = taskChartBar(
    task({ date: '2026-11-02', start: '09:00', duration: 60, end: '10:00', due: '2026-11-08' }),
    WEEK_START
  );
  near(bar.left, 0);
  near(bar.width, 1);
  assert.equal(bar.startDay, 0);
  assert.equal(bar.endDay, 6);
  assert.equal(bar.label, '09:00 → 截止 11/8');
});

test('周图：截止日期与开始日期同天时只占当天', () => {
  const bar = taskChartBar(
    task({ date: '2026-11-04', start: '10:00', duration: 90, end: '11:30', due: '2026-11-04' }),
    WEEK_START
  );
  near(bar.left, 2 / 7);
  near(bar.width, 1 / 7);
  assert.equal(bar.label, '10:00–11:30');
});

test('周图：没有开始时间但有日期时按全天处理', () => {
  const bar = taskChartBar(task({ date: '2026-11-05' }), WEEK_START);
  near(bar.left, 3 / 7);
  near(bar.width, 1 / 7);
  assert.equal(bar.label, '全天');
});

test('周图：不在本周、无日期或无截止时间的任务不生成方块', () => {
  assert.equal(taskChartBar(task({ date: '2026-11-20', start: '09:00', duration: 30 }), WEEK_START), null);
  assert.equal(taskChartBar(task({ title: '未排期' }), WEEK_START), null);
  assert.equal(taskChartBar(task({ due: '2026-10-20' }), WEEK_START), null);
  assert.equal(taskChartBar(null, WEEK_START), null);
});

test('周图：跨周方块裁剪到本周并标记裁剪方向', () => {
  const fromBefore = taskChartBar(
    task({ date: '2026-10-30', start: '10:00', duration: 60, due: '2026-11-04' }),
    WEEK_START
  );
  near(fromBefore.left, 0);
  near(fromBefore.width, 3 / 7);
  assert.equal(fromBefore.clippedStart, true);
  assert.equal(fromBefore.clippedEnd, false);

  const intoNext = taskChartBar(
    task({ date: '2026-11-06', start: '10:00', duration: 60, due: '2026-11-20' }),
    WEEK_START
  );
  near(intoNext.left, 4 / 7);
  near(intoNext.width, 3 / 7);
  assert.equal(intoNext.clippedStart, false);
  assert.equal(intoNext.clippedEnd, true);
});

test('周图：定时日程占一天并显示时间范围', () => {
  const bar = eventChartBar(
    { id: 'evt-1', title: '示例日程', date: '2026-11-04', start: '14:00', end: '15:30' },
    WEEK_START
  );
  near(bar.left, 2 / 7);
  near(bar.width, 1 / 7);
  assert.equal(bar.label, '14:00–15:30');
  assert.equal(eventChartBar({ date: '2026-11-04', start: '10:00', end: '10:00' }, WEEK_START), null);
  assert.equal(eventChartBar({ date: '2026-11-20', start: '10:00', end: '11:00' }, WEEK_START), null);
});

test('周图：整周模型包含任务、日程、排序、进度与今天标记', () => {
  const model = buildWeekChart({
    anchor: new Date(2026, 10, 4),
    today: new Date(2026, 10, 7),
    tasks: [
      task({ id: 'task-b', title: '任务 B', date: '2026-11-04', start: '10:00', duration: 60 }),
      task({ id: 'task-a', title: '任务 A', status: 'done', due: '2026-11-02' }),
      task({ id: 'task-c', title: '未排期' }),
    ],
    events: [
      { id: 'evt-1', title: '日程', date: '2026-11-04', start: '14:00', end: '15:00', color: 'violet' },
    ],
  });

  assert.equal(model.days.length, 7);
  assert.equal(model.days[0].key, '2026-11-02');
  assert.equal(model.days[6].key, '2026-11-08');
  assert.equal(model.days[5].isToday, true);
  assert.equal(model.days[5].weekday, '周六');
  assert.deepEqual(model.summary, { total: 2, done: 1, percent: 50 });
  assert.deepEqual(
    model.rows.map((row) => row.id),
    ['task-a', 'task-b', 'evt-1']
  );
  assert.equal(model.rows[0].kind, 'task');
  assert.equal(model.rows[0].status, 'done');
  assert.equal(model.rows[2].kind, 'event');
  assert.equal(model.rows[2].color, 'violet');
});

test('周图：过期未完成任务标记为 overdue，完成后不再标记', () => {
  const overdue = buildWeekChart({
    anchor: new Date(2026, 10, 4),
    today: new Date(2026, 10, 7),
    tasks: [task({ due: '2026-11-05' })],
  });
  assert.equal(overdue.rows[0].overdue, true);

  const done = buildWeekChart({
    anchor: new Date(2026, 10, 4),
    today: new Date(2026, 10, 7),
    tasks: [task({ due: '2026-11-05', status: 'done' })],
  });
  assert.equal(done.rows[0].overdue, false);
});

test('周图：没有任务和日程时返回空行与零进度', () => {
  const model = buildWeekChart({ anchor: new Date(2026, 10, 4), today: new Date(2026, 10, 7) });
  assert.deepEqual(model.rows, []);
  assert.deepEqual(model.summary, { total: 0, done: 0, percent: 0 });
  assert.equal(model.days.length, 7);
});
