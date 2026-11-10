# 日程 · 接口说明

版本：`0.8`（PR #3 主干基线 + 每日任务 + 清单 / 便签编辑 + 周图任务 × 时间方块 + 月 / 周 / 日任务统一 + 本地内容与添加接口 + 当日计划 / 收集区分区 + 逾期回顾区 + 全天任务 + 蓄水池（attention-switch）多档选项池 + 月视图跨天长条）
适用范围：当前静态实现、后续模块与后端对接

本文档说明「日程」当前**已经实现**的模块接口、数据契约与 DOM 契约，以及预留的扩展接口。接口变更必须同步修改本文档，并按 `AGENTS.md` 的规则评审。

## 1. 模块地图

```
src/calendar.js    纯日期 / 网格 / 时间布局函数（无 DOM、无副作用）
src/tasks.js       任务三态与进度统计（无 DOM）
src/data.js        空白种子数据（首次加载无示例内容，可被数据源替换）
src/app.js         应用控制器：状态、视图分发、DOM 事件、window.schedule
src/modules/daily-tasks/
                   每日重复任务模块：store、日视图 UI、模块测试
src/modules/inbox/ 清单 / 便签编辑模块：store、面板渲染、时间表事件派生、样式
src/modules/week-chart/
                   周视图任务 × 时间方块模块：纯几何、渲染、状态切换、测试
src/modules/attention-switch/
                   蓄水池模块：store、常驻面板 UI（三档选项 / 录入 / 从清单加入）、模块测试
index.html         页面骨架、工具栏与模块样式入口
assets/styles.css  全局与视图样式
```

当前没有构建步骤和运行时依赖；`app.js` 是唯一入口，负责读取 URL、维护 `state`、渲染视图与处理交互。页面启动时先尝试读取可选的本地内容文件 `local/schedule.json`（不提交仓库），缺失时使用 `src/data.js` 的空白种子。日视图挂载 `daily-tasks` 与 `inbox` 模块，周视图挂载 `week-chart` 模块；三者分别通过 `services.dailyTasks` / `services.inbox` 共享状态。`attention-switch` 的根节点在页面骨架中常驻（`#view-root` 之外），只挂载一次，通过 `services.pool` 共享状态。

### 1.1 接口分层与兼容原则

**稳定接口**（后续模块 / 自动化可依赖）：

- 数据契约：`CalendarEvent`、`StickyNote`、`Task`、`DailyTask` 及枚举；
- 模块契约：`mount(context)` 的 `context` 形状、返回的 `destroy()` / 可选 `update()`；
- 共享服务：`services.dailyTasks`、`services.inbox` 的方法与错误码；
- DOM 契约：本文件 4.2 列出的稳定选择器；
- URL 参数与 `window.schedule` 的已发布方法。

**内部实现**（不属于稳定接口）：

- `src/app.js` 内部的 `state`、视图变量、渲染函数与事件处理；
- 模块内部的 DOM 结构、类名、状态变量与 store 实现；
- 模块之间的直接 import。

兼容原则：新增数据字段必须可选；新增 service 键必须可选；新增选择器使用命名空间并保留既有选择器；模块不得依赖其它模块的内部文件。破坏性变更必须升级接口版本并在 PR 中给出迁移方案。

## 2. 数据契约

### 2.1 枚举

| 名称 | 取值 | 说明 |
| --- | --- | --- |
| `ViewKind` | `month` / `week` / `day` | 当前视图 |
| `EventColor` | `blue` / `teal` / `orange` / `violet` | 事件颜色，对应月/周/日样式 |
| `EventIcon` | `sun` / `doc` / `activity` / `search` / `users` / `link` / `chat` / `refresh` / `book` / `map` | 日视图时间轴图标 |
| `NoteTone` | `yellow` / `pink` / `blue` | 便签纸颜色 |
| `TaskStatus` | `todo` / `partial` / `done` | 待完成 / 部分完成 / 完成 |
| `DailyTaskRecurrence` | `daily` | 每日任务固定每天重复 |
| `PoolSource` | `course` / `paper` / `web` / `work` / `chore` | 蓄水池条目来源：网课 / 论文 / 网页 / 工作 / 杂事 |
| `PoolTier` | `leisure` / `browse` / `deep` | 蓄水池三档学习状态：娱乐性学习 / 简单看过 / 理解学习 |

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
  id: string;                 // 集合内唯一；本地种子建议必填，运行时 add 可省略
  title: string;              // 纯文本
  icon: string;               // emoji 字符，例如 "📝"
  status: TaskStatus;         // 初始状态；运行时 add 固定 todo
  date?: string;              // 填写时间时存在：YYYY-MM-DD
  start?: string;             // 可选：HH:mm
  duration?: number;          // 可选：持续分钟，5–720
  end?: string;               // 派生字段：start + duration，仅读取
  due?: string;               // 可选：YYYY-MM-DD，截止日期；不得早于 date
}
// 不填 date / due 时是未排期 Inbox（收集区）；填写 date 后绑定该日并同步到日视图
// 当日计划、周图与月视图。date 不带 start / duration 时为全天任务（进当日计划与
// 周 / 月视图，不进时间表）。due 在截止日进入月视图与周图；due 晚于 date 时周图
// 方块从 date 跨到 due，月视图把跨天窗口画成一条按周行裁剪的长条。

interface DailyTask {
  id: string;                 // 集合内唯一
  title: string;              // 纯文本，1–80 字符
  icon?: string;              // 缺省 🔁；最多 8 个 code point
  recurrence: 'daily';        // 固定每日重复，不绑定具体日期
}
// 每日任务是重复定义，不进入时间表；完成状态按日期单独记录：
// statuses[YYYY-MM-DD][taskId] = TaskStatus，缺省 todo。

