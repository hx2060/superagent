import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TASK_ICON,
  NOTE_TEXT_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  createInboxStore,
} from '../store.js';

function testIds() {
  let sequence = 0;
  return (prefix) => `${prefix}-test-${++sequence}`;
}

function seedTasks() {
  return [
    { id: 'task-a', title: '整理评审意见', icon: '📝', status: 'partial' },
    { id: 'task-b', title: '回复客户邮件', icon: '✉️', status: 'done' },
  ];
}

function seedNotes() {
  return [
    { id: 'note-a', date: '2026-11-06', text: '先写结论', tone: 'yellow', tilt: -1.2 },
    { id: 'note-b', date: '2026-11-07', text: '明天再看', tone: 'pink', tilt: 1.4 },
  ];
}

test('任务：初始状态与进度来自示例数据', () => {
  const store = createInboxStore({ tasks: seedTasks(), idFactory: testIds() });
  const tasks = store.listTasks();

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].status, 'partial');
  assert.equal(tasks[1].status, 'done');
  assert.deepEqual(store.taskProgress(), { total: 2, todo: 0, partial: 1, done: 1, percent: 50 });
});

test('任务：新增会去掉首尾空白、使用默认图标并通知订阅者', () => {
  const store = createInboxStore({ tasks: seedTasks(), idFactory: testIds() });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  const task = store.addTask({ title: '  预约体检  ' });
  assert.equal(task.title, '预约体检');
  assert.equal(task.icon, DEFAULT_TASK_ICON);
  assert.equal(task.status, 'todo');
  assert.equal(task.id, 'task-test-1');
  assert.equal(store.listTasks().length, 3);
  assert.equal(notifications, 1);

  unsubscribe();
  store.addTask({ title: '再新增一条' });
  assert.equal(notifications, 1);
});

test('任务：非法标题被拒绝', () => {
  const store = createInboxStore({ idFactory: testIds() });

  assert.throws(
    () => store.addTask({ title: '   ' }),
    (error) => error.code === 'INBOX_TASK_TITLE_INVALID'
  );
  assert.throws(
    () => store.addTask({ title: 'a'.repeat(TASK_TITLE_MAX_LENGTH + 1) }),
    (error) => error.code === 'INBOX_TASK_TITLE_INVALID'
  );
  assert.equal(store.listTasks().length, 0);
});

test('任务：修改标题保留状态，未知 id 报错', () => {
  const store = createInboxStore({ tasks: seedTasks(), idFactory: testIds() });
  store.cycleTaskStatus('task-a');
  const updated = store.updateTask('task-a', { title: ' 整理并归档评审意见 ' });

  assert.equal(updated.title, '整理并归档评审意见');
  assert.equal(updated.status, 'done');
  assert.equal(store.taskStatus('task-a'), 'done');
  assert.throws(
    () => store.updateTask('task-missing', { title: 'x' }),
    (error) => error.code === 'INBOX_TASK_NOT_FOUND'
  );
  assert.throws(
    () => store.updateTask('task-a', { title: '' }),
    (error) => error.code === 'INBOX_TASK_TITLE_INVALID'
  );
});

test('任务：三态循环固定为 todo → partial → done → todo', () => {
  const store = createInboxStore({ tasks: seedTasks(), idFactory: testIds() });
  assert.equal(store.taskStatus('task-b'), 'done');
  assert.equal(store.cycleTaskStatus('task-b'), 'todo');
  assert.equal(store.cycleTaskStatus('task-b'), 'partial');
  assert.equal(store.cycleTaskStatus('task-b'), 'done');
  assert.equal(store.cycleTaskStatus('task-b'), 'todo');
  assert.throws(
    () => store.setTaskStatus('task-b', 'unknown'),
    (error) => error.code === 'INBOX_TASK_STATUS_INVALID'
  );
});

test('任务：删除后从列表、进度与状态表移除', () => {
  const store = createInboxStore({ tasks: seedTasks(), idFactory: testIds() });
  const removed = store.deleteTask('task-a');

  assert.equal(removed.title, '整理评审意见');
  assert.equal(removed.status, 'partial');
  assert.deepEqual(
    store.listTasks().map((task) => task.id),
    ['task-b']
  );
  assert.deepEqual(store.taskProgress(), { total: 1, todo: 0, partial: 0, done: 1, percent: 100 });
  assert.throws(
    () => store.deleteTask('task-a'),
    (error) => error.code === 'INBOX_TASK_NOT_FOUND'
  );
});

test('任务：id 工厂返回重复值时继续生成唯一 id', () => {
  let calls = 0;
  const store = createInboxStore({
    tasks: [{ id: 'task-dup', title: '已有任务', icon: '📝', status: 'todo' }],
    idFactory: (prefix) => {
      calls += 1;
      return calls < 3 ? `${prefix}-dup` : `${prefix}-unique`;
    },
  });

  const task = store.addTask({ title: '新任务' });
  assert.equal(task.id, 'task-unique');
  assert.equal(new Set(store.listTasks().map((item) => item.id)).size, 2);
});

test('便签：按天读取，新增时按当天数量轮换颜色与倾斜', () => {
  const store = createInboxStore({ notes: seedNotes(), idFactory: testIds() });
  assert.deepEqual(
    store.listNotes('2026-11-06').map((note) => note.id),
    ['note-a']
  );

  const first = store.addNote({ date: '2026-11-06', text: '  第二条  ' });
  assert.equal(first.text, '第二条');
  assert.equal(first.date, '2026-11-06');
  assert.equal(first.tone, 'pink');
  assert.equal(store.listNotes('2026-11-06').length, 2);
  assert.equal(store.listNotes('2026-11-08').length, 0);

  const second = store.addNote({ date: '2026-11-06', text: '第三条' });
  assert.equal(second.tone, 'blue');
  const fourth = store.addNote({ date: '2026-11-06', text: '第四条' });
  assert.equal(fourth.tone, 'yellow');
});

test('便签：修改只改文本，保留日期与颜色；删除后移除', () => {
  const store = createInboxStore({ notes: seedNotes(), idFactory: testIds() });
  const updated = store.updateNote('note-a', { text: '先写结论\n再展开方案' });

  assert.equal(updated.text, '先写结论\n再展开方案');
  assert.equal(updated.date, '2026-11-06');
  assert.equal(updated.tone, 'yellow');

  const removed = store.deleteNote('note-b');
  assert.equal(removed.id, 'note-b');
  assert.equal(store.listNotes('2026-11-07').length, 0);
  assert.throws(
    () => store.updateNote('note-missing', { text: 'x' }),
    (error) => error.code === 'INBOX_NOTE_NOT_FOUND'
  );
});

test('便签：非法日期与空内容被拒绝', () => {
  const store = createInboxStore({ idFactory: testIds() });

  assert.throws(
    () => store.addNote({ date: '2026-02-30', text: 'x' }),
    (error) => error.code === 'INBOX_NOTE_DATE_INVALID'
  );
  assert.throws(
    () => store.addNote({ date: '2026-11-06', text: '  ' }),
    (error) => error.code === 'INBOX_NOTE_TEXT_INVALID'
  );
  assert.throws(
    () => store.addNote({ date: '2026-11-06', text: 'a'.repeat(NOTE_TEXT_MAX_LENGTH + 1) }),
    (error) => error.code === 'INBOX_NOTE_TEXT_INVALID'
  );
  assert.equal(store.listNotes().length, 0);
});

test('空监听器与非函数订阅会被拒绝', () => {
  const store = createInboxStore();
  assert.throws(() => store.subscribe(null), TypeError);
});
