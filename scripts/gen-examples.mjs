/**
 * Generate the test instance's example content.
 *
 * The test port serves the same app as the local one but with neutral
 * placeholder data that exercises every feature, so functionality can be
 * reviewed without touching the real local content (which stays in
 * `local/schedule.json`, git-ignored). Dates are relative to today, so the
 * generated file can be refreshed any day with:
 *
 *   node scripts/gen-examples.mjs
 *
 * Output: `local/examples/schedule.json` (git-ignored, like all of `local/`).
 * Titles are neutral placeholders; no real schedule content belongs here.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addDays, startOfDay, toDateKey } from '../src/calendar.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const today = startOfDay(new Date());
const key = (offset) => toDateKey(addDays(today, offset));

/** @type {{ events: object[], notes: object[], tasks: object[], dailyTasks: object[] }} */
const data = {
  events: [
    {
      id: 'evt-example-1',
      title: '示例日程（今天下午）',
      date: key(0),
      start: '14:00',
      end: '15:30',
      color: 'violet',
      icon: 'doc',
      note: '与示例定时任务重叠，验证分列显示',
    },
    {
      id: 'evt-example-2',
      title: '示例日程（明天上午）',
      date: key(1),
      start: '09:30',
      end: '10:30',
      color: 'blue',
      icon: 'activity',
    },
  ],
  notes: [
    { id: 'note-example-1', date: key(0), text: '示例便签：今天的两条待办都在当日计划里。', tone: 'yellow', tilt: -1.2 },
    { id: 'note-example-2', date: key(0), text: '示例便签：收集区任务不计入日进度。', tone: 'pink', tilt: 1.4 },
  ],
  tasks: [
    // 逾期回顾区：截止已过、未完成 / 已完成
    { id: 'ex-overdue-a', title: '示例任务 A（截止已过·未完成）', icon: '📕', status: 'todo', due: key(-1) },
    { id: 'ex-overdue-b', title: '示例任务 B（截止已过·未完成）', icon: '📗', status: 'partial', due: key(-3) },
    { id: 'ex-overdue-done', title: '示例任务 C（截止已过·已完成）', icon: '📘', status: 'done', due: key(-2) },
    // 当日计划：今日到期 / 今日定时 / 跨天
    { id: 'ex-due-today', title: '示例任务 D（今日到期）', icon: '⏰', status: 'todo', due: key(0) },
    { id: 'ex-timed-today', title: '示例任务 E（今日定时·部分完成）', icon: '📝', status: 'partial', date: key(0), start: '09:00', duration: 60 },
    { id: 'ex-timed-today-2', title: '示例任务 F（今日定时·与日程重叠）', icon: '📝', status: 'todo', date: key(0), start: '14:15', duration: 45 },
    { id: 'ex-span', title: '示例任务 G（跨天任务）', icon: '🧭', status: 'todo', date: key(0), start: '10:00', duration: 45, due: key(6) },
    // 未来截止 / 未来定时 / 同日截止
    { id: 'ex-due-future', title: '示例任务 H（截止未来）', icon: '📅', status: 'todo', due: key(11) },
    { id: 'ex-timed-future', title: '示例任务 I（未来定时）', icon: '📝', status: 'todo', date: key(1), start: '11:00', duration: 90 },
    { id: 'ex-same-day', title: '示例任务 J（排期与截止同日）', icon: '📝', status: 'todo', date: key(2), start: '15:00', duration: 30, due: key(2) },
    // 往日定时（历史记录，只在当日可见）
    { id: 'ex-timed-past', title: '示例任务 K（往日定时·已完成）', icon: '📝', status: 'done', date: key(-4), start: '14:00', duration: 90 },
    // 全天任务：今天 / 未来 / 过去
    { id: 'ex-allday-today', title: '示例任务 L（今天全天）', icon: '🗓️', status: 'todo', date: key(0) },
    { id: 'ex-allday-future', title: '示例任务 M（未来全天）', icon: '🗓️', status: 'todo', date: key(5) },
    { id: 'ex-allday-past', title: '示例任务 N（过去全天·已完成）', icon: '🗓️', status: 'done', date: key(-5) },
    // 收集区：未排期
    { id: 'ex-loose-a', title: '示例任务 O（收集区·待完成）', icon: '📥', status: 'todo' },
    { id: 'ex-loose-b', title: '示例任务 P（收集区·部分完成）', icon: '📥', status: 'partial' },
  ],
  dailyTasks: [
    { id: 'ex-daily-1', title: '示例每日任务：喝水', icon: '💧' },
    { id: 'ex-daily-2', title: '示例每日任务：阅读 20 分钟', icon: '📖' },
  ],
};

const target = join(root, 'local', 'examples', 'schedule.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`示例内容已生成：${target}（今天 ${key(0)}）`);
console.log(`任务 ${data.tasks.length} 条 · 日程 ${data.events.length} 条 · 便签 ${data.notes.length} 条 · 每日任务 ${data.dailyTasks.length} 条`);
