# AGENTS.md — 日程项目协作规则

本文件约束「日程」项目后续的所有开发（人类或自动化）。如果与需求方的最新明确指令冲突，以最新明确指令为准，并在 PR 中记录例外。

## 1. 项目与主干

「日程」是零依赖静态日历，当前主干提供：

- 月 / 周 / 天三种视图与日期导航、视图切换、键盘快捷键、`?view=&date=` 深链。
- 日视图：周条、时间表、便签、任务清单，任务支持 `待完成 / 部分完成 / 完成` 三态切换。
- 空白数据启动（示例内容已清空，通过 UI 新增），无后端、无持久化。

**主干文件**：

```
index.html                    页面骨架、工具栏
assets/styles.css             全局与三视图样式
src/app.js                    应用控制器、视图分发、交互
src/calendar.js               纯日期 / 布局逻辑
src/tasks.js                  任务三态与进度统计
src/data.js                   空白种子数据（首次加载无示例内容）
docs/interfaces.md            接口说明
docs/integration.md           对接文档
```

主干默认冻结：

- 新功能不得直接修改主干布局、交互、数据结构或样式体系。
- 只有以下情况允许改主干：需求方**明确要求修改主干**；修复主干缺陷；按本文规定的接口登记点做最小接入。
- 任何主干修改都必须在 Issue / PR 中说明需求来源、影响面、兼容性与验证方式。

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
 *   data: { events: CalendarEvent[], notes: StickyNote[], tasks: Task[] },
 *   services: Record<string, Function>
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
- 当前主干提供最小 `services` 注入（已有 `services.inbox`），但没有通用注册器；需要共享状态的模块先提交最小 `services` 接口提案，不能直接 `import` `src/app.js` 的内部符号。
- 新视图 / 新模块在主干的注册点只允许是一行注册改动；注册改动需在 PR 中标注为“接口登记点”，并附接口文档更新。
- 模块必须自测，并在 PR 中给出 1440 / 1024 / 768 / 390 宽度下的截图或说明。

## 3. 接口与数据契约

- 数据模型、模块 API、DOM 契约、URL 参数统一记录在 `docs/interfaces.md`。
- 后端 / 外部系统接入方式记录在 `docs/integration.md`。
- 数据模型只做**增量**变更：新增字段必须可选；不得重命名或删除已发布字段，除非显式升级接口版本并在 PR 中说明迁移方案。
- 任务状态枚举固定为 `todo | partial | done`，中文展示为 `待完成 / 部分完成 / 完成`；状态循环顺序固定为 `todo → partial → done → todo`。
- 任务清单默认是**未排期 Inbox**，不绑定日期；任务填写可选开始时间与持续分钟后绑定该日，并同步到日视图时间表。时间表事件与定时任务都绑定日期与起止时间。
- 示例数据不得包含真实用户隐私、飞书私有内容、凭据或 token。

## 4. 合并流程

1. 在 GitHub Issue（当前为 #2）或需求方消息中确认需求。
2. 使用 `agent/<ticket-name>` 分支；提交保持聚焦。
3. 新增/修改模块、接口文档、测试、截图。
4. PR 描述写明：改了什么、接口/数据是否有变、如何验证、Before/After 截图、关联 Issue。
5. 等人 review 后合并；自动化代理不自行合并、不开启 auto-merge。
6. 除非需求方明确要求，跟踪 Issue 保持开启，作为后续指令入口。

## 5. 质量门禁

- `npm test` 必须通过；新增纯逻辑必须有 node:test 覆盖。
- 浏览器交互检查：三视图、导航、视图切换、任务状态、深链、空状态、无 console error、1440 / 1024 / 768 / 390 无横向溢出。
- UI 改动必须在 PR 中提供同视口、同主题、同场景的 Before/After 截图；没有真实旧 UI 时，如实说明基线状态。
- 保持零运行时依赖、无构建步骤；不引入 CDN、外部字体或需要联网的资源。
- 不提交本地设计备选、临时预览文件或截图生成脚本的私有产物。

## 6. 公共预览与敏感信息

- 公网预览必须使用仓库的**脱敏副本**，不得暴露 `.git`、`.design-local`、`docs`、测试或本机路径。
- 预览为临时用途，需记录 URL、目录、创建时间和清理时间；到期删除。
- 仓库、Issue、PR、截图与预览中不得出现飞书私有内容、凭据、token 或真实用户数据。

## 7. 当前扩展点

- **数据源**：替换 `src/data.js` 或按 `docs/integration.md` 接入 DataSource；不在视图模块里直接 `fetch`。
- **新视图**：按模块契约新增；注册点改动需评审。
- **任务状态持久化**：由数据源 / services 提供，不在 UI 模块内散落存储逻辑。
- **清单 / 便签 CRUD**：已由 `src/modules/inbox` 提供（新增、修改、删除；页面会话内有效，无持久化）；清单任务可选时间并同步到日视图时间表。持久化仍由数据源 / services 提供。
- **日程 CRUD、提醒、协作、多日历、时区**：当前范围外；需要需求方明确立项后再做。
