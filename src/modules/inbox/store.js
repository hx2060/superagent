/**
 * In-memory store for the day view's task inbox and sticky notes.
 *
 * The store is plain data + CRUD + a tiny subscription. It has no DOM access,
 * so it can be unit tested with node:test and later swapped for a real data
 * source (see docs/integration.md). Data lives for the current page session
 * only, matching the rest of the static demo.
 */

import { parseDateKey, timeToMinutes, toDateKey } from '../../calendar.js';
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER, taskStatusCounts, nextTaskStatus } from '../../tasks.js';

export const TASK_TITLE_MAX_LENGTH = 80;
export const NOTE_TEXT_MAX_LENGTH = 200;
export const DEFAULT_TASK_ICON = '📝';
export const TASK_DURATION_MIN = 5;
export const TASK_DURATION_MAX = 720;
export const TASK_SCHEDULE_START = 7 * 60;
export const TASK_SCHEDULE_END = 21 * 60;
export const TASK_EVENT_COLOR = 'teal';
export const NOTE_TONES = Object.freeze(['yellow', 'pink', 'blue']);
export const NOTE_TILTS = Object.freeze([-1.2, 1.4, -0.6]);

const TASK_STATUS_SET = new Set(TASK_STATUS_ORDER);
let fallbackIdSequence = 0;

function invalid(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function textLength(value) {
  return [...value].length;
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Normalise the schedule triple (date / start / duration) of a task.
 *
 * - `start` + `duration` → timed task bound to `date` (or `fallbackDate`).
 * - a `date` without times → all-day task on that date; clearing the times
 *   keeps the bound day (`fallbackDate`) as all-day.
 * - an explicitly empty `date` ('') without times → unscheduled, back to the
 *   collecting area; so is an omitted date without a fallback.
 *
 * `fallbackStart` / `fallbackDuration` let a date-only change move a timed
 * task without dropping its times.
 */
function normalizeSchedule({
  date,
  start,
  duration,
  fallbackDate,
  fallbackStart,
  fallbackDuration,
} = {}) {
  const startMentioned = start !== undefined;
  const durationMentioned = duration !== undefined;
  if (startMentioned !== durationMentioned) {
    throw invalid('INBOX_TASK_SCHEDULE_INVALID', '请同时填写开始时间和持续时间');
  }

  // An explicitly empty date ('') unbinds the task back to the collecting
  // area; pairing it with explicit times is rejected (times need a day).
  if (date === '') {
    if (startMentioned && String(start).trim() !== '') {
      throw invalid('INBOX_TASK_SCHEDULE_INVALID', '任务日期必须是 YYYY-MM-DD');
    }
    return null;
  }

  // Times mentioned in `changes` replace the stored ones; a date-only change
  // keeps them (so a timed task can be moved without losing its time).
  const fallbackHasPair = Boolean(fallbackStart) && Boolean(fallbackDuration);
  const startText = String(startMentioned ? start : fallbackHasPair ? fallbackStart : '').trim();
  const durationText = String(
    durationMentioned ? duration : fallbackHasPair ? fallbackDuration : ''
  ).trim();
  const hasStart = startText !== '';
  const hasDuration = durationText !== '';
  if (hasStart !== hasDuration) {
    throw invalid('INBOX_TASK_SCHEDULE_INVALID', '请同时填写开始时间和持续时间');
  }

  if (hasStart && hasDuration) {
    const startMinutes = timeToMinutes(startText);
    if (!Number.isFinite(startMinutes)) {
      throw invalid('INBOX_TASK_SCHEDULE_INVALID', '开始时间格式应为 HH:mm');
    }
    if (startMinutes < TASK_SCHEDULE_START || startMinutes >= TASK_SCHEDULE_END) {
      throw invalid('INBOX_TASK_SCHEDULE_INVALID', '开始时间需在 07:00–20:59 之间');
    }

    const durationMinutes = Number(durationText);
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < TASK_DURATION_MIN ||
      durationMinutes > TASK_DURATION_MAX
    ) {
      throw invalid(
        'INBOX_TASK_SCHEDULE_INVALID',
        `持续时间需为 ${TASK_DURATION_MIN}–${TASK_DURATION_MAX} 分钟的整数`
      );
    }
    if (startMinutes + durationMinutes > TASK_SCHEDULE_END) {
      throw invalid('INBOX_TASK_SCHEDULE_INVALID', '结束时间不得晚于 21:00（时间表范围 07:00–21:00）');
    }

    const parsedDate = parseDateKey(String(date ?? fallbackDate ?? ''));
    if (!parsedDate) {
      throw invalid('INBOX_TASK_SCHEDULE_INVALID', '任务日期必须是 YYYY-MM-DD');
    }

    return {
      date: toDateKey(parsedDate),
      start: minutesToTime(startMinutes),
      duration: durationMinutes,
    };
  }

  const dateText = date === undefined || date === null ? '' : String(date).trim();
  if (dateText) {
    const parsedDate = parseDateKey(dateText);
    if (!parsedDate) {
      throw invalid('INBOX_TASK_SCHEDULE_INVALID', '任务日期必须是 YYYY-MM-DD');
    }
    return { date: toDateKey(parsedDate) };
  }
  if (fallbackDate) return { date: fallbackDate };
  return null;
}

/** A deadline written before the task's own day is contradictory data. */
function assertDueNotBeforeDate(dueDate, dateKey) {
  if (dueDate && dateKey && dueDate < dateKey) {
    throw invalid('INBOX_TASK_DUE_INVALID', '截止日期不能早于任务日期');
  }
}

export function normalizeTaskTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) throw invalid('INBOX_TASK_TITLE_INVALID', '任务名称不能为空');
  if (textLength(title) > TASK_TITLE_MAX_LENGTH) {
    throw invalid('INBOX_TASK_TITLE_INVALID', `任务名称不能超过 ${TASK_TITLE_MAX_LENGTH} 个字符`);
  }
  return title;
}

