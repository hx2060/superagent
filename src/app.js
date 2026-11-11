import {
  WEEKDAY_LABELS,
  WEEK_GRID_END_HOUR,
  WEEK_GRID_START_HOUR,
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
  startOfDay,
  timeToMinutes,
  toDateKey,
} from './calendar.js';
import {
  loadLocalData,
  pickSeedData,
  sampleDailyTasks,
  sampleEvents,
  sampleNotes,
  samplePool,
  sampleTasks,
} from './data.js';
import {
  TASK_STATUS_LABELS,
  monthSpanBars,
  taskMonthAnchors,
  taskReviewGroups,
  taskWindow,
} from './tasks.js';
import { createDailyTaskStore, mount as mountDailyTasks } from './modules/daily-tasks/index.js';
import { createInboxStore, mount as mountInbox } from './modules/inbox/index.js';
import { mount as mountWeekChart } from './modules/week-chart/index.js';
import { createPoolStore, mount as mountAttentionSwitch } from './modules/attention-switch/index.js';

const VIEWS = new Set(['month', 'week', 'day']);
const TASK_STATUS_COLORS = { todo: 'blue', partial: 'orange', done: 'teal' };

// Read "today" per render so a page left open past midnight keeps agreeing
// with the week chart and the day plan.
function currentToday() {
  return startOfDay(new Date());
}

const state = {
  view: 'month',
  anchor: currentToday(),
};

// Concrete schedules live in the git-ignored local/schedule.json; the committed
// arrays in src/data.js stay blank. A missing/broken local file starts blank.
const localData = await loadLocalData();
const seed = pickSeedData(localData, {
  events: sampleEvents,
  notes: sampleNotes,
  tasks: sampleTasks,
  dailyTasks: sampleDailyTasks,
  pool: samplePool,
});
const events = seed.events;

const inbox = createInboxStore({ tasks: seed.tasks, notes: seed.notes });
const dailyTasks = createDailyTaskStore(seed.dailyTasks);
const pool = createPoolStore(seed.pool);
let inboxView = null;
let dailyTasksView = null;
let weekChartView = null;

const EVENT_DOT_COLORS = {
  blue: '#3370ff',
  teal: '#0f9b8e',
  orange: '#e07800',
  violet: '#7b5cf0',
};

const root = document.querySelector('#view-root');
const periodTitle = document.querySelector('#period-title');
const viewButtons = [...document.querySelectorAll('[data-view]')];

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

function readInitialState() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (VIEWS.has(view)) state.view = view;

  const date = parseDateKey(params.get('date'));
  if (date) state.anchor = date;
}

function currentDateKey() {
  return toDateKey(new Date());
}

const dailyTasksApi = Object.freeze({
  add(input) {
    return dailyTasks.addTask(input);
  },
  list(date = currentDateKey()) {
    return dailyTasks.listForDate(date);
  },
  getStatus(taskId, date = currentDateKey()) {
    return dailyTasks.getStatus(taskId, date);
  },
  setStatus(taskId, status, date = currentDateKey()) {
    return dailyTasks.setStatus(taskId, date, status);
  },
  toggle(taskId, date = currentDateKey()) {
    return dailyTasks.toggleStatus(taskId, date);
  },
  subscribe(listener) {
    return dailyTasks.subscribe(listener);
  },
});

// Public "dsh" input interface. Tasks are the canonical way to add scheduled
// work; see docs/schedule-api.md. The manual input remains the day-view form.
const tasksApi = Object.freeze({
  add(input) {
    return inbox.addTask(input);
  },
  update(id, changes) {
    return inbox.updateTask(id, changes);
  },
  remove(id) {
    return inbox.deleteTask(id);
  },
  get(id) {
    return inbox.listTasks().find((task) => task.id === id) ?? null;
  },
  list() {
    return inbox.listTasks();
  },
  setStatus(id, status) {
    return inbox.setTaskStatus(id, status);
  },
  cycleStatus(id) {
    return inbox.cycleTaskStatus(id);
  },
  subscribe(listener) {
    return inbox.subscribe(listener);
  },
});

// Attention-switch pool (蓄水池): the option reservoir the panel reads and
// writes; dsh feeds it through window.schedule.pool below.
const poolApi = Object.freeze({
  add(input) {
    return pool.addItem(input);
  },
  list() {
    return pool.listItems();
  },
  remove(id) {
    return pool.deleteItem(id);
  },
});

