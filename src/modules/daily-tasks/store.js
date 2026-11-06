/**
 * Daily recurring tasks: one shared definition list plus a per-day completion
 * state. A daily task is not a timed event and is not scheduled on a date; the
 * day only scopes "did I complete it today". The store is pure (no DOM) so the
 * host app and unit tests can use it directly.
 */

import { parseDateKey } from '../../calendar.js';
import { TASK_STATUS_ORDER, nextTaskStatus, taskStatusCounts } from '../../tasks.js';

export const DAILY_TASK_RECURRENCE = 'daily';
export const DAILY_TASK_DEFAULT_ICON = '🔁';
export const DAILY_TASK_TITLE_MAX_LENGTH = 80;
export const DAILY_TASK_ICON_MAX_CODE_POINTS = 8;

let generatedIdCount = 0;

function defaultCreateId() {
  generatedIdCount += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `daily-${uuid}`;
  return `daily-${Date.now().toString(36)}-${generatedIdCount.toString(36)}`;
}

function taskError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertDateKey(dateKey) {
  if (typeof dateKey !== 'string' || !parseDateKey(dateKey)) {
    throw taskError('DAILY_TASK_DATE_INVALID', `Invalid date key: ${dateKey}`);
  }
}

/**
 * Validate and normalise one daily-task definition.
 * Returns null when the input is unusable; the caller decides how to react.
 *
 * @param {{ id?: string, title?: string, icon?: string }} input
 * @returns {{ id: string|null, title: string, icon: string, recurrence: 'daily' } | null}
 */
export function normalizeDailyTask(input) {
  if (!input || typeof input !== 'object') return null;

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > DAILY_TASK_TITLE_MAX_LENGTH) return null;

  const rawIcon = typeof input.icon === 'string' ? input.icon.trim() : '';
  const icon = rawIcon
    ? Array.from(rawIcon).slice(0, DAILY_TASK_ICON_MAX_CODE_POINTS).join('')
    : DAILY_TASK_DEFAULT_ICON;
  const rawId = typeof input.id === 'string' ? input.id.trim() : '';

  return {
    id: rawId || null,
    title,
    icon,
    recurrence: DAILY_TASK_RECURRENCE,
  };
}

/**
 * @param {Array<{ id?: string, title: string, icon?: string }>} seedTasks
 * @param {{ createId?: () => string }} [options]
 */
export function createDailyTaskStore(seedTasks = [], options = {}) {
  const createId = typeof options.createId === 'function' ? options.createId : defaultCreateId;
  const tasks = [];
  const tasksById = new Map();
  /** @type {Map<string, Map<string, import('../../tasks.js').TaskStatus>>} */
  const statusesByDate = new Map();
  const listeners = new Set();

  function emit(change) {
    for (const listener of [...listeners]) listener(change);
  }

  function getStatus(taskId, dateKey) {
    assertDateKey(dateKey);
    return statusesByDate.get(dateKey)?.get(taskId) ?? 'todo';
  }

  function setStatus(taskId, dateKey, status) {
    assertDateKey(dateKey);
    if (!tasksById.has(taskId)) {
      throw taskError('DAILY_TASK_NOT_FOUND', `Unknown daily task: ${taskId}`);
    }
    if (!TASK_STATUS_ORDER.includes(status)) {
      throw taskError('DAILY_TASK_STATUS_INVALID', `Unknown task status: ${status}`);
    }

    let dateStatuses = statusesByDate.get(dateKey);
    if (!dateStatuses) {
      dateStatuses = new Map();
      statusesByDate.set(dateKey, dateStatuses);
    }
    dateStatuses.set(taskId, status);
    emit({ type: 'status', taskId, dateKey, status });
    return status;
  }

  function toggleStatus(taskId, dateKey) {
    const next = nextTaskStatus(getStatus(taskId, dateKey));
    return setStatus(taskId, dateKey, next);
  }

  function addTask(input) {
    const normalized = normalizeDailyTask(input);
    if (!normalized) {
      throw taskError(
        'DAILY_TASK_INVALID',
        `Daily task title must be 1–${DAILY_TASK_TITLE_MAX_LENGTH} characters.`
      );
    }

    const id = normalized.id ?? createId();
    if (typeof id !== 'string' || !id.trim()) {
      throw taskError('DAILY_TASK_INVALID', 'Daily task id must be a non-empty string.');
    }
    if (tasksById.has(id)) {
      throw taskError('DAILY_TASK_DUPLICATE_ID', `Duplicate daily task id: ${id}`);
    }

    const task = {
      id,
      title: normalized.title,
      icon: normalized.icon,
      recurrence: DAILY_TASK_RECURRENCE,
    };
    tasks.push(task);
    tasksById.set(id, task);
    emit({ type: 'add', task: { ...task } });
    return { ...task };
  }

  function listTasks() {
    return tasks.map((task) => ({ ...task }));
  }

  function listForDate(dateKey) {
    assertDateKey(dateKey);
    return tasks.map((task) => ({ task: { ...task }, status: getStatus(task.id, dateKey) }));
  }

  function statusCounts(dateKey) {
    assertDateKey(dateKey);
    const dayStatuses = new Map(tasks.map((task) => [task.id, getStatus(task.id, dateKey)]));
    return taskStatusCounts(tasks, dayStatuses);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Daily task listener must be a function.');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  for (const candidate of Array.isArray(seedTasks) ? seedTasks : []) {
    const normalized = normalizeDailyTask(candidate);
    if (!normalized) continue;

    const id = normalized.id ?? createId();
    if (typeof id !== 'string' || !id.trim() || tasksById.has(id)) continue;

    const task = {
      id,
      title: normalized.title,
      icon: normalized.icon,
      recurrence: DAILY_TASK_RECURRENCE,
    };
    tasks.push(task);
    tasksById.set(id, task);
  }

  return {
    addTask,
    listTasks,
    listForDate,
    getStatus,
    setStatus,
    toggleStatus,
    statusCounts,
    subscribe,
  };
}