interface PoolItem {
  id: string;                 // 集合内唯一
  title: string;              // 纯文本，1–80 字符
  url?: string;               // http(s) 链接；省略时条目只有详情，点击展开而非打开
  source: PoolSource;         // 来源；网课最多
  tiers: PoolTier[];          // 非空、去重；一条目可属多档
  note?: string;              // 纯文本，最多 200 字符
  createdAt: string;          // YYYY-MM-DD
}
// 蓄水池（attention-switch 模块）是独立实体，与 Task / DailyTask 并列：
// 不绑定日期、不进时间表 / 周图 / 月视图，也不与清单任务同步状态。
```

新增任务时 `status = todo`，`icon` 缺省为 `📝`；时间字段可同时缺省；只要填写其一，就必须同时填写 `start` 和 `duration`，并带合法 `date`；`due` 可独立缺省，填写时必须是合法日期。新增便签时 `tone` 按当天已有便签数量在 `yellow → pink → blue` 间轮换，`tilt` 同步轮换。

**每日任务与 Inbox 的关系**：`Task` 填时间后进入**当日计划**；无日期无截止的任务留在**收集区**（未排期，随时可完成，不计入日进度）。`DailyTask` 是每天重新出现的重复任务，状态按日期隔离，不占用时间表。两组任务共用 `TaskStatus` 枚举与循环顺序。

### 2.3 不变量

- `id` 在各自集合内唯一；状态、颜色、便签色调、图标不得使用未知值。
- 日期使用本地时区的 `YYYY-MM-DD`；时间使用 24 小时制 `HH:mm`。
- `start < end`；日视图时间表裁切到 07:00–21:00，周图方块按天定位、不按小时裁切，月视图仍按日期展示。
- 标题、便签、备注按纯文本处理；不要传 HTML，渲染层会转义。
- 月 / 周 / 日视图读取同一份清单任务与事件；日视图还读取当天便签与每日任务定义。
- **任务占据的日期**由 `src/tasks.js` 的共享纯函数统一计算（`taskWindow` / `taskDayEntry` / `taskReviewGroups`），月视图 chip、周图方块、日视图当日计划三处消费同一答案，不得在视图内另写一套。
- 周图一个任务一行（定时日程也各占一行）：定时任务占开始当天，带 `due` 时从 `date` 跨到截止日；仅截止任务从今天画到截止日（截止日已过时占截止当天）；方块内显示准确时间或截止日。
- 月视图分两种画法，都由 `taskWindow` 派生：**单日任务**（`date` 当天，含 `due` 与 `date` 同日、截止已过收敛到截止当天）显示任务 chip，`due` 与 `date` 不同日时截止日额外显示「截止」chip；**跨天任务**（窗口首尾不同日，含仅截止且截止未到的任务从今天起算）改画**跨天长条**，按周行裁剪、同周行按车道堆叠（最多 3 条，超出的段计入当日「+N 项」），长条内显示任务标题，颜色随任务状态。跨天任务不再在首尾两天各放 chip。
- **当日计划**（日视图「清单」上半区）成员：截止日 = 当天、排期日 = 当天、或未完成且当天落在任务占据区间内（`taskDayEntry(...).inPlan`）。逾期未完成（截止已过且未完成）不再进入后续日期的计划，改由周 / 月「逾期回顾区」呈现。
- **日进度**只统计当日计划成员（当日需要完成 + 未来截止未完成）；收集区与逾期任务不计入。跨天后当日计划自动滚动。
- **逾期回顾区**（周视图图表上方、月视图网格上方横幅）：截止已过且未删除的任务，分「逾期未完成 / 已完成」两组，保留至删除，可切换状态，不计入周进度分母。
- 任务状态切换顺序固定：`todo → partial → done → todo`；完成进度只统计 `done / total`。
- 清单任务标题 1–80 个字符，便签文本 1–200 个字符；首尾空白会被去掉。
- 任务时间：`start` 为 07:00–20:59 的 `HH:mm`，`duration` 为 5–720 分钟的整数，结束时间不得晚于 21:00。
- 任务截止日期：`due` 可选，必须是真实的 `YYYY-MM-DD`，且**不得早于任务日期 `date`**（写入时抛 `INBOX_TASK_DUE_INVALID`；本地种子中的矛盾数据按 `date` 当天呈现，不报错）。
- `date` 不带 `start` / `duration` 即全天任务：进入当日计划与周 / 月视图，不进时间表；`start` 与 `duration` 必须成对出现。
- 清空 `start` / `duration` 而保留 `date` = 变为当天全天任务；显式传 `date: ''` = 回到收集区（未排期）。
- `DailyTask.recurrence` 固定为 `daily`；定义没有日期字段，日期只用于读取/写入当天的完成状态；跨天默认回到 `todo`。
- 每日任务只在日视图展示和手工添加；月 / 周视图不展示每日任务条。清单任务按日期进入月 / 周视图，两者共用同一份 store。
- `PoolItem.tiers` 非空且只含已知档位（写入时抛 `POOL_TIER_INVALID`）；`url` 必须是 `http(s)://` 开头（`POOL_URL_INVALID`）；`createdAt` 必须是真实日期键，缺省取当天。
- 蓄水池条目的增改删只存当前页面会话；刷新后回到 `local/schedule.json` 的 `pool` 初值；「从清单加入」是单向快照，之后池与清单互不影响。
- 清单 / 便签的新增、修改、删除只保存在当前页面会话（内存 store）；刷新后回到本地内容文件 / 空白种子的初始状态。

