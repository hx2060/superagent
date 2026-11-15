import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POOL_DEFAULT_OPTION_COUNT,
  POOL_NOTE_MAX_LENGTH,
  POOL_RECORD_LIMIT,
  POOL_SOURCES,
  POOL_TIERS,
  POOL_TITLE_MAX_LENGTH,
  createPoolStore,
  nextPoolProgress,
  normalizePoolItem,
  poolStats,
} from '../store.js';

const fixedNow = () => new Date(2026, 10, 9); // 2026-11-09 local

function sampleInput(overrides = {}) {
  return {
    title: '线性代数网课',
    url: 'https://www.bilibili.com/video/BV1xx',
    source: 'course',
    tiers: ['deep'],
    note: '看到第 3 讲',
    ...overrides,
  };
}

test('normalizePoolItem trims fields and defaults createdAt to today', () => {
  const item = normalizePoolItem(sampleInput({ title: '  乐理入门  ' }), { now: fixedNow });
  assert.equal(item.title, '乐理入门');
  assert.equal(item.createdAt, '2026-11-09');
  assert.equal(item.url, 'https://www.bilibili.com/video/BV1xx');
  assert.equal(item.note, '看到第 3 讲');
  assert.deepEqual(item.tiers, ['deep']);
});

test('normalizePoolItem drops empty url/note and keeps an explicit createdAt', () => {
  const item = normalizePoolItem(
    sampleInput({ url: '   ', note: '', createdAt: '2026-11-01' }),
    { now: fixedNow }
  );
  assert.equal(item.url, undefined);
  assert.equal(item.note, undefined);
  assert.equal(item.createdAt, '2026-11-01');
});

test('normalizePoolItem dedupes tiers but rejects unknown or empty tiers', () => {
  assert.deepEqual(normalizePoolItem(sampleInput({ tiers: ['deep', 'deep', 'browse'] })).tiers, [
    'deep',
    'browse',
  ]);
  assert.throws(() => normalizePoolItem(sampleInput({ tiers: [] })), { code: 'POOL_TIER_INVALID' });
  assert.throws(() => normalizePoolItem(sampleInput({ tiers: ['deep', 'nope'] })), {
    code: 'POOL_TIER_INVALID',
  });
  assert.throws(() => normalizePoolItem(sampleInput({ tiers: 'deep' })), { code: 'POOL_TIER_INVALID' });
});

test('normalizePoolItem validates title, url, source and note', () => {
  assert.throws(() => normalizePoolItem(sampleInput({ title: '  ' })), { code: 'POOL_TITLE_INVALID' });
  assert.throws(() => normalizePoolItem(sampleInput({ title: 'x'.repeat(POOL_TITLE_MAX_LENGTH + 1) })), {
    code: 'POOL_TITLE_INVALID',
  });
  assert.throws(() => normalizePoolItem(sampleInput({ url: 'ftp://example.com' })), {
    code: 'POOL_URL_INVALID',
  });
  assert.throws(() => normalizePoolItem(sampleInput({ url: 'https://ex ample.com' })), {
    code: 'POOL_URL_INVALID',
  });
  assert.throws(() => normalizePoolItem(sampleInput({ source: 'podcast' })), {
    code: 'POOL_SOURCE_INVALID',
  });
  assert.throws(() => normalizePoolItem(sampleInput({ note: 'x'.repeat(POOL_NOTE_MAX_LENGTH + 1) })), {
    code: 'POOL_NOTE_INVALID',
  });
});

test('createPoolStore adds, copies and never leaks internals', () => {
  const store = createPoolStore([], { now: fixedNow });
  const added = store.addItem(sampleInput());
  assert.match(added.id, /^pool-/);
  added.title = 'mutated';
  added.tiers.push('leisure');
  assert.equal(store.listItems()[0].title, '线性代数网课');
  assert.deepEqual(store.listItems()[0].tiers, ['deep']);
});

test('createPoolStore rejects duplicate ids and unknown items', () => {
  const store = createPoolStore([sampleInput({ id: 'p1' })], { now: fixedNow });
  assert.throws(() => store.addItem(sampleInput({ id: 'p1' })), { code: 'POOL_DUPLICATE_ID' });
  assert.throws(() => store.updateItem('missing', { title: 'x' }), { code: 'POOL_NOT_FOUND' });
  assert.throws(() => store.deleteItem('missing'), { code: 'POOL_NOT_FOUND' });
  assert.throws(() => store.markUsed('missing'), { code: 'POOL_NOT_FOUND' });
});

