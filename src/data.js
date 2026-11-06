import { addDays, startOfDay, toDateKey } from './calendar.js';

/**
 * Local demo data. There is no persistence: the day view's in-memory inbox
 * store (src/modules/inbox) is seeded from these arrays, and add / edit /
 * delete results live only for the current page session.
 */
const relativeDay = (offset) => toDateKey(addDays(startOfDay(new Date()), offset));

export const sampleEvents = [
  { id: 'evt-01', title: '晨会', date: relativeDay(0), start: '09:30', end: '10:00', color: 'blue', icon: 'sun', note: '同步今日重点' },
  { id: 'evt-02', title: '产品方案评审', date: relativeDay(0), start: '14:00', end: '15:30', color: 'violet', icon: 'doc', note: '提前 10 分钟准备材料' },
  { id: 'evt-03', title: '健身', date: relativeDay(0), start: '18:30', end: '19:30', color: 'teal', icon: 'activity', note: '记得带水杯' },
  { id: 'evt-04', title: '设计走查', date: relativeDay(1), start: '10:00', end: '11:00', color: 'orange', icon: 'search', note: '带上检查清单' },
  { id: 'evt-05', title: '周会', date: relativeDay(2), start: '09:00', end: '10:00', color: 'blue', icon: 'users' },
  { id: 'evt-06', title: '需求对齐', date: relativeDay(2), start: '11:00', end: '12:00', color: 'teal', icon: 'link' },
  { id: 'evt-07', title: '客户沟通', date: relativeDay(3), start: '15:00', end: '16:00', color: 'violet', icon: 'chat' },
  { id: 'evt-08', title: '周复盘', date: relativeDay(-1), start: '16:00', end: '17:00', color: 'orange', icon: 'refresh' },
  { id: 'evt-09', title: '阅读与整理', date: relativeDay(-2), start: '20:00', end: '21:00', color: 'teal', icon: 'book' },
  { id: 'evt-10', title: '徒步计划', date: relativeDay(5), start: '08:00', end: '12:00', color: 'orange', icon: 'map' },
];

export const sampleNotes = [
  {
    id: 'note-01',
    date: relativeDay(0),
    text: '评审时先讲结论，再展开方案，记得把风险单独列出来。',
    tone: 'yellow',
    tilt: -1.4,
  },
  {
    id: 'note-02',
    date: relativeDay(0),
    text: '发布前确认三件事：文案、截图、回滚方案。',
    tone: 'pink',
    tilt: 1.6,
  },
];

export const sampleTasks = [
  { id: 'task-01', title: '整理评审意见', icon: '📝', status: 'partial' },
  { id: 'task-02', title: '回复客户邮件', icon: '✉️', status: 'todo' },
  { id: 'task-03', title: '更新周报数据', icon: '📊', status: 'done' },
  { id: 'task-04', title: '读 20 页《设计心理学》', icon: '📖', status: 'todo' },
  { id: 'task-05', title: '预约下周体检', icon: '🩺', status: 'todo' },
];