### 2.4 示例数据

`src/data.js` 导出 `sampleEvents`、`sampleNotes`、`sampleTasks`、`sampleDailyTasks`，当前均为空数组：按需求方要求首次加载不显示示例内容，日程 / 清单 / 便签 / 每日任务都从空白开始，通过 UI 新增。文件仍保留为数据源替换点；任何示例数据不得包含真实用户隐私、飞书私有内容、凭据或 token。

`sampleDailyTasks` 是每日任务的定义入口。具体日程内容存放在 **`local/schedule.json`**（已被 `.gitignore` 忽略，不提交仓库）：页面启动时读取其中的 `events` / `notes` / `tasks` / `dailyTasks`，缺失或损坏时回退到上述空白数组。应用不会写回本地文件；运行时新增只存在当前页面会话。

仓库与 PR 不提交截图；视觉证据按 `docs/mechanism-handoff.md` 只保留在本地。

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
| `layoutOverlaps(events)` | CalendarEvent[] | Map<id, {column, columns}> | 重叠事件的并排列（周 / 日视图共用） |
| `weekEventStyle(event, options?)` | CalendarEvent, object | {top, height} \| null | 旧版周视图纵向坐标，保留兼容；当前周图使用 `src/modules/week-chart/chart.js` |

常量：`WEEKDAY_LABELS`、`WEEKDAY_FULL`、`WEEK_GRID_START_HOUR = 7`、`WEEK_GRID_END_HOUR = 21`、`WEEK_GRID_HOUR_HEIGHT = 44`。

### 3.2 `src/tasks.js`

| 导出 | 说明 |
| --- | --- |
| `TASK_STATUS_ORDER` | `['todo', 'partial', 'done']` |
| `TASK_STATUS_LABELS` | `{ todo: '待完成', partial: '部分完成', done: '完成' }` |
| `nextTaskStatus(status)` | 返回循环中的下一状态；未知状态回退到 `todo` |
| `taskStatusCounts(tasks, statuses)` | `{ total, todo, partial, done, percent }`，`percent` 取整 |
| `taskWindow(task, todayKey)` | 任务占据的日期窗口 `{ startKey, endKey, dateKey, dueKey }`；仅截止任务在截止未到时从今天起算，已过时占截止当天；无日期无截止返回 `null` |
| `taskDayEntry(task, dateKey, todayKey)` | 任务在某天的计划成员与状态 `{ inPlan, dueOnDay, scheduledOnDay, overdue, done }`；月 / 周 / 日三视图共用 |
| `taskReviewGroups(tasks, todayKey)` | 逾期回顾分组 `{ overdue, completed }`：截止已过且未删除的任务，按是否完成分两组 |
| `taskMonthAnchors(task, todayKey)` | 月视图 chip 锚点（由 `taskWindow` 派生）：单日任务一个锚点，跨天任务首尾两天（跨天任务改画长条，一般不再使用） |
| `monthSpanBars(tasks, days, todayKey, options?)` | 月视图跨天长条 `{ bars, overflow }`：窗口跨多天的任务按周行裁剪成段，每段带 `{ id, title, status, startKey, endKey, dueKey, overdue, row, startCol, endCol, lane, openDate, clippedStart, clippedEnd }`；`options.maxLanes` 缺省 3，同周行放不下的段进 `overflow`（不计 lane）；单日任务不产生长条 |

`statuses` 是 `Map<taskId, TaskStatus>`，允许覆盖任务初始状态。`taskWindow` / `taskDayEntry` / `taskReviewGroups` 是「任务出现在哪些天、算什么状态」的唯一口径：视图只决定画法（chip / 跨天长条 / 方块 / 列表行），不得另写一套日期逻辑。

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
| `normalizeTaskTitle` / `normalizeTaskDue` / `normalizeNoteText` | 去空白并校验，非法时抛出带 `code` 的 `Error` |

store 方法：

| 方法 | 说明 |
| --- | --- |
| `listTasks()` | 带当前状态的任务副本，按加入顺序；定时任务带派生 `end` |
| `listUnscheduledTasks()` | 收集区任务副本：无 `date` 且无 `due` |
| `addTask({ id?, title, icon?, date?, start?, duration?, due? })` / `updateTask(id, { title?, icon?, date?, start?, duration?, due? })` / `deleteTask(id)` | 任务增改删；`id` 可显式指定（须唯一），否则自动生成；`date` 不带时间 = 全天任务；清空时间保留 `date` = 变全天；`date: ''` = 回到收集区；`due` 传空即清除截止日期；`due` 早于 `date` 抛 `INBOX_TASK_DUE_INVALID` |
| `taskStatus(id)` / `setTaskStatus(id, status)` / `cycleTaskStatus(id)` | 三态读取、设置、循环 |
| `taskProgress()` | 全部任务的 `{ total, todo, partial, done, percent }`（日视图进度改用 `taskStatusCounts(当日计划, …)`，见 4.3） |
| `listCalendarEvents(date)` | 把该日定时任务转成时间表事件：`{ id: 'task-event-<id>', title, date, start, end, color: 'teal', icon: 'doc', note: '清单任务 · <状态>' }`；无时间任务（含全天）不返回 |
| `listNotes(date?)` | 指定日期（缺省全部）的便签副本 |
| `addNote({ date, text })` / `updateNote(id, { text? })` / `deleteNote(id)` | 便签增改删 |
| `subscribe(listener)` | 变更订阅，返回取消函数 |

