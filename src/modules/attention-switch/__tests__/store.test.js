import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POOL_DEFAULT_OPTION_COUNT,
  POOL_NOTE_MAX_LENGTH,
  POOL_SOURCES,
  POOL_TIERS,
  POOL_TITLE_MAX_LENGTH,
  createPoolStore,
  normalizePoolItem,
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
