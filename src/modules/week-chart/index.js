/**
 * Week chart module: task × time blocks.
 *
 * Rows are tasks (or timed events). Blocks show when a task starts and when it
 * is due; task rows also expose the three-state toggle so weekly tasks can be
 * completed without leaving the week view. The module reads tasks through
 * `services.inbox` and only touches `context.root`; it never imports app
 * internals.
 */

import { TASK_STATUS_LABELS } from '../../tasks.js';
import { buildWeekChart, formatDeadline, taskMeta } from './chart.js';

const STATUS_CYCLE_HINT = '待完成 → 部分完成 → 完成';
const EVENT_DOT_COLORS = {
  blue: '#3370ff',
  teal: '#0f9b8e',
  orange: '#e07800',
  violet: '#7b5cf0',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function checkIcon(status) {
  if (status === 'done') {
    return '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.2 8.4 3 3 6.6-7"/></svg>';
  }
  if (status === 'partial') {
    return '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3.2v9.6"/></svg>';
  }
  return '';
}

function dayHeader({ key, weekday, dayNumber, isToday }) {
  return `<button
    type="button"
    class="mod-week-chart-day${isToday ? ' is-today' : ''}"
    data-open-date="${escapeHtml(key)}"
    role="columnheader"
    aria-label="查看 ${escapeHtml(weekday)} ${dayNumber} 日的日视图"
    ${isToday ? 'aria-current="date"' : ''}
  >
    <span class="mod-week-chart-day-name">${escapeHtml(weekday)}</span>
    <span class="mod-week-chart-day-num">${dayNumber}</span>
  </button>`;
}

function gridCells(days) {
  return days
    .map(
      (day, index) =>
        `<span class="mod-week-chart-grid-day${index === 0 ? ' is-first' : ''}${day.isToday ? ' is-today' : ''}"></span>`
    )
    .join('');
}

/** One row of the overdue review area: toggle + title + deadline, no bar. */
function reviewRow(task, weekStartKey) {
  const id = escapeHtml(task.id);
  const title = escapeHtml(task.title);
  const status = task.status ?? 'todo';
  const statusLabel = TASK_STATUS_LABELS[status] ?? status;
  const meta = taskMeta(task, weekStartKey);
  const due = escapeHtml(task.due);
  return `<div class="mod-week-chart-review-row" data-week-chart-review-row="${id}" data-status="${status}">
    <div class="mod-week-chart-label">
      <button
        type="button"
        class="mod-week-chart-toggle"
        data-task-toggle="${id}"
        data-status="${status}"
        aria-label="切换任务「${title}」的状态，当前${statusLabel}"
        title="点击切换：${STATUS_CYCLE_HINT}"
      >${checkIcon(status)}</button>
      <span class="mod-week-chart-label-copy">
        <button
          type="button"
          class="mod-week-chart-title${status === 'done' ? ' is-done' : ''}"
          data-open-date="${due}"
          title="${title}${meta ? ` · ${escapeHtml(meta)}` : ''}"
        >${title}</button>
        ${meta ? `<span class="mod-week-chart-meta">${escapeHtml(meta)}</span>` : ''}
      </span>
    </div>
    <div class="mod-week-chart-track">
      <span class="mod-week-chart-review-due">${formatDeadline(task.due)}</span>
    </div>
  </div>`;
}

/**
 * Overdue review area: tasks whose deadline has passed, split into
 * 逾期未完成 / 已完成 and kept until deletion. Independent of the visible
 * week and excluded from the week progress summary.
 */
function renderReview(review, weekStartKey) {
  const groups = [
    { key: 'overdue', title: '逾期未完成', tasks: review.overdue },
    { key: 'completed', title: '已完成', tasks: review.completed },
  ].filter((group) => group.tasks.length > 0);
  if (groups.length === 0) return '';

  const total = review.overdue.length + review.completed.length;
  const groupsHtml = groups
    .map(
      (group) => `<div class="mod-week-chart-review-group" data-review-group="${group.key}">
        <span class="mod-week-chart-review-group-title">${group.title} ${group.tasks.length}</span>
        ${group.tasks.map((task) => reviewRow(task, weekStartKey)).join('')}
      </div>`
    )
    .join('');

  return `<div class="mod-week-chart-review" data-week-chart-review>
    <div class="mod-week-chart-review-bar">
      <span class="mod-week-chart-review-title">逾期回顾</span>
      <span class="mod-week-chart-review-count">共 ${total} 项 · 截止已过，保留供回顾</span>
    </div>
    ${groupsHtml}
  </div>`;
}

function rowLabel(row) {
  const id = escapeHtml(row.id);
  const title = escapeHtml(row.title);
  const status = row.status ?? 'todo';
  const statusLabel = TASK_STATUS_LABELS[status] ?? status;
  const meta = row.meta ? `<span class="mod-week-chart-meta">${escapeHtml(row.meta)}</span>` : '';

  if (row.kind === 'event') {
    const dot = EVENT_DOT_COLORS[row.color] ?? EVENT_DOT_COLORS.blue;
    return `<div class="mod-week-chart-label" role="rowheader">
      <span class="mod-week-chart-event-dot" style="--week-dot:${dot}" aria-hidden="true"></span>
      <span class="mod-week-chart-label-copy">
        <button
          type="button"
          class="mod-week-chart-title"
          data-open-date="${escapeHtml(row.bar.openDate)}"
          title="${title}${row.meta ? ` · ${escapeHtml(row.meta)}` : ''}"
        >${title}</button>
        ${meta}
      </span>
    </div>`;
  }

  return `<div class="mod-week-chart-label" role="rowheader">
    <button
      type="button"
      class="mod-week-chart-toggle"
      data-task-toggle="${id}"
      data-status="${status}"
      aria-label="切换任务「${title}」的状态，当前${statusLabel}"
      title="点击切换：${STATUS_CYCLE_HINT}"
    >${checkIcon(status)}</button>
    <span class="mod-week-chart-label-copy">
      <button
        type="button"
        class="mod-week-chart-title${status === 'done' ? ' is-done' : ''}"
        data-open-date="${escapeHtml(row.bar.openDate)}"
        title="${title}${row.meta ? ` · ${escapeHtml(row.meta)}` : ''}"
      >${title}</button>
      ${meta}
    </span>
  </div>`;
}

function rowBar(row) {
  const title = escapeHtml(row.title);
  const status = row.status ?? '';
  const statusLabel = status ? TASK_STATUS_LABELS[status] ?? status : '';
  const classes = [
    'mod-week-chart-bar',
    `is-${row.kind}`,
    status ? `is-${status}` : '',
    row.color ? `color-${escapeHtml(row.color)}` : '',
    row.bar.clippedStart ? 'is-clipped-start' : '',
    row.bar.clippedEnd ? 'is-clipped-end' : '',
    row.overdue ? 'is-overdue' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const label = row.bar.label
    ? `<span class="mod-week-chart-bar-label">${escapeHtml(row.bar.label)}</span>`
    : '';
  const aria = [
    title,
    row.meta,
    row.kind === 'task' ? `任务，${statusLabel}` : '日程',
  ]
    .filter(Boolean)
    .join('，');

  return `<button
    type="button"
    class="${classes}"
    data-week-chart-bar
    style="--bar-left:${row.bar.left};--bar-width:${row.bar.width}"
    data-open-date="${escapeHtml(row.bar.openDate)}"
    title="${aria}"
    aria-label="${aria}，打开日视图"
  >${label}</button>`;
}

/**
 * @param {{
 *   root: HTMLElement,
 *   state: Readonly<{ view: 'month'|'week'|'day', anchor: Date }>,
 *   data: { events?: object[], tasks?: object[] },
 *   services?: { inbox?: { listTasks(): object[], cycleTaskStatus(id: string): string } }
 * }} context
 */
export function mount(context) {
  const root = context?.root;
  if (!root) throw new Error('week-chart: context.root is required.');

  const inbox = context.services?.inbox ?? null;
  let anchor = context.state?.anchor instanceof Date ? new Date(context.state.anchor) : new Date();
  let events = Array.isArray(context.data?.events) ? context.data.events : [];
  let snapshotTasks = Array.isArray(context.data?.tasks) ? context.data.tasks : [];
  let liveText = '';

  function currentTasks() {
    return inbox ? inbox.listTasks() : snapshotTasks;
  }

  function render() {
    const model = buildWeekChart({
      anchor,
      tasks: currentTasks(),
      events,
      today: new Date(),
    });

    const daysHtml = model.days.map(dayHeader).join('');
    const rowsHtml = model.rows
      .map(
        (row) => `<div
          class="mod-week-chart-row${row.overdue ? ' is-overdue' : ''}"
          data-week-chart-row="${escapeHtml(row.id)}"
          data-kind="${escapeHtml(row.kind)}"
          ${row.kind === 'task' ? `data-status="${escapeHtml(row.status ?? 'todo')}"` : ''}
          role="row"
        >
          ${rowLabel(row)}
          <div class="mod-week-chart-track" role="cell">
            <div class="mod-week-chart-grid" aria-hidden="true">${gridCells(model.days)}</div>
            ${rowBar(row)}
          </div>
        </div>`
      )
      .join('');

    const empty = model.rows.length
      ? ''
      : `<div class="mod-week-chart-empty">
          <strong>本周还没有任务安排</strong>
          <span>在日视图清单里给任务填写开始时间，任务会出现在这里；带截止日期的任务会标在截止当天。</span>
        </div>`;

    const weekStartKey = model.days[0].key;
    const reviewHtml = renderReview(model.review, weekStartKey);

    root.innerHTML = `<div class="mod-week-chart" role="table" aria-label="本周任务与时间">
      <div class="mod-week-chart-head" role="row">
        <div class="mod-week-chart-corner" role="columnheader">
          <span class="mod-week-chart-corner-title">本周任务</span>
          <span class="mod-week-chart-progress" data-week-chart-progress>${model.summary.done} / ${model.summary.total} 完成</span>
          <span class="mod-week-chart-progress-track" aria-hidden="true">
            <span class="mod-week-chart-progress-fill" style="width:${model.summary.percent}%"></span>
          </span>
        </div>
        <div class="mod-week-chart-days" role="presentation">${daysHtml}</div>
      </div>
      ${reviewHtml}
      <div class="mod-week-chart-body" role="rowgroup">
        ${rowsHtml || empty}
      </div>
      <p class="mod-week-chart-live" aria-live="polite" data-week-chart-live>${escapeHtml(liveText)}</p>
    </div>`;

    liveText = '';
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const toggle = target.closest('[data-task-toggle]');
    if (!toggle || !inbox) return;

    const id = toggle.dataset.taskToggle;
    const task = inbox.listTasks().find((item) => item.id === id);
    if (!task) return;

    const next = inbox.cycleTaskStatus(id);
    liveText = `「${task.title}」已标记为${TASK_STATUS_LABELS[next] ?? next}`;
    render();
    // Re-rendering replaces the button; keep keyboard focus on the same task.
    const nextToggle = root.querySelector(`[data-task-toggle="${CSS.escape(id)}"]`);
    if (nextToggle) nextToggle.focus();
  }

  const unsubscribe = inbox?.subscribe ? inbox.subscribe(() => render()) : null;
  root.addEventListener('click', handleClick);
  render();

  return {
    update(nextContext) {
      if (nextContext?.state?.anchor instanceof Date) {
        anchor = new Date(nextContext.state.anchor);
      }
      if (Array.isArray(nextContext?.data?.events)) events = nextContext.data.events;
      if (Array.isArray(nextContext?.data?.tasks)) snapshotTasks = nextContext.data.tasks;
      render();
    },
    destroy() {
      if (unsubscribe) unsubscribe();
      root.removeEventListener('click', handleClick);
      root.innerHTML = '';
    },
  };
}
