# daily-tasks · 每日重复任务

日视图顶部的「每日任务」条：任务定义每天重复出现，完成状态按本地日期分别记录，支持 `待完成 → 部分完成 → 完成` 三态切换与进度统计。

## 文件

```
index.js            mount(context) 与 UI 渲染 / 事件处理
store.js            纯逻辑：任务定义、按日状态、订阅（无 DOM）
styles.css          命名空间样式（.mod-daily-tasks-*）
__tests__/          node:test 单测
README.md           本文件
```

## 输入

```ts
interface DailyTask {
  id: string;              // 集合内唯一
  title: string;           // 纯文本，渲染时转义；1–80 字符
  icon?: string;           // 缺省 🔁，最多 8 个 code point
  recurrence: 'daily';     // 固定每日重复
}
```

`mount(context)`：

- `context.root`：日视图中的 `[data-module-root="daily-tasks"]` 槽位；模块只操作这个节点内部。
- `context.state.anchor`：当前日视图锚点日期，用于读取/记录当天的完成状态。
- `context.services.dailyTasks`：主干预先创建的 store，接口见下。
- `context.data.dailyTasks`：当前任务定义快照（模块目前直接使用 `services.dailyTasks`，保留快照字段以符合模块契约）。

## 输出

```js
mount(context) -> {
  update(nextContext),   // 同一 root 下更新锚点并重绘
  destroy(),             // 退订并清空 root
}
```

模块在日视图中渲染：

- 「每日任务」标题、当天完成进度、进度条；
- 任务胶囊：图标、标题、三态状态、状态切换圆点；
- `＋ 添加` 手工入口：展开输入框，提交后调用 `services.dailyTasks.addTask`；
- `role="alert"` 错误提示与 `aria-live="polite"` 状态播报。

## store 接口

`createDailyTaskStore(seedTasks, options)` 返回：

| 方法 | 说明 |
| --- | --- |
| `addTask({ id?, title, icon? })` | 新增每日任务；成功返回任务副本，失败抛带 `code` 的 `Error` |
| `listTasks()` | 返回全部定义副本 |
| `listForDate(dateKey)` | `[{ task, status }]`，`dateKey` 为 `YYYY-MM-DD` |
| `getStatus(taskId, dateKey)` | 当天状态，缺省 `todo` |
| `setStatus(taskId, dateKey, status)` | 写入当天状态；状态必须是 `todo / partial / done` |
| `toggleStatus(taskId, dateKey)` | 按 `todo → partial → done → todo` 循环 |
| `statusCounts(dateKey)` | `{ total, todo, partial, done, percent }`，复用 `src/tasks.js` |
| `subscribe(listener)` | 返回退订函数；新增/状态变化时通知 |

`createId` 选项用于测试注入确定性 id。错误码：`DAILY_TASK_INVALID`、`DAILY_TASK_DUPLICATE_ID`、`DAILY_TASK_NOT_FOUND`、`DAILY_TASK_STATUS_INVALID`、`DAILY_TASK_DATE_INVALID`。

## 两个添加入口

1. **dsh 下发**
   - 持久方式：在 `src/data.js` 的 `sampleDailyTasks` 中追加定义，刷新后加载；随仓库版本管理。
   - 运行时方式：`window.schedule.dailyTasks.add({ title, icon? })`。完整 API 与示例见 `docs/interfaces.md`。
2. **日历内手工添加**
   - 日视图顶部「每日任务」条 → `＋ 添加` → 输入名称 → `加入`。
   - 只填写标题，图标使用默认 `🔁`；`Esc` 或「取消」收起表单。

## 数据与不变量

- 每日任务是**重复定义**，不绑定具体日期，不进入时间表；它与未排期 Inbox 的 `Task` 是两个集合。
- 完成状态按 `YYYY-MM-DD` 隔离：同一天内切换，跨天重新从 `todo` 开始；切回旧日期可看到旧记录。
- 当天进度只统计 `done / total`，与主干任务清单口径一致。
- 所有文本按纯文本转义；不写入 HTML、不读取凭据。
- 手工添加与运行时 API 新增的任务仅存在当前页面会话；刷新后回到 `sampleDailyTasks` 初始定义。这是当前无后端 / 无持久化基线的限制，不是 store 契约的一部分。
- 模块不修改全局 `button` 等元素样式；类名均为 `.mod-daily-tasks-*`。

## 注册点（主干改动）

- `src/app.js`：
  - 引入 `createDailyTaskStore` / `mount`，创建唯一 store；
  - 日视图 `renderDay()` 中一行 `<div data-module-root="daily-tasks"></div>` 槽位；
  - `render()` 中在进入日视图后 `mount`，重绘前 `destroy`；
  - `window.schedule.dailyTasks` 作为 dsh 运行时接口。
- `index.html`：一行 `<link rel="stylesheet" href="./src/modules/daily-tasks/styles.css" />`。
- `src/data.js`：新增 `sampleDailyTasks` 导出（增量，不改动原字段）。

## 测试与验收

- `npm test` 覆盖 store 的校验、按日隔离、三态循环、进度、订阅与错误码。
- 浏览器验证：1440 / 1024 / 768 / 390 无横向溢出；三视图切换、日期导航、手工添加、空输入错误、`Esc`、dsh API、跨日重置、刷新后会话数据回退均已检查。
- Before / After 截图见 `docs/screenshots/daily-tasks-*.png`。
