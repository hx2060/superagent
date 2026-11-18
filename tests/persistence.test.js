import test from 'node:test';
import assert from 'node:assert/strict';

import { createDailyTaskStore } from '../src/modules/daily-tasks/index.js';
import { createInboxStore } from '../src/modules/inbox/index.js';
import { createPoolStore } from '../src/modules/attention-switch/index.js';
import {
  PERSISTENCE_VERSION,
  STORAGE_KEY,
  createSnapshot,
  readSnapshot,
  restoreState,
  seedFingerprint,
  writeSnapshot,
} from '../src/persistence.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    kind: 'fake',
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    readRaw: (key) => map.get(key) ?? null,
  };
}

const makeSeed = () => ({
  events: [],
  notes: [],
  tasks: [
    { id: 't1', title: '任务一', icon: '📝', status: 'todo' },
    { id: 't2', title: '任务二', icon: '📝', status: 'todo', date: '2026-11-10', start: '09:00', duration: 60 },
  ],
  dailyTasks: [{ id: 'd1', title: '喝水', icon: '💧' }],
  pool: [],
});

test('seedFingerprint 同一份种子稳定、内容变化后不同', () => {
  const seed = makeSeed();
  assert.equal(seedFingerprint(seed), seedFingerprint(makeSeed()));

  const changed = makeSeed();
  changed.tasks[0].status = 'done';
  assert.notEqual(seedFingerprint(seed), seedFingerprint(changed));

  assert.equal(seedFingerprint(null), seedFingerprint(undefined));
});

test('读写 round-trip：快照经 JSON 往返后保持一致', () => {
  const storage = fakeStorage();
  const seed = makeSeed();
  const snapshot = createSnapshot({
    seed,
    tasks: [{ id: 't1', title: '任务一', status: 'done' }],
    notes: [],
    dailyTasks: [{ id: 'd1', title: '喝水', icon: '💧' }],
    dailyStatuses: { '2026-11-06': { d1: 'partial' } },
    pool: [],
    savedAt: '2026-11-06T10:00:00.000Z',
  });

  assert.equal(writeSnapshot(storage, snapshot), true);
  assert.deepEqual(readSnapshot(storage), snapshot);
  assert.ok(storage.readRaw(STORAGE_KEY).includes(String(PERSISTENCE_VERSION)));
});

test('读取：缺失、损坏、版本不符都回退到 null', () => {
  assert.equal(readSnapshot(fakeStorage()), null);
  assert.equal(readSnapshot(null), null);
  assert.equal(readSnapshot(fakeStorage({ [STORAGE_KEY]: '{不是 JSON' })), null);
  assert.equal(readSnapshot(fakeStorage({ [STORAGE_KEY]: '"text"' })), null);
  assert.equal(
    readSnapshot(fakeStorage({ [STORAGE_KEY]: JSON.stringify({ version: PERSISTENCE_VERSION + 1 }) })),
    null
  );
  assert.equal(
    readSnapshot(fakeStorage({ [STORAGE_KEY]: JSON.stringify({ version: PERSISTENCE_VERSION, tasks: 'x' }) })),
    null
  );
});

test('写入：存储不可用或抛错时返回 false，不抛出', () => {
  assert.equal(writeSnapshot(null, { version: PERSISTENCE_VERSION }), false);
  const hostile = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(writeSnapshot(hostile, { version: PERSISTENCE_VERSION }), false);
});

