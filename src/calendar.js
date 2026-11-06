/**
 * Pure date / calendar helpers shared by the month, week and day views.
 * Everything here is side-effect free so it can be unit tested with node:test.
 */

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
export const WEEKDAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** Hours rendered by the week time grid. */
export const WEEK_GRID_START_HOUR = 7;
export const WEEK_GRID_END_HOUR = 21;
export const WEEK_GRID_HOUR_HEIGHT = 44;

const pad2 = (value) => String(value).padStart(2, '0');

/** Normalise a Date to local midnight. */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local YYYY-MM-DD key, safe against timezone shifts. */
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parse a YYYY-MM-DD key. Returns null for malformed or impossible dates. */
export function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function addDays(date, amount) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function addMonths(date, amount) {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  target.setDate(Math.min(date.getDate(), daysInMonth(target.getFullYear(), target.getMonth())));
  return target;
}

/** Monday-based start of week. */
export function startOfWeek(date) {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function getWeekDays(anchor) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** 6 × 7 matrix of dates covering the month of `anchor`, starting on Monday. */
export function buildMonthMatrix(anchor) {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatMonthTitle(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatWeekTitle(anchor) {
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getDate()}日`;
}

export function formatDayTitle(date) {
  const weekday = WEEKDAY_FULL[(date.getDay() + 6) % 7];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
}

export function formatTimeRange(start, end) {
  return `${start} – ${end}`;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

/** "09:30" -> 570. Returns NaN for malformed input. */
export function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.NaN;
  return hours * 60 + minutes;
}

/** Group a flat event list by day key, each day sorted by start time. */
export function groupEventsByDate(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }
  return grouped;
}

export function eventsForDay(events, date) {
  return groupEventsByDate(events).get(toDateKey(date)) ?? [];
}

/**
 * Assign overlapping timed events to columns so they can be rendered side by
 * side. Returns a Map of event id -> { column, columns }.
 */
export function layoutOverlaps(events) {
  const result = new Map();
  const sorted = [...events].sort(
    (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start) || timeToMinutes(a.end) - timeToMinutes(b.end)
  );

  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds = [];
    const columnByEvent = new Map();
    for (const event of cluster) {
      const start = timeToMinutes(event.start);
      const end = timeToMinutes(event.end);
      let column = 0;
      while (column < columnEnds.length && columnEnds[column] > start) column += 1;
      if (column === columnEnds.length) columnEnds.push(end);
      else columnEnds[column] = end;
      columnByEvent.set(event.id, column);
    }
    for (const event of cluster) {
      result.set(event.id, { column: columnByEvent.get(event.id), columns: columnEnds.length });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const event of sorted) {
    const start = timeToMinutes(event.start);
    const end = timeToMinutes(event.end);
    if (start >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return result;
}

/**
 * Vertical geometry for a timed event inside the week grid.
 * Returns null when the event falls completely outside the rendered hours.
 */
export function weekEventStyle(event, options = {}) {
  const {
    startHour = WEEK_GRID_START_HOUR,
    endHour = WEEK_GRID_END_HOUR,
    hourHeight = WEEK_GRID_HOUR_HEIGHT,
    minHeight = 18,
  } = options;

  const start = timeToMinutes(event.start);
  const end = timeToMinutes(event.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const gridStart = startHour * 60;
  const gridEnd = endHour * 60;
  const visibleStart = Math.max(start, gridStart);
  const visibleEnd = Math.min(end, gridEnd);
  if (visibleEnd <= visibleStart) return null;

  return {
    top: ((visibleStart - gridStart) / 60) * hourHeight,
    height: Math.max(((visibleEnd - visibleStart) / 60) * hourHeight, minHeight),
  };
}