错误码：`INBOX_TASK_TITLE_INVALID`、`INBOX_NOTE_TEXT_INVALID`、`INBOX_NOTE_DATE_INVALID`、`INBOX_TASK_SCHEDULE_INVALID`、`INBOX_TASK_DUE_INVALID`、`INBOX_TASK_DUPLICATE_ID`、`INBOX_TASK_NOT_FOUND`、`INBOX_NOTE_NOT_FOUND`、`INBOX_TASK_STATUS_INVALID`。

### 3.4 `src/modules/daily-tasks/store.js`

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

### 3.5 `src/modules/week-chart/chart.js`

周图的纯几何与行模型（无 DOM）。方块按**天**定位：任务从 `date` 到 `due`（含）跨天；仅截止任务从今天（或可见周起点）画到截止日，截止日已过时占截止当天；准确时间显示在方块文本与行标签里。

| 导出 | 说明 |
| --- | --- |
| `taskChartBar(task, weekStartKey, todayKey?)` | 计算任务方块的 `{ left, width, startDay, endDay, openDate, clippedStart, clippedEnd, label }`；起止日来自共享的 `taskWindow`：仅截止任务以 `todayKey` 为起点画到截止日，`todayKey` 缺省或截止日已过时占截止当天；无日期 / 截止或完全不在本周返回 `null` |
| `eventChartBar(event, weekStartKey)` | 计算定时日程方块（占一天）；时间非法或不在本周返回 `null` |
| `buildWeekChart({ anchor, tasks, events, today })` | 返回 `{ days, rows, review, summary }`；`rows` 按开始位置排序，`review` 为逾期回顾分组 `{ overdue, completed }`（与月视图共用，不计入 `summary`），`summary` 为本周任务完成进度 |

`left` / `width` 是整周轨道的 0–1 比例；`days[].isToday` 标记今天；任务行的 `status` / `overdue` 供 UI 使用。周图只读 `services.inbox` 的任务与 `context.data.events`，不维护第二份任务数据。

### 3.6 `src/modules/attention-switch/store.js`

蓄水池的纯逻辑 store（无 DOM）。模块入口 `index.js` 重新导出以下函数，宿主与测试都从模块入口导入。

| 导出 | 说明 |
| --- | --- |
| `POOL_SOURCES` / `POOL_TIERS` | `course\|paper\|web\|work\|chore` / `leisure\|browse\|deep` |
| `POOL_SOURCE_LABELS` / `POOL_TIER_LABELS` | 中文展示名（网课 / 论文 / 网页 / 工作 / 杂事；娱乐性学习 / 简单看过 / 理解学习） |
| `POOL_TITLE_MAX_LENGTH` / `POOL_NOTE_MAX_LENGTH` / `POOL_DEFAULT_OPTION_COUNT` | 80 / 200 / 5 |
| `normalizePoolItem(input, options?)` | 校验并规范化；非法时抛带 `code` 的 `Error`（`options.createId` / `options.now` 供测试注入） |
| `createPoolStore(seedItems, options?)` | 创建 store；种子中的坏条目跳过不抛错 |

