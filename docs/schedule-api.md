# 日程添加接口文档

版本：`0.5`
配套文档：`docs/interfaces.md`（稳定契约）、`docs/integration.md`（对接）、`docs/mechanism-handoff.md`（机制层 / 本地内容边界）

本文档面向**机器人 / 自动化**：说明如何把一条日程添加进「日程」，以及添加后如何出现在清单、日视图、周图和月视图。具体任务内容属于本地内容层，**不要提交到 GitHub**。

## 1. 两条输入通道

| 通道 | 入口 | 作用域 | 适用场景 |
| --- | --- | --- | --- |
| 页面手工 | 日视图「清单」→ `＋` → 填写标题 / 开始 / 持续 | 当前页面会话 | 使用者手工补一条 |
| 运行时 API | `window.schedule.tasks.*` / `window.schedule.dailyTasks.*` | 当前页面会话 | 机器人 / 自动化在已打开的页面里添加、改状态、删除 |
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
  date?: string;              // YYYY-MM-DD；填写后进入日 / 周 / 月视图
  start?: string;             // HH:mm，07:00–20:59；与 duration 成对出现
  duration?: number;          // 5–720 分钟整数；与 start 成对出现
  due?: string;               // YYYY-MM-DD，可选截止日期
  end?: string;               // 派生字段（start + duration），只读
}
```

- `date` + `start` + `duration` 表示一个定时任务：有日视图时间表事件、周图方块、月视图日期 chip。
- 只填 `due`（没有 `date`）表示只有截止日期：月视图在截止日显示「截止」chip，周图在截止日显示截止方块；不进入时间表。
- 两者都不填表示未排期 Inbox：只出现在日视图清单，不落到日历日期。
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

interface DailyTask {
  id: string; title: string; icon?: string; recurrence: 'daily';
}
```

## 3. 运行时 API

`window.schedule` 是只读命名空间，`version` 当前为 `0.5`。

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

### 3.3 错误约定

运行时方法在非法输入时同步抛出带 `code` 的 `Error`：

| `code` | 触发条件 |
| --- | --- |
| `INBOX_TASK_TITLE_INVALID` | 标题为空或超过 80 字符 |
| `INBOX_TASK_SCHEDULE_INVALID` | 时间字段不成对、格式错误、开始不在 07:00–20:59、结束晚于 21:00、日期非法 |
| `INBOX_TASK_DUE_INVALID` | 截止日期格式非法或不是真实日期 |
| `INBOX_TASK_DUPLICATE_ID` | 指定的 id 已存在 |
| `INBOX_TASK_NOT_FOUND` | 更新 / 删除 / 读写状态时 id 不存在 |
| `INBOX_TASK_STATUS_INVALID` | 状态不是 `todo / partial / done` |
| `DAILY_TASK_INVALID` / `DAILY_TASK_DUPLICATE_ID` / `DAILY_TASK_NOT_FOUND` / `DAILY_TASK_STATUS_INVALID` / `DAILY_TASK_DATE_INVALID` | 每日任务对应错误 |

## 4. 本地内容文件（持久）

路径：`local/schedule.json`（`.gitignore` 已忽略，不提交）。

页面加载时 `src/data.js` 的 `loadLocalData()` 读取该文件；缺失、404、网络错误或 JSON 损坏时回退到 `src/data.js` 的空白种子，应用仍可正常打开。文件中的每个集合按 key 独立回退：只写 `tasks` 也可以。

最小结构：

```json
{
  "events": [],
  "notes": [],
  "tasks": [],
  "dailyTasks": []
}
```

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
| 定时任务（`date` + `start` + `duration`） | 清单行 + 时间表事件 | 任务行 + 当天方块 | 该日 chip（含开始时间） |
| 仅截止日期（`due`） | 清单行 + 「截止」标签 | 截止当天方块 | 截止日「截止」chip |
| 定时 + 截止（`due` 晚于 `date`） | 清单行 + 时间表事件 + 截止标签 | 从 `date` 跨到 `due` 的方块 | `date` chip + `due` 截止 chip |
| 未排期（无 `date` / `due`） | 清单行 | 不显示 | 不显示 |
| 每日任务（`dailyTasks`） | 顶部每日任务条 | 不显示 | 不显示 |

周图与月视图使用同一份 `tasks` 数据；周图的方块按开始日到截止日跨天，方块内显示准确时间 / 截止日。状态在三处共用 `todo / partial / done`，状态切换后清单、周图、月视图同步更新。

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

- 当前接口版本 `0.5`；`window.schedule.tasks`、任务可选 `id`、周图数据契约与本地内容文件是本版本新增。
- 新增字段保持可选；已发布字段与方法不删除、不改语义。
- 破坏性变更需升级版本，并同步 `docs/interfaces.md` 与 `docs/integration.md`。
- 本文件的示例内容均为中性占位；真实任务 / 时间 / 便签不写入仓库。
