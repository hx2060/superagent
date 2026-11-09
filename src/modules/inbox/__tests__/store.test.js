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

test('任务：可选时间会同步为当日时间表事件', () => {
  const store = createInboxStore({ idFactory: testIds() });
  const task = store.addTask({
    title: '写方案',
    date: '2026-11-06',
    start: '9:30',
    duration: 45,
  });

  assert.equal(task.date, '2026-11-06');
  assert.equal(task.start, '09:30');
  assert.equal(task.duration, 45);
  assert.equal(task.end, '10:15');

  const events = store.listCalendarEvents('2026-11-06');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: `task-event-${task.id}`,
    title: '写方案',
    date: '2026-11-06',
    start: '09:30',
    end: '10:15',
    color: 'teal',
    icon: 'doc',
    note: '清单任务 · 待完成',
  });
  assert.equal(store.listCalendarEvents('2026-11-07').length, 0);
});

test('任务：不填时间时只留在清单，不进入时间表', () => {
  const store = createInboxStore({ idFactory: testIds() });
  const task = store.addTask({ title: '随手整理' });

  assert.equal(task.date, undefined);
  assert.equal(task.start, undefined);
  assert.equal(task.duration, undefined);
  assert.equal(task.end, undefined);
  assert.equal(task.due, undefined);
  assert.equal(store.listCalendarEvents('2026-11-06').length, 0);
});

test('任务：可选截止日期会保留、规范化并可清空，非法日期被拒绝', () => {
  const store = createInboxStore({
    tasks: [
      {
        id: 'task-due-seed',
        title: '整理资料',
        icon: '📄',
        status: 'todo',
        due: '2026-11-08',
      },
    ],
    idFactory: testIds(),
  });
  assert.equal(store.listTasks()[0].due, '2026-11-08');

  const added = store.addTask({ title: '写周报', due: ' 2026-11-08 ' });
  assert.equal(added.due, '2026-11-08');

  const cleared = store.updateTask(added.id, { due: '' });
  assert.equal(cleared.due, undefined);

  assert.throws(
    () => store.updateTask(added.id, { due: '2026-02-30' }),
    (error) => error.code === 'INBOX_TASK_DUE_INVALID'
  );
  assert.throws(
    () => store.addTask({ title: '坏日期', due: '周日' }),
    (error) => error.code === 'INBOX_TASK_DUE_INVALID'
  );
});

test('任务：时间字段必须成对填写，且开始、持续、结束需合法', () => {
  const store = createInboxStore({ idFactory: testIds() });
  const invalid = (input, message) =>
    assert.throws(
      () => store.addTask({ title: '时间任务', date: '2026-11-06', ...input }),
      (error) => error.code === 'INBOX_TASK_SCHEDULE_INVALID' && error.message === message
    );

  invalid({ start: '09:30' }, '请同时填写开始时间和持续时间');
  invalid({ duration: 30 }, '请同时填写开始时间和持续时间');
  invalid({ start: '25:00', duration: 30 }, '开始时间格式应为 HH:mm');
  invalid({ start: '06:59', duration: 30 }, '开始时间需在 07:00–20:59 之间');
  invalid({ start: '20:30', duration: 60 }, '结束时间不得晚于 21:00（时间表范围 07:00–21:00）');
  invalid({ start: '10:00', duration: 0 }, `持续时间需为 5–720 分钟的整数`);
  invalid({ start: '10:00', duration: 721 }, `持续时间需为 5–720 分钟的整数`);
  invalid({ date: '', start: '10:00', duration: 30 }, '任务日期必须是 YYYY-MM-DD');
  assert.equal(store.listTasks().length, 0);
});

test('任务：修改时间、改为全天、显式移除日期', () => {
  const store = createInboxStore({ idFactory: testIds() });
  const task = store.addTask({ title: '先不排期' });

  store.updateTask(task.id, {
    title: '排到下午',
    date: '2026-11-06',
    start: '14:00',
    duration: 90,
  });
  assert.equal(store.listTasks()[0].end, '15:30');
  assert.equal(store.listCalendarEvents('2026-11-06')[0].title, '排到下午');

  store.updateTask(task.id, { start: '15:00', duration: 30 });
  assert.equal(store.listCalendarEvents('2026-11-06')[0].end, '15:30');
  assert.equal(store.listTasks()[0].date, '2026-11-06');

  // 清空时间 → 当天天全天任务：保留日期、移出时间表
  store.updateTask(task.id, { start: '', duration: '' });
  const allDay = store.listTasks()[0];
  assert.equal(allDay.date, '2026-11-06');
  assert.equal(allDay.start, undefined);
  assert.equal(allDay.duration, undefined);
  assert.equal(store.listCalendarEvents('2026-11-06').length, 0);

  // 只改日期会移动定时任务并保留时间
  store.updateTask(task.id, { start: '14:00', duration: 90 });
  store.updateTask(task.id, { date: '2026-11-07' });
  const moved = store.listTasks()[0];
  assert.equal(moved.date, '2026-11-07');
  assert.equal(moved.start, '14:00');
  assert.equal(moved.end, '15:30');
  assert.equal(store.listCalendarEvents('2026-11-07').length, 1);
  assert.equal(store.listCalendarEvents('2026-11-06').length, 0);

  // 显式清空日期 → 回到收集区
  store.updateTask(task.id, { date: '' });
  const unscheduled = store.listTasks()[0];
  assert.equal(unscheduled.date, undefined);
  assert.equal(unscheduled.start, undefined);
  assert.equal(store.listCalendarEvents('2026-11-07').length, 0);
  assert.deepEqual(
    store.listUnscheduledTasks().map((item) => item.id),
    [task.id]
  );
});