window.schedule = Object.freeze({
  version: '0.8',
  tasks: tasksApi,
  dailyTasks: dailyTasksApi,
  pool: poolApi,
});

function periodLabel() {
  if (state.view === 'month') return formatMonthTitle(state.anchor);
  if (state.view === 'week') return formatWeekTitle(state.anchor);
  return formatDayTitle(state.anchor);
}

function eventChip(event) {
  return `<span class="chip chip--${event.color}"><span class="chip-title">${escapeHtml(event.title)}</span></span>`;
}

function taskChip(task, due) {
  const color = TASK_STATUS_COLORS[task.status] ?? 'blue';
  const classes = ['chip', `chip--${color}`, 'chip--task'];
  if (due) classes.push('chip--due');
  if (task.status === 'done') classes.push('is-done');
  const prefix = due ? '截止 ' : '';
  const time = !due && task.start ? `${task.start} · ` : '';
  return `<span class="${classes.join(' ')}"><span class="chip-title">${prefix}${time}${escapeHtml(task.title)}</span></span>`;
}

/**
 * Month cells and the day strip show one unified agenda: timed events, tasks
 * bound to a date, and tasks whose deadline falls on that date. This is the
 * mechanism that keeps the checklist, week chart and month grid in sync.
 *
 * Tasks that occupy more than one day are drawn as span bars
 * ({@link monthSpanBars}) instead of chips, so they are skipped here.
 *
 * @param {string} todayKey local YYYY-MM-DD
 * @param {object[]} tasks current inbox tasks
 */
function monthItems(todayKey, tasks) {
  const map = new Map();
  const add = (key, sort, html) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ sort, html });
  };

  for (const event of events) {
    add(event.date, timeToMinutes(event.start), eventChip(event));
  }
  for (const task of tasks) {
    const window = taskWindow(task, todayKey);
    if (window && window.startKey !== window.endKey) continue;
    for (const anchor of taskMonthAnchors(task, todayKey)) {
      const sort = anchor.due
        ? 24 * 60
        : task.start && task.date === anchor.key
          ? timeToMinutes(task.start)
          : 0;
      add(anchor.key, sort, taskChip(task, anchor.due));
    }
  }
  for (const items of map.values()) items.sort((a, b) => a.sort - b.sort);
  return map;
}

/** 截止 11/8 style label for the overdue review banner. */
function formatDeadlineLabel(dateKey) {
  const date = parseDateKey(dateKey);
  return date ? `截止 ${date.getMonth() + 1}月${date.getDate()}日` : '截止';
}

/**
 * Month-view overdue review banner: tasks whose deadline has passed, split
 * into 逾期未完成 / 已完成 and kept until deletion (shared grouping with the
 * week chart). Status can be toggled here; titles jump to the deadline day.
 */
function renderMonthReview() {
  const review = taskReviewGroups(inbox.listTasks(), toDateKey(currentToday()));
  const groups = [
    { key: 'overdue', title: '逾期未完成', tasks: review.overdue },
    { key: 'completed', title: '已完成', tasks: review.completed },
  ].filter((group) => group.tasks.length > 0);
  if (groups.length === 0) return '';

  const total = review.overdue.length + review.completed.length;
  const groupsHtml = groups
    .map(
      (group) => `<div class="month-review-group" data-review-group="${group.key}">
        <span class="month-review-group-title">${group.title} ${group.tasks.length}</span>
        <span class="month-review-items">
          ${group.tasks
            .map((task) => {
              const id = escapeHtml(task.id);
              const title = escapeHtml(task.title);
              const status = task.status ?? 'todo';
              const statusLabel = TASK_STATUS_LABELS[status] ?? status;
              return `<span class="month-review-item" data-review-item="${id}" data-status="${status}">
                <button
                  type="button"
                  class="task-check"
                  data-task-toggle="${id}"
                  data-status="${status}"
                  aria-label="切换任务「${title}」的状态，当前${statusLabel}"
                  title="点击切换：待完成 → 部分完成 → 完成"
                ></button>
                <button
                  type="button"
                  class="month-review-task"
                  data-open-date="${escapeHtml(task.due)}"
                  title="${title} · ${formatDeadlineLabel(task.due)}"
                >${title}</button>
                <span class="month-review-due">${formatDeadlineLabel(task.due)}</span>
              </span>`;
            })
            .join('')}
        </span>
      </div>`
    )
    .join('');

  return `<div class="month-review" data-month-review>
    <span class="month-review-title">逾期回顾</span>
    <span class="month-review-count">共 ${total} 项 · 截止已过，保留供回顾</span>
    <div class="month-review-groups">${groupsHtml}</div>
  </div>`;
}

