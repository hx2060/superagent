# 日程 · 接口说明

版本：`0.3`（PR #3 主干基线 + 清单 / 便签编辑 + 清单任务时间同步）
适用范围：当前静态实现、后续模块与后端对接

本文档说明「日程」当前**已经实现**的模块接口、数据契约与 DOM 契约，以及预留的扩展接口。接口变更必须同步修改本文档，并按 `AGENTS.md` 的规则评审。

## 1. 模块地图

```
src/calendar.js    纯日期 / 网格 / 时间布局函数（无 DOM、无副作用）
src/tasks.js       任务三态与进度统计（无 DOM）
src/data.js        空白种子数据（首次加载无示例内容，可被数据源替换）
src/app.js         应用控制器：状态、视图分发、DOM 事件
src/modules/inbox/ 清单 / 便签编辑模块（store + 面板渲染 + 模块样式）
index.html         页面骨架与工具栏
assets/styles.css  全局与视图样式
```

当前没有构建步骤和运行时依赖；`app.js` 是唯一入口，负责读取 URL、维护 `state`、渲染视图与处理交互。日视图的清单 / 便签面板由 `src/modules/inbox` 挂载（见 3.3 与 4.4）。

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
  date?: string;              // 填写时间时存在：YYYY-MM-DD
  start?: string;             // 可选：HH:mm
  duration?: number;          // 可选：持续分钟，5–720
  end?: string;               // 派生字段：start + duration，仅读取
}
// 不填 date / start / duration 时是未排期 Inbox；填写后绑定该日并同步到日视图时间表。
```

新增任务时 `status = todo`，`icon` 缺省为 `📝`；新增便签时 `tone` 按当天已有便签数量在 `yellow → pink → blue` 间轮换，`tilt` 同步轮换。时间字段可同时缺省；只要填写其一，就必须同时填写 `start` 和 `duration`，并带合法 `date`。

### 2.3 不变量

- `id` 在各自集合内唯一；状态、颜色、便签色调、图标不得使用未知值。
- 日期使用本地时区的 `YYYY-MM-DD`；时间使用 24 小时制 `HH:mm`。
- `start < end`；07:00–21:00 之外的周/日视图内容会被裁切，月视图仍按日期展示。
- 标题、便签、备注按纯文本处理；不要传 HTML，渲染层会转义。
- 月 / 周视图读取事件；日视图读取事件、当天便签、全局任务。
- 任务状态切换顺序固定：`todo → partial → done → todo`；完成进度只统计 `done / total`。
- 清单任务标题 1–80 个字符，便签文本 1–200 个字符；首尾空白会被去掉。
- 任务时间：`start` 为 07:00–20:59 的 `HH:mm`，`duration` 为 5–720 分钟的整数，结束时间不得晚于 21:00（日视图时间表范围）。
- 未填时间的任务不绑定日期，仍是全局 Inbox；填写时间后绑定 `date`，日视图时间表按该日派生事件展示。
- 清单 / 便签的新增、修改、删除只保存在当前页面会话（内存 store），刷新后恢复空白初始状态。

### 2.4 示例数据

`src/data.js` 导出 `sampleEvents`、`sampleNotes`、`sampleTasks`，当前均为空数组：按需求方要求首次加载不显示示例内容，日程 / 清单 / 便签都从空白开始，通过 UI 新增。文件仍保留为数据源替换点；任何示例数据不得包含真实用户隐私、飞书私有内容、凭据或 token。

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

### 3.3 `src/modules/inbox/store.js`

清单与便签的内存 store，纯数据、无 DOM，可在 node:test 中直接测试。

| 导出 | 说明 |
| --- | --- |
| `createInboxStore({ tasks, notes, idFactory? })` | 创建 store；返回的实例见下表 |
| `TASK_TITLE_MAX_LENGTH` / `NOTE_TEXT_MAX_LENGTH` | 80 / 200 |
| `TASK_DURATION_MIN` / `TASK_DURATION_MAX` | 5 / 720 分钟 |
| `TASK_SCHEDULE_START` / `TASK_SCHEDULE_END` | 07:00 / 21:00 对应分钟数；任务开始时间须落在此范围内 |
| `DEFAULT_TASK_ICON` | `📝` |
| `NOTE_TONES` / `NOTE_TILTS` | 便签颜色与倾斜轮换表 |
| `normalizeTaskTitle` / `normalizeNoteText` | 去空白并校验，非法时抛出带 `code` 的 `Error` |

store 方法：

| 方法 | 说明 |
| --- | --- |
| `listTasks()` | 带当前状态的任务副本，按加入顺序；定时任务带派生 `end` |
| `addTask({ title, icon?, date?, start?, duration? })` / `updateTask(id, { title?, icon?, date?, start?, duration? })` / `deleteTask(id)` | 任务增改删；时间字段清空即移出时间表 |
| `taskStatus(id)` / `setTaskStatus(id, status)` / `cycleTaskStatus(id)` | 三态读取、设置、循环 |
| `taskProgress()` | `{ total, todo, partial, done, percent }` |
| `listCalendarEvents(date)` | 把该日定时任务转成时间表事件：`{ id: 'task-event-<id>', title, date, start, end, color: 'teal', icon: 'doc', note: '清单任务 · <状态>' }`；无时间任务不返回 |
| `listNotes(date?)` | 指定日期（缺省全部）的便签副本 |
| `addNote({ date, text })` / `updateNote(id, { text? })` / `deleteNote(id)` | 便签增改删 |
| `subscribe(listener)` | 变更订阅，返回取消函数 |

错误码：`INBOX_TASK_TITLE_INVALID`、`INBOX_NOTE_TEXT_INVALID`、`INBOX_NOTE_DATE_INVALID`、`INBOX_TASK_SCHEDULE_INVALID`、`INBOX_TASK_NOT_FOUND`、`INBOX_NOTE_NOT_FOUND`、`INBOX_TASK_STATUS_INVALID`。

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
| `[data-task-row="<id>"]` | 清单任务行，`data-status` 为当前状态，`data-scheduled` 表示是否同步到时间表 |
| `[data-task-toggle="<id>"]` | 状态切换按钮；点击循环三态 |
| `[data-task-progress-text]` | `done / total 完成` 文本 |
| `[data-task-progress-fill]` | 完成度进度条宽度 |
| `[data-task-live]` | 清单面板内的 `aria-live="polite"` 状态播报区域 |
| `[data-note-row="<id>"]` | 便签卡片 |
| `[data-inbox-add-task]` / `[data-inbox-add-note]` | 打开新增表单 |
| `[data-inbox-edit-task="<id>"]` / `[data-inbox-edit-note="<id>"]` | 进入行内编辑 |
| `[data-inbox-delete-task="<id>"]` / `[data-inbox-delete-note="<id>"]` | 删除；第一次点击变为「确认删除」 |
| `[data-inbox-task-form="new" \| "<id>"]` / `[data-inbox-note-form="new" \| "<id>"]` | 新增 / 编辑表单 |
| `[data-inbox-task-add-start]` / `[data-inbox-task-add-duration]` | 新增任务的开始时间 / 持续分钟（可选） |
| `[data-inbox-task-edit-start]` / `[data-inbox-task-edit-duration]` | 编辑任务的时间字段 |
| `[data-inbox-note-live]` | 便签面板的 `aria-live="polite"` 播报区域 |

### 4.3 任务状态 UI 契约

- 点击 `[data-task-toggle]` 按 `todo → partial → done → todo` 循环。
- 行 `data-status`、按钮 `data-status`、状态文案 `待完成 / 部分完成 / 完成`、进度文本与进度条在同一帧更新。
- 状态变化向 `[data-task-live]` 写入 `「<title>」已标记为<label>`，供读屏器播报。
- 不填时间的任务为未排期 Inbox，不绑定日期；填写时间后绑定日期并同步到该日时间表。

### 4.4 清单 / 便签编辑 UI 契约

- 点击 `[data-inbox-add-task]` / `[data-inbox-add-note]` 打开新增表单；提交后追加到列表末尾，焦点移到新条目。
- 点击 `[data-inbox-edit-task]` / `[data-inbox-edit-note]` 将条目切换为行内表单；保存后回到条目，`Escape` 取消。
- 删除为两步确认：首次点击删除按钮变为「确认删除」，再次点击才执行；`Escape` 或切换其它操作会取消确认。
- 校验失败时表单保持打开，错误信息使用 `role="alert"`；输入框获得焦点。
- 任务与便签面板的整块内容由模块重绘；`[data-task-row]`、`[data-task-toggle]`、进度选择器与 `[data-task-live]` 在重绘后仍然存在。
- 便签文本按纯文本渲染，保留换行；列表为空时显示原有空状态。
- 任务表单的「开始」和「持续（分钟）」均可留空；只填一项会提示错误。填写后行内显示时间，且日视图时间表追加对应事件；清空两项即移出时间表。
- 新增定时任务使用当前日视图日期；编辑已有定时任务时保留原日期（当前没有改日期入口）。定时任务仍显示在全局清单，只在所属日期的时间表出现。
- 时间表事件由 `services.inbox.listCalendarEvents(date)` 派生，主干 store 订阅后局部刷新时间表，不重挂侧栏；重叠事件按 `layoutOverlaps` 分列显示。

## 5. 扩展接口

### 5.1 模块契约（inbox 模块已落地，其余为预留）

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
  data: { events: CalendarEvent[]; notes: StickyNote[]; tasks: Task[] };
  services: Record<string, Function>;         // 当前已有 services.inbox（见 3.3）
}
```

