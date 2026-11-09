# 日程 · 对接文档

版本：`0.6`
配套接口：`docs/interfaces.md`、`docs/schedule-api.md`、`docs/mechanism-handoff.md`

本文档描述如何把「日程」接到真实数据源、如何新增模块，以及本地 / 公网预览的注意事项。当前实现是**零依赖静态页 + 空白种子 + 可选本地内容文件**，尚未接入后端；文中标注“建议”或“尚未实现”的部分属于后续对接契约，不是现有能力。具体日程内容不提交仓库，见 `docs/mechanism-handoff.md`。

## 1. 当前运行方式

```bash
npm start                 # 本地静态服务，默认 http://127.0.0.1:4173
```

- 入口：`index.html` → `src/app.js`。
- 数据：`src/data.js` 的 `sampleEvents` / `sampleNotes` / `sampleTasks` / `sampleDailyTasks` 是空白种子；页面启动时优先读取 **`local/schedule.json`**（不提交仓库，缺失时回退到空白种子）。
- 状态：视图、锚点日期、清单 / 便签、每日任务定义与按日状态都在页面内存中；刷新后回到本地内容文件 / 空白种子的初始状态。
- 清单 / 便签的增删改由 `src/modules/inbox` 负责，store 通过 `services.inbox` 注入；「清单」面板分当日计划与收集区，定时 / 全天 / 仅截止任务按 `src/tasks.js` 的共享映射进入日视图当日计划、周图与月视图，截止已过的任务进入周 / 月逾期回顾区。
- 周视图由 `src/modules/week-chart/` 渲染任务 × 时间方块；它读取 `services.inbox` 的任务与 `data.events`。
- 每日任务：日视图顶部由 `src/modules/daily-tasks/` 模块渲染；定义来自 `sampleDailyTasks` / 本地内容，按日完成状态由 `services.dailyTasks` 保存。dsh 运行时接口为 `window.schedule.dailyTasks`。
- 目前没有后端持久化；页面内编辑不写回本地文件，持久内容由机器人 / 使用者写入 `local/schedule.json`。
- 没有构建步骤、没有运行时依赖；唯一的运行时请求是同源读取本地内容文件。

URL 参数：

```
/?view=month|week|day&date=YYYY-MM-DD
```

## 2. 接入真实数据

### 2.1 当前约束

`src/app.js` 启动时读取可选的 `local/schedule.json`，缺失则使用 `src/data.js` 的空白种子，然后同步创建内存 store。接入后端有两种路径：

1. **推荐**：先提案一个最小数据接入点（属于主干变更，按 `AGENTS.md` 评审），用 `CalendarDataSource` 替换静态 import；保持视图模块只消费数据快照。
2. **不改主干**：新增一个模块，由模块自行取数并渲染自己的区域；但模块不能直接改写月 / 周 / 日主干的渲染逻辑。

每日任务目前采用第 2 种思路的折中：`src/modules/daily-tasks/` 自己管理 store 和 UI，主干只保留一个日视图槽位和 `services.dailyTasks` 最小接口。周图同理：`src/modules/week-chart/` 自己渲染周视图，只通过 `services.inbox` 读取任务。接真实后端时，优先把 store 替换为异步数据源，保持模块的 DOM / 调用契约不变。

本地内容文件是可选的持久入口：`local/schedule.json` 由机器人 / 使用者维护，页面只读。格式与写入流程见 `docs/schedule-api.md`。

不要在视图渲染函数里直接 `fetch`；数据获取、缓存与错误处理应集中在数据源 / 模块内。

### 2.2 建议的数据源契约

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

参考 REST 映射：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/calendar/events?from=2026-11-02&to=2026-11-08` | 返回 `{ events: CalendarEvent[] }` |
| `GET` | `/api/calendar/notes?date=2026-11-06` | 返回 `{ notes: StickyNote[] }` |
| `GET` | `/api/calendar/tasks` | 返回 `{ tasks: Task[] }`（未排期 Inbox） |
| `POST` | `/api/calendar/tasks` | body `{ "title": "整理桌面" }`、`{ "title": "写方案", "date": "2026-11-06", "start": "09:30", "duration": 45 }` 或带可选 `{ "due": "2026-11-08" }`，返回 `{ task: Task }` |
| `PATCH` | `/api/calendar/tasks/:id` | body `{ "status": "partial" }`、`{ "title": "..." }`、时间字段或 `{ "due": "2026-11-08" }`；清空时间用 `{ "start": "", "duration": "" }`，清空截止日期用 `{ "due": "" }`，返回 `{ task: Task }` |
| `DELETE` | `/api/calendar/tasks/:id` | 删除任务 |
| `POST` | `/api/calendar/notes` | body `{ "date": "2026-11-06", "text": "..." }`，返回 `{ note: StickyNote }` |
| `PATCH` | `/api/calendar/notes/:id` | body `{ "text": "..." }`，返回 `{ note: StickyNote }` |
| `DELETE` | `/api/calendar/notes/:id` | 删除便签 |
| `GET` | `/api/calendar/daily-tasks?date=2026-11-06` | 返回 `{ dailyTasks: [{ task: DailyTask, status: TaskStatus }] }` |
| `POST` | `/api/calendar/daily-tasks` | body `{ "title": "喝水", "icon": "💧" }`，返回 `{ task: DailyTask }` |
| `PATCH` | `/api/calendar/daily-tasks/:id/status?date=2026-11-06` | body `{ "status": "done" }`，返回 `{ status: TaskStatus }` |

错误建议统一为：

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "end must be after start" } }
```

