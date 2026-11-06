# 日程 · 接口说明

版本：`0.2`（PR #3 主干基线 + 每日任务模块；0.2 为向后兼容的增量接口）
适用范围：当前静态实现、后续模块与后端对接

本文档说明「日程」当前**已经实现**的模块接口、数据契约与 DOM 契约，以及预留的扩展接口。接口变更必须同步修改本文档，并按 `AGENTS.md` 的规则评审。

## 1. 模块地图

```
src/calendar.js   纯日期 / 网格 / 时间布局函数（无 DOM、无副作用）
src/tasks.js      任务三态与进度统计（无 DOM）
src/data.js       当前静态示例数据（可被数据源替换）
src/app.js        应用控制器：状态、视图分发、DOM 事件
src/modules/daily-tasks/
                  每日重复任务模块：store、日视图 UI、模块测试
index.html        页面骨架、工具栏与模块样式入口
assets/styles.css 全局与视图样式
```

当前没有构建步骤和运行时依赖；`app.js` 是唯一入口，负责读取 URL、维护 `state`、渲染视图与处理交互。日视图会额外挂载 `daily-tasks` 模块，并通过 `services.dailyTasks` 共享状态。

## 2. 数据契约

### 2.1 枚举

| 名称 | 取值 | 说明 |
| --- | --- | --- |
| `ViewKind` | `month` / `week` / `day` | 当前视图 |
| `EventColor` | `blue` / `teal` / `orange` / `violet` | 事件颜色，对应月/周/日样式 |
| `EventIcon` | `sun` / `doc` / `activity` / `search` / `users` / `link` / `chat` / `refresh` / `book` / `map` | 日视图时间轴图标 |
| `NoteTone` | `yellow` / `pink` / `blue` | 便签纸颜色 |
| `TaskStatus` | `todo` / `partial` / `done` | 待完成 / 部分完成 / 完成 |

### 2.2 数据结构

```ts
interface CalendarEvent {
  id: string;                 // 集合内唯一
  title: string;              // 纯文本，渲染时转义
  date: string;               // YYYY-MM-DD（本地日期）
  start: string;              // HH:mm
  end: string;                // HH:mm，必须晚于 start
  color: EventColor;
  icon?: EventIcon;           // 缺省使用 doc
  note?: string;              // 日视图时间轴下的一行小注
}

interface StickyNote {
  id: string;                 // 集合内唯一
  date: string;               // YYYY-MM-DD；便签按天展示
  text: string;               // 纯文本
  tone: NoteTone;
  tilt?: number;              // 旋转角度，单位 deg，例如 -1.4
}

interface Task {
  id: string;                 // 集合内唯一
  title: string;              // 纯文本
  icon: string;               // emoji 字符，例如 "📝"
  status: TaskStatus;         // 初始状态
}
// 任务属于「未排期 Inbox」，没有 date / start / end；所有日期共享同一份清单。

interface DailyTask {
  id: string;                 // 集合内唯一
  title: string;              // 纯文本，1–80 字符
  icon?: string;              // 缺省 🔁；最多 8 个 code point
  recurrence: 'daily';        // 固定每日重复，不绑定具体日期
}
// 每日任务是重复定义，不进入时间表；完成状态按日期单独记录：
// statuses[YYYY-MM-DD][taskId] = TaskStatus，缺省 todo。
```

**每日任务与 Inbox 的关系**：`Task` 仍是未排期的全局 Inbox；`DailyTask` 是每天重新出现的重复任务。两者状态枚举与切换顺序一致，但每日任务不因为当天完成而改变其它日期的状态，也不占用时间表。`daily-01` 这类定义在 11 月 6 日的完成记录不会影响 11 月 7 日。

### 2.3 不变量

- `id` 在各自集合内唯一；状态、颜色、便签色调、图标不得使用未知值。
- 日期使用本地时区的 `YYYY-MM-DD`；时间使用 24 小时制 `HH:mm`。
- `start < end`；07:00–21:00 之外的周/日视图内容会被裁切，月视图仍按日期展示。
- 标题、便签、备注按纯文本处理；不要传 HTML，渲染层会转义。
- 月 / 周视图读取事件；日视图读取事件、当天便签、全局任务与每日任务定义。
- 任务状态切换顺序固定：`todo → partial → done → todo`；完成进度只统计 `done / total`。
- `DailyTask.recurrence` 固定为 `daily`；定义没有日期字段，日期只用于读取/写入当天的完成状态。
- 每日任务与普通任务共用状态枚举与切换顺序，但状态按 `YYYY-MM-DD` 隔离；跨天默认回到 `todo`。
- 每日任务只在日视图展示和手工添加；月 / 周视图不展示每日任务条。

