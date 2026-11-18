/**
 * 本机快照（任务状态持久化层）。
 *
 * 背景：清单 / 便签、每日任务按日状态与蓄水池都只在页面内存里；刷新后回到
 * `local/schedule.json` / `src/data.js` 的初始内容，「标记完成」因此刷新就掉
 * （需求方反馈的问题）。本模块把「界面当前状态」写进浏览器本机存储
 * （localStorage，随原点隔离），刷新后接回种子之上：
 *
 * - 本地内容文件没变：完全恢复上次会话看到的状态（增 / 删 / 改 / 状态都在）；
 * - 本地内容文件变了（机器人或使用者重写）：以文件为准刷新内容，界面里新增的
 *   条目保留，任务 / 每日任务的完成状态按 id 保留；
 * - 任何读取 / 写入失败（隐私模式、配额满、损坏数据）都静默回退到种子，
 *   不影响空白启动与三视图。
 *
 * 边界（与 `docs/mechanism-handoff.md` 一致）：只写浏览器本机存储，不写回
 * `local/schedule.json`，内容也不进入 GitHub；快照与 `local/` 同属本机内容层。
 *
 * 本文件只依赖 `src/calendar.js` 的纯函数，可在 node:test 中直接测试。
 */

import { parseDateKey } from './calendar.js';
import { TASK_STATUS_ORDER } from './tasks.js';

/** 快照格式版本；不匹配时旧快照被忽略（按种子启动）。 */
export const PERSISTENCE_VERSION = 1;

/** localStorage 键名；按原点（协议 + 主机 + 端口）隔离，三个预览入口互不影响。 */
export const STORAGE_KEY = 'schedule.local-state.v1';

const STATUS_SET = new Set(TASK_STATUS_ORDER);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** 稳定指纹：同一份种子得到同一字符串，文件内容变化时指纹随之变化。 */
export function seedFingerprint(seed) {
  const source = isPlainObject(seed) ? seed : {};
  return JSON.stringify([
    Array.isArray(source.events) ? source.events : [],
    Array.isArray(source.notes) ? source.notes : [],
    Array.isArray(source.tasks) ? source.tasks : [],
    Array.isArray(source.dailyTasks) ? source.dailyTasks : [],
    Array.isArray(source.pool) ? source.pool : [],
  ]);
}

/** 解析本机存储；不可用（隐私模式 / 非浏览器）时返回 null，持久化整体关闭。 */
export function resolveStorage(candidate = globalThis.localStorage) {
  if (!candidate || typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function') {
    return null;
  }
  return candidate;
}

function sanitizeTasks(value) {
  const seen = new Set();
  const tasks = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) continue;
    const id = nonEmptyString(candidate.id);
    const title = nonEmptyString(candidate.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const task = { ...candidate, id, title };
    task.status = STATUS_SET.has(candidate.status) ? candidate.status : 'todo';
    delete task.end; // 派生字段，恢复时由 store 重新计算
    tasks.push(task);
  }
  return tasks;
}

function sanitizeNotes(value) {
  const seen = new Set();
  const notes = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) continue;
    const id = nonEmptyString(candidate.id);
    const text = nonEmptyString(candidate.text);
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    notes.push({ ...candidate, id, text });
  }
  return notes;
}

function sanitizeDailyTasks(value) {
  const seen = new Set();
  const tasks = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) continue;
    const id = nonEmptyString(candidate.id);
    const title = nonEmptyString(candidate.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    tasks.push({ ...candidate, id, title });
  }
  return tasks;
}

function sanitizePool(value) {
  const seen = new Set();
  const items = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) continue;
    const id = nonEmptyString(candidate.id);
    const title = nonEmptyString(candidate.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    items.push({ ...candidate, id, title });
  }
  return items;
}

/** 只保留「已知任务 + 合法日期 + 已知状态」的按日状态；缺省 todo 不记录。 */
function sanitizeDailyStatuses(value) {
  const result = {};
  if (!isPlainObject(value)) return result;
  for (const [dateKey, byTask] of Object.entries(value)) {
    if (!parseDateKey(dateKey) || !isPlainObject(byTask)) continue;
    for (const [taskId, status] of Object.entries(byTask)) {
      if (!nonEmptyString(taskId) || !STATUS_SET.has(status) || status === 'todo') continue;
      if (!result[dateKey]) result[dateKey] = {};
      result[dateKey][taskId] = status;
    }
  }
  return result;
}

/**
 * 校验并清洗读到的快照；任何不完整 / 版本不符 / 结构损坏都返回 null
 * （调用方按种子启动，行为与没有快照一致）。
 *
 * @param {unknown} raw
 * @returns {object|null}
 */
