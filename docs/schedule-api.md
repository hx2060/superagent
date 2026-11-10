# 日程添加接口文档

版本：`0.7`
配套文档：`docs/interfaces.md`（稳定契约）、`docs/integration.md`（对接）、`docs/mechanism-handoff.md`（机制层 / 本地内容边界）

本文档面向**机器人 / 自动化**：说明如何把一条日程添加进「日程」，以及添加后如何出现在清单、日视图、周图和月视图。具体任务内容属于本地内容层，**不要提交到 GitHub**。

## 1. 两条输入通道

| 通道 | 入口 | 作用域 | 适用场景 |
| --- | --- | --- | --- |
| 页面手工 | 日视图「清单」→ `＋` → 填写标题 / 开始 / 持续 | 当前页面会话 | 使用者手工补一条 |
| 运行时 API | `window.schedule.tasks.*` / `window.schedule.dailyTasks.*` / `window.schedule.pool.*` | 当前页面会话 | 机器人 / 自动化在已打开的页面里添加、改状态、删除 |
| 本地内容文件 | `local/schedule.json`，页面加载时读取 | 持久（刷新后仍在） | 机器人把具体安排写成本地内容，不提交 GitHub |

推荐流程：**机制与接口在 GitHub；具体内容写 `local/schedule.json`；刷新页面验证。** 运行时 API 适合临时操作或页面内自动化；它不会写回本地文件。

## 2. 数据契约

```ts
type TaskStatus = 'todo' | 'partial' | 'done';  // 待完成 / 部分完成 / 完成

interface Task {
  id: string;                 // 集合内唯一；本地文件建议必填，运行时 API 可省略（自动生成）
  title: string;              // 1–80 字符，纯文本
  icon?: string;              // emoji，缺省 📝
  status?: TaskStatus;        // 本地种子可指定；运行时 add 固定 todo
  date?: string;              // YYYY-MM-DD；填写后进入当日计划与周 / 月视图
  start?: string;             // HH:mm，07:00–20:59；与 duration 成对出现
  duration?: number;          // 5–720 分钟整数；与 start 成对出现
  due?: string;               // YYYY-MM-DD，可选截止日期；不得早于 date
  end?: string;               // 派生字段（start + duration），只读
}
```

- `date` + `start` + `duration` 表示一个定时任务：有日视图时间表事件、当日计划项、周图方块、月视图日期 chip。
- 只填 `date`（没有 `start` / `duration`）表示**全天任务**：进入当日计划与周 / 月视图，不进时间表。
- 只填 `due`（没有 `date`）表示只有截止日期：月视图在截止日显示「截止」chip，周图从今天画到截止日的长块（截止日已过时显示截止当天方块，并进入周 / 月「逾期回顾区」）；截止日到来前每天进入当日计划；不进入时间表。
- 两者都不填表示未排期：只出现在日视图「收集区」，不进当日计划与日进度。
- `due` 必须是合法的 `YYYY-MM-DD` 且**不早于 `date`**，否则写入报错 `INBOX_TASK_DUE_INVALID`。
- `due` 与 `date` 同一天时，周图方块只占当天；`due` 晚于 `date` 时，方块从 `date` 跨到 `due`。
- 时间使用**本地时区**的 `YYYY-MM-DD` / `HH:mm`；不做 UTC 换算。

其他集合（本地文件可包含，运行时只读）：

```ts
interface CalendarEvent {
  id: string; title: string; date: string; start: string; end: string;
  color: 'blue' | 'teal' | 'orange' | 'violet';
  icon?: string; note?: string;
}

interface StickyNote {
  id: string; date: string; text: string;
  tone: 'yellow' | 'pink' | 'blue'; tilt?: number;
}

interface PoolItem {
  id: string;                 // 集合内唯一；本地文件建议必填，运行时 API 可省略（自动生成）
  title: string;              // 1–80 字符，纯文本
  url?: string;               // http(s) 链接；省略时条目只有详情
  source: 'course' | 'paper' | 'web' | 'work' | 'chore';   // 来源
  tiers: Array<'leisure' | 'browse' | 'deep'>;             // 至少一档，可多档
  note?: string;              // 最多 200 字符，纯文本
  createdAt?: string;         // YYYY-MM-DD；缺省取当天
}

interface DailyTask {
  id: string; title: string; icon?: string; recurrence: 'daily';
}
```