store 方法：`addItem` / `updateItem` / `deleteItem` / `listItems` / `listByTier(tier)` / `optionsFor(tier, count?)` / `markUsed(id)` / `subscribe(listener)`。`optionsFor` 的排序为会话内未取用过优先、同级按加入时间倒序（暂定规则，留空间供后续调整）。`markUsed` 只写会话内标记、不产生历史。错误码：`POOL_TITLE_INVALID` / `POOL_URL_INVALID` / `POOL_SOURCE_INVALID` / `POOL_TIER_INVALID` / `POOL_NOTE_INVALID` / `POOL_DUPLICATE_ID` / `POOL_NOT_FOUND`。

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
| `[data-open-date="YYYY-MM-DD"]` | 任意日期入口（月格、周表头 / 周图方块、日视图周条），点击进入该日的日视图 |
| `[data-task-row="<id>"]` | 清单任务行，`data-status` 为当前状态，`data-scheduled` 表示是否同步到时间表；`data-all-day="true"` 表示全天任务 |
| `[data-task-due="YYYY-MM-DD"]` | 清单任务行内的截止日期标签，仅在任务带 `due` 时出现 |
| `[data-inbox-section="plan" \| "collect"]` | 日视图清单面板的「当日计划 / 收集区」两个分区 |
| `[data-inbox-task-add-allday]` / `[data-inbox-task-edit-allday]` | 新增 / 编辑任务的「全天」勾选框 |
| `[data-task-flag="due-today" \| "overdue"]` | 当日计划行内的「今日到期 / 逾期未完成」标记 |
| `[data-task-toggle="<id>"]` | 状态切换按钮；点击循环三态（清单、周图、周 / 月逾期回顾区均使用） |
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
| `[data-module-root="daily-tasks"]` | 日视图中的每日任务模块槽位 |
| `[data-daily-task-row="<id>"]` | 每日任务胶囊行，`data-status` 为当天状态 |
| `[data-daily-tasks-toggle="<id>"]` | 每日任务状态切换按钮；点击循环三态 |
| `[data-daily-tasks-add-toggle]` | 手工添加入口，`aria-expanded` 表示表单是否展开 |
| `[data-daily-tasks-form]` | 手工添加表单；收起时带 `hidden` |
| `[data-daily-tasks-input]` | 任务名称输入框，`maxlength=80` |
| `[data-daily-tasks-progress]` | 当天 `done / total 完成` 文本 |
| `[data-daily-tasks-live]` | 每日任务状态播报区域 |
| `[data-module-root="week-chart"]` | 周视图中的周图模块槽位 |
| `[data-week-chart-row="<id>"]` | 周图任务 / 日程行；`data-kind` 为 `task` 或 `event`，任务行带 `data-status` |
| `[data-week-chart-bar]` | 周图方块；`data-open-date` 指向开始 / 截止日 |
| `[data-week-chart-review]` | 周视图逾期回顾区（截止已过且未删除的任务） |
| `[data-week-chart-review-row="<id>"]` | 逾期回顾行；`data-status` 为当前状态，可切换三态 |
| `[data-review-group="overdue" \| "completed"]` | 回顾区内的「逾期未完成 / 已完成」分组（周图与月视图通用） |
| `[data-week-chart-progress]` | 本周 `done / total 完成` 文本（只统计本周可见行，不含回顾区） |
| `[data-week-chart-live]` | 周图状态播报区域 |
| `[data-pool-toggle]` | 顶栏常驻「蓄水池」入口按钮；`aria-expanded` 表示面板开合 |
| `[data-module-root="attention-switch"]` | 蓄水池面板根（页面级、常驻＋ `hidden` 控制可见性） |
| `[data-attention-switch-tier]` | 三档学习状态切换（值为 `leisure\|browse\|deep`），`aria-pressed` 表示当前档 |
| `[data-attention-switch-option="<id>"]` | 选项行 |
| `[data-attention-switch-open="<id>"]` | 选项主按钮；有链接新标签页打开，无链接展开详情 |
| `[data-attention-switch-edit="<id>"]` / `[data-attention-switch-delete="<id>"]` | 编辑 / 两步删除（删除确认时 `data-armed="true"`） |
| `[data-attention-switch-add-toggle]` / `[data-attention-switch-import-toggle]` | 「录入」/ 「从清单加入」开关 |
| `[data-attention-switch-form]` / `[data-attention-switch-input]` | 录入 / 编辑表单与其字段（`title` / `url` / `source` / `tier` / `note`） |
| `[data-attention-switch-import-row]` / `[data-attention-switch-import-pick="<id>"]` | 从清单加入的任务行与入池按钮 |
| `[data-attention-switch-live]` | 蓄水池面板的 `aria-live="polite"` 播报区域 |
| `[data-month-review]` | 月视图逾期回顾横幅（主干渲染，可用 `[data-task-toggle]` 切换状态） |
| `[data-review-item="<id>"]` | 月视图回顾横幅内的任务胶囊 |
| `[data-month-span-bar]` | 月视图跨天长条；`data-open-date` 指向该段起始日（点击进入日视图） |

### 4.3 任务状态 UI 契约

- 点击 `[data-task-toggle]` 按 `todo → partial → done → todo` 循环。
- 行 `data-status`、按钮 `data-status`、状态文案 `待完成 / 部分完成 / 完成`、进度文本与进度条在同一帧更新。
- 状态变化向 `[data-task-live]` 写入 `「<title>」已标记为<label>`，供读屏器播报；周图对应写入 `[data-week-chart-live]`。
- 不填日期与截止的任务属于收集区（未排期，不计入日进度）；填时间后绑定日期并同步到当日计划、时间表、周图与月视图；只填日期为全天任务。
- 带 `due` 的任务行在状态文案下显示「截止 11月8日 周日」；截止日期不改变状态、进度或时间表，但会在周图 / 月视图的截止日出现。
- 月视图跨天长条（`[data-month-span-bar]`）只负责进入日视图（`data-open-date` 指向该段起始日），不带状态切换；状态切换沿用清单 / 周图 / 回顾横幅的 `[data-task-toggle]`。长条按任务状态着色（待完成蓝 / 部分完成橙 / 完成青，逾期红），探出周行的一侧为方角。
- 周图任务行的状态切换与清单一致，按 `todo → partial → done → todo` 循环；`[data-week-chart-progress]` 与进度条同帧更新。

### 4.4 每日任务 UI 契约

- 仅在日视图出现；进入日视图时挂载，离开 / 重绘时卸载。
- 点击 `[data-daily-tasks-toggle]` 只更新当前锚点日期的状态，按 `todo → partial → done → todo` 循环；跨日导航后同一任务默认回到 `todo`。
- 行 `[data-daily-task-row]` 的 `data-status`、胶囊文案、`[data-daily-tasks-progress]` 与进度条宽度同帧更新。
- `[data-daily-tasks-add-toggle]` 展开 / 收起 `[data-daily-tasks-form]`；提交成功后表单收起、定义追加；空 / 超长标题留在表单内并显示 `role="alert"` 错误。
- 手工添加只填标题，图标使用默认 `🔁`；dsh 可通过运行时 API 指定 `icon`。
- 状态变化 / 新增向 `[data-daily-tasks-live]` 写入中文播报；`Esc` 收起添加表单。
- 每日任务条不进入月 / 周视图，不写入时间表。

### 4.5 清单 / 便签编辑 UI 契约