export function sanitizeSnapshot(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== PERSISTENCE_VERSION) return null;
  for (const key of ['tasks', 'notes', 'dailyTasks', 'pool']) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return null;
  }
  if (raw.dailyStatuses !== undefined && !isPlainObject(raw.dailyStatuses)) return null;
  return {
    version: PERSISTENCE_VERSION,
    seedKey: typeof raw.seedKey === 'string' ? raw.seedKey : '',
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    tasks: sanitizeTasks(raw.tasks ?? []),
    notes: sanitizeNotes(raw.notes ?? []),
    dailyTasks: sanitizeDailyTasks(raw.dailyTasks ?? []),
    dailyStatuses: sanitizeDailyStatuses(raw.dailyStatuses),
    pool: sanitizePool(raw.pool ?? []),
  };
}

/**
 * 从本机存储读快照。缺失 / 不可用 / 损坏都返回 null，绝不抛出。
 *
 * @param {Storage|null} storage
 * @returns {object|null}
 */
export function readSnapshot(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 写快照；配额满 / 存储不可用时返回 false，绝不抛出。
 *
 * @param {Storage|null} storage
 * @param {object} snapshot
 * @returns {boolean}
 */
export function writeSnapshot(storage, snapshot) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成当前状态的快照。`seed` 用于记录种子指纹，供下次启动判断本地内容文件
 * 是否变过；`savedAt` 可注入（测试用）。
 */
export function createSnapshot({
  seed,
  tasks = [],
  notes = [],
  dailyTasks = [],
  dailyStatuses = {},
  pool = [],
  savedAt = new Date().toISOString(),
}) {
  return {
    version: PERSISTENCE_VERSION,
    seedKey: seedFingerprint(seed),
    savedAt,
    tasks: sanitizeTasks(tasks),
    notes: sanitizeNotes(notes),
    dailyTasks: sanitizeDailyTasks(dailyTasks),
    dailyStatuses: sanitizeDailyStatuses(dailyStatuses),
    pool: sanitizePool(pool),
  };
}

/** 按 id 建索引（保留顺序，后者不覆盖前者）。 */
function indexById(items) {
  const map = new Map();
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
}

/**
 * 把快照接回种子之上，返回创建 store 用的初始状态。
 *
 * - 没有快照：按种子启动（当前主线行为）。
 * - 种子指纹一致（文件没变）：完全恢复快照。
 * - 种子指纹不一致（文件变了）：内容以文件为准，界面新增条目追加保留，
 *   任务 / 每日任务的完成状态按 id 保留（任务不存在了则丢弃）。
 *
 * @param {object} seed pickSeedData 的输出
 * @param {object|null} snapshot readSnapshot 的输出
 */
export function restoreState(seed, snapshot) {
  const base = {
    tasks: Array.isArray(seed?.tasks) ? seed.tasks : [],
    notes: Array.isArray(seed?.notes) ? seed.notes : [],
    dailyTasks: Array.isArray(seed?.dailyTasks) ? seed.dailyTasks : [],
    pool: Array.isArray(seed?.pool) ? seed.pool : [],
  };
  if (!snapshot) {
    return { ...base, dailyStatuses: {} };
  }
  if (snapshot.seedKey === seedFingerprint(seed)) {
    return {
      tasks: snapshot.tasks,
      notes: snapshot.notes,
      dailyTasks: snapshot.dailyTasks,
      dailyStatuses: snapshot.dailyStatuses,
      pool: snapshot.pool,
    };
  }

  // 文件变了：内容以文件为准，状态按 id 保留，界面新增条目追加。
  // 便签 / 蓄水池没有独立的状态字段，同样按「文件内容 + 界面新增」处理。
  const taskIndex = indexById(snapshot.tasks);
  const tasks = base.tasks.map((task) => {
    const remembered = taskIndex.get(task.id);
    return remembered ? { ...task, status: remembered.status } : task;
  });
  for (const task of snapshot.tasks) {
    if (!tasks.some((item) => item.id === task.id)) tasks.push(task);
  }

  const notes = [...base.notes];
  for (const note of snapshot.notes) {
    if (!notes.some((item) => item.id === note.id)) notes.push(note);
  }

  const dailyTasks = [...base.dailyTasks];
  for (const task of snapshot.dailyTasks) {
    if (!dailyTasks.some((item) => item.id === task.id)) dailyTasks.push(task);
  }

  const pool = [...base.pool];
  for (const item of snapshot.pool) {
    if (!pool.some((entry) => entry.id === item.id)) pool.push(item);
  }

  const knownIds = new Set(dailyTasks.map((task) => task.id));
  const dailyStatuses = {};
  for (const [dateKey, byTask] of Object.entries(snapshot.dailyStatuses)) {
    for (const [taskId, status] of Object.entries(byTask)) {
      if (!knownIds.has(taskId)) continue;
      if (!dailyStatuses[dateKey]) dailyStatuses[dateKey] = {};
      dailyStatuses[dateKey][taskId] = status;
    }
  }

  return { tasks, notes, dailyTasks, dailyStatuses, pool };
}