## 3. 运行时 API

`window.schedule` 是只读命名空间，`version` 当前为 `0.6`。

### 3.1 `window.schedule.tasks`

| 方法 | 说明 |
| --- | --- |
| `add(input)` | 新增任务；`input` 见下；返回带 `status: 'todo'` 与派生 `end` 的任务副本 |
| `update(id, changes)` | 修改标题 / 图标 / 时间 / 截止日期；不修改状态 |
| `remove(id)` | 删除任务并返回被删除的任务副本 |
| `get(id)` | 按 id 查找，找不到返回 `null` |
| `list()` | 返回全部任务副本（按加入顺序） |
| `setStatus(id, status)` | 设置三态之一，返回状态 |
| `cycleStatus(id)` | 按 `todo → partial → done → todo` 循环，返回新状态 |
| `subscribe(listener)` | 订阅 store 变更；返回退订函数。回调没有参数 |

`add(input)`：

```ts
{
  id?: string;        // 可选；提供时必须唯一，重复会抛 INBOX_TASK_DUPLICATE_ID
  title: string;      // 必填
  icon?: string;
  date?: string;      // YYYY-MM-DD
  start?: string;     // HH:mm
  duration?: number;  // 分钟
  due?: string;       // YYYY-MM-DD
}
```

示例：添加一条 11 月 8 日 09:00 开始、持续 60 分钟、截止 11 月 9 日的任务：

```js
const task = window.schedule.tasks.add({
  id: 'task-20261108-1',      // 建议机器人给稳定 id；省略则自动生成
  title: '整理周报',
  date: '2026-11-08',
  start: '09:00',
  duration: 60,
  due: '2026-11-09',
});

window.schedule.tasks.setStatus('task-20261108-1', 'partial');
window.schedule.tasks.list();
```

全天任务与收集区：

```js
// 全天任务：只传 date，不传 start / duration
window.schedule.tasks.add({ id: 'task-allday-1', title: '示例全天任务', date: '2026-11-10' });
// 定时任务改为全天：清空时间（保留 date）
window.schedule.tasks.update('task-20261108-1', { start: '', duration: '' });
// 任务放回收集区：显式清空日期
window.schedule.tasks.update('task-20261108-1', { date: '' });
// 截止日期不得早于任务日期，否则抛 INBOX_TASK_DUE_INVALID
window.schedule.tasks.add({ title: '矛盾任务', date: '2026-11-06', due: '2026-11-05' }); // 抛错
```

### 3.2 `window.schedule.dailyTasks`

每日重复任务（不绑定日期，状态按天记录）：

```js
window.schedule.dailyTasks.add({ id: 'daily-water', title: '喝够 8 杯水', icon: '💧' });
window.schedule.dailyTasks.list('2026-11-08');       // [{ task, status }]
window.schedule.dailyTasks.toggle('daily-water');    // 当天 todo → partial
window.schedule.dailyTasks.setStatus('daily-water', 'done', '2026-11-08');
window.schedule.dailyTasks.getStatus('daily-water', '2026-11-08');
```

`list` / `getStatus` / `toggle` / `setStatus` 的日期参数缺省为今天；格式必须是 `YYYY-MM-DD`。

重复执行同一添加前，先用 `window.schedule.tasks.get(id)` 检查，或用 `update(id, ...)` 更新；`add` 的重复 id 会抛错。

### 3.3 `window.schedule.pool`（蓄水池）

蓄水池条目（网课 / 论文 / 网页 / 工作 / 杂事），按三档学习状态归档；只存当前页面会话，持久请写本地内容文件的 `pool` 键。

