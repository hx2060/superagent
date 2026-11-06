# inbox — 清单 / 便签编辑模块

日视图左侧「清单」（Inbox）与「便签」面板的新增、修改、删除；清单任务可选填写开始时间与持续分钟数，填写后会同步到该日时间表。

## 挂载

主干在日视图的 `.day-sidebar` 上保留一个注册点：

```html
<aside class="day-sidebar" data-module-root="inbox"></aside>
```

`src/app.js` 在日视图渲染后调用：

```js
mountInbox({
  root: root.querySelector('[data-module-root="inbox"]'),
  state: { view: state.view, anchor: new Date(state.anchor) },
  data: { events, notes, tasks },
  services: { inbox },
});
```

`services.inbox` 由 `createInboxStore(...)` 创建，整个页面会话共用；切换视图只会 `destroy()` / 重新 `mount()`，数据保留在 store 中。样式通过 `index.html` 中的一行 `<link>` 加载。

## 接口

### `createInboxStore({ tasks, notes, idFactory })`

纯内存 store，不访问 DOM。方法：

| 方法 | 说明 |
| --- | --- |
| `listTasks()` | 返回带当前状态的任务副本，按加入顺序；定时任务同时带派生的 `end` |
| `addTask({ title, icon?, date?, start?, duration? })` | 新增任务；标题去空白、默认 `📝`、初始 `todo`；时间可选 |
| `updateTask(id, { title?, icon?, date?, start?, duration? })` | 修改任务，保留当前状态；时间字段清空即移出时间表 |
| `deleteTask(id)` | 删除任务 |
| `taskStatus(id)` / `setTaskStatus(id, status)` / `cycleTaskStatus(id)` | 三态读取、设置、循环 |
| `taskProgress()` | `{ total, todo, partial, done, percent }` |
| `listCalendarEvents(date)` | 该日定时任务转换成的时间表事件（`teal` 色、备注含状态），无时间任务不返回 |
| `listNotes(date?)` | 返回指定日期（缺省全部）的便签副本 |
| `addNote({ date, text })` | 新增当日便签；`tone` 按当天数量轮换 `yellow → pink → blue` |
| `updateNote(id, { text? })` | 修改便签文本，保留日期 / 颜色 / 倾斜 |
| `deleteNote(id)` | 删除便签 |
| `subscribe(listener)` | 变更订阅，返回取消函数 |

校验失败抛出 `Error`，`error.code` 为 `INBOX_TASK_TITLE_INVALID`、`INBOX_NOTE_TEXT_INVALID`、`INBOX_NOTE_DATE_INVALID`、`INBOX_TASK_SCHEDULE_INVALID`、`INBOX_TASK_NOT_FOUND`、`INBOX_NOTE_NOT_FOUND`、`INBOX_TASK_STATUS_INVALID`。

约束：任务标题 1–80 字符，便签 1–200 字符；日期使用 `YYYY-MM-DD`；开始时间 `HH:mm`，范围 07:00–20:59；持续时间为 5–720 分钟整数，且结束时间不晚于 21:00。`start` 与 `duration` 必须成对出现；都不填表示只留在清单。

### `mount(context)`

返回 `{ update, destroy }`。只读写 `context.root` 内部；不 import `src/app.js` 的内部符号，不写全局状态。

## DOM 契约

沿用主干稳定选择器：`[data-task-row]`、`[data-task-toggle]`、`[data-task-progress-text]`、`[data-task-progress-fill]`、`[data-task-live]`；新增：

| 选择器 | 用途 |
| --- | --- |
| `[data-note-row="<id>"]` | 便签卡片 |
| `[data-inbox-add-task]` / `[data-inbox-add-note]` | 打开新增表单 |
| `[data-inbox-edit-task="<id>"]` / `[data-inbox-edit-note="<id>"]` | 进入行内编辑 |
| `[data-inbox-delete-task="<id>"]` / `[data-inbox-delete-note="<id>"]` | 删除；第一次点击变为「确认删除」 |
| `[data-inbox-task-form="new" \| "<id>"]` | 新增 / 编辑任务表单 |
| `[data-inbox-note-form="new" \| "<id>"]` | 新增 / 编辑便签表单 |
| `[data-inbox-task-add-input]` 等 | 表单输入框 |
| `[data-inbox-task-add-start]` / `[data-inbox-task-add-duration]` | 新增任务的开始时间 / 持续分钟（可选） |
| `[data-inbox-task-edit-start]` / `[data-inbox-task-edit-duration]` | 编辑任务的时间字段 |
| `[data-task-row][data-scheduled="true"]` | 已填写时间、同步到时间表的任务行 |

编辑状态保存在模块内部，触发 store 变更后整块面板重绘；焦点与 `aria-live` 播报在每次重绘后恢复。

## 不变量与限制

- 只操作 `context.root`；样式前缀 `.mod-inbox-`。
- 未填时间的任务属于全局未排期 Inbox，不绑定日期；填写开始 / 持续后绑定日期（新增时取当前日视图日期，编辑已有定时任务时保留原日期），并同步到该日时间表。
- 便签按锚点日期展示与新增。
- 时间表事件由主干渲染；模块通过 `services.inbox.listCalendarEvents(date)` 提供派生事件，主干的 store 订阅负责刷新时间表，不重挂侧栏。
- 数据只在当前页面会话有效，刷新后回到 `src/data.js` 的空白初始值；持久化与后端接入见 `docs/integration.md`。
- 删除为两步确认，不提供撤销。
- 不提供修改定时任务日期的入口；日期在新增 / 首次填写时间时确定。
