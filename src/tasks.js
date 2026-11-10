/**
 * Task checklist logic shared by the day, week and month views.
 *
 * `taskWindow` / `taskDayEntry` / `taskReviewGroups` are the single source of
 * truth for "which days does a task occupy and what is its state there". The
 * month grid (chips + span bars), the week chart and the day plan all derive
 * from them, so the three views can no longer drift apart (see
 * docs/interfaces.md 3.2).
 */

import { parseDateKey, toDateKey } from './calendar.js';

export const TASK_STATUS_ORDER = ['todo', 'partial', 'done'];

export const TASK_STATUS_LABELS = {
  todo: '待完成',
  partial: '部分完成',
  done: '完成',
};

export function nextTaskStatus(status) {
  const index = TASK_STATUS_ORDER.indexOf(status);
  return TASK_STATUS_ORDER[(index + 1) % TASK_STATUS_ORDER.length];
}

/** Counts used by the checklist header and progress bar. */
export function taskStatusCounts(tasks, statuses) {
  const counts = { total: tasks.length, todo: 0, partial: 0, done: 0 };
  for (const task of tasks) {
    const status = statuses.get(task.id) ?? task.status;
    if (status in counts) counts[status] += 1;
  }
  const percent = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
  return { ...counts, percent };
}

/** Parse a YYYY-MM-DD key, returning null for missing / malformed values. */
function dateKeyOrNull(value) {
  if (typeof value !== 'string' || !value) return null;
  const date = parseDateKey(value);
  return date ? value : null;
}

function isDone(task) {
  return task?.status === 'done';
}

/**
 * The day window a task occupies — the shared answer to "which days does this
 * task span", consumed by the month chips, the week chart bars and the day
 * plan alike.
 *
 * - `date` + later `due`: `[date, due]`.
 * - `date` (+ `due` on or before it): `[date, date]`; a deadline written
 *   before the task date is rejected on write, and a seeded one keeps the
 *   scheduled day so every view still agrees.
 * - `date` only: `[date, date]` (all-day or timed single day).
 * - `due` only, deadline today or later: `[today, due]` — the task runs from
 *   today until its deadline.
 * - `due` only, deadline already past: `[due, due]` — the deadline day.
 * - neither: `null` (unscheduled inbox task).
 *
 * @param {object} task
 * @param {string} todayKey local YYYY-MM-DD
 * @returns {{ startKey: string, endKey: string, dateKey: string|null, dueKey: string|null }|null}
 */
export function taskWindow(task, todayKey) {
  if (!task || typeof task !== 'object') return null;
  const dateKey = dateKeyOrNull(task.date);
  const dueKey = dateKeyOrNull(task.due);
  if (!dateKey && !dueKey) return null;

  if (dateKey) {
    if (dueKey && dueKey > dateKey) return { startKey: dateKey, endKey: dueKey, dateKey, dueKey };
    return { startKey: dateKey, endKey: dateKey, dateKey, dueKey };
  }

  const today = dateKeyOrNull(todayKey);
  const startKey = today && dueKey >= today ? today : dueKey;
  return { startKey, endKey: dueKey, dateKey: null, dueKey };
}

/**
 * One task's membership in one day's plan plus its review state.
 *
 * A task is in day `dateKey`'s 当日计划 when
 * - its deadline falls on that day, or
 * - it is scheduled on that day, or
 * - the day lies inside the window the task occupies and the task is still
 *   unfinished (pending deadline work is carried forward until it is done).
 *
 * An overdue task (deadline passed, unfinished) therefore never carries into
 * days after its deadline; it stays in the week / month review areas instead.
 * A finished task shows on its own deadline / scheduled day and drops out of
 * the days in between.
 *
 * @param {object} task
 * @param {string} dateKey the viewed day, local YYYY-MM-DD
 * @param {string} todayKey local YYYY-MM-DD
 * @returns {{ inPlan: boolean, dueOnDay: boolean, scheduledOnDay: boolean, overdue: boolean, done: boolean }}
 */
export function taskDayEntry(task, dateKey, todayKey) {
  const window = taskWindow(task, todayKey);
  const done = isDone(task);
  const dueOnDay = Boolean(window?.dueKey && window.dueKey === dateKey);
  const scheduledOnDay = Boolean(window?.dateKey && window.dateKey === dateKey);
  const overdue = Boolean(window?.dueKey && window.dueKey < todayKey && !done);
  const inSpan = Boolean(window && dateKey >= window.startKey && dateKey <= window.endKey);
  const inPlan = dueOnDay || scheduledOnDay || (inSpan && !done);
  return { inPlan, dueOnDay, scheduledOnDay, overdue, done };
}

/**
 * Review groups for the week / month views: every task whose deadline has
 * already passed, split into still-unfinished and finished. Kept until the
 * task is deleted, so past deadlines stay reviewable.
 *
 * @param {object[]} tasks
 * @param {string} todayKey local YYYY-MM-DD
 * @returns {{ overdue: object[], completed: object[] }}
 */
export function taskReviewGroups(tasks, todayKey) {
  const overdue = [];
  const completed = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const dueKey = dateKeyOrNull(task?.due);
    if (!dueKey || dueKey >= todayKey) continue;
    if (isDone(task)) completed.push(task);
    else overdue.push(task);
  }
  return { overdue, completed };
}