- 「清单」面板分两个分区：**当日计划**（`[data-inbox-section="plan"]`，成员规则见 2.3）与**收集区**（`[data-inbox-section="collect"]`，未排期任务）。面板头部进度只统计当日计划。
- 点击 `[data-inbox-add-task]` / `[data-inbox-add-note]` 打开新增表单；提交后追加到对应分区，焦点移到新条目。
- 新增 / 编辑任务支持三种排期：填「开始 + 持续」= 定时任务；勾选「全天」= 当天天全天任务（隐藏时间字段）；两者都不填 = 放入收集区。编辑已有任务时取消「全天」并清空时间 = 放回收集区。
- 点击 `[data-inbox-edit-task]` / `[data-inbox-edit-note]` 将条目切换为行内表单；保存后回到条目，`Escape` 取消。
- 删除为两步确认：首次点击删除按钮变为「确认删除」，再次点击才执行；`Escape` 或切换其它操作会取消确认。
- 校验失败时表单保持打开，错误信息使用 `role="alert"`；输入框获得焦点。
- 任务与便签面板的整块内容由模块重绘；`[data-task-row]`、`[data-task-toggle]`、进度选择器与 `[data-task-live]` 在重绘后仍然存在。
- 便签文本按纯文本渲染，保留换行；列表为空时显示原有空状态。
- 任务表单的「开始」和「持续（分钟）」均可留空；只填一项会提示错误。定时任务行内显示时间，且日视图时间表、周图与月视图同步追加；清空两项（保留日期）变为全天任务，移出时间表但保留在日 / 周 / 月视图。
- 新增任务使用当前日视图日期；编辑已有任务时保留原日期（当前没有改日期入口）。当日计划行带 `[data-task-flag]` 标记「今日到期 / 逾期未完成」（后者仅在回顾历史日期时出现）。
- 时间表事件由 `services.inbox.listCalendarEvents(date)` 派生，主干 store 订阅后局部刷新周条与时间表，不重挂侧栏；重叠事件按 `layoutOverlaps` 分列显示。
- 截止日期通过种子数据或 `services.inbox.addTask / updateTask` 的 `due` 写入并在行内展示；当前新增 / 编辑表单不提供日期输入，也不支持在 UI 内修改或清除已有截止日期（写入时校验 `due ≥ date`）。
- **逾期回顾区**：周视图图表上方与月视图网格上方横幅展示截止已过的任务（`[data-review-group]` 分「逾期未完成 / 已完成」），可点 `[data-task-toggle]` 切换状态、点标题跳到截止日；保留至删除，不计入周 / 日进度。

### 4.6 蓄水池 UI 契约

- 入口常驻顶栏（任何视图可用）；面板为模态层，`role="dialog"`。
- 点入口开面板；关闭按钮 / 背景 / `Escape` 关面板，焦点回入口按钮。`Escape` 依次收起表单 / 导入列表 / 面板。
- 三档切换显示该档选项（缺省 5 个）；有链接的选项点击新标签页打开并标记取用（排序置后）；无链接的展开详情。
- 三种录入形式：面板表单、`window.schedule.pool.add`、本地内容文件的 `pool` 键；修改 / 删除只存当前会话，刷新回本地初值。
- 「从清单加入」只读 `services.inbox` 的任务列表；单向联动，池内容不回写清单。
- 面板打开时，方向键 / `T` / `M` / `W` / `D` 不驱动日历导航。
- 校验失败时表单保持打开，错误信息 `role="alert"`，标题框获焦点。

## 5. 扩展接口

### 5.1 模块契约

视图模块统一导出 `mount(context)`；模块只能操作 `context.root` 内部，通过 `context.services` 读写共享状态。当前日视图挂载 `daily-tasks` / `inbox`，周视图挂载 `week-chart`。

```ts
type ViewKind = 'month' | 'week' | 'day';

interface ModuleContext<Data = unknown, Services = Record<string, unknown>> {
  root: HTMLElement;
  state: Readonly<{ view: ViewKind; anchor: Date }>;
  data: Readonly<Data>;
  services: Readonly<Services>;
}

interface ModuleHandle {
  update?(nextContext: ModuleContext): void;   // 保留；当前主干在视图切换时 destroy + 重新 mount
  destroy(): void;
}

interface ScheduleModule<Data, Services> {
  mount(context: ModuleContext<Data, Services>): ModuleHandle;
}
```

生命周期：

| 阶段 | 调用方 | 要求 |
| --- | --- | --- |
| `mount(context)` | `app.js` 视图渲染后 | 只读写 `root` 内部；在 root 上挂监听；返回 `destroy`；不得改 `state` / `data` / 其它模块 DOM |
| `update(nextContext)` | 预留 | 可选；当前主干不调用，视图切换会先 `destroy` 再重新 `mount` |
| `destroy()` | 切换视图 / 重渲染前 | 移除 root 内监听、定时器与订阅；清空 root；不留下全局副作用 |

`data` 是只读快照，可能落后于 service；需要实时数据时调用 `services.*` 的读取方法。`subscribe()` 回调当前是同步触发的；接入异步数据源时需先更新 store，再通知订阅者。

当前模块与注册点：

| 模块 | 槽位 | 共享服务 | 数据快照 | 样式入口 |
| --- | --- | --- | --- | --- |
| `daily-tasks` | 日视图 `<div data-module-root="daily-tasks"></div>` | `services.dailyTasks` | `data.dailyTasks` | `daily-tasks/styles.css` |
| `inbox` | 日视图 `<aside class="day-sidebar" data-module-root="inbox"></aside>` | `services.inbox` | `data.notes` / `data.tasks` | `inbox/styles.css` |
| `week-chart` | 周视图 `<div class="mod-week-chart-root" data-module-root="week-chart"></div>` | `services.inbox` | `data.events` / `data.tasks` | `week-chart/styles.css` |
| `attention-switch` | 页面级 `<div id="pool-panel" data-module-root="attention-switch" hidden></div>`（常驻，只挂载一次） | `services.pool`（只读 `services.inbox`） | `data.pool` | `attention-switch/styles.css` |

`InboxService`（`services.inbox`，与 3.3 方法一致）：

