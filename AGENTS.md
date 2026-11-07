# AGENTS.md — 日程项目协作规则

本文件约束「日程」项目后续的所有开发（人类或自动化）。如果与需求方的最新明确指令冲突，以最新明确指令为准，并在 PR 中记录例外。

## 1. 项目与主干

「日程」是零依赖静态日历，当前主干提供：

- 月 / 周 / 天三种视图与日期导航、视图切换、键盘快捷键、`?view=&date=` 深链。
- 周视图：**任务 × 时间方块图**（纵轴任务、横轴 7 天、方块表示开始到截止的区间），支持在周内切换任务状态。
- 日视图：周条、时间表、便签、任务清单，任务支持 `待完成 / 部分完成 / 完成` 三态切换。
- 月 / 周 / 日共用同一份清单任务：定时任务进入日视图时间表、周图与月视图日期格；只有截止日期的任务在截止日展示。
- 空白数据启动（示例内容已清空，通过 UI 新增），无后端；具体日程内容放在本地内容文件，不提交仓库。

**主干文件**：

```
index.html                    页面骨架、工具栏、模块样式入口
assets/styles.css             全局与月 / 日视图样式
src/app.js                    应用控制器、视图分发、交互、window.schedule
src/calendar.js               纯日期 / 布局逻辑
src/tasks.js                  任务三态与进度统计
src/data.js                   空白种子 + 本地内容读取（无真实内容）
src/modules/week-chart/       周视图任务 × 时间方块图（store 无关，读 services.inbox）
docs/interfaces.md            接口说明
docs/integration.md           对接文档
docs/schedule-api.md          机器人添加日程接口
docs/mechanism-handoff.md     机制层 / 本地内容边界
```

主干默认冻结：

- 新功能不得直接修改主干布局、交互、数据结构或样式体系。
- 只有以下情况允许改主干：需求方**明确要求修改主干**；修复主干缺陷；按本文规定的接口登记点做最小接入。
- 任何主干修改都必须在 Issue / PR 中说明需求来源、影响面、兼容性与验证方式。
- 本次周视图与月 / 周 / 日任务统一属于需求方明确要求的主干修改；详细背景见 PR。

## 2. 模块化开发

后续功能默认以模块组织，放在 `src/modules/<module-name>/`：

```
src/modules/<module-name>/
  index.js        模块入口，导出 mount(context)
  README.md       模块接口说明：输入、输出、依赖、不变量
  styles.css      可选；类名必须带 .mod-<module-name>- 前缀
  __tests__/      可选；模块单测
```

模块入口契约：

```js
/**
 * @param {{
 *   root: HTMLElement,
 *   state: Readonly<{ view: 'month'|'week'|'day', anchor: Date }>,
 *   data: { events: CalendarEvent[], notes: StickyNote[], tasks: Task[], dailyTasks?: DailyTask[] },
 *   services: { dailyTasks?: DailyTasksService, inbox?: InboxService, [name: string]: unknown }
 * }} context
 * @returns {{ update?: (context: object) => void, destroy?: () => void }}
 */
export function mount(context) {
  // 只操作 context.root 内部；不要直接读写 app.js 内部变量。
}
```

规则：

- 模块只依赖 `context` 和公开的纯函数（`src/calendar.js`、`src/tasks.js`）；不得 import 另一个模块的内部文件。
- 模块不得直接修改全局状态或其它模块的 DOM；共享状态通过 `services` 或数据快照传递。
- 模块样式必须命名空间化，禁止修改全局 `button`、`div` 等选择器。
- `services` 由主干按模块提案逐步导出；当前已导出 `services.dailyTasks` 与 `services.inbox`。新模块需要共享能力时先提交最小接口提案，不能直接 `import` `src/app.js` 的内部符号。
- 新视图 / 新模块在主干的注册点保持最小：视图槽位、`mount` / `destroy` 生命周期、必要的 `services` 导出与样式入口；注册改动需在 PR 中标注为“接口登记点”，并附接口文档更新。
- 模块必须自测，并在本地按 1440 / 1024 / 768 / 390 宽度验证；证据只保留在 `local/evidence/`，不入仓库、不进 PR。

## 3. 接口与数据契约

