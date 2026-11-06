# 日程 · 对接文档

版本：`0.3`
配套接口：`docs/interfaces.md`

本文档描述如何把「日程」接到真实数据源、如何新增模块，以及本地 / 公网预览的注意事项。当前实现是**零依赖静态页 + 示例数据**，尚未接入后端；文中标注“建议”或“尚未实现”的部分属于后续对接契约，不是现有能力。

## 1. 当前运行方式

```bash
npm start                 # 本地静态服务，默认 http://127.0.0.1:4173
```

- 入口：`index.html` → `src/app.js`。
- 数据：`src/data.js` 的 `sampleEvents` / `sampleNotes` / `sampleTasks`，日期相对浏览器当天。
- 状态：视图、锚点日期、清单 / 便签都在页面内存中（`src/modules/inbox/store.js`）；刷新后恢复示例初始值。
- 清单 / 便签的增删改由 `src/modules/inbox` 负责，store 通过 `services.inbox` 注入；清单任务可选时间会在日视图时间表派生事件；目前没有持久化。
- 没有构建步骤、没有运行时依赖、没有网络请求。

URL 参数：

```
/?view=month|week|day&date=YYYY-MM-DD
```

## 2. 接入真实数据

### 2.1 当前约束

`src/app.js` 直接 import 静态数组，并在首次渲染时同步取数。接入后端有两种路径：

1. **推荐**：先提案一个最小数据接入点（属于主干变更，按 `AGENTS.md` 评审），用 `CalendarDataSource` 替换静态 import；保持视图模块只消费数据快照。
2. **不改主干**：新增一个模块，由模块自行取数并渲染自己的区域；但模块不能直接改写月 / 周 / 日主干的渲染逻辑。

不要在视图渲染函数里直接 `fetch`；数据获取、缓存与错误处理应集中在数据源 / 模块内。

### 2.2 建议的数据源契约

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

