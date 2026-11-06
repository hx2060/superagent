import { addDays, startOfDay, toDateKey } from './calendar.js';

/**
 * Local demo data. The minimal loop intentionally has no persistence or CRUD;
 * events live next to "today" so every view has something to show on first load.
 */
const relativeDay = (offset) => toDateKey(addDays(startOfDay(new Date()), offset));

export const sampleEvents = [
  { id: 'evt-01', title: '晨会', date: relativeDay(0), start: '09:30', end: '10:00', color: 'blue' },
  { id: 'evt-02', title: '产品方案评审', date: relativeDay(0), start: '14:00', end: '15:30', color: 'violet' },
  { id: 'evt-03', title: '健身', date: relativeDay(0), start: '18:30', end: '19:30', color: 'teal' },
  { id: 'evt-04', title: '设计走查', date: relativeDay(1), start: '10:00', end: '11:00', color: 'orange' },
  { id: 'evt-05', title: '周会', date: relativeDay(2), start: '09:00', end: '10:00', color: 'blue' },
  { id: 'evt-06', title: '需求对齐', date: relativeDay(2), start: '11:00', end: '12:00', color: 'teal' },
  { id: 'evt-07', title: '客户沟通', date: relativeDay(3), start: '15:00', end: '16:00', color: 'violet' },
  { id: 'evt-08', title: '周复盘', date: relativeDay(-1), start: '16:00', end: '17:00', color: 'orange' },
  { id: 'evt-09', title: '阅读与整理', date: relativeDay(-2), start: '20:00', end: '21:00', color: 'teal' },
  { id: 'evt-10', title: '徒步计划', date: relativeDay(5), start: '08:00', end: '12:00', color: 'orange' },
];