/**
 * Month-view anchors for one task, derived from {@link taskWindow}: a chip on
 * the window's first and last day. The last day is marked `due` when it is
 * the deadline (and not also the scheduled day, where the time reads
 * better). A deadline-only task therefore shows a start chip today and a
 * 「截止」 chip on the deadline day.
 *
 * Multi-day windows (see {@link monthSpanBars}) draw a span bar instead of
 * chips, so callers filter those tasks out before using these anchors.
 *
 * @param {{ date?: string, due?: string }} task
 * @param {string} todayKey local YYYY-MM-DD
 * @returns {Array<{ key: string, due: boolean }>}
 */
export function taskMonthAnchors(task, todayKey) {
  const window = taskWindow(task, todayKey);
  if (!window) return [];
  const dueEnd = Boolean(window.dueKey && window.endKey === window.dueKey && window.dueKey !== window.dateKey);
  if (window.startKey === window.endKey) {
    return [{ key: window.startKey, due: window.startKey === window.dueKey && dueEnd }];
  }
  return [
    { key: window.startKey, due: false },
    { key: window.endKey, due: dueEnd },
  ];
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   status: string,
 *   startKey: string,
 *   endKey: string,
 *   dueKey: string|null,
 *   overdue: boolean,
 *   row: number,          // 0–5 week row inside the month matrix
 *   startCol: number,     // 0 (Monday) – 6 (Sunday)
 *   endCol: number,
 *   lane: number,         // stacking index inside the week row
 *   openDate: string,     // first visible day of the segment
 *   clippedStart: boolean,
 *   clippedEnd: boolean
 * }} MonthSpanBar
 */

/**
 * Month-view span bars for tasks that occupy more than one day.
 *
 * Every task whose window covers more than one day — a scheduled task with a
 * later deadline, or a deadline-only task running from today — becomes one
 * bar per week row it crosses, clipped to that row, so the month grid draws
 * the same "one long block" the week chart draws (see
 * `src/modules/week-chart/chart.js`). `days` is the 42-day matrix from
 * `buildMonthMatrix`; segments carry the grid row / column span plus a lane
 * index so bars sharing a week row stack instead of overlapping.
 *
 * Single-day tasks keep their month chips (`taskMonthAnchors`) and produce no
 * bar. Segments beyond `maxLanes` in one week row are returned as `overflow`
 * so the caller can still count them (and say so with 「+N 项」).
 *
 * @param {object[]} tasks
 * @param {Date[]} days
 * @param {string} todayKey local YYYY-MM-DD
 * @param {{ maxLanes?: number }} [options]
 * @returns {{ bars: MonthSpanBar[], overflow: MonthSpanBar[] }}
 */
export function monthSpanBars(tasks, days, todayKey, options = {}) {
  const columns = 7;
  const maxLanes =
    Number.isInteger(options.maxLanes) && options.maxLanes > 0 ? options.maxLanes : 3;
  const dayKeys = Array.isArray(days) ? days.map((date) => toDateKey(date)) : [];
  const rowCount = Math.floor(dayKeys.length / columns);
  if (rowCount === 0) return { bars: [], overflow: [] };

  const laneEnds = Array.from({ length: rowCount }, () => []);
  const bars = [];
  const overflow = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    const window = taskWindow(task, todayKey);
    if (!window || window.startKey === window.endKey) continue;

    let first = -1;
    let last = -1;
    for (let index = 0; index < dayKeys.length; index += 1) {
      const key = dayKeys[index];
      if (key < window.startKey || key > window.endKey) continue;
      if (first === -1) first = index;
      last = index;
    }
    if (first === -1) continue;

    const status = TASK_STATUS_LABELS[task?.status] ? task.status : 'todo';
    const overdue = Boolean(window.dueKey && window.dueKey < todayKey && status !== 'done');

    for (let row = Math.floor(first / columns); row <= Math.floor(last / columns); row += 1) {
      const rowStart = row * columns;
      const segStart = Math.max(first, rowStart);
      const segEnd = Math.min(last, rowStart + columns - 1);
      const startCol = segStart - rowStart;
      const endCol = segEnd - rowStart;
      const segment = {
        id: task.id,
        title: task.title,
        status,
        startKey: window.startKey,
        endKey: window.endKey,
        dueKey: window.dueKey,
        overdue,
        row,
        startCol,
        endCol,
        openDate: dayKeys[segStart],
        clippedStart: segStart > first,
        clippedEnd: segEnd < last,
      };

      const lanes = laneEnds[row];
      let lane = lanes.findIndex((end) => end < startCol);
      if (lane === -1) {
        if (lanes.length >= maxLanes) {
          overflow.push(segment);
          continue;
        }
        lane = lanes.length;
      }
      lanes[lane] = endCol;
      bars.push({ ...segment, lane });
    }
  }

  const byPosition = (a, b) => a.row - b.row || a.startCol - b.startCol || a.endCol - b.endCol;
  bars.sort((a, b) => byPosition(a, b) || a.lane - b.lane);
  overflow.sort(byPosition);
  return { bars, overflow };
}
