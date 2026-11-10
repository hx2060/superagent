/**
 * Attention-switch "pool" (蓄水池): an option reservoir of everything the user
 * owns — courses, papers, web reads, work tasks, chores — tagged with the
 * learning states it can serve. When stuck or blank, the user picks a state and
 * the pool hands over a few options, so attention has somewhere to go without
 * the burden of deciding what to switch to.
 *
 * The store is pure (no DOM) so the host app, the module UI and unit tests all
 * use the same logic. Content itself lives in the git-ignored
 * `local/schedule.json` (`pool` key); this file is the mechanism layer only.
 */

import { parseDateKey } from '../../calendar.js';

export const POOL_SOURCES = ['course', 'paper', 'web', 'work', 'chore'];
export const POOL_TIERS = ['leisure', 'browse', 'deep'];
export const POOL_SOURCE_LABELS = { course: '网课', paper: '论文', web: '网页', work: '工作', chore: '杂事' };
export const POOL_TIER_LABELS = { leisure: '娱乐性学习', browse: '简单看过', deep: '理解学习' };
export const POOL_TITLE_MAX_LENGTH = 80;
export const POOL_NOTE_MAX_LENGTH = 200;
export const POOL_DEFAULT_OPTION_COUNT = 5;

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

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

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

  return {
    id: rawId || (typeof options.createId === 'function' ? options.createId() : null),
    title,
    url: rawUrl || undefined,
    source: input.source,
    tiers,
    note: note || undefined,
    createdAt,
  };
}

/**
 * @param {Array<object>} [seedItems] pool items from the local content file
 * @param {{ createId?: () => string, now?: () => Date }} [options]
 */
export function createPoolStore(seedItems = [], options = {}) {
  const createId = typeof options.createId === 'function' ? options.createId : defaultCreateId;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const items = [];
  const itemsById = new Map();
  const usedThisSession = new Set();
  const listeners = new Set();

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
    };
    items.push(item);
    itemsById.set(id, item);
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

  /** Session-only "already used" marker that feeds optionsFor ordering. */
  function markUsed(id) {
    assertKnown(id);
    usedThisSession.add(id);
    emit({ type: 'use', id });
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
      items.push({
        id,
        title: normalized.title,
        url: normalized.url,
        source: normalized.source,
        tiers: normalized.tiers,
        note: normalized.note,
        createdAt: normalized.createdAt,
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
    subscribe,
  };
}
