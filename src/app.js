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
  formatMonthTitle,
  formatTimeRange,
  formatWeekTitle,
  getWeekDays,
  groupEventsByDate,
  isSameDay,
  layoutOverlaps,
  parseDateKey,
  startOfDay,
  toDateKey,
  weekEventStyle,
} from './calendar.js';
import { sampleEvents } from './data.js';

const VIEWS = new Set(['month', 'week', 'day']);
const WEEK_GRID_HEIGHT = (WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_HEIGHT;
const today = startOfDay(new Date());

const state = {
  view: 'month',
  anchor: today,
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

function renderDay() {
  const dayEvents = eventsForDay(sampleEvents, state.anchor);
  const weekday = `周${WEEKDAY_LABELS[(state.anchor.getDay() + 6) % 7]}`;
  const count = dayEvents.length === 0 ? '当日暂无日程' : `当日共 ${dayEvents.length} 项日程`;

  return `<div class="day-view">
    <div class="day-card">
      <span class="day-eyebrow">日视图 · 占位</span>
      <h2 class="day-date">${state.anchor.getMonth() + 1}月${state.anchor.getDate()}日<span class="day-weekday">${weekday}</span></h2>
      <p class="day-meta">${count}</p>
      <div class="day-placeholder">
        <span class="day-placeholder-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <rect x="3" y="4.5" width="18" height="16" rx="3"></rect>
            <path d="M3 9h18M8 2.5v4M16 2.5v4"></path>
            <path d="M7.5 13h4M7.5 16.5h7"></path>
          </svg>
        </span>
        <p class="day-placeholder-title">时间划分将在后续版本补充</p>
        <p class="day-placeholder-copy">本版本先提供日视图占位，暂不绘制时间轴与日程编辑。</p>
      </div>
    </div>
  </div>`;
}

function render() {
  periodTitle.textContent = periodLabel();

  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }

  if (state.view === 'month') root.innerHTML = renderMonth();
  else if (state.view === 'week') root.innerHTML = renderWeek();
  else root.innerHTML = renderDay();
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