```js
window.schedule.pool.add({
  title: '线性代数网课',
  url: 'https://www.bilibili.com/video/BV1xx',
  source: 'course',                 // course | paper | web | work | chore
  tiers: ['deep', 'leisure'],       // 至少一档；leisure | browse | deep
  note: '看到第 3 讲',
});
window.schedule.pool.list();        // [{ id, title, url, source, tiers, note, createdAt }]
window.schedule.pool.remove('pool-01');
```

`add` 的重复 `id` 会抛错；不传 `id` 时自动生成。无 `update` 运行时方法；修改请用面板内编辑。

### 3.4 错误约定

运行时方法在非法输入时同步抛出带 `code` 的 `Error`：

| `code` | 触发条件 |
| --- | --- |
| `INBOX_TASK_TITLE_INVALID` | 标题为空或超过 80 字符 |
| `INBOX_TASK_SCHEDULE_INVALID` | 时间字段不成对、格式错误、开始不在 07:00–20:59、结束晚于 21:00、日期非法、清空日期但保留时间 |
| `INBOX_TASK_DUE_INVALID` | 截止日期格式非法或不是真实日期，或截止日期早于任务日期 |
| `INBOX_TASK_DUPLICATE_ID` | 指定的 id 已存在 |
| `INBOX_TASK_NOT_FOUND` | 更新 / 删除 / 读写状态时 id 不存在 |
| `INBOX_TASK_STATUS_INVALID` | 状态不是 `todo / partial / done` |
| `DAILY_TASK_INVALID` / `DAILY_TASK_DUPLICATE_ID` / `DAILY_TASK_NOT_FOUND` / `DAILY_TASK_STATUS_INVALID` / `DAILY_TASK_DATE_INVALID` | 每日任务对应错误 |
| `POOL_TITLE_INVALID` / `POOL_URL_INVALID` / `POOL_SOURCE_INVALID` / `POOL_TIER_INVALID` / `POOL_NOTE_INVALID` / `POOL_DUPLICATE_ID` / `POOL_NOT_FOUND` | 蓄水池条目对应错误（标题 / 链接 / 来源 / 档位 / 备注 / 重复 id / id 不存在） |

## 4. 本地内容文件（持久）

路径：`local/schedule.json`（`.gitignore` 已忽略，不提交）。

页面加载时 `src/data.js` 的 `loadLocalData()` 读取该文件；缺失、404、网络错误或 JSON 损坏时回退到 `src/data.js` 的空白种子，应用仍可正常打开。文件中的每个集合按 key 独立回退：只写 `tasks` 也可以。

最小结构：

```json
{
  "events": [],
  "notes": [],
  "tasks": [],
  "dailyTasks": [],
  "pool": []
}
```

`pool` 为可选键；每条需要 `title` / `source` / `tiers`，`url` / `note` 可省，`id` 建议提供。坏条目跳过不阻塞启动。

带内容示例（使用中性占位，实际内容按需替换）：

```json
{
  "events": [
    {
      "id": "evt-1",
      "title": "示例日程",
      "date": "2026-11-04",
      "start": "14:00",
      "end": "15:30",
      "color": "violet",
      "icon": "doc"
    }
  ],
  "notes": [],
  "tasks": [
    {
      "id": "task-1",
      "title": "示例任务 A",
      "icon": "📝",
      "status": "todo",
      "date": "2026-11-02",
      "start": "09:00",
      "duration": 60,
      "due": "2026-11-08"
    }
  ],
  "dailyTasks": [
    { "id": "daily-1", "title": "示例每日任务", "icon": "🔁" }
  ]
}
```

约束：

- 本地文件是**只读种子**：应用不会写回；页面内新增 / 修改 / 删除只在当前会话有效。
- `tasks[].id` 建议必填且唯一；缺失或重复时运行时会生成临时 id（刷新后可能变化），机器人仍应写入稳定 id。`events[].id`、`notes[].id`、`dailyTasks[].id` 同理。
- `tasks[].status` 可选，缺省 `todo`；`end` 不要手写，按 `start + duration` 派生。
- 标题、便签、备注按纯文本渲染；不要放 HTML。
- 不要把真实内容写进 `src/data.js`、测试、Issue、PR 或提交。

