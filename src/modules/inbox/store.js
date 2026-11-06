/**
 * In-memory store for the day view's task inbox and sticky notes.
 *
 * The store is plain data + CRUD + a tiny subscription. It has no DOM access,
 * so it can be unit tested with node:test and later swapped for a real data
 * source (see docs/integration.md). Data lives for the current page session
 * only, matching the rest of the static demo.
 */

import { parseDateKey, toDateKey } from '../../calendar.js';
import { TASK_STATUS_ORDER, taskStatusCounts, nextTaskStatus } from '../../tasks.js';

export const TASK_TITLE_MAX_LENGTH = 80;
export const NOTE_TEXT_MAX_LENGTH = 200;
export const DEFAULT_TASK_ICON = '📝';
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

export function normalizeTaskTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) throw invalid('INBOX_TASK_TITLE_INVALID', '任务名称不能为空');
  if (textLength(title) > TASK_TITLE_MAX_LENGTH) {
    throw invalid('INBOX_TASK_TITLE_INVALID', `任务名称不能超过 ${TASK_TITLE_MAX_LENGTH} 个字符`);
  }
  return title;
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
 *   status: 'todo' | 'partial' | 'done'
 * }} InboxTask
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
  const taskItems = tasks.map((task) => ({ ...task }));
  const noteItems = notes.map((note) => ({ ...note }));
  const statuses = new Map(
    taskItems.map((task) => [
      task.id,
      TASK_STATUS_SET.has(task.status) ? task.status : TASK_STATUS_ORDER[0],
    ])
  );
  const listeners = new Set();
  const nextId = typeof idFactory === 'function' ? idFactory : createDefaultIdFactory();

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  function listTasks() {
    return taskItems.map((task) => ({ ...task, status: statuses.get(task.id) ?? 'todo' }));
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

  function addTask({ title, icon } = {}) {
    const task = {
      id: '',
      title: normalizeTaskTitle(title),
      icon: normalizeTaskIcon(icon),
      status: 'todo',
    };
    do {
      task.id = nextId('task');
    } while (taskItems.some((item) => item.id === task.id));
    taskItems.push(task);
    statuses.set(task.id, 'todo');
    notify();
    return { ...task };
  }

  function updateTask(id, changes = {}) {
    const { task } = findTask(id);
    if (changes.title !== undefined) task.title = normalizeTaskTitle(changes.title);
    if (changes.icon !== undefined) task.icon = normalizeTaskIcon(changes.icon);
    notify();
    return { ...task, status: statuses.get(task.id) ?? 'todo' };
  }

  function deleteTask(id) {
    const { index, task } = findTask(id);
    const status = statuses.get(id) ?? task.status;
    taskItems.splice(index, 1);
    statuses.delete(id);
    notify();
    return { ...task, status };
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
    addTask,
    updateTask,
    deleteTask,
    taskStatus,
    setTaskStatus,
    cycleTaskStatus,
    taskProgress,
    listNotes,
    addNote,
    updateNote,
    deleteNote,
    subscribe,
  };
}