认证方式由部署方决定（Cookie / Authorization 头）；**不要**把 token 写进前端静态文件，也不要提交到仓库。

### 2.3 数据映射示例

事件：

```json
{
  "events": [
    {
      "id": "evt-1001",
      "title": "产品方案评审",
      "date": "2026-11-06",
      "start": "14:00",
      "end": "15:30",
      "color": "violet",
      "icon": "doc",
      "note": "提前 10 分钟准备材料"
    }
  ]
}
```

便签（按天）：

```json
{
  "notes": [
    {
      "id": "note-1",
      "date": "2026-11-06",
      "text": "发布前确认三件事：文案、截图、回滚方案。",
      "tone": "pink",
      "tilt": 1.6
    }
  ]
}
```

任务（未排期 = 收集区，无日期无截止；`due` 为可选截止日期且不得早于 `date`）：

```json
{
  "tasks": [
    { "id": "task-1", "title": "整理评审意见", "icon": "📝", "status": "partial", "due": "2026-11-08" }
  ]
}
```

每日任务（重复定义 + 当天状态）：

```json
{
  "dailyTasks": [
    {
      "task": { "id": "daily-01", "title": "喝够 8 杯水", "icon": "💧", "recurrence": "daily" },
      "status": "done"
    },
    {
      "task": { "id": "daily-02", "title": "阅读 20 分钟", "icon": "📖", "recurrence": "daily" },
      "status": "todo"
    }
  ]
}
```

字段约束、枚举和不变量见 `docs/interfaces.md`。

### 2.4 异步加载与错误处理

接入后端时需要补上：

- 首次加载 loading 状态；本地内容文件缺失时按空白日历处理（不报错），后端加载失败时展示可重试的错误态，不破坏工具栏与导航。
- 空数据态沿用现有空状态（无事件 / 无便签 / 无任务 / 无每日任务）。
- 任务状态更新建议乐观更新：先改 UI，再提交 `PATCH`；失败时回滚并播报错误。
- 清单 / 便签的新增与修改建议先在 store 内改 UI，再提交请求；失败时回滚到提交前的快照，并把错误写回对应表单的 `role="alert"` 区域。
- 每日任务也建议乐观更新：先切换当天状态 / 先插入新定义，再提交请求；失败时回滚 store 并显示 `role="alert"` 错误。
- 删除目前是“两步确认 + 立即删除”；接入后端后建议改为可撤销删除，或在服务端保留回收站。
- 校验规则与前端保持一致：任务标题 1–80 字符、便签 1–200 字符；开始 07:00–20:59、持续 5–720 分钟、结束不晚于 21:00；服务端仍需重复校验。
- 范围请求只取当前视图所需区间（月视图覆盖 6 × 7 天，周视图覆盖 7 天，日视图取当天，并取当天每日任务状态）。
- 本地内容文件只在启动时读取一次；运行时不回写，避免页面编辑覆盖机器人写入的本地内容。
- 刷新后以服务端为准；本地只保留临时 UI 状态。

### 2.5 清单 / 便签 store 接入

当前 `src/app.js` 创建一份 `createInboxStore({ tasks, notes })`，在日视图挂载时以 `services.inbox` 传给模块。接入后端时有两种方式：

1. 保持 store 作为乐观更新缓存，由 store 方法在写内存后调用数据源；失败时回滚并抛出带 `code` 的错误。
2. 用数据源实现同一组 `services.inbox` 方法，模块无需改动；注意保持 `listTasks()` / `listNotes()` / `listCalendarEvents()` 的同步读取语义，或先改造模块支持异步。

