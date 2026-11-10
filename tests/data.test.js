import test from 'node:test';
import assert from 'node:assert/strict';

import { loadLocalData, pickSeedData } from '../src/data.js';

test('本地内容：缺失或非法集合按 key 回退到默认种子', () => {
  const fallback = {
    events: [{ id: 'e-fallback' }],
    notes: [{ id: 'n-fallback' }],
    tasks: [{ id: 't-fallback' }],
    dailyTasks: [{ id: 'd-fallback' }],
    pool: [{ id: 'p-fallback' }],
  };

  assert.deepEqual(pickSeedData(null, fallback), fallback);
  assert.deepEqual(pickSeedData([], fallback), fallback);

  const partial = pickSeedData(
    { tasks: [{ id: 't-local' }], events: null, notes: 'broken', pool: 'broken' },
    fallback
  );
  assert.deepEqual(partial.tasks, [{ id: 't-local' }]);
  assert.deepEqual(partial.events, fallback.events);
  assert.deepEqual(partial.notes, fallback.notes);
  assert.deepEqual(partial.dailyTasks, fallback.dailyTasks);
  assert.deepEqual(partial.pool, fallback.pool);
});

test('本地内容：空数组表示有意为空，不回退', () => {
  const seed = pickSeedData({ tasks: [] }, { tasks: [{ id: 'fallback' }] });
  assert.deepEqual(seed.tasks, []);
});

test('本地内容：成功读取 JSON 对象', async () => {
  const payload = { tasks: [{ id: 'task-1' }] };
  const data = await loadLocalData('http://local/schedule.json', async () => ({
    ok: true,
    json: async () => payload,
  }));
  assert.deepEqual(data, payload);
});

test('本地内容：缺失、非对象或网络错误时返回 null', async () => {
  assert.equal(
    await loadLocalData('http://local/schedule.json', async () => ({ ok: false })),
    null
  );
  assert.equal(
    await loadLocalData('http://local/schedule.json', async () => ({ ok: true, json: async () => [] })),
    null
  );
  assert.equal(
    await loadLocalData('http://local/schedule.json', async () => {
      throw new Error('network');
    }),
    null
  );
  assert.equal(
    await loadLocalData('http://local/schedule.json', async () => ({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    })),
    null
  );
  assert.equal(await loadLocalData('http://local/schedule.json', null), null);
});