test('createPoolStore updates partially and keeps createdAt', () => {
  const store = createPoolStore([sampleInput({ id: 'p1', createdAt: '2026-11-01' })], {
    now: fixedNow,
  });
  const updated = store.updateItem('p1', { tiers: ['browse', 'deep'], url: '' });
  assert.deepEqual(updated.tiers, ['browse', 'deep']);
  assert.equal(updated.url, undefined);
  assert.equal(updated.createdAt, '2026-11-01');
  assert.equal(updated.title, '线性代数网课');
  assert.throws(() => store.updateItem('p1', { title: '' }), { code: 'POOL_TITLE_INVALID' });
});

test('createPoolStore deletes items and clears their session mark', () => {
  const store = createPoolStore([sampleInput({ id: 'p1' }), sampleInput({ id: 'p2', title: '论文' })], {
    now: fixedNow,
  });
  store.markUsed('p1');
  store.deleteItem('p1');
  assert.deepEqual(
    store.listItems().map((item) => item.id),
    ['p2']
  );
  store.addItem(sampleInput({ id: 'p1' }));
  assert.deepEqual(
    store.optionsFor('deep').map((item) => item.id),
    ['p1', 'p2']
  );
});

test('listByTier matches multi-tier items and validates the tier', () => {
  const store = createPoolStore(
    [
      sampleInput({ id: 'p1', tiers: ['deep', 'leisure'] }),
      sampleInput({ id: 'p2', title: '杂事', source: 'chore', tiers: ['browse'] }),
    ],
    { now: fixedNow }
  );
  assert.deepEqual(
    store.listByTier('leisure').map((item) => item.id),
    ['p1']
  );
  assert.deepEqual(
    store.listByTier('browse').map((item) => item.id),
    ['p2']
  );
  assert.throws(() => store.listByTier('nope'), { code: 'POOL_TIER_INVALID' });
});

test('optionsFor prefers unused items, newest first, and honours the count', () => {
  const store = createPoolStore(
    [
      sampleInput({ id: 'p1', title: '第一讲' }),
      sampleInput({ id: 'p2', title: '第二讲' }),
      sampleInput({ id: 'p3', title: '第三讲' }),
      sampleInput({ id: 'p4', title: '第四讲' }),
      sampleInput({ id: 'p5', title: '第五讲' }),
      sampleInput({ id: 'p6', title: '第六讲' }),
    ],
    { now: fixedNow }
  );

  assert.equal(store.optionsFor('deep').length, POOL_DEFAULT_OPTION_COUNT);
  assert.deepEqual(
    store.optionsFor('deep').map((item) => item.id),
    ['p6', 'p5', 'p4', 'p3', 'p2']
  );
  assert.deepEqual(
    store.optionsFor('deep', 2).map((item) => item.id),
    ['p6', 'p5']
  );

  store.markUsed('p6');
  store.markUsed('p5');
  assert.deepEqual(
    store.optionsFor('deep', 3).map((item) => item.id),
    ['p4', 'p3', 'p2']
  );
  assert.deepEqual(
    store.optionsFor('deep', 6).map((item) => item.id),
    ['p4', 'p3', 'p2', 'p1', 'p6', 'p5']
  );
});

test('createPoolStore notifies subscribers and stops after unsubscribe', () => {
  const store = createPoolStore([], { now: fixedNow });
  const events = [];
  const unsubscribe = store.subscribe((change) => events.push(change.type));

  store.addItem(sampleInput({ id: 'p1' }));
  store.markUsed('p1');
  store.updateItem('p1', { note: '复习完' });
  store.deleteItem('p1');
  unsubscribe();
  store.addItem(sampleInput({ id: 'p2' }));

  assert.deepEqual(events, ['add', 'use', 'update', 'delete']);
});

test('createPoolStore skips broken and duplicate seeds and accepts a non-array seed', () => {
  const store = createPoolStore(
    [
      sampleInput({ id: 'p1' }),
      sampleInput({ id: 'p1', title: '重复' }),
      sampleInput({ id: 'p2', title: '' }),
      sampleInput({ id: 'p3', url: 'not-a-link' }),
      null,
      sampleInput({ id: 'p4', title: '好的' }),
    ],
    { now: fixedNow }
  );
  assert.deepEqual(
    store.listItems().map((item) => item.id),
    ['p1', 'p4']
  );
  assert.equal(createPoolStore('nope').listItems().length, 0);
});

test('pool enums cover the agreed sources and tiers', () => {
  assert.deepEqual(POOL_SOURCES, ['course', 'paper', 'web', 'work', 'chore']);
  assert.deepEqual(POOL_TIERS, ['leisure', 'browse', 'deep']);
});

/* ---- 第二迭代（方案 B）：进度 + 记录 + 反馈统计 ----------------------- */

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
  };
}

function dayAt(offset) {
  const base = new Date(2026, 10, 15, 12, 0);
  base.setDate(base.getDate() + offset);
  return base;
}