store 接口、校验与错误码见 `docs/interfaces.md` 3.3。定时任务写入后，`src/app.js` 的 `inbox.subscribe` 会局部刷新日视图周条与时间表；周图模块自己也订阅 store，月视图在可见时重绘。接入异步数据源时，刷新前需先完成任务列表更新，避免视图短暂使用旧快照。

每日任务 store 的接入方式见 3.4；`services.dailyTasks` 与 `services.inbox` 都保持在 `src/app.js` 创建唯一实例。

## 3. 新增模块

### 3.1 目录

```
src/modules/<name>/
  index.js       mount(context) 入口
  README.md      输入 / 输出 / 依赖 / 不变量
  styles.css     可选，类名 .mod-<name>-*
  __tests__/     可选，node:test
```

### 3.2 最小骨架

```js
export function mount(context) {
  const { root, state, data, services } = context;
  root.innerHTML = `<div class="mod-example">${state.view} / ${data.events.length}</div>`;

  return {
    update(nextContext) {
      // 用新快照更新，不要直接读写 app.js 内部状态
    },
    destroy() {
      root.innerHTML = '';
    },
  };
}
```

`context` 的完整形状、只读约束、生命周期与 service 接口见 `docs/interfaces.md` 5.1；`update` 是可选预留，当前视图切换会先 `destroy` 再重新 `mount`。

### 3.3 接入步骤

1. 在 Issue / PR 说明功能、数据需求、是否需要 `services`。
2. 新增模块目录与 README，声明接口与不变量。
3. 模块只 import `src/calendar.js`、`src/tasks.js` 等公开纯函数；不 import 其它模块内部文件。
4. 样式加 `.mod-<name>-` 前缀；不改全局元素选择器。
5. 补模块单测；涉及 UI 时在本地按 1440 / 1024 / 768 / 390 验证，证据留在 `local/evidence/`，不入仓库。
6. 如需在主干挂载，提交最小登记点：`renderDay()` 槽位、`render()` 的 mount / destroy、需要共享状态时的 `services` 导出、`index.html` 样式入口。当前 inbox 模块使用 `<aside class="day-sidebar" data-module-root="inbox">` 与 `services.inbox`；daily-tasks 使用 `<div data-module-root="daily-tasks"></div>` 与 `services.dailyTasks`。不要改动其它模块槽位。
7. 更新 `docs/interfaces.md` 与本文档，再请求 review。

### 3.4 已落地示例：`daily-tasks`

`src/modules/daily-tasks/` 是按该模式接入的第一个模块，可作为后续模块的参考：

```
src/modules/daily-tasks/
  index.js        mount(context)：渲染日视图每日任务条与手工添加入口
  store.js        纯逻辑：定义、按日状态、订阅
  styles.css      .mod-daily-tasks-* 样式，index.html 中一行 <link> 加载
  __tests__/      node:test
  README.md       接口、不变量、dsh / 手工两个入口
```

主干改动保持最小：

- `src/app.js`：引入模块、创建 store、日视图一行槽位、`mount / destroy` 生命周期、`window.schedule.dailyTasks`。
- `index.html`：加载模块样式的一行 `<link>`。
- `src/data.js`：`sampleDailyTasks` 导出（当前为空数组），不改原有字段。

两个添加入口：

- dsh：改 `sampleDailyTasks`（持久，随页面加载）或调用 `window.schedule.dailyTasks.add(...)`（会话内）。
- 手工：日视图「每日任务」条 → `＋ 添加` → 输入标题 → `加入`（会话内）。

当前没有后端，运行时新增与手工新增刷新后不保留；需要持久化时先按下一节替换数据源。

### 3.5 已落地示例：`inbox`（清单 / 便签 / 定时任务）

```
src/modules/inbox/
  index.js        mount(context)：渲染侧栏清单 / 便签面板与时间字段
  store.js        纯逻辑：任务 / 便签 CRUD、时间字段校验、时间表事件派生
  styles.css      .mod-inbox-* 样式，index.html 中一行 <link> 加载
  __tests__/      node:test
  README.md       接口、不变量、DOM 契约
```

主干接入点：

- `src/app.js`：创建 `services.inbox`，日视图挂载 / 卸载模块；`inbox.subscribe` 在任务变化时刷新日视图周条 / 时间表、重绘可见的月视图。
- `index.html`：加载模块样式的一行 `<link>`。
- `src/data.js`：`sampleTasks` / `sampleNotes`（当前为空数组）。