### 2.4 示例数据

`src/data.js` 导出 `sampleEvents`、`sampleNotes`、`sampleTasks`、`sampleDailyTasks`，日期相对浏览器当天（`relativeDay(offset)`）。示例只用于本地演示，不含真实用户数据。

`sampleDailyTasks` 是每日任务的定义入口：dsh 可以追加条目，刷新后随页面加载；手工添加与运行时 API 新增的任务只在当前页面会话中，刷新后回到该数组的初始定义。

## 3. 纯函数接口

### 3.1 `src/calendar.js`

所有函数无副作用，接受/返回本地 `Date` 或字符串，可在 node:test 中直接测试。

| 函数 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `startOfDay(date)` | Date | Date | 本地零点 |
| `toDateKey(date)` | Date | string | `YYYY-MM-DD`，避免时区偏移 |
| `parseDateKey(key)` | string | Date \| null | 解析并校验真实日期 |
| `addDays(date, amount)` | Date, number | Date | 按天偏移 |
| `daysInMonth(year, monthIndex)` | number, number | number | 月份天数 |
| `addMonths(date, amount)` | Date, number | Date | 翻月，日期溢出时收敛到月末 |
| `startOfWeek(date)` | Date | Date | 周一为一周起点 |
| `getWeekDays(anchor)` | Date | Date[7] | 周一到周日 |
| `buildMonthMatrix(anchor)` | Date | Date[42] | 6 × 7 月网格，周一起始 |
| `isSameDay(a, b)` | Date, Date | boolean | 同一天 |
| `formatMonthTitle(date)` | Date | string | `2026年11月` |
| `formatWeekTitle(date)` | Date | string | `2026年11月2日 – 8日` |
| `formatDayTitle(date)` | Date | string | `2026年11月6日 周五` |
| `formatTimeRange(start, end)` | string, string | string | `09:30 – 10:00` |
| `formatDuration(minutes)` | number | string | `30 分钟` / `1 小时 30 分钟` |
| `timeToMinutes(value)` | string | number | `09:30` → `570`；非法返回 `NaN` |
| `groupEventsByDate(events)` | CalendarEvent[] | Map<string, CalendarEvent[]> | 按日期分组并按开始时间排序 |
| `eventsForDay(events, date)` | CalendarEvent[], Date | CalendarEvent[] | 指定日的事件 |
| `layoutOverlaps(events)` | CalendarEvent[] | Map<id, {column, columns}> | 周视图重叠事件的并排列 |
| `weekEventStyle(event, options?)` | CalendarEvent, object | {top, height} \| null | 周视图纵向坐标；超出 07:00–21:00 返回 null 或裁切 |

常量：`WEEKDAY_LABELS`、`WEEKDAY_FULL`、`WEEK_GRID_START_HOUR = 7`、`WEEK_GRID_END_HOUR = 21`、`WEEK_GRID_HOUR_HEIGHT = 44`。

### 3.2 `src/tasks.js`

| 导出 | 说明 |
| --- | --- |
| `TASK_STATUS_ORDER` | `['todo', 'partial', 'done']` |
| `TASK_STATUS_LABELS` | `{ todo: '待完成', partial: '部分完成', done: '完成' }` |
| `nextTaskStatus(status)` | 返回循环中的下一状态；未知状态回退到 `todo` |
| `taskStatusCounts(tasks, statuses)` | `{ total, todo, partial, done, percent }`，`percent` 取整 |

`statuses` 是 `Map<taskId, TaskStatus>`，允许覆盖任务初始状态。

### 3.3 `src/modules/daily-tasks/store.js`

每日任务的纯逻辑 store（无 DOM）。模块入口 `index.js` 重新导出以下函数，宿主与测试都应从模块入口导入。

| 导出 | 说明 |
| --- | --- |
| `normalizeDailyTask(input)` | 校验并规范化 `{ id?, title, icon? }`；返回带 `recurrence: 'daily'` 的对象或 `null` |
| `createDailyTaskStore(seedTasks, options?)` | 创建 store；`options.createId` 可注入 id 生成器（测试用） |
| `store.addTask(input)` | 新增定义；返回任务副本；非法标题 / 重复 id 抛带 `code` 的 `Error` |
| `store.listTasks()` | 全部定义副本 |
| `store.listForDate(dateKey)` | `[{ task, status }]`，状态缺省 `todo` |
| `store.getStatus(taskId, dateKey)` | 当天状态 |
| `store.setStatus(taskId, dateKey, status)` | 写入当天状态 |
| `store.toggleStatus(taskId, dateKey)` | 按三态循环切换当天状态 |
| `store.statusCounts(dateKey)` | 当天 `{ total, todo, partial, done, percent }` |
| `store.subscribe(listener)` | 返回退订函数；新增 / 状态变化时通知 |