参考 REST 映射：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/calendar/events?from=2026-11-02&to=2026-11-08` | 返回 `{ events: CalendarEvent[] }` |
| `GET` | `/api/calendar/notes?date=2026-11-06` | 返回 `{ notes: StickyNote[] }` |
| `GET` | `/api/calendar/tasks` | 返回 `{ tasks: Task[] }`（未排期 Inbox） |
| `POST` | `/api/calendar/tasks` | body `{ "title": "整理桌面" }` 或 `{ "title": "写方案", "date": "2026-11-06", "start": "09:30", "duration": 45 }`，返回 `{ task: Task }` |
| `PATCH` | `/api/calendar/tasks/:id` | body `{ "status": "partial" }`、`{ "title": "..." }` 或时间字段；清空时间用 `{ "start": "", "duration": "" }`，返回 `{ task: Task }` |
| `DELETE` | `/api/calendar/tasks/:id` | 删除任务 |
| `POST` | `/api/calendar/notes` | body `{ "date": "2026-11-06", "text": "..." }`，返回 `{ note: StickyNote }` |
| `PATCH` | `/api/calendar/notes/:id` | body `{ "text": "..." }`，返回 `{ note: StickyNote }` |
| `DELETE` | `/api/calendar/notes/:id` | 删除便签 |

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

任务（全局 Inbox，无日期）：

```json
{
  "tasks": [
    { "id": "task-1", "title": "整理评审意见", "icon": "📝", "status": "partial" }
  ]
}
```

字段约束、枚举和不变量见 `docs/interfaces.md`。

### 2.4 异步加载与错误处理

接入后端时需要补上：

- 首次加载 loading 状态；加载失败展示可重试的错误态，不破坏工具栏与导航。
- 空数据态沿用现有空状态（无事件 / 无便签 / 无任务）。
- 任务状态更新建议乐观更新：先改 UI，再提交 `PATCH`；失败时回滚并播报错误。
- 清单 / 便签的新增与修改建议先在 store 内改 UI，再提交请求；失败时回滚到提交前的快照，并把错误写回对应表单的 `role="alert"` 区域。
- 删除目前是“两步确认 + 立即删除”；接入后端后建议改为可撤销删除，或在服务端保留回收站。
- 校验规则与前端保持一致：任务标题 1–80 字符、便签 1–200 字符；开始 07:00–20:59、持续 5–720 分钟、结束不晚于 21:00；服务端仍需重复校验。
- 范围请求只取当前视图所需区间（月视图覆盖 6 × 7 天，周视图覆盖 7 天，日视图取当天）。
- 刷新后以服务端为准；本地只保留临时 UI 状态。

### 2.5 清单 / 便签 store 接入

当前 `src/app.js` 创建一份 `createInboxStore({ tasks, notes })`，在日视图挂载时以 `services.inbox` 传给模块。接入后端时有两种方式：

1. 保持 store 作为乐观更新缓存，由 store 方法在写内存后调用数据源；失败时回滚并抛出带 `code` 的错误。
2. 用数据源实现同一组 `services.inbox` 方法，模块无需改动；注意保持 `listTasks()` / `listNotes()` / `listCalendarEvents()` 的同步读取语义，或先改造模块支持异步。

store 接口、校验与错误码见 `docs/interfaces.md` 3.3。定时任务写入后，`src/app.js` 的 `inbox.subscribe` 会局部刷新日视图时间表；接入异步数据源时，刷新前需先完成任务列表更新，避免时间表短暂使用旧快照。

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
  const { root } = context;
  root.innerHTML = `<div class="mod-example">...</div>`;

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

### 3.3 接入步骤

1. 在 Issue / PR 说明功能、数据需求、是否需要 `services`。
2. 新增模块目录与 README，声明接口与不变量。
3. 模块只 import `src/calendar.js`、`src/tasks.js` 等公开纯函数；不 import 其它模块内部文件。
4. 样式加 `.mod-<name>-` 前缀；不改全局元素选择器。
5. 补模块单测；涉及 UI 时补 1440 / 1024 / 768 / 390 截图。
6. 如需在主干挂载，提交“接口登记点”改动：只允许一行注册 + 必要的 `services` 导出，并在 PR 中标注。当前 inbox 模块使用 `<aside class="day-sidebar" data-module-root="inbox">` 与 `services.inbox`。
7. 更新 `docs/interfaces.md` 与本文档，再请求 review。

## 4. 本地与公网预览

- 本地：`npm start` 启动零依赖静态服务；仅供开发。
- 公网：必须使用**脱敏副本**（只含 `index.html`、`assets/`、`src/`；不含 `.git`、`.design-local`、`docs/`、测试与本机路径），由临时静态服务 / 反向代理提供。
- 预览 URL、目录、创建时间和自动清理时间要记录；到期删除。
- 不要公开仓库、设计备选源文件、凭据、飞书私有内容或预览生成脚本的私有产物。
- 预览只用于验收，不作为生产部署；生产接入需先完成数据源与安全检查。

## 5. 兼容与发布

- 接口版本见 `docs/interfaces.md`；新增字段必须可选。
- 删除 / 重命名字段、改变状态枚举语义、改变 URL 参数都属于 breaking change，需升级版本并在 PR 中给出迁移方案。
- 保持零运行时依赖和无构建步骤；如需引入框架 / 构建，先单独提案。
- 主干默认冻结：功能开发以模块为主，修改主干必须对应明确需求并完成回归。

## 6. 对接 PR 检查清单

- [ ] 接口/数据模型变更已更新 `docs/interfaces.md`。
- [ ] 对接方式、错误态、空态、回滚策略已说明。
- [ ] `npm test` 通过；新增纯逻辑有测试。
- [ ] 三视图与任务状态交互回归通过。
- [ ] 1440 / 1024 / 768 / 390 无横向溢出、无 console error。
- [ ] UI 改动附 Before/After 截图。
- [ ] 未提交设计备选、临时预览或敏感信息。
- [ ] PR 明确关联 Issue；跟踪 Issue 默认保持开启。