```ts
interface InboxService {
  listTasks(): Task[];
  listUnscheduledTasks(): Task[];
  addTask(input: { id?: string; title: string; icon?: string; date?: string; start?: string; duration?: number; due?: string }): Task;
  updateTask(id: string, input: { title?: string; icon?: string; date?: string; start?: string; duration?: number; due?: string }): Task;
  deleteTask(id: string): Task;
  taskStatus(id: string): TaskStatus;
  setTaskStatus(id: string, status: TaskStatus): TaskStatus;
  cycleTaskStatus(id: string): TaskStatus;
  taskProgress(): { total: number; todo: number; partial: number; done: number; percent: number };
  listCalendarEvents(date: string): CalendarEvent[];
  listNotes(date?: string): StickyNote[];
  addNote(input: { date: string; text: string }): StickyNote;
  updateNote(id: string, input: { text?: string }): StickyNote;
  deleteNote(id: string): StickyNote;
  subscribe(listener: () => void): () => void;
}
```

`DailyTasksService`（`services.dailyTasks`，与 3.4 方法一致）：

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

`PoolService`（`services.pool`，与 3.6 方法一致）：

```ts
interface PoolService {
  addItem(input: { id?: string; title: string; url?: string; source: PoolSource; tiers: PoolTier[]; note?: string }): PoolItem;
  updateItem(id: string, changes: { title?: string; url?: string; source?: PoolSource; tiers?: PoolTier[]; note?: string }): PoolItem;
  deleteItem(id: string): PoolItem;
  listItems(): PoolItem[];
  listByTier(tier: PoolTier): PoolItem[];
  optionsFor(tier: PoolTier, count?: number): PoolItem[];
  markUsed(id: string): void;
  subscribe(listener: (change: object) => void): () => void;
}
```

服务错误约定：同步方法非法输入时抛出带 `code` 的 `Error`；成功变更后同步通知 `subscribe` 监听器；返回值是数据副本，调用方不得持有并修改 store 内部对象。`services.inbox.subscribe` 的回调没有参数；`services.dailyTasks.subscribe` 的回调接收一个 `change` 对象（当前实现用于通知变更，订阅方不应依赖未写入契约的字段）。

#### 5.1.1 新增一个视图模块

当前主干的注册是显式的（每个模块一处 import、一处 `mount` / `destroy`、一个槽位、一条样式）：

1. 新建 `src/modules/<name>/{index.js,README.md,styles.css,__tests__/}`。
2. `index.js` 导出 `mount(context)`，返回 `destroy()`；只操作 `root`，监听器在 `destroy` 中移除。
3. 需要共享状态时，先提案最小 service：在 `app.js` 创建 store、作为可选键加入 `services`，并在本文档补接口；不需要共享状态时只用 `data` 快照。
4. 在对应视图渲染函数（`renderDay()` / `renderWeek()`）增加一行模块槽位（如 `<div data-module-root="<name>"></div>`），在 `render()` 中对应分支 mount、切走时 destroy；不要改其它模块槽位。
5. 在 `index.html` 增加一行模块样式 `<link>`；类名统一 `.mod-<name>-`。
6. 补 store / 纯逻辑的 node:test、1440 / 1024 / 768 / 390 的本地验证证据（保存在 `local/evidence/`，不入仓库）和本文档更新。

最小模块骨架：

```js
export function mount({ root, state, data, services }) {
  function render() {
    root.innerHTML = `<div class="mod-example">...</div>`;
  }
  root.addEventListener('click', onClick);
  function onClick() {}
  render();
  return {
    update: render,
    destroy() {
      root.removeEventListener('click', onClick);
      root.innerHTML = '';
    },
  };
}
```

接入后的检查：

- [ ] `mount` 只使用 `root` / `state` / `data` / `services`，没有 import `src/app.js` 内部符号。
- [ ] `destroy()` 移除所有 root / window / document 监听器、定时器和 service 订阅。
- [ ] 新 service 键为可选；旧模块不认识时不受影响。
- [ ] 新选择器带 `data-<name>-*` 或稳定命名，不改 4.2 已发布选择器。
- [ ] 样式命名空间化；不修改全局元素选择器。
- [ ] `npm test`、三视图、深链、空状态、console error、1440 / 1024 / 768 / 390 页面横向溢出检查通过；宽图表允许自身容器内滚动。
- [ ] 没有图片 / 截图 / 具体日程内容进入仓库或 PR。
- [ ] `docs/interfaces.md` 与 `docs/integration.md` 已更新版本 / 迁移说明。

### 5.2 数据源契约（建议，尚未实现）

当前应用在启动时读取可选的 `local/schedule.json`（缺失则空白种子），并在视图内同步读写内存 store；尚未接入后端。接入后端时，建议实现以下接口（**尚未实现**）：

```ts
interface CalendarDataSource {
  listEvents(range: { from: string; to: string }): Promise<CalendarEvent[]>;
  listNotes(date: string): Promise<StickyNote[]>;
  listTasks(): Promise<Task[]>;
  updateTaskStatus(id: string, status: TaskStatus): Promise<Task>;
  createTask(input: { id?: string; title: string; icon?: string; date?: string; start?: string; duration?: number; due?: string }): Promise<Task>;
  updateTask(id: string, input: { title?: string; icon?: string; date?: string; start?: string; duration?: number; due?: string }): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  createNote(input: { date: string; text: string }): Promise<StickyNote>;
  updateNote(id: string, input: { text: string }): Promise<StickyNote>;
  deleteNote(id: string): Promise<void>;
  listDailyTasks(date: string): Promise<Array<{ task: DailyTask; status: TaskStatus }>>;
  addDailyTask(input: { title: string; icon?: string }): Promise<DailyTask>;
  updateDailyTaskStatus(id: string, date: string, status: TaskStatus): Promise<TaskStatus>;
}
```

