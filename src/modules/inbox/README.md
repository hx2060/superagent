# inbox — 清单 / 便签编辑模块

日视图左侧「清单」（Inbox）与「便签」面板的新增、修改、删除；清单任务可选填写开始时间与持续分钟数，填写后会同步到该日时间表、周图与月视图；也可带可选的截止日期（如 `2026-11-08`），在行内显示为「截止 11月8日 周日」。

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
| `addTask({ id?, title, icon?, date?, start?, duration?, due? })` | 新增任务；标题去空白、默认 `📝`、初始 `todo`；`id` 可显式指定（须唯一），时间与截止日期可选 |
| `updateTask(id, { title?, icon?, date?, start?, duration?, due? })` | 修改任务，保留当前状态；时间字段清空即移出时间表，`due` 传空即清除截止日期 |
| `deleteTask(id)` | 删除任务 |
| `taskStatus(id)` / `setTaskStatus(id, status)` / `cycleTaskStatus(id)` | 三态读取、设置、循环 |
| `taskProgress()` | `{ total, todo, partial, done, percent }` |
| `listCalendarEvents(date)` | 该日定时任务转换成的时间表事件（`teal` 色、备注含状态），无时间任务不返回 |
| `listNotes(date?)` | 返回指定日期（缺省全部）的便签副本 |
| `addNote({ date, text })` | 新增当日便签；`tone` 按当天数量轮换 `yellow → pink → blue` |
| `updateNote(id, { text? })` | 修改便签文本，保留日期 / 颜色 / 倾斜 |
| `deleteNote(id)` | 删除便签 |
| `subscribe(listener)` | 变更订阅，返回取消函数 |

校验失败抛出 `Error`，`error.code` 为 `INBOX_TASK_TITLE_INVALID`、`INBOX_NOTE_TEXT_INVALID`、`INBOX_NOTE_DATE_INVALID`、`INBOX_TASK_SCHEDULE_INVALID`、`INBOX_TASK_DUE_INVALID`、`INBOX_TASK_DUPLICATE_ID`、`INBOX_TASK_NOT_FOUND`、`INBOX_NOTE_NOT_FOUND`、`INBOX_TASK_STATUS_INVALID`。

约束：任务标题 1–80 字符，便签 1–200 字符；日期使用 `YYYY-MM-DD`；开始时间 `HH:mm`，范围 07:00–20:59；持续时间为 5–720 分钟整数，且结束时间不晚于 21:00。`start` 与 `duration` 必须成对出现；都不填表示只留在清单。`due` 可选，必须是真实的 `YYYY-MM-DD`；只用于展示，不影响任务日期、状态或时间表。

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
| `[data-task-due="YYYY-MM-DD"]` | 任务行内的截止日期标签；仅在任务带 `due` 时出现 |

编辑状态保存在模块内部，触发 store 变更后整块面板重绘；焦点与 `aria-live` 播报在每次重绘后恢复。

## 不变量与限制

- 只操作 `context.root`；样式前缀 `.mod-inbox-`。
- 未填时间的任务属于全局未排期 Inbox，不绑定日期；填写开始 / 持续后绑定日期（新增时取当前日视图日期，编辑已有定时任务时保留原日期），并同步到该日时间表、周图与月视图；只填 `due` 的任务在截止日进入周 / 月视图。
- 便签按锚点日期展示与新增。
- 时间表事件由主干渲染；模块通过 `services.inbox.listCalendarEvents(date)` 提供派生事件，主干的 store 订阅负责刷新周条与时间表，不重挂侧栏。周图模块直接订阅同一个 store。
- 数据只在当前页面会话有效，刷新后回到 `local/schedule.json` 或 `src/data.js` 的初始值；持久化内容写入本地文件（不提交），后端接入见 `docs/integration.md`。
- 删除为两步确认，不提供撤销。
- 不提供修改定时任务日期的入口；日期在新增 / 首次填写时间时确定。
- 截止日期当前通过种子数据或 store API 写入并在行内展示；新增 / 编辑表单尚未提供日期输入，UI 内不能修改或清除已有截止日期。
