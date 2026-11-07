import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEEK_GRID_HOUR_HEIGHT,
  addDays,
  addMonths,
  buildMonthMatrix,
  eventsForDay,
  formatDayTitle,
  formatDuration,
  formatMonthTitle,
  formatTimeRange,
  formatWeekTitle,
  getWeekDays,
  groupEventsByDate,
  isSameDay,
  layoutOverlaps,
  parseDateKey,
  startOfWeek,
  timeToMinutes,
  toDateKey,
  weekEventStyle,
} from '../src/calendar.js';
import { TASK_STATUS_LABELS, nextTaskStatus, taskMonthAnchors, taskStatusCounts } from '../src/tasks.js';

const date = (year, month, day) => new Date(year, month - 1, day);

test('date keys round-trip without timezone drift', () => {
  assert.equal(toDateKey(date(2026, 1, 5)), '2026-01-05');
  assert.equal(toDateKey(date(2026, 11, 6)), '2026-11-06');
  const parsed = parseDateKey('2026-11-06');
  assert.ok(parsed instanceof Date);
  assert.equal(toDateKey(parsed), '2026-11-06');
});

test('parseDateKey rejects malformed and impossible dates', () => {
  assert.equal(parseDateKey('2026-13-01'), null);
  assert.equal(parseDateKey('2026-02-30'), null);
  assert.equal(parseDateKey('2026-1-1'), null);
  assert.equal(parseDateKey(''), null);
  assert.equal(parseDateKey(undefined), null);
});

test('startOfWeek is Monday based', () => {
  assert.equal(toDateKey(startOfWeek(date(2026, 11, 6))), '2026-11-02');
  assert.equal(toDateKey(startOfWeek(date(2026, 11, 9))), '2026-11-09');
  assert.equal(toDateKey(startOfWeek(date(2026, 11, 8))), '2026-11-02');
});

test('buildMonthMatrix returns a six-row Monday-first grid', () => {
  const matrix = buildMonthMatrix(date(2026, 11, 6));
  assert.equal(matrix.length, 42);
  assert.equal(toDateKey(matrix[0]), '2026-10-26');
  assert.equal(matrix[0].getDay(), 1);
  assert.equal(toDateKey(matrix[41]), '2026-12-06');
  assert.ok(matrix.some((day) => toDateKey(day) === '2026-11-30'));
});

test('addDays and addMonths handle boundaries', () => {
  assert.equal(toDateKey(addDays(date(2026, 11, 30), 1)), '2026-12-01');
  assert.equal(toDateKey(addDays(date(2026, 1, 1), -1)), '2025-12-31');
  assert.equal(toDateKey(addMonths(date(2026, 1, 31), 1)), '2026-02-28');
  assert.equal(toDateKey(addMonths(date(2026, 3, 31), -1)), '2026-02-28');
  assert.equal(toDateKey(addMonths(date(2026, 11, 6), 1)), '2026-12-06');
});

test('week days are consecutive from Monday to Sunday', () => {
  const days = getWeekDays(date(2026, 11, 6));
  assert.equal(days.length, 7);
  assert.equal(toDateKey(days[0]), '2026-11-02');
  assert.equal(toDateKey(days[6]), '2026-11-08');
  assert.equal(days[6].getDay(), 0);
});

test('period titles read naturally in Chinese', () => {
  assert.equal(formatMonthTitle(date(2026, 11, 6)), '2026年11月');
  assert.equal(formatWeekTitle(date(2026, 11, 6)), '2026年11月2日 – 8日');
  assert.equal(formatWeekTitle(date(2026, 11, 30)), '2026年11月30日 – 12月6日');
  assert.equal(formatWeekTitle(date(2025, 12, 31)), '2025年12月29日 – 2026年1月4日');
  assert.equal(formatDayTitle(date(2026, 11, 6)), '2026年11月6日 周五');
  assert.equal(formatTimeRange('09:30', '10:00'), '09:30 – 10:00');
});

test('formatDuration renders human durations', () => {
  assert.equal(formatDuration(15), '15 分钟');
  assert.equal(formatDuration(60), '1 小时');
  assert.equal(formatDuration(90), '1 小时 30 分钟');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(Number.NaN), '');
});

test('timeToMinutes parses and validates clock strings', () => {
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('23:59'), 1439);
  assert.ok(Number.isNaN(timeToMinutes('24:00')));
  assert.ok(Number.isNaN(timeToMinutes('9:5')));
  assert.ok(Number.isNaN(timeToMinutes(null)));
});

