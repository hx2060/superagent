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