test('任务：只传日期即创建全天任务，不再静默忽略', () => {
  const store = createInboxStore({ idFactory: testIds() });
  const task = store.addTask({ title: '全天任务', date: '2026-11-06' });

  assert.equal(task.date, '2026-11-06');
  assert.equal(task.start, undefined);
  assert.equal(task.duration, undefined);
  assert.equal(store.listCalendarEvents('2026-11-06').length, 0);
  assert.deepEqual(store.listUnscheduledTasks(), []);
});

test('任务：收集区只包含无日期无截止的任务', () => {
  const store = createInboxStore({ idFactory: testIds() });
  store.addTask({ title: '收集区任务' });
  store.addTask({ title: '定时任务', date: '2026-11-06', start: '09:00', duration: 30 });
  store.addTask({ title: '全天任务', date: '2026-11-06' });
  store.addTask({ title: '仅截止任务', due: '2026-11-08' });

  assert.deepEqual(
    store.listUnscheduledTasks().map((item) => item.title),
    ['收集区任务']
  );
});

test('任务：截止日期早于任务日期时写入报错', () => {
  const store = createInboxStore({ idFactory: testIds() });

  assert.throws(
    () => store.addTask({ title: '矛盾任务', date: '2026-11-06', due: '2026-11-05' }),
    (error) =>
      error.code === 'INBOX_TASK_DUE_INVALID' && error.message === '截止日期不能早于任务日期'
  );
  assert.equal(store.listTasks().length, 0);

  const timed = store.addTask({ title: '定时任务', date: '2026-11-06', start: '09:00', duration: 30 });
  assert.throws(
    () => store.updateTask(timed.id, { due: '2026-11-05' }),
    (error) => error.code === 'INBOX_TASK_DUE_INVALID'
  );
  assert.equal(store.listTasks()[0].due, undefined);

  const dueTask = store.addTask({ title: '截止任务', due: '2026-11-08' });
  assert.throws(
    () => store.updateTask(dueTask.id, { date: '2026-11-09' }),
    (error) => error.code === 'INBOX_TASK_DUE_INVALID'
  );
  assert.equal(store.listTasks()[1].date, undefined);

  // 截止与任务同日仍然合法
  const same = store.addTask({ title: '同日任务', date: '2026-11-06', due: '2026-11-06' });
  assert.equal(same.due, '2026-11-06');
});

test('任务：状态变化会反映在时间表事件备注中，删除后事件消失', () => {
  const store = createInboxStore({ idFactory: testIds() });
  const task = store.addTask({
    title: '评审',
    date: '2026-11-06',
    start: '10:00',
    duration: 30,
  });

  store.cycleTaskStatus(task.id);
  assert.equal(store.listCalendarEvents('2026-11-06')[0].note, '清单任务 · 部分完成');

  store.deleteTask(task.id);
  assert.equal(store.listCalendarEvents('2026-11-06').length, 0);
});

test('任务：可指定 id，重复 id 被拒绝', () => {
  const store = createInboxStore({ idFactory: testIds() });
  const task = store.addTask({ id: '  task-fixed  ', title: '固定 id 任务' });

  assert.equal(task.id, 'task-fixed');
  assert.equal(store.listTasks().length, 1);
  assert.throws(
    () => store.addTask({ id: 'task-fixed', title: '重复 id' }),
    (error) => error.code === 'INBOX_TASK_DUPLICATE_ID'
  );
  assert.equal(store.listTasks().length, 1);
});

test('种子任务 / 便签缺少 id 或 id 重复时生成唯一临时 id', () => {
  const store = createInboxStore({
    tasks: [
      { title: '缺少 id 的任务' },
      { id: 'task-dup', title: '重复 id 一' },
      { id: 'task-dup', title: '重复 id 二' },
    ],
    notes: [{ date: '2026-11-06', text: '缺少 id 的便签' }],
    idFactory: testIds(),
  });

  const ids = store.listTasks().map((task) => task.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
  const noteIds = store.listNotes().map((note) => note.id);
  assert.equal(noteIds.length, 1);
  assert.ok(noteIds[0].startsWith('note-'));
});