后端映射、异步加载、错误回滚与乐观更新见 `docs/integration.md`。

### 5.3 dsh 输入接口

`app.js` 暴露只读命名空间 `window.schedule`（`version: '0.8'`），包含任务、每日任务与蓄水池三个运行时接口：

```js
// 任务：清单 / 日 / 周 / 月共用
window.schedule.tasks.add({
  id: 'task-20261108-1',       // 可选；省略则自动生成
  title: '整理周报',
  date: '2026-11-08',
  start: '09:00',
  duration: 60,
  due: '2026-11-09',
});
// 全天任务：只传 date（不传 start / duration）
window.schedule.tasks.add({ title: '全天任务', date: '2026-11-10' });
window.schedule.tasks.get('task-20261108-1');
window.schedule.tasks.list();
window.schedule.tasks.subscribe(() => {});
window.schedule.tasks.setStatus('task-20261108-1', 'partial');
window.schedule.tasks.cycleStatus('task-20261108-1');
window.schedule.tasks.update('task-20261108-1', { due: '' });
window.schedule.tasks.update('task-20261108-1', { start: '', duration: '' }); // 变为全天
window.schedule.tasks.update('task-20261108-1', { date: '' });                // 回到收集区
window.schedule.tasks.remove('task-20261108-1');

// 每日任务：当前页面会话内
window.schedule.dailyTasks.add({ title: '整理今日待办', icon: '📝' });
window.schedule.dailyTasks.list('2026-11-06');
// [{ task: { id, title, icon, recurrence: 'daily' }, status: 'todo' }, ...]
window.schedule.dailyTasks.toggle('daily-01', '2026-11-06');
window.schedule.dailyTasks.setStatus('daily-01', 'done', '2026-11-06');
window.schedule.dailyTasks.getStatus('daily-01', '2026-11-06');

// 蓄水池：当前页面会话内
window.schedule.pool.add({
  title: '线性代数网课',
  url: 'https://www.bilibili.com/video/BV1xx',
  source: 'course',                 // course | paper | web | work | chore
  tiers: ['deep', 'leisure'],       // 至少一个；leisure | browse | deep
  note: '看到第 3 讲',               // 可选
});
window.schedule.pool.list();
// [{ id, title, url, source, tiers, note, createdAt }, ...]
window.schedule.pool.remove('pool-01');
```

- `tasks.*` 等价于 `services.inbox` 的对应方法；`dailyTasks.*` 等价于 `services.dailyTasks` 的对应方法；返回值都是数据副本。
- 任务添加支持可选 `id`；重复 id 抛 `INBOX_TASK_DUPLICATE_ID`。完整字段、校验与示例见 `docs/schedule-api.md`。
- `list(date = 今天)`、`getStatus(id, date = 今天)`、`toggle(id, date = 今天)`、`setStatus(id, status, date = 今天)` 的日期参数为 `YYYY-MM-DD`。
- 非法输入抛带 `code` 的 `Error`（任务 / 每日任务的错误码见 `docs/schedule-api.md`）。
- 运行时新增与手工添加只存在当前页面会话；刷新后回到 `local/schedule.json` 或 `src/data.js` 的初始内容。需要持久化的机器人输入应写 `local/schedule.json` 后重新加载，不要把具体内容提交仓库。

## 6. 版本与兼容

- 当前接口版本 `0.8`；0.2 增量加入 `DailyTask`、`DailyTasksService`、`window.schedule.dailyTasks` 与每日任务 DOM；0.3 增量加入清单 / 便签 CRUD、任务可选时间字段与日视图时间表派生事件；0.4 增量加入任务可选 `due` 截止日期与行内展示；0.5 增量加入周图模块、月 / 周 / 日任务统一、任务可选 `id`、`window.schedule.tasks`、本地内容文件与机制层交接约定；0.6 增量加入「当日计划 / 收集区」分区与日进度口径、周 / 月逾期回顾区、全天任务（`date` 不带时间）、`due ≥ date` 写入校验、共享任务日期映射（`taskWindow` / `taskDayEntry` / `taskReviewGroups`）与 `listUnscheduledTasks()`；0.7 增量加入蓄水池（`PoolItem` / `PoolService` / `window.schedule.pool`、顶栏常驻入口与面板选择器、本地内容可选 `pool` 键）；0.8 增量加入月视图跨天长条（`monthSpanBars` 纯函数、`[data-month-span-bar]` 选择器，跨天任务从「首尾两个 chip」改为「一条按周行裁剪的长条」）。已发布字段与稳定选择器保持不变。
- 0.6 的行为变化（需在 PR / 迁移说明中告知）：① 日视图「清单」不再展示全部任务，只展示当日计划 + 收集区；② `updateTask` 清空 `start` / `duration` 从「解绑日期」变为「变为全天任务」，解绑需显式 `date: ''`；③ `addTask({ date })` 不再静默忽略日期，而是创建全天任务；④ `due` 早于 `date` 的写入抛 `INBOX_TASK_DUE_INVALID`。
- 新增字段必须可选，渲染层对未知可选字段保持忽略。
- 颜色 / 图标 / 状态枚举新增时，需要同时补样式与回退；删除或重命名属于 breaking change。
- 破坏性接口变更必须升级版本、更新本文档与 `docs/integration.md`，并在 PR 中明确迁移方案。