机器人写入流程建议：

1. 读取 `local/schedule.json`；不存在则从 `{ "events": [], "notes": [], "tasks": [], "dailyTasks": [] }` 开始。
2. 用稳定 id（例如 `task-YYYYMMDD-序号`）追加或替换任务；写入前按第 2 节校验。
3. 以 UTF-8 写回同一个文件；保持格式合法。
4. 刷新页面，检查清单、日视图时间表、周图、月视图是否一致。
5. 只把机制 / 接口改动提交 GitHub；内容文件保持本地。

## 5. 三种视图的反映规则

| 添加内容 | 日视图 | 周图 | 月视图 |
| --- | --- | --- | --- |
| 定时任务（`date` + `start` + `duration`） | 当日计划行 + 时间表事件 | 任务行 + 当天方块 | 该日 chip（含开始时间） |
| 全天任务（只有 `date`） | 当日计划行（标注「全天」） | 任务行 + 当天方块（标注「全天」） | 该日 chip |
| 仅截止日期（`due`） | 截止日到来前：当日计划行 + 「截止」标签；截止后：不再出现在日视图 | 从今天到截止日的长块（已过时占截止当天，并进逾期回顾区） | 今天开始 chip + 截止日「截止」chip；截止后进逾期回顾横幅 |
| 定时 + 截止（`due` 晚于 `date`） | 排期日与截止日的当日计划行 + 截止标签（未完成时区间内每天出现） | 从 `date` 跨到 `due` 的方块 | `date` chip + `due` 截止 chip |
| 未排期（无 `date` / `due`） | 「收集区」行（不计入日进度） | 不显示 | 不显示 |
| 每日任务（`dailyTasks`） | 顶部每日任务条 | 不显示 | 不显示 |
| 蓄水池条目（`pool`） | 不进入日视图；顶栏常驻「蓄水池」入口，点击进面板 | 不显示 | 不显示 |

- **当日计划** = 截止日 / 排期日是当天，或未完成且当天在任务占据区间内；**日进度**只统计当日计划成员。
- **逾期回顾区**：截止已过且未删除的任务，在周视图图表上方与月视图网格上方按「逾期未完成 / 已完成」分组展示，保留至删除，可切换状态。
- 周图与月视图使用同一份 `tasks` 数据；方块按开始日到截止日跨天，方块内显示准确时间 / 截止日。三视图共用 `src/tasks.js` 的 `taskWindow` / `taskDayEntry` / `taskReviewGroups` 计算「任务出现在哪些天、算什么状态」，状态切换后同步更新。

## 6. 机器人调用示例

在已打开的页面里（浏览器控制台或自动化脚本的 `Runtime.evaluate`）：

```js
(async () => {
  window.schedule.tasks.add({
    id: 'task-20261108-2',
    title: '示例任务',
    date: '2026-11-08',
    start: '10:00',
    duration: 45,
  });
  return window.schedule.tasks.list().map((task) => task.title);
})();
```

持久化则写本地文件（不要让内容进入 GitHub）：

```bash
# 示意：仅在本机执行；local/ 已被 .gitignore 忽略
$EDITOR local/schedule.json
```

## 7. 版本与兼容

- 当剂接口版本 `0.7`；本版本新增：蓄水池（`window.schedule.pool.add / list / remove`、本地内容可选 `pool` 键、三档学习状态与多档归档）；上一版本新增：全天任务（只传 `date`）、当日计划 / 收集区分区与日进度口径、周 / 月逾期回顾区、`due` 不得早于 `date` 的写入校验；`updateTask` 清空时间从「解绑日期」改为「变为全天任务」（解绑需显式 `date: ''`）。
- 新增字段保持可选；已发布字段与方法不删除、不改语义。
- 破坏性变更需升级版本，并同步 `docs/interfaces.md` 与 `docs/integration.md`。
- 本文件的示例内容均为中性占位；真实任务 / 时间 / 便签不写入仓库。
