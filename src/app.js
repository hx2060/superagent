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
  sampleTasks,
} from './data.js';
import { taskMonthAnchors } from './tasks.js';
import { createDailyTaskStore, mount as mountDailyTasks } from './modules/daily-tasks/index.js';
import { createInboxStore, mount as mountInbox } from './modules/inbox/index.js';
import { mount as mountWeekChart } from './modules/week-chart/index.js';

const VIEWS = new Set(['month', 'week', 'day']);
const today = startOfDay(new Date());
const TASK_STATUS_COLORS = { todo: 'blue', partial: 'orange', done: 'teal' };

const state = {
  view: 'month',
  anchor: today,
};

// Concrete schedules live in the git-ignored local/schedule.json; the committed
// arrays in src/data.js stay blank. A missing/broken local file starts blank.
const localData = await loadLocalData();
const seed = pickSeedData(localData, {
  events: sampleEvents,
  notes: sampleNotes,
  tasks: sampleTasks,
  dailyTasks: sampleDailyTasks,
});
const events = seed.events;

const inbox = createInboxStore({ tasks: seed.tasks, notes: seed.notes });
const dailyTasks = createDailyTaskStore(seed.dailyTasks);
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

window.schedule = Object.freeze({
  version: '0.5',
  tasks: tasksApi,
  dailyTasks: dailyTasksApi,
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
 */
function monthItems() {
  const map = new Map();
  const add = (key, sort, html) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ sort, html });
  };

  for (const event of events) {
    add(event.date, timeToMinutes(event.start), eventChip(event));
  }
  const todayKey = toDateKey(today);
  for (const task of inbox.listTasks()) {
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

function renderMonth() {
  const monthDays = buildMonthMatrix(state.anchor);
  const month = state.anchor.getMonth();
  const itemsByDate = monthItems();

  const weekdayRow = WEEKDAY_LABELS.map(
    (label) => `<div class="month-weekday">周${label}</div>`
  ).join('');

  const cells = monthDays
    .map((date) => {
      const key = toDateKey(date);
      const items = itemsByDate.get(key) ?? [];
      const inMonth = date.getMonth() === month;
      const classes = ['month-cell'];
      if (!inMonth) classes.push('is-outside');
      if (isSameDay(date, today)) classes.push('is-today');

      const visibleChips = items.slice(0, 2).map((item) => item.html).join('');
      const hiddenCount = items.length - 2;
      const more = hiddenCount > 0 ? `<span class="month-more">+${hiddenCount} 项</span>` : '';
      const countLabel = items.length === 0 ? '无安排' : `${items.length} 项安排`;

      return `<button
        type="button"
        class="${classes.join(' ')}"
        data-open-date="${key}"
        aria-label="${date.getMonth() + 1}月${date.getDate()}日，${countLabel}，打开日视图"
        ${isSameDay(date, today) ? 'aria-current="date"' : ''}
      >
        <span class="date-line"><span class="date-num">${date.getDate()}</span></span>
        <span class="chips">${visibleChips}${more}</span>
      </button>`;
    })
    .join('');

  return `<div class="month-view">
    <div class="month-weekdays">${weekdayRow}</div>
    <div class="month-grid">${cells}</div>
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
    isSameDay(state.anchor, today) && nowMinutes >= startMinutes && nowMinutes <= endMinutes
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
