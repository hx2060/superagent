/**
 * Seed data and local content loading.
 *
 * Mechanism layer (committed): this module defines the shape of the seed data
 * and how to load the optional local content file. It intentionally contains
 * no real tasks, dates or notes.
 *
 * Content layer (not committed): users / bots keep concrete schedules in
 * `local/schedule.json` (git-ignored, see docs/mechanism-handoff.md). When the
 * file is absent or malformed the calendar starts blank; every item can still
 * be created through the UI or `window.schedule`.
 */
export const sampleEvents = [];
export const sampleNotes = [];
export const sampleTasks = [];

/**
 * Daily recurring task definitions. Unlike `sampleTasks` (an undated Inbox),
 * these reappear every day; completion is tracked per local date by the
 * daily-tasks module. Kept empty for a blank start; content is supplied by the
 * local content file or the runtime `window.schedule.dailyTasks` interface.
 */
export const sampleDailyTasks = [];

/** URL of the optional, git-ignored local content file. */
export const LOCAL_DATA_URL = new URL('../local/schedule.json', import.meta.url);

/**
 * Pick the four seed collections from a parsed local content object, falling
 * back to `fallback` per collection. Non-array values are ignored so a broken
 * local file cannot break the app.
 *
 * @param {unknown} local parsed JSON from the local content file
 * @param {{ events?: object[], notes?: object[], tasks?: object[], dailyTasks?: object[] }} [fallback]
 */
export function pickSeedData(local, fallback = {}) {
  const source = local && typeof local === 'object' && !Array.isArray(local) ? local : {};
  const pick = (key) =>
    Array.isArray(source[key]) ? source[key] : Array.isArray(fallback[key]) ? fallback[key] : [];
  return {
    events: pick('events'),
    notes: pick('notes'),
    tasks: pick('tasks'),
    dailyTasks: pick('dailyTasks'),
  };
}

/**
 * Load the optional local content file. Any failure (missing file, network
 * error, invalid JSON) resolves to `null`, which keeps the blank start.
 *
 * @param {URL|string} [url]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object|null>}
 */
export async function loadLocalData(url = LOCAL_DATA_URL, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response?.ok) return null;
    const data = await response.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