test('nextPoolProgress cycles through untracked and the three states', () => {
  assert.equal(nextPoolProgress(undefined), 'todo');
  assert.equal(nextPoolProgress('todo'), 'partial');
  assert.equal(nextPoolProgress('partial'), 'done');
  assert.equal(nextPoolProgress('done'), undefined);
});

test('normalizePoolItem validates progress and defaults progressUpdatedAt', () => {
  const item = normalizePoolItem(sampleInput({ progress: 'partial' }), { now: fixedNow });
  assert.equal(item.progress, 'partial');
  assert.equal(item.progressUpdatedAt, '2026-11-09');

  const plain = normalizePoolItem(sampleInput(), { now: fixedNow });
  assert.equal(plain.progress, undefined);
  assert.equal(plain.progressUpdatedAt, undefined);

  assert.throws(() => normalizePoolItem(sampleInput({ progress: 'nope' })), {
    code: 'POOL_PROGRESS_INVALID',
  });
  assert.throws(() => normalizePoolItem(sampleInput({ progress: 'done', progressUpdatedAt: 'x' })), {
    code: 'POOL_PROGRESS_INVALID',
  });
  assert.equal(
    normalizePoolItem(sampleInput({ progress: 'done', progressUpdatedAt: '2026-11-01' })).progressUpdatedAt,
    '2026-11-01'
  );
});

test('setItemProgress cycles, records from/to and persists through storage', () => {
  const storage = memoryStorage();
  const store = createPoolStore([sampleInput({ id: 'p1' })], { storage, now: fixedNow });

  const partial = store.setItemProgress('p1', 'partial');
  assert.equal(partial.progress, 'partial');
  assert.equal(partial.progressUpdatedAt, '2026-11-09');

  const done = store.setItemProgress('p1', 'done');
  assert.equal(done.progress, 'done');

  const cleared = store.setItemProgress('p1', undefined);
  assert.equal(cleared.progress, undefined);
  assert.equal(cleared.progressUpdatedAt, undefined);

  const log = store.progressLog('p1');
  assert.deepEqual(
    log.map((record) => [record.kind, record.from, record.to]),
    [
      ['progress', null, 'partial'],
      ['progress', 'partial', 'done'],
      ['progress', 'done', null],
    ]
  );

  const persisted = JSON.parse(storage.getItem('schedule.pool.progress.v1'));
  assert.deepEqual(persisted, {});
  assert.equal(JSON.parse(storage.getItem('schedule.pool.records.v1')).length, 3);

  assert.throws(() => store.setItemProgress('p1', 'nope'), { code: 'POOL_PROGRESS_INVALID' });
  assert.throws(() => store.setItemProgress('missing', 'todo'), { code: 'POOL_NOT_FOUND' });
});

test('stored progress overlay wins over the seed and survives a reload', () => {
  const storage = memoryStorage({
    'schedule.pool.progress.v1': JSON.stringify({
      p1: { progress: 'done', progressUpdatedAt: '2026-11-10' },
    }),
  });
  const store = createPoolStore([sampleInput({ id: 'p1' })], { storage, now: fixedNow });
  const [item] = store.listItems();
  assert.equal(item.progress, 'done');
  assert.equal(item.progressUpdatedAt, '2026-11-10');

  // 新条目（没有覆盖层）保持不跟踪
  const added = store.addItem(sampleInput({ id: 'p2', title: '另一条' }));
  assert.equal(added.progress, undefined);
  const overlay = JSON.parse(storage.getItem('schedule.pool.progress.v1'));
  assert.deepEqual(overlay, { p1: { progress: 'done', progressUpdatedAt: '2026-11-10' } });
});

test('markUsed records open/expand usage with tier and source', () => {
  const storage = memoryStorage();
  const store = createPoolStore([sampleInput({ id: 'p1', tiers: ['deep', 'browse'] })], {
    storage,
    now: fixedNow,
  });
  store.markUsed('p1', { kind: 'open', tier: 'deep' });
  store.markUsed('p1', { kind: 'expand' }); // tier 缺省取第一条
  const records = store.useRecords();
  assert.deepEqual(
    records.map((record) => [record.kind, record.tier, record.source]),
    [
      ['open', 'deep', 'course'],
      ['expand', 'deep', 'course'],
    ]
  );
});

test('records are capped at the limit and corrupt storage is tolerated', () => {
  const storage = memoryStorage();
  const store = createPoolStore([sampleInput({ id: 'p1' })], { storage, now: fixedNow });
  for (let i = 0; i < POOL_RECORD_LIMIT + 5; i += 1) {
    store.markUsed('p1', { kind: 'open', tier: 'deep' });
  }
  assert.equal(store.useRecords().length, POOL_RECORD_LIMIT);
  assert.equal(JSON.parse(storage.getItem('schedule.pool.records.v1')).length, POOL_RECORD_LIMIT);

  const broken = memoryStorage({ 'schedule.pool.records.v1': 'not-json' });
  const tolerant = createPoolStore([sampleInput({ id: 'p1' })], { storage: broken });
  assert.deepEqual(tolerant.useRecords(), []);

  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const quiet = createPoolStore([sampleInput({ id: 'p1' })], { storage: throwing, now: fixedNow });
  quiet.markUsed('p1', { kind: 'open', tier: 'deep' });
  quiet.setItemProgress('p1', 'todo');
  assert.equal(quiet.useRecords().length, 2);
});