test('events are grouped by day and sorted by start time', () => {
  const events = [
    { id: 'b', date: '2026-11-06', start: '14:00', end: '15:00' },
    { id: 'a', date: '2026-11-06', start: '09:00', end: '10:00' },
    { id: 'c', date: '2026-11-07', start: '08:00', end: '09:00' },
  ];
  const grouped = groupEventsByDate(events);
  assert.deepEqual(
    grouped.get('2026-11-06').map((event) => event.id),
    ['a', 'b']
  );
  assert.equal(grouped.get('2026-11-07').length, 1);
  assert.deepEqual(
    eventsForDay(events, date(2026, 11, 6)).map((event) => event.id),
    ['a', 'b']
  );
  assert.deepEqual(eventsForDay(events, date(2026, 11, 8)), []);
});

test('layoutOverlaps gives non-overlapping events a full column', () => {
  const layout = layoutOverlaps([
    { id: 'a', start: '09:00', end: '10:00' },
    { id: 'b', start: '11:00', end: '12:00' },
  ]);
  assert.deepEqual(layout.get('a'), { column: 0, columns: 1 });
  assert.deepEqual(layout.get('b'), { column: 0, columns: 1 });
});

test('layoutOverlaps places overlapping events side by side', () => {
  const layout = layoutOverlaps([
    { id: 'a', start: '09:00', end: '10:30' },
    { id: 'b', start: '09:30', end: '11:00' },
  ]);
  assert.deepEqual(layout.get('a'), { column: 0, columns: 2 });
  assert.deepEqual(layout.get('b'), { column: 1, columns: 2 });
});

test('layoutOverlaps reuses a freed column inside a transitive cluster', () => {
  const layout = layoutOverlaps([
    { id: 'a', start: '09:00', end: '10:00' },
    { id: 'b', start: '09:30', end: '11:00' },
    { id: 'c', start: '10:30', end: '12:00' },
  ]);
  assert.deepEqual(layout.get('a'), { column: 0, columns: 2 });
  assert.deepEqual(layout.get('b'), { column: 1, columns: 2 });
  assert.deepEqual(layout.get('c'), { column: 0, columns: 2 });
});

test('weekEventStyle maps times to the rendered hour grid', () => {
  const style = weekEventStyle({ start: '09:00', end: '10:00' });
  assert.equal(style.top, 2 * WEEK_GRID_HOUR_HEIGHT);
  assert.equal(style.height, WEEK_GRID_HOUR_HEIGHT);

  const clamped = weekEventStyle({ start: '06:00', end: '08:00' });
  assert.equal(clamped.top, 0);
  assert.equal(clamped.height, WEEK_GRID_HOUR_HEIGHT);

  assert.equal(weekEventStyle({ start: '22:00', end: '23:00' }), null);
  assert.equal(weekEventStyle({ start: '10:00', end: '10:00' }), null);

  const tiny = weekEventStyle({ start: '10:00', end: '10:05' });
  assert.equal(tiny.height, 18);
});

test('task status cycles todo → partial → done → todo', () => {
  assert.equal(nextTaskStatus('todo'), 'partial');
  assert.equal(nextTaskStatus('partial'), 'done');
  assert.equal(nextTaskStatus('done'), 'todo');
  assert.equal(nextTaskStatus('unknown'), 'todo');
  assert.equal(TASK_STATUS_LABELS.partial, '部分完成');
});

test('task status counts drive the checklist progress', () => {
  const tasks = [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'partial' },
    { id: 'c', status: 'todo' },
    { id: 'd', status: 'todo' },
  ];
  const statuses = new Map([['c', 'done']]);
  const counts = taskStatusCounts(tasks, statuses);
  assert.deepEqual(counts, { total: 4, todo: 1, partial: 1, done: 2, percent: 50 });

  assert.deepEqual(taskStatusCounts([], new Map()), {
    total: 0,
    todo: 0,
    partial: 0,
    done: 0,
    percent: 0,
  });
});

test('taskMonthAnchors adds the start-today and deadline chips', () => {
  assert.deepEqual(taskMonthAnchors({ due: '2026-11-08' }, '2026-11-07'), [
    { key: '2026-11-07', due: false },
    { key: '2026-11-08', due: true },
  ]);
  assert.deepEqual(taskMonthAnchors({ due: '2026-11-07' }, '2026-11-07'), [
    { key: '2026-11-07', due: true },
  ]);
  assert.deepEqual(taskMonthAnchors({ due: '2026-11-05' }, '2026-11-07'), [
    { key: '2026-11-05', due: true },
  ]);
  assert.deepEqual(taskMonthAnchors({ date: '2026-11-02', due: '2026-11-08' }, '2026-11-07'), [
    { key: '2026-11-02', due: false },
    { key: '2026-11-08', due: true },
  ]);
  assert.deepEqual(taskMonthAnchors({ date: '2026-11-02', due: '2026-11-02' }, '2026-11-07'), [
    { key: '2026-11-02', due: false },
  ]);
  assert.deepEqual(taskMonthAnchors({}, '2026-11-07'), []);
});