/** 「截止 11/8」 style compact month-day label for span bar tooltips. */
function formatMonthDay(dateKey) {
  const date = parseDateKey(dateKey);
  return date ? `${date.getMonth() + 1}/${date.getDate()}` : dateKey;
}

/** 「示例任务 · 11/10 – 11/13 · 截止 11月13日 · 待完成」 for a span bar. */
function monthSpanBarTitle(bar) {
  const parts = [
    escapeHtml(bar.title),
    `${formatMonthDay(bar.startKey)} – ${formatMonthDay(bar.endKey)}`,
  ];
  if (bar.dueKey) parts.push(formatDeadlineLabel(bar.dueKey));
  parts.push(TASK_STATUS_LABELS[bar.status] ?? bar.status);
  return parts.join(' · ');
}

/**
 * One month span bar: a multi-day task drawn as a single block across the days
 * it occupies (mirroring the week chart). Status picks the color, clipped
 * ends stay flat so the block reads as continuing into the next / previous
 * week row.
 */
function monthSpanBar(bar) {
  const color = TASK_STATUS_COLORS[bar.status] ?? 'blue';
  const classes = ['month-span-bar', `chip--${color}`];
  if (bar.status === 'done') classes.push('is-done');
  if (bar.overdue) classes.push('is-overdue');
  if (bar.clippedStart) classes.push('is-clipped-start');
  if (bar.clippedEnd) classes.push('is-clipped-end');
  const label = monthSpanBarTitle(bar);
  return `<button
    type="button"
    class="${classes.join(' ')}"
    data-month-span-bar
    style="grid-row:${bar.row + 1};grid-column:${bar.startCol + 1} / span ${bar.endCol - bar.startCol + 1};--month-span-lane:${bar.lane}"
    data-open-date="${bar.openDate}"
    title="${label}"
    aria-label="${label}，打开日视图"
  ><span class="month-span-bar-label">${escapeHtml(bar.title)}</span></button>`;
}