test('poolStats reports distributions, week usage, dormant and stale items', () => {
  const items = [
    { id: 'a', title: 'A', source: 'course', tiers: ['deep'], progress: 'done', createdAt: '2026-11-01' },
    { id: 'b', title: 'B', source: 'work', tiers: ['browse'], progress: 'partial', createdAt: '2026-11-02' },
    { id: 'c', title: 'C', source: 'chore', tiers: ['leisure'], createdAt: '2026-11-03' },
  ];
  const records = [
    { at: '2026-11-14 09:00', kind: 'open', tier: 'deep', itemId: 'a', source: 'course' },
    { at: '2026-11-15 10:00', kind: 'expand', tier: 'browse', itemId: 'b', source: 'work' },
    { at: '2026-11-08 10:00', kind: 'open', tier: 'leisure', itemId: 'c', source: 'chore' }, // 7 天窗外
    { at: '2026-11-15 11:00', kind: 'progress', tier: 'browse', itemId: 'b', source: 'work', from: null, to: 'partial' },
    { broken: true },
  ];
  const stats = poolStats(items, records, dayAt(0));
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.byProgress, { todo: 0, partial: 1, done: 1 });
  assert.equal(stats.untracked, 1);
  assert.equal(stats.used7d, 2);
  assert.equal(stats.used7dItems, 2);
  assert.deepEqual(stats.used7dByTier, { deep: 1, browse: 1 });
  assert.deepEqual(stats.dormant.map((item) => item.id), []);
  assert.deepEqual(stats.stalePartial.map((item) => item.id), []); // b 今天用过
  assert.equal(stats.doneRatio, 1 / 2);
  assert.equal(stats.byTier.deep, 1);
  assert.equal(stats.bySource.work, 1);
});

test('poolStats handles the week boundary, dormant and stale partial items', () => {
  const items = [
    { id: 'a', title: 'A', source: 'course', tiers: ['deep'], progress: 'partial', createdAt: '2026-11-01' },
    { id: 'b', title: 'B', source: 'course', tiers: ['deep'], createdAt: '2026-11-01' },
    { id: 'c', title: 'C', source: 'course', tiers: ['deep'], createdAt: '2026-11-01' },
  ];
  const records = [
    { at: '2026-11-09 08:00', kind: 'open', tier: 'deep', itemId: 'a', source: 'course' }, // 窗内最早一天（today-6）
    { at: '2026-11-08 08:00', kind: 'open', tier: 'deep', itemId: 'b', source: 'course' }, // 窗外（today-7）
  ];
  const stats = poolStats(items, records, dayAt(0));
  assert.equal(stats.used7d, 1); // 只有 11-09 在窗内
  assert.deepEqual(stats.dormant.map((item) => item.id), ['c']);
  assert.deepEqual(stats.stalePartial.map((item) => item.id), []); // a 在窗内用过
  assert.equal(stats.doneRatio, 0);

  const later = poolStats(items, records, dayAt(1)); // 今天 +1：11-09 出窗
  assert.deepEqual(later.stalePartial.map((item) => item.id), ['a']);
  assert.equal(later.used7d, 0);
});

test('poolStats on an empty pool stays defined', () => {
  const stats = poolStats([], [], dayAt(0));
  assert.equal(stats.total, 0);
  assert.equal(stats.used7d, 0);
  assert.equal(stats.doneRatio, 0);
  assert.deepEqual(stats.dormant, []);
  assert.deepEqual(stats.stalePartial, []);
});

test('store.stats and updateItem round-trip progress', () => {
  const storage = memoryStorage();
  const store = createPoolStore([sampleInput({ id: 'p1', progress: 'todo' })], {
    storage,
    now: fixedNow,
  });
  store.markUsed('p1', { kind: 'open', tier: 'deep' });
  const stats = store.stats(fixedNow());
  assert.equal(stats.total, 1);
  assert.equal(stats.byProgress.todo, 1);

  const updated = store.updateItem('p1', { progress: 'partial' });
  assert.equal(updated.progress, 'partial');
  assert.equal(updated.progressUpdatedAt, '2026-11-09');
  assert.equal(store.updateItem('p1', { title: '新标题' }).progress, 'partial'); // 编辑不清进度
});