任务时间同步：没有日期与截止的任务留在「收集区」（不计入日进度）；填写 `start` + `duration` 后绑定日期，`listCalendarEvents(date)` 派生 teal 时间表事件，进入当日计划、周图与月视图；只填 `date` 为全天任务（不进时间表）；只填 `due` 的任务在截止前进入当日计划、截止日进周 / 月视图，截止后进逾期回顾区。删除为两步确认，刷新后回到本地内容 / 空白初始状态。

### 3.6 新模块接入演练（示例）

以一个假设的 `example` 模块为例，完整接入路径如下，确认后续模块不需要改其它模块的内部实现。

`src/modules/example/index.js`：

```js
export function mount({ root, state, data, services }) {
  function render() {
    root.innerHTML = `<div class="mod-example">${state.view}</div>`;
  }
  const onClick = () => {};
  root.addEventListener('click', onClick);
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

`src/app.js` 登记（只增加本模块相关行）：

```js
import { mount as mountExample } from './modules/example/index.js';
let exampleView = null;

// renderDay(): 在日视图内增加本模块槽位
// <div data-module-root="example"></div>

// render(): 日视图分支 mount；切走 / 重绘时 destroy
exampleView = mountExample({
  root: root.querySelector('[data-module-root="example"]'),
  state: { view: state.view, anchor: new Date(state.anchor) },
  data: { events: sampleEvents, notes: inbox.listNotes(toDateKey(state.anchor)), tasks: inbox.listTasks() },
  services: { inbox },
});
```

`index.html`：增加一行 `<link rel="stylesheet" href="./src/modules/example/styles.css" />`（如有样式）。
补充：模块 README、store / 纯逻辑测试、4 个宽度的本地验证证据（不入仓库）、`docs/interfaces.md` 与本文档。

接口平滑性检查（与 `docs/interfaces.md` 5.1.1 对齐）：

- [ ] `mount` 只依赖 `context`，没有 import `src/app.js` 或其它模块内部文件。
- [ ] `destroy` 移除 root / window / document 监听器、定时器与 service 订阅。
- [ ] 新 service 是可选键，旧模块不受影响；错误码、同步 / 异步语义写进文档。
- [ ] 新槽位 / 选择器带模块命名空间，既有稳定选择器保持不变。
- [ ] 空白启动、三视图、深链、空状态、console error、1440 / 1024 / 768 / 390 无横向溢出。
- [ ] 文档版本与迁移说明已更新。

当前主干仍是显式登记（app.js 中每个模块一组 import / mount / destroy / 槽位），没有自动注册器；新增模块按上述模式复制最小登记点即可。若后续模块数量继续增加，再单独提案通用注册器，避免在本 PR 中引入框架。

## 4. 本地与公网预览

- 本地：`npm start` 启动零依赖静态服务；仅供开发。
- 公网：必须使用**脱敏副本**（只含 `index.html`、`assets/`、`src/`；不含 `.git`、`.design-local`、`.local`、`local/`、`docs/`、测试与本机路径），由临时静态服务 / 反向代理提供。
- 预览 URL、目录、创建时间和自动清理时间要记录；到期删除。
- 不要公开仓库、设计备选源文件、凭据、飞书私有内容或预览生成脚本的私有产物。
- 预览只用于验收，不作为生产部署；生产接入需先完成数据源与安全检查。

## 5. 兼容与发布

- 接口版本见 `docs/interfaces.md` / `docs/schedule-api.md`；新增字段必须可选。
- 删除 / 重命名字段、改变状态枚举语义、改变 URL 参数都属于 breaking change，需升级版本并在 PR 中给出迁移方案。
- 保持零运行时依赖和无构建步骤；如需引入框架 / 构建，先单独提案。
- 仓库与 PR 不提交图片 / 截图；具体日程内容只在本地的 `local/schedule.json`。
- 主干默认冻结：功能开发以模块为主，修改主干必须对应明确需求并完成回归。

## 6. 对接 PR 检查清单

- [ ] 接口/数据模型变更已更新 `docs/interfaces.md`。
- [ ] 对接方式、错误态、空态、回滚策略已说明。
- [ ] `npm test` 通过；新增纯逻辑有测试。
- [ ] 三视图与任务状态交互回归通过。
- [ ] 清单 / 便签新增、编辑、删除与定时任务时间表同步已检查。
- [ ] 每日任务：手工添加、空输入、跨日重置、dsh API、刷新后会话数据回退已检查。
- [ ] 1440 / 1024 / 768 / 390 无横向溢出、无 console error。
- [ ] UI 改动在本地完成 Baseline / After 对比，证据留在 `local/evidence/`；PR 用文字说明，不贴图。
- [ ] 未提交设计备选、临时预览或敏感信息。
- [ ] PR 明确关联 Issue；跟踪 Issue 默认保持开启。