校验规则：`title` 去空白后 1–80 字符；`icon` 最多 8 个 code point，缺省 `🔁`；`dateKey` 必须是真实的 `YYYY-MM-DD`；`status` 必须是 `todo / partial / done`。错误码见模块 README。

## 4. 页面与 DOM 契约

### 4.1 URL

| 参数 | 取值 | 行为 |
| --- | --- | --- |
| `view` | `month` / `week` / `day` | 初始视图；非法值回退 `month` |
| `date` | `YYYY-MM-DD` | 初始锚点日期；非法值回退今天 |

示例：`/?view=day&date=2026-11-06`。

### 4.2 稳定选择器

后续模块 / 自动化测试可依赖以下选择器；普通样式类名不属于稳定接口。

| 选择器 | 用途 |
| --- | --- |
| `#view-root` | 视图根节点，内容整体替换 |
| `#period-title` | 工具栏周期标题 |
| `.view-switch [data-view]` | 月 / 周 / 日切换按钮，`aria-pressed` 表示当前视图 |
| `[data-action="prev" / "next" / "today"]` | 上一段 / 下一段 / 回到今天 |
| `[data-open-date="YYYY-MM-DD"]` | 任意日期入口（月格、周表头、日视图周条），点击进入该日的日视图 |
| `[data-task-row="<id>"]` | 清单任务行，`data-status` 为当前状态 |
| `[data-task-toggle="<id>"]` | 状态切换按钮；点击循环三态 |
| `[data-task-progress-text]` | `done / total 完成` 文本 |
| `[data-task-progress-fill]` | 完成度进度条宽度 |
| `[data-task-live]` | `aria-live="polite"` 状态播报区域 |
| `[data-module-root="daily-tasks"]` | 日视图中的每日任务模块槽位 |
| `[data-daily-task-row="<id>"]` | 每日任务胶囊行，`data-status` 为当天状态 |
| `[data-daily-tasks-toggle="<id>"]` | 每日任务状态切换按钮；点击循环三态 |
| `[data-daily-tasks-add-toggle]` | 手工添加入口，`aria-expanded` 表示表单是否展开 |
| `[data-daily-tasks-form]` | 手工添加表单；收起时带 `hidden` |
| `[data-daily-tasks-input]` | 任务名称输入框，`maxlength=80` |
| `[data-daily-tasks-progress]` | 当天 `done / total 完成` 文本 |
| `[data-daily-tasks-live]` | 每日任务状态播报区域 |

### 4.3 任务状态 UI 契约

- 点击 `[data-task-toggle]` 按 `todo → partial → done → todo` 循环。
- 行 `data-status`、按钮 `data-status`、状态文案 `待完成 / 部分完成 / 完成`、进度文本与进度条在同一帧更新。
- 状态变化向 `[data-task-live]` 写入 `「<title>」已标记为<label>`，供读屏器播报。
- 任务为未排期 Inbox，不绑定日期；事件才绑定日期。

### 4.4 每日任务 UI 契约

- 仅在日视图出现；进入日视图时挂载，离开 / 重绘时卸载。
- 点击 `[data-daily-tasks-toggle]` 只更新当前锚点日期的状态，按 `todo → partial → done → todo` 循环；跨日导航后同一任务默认回到 `todo`。
- 行 `[data-daily-task-row]` 的 `data-status`、胶囊文案、`[data-daily-tasks-progress]` 与进度条宽度同帧更新。
- `[data-daily-tasks-add-toggle]` 展开 / 收起 `[data-daily-tasks-form]`；提交成功后表单收起、定义追加；空 / 超长标题留在表单内并显示 `role="alert"` 错误。
- 手工添加只填标题，图标使用默认 `🔁`；dsh 可通过运行时 API 指定 `icon`。
- 状态变化 / 新增向 `[data-daily-tasks-live]` 写入中文播报；`Esc` 收起添加表单。
- 每日任务条不进入月 / 周视图，不写入时间表。

## 5. 扩展接口（已落地部分与预留部分）

### 5.1 模块契约

`daily-tasks` 是第一个落地的模块，模块入口仍遵循：

```js
export function mount(context) {
  // 只操作 context.root
  return {
    update(nextContext) {},
    destroy() {},
  };
}
```

`context`：

