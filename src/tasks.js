/**
 * Task checklist logic for the day view. Tasks are intentionally not placed on
 * the timetable: they are a loose list with a three-state completion cycle.
 */

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

/**
 * Month-view anchors for one task.
 *
 * - A dated task appears on its date and, when the deadline differs, on the
 *   deadline day.
 * - A deadline-only task starts TODAY (so the month no longer shows it only at
 *   the deadline) and also appears on the deadline day.
 * - A past deadline, or a deadline equal to today, keeps only the deadline day.
 *
 * @param {{ date?: string, due?: string }} task
 * @param {string} todayKey local YYYY-MM-DD
 * @returns {Array<{ key: string, due: boolean }>}
 */
export function taskMonthAnchors(task, todayKey) {
  if (!task || typeof task !== 'object') return [];
  const anchors = [];
  if (task.date) anchors.push({ key: task.date, due: false });
  if (task.due) {
    if (!task.date && task.due > todayKey) anchors.push({ key: todayKey, due: false });
    if (task.due !== task.date) anchors.push({ key: task.due, due: true });
  }
  return anchors;
}