test('清洗：坏条目、重复 id、非法状态与日期被丢弃', () => {
  const storage = fakeStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: PERSISTENCE_VERSION,
      seedKey: 'k',
      tasks: [
        { id: 't1', title: '任务一', status: 'done' },
        { id: 't1', title: '重复', status: 'todo' },
        { id: '', title: '无 id' },
        { title: '无标题' },
        { id: 't2', title: '状态非法', status: 'unknown' },
        'not-an-object',
      ],
      notes: [{ id: 'n1', date: '2026-11-06', text: '便签', tone: 'yellow' }],
      dailyTasks: [{ id: 'd1', title: '喝水' }, { id: 'd2' }],
      dailyStatuses: {
        '2026-11-06': { d1: 'done', d2: 'partial', missing: 'done' },
        '2026-02-30': { d1: 'done' },
        '2026-11-07': { d1: 'todo' },
      },
      pool: [{ id: 'p1', title: '网课', source: 'course', tiers: ['deep'] }],
    }),
  });

  const snapshot = readSnapshot(storage);
  assert.deepEqual(
    snapshot.tasks.map((task) => [task.id, task.status]),
    [
      ['t1', 'done'],
      ['t2', 'todo'],
    ]
  );
  assert.deepEqual(snapshot.dailyTasks.map((task) => task.id), ['d1']);
  // 未知任务 id 的快照层无法判断，交由恢复层按 store 内真实任务过滤
  assert.deepEqual(snapshot.dailyStatuses, {
    '2026-11-06': { d1: 'done', d2: 'partial', missing: 'done' },
  });
  assert.deepEqual(snapshot.pool.map((item) => item.id), ['p1']);

  // 恢复层：不存在的任务状态被丢弃，存在的按 id 保留
  const restored = restoreState(
    { tasks: [], notes: [], dailyTasks: [{ id: 'd1', title: '喝水' }], pool: [], events: [] },
    snapshot
  );
  assert.deepEqual(restored.dailyStatuses, { '2026-11-06': { d1: 'done' } });
});

test('恢复：没有快照时按种子启动', () => {
  const seed = makeSeed();
  assert.deepEqual(restoreState(seed, null), {
    tasks: seed.tasks,
    notes: seed.notes,
    dailyTasks: seed.dailyTasks,
    dailyStatuses: {},
    pool: seed.pool,
  });
});

test('恢复：种子没变时完全恢复快照（删除与新增都在）', () => {
  const seed = makeSeed();
  const snapshot = createSnapshot({
    seed,
    tasks: [{ id: 't2', title: '任务二', icon: '📝', status: 'done', date: '2026-11-10', start: '09:00', duration: 60 }],
    notes: [{ id: 'n1', date: '2026-11-06', text: '界面新增便签', tone: 'pink' }],
    dailyTasks: [{ id: 'd1', title: '喝水', icon: '💧' }],
    dailyStatuses: { '2026-11-06': { d1: 'done' } },
    pool: [{ id: 'p1', title: '网课', source: 'course', tiers: ['deep'] }],
    savedAt: '2026-11-06T10:00:00.000Z',
  });

  const restored = restoreState(seed, snapshot);
  assert.deepEqual(restored.tasks.map((task) => [task.id, task.status]), [['t2', 'done']]);
  assert.deepEqual(restored.notes.map((note) => note.id), ['n1']);
  assert.deepEqual(restored.dailyStatuses, { '2026-11-06': { d1: 'done' } });
  assert.deepEqual(restored.pool.map((item) => item.id), ['p1']);
});

test('恢复：本地内容文件变了——内容以文件为准，状态按 id 保留，界面新增保留', () => {
  const seed = makeSeed();
  const snapshot = createSnapshot({
    seed,
    tasks: [
      { id: 't1', title: '任务一', status: 'done' },
      { id: 't3', title: '界面新增', status: 'partial' },
    ],
    notes: [{ id: 'n1', date: '2026-11-06', text: '界面新增便签', tone: 'pink' }],
    dailyTasks: [{ id: 'd1', title: '喝水', icon: '💧' }],
    dailyStatuses: { '2026-11-06': { d1: 'done', gone: 'done' } },
    pool: [],
  });

  const changedSeed = makeSeed();
  changedSeed.tasks[0].title = '文件改过的标题';
  changedSeed.tasks.push({ id: 't9', title: '文件新增', icon: '📝', status: 'todo' });
  changedSeed.dailyTasks.push({ id: 'd2', title: '阅读', icon: '📖' });

  const restored = restoreState(changedSeed, snapshot);
  assert.deepEqual(
    restored.tasks.map((task) => [task.id, task.title, task.status]),
    [
      ['t1', '文件改过的标题', 'done'],
      ['t2', '任务二', 'todo'],
      ['t9', '文件新增', 'todo'],
      ['t3', '界面新增', 'partial'],
    ]
  );
  assert.deepEqual(
    restored.dailyTasks.map((task) => task.id),
    ['d1', 'd2']
  );
  // 状态只保留给仍然存在的任务
  assert.deepEqual(restored.dailyStatuses, { '2026-11-06': { d1: 'done' } });
  // 便签没有独立状态字段：文件里没有的便签（界面新增）保留
  assert.deepEqual(
    restored.notes.map((note) => [note.id, note.text]),
    [['n1', '界面新增便签']]
  );
});