- 数据模型、模块 API、DOM 契约、URL 参数统一记录在 `docs/interfaces.md`。
- 后端 / 外部系统接入方式记录在 `docs/integration.md`。
- 机器人 / 自动化添加日程的方式记录在 `docs/schedule-api.md`。
- 数据模型只做**增量**变更：新增字段必须可选；不得重命名或删除已发布字段，除非显式升级接口版本并在 PR 中说明迁移方案。
- 任务状态枚举固定为 `todo | partial | done`，中文展示为 `待完成 / 部分完成 / 完成`；状态循环顺序固定为 `todo → partial → done → todo`。
- 任务清单默认是**未排期 Inbox**，不绑定日期；任务填写开始时间与持续分钟后绑定该日，并同步到日视图时间表、周图与月视图。只填截止日期的任务在截止日展示，不进入时间表。
- 时间表事件与定时任务都绑定日期与起止时间；周图与月视图读取同一份任务数据，不维护第二份副本。
- 示例数据不得包含真实用户隐私、飞书私有内容、凭据或 token；具体日程内容只放 `local/schedule.json`。

## 4. 合并流程

1. 在 GitHub Issue（当前为 #2）或需求方消息中确认需求。
2. 使用 `agent/<ticket-name>` 分支；提交保持聚焦。
3. 新增 / 修改模块、接口文档、测试；具体内容不提交。
4. PR 描述写明：改了什么、接口 / 数据是否有变、如何验证（文字记录场景 / 视口 / 结果）、关联 Issue；**不贴截图、不写具体日程内容**。
5. 等人 review 后合并；自动化代理不自行合并、不开启 auto-merge。
6. 除非需求方明确要求，跟踪 Issue 保持开启，作为后续指令入口。
7. 视觉证据按 `docs/mechanism-handoff.md` 留在本地，PR 只给文字结论；没有真实基线时如实说明。

## 5. 质量门禁

- `npm test` 必须通过；新增纯逻辑必须有 node:test 覆盖。
- 浏览器交互检查：三视图、导航、视图切换、任务状态、深链、空状态、无 console error、1440 / 1024 / 768 / 390 无页面横向溢出；宽图表允许自身容器内滚动。
- UI 改动在本地提供同视口、同主题、同场景的 Baseline / After 证据，保存在 `local/evidence/`；PR 用文字说明对比结果与基线状态。
- 保持零运行时依赖、无构建步骤；不引入 CDN、外部字体或需要联网的资源。
- 不提交本地设计备选、临时预览文件、截图 / 录屏或截图生成脚本的私有产物。
- 仓库与 PR 不提交任何图片；`.gitignore` 忽略 `docs/screenshots/`、`local/` 与常见图片后缀。

## 6. 公共预览与敏感信息

- 公网预览必须使用仓库的**脱敏副本**，不得暴露 `.git`、`.design-local`、`.local`、`local`、`docs`、测试或本机路径。
- 预览为临时用途，需记录 URL、目录、创建时间和清理时间；到期删除。
- 仓库、Issue、PR 与预览中不得出现飞书私有内容、凭据、token、真实用户数据或截图。
- 具体日程内容只放本地；预览使用空白种子或中性占位数据。

## 7. 当前扩展点

- **数据源**：`src/data.js` 的空白种子 + 可选 `local/schedule.json`；页面启动时读取本地内容，缺失则空白。接入真实后端时按 `docs/integration.md` 替换 DataSource；不在视图模块里直接 `fetch`。
- **周视图**：`src/modules/week-chart/`；方块几何与排序在 `chart.js`，UI 在 `index.js`，只读 `services.inbox` 与 `context.data.events`。
- **每日任务**：`src/modules/daily-tasks/`；日视图通过 `[data-module-root="daily-tasks"]` 接入，共享状态走 `services.dailyTasks`，dsh 输入见 `docs/schedule-api.md`。
- **新视图**：按模块契约新增；注册点改动需评审。
- **任务状态持久化**：由数据源 / services 提供，不在 UI 模块内散落存储逻辑。
- **清单 / 便签 CRUD**：已由 `src/modules/inbox` 提供（新增、修改、删除；页面会话内有效）；清单任务可选时间并同步到日 / 周 / 月，也可带可选截止日期；持久化由本地内容文件或后续数据源提供。
- **日程 CRUD、提醒、协作、多日历、时区**：当前范围外；需要需求方明确立项后再做。

## 8. 机制层与本地内容分离

- **仓库只提交机制层**：视图、模块、纯函数、数据契约、接口文档、测试、空白种子、协作规则。
- **具体内容留本地**：任务 / 便签 / 每日任务实例、真实日期与时间、截图与录屏。应用读取 `local/schedule.json`；该目录已被 `.gitignore` 忽略。
- **两份交接文档**：`docs/mechanism-handoff.md`（GitHub 机制层）与 `local/本地内容交接.md`（本地内容，不提交）。
- **机器人添加工作**：按 `docs/schedule-api.md` 写本地内容或调用 `window.schedule`，不要把内容改到 `src/data.js` 或提交到 GitHub。
- 任何需要打破该分工的变更，先由需求方确认，并在 PR 中记录例外与原因。