export function normalizeTaskDue(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = parseDateKey(text);
  if (!parsed) throw invalid('INBOX_TASK_DUE_INVALID', '截止日期必须是 YYYY-MM-DD');
  return toDateKey(parsed);
}

export function normalizeNoteText(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw invalid('INBOX_NOTE_TEXT_INVALID', '便签内容不能为空');
  if (textLength(text) > NOTE_TEXT_MAX_LENGTH) {
    throw invalid('INBOX_NOTE_TEXT_INVALID', `便签内容不能超过 ${NOTE_TEXT_MAX_LENGTH} 个字符`);
  }
  return text;
}

function normalizeTaskIcon(value) {
  const icon = String(value ?? '').trim();
  return icon ? [...icon].slice(0, 8).join('') : DEFAULT_TASK_ICON;
}

function createDefaultIdFactory() {
  return (prefix) => {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    fallbackIdSequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${fallbackIdSequence}`;
  };
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   icon: string,
 *   status: 'todo' | 'partial' | 'done',
 *   date?: string,
 *   start?: string,
 *   duration?: number,
 *   end?: string,
 *   due?: string
 * }} InboxTask
 *
 * A task without `date` and `due` is unscheduled and lives in the collecting
 * area; a `date` without `start` / `duration` is an all-day task on that day.
 *
 * @typedef {{
 *   id: string,
 *   date: string,
 *   text: string,
 *   tone: 'yellow' | 'pink' | 'blue',
 *   tilt: number
 * }} InboxNote
 */

/**
 * @param {{
 *   tasks?: InboxTask[],
 *   notes?: InboxNote[],
 *   idFactory?: (prefix: 'task' | 'note') => string
 * }} [options]
 */
export function createInboxStore({ tasks = [], notes = [], idFactory } = {}) {
  const nextId = typeof idFactory === 'function' ? idFactory : createDefaultIdFactory();

  // Seed data can come from the local content file, where ids are expected but a
  // hand-written file may omit or duplicate one. Generate a temporary unique id
  // instead of rendering rows with `undefined` ids.
  const taskItems = [];
  for (const candidate of Array.isArray(tasks) ? tasks : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const task = { ...candidate };
    if (typeof task.id === 'string' && task.id.trim()) task.id = task.id.trim();
    if (!task.id || taskItems.some((item) => item.id === task.id)) {
      do {
        task.id = nextId('task');
      } while (taskItems.some((item) => item.id === task.id));
    }
    taskItems.push(task);
  }

  const noteItems = [];
  for (const candidate of Array.isArray(notes) ? notes : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const note = { ...candidate };
    if (typeof note.id === 'string' && note.id.trim()) note.id = note.id.trim();
    if (!note.id || noteItems.some((item) => item.id === note.id)) {
      do {
        note.id = nextId('note');
      } while (noteItems.some((item) => item.id === note.id));
    }
    noteItems.push(note);
  }

  const statuses = new Map(
    taskItems.map((task) => [
      task.id,
      TASK_STATUS_SET.has(task.status) ? task.status : TASK_STATUS_ORDER[0],
    ])
  );
  const listeners = new Set();

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  function presentTask(task) {
    const result = { ...task, status: statuses.get(task.id) ?? 'todo' };
    if (result.start && result.duration) {
      const endMinutes = timeToMinutes(result.start) + Number(result.duration);
      if (Number.isFinite(endMinutes)) result.end = minutesToTime(endMinutes);
    }
    return result;
  }

  function listTasks() {
    return taskItems.map(presentTask);
  }

  function findTask(id) {
    const index = taskItems.findIndex((task) => task.id === id);
    if (index === -1) throw invalid('INBOX_TASK_NOT_FOUND', `任务不存在：${id}`);
    return { index, task: taskItems[index] };
  }

  function taskStatus(id) {
    findTask(id);
    return statuses.get(id) ?? 'todo';
  }

  function addTask({ id, title, icon, date, start, duration, due } = {}) {
    const titleText = normalizeTaskTitle(title);
    const schedule = normalizeSchedule({ date, start, duration });
    const dueDate = normalizeTaskDue(due);
    assertDueNotBeforeDate(dueDate, schedule?.date);
    const requestedId = typeof id === 'string' ? id.trim() : '';
    const task = {
      id: '',
      title: titleText,
      icon: normalizeTaskIcon(icon),
      status: 'todo',
    };
    if (schedule) Object.assign(task, schedule);
    if (dueDate) task.due = dueDate;
    if (requestedId) {
      if (taskItems.some((item) => item.id === requestedId)) {
        throw invalid('INBOX_TASK_DUPLICATE_ID', `任务 id 已存在：${requestedId}`);
      }
      task.id = requestedId;
    } else {
      do {
        task.id = nextId('task');
      } while (taskItems.some((item) => item.id === task.id));
    }
    taskItems.push(task);
    statuses.set(task.id, 'todo');
    notify();
    return presentTask(task);
  }

  function updateTask(id, changes = {}) {
    const { task } = findTask(id);

    // Compute everything before mutating, so a rejected change leaves the
    // stored task untouched (no half-applied title / schedule).
    const nextTitle = changes.title !== undefined ? normalizeTaskTitle(changes.title) : task.title;
    const nextIcon = changes.icon !== undefined ? normalizeTaskIcon(changes.icon) : task.icon;

    const nextDue = Object.prototype.hasOwnProperty.call(changes, 'due')
      ? normalizeTaskDue(changes.due)
      : task.due;

    const hasScheduleField = ['date', 'start', 'duration'].some((key) =>
      Object.prototype.hasOwnProperty.call(changes, key)
    );
    let nextSchedule = null;
    if (hasScheduleField) {
      nextSchedule = normalizeSchedule({
        date: changes.date,
        start: changes.start,
        duration: changes.duration,
        fallbackDate: task.date,
        fallbackStart: task.start,
        fallbackDuration: task.duration,
      });
    }

    const nextDate = hasScheduleField ? nextSchedule?.date ?? null : task.date ?? null;
    assertDueNotBeforeDate(nextDue ?? null, nextDate);

    task.title = nextTitle;
    task.icon = nextIcon;
    if (Object.prototype.hasOwnProperty.call(changes, 'due')) {
      if (nextDue) task.due = nextDue;
      else delete task.due;
    }
    if (hasScheduleField) {
      delete task.date;
      delete task.start;
      delete task.duration;
      delete task.end;
      if (nextSchedule) Object.assign(task, nextSchedule);
    }

    notify();
    return presentTask(task);
  }

  function deleteTask(id) {
    const { index, task } = findTask(id);
    const removed = presentTask(task);
    taskItems.splice(index, 1);
    statuses.delete(id);
    notify();
    return removed;
  }

  function setTaskStatus(id, status) {
    findTask(id);
    if (!TASK_STATUS_SET.has(status)) {
      throw invalid('INBOX_TASK_STATUS_INVALID', `未知任务状态：${status}`);
    }
    statuses.set(id, status);
    notify();
    return status;
  }

  function cycleTaskStatus(id) {
    const next = nextTaskStatus(taskStatus(id));
    statuses.set(id, next);
    notify();
    return next;
  }

  function taskProgress() {
    return taskStatusCounts(taskItems, statuses);
  }

  /** Unscheduled tasks (no `date`, no `due`) — the collecting area. */
  function listUnscheduledTasks() {
    return taskItems.filter((task) => !task.date && !task.due).map(presentTask);
  }

  function listCalendarEvents(dateKey) {
    return taskItems
      .filter((task) => task.date === dateKey && task.start && task.duration)
      .map((task) => {
        const item = presentTask(task);
        return {
          id: `task-event-${task.id}`,
          title: task.title,
          date: task.date,
          start: task.start,
          end: item.end,
          color: TASK_EVENT_COLOR,
          icon: 'doc',
          note: `清单任务 · ${TASK_STATUS_LABELS[item.status] ?? item.status}`,
        };
      })
      .filter((event) => Boolean(event.end))
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }

  function noteDateKey(value) {
    const parsed = parseDateKey(String(value ?? ''));
    if (!parsed) throw invalid('INBOX_NOTE_DATE_INVALID', '便签日期必须是 YYYY-MM-DD');
    return toDateKey(parsed);
  }

  function listNotes(dateKey) {
    if (dateKey === undefined) return noteItems.map((note) => ({ ...note }));
    return noteItems.filter((note) => note.date === dateKey).map((note) => ({ ...note }));
  }

  function addNote({ date, text } = {}) {
    const dateKey = noteDateKey(date);
    const sameDayCount = noteItems.filter((note) => note.date === dateKey).length;
    const note = {
      id: '',
      date: dateKey,
      text: normalizeNoteText(text),
      tone: NOTE_TONES[sameDayCount % NOTE_TONES.length],
      tilt: NOTE_TILTS[sameDayCount % NOTE_TILTS.length],
    };
    do {
      note.id = nextId('note');
    } while (noteItems.some((item) => item.id === note.id));
    noteItems.push(note);
    notify();
    return { ...note };
  }

  function findNote(id) {
    const index = noteItems.findIndex((note) => note.id === id);
    if (index === -1) throw invalid('INBOX_NOTE_NOT_FOUND', `便签不存在：${id}`);
    return { index, note: noteItems[index] };
  }

  function updateNote(id, changes = {}) {
    const { note } = findNote(id);
    if (changes.text !== undefined) note.text = normalizeNoteText(changes.text);
    notify();
    return { ...note };
  }

  function deleteNote(id) {
    const { index, note } = findNote(id);
    noteItems.splice(index, 1);
    notify();
    return { ...note };
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener 必须是函数');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    listTasks,
    listUnscheduledTasks,
    addTask,
    updateTask,
    deleteTask,
    taskStatus,
    setTaskStatus,
    cycleTaskStatus,
    taskProgress,
    listCalendarEvents,
    listNotes,
    addNote,
    updateNote,
    deleteNote,
    subscribe,
  };
}
