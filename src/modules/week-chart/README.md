# week-chart — 周视图任务 × 时间方块图

周视图把清单任务按行展开：纵轴是任务，横轴是周一到周日，方块从任务开始日跨到截止日；只有截止日期的任务从今天画到截止日（截止日已过时占截止当天）；没有截止日的任务只占开始当天。方块起止日由 `src/tasks.js` 的 `taskWindow` 统一计算。方块内显示准确时间或截止日，行标签显示时间 / 截止信息，任务行可直接切换三态。图表上方是**逾期回顾区**：截止已过且未删除的任务按「逾期未完成 / 已完成」分组（`taskReviewGroups`，与月视图横幅共用），可切换状态，保留至删除，不计入本周进度。

## 文件

```
index.js            mount(context)：整周渲染、状态切换、日期跳转
chart.js            纯几何：taskChartBar / eventChartBar / buildWeekChart
styles.css          .mod-week-chart-* 样式
__tests__/          node:test
README.md           本文件
```

## 输入

```ts
mount({
  root,                          // 周视图 [data-module-root="week-chart"] 槽位
  state: { view: 'week', anchor }, // 锚点日期，决定显示哪一周
  data: { events, tasks },       // 事件快照；tasks 主要用于无 service 时的回退
  services: { inbox },           // 任务实时读取 + 状态切换
})
```

- `services.inbox.listTasks()` 返回与清单同一份任务；模块不维护第二份任务数据。
- `services.inbox.cycleTaskStatus(id)` 用于行内三态切换；成功后 store 订阅触发重绘。
- `data.events` 是 `CalendarEvent[]`；定时日程也各占一行，只读。

## 输出

```js
mount(context) -> { update?(nextContext), destroy() }
```

`destroy()` 移除点击监听、`services.inbox` 订阅并清空 root。

## 布局规则

| 任务数据 | 方块 |
| --- | --- |
| `date` + `start` + `duration` | 占 `date` 当天 |
| `date` + `due`（`due > date`） | 从 `date` 跨到 `due`（含） |
| 只有 `due` | 从今天到 `due` 的长块（`due` 已过时占 `due` 当天） |
| 无 `date` / `due` | 不显示（留在日视图 Inbox） |

- `left` / `width` 以整周为 0–1；跨周的任务裁剪到本周，并用 `clippedStart` / `clippedEnd` 标记。只有 `due` 的任务以今天为起点；今天不在本周时裁剪到可见周起点。
- 行按开始位置、方块宽度、标题排序；`summary` 统计本周任务 `done / total`。
- `overdue` 在 `due < 今天` 且未完成时为 `true`。
- 方块 / 标题点击使用 `data-open-date`，由主干统一进入对应日视图；状态切换使用 `data-task-toggle`，与清单契约一致。

## DOM 契约

`[data-module-root="week-chart"]`、`[data-week-chart-row]`、`[data-week-chart-bar]`、`[data-week-chart-progress]`、`[data-week-chart-live]`、`[data-task-toggle]`、`[data-open-date]`。

## 不变量

- 只操作 `context.root`；样式前缀 `.mod-week-chart-`。
- 只读 `services.inbox` / `context.data.events`，不修改全局状态，不 import `src/app.js` 或其它模块内部文件。
- 日期使用本地 `YYYY-MM-DD`；时间使用 `HH:mm`；周窗口 07:00–21:00 只作为任务时间字段的约束，方块本身按天定位。
- 具体任务内容来自本地内容文件或运行时 API，不写入仓库。