test('createSnapshot 去掉派生字段 end，便签 / 池原样保留', () => {
  const seed = makeSeed();
  const snapshot = createSnapshot({
    seed,
    tasks: [{ id: 't1', title: '任务一', status: 'todo', date: '2026-11-10', start: '09:00', duration: 60, end: '10:00' }],
    notes: [{ id: 'n1', date: '2026-11-06', text: '便签', tone: 'yellow', tilt: -1.2 }],
    dailyTasks: [],
    dailyStatuses: {},
    pool: [{ id: 'p1', title: '网课', source: 'course', tiers: ['deep'], createdAt: '2026-11-06' }],
  });
  assert.equal(snapshot.tasks[0].end, undefined);
  assert.deepEqual(snapshot.notes[0], { id: 'n1', date: '2026-11-06', text: '便签', tone: 'yellow', tilt: -1.2 });
  assert.deepEqual(snapshot.pool[0].tiers, ['deep']);
});

test('刷新模拟：状态 / 新增 / 删除经快照在新 store 中恢复', () => {
  const storage = fakeStorage();
  const seed = makeSeed();
  const day = '2026-11-06';

  // 第一次会话：改状态、加任务、记每日任务、入池
  const first = {
    inbox: createInboxStore({ tasks: seed.tasks, notes: seed.notes }),
    dailyTasks: createDailyTaskStore(seed.dailyTasks),
    pool: createPoolStore(seed.pool),
  };
  first.inbox.setTaskStatus('t1', 'done');
  first.inbox.addTask({ id: 't-new', title: '会话新增', date: '2026-11-06', start: '14:00', duration: 30 });
  first.inbox.deleteTask('t2');
  first.inbox.addNote({ date: day, text: '会话便签' });
  first.dailyTasks.setStatus('d1', day, 'partial');
  first.pool.addItem({ id: 'p1', title: '网课', source: 'course', tiers: ['deep'] });
  assert.equal(
    writeSnapshot(
      storage,
      createSnapshot({
        seed,
        tasks: first.inbox.listTasks(),
        notes: first.inbox.listNotes(),
        dailyTasks: first.dailyTasks.listTasks(),
        dailyStatuses: first.dailyTasks.listStatuses(),
        pool: first.pool.listItems(),
        savedAt: '2026-11-06T10:00:00.000Z',
      })
    ),
    true
  );

  // 第二次会话（相当于刷新）：从同一快照恢复
  const restored = restoreState(seed, readSnapshot(storage));
  const second = {
    inbox: createInboxStore({ tasks: restored.tasks, notes: restored.notes }),
    dailyTasks: createDailyTaskStore(restored.dailyTasks, { statuses: restored.dailyStatuses }),
    pool: createPoolStore(restored.pool),
  };

  assert.deepEqual(
    second.inbox.listTasks().map((task) => [task.id, task.status]),
    [
      ['t1', 'done'],
      ['t-new', 'todo'],
    ]
  );
  assert.deepEqual(
    second.inbox.listNotes(day).map((note) => note.text),
    ['会话便签']
  );
  assert.equal(second.dailyTasks.getStatus('d1', day), 'partial');
  assert.equal(second.dailyTasks.getStatus('d1', '2026-11-07'), 'todo');
  assert.deepEqual(
    second.pool.listItems().map((item) => item.id),
    ['p1']
  );
});
