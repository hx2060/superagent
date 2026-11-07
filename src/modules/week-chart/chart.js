/**
 * Pure layout logic for the week task × time chart.
 *
 * Each row is a task (or a timed calendar event). A block starts on the task's
 * start day and ends on its deadline (`due`) or scheduled day; the exact times
 * are shown as text inside the block and in the row label. This mirrors the
 * reference chart (day columns, task rows, blocks spanning the task window)
 * while keeping the chart readable at every width.
 */

import {
  WEEKDAY_LABELS,
  getWeekDays,
  parseDateKey,
  timeToMinutes,
  toDateKey,
} from '../../calendar.js';
import { TASK_STATUS_LABELS } from '../../tasks.js';

const WEEK_DAYS = 7;

const TASK_STATUS_COLORS = {
  todo: 'blue',
  partial: 'orange',
  done: 'teal',
};

function formatMonthDay(dateKey) {
  const date = parseDateKey(dateKey);
  return date ? `${date.getMonth() + 1}/${date.getDate()}` : dateKey;
}

function formatWeekday(dateKey) {
  const date = parseDateKey(dateKey);
  return date ? `周${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}` : '';
}

function formatClock(value) {
  const minutes = timeToMinutes(value);
  if (!Number.isFinite(minutes)) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function minutesToClock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function dayOffset(dateKey, weekStartKey) {
  const target = parseDateKey(dateKey);
  const start = parseDateKey(weekStartKey);
  if (!target || !start) return null;
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

function taskEndClock(task) {
  if (Number.isFinite(timeToMinutes(task.end))) return formatClock(task.end);
  const start = timeToMinutes(task.start);
  const duration = Number(task.duration);
  if (Number.isFinite(start) && Number.isFinite(duration) && duration > 0) {
    return minutesToClock(start + duration);
  }
  return '';
}

/**
 * @typedef {{
 *   left: number,          // 0–1 fraction of the whole week track
 *   width: number,         // 0–1 fraction, at least one day
 *   startDay: number,      // 0 (Monday) – 6 (Sunday)
 *   endDay: number,
 *   openDate: string,      // YYYY-MM-DD opened when the block is clicked
 *   clippedStart: boolean,
 *   clippedEnd: boolean,
 *   label: string
 * }} WeekChartBar
 */

/**
 * Geometry + label for one task.
 *
 * - A task with a start date and a later deadline spans both days.
 * - A task with a start date and no deadline occupies the start day.
 * - A task with only a deadline starts TODAY (the supplied `todayKey`) and
 *   spans to the deadline, so it becomes a long block from today to the due
 *   date. Past deadlines and the legacy no-today call keep the deadline day.
 *
 * Returns null when it has no date / deadline or falls completely outside the
 * rendered week.
 *
 * @param {object} task
 * @param {string} weekStartKey
 * @param {string|null} [todayKey] local YYYY-MM-DD used as the start of a
 *   deadline-only block when the deadline is today or later
 * @returns {WeekChartBar|null}
 */
export function taskChartBar(task, weekStartKey, todayKey = null) {
  if (!task || typeof task !== 'object') return null;
  const hasDate = typeof task.date === 'string' && Boolean(parseDateKey(task.date));
  const hasDue = typeof task.due === 'string' && Boolean(parseDateKey(task.due));
  if (!hasDate && !hasDue) return null;

  const dateOnly = hasDate && !task.start;
  const dueOnly = !hasDate && hasDue;
  const dueIsLater = hasDue && (!hasDate || task.due > task.date);
  const startFromToday =
    dueOnly &&
    typeof todayKey === 'string' &&
    Boolean(parseDateKey(todayKey)) &&
    task.due >= todayKey;
  const startKey = hasDate ? task.date : startFromToday ? todayKey : task.due;
  const endKey = dueIsLater ? task.due : hasDate ? task.date : task.due;

  const startOffset = dayOffset(startKey, weekStartKey);
  const endOffset = dayOffset(endKey, weekStartKey);
  if (startOffset === null || endOffset === null) return null;
  if (startOffset > WEEK_DAYS - 1 || endOffset < 0) return null;

  const startDay = Math.max(0, Math.min(WEEK_DAYS - 1, startOffset));
  const endDay = Math.max(0, Math.min(WEEK_DAYS - 1, endOffset));
  if (endDay < startDay) return null;

  const openDate =
    dueOnly
      ? task.due
      : startOffset >= 0 && startOffset < WEEK_DAYS
        ? startKey
        : endOffset >= 0 && endOffset < WEEK_DAYS
          ? endKey
          : weekStartKey;

  let label;
  if (!hasDate) {
    label = `截止 ${formatMonthDay(endKey)}`;
  } else if (dateOnly) {
    label = dueIsLater ? `截止 ${formatMonthDay(task.due)}` : '全天';
  } else if (dueIsLater) {
    label = `${formatClock(task.start) || '开始'} → 截止 ${formatMonthDay(task.due)}`;
  } else {
    const rangeEnd = taskEndClock(task);
    label = rangeEnd ? `${formatClock(task.start)}–${rangeEnd}` : formatClock(task.start);
  }

  return {
    left: startDay / WEEK_DAYS,
    width: (endDay - startDay + 1) / WEEK_DAYS,
    startDay,
    endDay,
    openDate,
    clippedStart: startOffset < 0,
    clippedEnd: endOffset > WEEK_DAYS - 1,
    label,
  };
}

/**
 * Geometry for a timed calendar event. Events live on one day, so the block
 * occupies that day cell; the exact range is the label.
 *
 * @param {object} event
 * @param {string} weekStartKey
 * @returns {WeekChartBar|null}
 */
export function eventChartBar(event, weekStartKey) {
  if (!event || typeof event !== 'object' || !parseDateKey(event.date)) return null;
  const startMinutes = timeToMinutes(event.start);
  const endMinutes = timeToMinutes(event.end);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
    return null;
  }
  const startOffset = dayOffset(event.date, weekStartKey);
  if (startOffset === null || startOffset < 0 || startOffset > WEEK_DAYS - 1) return null;
  return {
    left: startOffset / WEEK_DAYS,
    width: 1 / WEEK_DAYS,
    startDay: startOffset,
    endDay: startOffset,
    openDate: event.date,
    clippedStart: false,
    clippedEnd: false,
    label: `${formatClock(event.start)}–${formatClock(event.end)}`,
  };
}

function taskMeta(task, weekStartKey) {
  const parts = [];
  const dateVisible =
    task.date && (() => {
      const offset = dayOffset(task.date, weekStartKey);
      return offset !== null && offset >= 0 && offset < WEEK_DAYS;
    })();

  if (task.start) {
    const rangeEnd = taskEndClock(task);
    const range = rangeEnd ? `${formatClock(task.start)}–${rangeEnd}` : formatClock(task.start);
    parts.push(dateVisible ? range : `${formatMonthDay(task.date)} ${range}`);
  } else if (task.date) {
    parts.push('全天');
  }
  if (task.due) {
    const weekday = formatWeekday(task.due);
    parts.push(`截止 ${formatMonthDay(task.due)}${weekday ? ` ${weekday}` : ''}`);
  }
  return parts.join(' · ');
}

/**
 * Build the whole week chart model.
 *
 * @param {{
 *   anchor: Date,
 *   tasks?: object[],
 *   events?: object[],
 *   today?: Date
 * }} input
 */
export function buildWeekChart({ anchor, tasks = [], events = [], today = new Date() }) {
  const weekDays = getWeekDays(anchor);
  const weekStartKey = toDateKey(weekDays[0]);
  const todayKey = toDateKey(today);

  const rows = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const bar = taskChartBar(task, weekStartKey, todayKey);
    if (!bar) continue;
    const status = TASK_STATUS_LABELS[task.status] ? task.status : 'todo';
    rows.push({
      id: task.id,
      kind: 'task',
      title: task.title,
      icon: task.icon,
      status,
      color: TASK_STATUS_COLORS[status] ?? 'blue',
      bar,
      meta: taskMeta(task, weekStartKey),
      overdue: Boolean(task.due && task.due < todayKey && status !== 'done'),
    });
  }
  for (const event of Array.isArray(events) ? events : []) {
    const bar = eventChartBar(event, weekStartKey);
    if (!bar) continue;
    rows.push({
      id: event.id,
      kind: 'event',
      title: event.title,
      icon: event.icon,
      color: event.color ?? 'blue',
      bar,
      meta: `${formatClock(event.start)}–${formatClock(event.end)}`,
      overdue: false,
    });
  }

  rows.sort(
    (a, b) =>
      a.bar.left - b.bar.left ||
      a.bar.width - b.bar.width ||
      String(a.title).localeCompare(String(b.title), 'zh-Hans-CN')
  );

  const taskRows = rows.filter((row) => row.kind === 'task');
  const done = taskRows.filter((row) => row.status === 'done').length;
  const days = weekDays.map((date, index) => ({
    date,
    key: toDateKey(date),
    weekday: `周${WEEKDAY_LABELS[index]}`,
    dayNumber: date.getDate(),
    isToday: toDateKey(date) === todayKey,
  }));

  return {
    days,
    rows,
    summary: {
      total: taskRows.length,
      done,
      percent: taskRows.length === 0 ? 0 : Math.round((done / taskRows.length) * 100),
    },
  };
}
