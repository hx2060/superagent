/**
 * Blank starting data.
 *
 * The demo intentionally starts with no sample events, notes, tasks or daily
 * tasks at the demand owner's request, so the calendar opens empty and every
 * item is created through the UI. There is still no persistence: the in-memory
 * inbox store (src/modules/inbox) is seeded from these arrays, and add / edit /
 * delete results live only for the current page session.
 */
export const sampleEvents = [];
export const sampleNotes = [];
export const sampleTasks = [];

/**
 * Daily recurring task definitions. Unlike `sampleTasks` (an undated Inbox),
 * these reappear every day; completion is tracked per local date by the
 * daily-tasks module. Kept empty for a blank start; `dsh` can append entries
 * through the runtime `window.schedule.dailyTasks` interface.
 */
export const sampleDailyTasks = [];