function renderMonth() {
  const today = currentToday();
  const todayKey = toDateKey(today);
  const monthDays = buildMonthMatrix(state.anchor);
  const month = state.anchor.getMonth();
  const tasks = inbox.listTasks();
  const itemsByDate = monthItems(todayKey, tasks);
  const reviewHtml = renderMonthReview();

  // 跨天任务：一条长条按周行裁剪绘制，同周行按车道堆叠。
  const spanModel = monthSpanBars(tasks, monthDays, todayKey);
  const lanesByRow = new Array(6).fill(0);
  for (const bar of spanModel.bars) {
    lanesByRow[bar.row] = Math.max(lanesByRow[bar.row], bar.lane + 1);
  }
  const spanCountByDay = new Map();
  const overflowCountByDay = new Map();
  const countBarDays = (map, bar) => {
    for (let index = bar.row * 7 + bar.startCol; index <= bar.row * 7 + bar.endCol; index += 1) {
      const key = toDateKey(monthDays[index]);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  };
  for (const bar of spanModel.bars) countBarDays(spanCountByDay, bar);
  for (const bar of spanModel.overflow) countBarDays(overflowCountByDay, bar);

  // 长条与日格并列挂在同一个网格上（显式占位），共享动态行高。
  const spanBarsHtml = spanModel.bars.map(monthSpanBar).join('');

  const weekdayRow = WEEKDAY_LABELS.map(
    (label) => `<div class="month-weekday">周${label}</div>`
  ).join('');

  const cells = monthDays
    .map((date, index) => {
      const key = toDateKey(date);
      const items = itemsByDate.get(key) ?? [];
      const spanCount = spanCountByDay.get(key) ?? 0;
      const overflowCount = overflowCountByDay.get(key) ?? 0;
      const inMonth = date.getMonth() === month;
      const classes = ['month-cell'];
      if (!inMonth) classes.push('is-outside');
      if (isSameDay(date, today)) classes.push('is-today');

      const visibleChips = items.slice(0, 2).map((item) => item.html).join('');
      // 「+N 项」= 超出两个 chip 的安排 + 被车道上限挤掉的长条；周行高度按内容
      // 动态延伸（CSS），chip 与指示器始终完整可见，无需事后适配。
      const hiddenCount = items.length - 2 + overflowCount;
      const more = hiddenCount > 0 ? `<span class="month-more">+${hiddenCount} 项</span>` : '';
      const total = items.length + spanCount;
      const countLabel = total === 0 ? '无安排' : `${total} 项安排`;
      // 长条与日格同处一个网格：日格显式占位，长条按周行 / 列区间摆放，
      // 行高随内容动态延伸时长条跟随同一行（不再用覆盖层，避免行高漂移）。
      const lanes = lanesByRow[Math.floor(index / 7)];
      const styleParts = [`grid-row:${Math.floor(index / 7) + 1}`, `grid-column:${(index % 7) + 1}`];
      if (lanes > 0) styleParts.push(`--month-span-lanes:${lanes}`);
      const laneStyle = ` style="${styleParts.join(';')}"`;

      return `<button
        type="button"
        class="${classes.join(' ')}"
        data-open-date="${key}"
        ${laneStyle}
        aria-label="${date.getMonth() + 1}月${date.getDate()}日，${countLabel}，打开日视图"
        ${isSameDay(date, today) ? 'aria-current="date"' : ''}
      >
        <span class="date-line"><span class="date-num">${date.getDate()}</span></span>
        <span class="chips">${visibleChips}${more}</span>
      </button>`;
    })
    .join('');

  return `<div class="month-view">
    ${reviewHtml}
    <div class="month-weekdays">${weekdayRow}</div>
    <div class="month-grid">${cells}${spanBarsHtml}</div>
  </div>`;
}

function renderWeek() {
  return `<div class="week-view">
    <div class="mod-week-chart-root" data-module-root="week-chart"></div>
  </div>`;
}

const EVENT_ICONS = {
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"/>',
  doc: '<path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M14 3.5V8h4M9 12h6M9 15.5h6"/>',
  activity: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  users: '<circle cx="9" cy="9" r="3"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="8" r="2.4"/><path d="M16 13.5c2.5.2 4.5 2.1 4.5 4.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7"/>',
  chat: '<path d="M20 12a7 7 0 0 1-7 7H5l2-3a7 7 0 1 1 13-4Z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  map: '<path d="m9 4 6 2 5-2v16l-5 2-6-2-5 2V6l5-2Z"/><path d="M9 4v14M15 6v14"/>',
};

function eventIcon(name) {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EVENT_ICONS[name] ?? EVENT_ICONS.doc}</svg>`;
}

function renderDayWeekStrip() {
  const today = currentToday();
  const days = getWeekDays(state.anchor);
  const grouped = groupEventsByDate(events);

  const weekRange = formatWeekTitle(state.anchor).replace(/^\d{4}年/, '');

  return `<div class="day-weekstrip" role="group" aria-label="本周日期">
    <span class="day-strip-caption">本周</span>
    <span class="day-strip-range">${weekRange}</span>
    ${days
      .map((date) => {
        const key = toDateKey(date);
        const items = [...(grouped.get(key) ?? []), ...inbox.listCalendarEvents(key)];
        const selected = isSameDay(date, state.anchor);
        const isToday = isSameDay(date, today);
        const dots = items
          .slice(0, 4)
          .map((item) => `<span class="day-strip-dot" style="background:${EVENT_DOT_COLORS[item.color] ?? '#3370ff'}"></span>`)
          .join('');
        return `<button
          type="button"
          class="day-strip-day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}"
          data-open-date="${key}"
          aria-label="${date.getMonth() + 1}月${date.getDate()}日，${items.length} 项安排，查看当日"
          ${selected ? 'aria-current="date"' : ''}
        >
          <span class="day-strip-name">周${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}</span>
          <span class="day-strip-num">${date.getDate()}</span>
          <span class="day-strip-dots">${dots}</span>
        </button>`;
      })
      .join('')}
  </div>`;
}

function renderDayTimeline(dayEvents) {
  const startMinutes = WEEK_GRID_START_HOUR * 60;
  const endMinutes = WEEK_GRID_END_HOUR * 60;
  const totalMinutes = endMinutes - startMinutes;
  const toPercent = (minutes) => ((minutes - startMinutes) / totalMinutes) * 100;

  const axis = [];
  for (let hour = 8; hour <= 20; hour += 2) {
    axis.push(
      `<span class="day-axis-label" style="top:${toPercent(hour * 60)}%">${String(hour).padStart(2, '0')}:00</span>`
    );
  }

  const layouts = layoutOverlaps(dayEvents);
  const items = dayEvents
    .map((event) => {
      const start = timeToMinutes(event.start);
      const end = timeToMinutes(event.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '';
      const visibleStart = Math.max(start, startMinutes);
      const visibleEnd = Math.min(end, endMinutes);
      if (visibleEnd <= visibleStart) return '';

      const top = toPercent(visibleStart);
      const height = ((visibleEnd - visibleStart) / totalMinutes) * 100;
      const layout = layouts.get(event.id) ?? { column: 0, columns: 1 };
      const columns = Math.max(1, layout.columns);
      const column = Math.min(Math.max(0, layout.column), columns - 1);
      const fraction = column / columns;
      const copyPosition =
        columns > 1
          ? `left:calc(${fraction * 100}% + ${56 - fraction * 64}px);width:calc(${100 / columns}% - ${64 / columns + 8}px);right:auto;`
          : '';

      return `<div class="day-event day-pill day-pill--${event.color}" style="top:${top}%;height:${height}%">
          <span class="day-pill-icon">${eventIcon(event.icon)}</span>
        </div>
        <div class="day-event-copy" data-column="${column}" data-columns="${columns}" style="top:${top}%;${copyPosition}">
          <span class="day-event-title">${escapeHtml(event.title)}</span>
          <span class="day-event-time">${formatTimeRange(event.start, event.end)} · ${formatDuration(end - start)}</span>
          ${event.note ? `<span class="day-event-note">${escapeHtml(event.note)}</span>` : ''}
        </div>`;
    })
    .join('');

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowLine =
    isSameDay(state.anchor, currentToday()) && nowMinutes >= startMinutes && nowMinutes <= endMinutes
      ? `<div class="day-now" style="top:${toPercent(nowMinutes)}%"><span></span></div>`
      : '';

  const empty =
    dayEvents.length === 0
      ? `<div class="day-timeline-empty"><span class="day-timeline-empty-icon">☀️</span><p>这一天还没有时间安排</p><small>把不定时的事放进清单</small></div>`
      : '';

  return `<div class="day-timeline">
    <div class="day-timeline-inner">
      <div class="day-axis" aria-hidden="true">${axis.join('')}</div>
      <div class="day-track">
        ${dayEvents.length ? '<div class="day-guide" aria-hidden="true"></div>' : ''}
        ${items}
        ${nowLine}
        ${empty}
      </div>
    </div>
  </div>`;
}

function dayEventsFor(anchor) {
  const dateKey = toDateKey(anchor);
  return [
    ...eventsForDay(events, anchor),
    ...inbox.listCalendarEvents(dateKey),
  ].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

function renderTimelinePanel(dayEvents) {
  return `<section class="day-panel day-timeline-panel">
    <header class="day-panel-head">
      <h2 class="day-panel-title"><span class="day-dot" aria-hidden="true"></span>时间表</h2>
      <span class="day-panel-meta">${dayEvents.length} 项安排</span>
    </header>
    ${renderDayTimeline(dayEvents)}
  </section>`;
}

function refreshDayView() {
  if (state.view !== 'day') return;
  const strip = root.querySelector('.day-weekstrip');
  if (strip) strip.outerHTML = renderDayWeekStrip();
  const panel = root.querySelector('.day-timeline-panel');
  if (panel) panel.outerHTML = renderTimelinePanel(dayEventsFor(state.anchor));
}

function renderDay() {
  return `<div class="day-view">
    ${renderDayWeekStrip()}
    <div data-module-root="daily-tasks"></div>
    <div class="day-columns">
      <aside class="day-sidebar" data-module-root="inbox"></aside>
      ${renderTimelinePanel(dayEventsFor(state.anchor))}
    </div>
  </div>`;
}

function render() {
  if (inboxView) {
    inboxView.destroy();
    inboxView = null;
  }

  if (dailyTasksView) {
    dailyTasksView.destroy();
    dailyTasksView = null;
  }

  if (weekChartView) {
    weekChartView.destroy();
    weekChartView = null;
  }

  periodTitle.textContent = periodLabel();

  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }

  if (state.view === 'month') {
    root.innerHTML = renderMonth();
  } else if (state.view === 'week') {
    root.innerHTML = renderWeek();
    weekChartView = mountWeekChart({
      root: root.querySelector('[data-module-root="week-chart"]'),
      state: { view: state.view, anchor: new Date(state.anchor) },
      data: { events, tasks: inbox.listTasks() },
      services: { inbox },
    });
  } else {
    root.innerHTML = renderDay();
    inboxView = mountInbox({
      root: root.querySelector('[data-module-root="inbox"]'),
      state: { view: state.view, anchor: new Date(state.anchor) },
      data: {
        events,
        notes: inbox.listNotes(toDateKey(state.anchor)),
        tasks: inbox.listTasks(),
      },
      services: { inbox },
    });
    dailyTasksView = mountDailyTasks({
      root: root.querySelector('[data-module-root="daily-tasks"]'),
      state: { view: state.view, anchor: new Date(state.anchor) },
      data: {
        events,
        notes: inbox.listNotes(toDateKey(state.anchor)),
        tasks: inbox.listTasks(),
        dailyTasks: dailyTasks.listTasks(),
      },
      services: { dailyTasks },
    });
  }
}

// Keep the visible view in sync with the shared stores. Day view only refreshes
// the timeline panel (the inbox module owns its own panel); month re-renders in
// place; week chart subscribes inside its module.
inbox.subscribe(() => {
  if (state.view === 'month') render();
  else if (state.view === 'day') refreshDayView();
});

function setView(view) {
  if (!VIEWS.has(view) || view === state.view) return;
  state.view = view;
  render();
}

function step(direction) {
  if (state.view === 'month') state.anchor = addMonths(state.anchor, direction);
  else if (state.view === 'week') state.anchor = addDays(state.anchor, direction * 7);
  else state.anchor = addDays(state.anchor, direction);
  render();
}

function goToday() {
  state.anchor = startOfDay(new Date());
  render();
}

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]');
  if (action) {
    if (action.dataset.action === 'prev') step(-1);
    else if (action.dataset.action === 'next') step(1);
    else if (action.dataset.action === 'today') goToday();
    return;
  }

  const viewButton = event.target.closest('.view-switch [data-view]');
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }

  // 月视图逾期回顾区的状态切换（与清单 / 周图同一契约）。模块 root 内的切换
  // 由模块自己处理；模块会在冒泡到达 document 前同步重绘、 detach 事件目标，
  // 因此这里只认主干渲染的月视图回顾横幅，避免重复切换。
  const toggle = event.target.closest('[data-task-toggle]');
  if (toggle) {
    if (toggle.closest('[data-month-review]')) {
      inbox.cycleTaskStatus(toggle.dataset.taskToggle);
    }
    return;
  }

  const dayTarget = event.target.closest('[data-open-date]');
  if (dayTarget) {
    const date = parseDateKey(dayTarget.dataset.openDate);
    if (date) {
      state.anchor = date;
      state.view = 'day';
      render();
    }
  }
});

document.addEventListener('keydown', (event) => {
  // While the 蓄水池 panel is open the keyboard belongs to it (tabs, form,
  // Escape); calendar navigation stays paused.
  if (poolRoot && !poolRoot.hidden) return;
  if (event.target instanceof HTMLElement && event.target.matches('input, textarea, [contenteditable="true"]')) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'ArrowLeft') step(-1);
  else if (event.key === 'ArrowRight') step(1);
  else if (event.key.toLowerCase() === 't') goToday();
  else if (event.key.toLowerCase() === 'm') setView('month');
  else if (event.key.toLowerCase() === 'w') setView('week');
  else if (event.key.toLowerCase() === 'd') setView('day');
  else return;

  event.preventDefault();
});

readInitialState();
render();

// 蓄水池（attention-switch）：常驻入口 + 页面级面板根。模块只挂载一次——
// 面板根在 #view-root 之外，视图切换不影响它；可见性由入口按钮与模块冒泡上来的
// attention-switch:close 事件共同控制。模块契约与生命周期见模块 README。
const poolRoot = document.querySelector('[data-module-root="attention-switch"]');
const poolToggle = document.querySelector('[data-pool-toggle]');

if (poolRoot && poolToggle) {
  mountAttentionSwitch({
    root: poolRoot,
    state: { view: state.view, anchor: new Date(state.anchor) },
    data: { pool: pool.listItems() },
    services: { pool, inbox },
  });

  function setPoolOpen(open) {
    poolRoot.hidden = !open;
    poolToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      poolRoot.dispatchEvent(new CustomEvent('attention-switch:opened'));
    } else {
      poolToggle.focus();
    }
  }

  poolToggle.addEventListener('click', () => setPoolOpen(poolRoot.hidden));
  poolRoot.addEventListener('attention-switch:close', () => setPoolOpen(false));
}