约束见 `AGENTS.md`：模块样式加 `.mod-<name>-` 前缀、不跨模块 import、不直接改全局状态、共享能力走 services。日视图目前以 `<aside class="day-sidebar" data-module-root="inbox">` 作为 inbox 模块注册点；新增模块应复用最小注册点 / services 模式，并更新本文档。

### 5.2 数据源契约（建议，尚未实现）

当前应用同步读取静态数组。接入后端时，建议实现以下接口（**尚未实现**）：

```ts
interface CalendarDataSource {
  listEvents(range: { from: string; to: string }): Promise<CalendarEvent[]>;
  listNotes(date: string): Promise<StickyNote[]>;
  listTasks(): Promise<Task[]>;
  updateTaskStatus(id: string, status: TaskStatus): Promise<Task>;
  createTask(input: { title: string; icon?: string; date?: string; start?: string; duration?: number }): Promise<Task>;
  updateTask(id: string, input: { title?: string; icon?: string; date?: string; start?: string; duration?: number }): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  createNote(input: { date: string; text: string }): Promise<StickyNote>;
  updateNote(id: string, input: { text: string }): Promise<StickyNote>;
  deleteNote(id: string): Promise<void>;
}
```

后端映射、异步加载、错误回滚与乐观更新见 `docs/integration.md`。

## 6. 版本与兼容

- 当前接口版本 `0.3`；`0.3` 在 `0.2` 基础上增量加入任务可选时间字段与日视图时间表同步，已发布字段与稳定选择器保持不变。
- 新增字段必须可选，渲染层对未知可选字段保持忽略。
- 颜色 / 图标 / 状态枚举新增时，需要同时补样式与回退；删除或重命名属于 breaking change。
- 破坏性接口变更必须升级版本、更新本文档与 `docs/integration.md`，并在 PR 中明确迁移方案。
