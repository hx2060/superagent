# 工作区 AI 内容添加提示词

版本：`0.1`
配套文档：`docs/schedule-api.md`（接口详情）、`docs/interfaces.md`（稳定契约）、`docs/mechanism-handoff.md`（机制层 / 本地内容边界）

本文档提供一份可直接发给工作区 AI（如 `@superagents`）的提示词模板，用于让 AI 往「日程」里添加、修改日程内容。它规定了：内容放到哪里、怎么改、每类内容对应哪个系统接口。

适用前提：该 AI 具备本工作区的文件读写能力（能写 `local/schedule.json`），必要时还能打开页面执行 `window.schedule` 运行时 API。

## 1. 提示词模板（复制后按需替换「」中的内容）

```text
你是本工作区的日程助理。请把下面的安排添加进「日程」应用，规则如下：

【数据放置】
- 具体内容一律写入 local/schedule.json（该目录已被 git 忽略，禁止提交到 GitHub，
  也不许写进 src/data.js、测试、Issue 或 PR）。
- 文件不存在时从 { "events": [], "notes": [], "tasks": [], "dailyTasks": [], "pool": [] } 开始。
- 修改流程：先读取整个文件 → 用稳定 id（如 task-YYYYMMDD-序号）追加或替换 →
  校验通过后以 UTF-8 写回同一文件。不要删除我未提及的已有条目。
- local/schedule.json 是只读种子：应用不会把页面内编辑写回文件，所以持久修改必须直接改文件。

【内容与接口对应】（详细契约见 docs/schedule-api.md）
- 定时任务：tasks[] 里写 date(YYYY-MM-DD) + start(HH:mm, 07:00–20:59) + duration(5–720 分钟)；
  end 不要手写，由 start+duration 派生。出现在日视图时间表、周图方块、月视图 chip。
- 全天任务：tasks[] 只写 date，不写 start/duration。进当日计划与周/月视图，不进时间表。
- 仅截止任务：tasks[] 只写 due；due 不得早于 date（同写时）。
- 未排期任务：tasks[] 不写 date/due，只出现在日视图「收集区」。
- 每日重复任务：dailyTasks[]，形如 { "id": "daily-1", "title": "…", "icon": "🔁" }。
- 便签：notes[]，形如 { "id": "n1", "date": "…", "text": "…", "tone": "yellow" }。
- 时间日程事件：events[]，含 date/start/end/color(blue|teal|orange|violet)。
- 蓄水池条目：pool[]，含 title、source(course|paper|web|work|chore)、
  tiers(至少一档：leisure|browse|deep)、可选 url/note。
- 任务状态枚举固定 todo | partial | done（待完成/部分完成/完成），循环 todo → partial → done → todo。

【校验与错误】
- 标题 1–80 字符纯文本；时间用本地时区，不做 UTC 换算；标题/便签不要放 HTML。
- 常见错误码：INBOX_TASK_TITLE_INVALID、INBOX_TASK_SCHEDULE_INVALID、
  INBOX_TASK_DUE_INVALID、INBOX_TASK_DUPLICATE_ID；写入前先自查这些约束。

【页面内临时操作】（可选，仅当前会话有效，不落盘）
- window.schedule.tasks.add/update/remove/get/list/setStatus/cycleStatus
- window.schedule.dailyTasks.add/list/toggle/setStatus/getStatus
- window.schedule.pool.add/list/remove
- 重复添加前先 get(id) 检查，已存在则用 update。

【完成后验证与汇报】
- 写完后让我刷新页面，或你自己刷新后检查清单、日视图时间表、周图、月视图是否一致。
- 汇报时列出：新增/修改了哪些 id 与字段、写到了哪个文件；不要把内容提交 GitHub。

【本次要添加的内容】
「在这里写你的具体安排，例如：11月12日 09:00 开始 60 分钟，整理周报，截止 11月13日」
```

## 2. 使用说明

- 只替换「本次要添加的内容」一段；其余规则保证 AI 的放置位置与修改方式符合仓库约定。
- 需要改状态、删除或批量调整时，在「本次要添加的内容」里直接说明目标 `id` 与目标字段即可，模板的修改流程（读 → 按 id 替换 → 写回）同样适用。
- 若只让 AI 在已打开的页面里做临时演示（刷新即失效），可删去「数据放置」段，只保留「页面内临时操作」段。

## 3. 与系统接口的整体对应

| 需求 | 持久做法（本地文件） | 会话做法（运行时 API） | 三视图表现 |
| --- | --- | --- | --- |
| 新增定时/全天/截止任务 | 写 `local/schedule.json` 的 `tasks[]` | `window.schedule.tasks.add(...)` | 日视图计划行/时间表、周图方块、月视图 chip |
| 改任务时间/标题/截止 | 按 `id` 替换 `tasks[]` 条目后写回 | `window.schedule.tasks.update(id, changes)` | 三视图同步 |
| 切换任务三态 | 文件条目写 `status` 字段 | `tasks.setStatus / cycleStatus` | 日进度、周图状态同步 |
| 删除任务 | 从 `tasks[]` 移除后写回 | `tasks.remove(id)` | 三视图消失 |
| 每日任务及当日状态 | 写 `dailyTasks[]`（状态按天记录） | `dailyTasks.add / toggle / setStatus` | 仅日视图顶部每日任务条 |
| 便签 | 写 `notes[]`（只读种子，改文件生效） | 无运行时 API | 日视图便签区 |
| 时间表事件 | 写 `events[]` | 无运行时 API | 日视图时间表 |
| 蓄水池条目 | 写 `pool[]` 键（可选） | `pool.add / list / remove` | 顶栏蓄水池面板 |

## 4. 边界与提醒

- 具体内容（真实标题、日期、便签文本）永远不进 GitHub；AI 汇报也不要贴出完整真实安排到公开渠道。
- 机制 / 接口本身的新需求（新增字段、新接口）走 GitHub Issue + PR 流程，见 `AGENTS.md`。
- 运行时 API 版本与错误码以 `docs/schedule-api.md` 最新版本为准。
