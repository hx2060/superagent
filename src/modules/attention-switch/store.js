/**
 * Attention-switch "pool" (蓄水池): an option reservoir of everything the user
 * owns — courses, papers, web reads, work tasks, chores — tagged with the
 * learning states it can serve. When stuck or blank, the user picks a state and
 * the pool hands over a few options, so attention has somewhere to go without
 * the burden of deciding what to switch to.
 *
 * Second iteration (方案 B, 2026-11-15 需求方选定): per-item progress
 * (`todo / partial / done`, same three states as tasks) plus device-local
 * usage/progress records that feed the panel's feedback view. Both layers stay
 * on the device (injected storage adapter or `local/schedule.json` seed) and
 * never reach the repository.
 *
 * The store is pure (no DOM) so the host app, the module UI and unit tests all
 * use the same logic. Content itself lives in the git-ignored
 * `local/schedule.json` (`pool` key); this file is the mechanism layer only.
 */

import { addDays, parseDateKey, toDateKey } from '../../calendar.js';

export const POOL_SOURCES = ['course', 'paper', 'web', 'work', 'chore'];
export const POOL_TIERS = ['leisure', 'browse', 'deep'];
export const POOL_SOURCE_LABELS = { course: '网课', paper: '论文', web: '网页', work: '工作', chore: '杂事' };
export const POOL_TIER_LABELS = { leisure: '娱乐性学习', browse: '简单看过', deep: '理解学习' };
export const POOL_TITLE_MAX_LENGTH = 80;
export const POOL_NOTE_MAX_LENGTH = 200;
export const POOL_DEFAULT_OPTION_COUNT = 5;

/** 条目进度：与任务同一套三态枚举（AGENTS.md 第 3 节），省略 = 不跟踪。 */
export const POOL_PROGRESS_STATES = ['todo', 'partial', 'done'];
export const POOL_PROGRESS_LABELS = { todo: '待完成', partial: '部分完成', done: '完成' };
/** 进度循环（含「不跟踪」）：未跟踪 → 待完成 → 部分完成 → 完成 → 未跟踪。 */
export function nextPoolProgress(current) {
  if (current === undefined || current === null) return 'todo';
  if (current === 'todo') return 'partial';
  if (current === 'partial') return 'done';
  return undefined;
}

export const POOL_RECORD_KINDS = ['open', 'expand', 'progress'];
export const POOL_RECORD_LIMIT = 500;
export const POOL_RECORDS_STORAGE_KEY = 'schedule.pool.records.v1';
export const POOL_PROGRESS_STORAGE_KEY = 'schedule.pool.progress.v1';

let generatedIdCount = 0;

function defaultCreateId() {
  generatedIdCount += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `pool-${uuid}`;
  return `pool-${Date.now().toString(36)}-${generatedIdCount.toString(36)}`;
}

function poolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function todayKey(now) {
  const date = now instanceof Date ? now : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timestampKey(now) {
  const date = now instanceof Date ? now : new Date();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${todayKey(date)} ${hours}:${minutes}`;
}

/** 近 7 日窗口的起始日（含今天）：`now` 往前 6 天。 */
function weekStartKey(now) {
  return toDateKey(addDays(now instanceof Date ? now : new Date(), -6));
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/** 取用 / 进度记录的宽松校验：用于读取外部存储时的容错。 */
function isPlainRecord(entry) {
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof entry.at === 'string' &&
    POOL_RECORD_KINDS.includes(entry.kind) &&
    typeof entry.itemId === 'string' &&
    POOL_SOURCES.includes(entry.source)
  );
}

/**
 * 反馈统计纯函数（无 DOM、不读存储）：条目分布、近 7 日取用、沉睡条目、
 * 进度停滞、完成率。空输入也有完整定义，不抛错。
 *
 * @param {Array<object>} items 池条目（快照）
 * @param {Array<object>} records 取用 / 进度记录（快照）
 * @param {Date} [now]
 */
export function poolStats(items, records, now = new Date()) {
  const list = Array.isArray(items) ? items : [];
  const log = Array.isArray(records) ? records.filter(isPlainRecord) : [];
  const today = todayKey(now);
  const weekAgo = weekStartKey(now);

  const byTier = {};
  const bySource = {};
  const byProgress = { todo: 0, partial: 0, done: 0 };
  let untracked = 0;
  for (const item of list) {
    for (const tier of Array.isArray(item.tiers) ? item.tiers : []) {
      byTier[tier] = (byTier[tier] ?? 0) + 1;
    }
    if (POOL_SOURCES.includes(item.source)) {
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;
    }
    if (POOL_PROGRESS_STATES.includes(item.progress)) {
      byProgress[item.progress] += 1;
    } else {
      untracked += 1;
    }
  }

  const everUsed = new Set();
  const usedInWeek = new Set();
  const used7dByTier = {};
  const lastUsedAt = new Map();
  let used7d = 0;
  for (const record of log) {
    everUsed.add(record.itemId);
    const day = record.at.slice(0, 10);
    if (record.kind !== 'progress') {
      const previous = lastUsedAt.get(record.itemId);
      if (!previous || day > previous) lastUsedAt.set(record.itemId, day);
    }
    if (record.kind !== 'progress' && day >= weekAgo && day <= today) {
      // 「取用」只数打开 / 展开；进度变更单独看，不计入使用频次。
      used7d += 1;
      usedInWeek.add(record.itemId);
      if (POOL_TIERS.includes(record.tier)) {
        used7dByTier[record.tier] = (used7dByTier[record.tier] ?? 0) + 1;
      }
    }
  }

  const dormant = list.filter((item) => !everUsed.has(item.id));
  const stalePartial = list.filter((item) => {
    if (item.progress !== 'partial') return false;
    const last = lastUsedAt.get(item.id);
    return !last || last < weekAgo;
  });
  const tracked = byProgress.todo + byProgress.partial + byProgress.done;

  return {
    total: list.length,
    byTier,
    bySource,
    byProgress,
    untracked,
    used7d,
    used7dByTier,
    used7dItems: usedInWeek.size,
    dormant,
    stalePartial,
    doneRatio: tracked ? byProgress.done / tracked : 0,
  };
}

/**
 * 设备本地存储适配器（最小 get/set 接口）。宿主传 localStorage 包装，测试传
 * 内存实现；缺失或抛错时（隐私模式 / 配额）静默退化为「不持久」。
 *
 * @param {{ getItem: (key: string) => string|null, setItem: (key: string, value: string) => void }|null|undefined} storage
 */
function createStorageAdapter(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return {
    read(key) {
      try {
        const raw = storage.getItem(key);
        if (typeof raw !== 'string' || !raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        /* 隐私模式 / 配额不足：本设备不落盘，会话内仍可用。 */
      }
    },
  };
}

/**
 * Validate and normalise one pool item. Throws an Error with a `code` so the
 * caller (UI, dsh API, tests) can map it to a message; seed loading catches and
 * skips broken entries instead.
 *
 * @param {object} input
 * @param {{ createId?: () => string, now?: () => Date }} [options]
 */
export function normalizePoolItem(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw poolError('POOL_TITLE_INVALID', 'Pool item must be an object.');
  }

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > POOL_TITLE_MAX_LENGTH) {
    throw poolError(
      'POOL_TITLE_INVALID',
      `Pool item title must be 1–${POOL_TITLE_MAX_LENGTH} characters.`
    );
  }

  const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
  if (rawUrl && !URL_PATTERN.test(rawUrl)) {
    throw poolError('POOL_URL_INVALID', 'Pool item url must be an http(s) link.');
  }

  if (!POOL_SOURCES.includes(input.source)) {
    throw poolError('POOL_SOURCE_INVALID', `Unknown pool source: ${input.source}`);
  }

  const rawTiers = Array.isArray(input.tiers) ? input.tiers.filter((tier) => typeof tier === 'string') : [];
  if (rawTiers.length === 0 || rawTiers.some((tier) => !POOL_TIERS.includes(tier))) {
    throw poolError('POOL_TIER_INVALID', 'Pool item needs at least one known tier.');
  }
  const tiers = [...new Set(rawTiers)];

  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > POOL_NOTE_MAX_LENGTH) {
    throw poolError(
      'POOL_NOTE_INVALID',
      `Pool item note must be at most ${POOL_NOTE_MAX_LENGTH} characters.`
    );
  }

  const rawId = typeof input.id === 'string' ? input.id.trim() : '';
  const now = typeof options.now === 'function' ? options.now() : new Date();
  const createdAt =
    typeof input.createdAt === 'string' && parseDateKey(input.createdAt)
      ? input.createdAt
      : todayKey(now);

  const rawProgress =
    input.progress === undefined || input.progress === null ? undefined : input.progress;
  if (rawProgress !== undefined && !POOL_PROGRESS_STATES.includes(rawProgress)) {
    throw poolError('POOL_PROGRESS_INVALID', `Unknown pool progress: ${input.progress}`);
  }
  const rawProgressAt =
    typeof input.progressUpdatedAt === 'string' ? input.progressUpdatedAt.trim() : '';
  if (rawProgressAt && !parseDateKey(rawProgressAt)) {
    throw poolError(
      'POOL_PROGRESS_INVALID',
      'Pool item progressUpdatedAt must be a YYYY-MM-DD date key.'
    );
  }

  return {
    id: rawId || (typeof options.createId === 'function' ? options.createId() : null),
    title,
    url: rawUrl || undefined,
    source: input.source,
    tiers,
    note: note || undefined,
    createdAt,
    progress: rawProgress,
    progressUpdatedAt: rawProgressAt || (rawProgress ? todayKey(now) : undefined),
  };
}

/**
 * @param {Array<object>} [seedItems] pool items from the local content file
 * @param {{ createId?: () => string, now?: () => Date }} [options]
 */
export function createPoolStore(seedItems = [], options = {}) {
  const createId = typeof options.createId === 'function' ? options.createId : defaultCreateId;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const storage = createStorageAdapter(options.storage);
  const items = [];
  const itemsById = new Map();
  const usedThisSession = new Set();
  const listeners = new Set();

  // 取用 / 进度记录：设备本地（注入的 storage），只保留最近 POOL_RECORD_LIMIT 条。
  let records = [];
  const storedRecords = storage?.read(POOL_RECORDS_STORAGE_KEY);
  if (Array.isArray(storedRecords)) {
    records = storedRecords.filter(isPlainRecord).slice(-POOL_RECORD_LIMIT);
  }
  // 进度覆盖层：seed 提供基础条目，进度以本机记录为准（刷新不丢）。
  const progressOverlay =
    (storage?.read(POOL_PROGRESS_STORAGE_KEY) && typeof storage.read(POOL_PROGRESS_STORAGE_KEY) === 'object'
      ? storage.read(POOL_PROGRESS_STORAGE_KEY)
      : {}) || {};

  function appendRecord(entry) {
    const record = {
      at: timestampKey(now()),
      kind: entry.kind,
      itemId: entry.itemId,
      source: entry.source,
      tier: entry.tier,
    };
    if (entry.from !== undefined) record.from = entry.from;
    if (entry.to !== undefined) record.to = entry.to;
    records.push(record);
    if (records.length > POOL_RECORD_LIMIT) {
      records = records.slice(-POOL_RECORD_LIMIT);
    }
    storage?.write(POOL_RECORDS_STORAGE_KEY, records);
    return record;
  }

  function persistProgress() {
    const overlay = {};
    for (const item of items) {
      if (item.progress) {
        overlay[item.id] = { progress: item.progress, progressUpdatedAt: item.progressUpdatedAt };
      }
    }
    storage?.write(POOL_PROGRESS_STORAGE_KEY, overlay);
  }

  function emit(change) {
    for (const listener of [...listeners]) listener(change);
  }

  /** Defensive copy: callers must never hold or mutate store internals. */
  function copyItem(item) {
    return { ...item, tiers: [...item.tiers] };
  }

  function assertKnown(id) {
    if (!itemsById.has(id)) {
      throw poolError('POOL_NOT_FOUND', `Unknown pool item: ${id}`);
    }
  }

  function addItem(input) {
    const normalized = normalizePoolItem(input, { createId, now });
    const id = normalized.id ?? createId();
    if (typeof id !== 'string' || !id.trim()) {
      throw poolError('POOL_TITLE_INVALID', 'Pool item id must be a non-empty string.');
    }
    if (itemsById.has(id)) {
      throw poolError('POOL_DUPLICATE_ID', `Duplicate pool item id: ${id}`);
    }

    const item = {
      id,
      title: normalized.title,
      url: normalized.url,
      source: normalized.source,
      tiers: normalized.tiers,
      note: normalized.note,
      createdAt: normalized.createdAt,
      progress: normalized.progress,
      progressUpdatedAt: normalized.progressUpdatedAt,
    };
    items.push(item);
    itemsById.set(id, item);
    persistProgress();
    emit({ type: 'add', item: copyItem(item) });
    return copyItem(item);
  }

  function updateItem(id, changes) {
    assertKnown(id);
    const current = itemsById.get(id);
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw poolError('POOL_TITLE_INVALID', 'Pool item changes must be an object.');
    }

    const merged = {
      title: changes.title !== undefined ? changes.title : current.title,
      url: changes.url !== undefined ? changes.url : current.url ?? '',
      source: changes.source !== undefined ? changes.source : current.source,
      tiers: changes.tiers !== undefined ? changes.tiers : current.tiers,
      note: changes.note !== undefined ? changes.note : current.note ?? '',
      progress: changes.progress !== undefined ? changes.progress : current.progress,
      progressUpdatedAt:
        changes.progress !== undefined && changes.progress !== current.progress
          ? undefined
          : current.progressUpdatedAt,
      id: current.id,
      createdAt: current.createdAt,
    };
    const normalized = normalizePoolItem(merged, { createId, now });
    const item = {
      id: current.id,
      title: normalized.title,
      url: normalized.url,
      source: normalized.source,
      tiers: normalized.tiers,
      note: normalized.note,
      createdAt: current.createdAt,
      progress: normalized.progress,
      progressUpdatedAt: normalized.progressUpdatedAt,
    };
    items[items.indexOf(current)] = item;
    itemsById.set(id, item);
    emit({ type: 'update', item: copyItem(item) });
    return copyItem(item);
  }

  function deleteItem(id) {
    assertKnown(id);
    const item = itemsById.get(id);
    items.splice(items.indexOf(item), 1);
    itemsById.delete(id);
    usedThisSession.delete(id);
    emit({ type: 'delete', item: copyItem(item) });
    return copyItem(item);
  }

  function listItems() {
    return items.map(copyItem);
  }

  function listByTier(tier) {
    if (!POOL_TIERS.includes(tier)) {
      throw poolError('POOL_TIER_INVALID', `Unknown pool tier: ${tier}`);
    }
    return items.filter((item) => item.tiers.includes(tier)).map(copyItem);
  }

  /**
   * A handful of options for one state: items never used this session come
   * first (newest added first), then the ones already used. The ordering is
   * provisional on purpose — the requester asked to keep room for tuning it
   * against real use.
   */
  function optionsFor(tier, count = POOL_DEFAULT_OPTION_COUNT) {
    const limit = Number.isInteger(count) && count > 0 ? count : POOL_DEFAULT_OPTION_COUNT;
    const matching = listByTier(tier);
    const ordered = matching
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const usedA = usedThisSession.has(a.item.id) ? 1 : 0;
        const usedB = usedThisSession.has(b.item.id) ? 1 : 0;
        if (usedA !== usedB) return usedA - usedB;
        return b.index - a.index;
      });
    return ordered.slice(0, limit).map((entry) => copyItem(entry.item));
  }

  /**
   * Session-only "already used" marker that feeds optionsFor ordering, plus a
   * device-local usage record (`kind` = open | expand) for the feedback view.
   * `tier` is the state the item was used under; defaults to its first tier.
   */
  function markUsed(id, options2 = {}) {
    assertKnown(id);
    usedThisSession.add(id);
    const item = itemsById.get(id);
    const kind = POOL_RECORD_KINDS.includes(options2.kind) ? options2.kind : 'open';
    const tier = POOL_TIERS.includes(options2.tier) ? options2.tier : item.tiers[0];
    appendRecord({ kind, itemId: id, source: item.source, tier });
    emit({ type: 'use', id });
  }

  /**
   * 设置 / 清除条目进度（三态循环的落点）：写进度覆盖层、记一条 progress
   * 记录（from → to），并通知订阅者。`progress` 为 undefined 表示不再跟踪。
   */
  function setItemProgress(id, progress) {
    assertKnown(id);
    const next = progress === undefined || progress === null ? undefined : progress;
    if (next !== undefined && !POOL_PROGRESS_STATES.includes(next)) {
      throw poolError('POOL_PROGRESS_INVALID', `Unknown pool progress: ${progress}`);
    }
    const current = itemsById.get(id);
    const item = {
      ...current,
      progress: next,
      progressUpdatedAt: next ? todayKey(now()) : undefined,
    };
    items[items.indexOf(current)] = item;
    itemsById.set(id, item);
    persistProgress();
    appendRecord({
      kind: 'progress',
      itemId: id,
      source: item.source,
      tier: item.tiers[0],
      from: current.progress ?? null,
      to: next ?? null,
    });
    emit({ type: 'progress', item: copyItem(item) });
    return copyItem(item);
  }

  /** 取用 / 进度记录副本（最近 POOL_RECORD_LIMIT 条，旧 → 新）。 */
  function useRecords() {
    return records.map((record) => ({ ...record }));
  }

  /** 单条目的进度变更历史（旧 → 新）。 */
  function progressLog(id) {
    assertKnown(id);
    return records
      .filter((record) => record.itemId === id && record.kind === 'progress')
      .map((record) => ({ ...record }));
  }

  /** 反馈统计（poolStats 的 store 入口）。 */
  function stats(when) {
    return poolStats(listItems(), records, when instanceof Date ? when : now());
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Pool listener must be a function.');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  for (const candidate of Array.isArray(seedItems) ? seedItems : []) {
    try {
      const normalized = normalizePoolItem(candidate, { createId, now });
      const id = normalized.id ?? createId();
      if (typeof id !== 'string' || !id.trim() || itemsById.has(id)) continue;
      const override = progressOverlay[id];
      const hasOverride =
        override && typeof override === 'object' && POOL_PROGRESS_STATES.includes(override.progress);
      items.push({
        id,
        title: normalized.title,
        url: normalized.url,
        source: normalized.source,
        tiers: normalized.tiers,
        note: normalized.note,
        createdAt: normalized.createdAt,
        progress: hasOverride ? override.progress : normalized.progress,
        progressUpdatedAt: hasOverride
          ? override.progressUpdatedAt ?? normalized.progressUpdatedAt
          : normalized.progressUpdatedAt,
      });
      itemsById.set(id, items[items.length - 1]);
    } catch {
      // A broken local entry must not break the blank start; skip it.
    }
  }

  return {
    addItem,
    updateItem,
    deleteItem,
    listItems,
    listByTier,
    optionsFor,
    markUsed,
    setItemProgress,
    useRecords,
    progressLog,
    stats,
    subscribe,
  };
}