```ts
{
  root: HTMLElement;
  state: { view: ViewKind; anchor: Date };   // 只读快照
  data: {
    events: CalendarEvent[];
    notes: StickyNote[];
    tasks: Task[];
    dailyTasks?: DailyTask[];                 // 每日任务定义快照
  };
  services: {
    dailyTasks?: DailyTasksService;           // 已导出
    [name: string]: unknown;                  // 后续模块按提案扩展
  };
}
```

`DailyTasksService`（也就是 `services.dailyTasks`）：

```ts
interface DailyTasksService {
  addTask(input: { id?: string; title: string; icon?: string }): DailyTask;
  listTasks(): DailyTask[];
  listForDate(date: string): Array<{ task: DailyTask; status: TaskStatus }>;
  getStatus(taskId: string, date: string): TaskStatus;
  setStatus(taskId: string, date: string, status: TaskStatus): TaskStatus;
  toggleStatus(taskId: string, date: string): TaskStatus;
  statusCounts(date: string): { total: number; todo: number; partial: number; done: number; percent: number };
  subscribe(listener: (change: object) => void): () => void;
}
```

约束见 `AGENTS.md`：模块样式加 `.mod-<name>-` 前缀、不跨模块 import、不直接改全局状态、共享能力走 services。当前注册点：

- 日视图 `renderDay()` 内一行 `<div data-module-root="daily-tasks"></div>`；
- `render()` 在日视图挂载 / 其他视图卸载模块；
- `index.html` 一行 `<link rel="stylesheet" href="./src/modules/daily-tasks/styles.css" />`；
- `app.js` 创建唯一 store 并注入 `services.dailyTasks`。

后续模块应复用该模式；新增共享能力先提交最小接口提案。

### 5.2 数据源契约（建议）

当前应用同步读取静态数组。接入后端时，建议实现以下接口（**尚未实现**）：

```ts
interface CalendarDataSource {
  listEvents(range: { from: string; to: string }): Promise<CalendarEvent[]>;
  listNotes(date: string): Promise<StickyNote[]>;
  listTasks(): Promise<Task[]>;
  updateTaskStatus(id: string, status: TaskStatus): Promise<Task>;
  listDailyTasks(date: string): Promise<Array<{ task: DailyTask; status: TaskStatus }>>;
  addDailyTask(input: { title: string; icon?: string }): Promise<DailyTask>;
  updateDailyTaskStatus(id: string, date: string, status: TaskStatus): Promise<TaskStatus>;
}
```

后端映射、异步加载、错误回滚与乐观更新见 `docs/integration.md`。

### 5.3 dsh 输入接口

`app.js` 暴露只读命名空间 `window.schedule`，其中 `dailyTasks` 是当前页面会话内的每日任务接口：

```js
window.schedule.dailyTasks.add({ title: '整理今日待办', icon: '📝' });
window.schedule.dailyTasks.list('2026-11-06');
// [{ task: { id, title, icon, recurrence: 'daily' }, status: 'todo' }, ...]

window.schedule.dailyTasks.toggle('daily-01', '2026-11-06');
window.schedule.dailyTasks.setStatus('daily-01', 'done', '2026-11-06');
window.schedule.dailyTasks.getStatus('daily-01', '2026-11-06');
```

- `add(input)` 等价于 `services.dailyTasks.addTask(input)`；返回值是任务副本。
- `list(date = 今天)`、`getStatus(id, date = 今天)`、`toggle(id, date = 今天)`、`setStatus(id, status, date = 今天)` 的日期参数为 `YYYY-MM-DD`。
- 非法输入抛带 `code` 的 `Error`（`DAILY_TASK_INVALID` / `DAILY_TASK_DUPLICATE_ID` / `DAILY_TASK_STATUS_INVALID` / `DAILY_TASK_DATE_INVALID`）。
- 运行时新增与手工添加只存在当前页面会话；刷新后回到 `src/data.js` 的 `sampleDailyTasks`。需要持久化的 dsh 输入应改该数据入口并重新加载。

## 6. 版本与兼容

- 当前接口版本 `0.2`；0.2 为增量：新增 `DailyTask`、`DailyTasksService`、`window.schedule.dailyTasks`、每日任务 DOM 选择器与模块样式入口；原有 `CalendarEvent` / `StickyNote` / `Task` 字段未改。
- 新增字段必须可选，渲染层对未知可选字段保持忽略。
- 颜色 / 图标 / 状态枚举新增时，需要同时补样式与回退；删除或重命名属于 breaking change。
- 破坏性接口变更必须升级版本、更新本文档与 `docs/integration.md`，并在 PR 中明确迁移方案。
