import {
  WEEKDAY_LABELS,
  WEEK_GRID_END_HOUR,
  WEEK_GRID_HOUR_HEIGHT,
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
  weekEventStyle,
} from './calendar.js';
import { sampleEvents, sampleNotes, sampleTasks } from './data.js';
import { createInboxStore, mount as mountInbox } from './modules/inbox/index.js';

const VIEWS = new Set(['month', 'week', 'day']);
const WEEK_GRID_HEIGHT = (WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_HEIGHT;
const today = startOfDay(new Date());

const state = {
  view: 'month',
  anchor: today,
};

const inbox = createInboxStore({ tasks: sampleTasks, notes: sampleNotes });
let inboxView = null;

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

function periodLabel() {
  if (state.view === 'month') return formatMonthTitle(state.anchor);
  if (state.view === 'week') return formatWeekTitle(state.anchor);
  return formatDayTitle(state.anchor);
}

function eventChip(event) {
  return `<span class="chip chip--${event.color}"><span class="chip-title">${escapeHtml(event.title)}</span></span>`;
}

function renderMonth() {
  const monthDays = buildMonthMatrix(state.anchor);
  const month = state.anchor.getMonth();
  const grouped = groupEventsByDate(sampleEvents);

  const weekdayRow = WEEKDAY_LABELS.map(
    (label) => `<div class="month-weekday">周${label}</div>`
  ).join('');

  const cells = monthDays
    .map((date) => {
      const key = toDateKey(date);
      const dayEvents = grouped.get(key) ?? [];
      const inMonth = date.getMonth() === month;
      const classes = ['month-cell'];
      if (!inMonth) classes.push('is-outside');
      if (isSameDay(date, today)) classes.push('is-today');

      const visibleChips = dayEvents.slice(0, 2).map(eventChip).join('');
      const hiddenCount = dayEvents.length - 2;
      const more = hiddenCount > 0 ? `<span class="month-more">+${hiddenCount} 项</span>` : '';
      const countLabel = dayEvents.length === 0 ? '无日程' : `${dayEvents.length} 项日程`;

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

function renderWeekEvent(event, layout, geometry) {
  const compact = geometry.height < 42;
  const left = (layout.column / layout.columns) * 100;
  const width = 100 / layout.columns;
  return `<div
    class="week-event event--${event.color}${compact ? ' is-compact' : ''}"
    style="top:${geometry.top + 1}px;height:${Math.max(geometry.height - 2, 16)}px;left:calc(${left}% + 3px);width:calc(${width}% - 6px)"
    title="${escapeHtml(event.title)} · ${formatTimeRange(event.start, event.end)}"
  >
    <span class="week-event-title">${escapeHtml(event.title)}</span>
    <span class="week-event-time">${formatTimeRange(event.start, event.end)}</span>
  </div>`;
}

function renderWeek() {
  const days = getWeekDays(state.anchor);
  const grouped = groupEventsByDate(sampleEvents);

  const header = days
    .map((date) => {
      const isToday = isSameDay(date, today);
      return `<button
        type="button"
        class="week-day${isToday ? ' is-today' : ''}"
        data-open-date="${toDateKey(date)}"
        aria-label="查看${date.getMonth() + 1}月${date.getDate()}日（周${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}）的日视图"
        ${isToday ? 'aria-current="date"' : ''}
      >
        <span class="week-day-name">周${WEEKDAY_LABELS[(date.getDay() + 6) % 7]}</span>
        <span class="week-day-num">${date.getDate()}</span>
      </button>`;
    })
    .join('');

  const axisLabels = Array.from(
    { length: WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR },
    (_, index) => {
      const hour = WEEK_GRID_START_HOUR + index;
      return `<span class="axis-label" style="top:${index * WEEK_GRID_HOUR_HEIGHT}px">${String(hour).padStart(2, '0')}:00</span>`;
    }
  ).join('');

  const columns = days
    .map((date) => {
      const dayEvents = grouped.get(toDateKey(date)) ?? [];
      const layouts = layoutOverlaps(dayEvents);
      const blocks = dayEvents
        .map((event) => {
          const geometry = weekEventStyle(event);
          if (!geometry) return '';
          return renderWeekEvent(event, layouts.get(event.id) ?? { column: 0, columns: 1 }, geometry);
        })
        .join('');
      return `<div class="week-column${isSameDay(date, today) ? ' is-today' : ''}" data-day="${toDateKey(date)}">${blocks}</div>`;
    })
    .join('');

  const now = new Date();
  const todayInWeek = days.some((date) => isSameDay(date, today));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const gridStart = WEEK_GRID_START_HOUR * 60;
  const gridEnd = WEEK_GRID_END_HOUR * 60;
  const nowLine =
    todayInWeek && nowMinutes >= gridStart && nowMinutes <= gridEnd
      ? `<div class="week-now" style="top:${((nowMinutes - gridStart) / 60) * WEEK_GRID_HOUR_HEIGHT}px" aria-hidden="true"><span class="week-now-dot"></span></div>`
      : '';

  return `<div class="week-view">
    <div class="week-head">
      <div class="week-head-axis" aria-hidden="true"></div>
      ${header}
    </div>
    <div class="week-scroll">
      <div class="week-body" style="height:${WEEK_GRID_HEIGHT}px;--hour-height:${WEEK_GRID_HOUR_HEIGHT}px">
        <div class="week-axis" aria-hidden="true">${axisLabels}</div>
        <div class="week-columns">${columns}</div>
        ${nowLine}
      </div>
    </div>
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
  const grouped = groupEventsByDate(sampleEvents);

  const weekRange = formatWeekTitle(state.anchor).replace(/^\d{4}年/, '');

  return `<div class="day-weekstrip" role="group" aria-label="本周日期">
    <span class="day-strip-caption">本周</span>
    <span class="day-strip-range">${weekRange}</span>
    ${days
      .map((date) => {
        const key = toDateKey(date);
        const events = grouped.get(key) ?? [];
        const selected = isSameDay(date, state.anchor);
        const isToday = isSameDay(date, today);
        const dots = events
          .slice(0, 4)
          .map((event) => `<span class="day-strip-dot" style="background:${EVENT_DOT_COLORS[event.color] ?? '#3370ff'}"></span>`)
          .join('');
        return `<button
          type="button"
          class="day-strip-day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}"
          data-open-date="${key}"
          aria-label="${date.getMonth() + 1}月${date.getDate()}日，${events.length} 项日程，查看当日"
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
      return `<div class="day-event day-pill day-pill--${event.color}" style="top:${top}%;height:${height}%">
          <span class="day-pill-icon">${eventIcon(event.icon)}</span>
        </div>
        <div class="day-event-copy" style="top:${top}%">
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

function renderDay() {
  const dayEvents = eventsForDay(sampleEvents, state.anchor);

  return `<div class="day-view">
    ${renderDayWeekStrip()}
    <div class="day-columns">
      <aside class="day-sidebar" data-module-root="inbox"></aside>
      <section class="day-panel day-timeline-panel">
        <header class="day-panel-head">
          <h2 class="day-panel-title"><span class="day-dot" aria-hidden="true"></span>时间表</h2>
          <span class="day-panel-meta">${dayEvents.length} 项安排</span>
        </header>
        ${renderDayTimeline(dayEvents)}
      </section>
    </div>
  </div>`;
}

function render() {
  if (inboxView) {
    inboxView.destroy();
    inboxView = null;
  }

  periodTitle.textContent = periodLabel();

  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }

  if (state.view === 'month') {
    root.innerHTML = renderMonth();
  } else if (state.view === 'week') {
    root.innerHTML = renderWeek();
  } else {
    root.innerHTML = renderDay();
    inboxView = mountInbox({
      root: root.querySelector('[data-module-root="inbox"]'),
      state: { view: state.view, anchor: new Date(state.anchor) },
      data: {
        events: sampleEvents,
        notes: inbox.listNotes(toDateKey(state.anchor)),
        tasks: inbox.listTasks(),
      },
      services: { inbox },
    });
  }
}

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
