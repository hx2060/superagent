# 蓄水池第二迭代：进度与反馈追踪 ＋ 美工备选调研（方案稿）

> **状态：方案稿，只做方案与备选，不写实现代码。** 需求方诉求（2026-11-11，要点）：对蓄水池做修改，做出有效反馈，方便后续得到反馈信息、较好追踪对应内容的进度（内部一些任务更多具备进度属性）；同时可能更换美工——先交方案，最好多个方案，并调研是否有较好的可迁移的美工。
> 本稿分四部分：① 蓄水池「进度 + 反馈」候选方案与契约增量；② 美工备选调研；③ 待决定清单；④ 建议路径。选定后再按 `AGENTS.md` 接口登记点实现。

---

## 第一部分 · 蓄水池「进度 + 反馈」方案

### 1.1 需求拆解

- **反馈信息**：从池子的使用中读出信号——哪些条目被取用、哪档最常被选、哪些条目从未被点开（沉睡）、进度分布如何。这正接上 PR #8 设计讨论里暂缓的「取用记录」（当时约定首版不做、第二版再议，本次即第二迭代立项）。
- **进度追踪**：条目（尤其 `source=work` 的工作任务，接近「内部任务」）具备进度属性，可标记、可追踪；进度本身也是反馈的一类输入。
- **两者关系**：进度是**条目级状态**，反馈是**跨条目的汇总信号**；本稿把二者放进同一迭代，因为反馈指标依赖进度字段。

### 1.2 共同的数据契约增量（所有方案共用，纯增量、全部可选）

```ts
interface PoolItem {
  // ……既有字段不变（id/title/url/source/tiers/note/createdAt）
  progress?: 'todo' | 'partial' | 'done';  // 复用任务三态；省略 = 不跟踪
  progressUpdatedAt?: string;              // YYYY-MM-DD，进度最后变更日
}

interface PoolUseRecord {                  // 取用记录；只存本机，不入库
  at: string;                              // YYYY-MM-DD HH:mm（本地时间）
  kind: 'open' | 'expand';                 // 打开链接 / 展开详情
  tier: 'leisure' | 'browse' | 'deep';
  itemId: string;
  source: 'course' | 'paper' | 'web' | 'work' | 'chore';
}
```

- 兼容性：旧 `local/schedule.json` 的 `pool` 键无需迁移；坏 `progress` 值按种子容错跳过（与现有宽容读取一致）。
- 状态枚举沿用 `AGENTS.md` 固定的 `todo / partial / done`，循环顺序 `todo → partial → done → todo`，与任务一致，不造新枚举。
- 存储边界：记录与进度都在**本机**（浏览器存储或本地文件），与 `local/schedule.json` 同边界——不入库、不提交、不上传。

### 1.3 候选方案（按从小到大，可组合）

**方案 A · 会话内轻反馈（最小）**

- 做什么：会话内（内存）记录每次取用；面板新增「反馈」视图：本次会话取用次数、各档分布、沉睡条目（入池后从未被取用）。
- 契约变更：无新发布字段；store 内部记录 + `sessionStats()` 纯函数；`window.schedule.pool` 不变。
- 工作量：小（store 约 60 行 + 面板一个视图 + 单测）。
- 局限：刷新即失，无法跨天积累——与「后续能够从中得到反馈信息」有实质距离。

**方案 B · 本机持久反馈 + 条目进度（推荐）**

- A 的全部，外加：
  - **持久化**：取用记录与条目进度存本机浏览器存储（机制层，不提交）；`local/schedule.json` 的 `pool` 键可携带 `progress` 初值，启动时合并。
  - **条目进度**：行内三态循环按钮（与任务同一交互）；编辑表单内也可改；每次进度变更记一条进度日志。
  - **反馈视图指标**：总览（条目数 / 各档 / 各来源 / 进度分布）、近 7 日取用次数与档位分布、沉睡条目清单、进度停滞（`partial` 且 7 天无取用）、完成率。
- 契约增量（均为可选键 / 新方法，旧调用不受影响）：
  - store：`setItemProgress(id, progress)`、`useRecords()`、`progressLog(id)`、`stats(now)`；构造时注入 `storage` 适配器（最小 `get/set` 接口），宿主传浏览器存储适配器、测试传内存适配器——store 保持纯逻辑可测（符合「持久化由 services 提供、不在 UI 内散落」）。
  - dsh：`window.schedule.pool.setProgress` / `.stats()`；错误码沿用 + `POOL_PROGRESS_INVALID`。
  - DOM：`[data-attention-switch-progress="<id>"]`、`[data-attention-switch-feedback]`。
  - 记录上限：只保留最近 500 条，防止存储膨胀。
- 工作量：中（store 约 150 行含统计纯函数 + 进度控件 + 反馈视图 + 单测约 20 项 + 4 视口验证）。

**方案 C · B + 与清单的进度口径联动（本次建议不做）**

- 形式：B + 工作条目进度与清单任务状态互显（只读映射，方向需定：池 ← 清单，或清单 ← 池）。
- 代价：跨模块口径（任务三态语义、当日计划归属）需要单独设计确认；冲突规则（两边都改过）需要定义。
- 定位：列为第三迭代候选。若你希望「池里的工作条目就是清单任务的影子」，需要先确认联动方向与冲突规则，再立项。

### 1.4 方案对比

| 维度 | A 会话反馈 | B 持久反馈 + 进度（推荐） | C + 清单联动 |
| --- | --- | --- | --- |
| 刷新后记录 | 丢失 | 保留（仅本机） | 同 B |
| 条目进度 | 无 | 三态（可循环） | 三态 + 跨模块互显 |
| 主干改动 | 模块内 | 模块内 + `app.js` 传 storage 适配器（接口登记点） | 再加跨模块口径设计 |
| 新发布字段 | 无 | `progress` / `progressUpdatedAt`（可选） | 同 B |
| 新产品决策量 | 低 | 中（指标定义、记录上限） | 高（联动方向、冲突规则） |
| 相对工作量 | 1 | 2 | 4+ |
| 主要风险 | 反馈不可积累，白做 | 低（存储边界需写进文档） | 中（口径冲突） |

### 1.5 反馈指标定义（方案 B 的纯函数，实现时以 node:test 覆盖）

`poolStats(items, records, now)` 返回：

- `total` / `byTier` / `bySource` / `byProgress`：存量分布；
- `used7d` / `used7dByTier`：近 7 日取用（含当日）；
- `dormant`：入池至今从未被取用的条目；
- `stalePartial`：`partial` 且 7 天无取用记录的条目；
- `doneRatio`：完成率（有进度的条目中 `done` 占比）。

边界：无记录、无进度字段时全部指标有定义（0 / 空数组），不抛错；纯函数不读时钟以外的环境。

### 1.6 验证计划（实现时执行，非本稿范围）

- `npm test`：进度循环与校验、记录追加与 500 条上限、`poolStats` 全指标含空态、storage 内存注入、种子容错（坏 `progress` 跳过）。
- 浏览器（本地 headless，证据留 `local/evidence/`）：1440 / 1024 / 768 / 390 无页面横向溢出（含反馈视图展开态）；同视口同场景 Baseline / After 对比；进度循环与 aria-live 播报、Escape 与焦点回归、三视图回归、无 console error。
- 文档同步：`docs/interfaces.md`（契约 / DOM / UI）、`docs/schedule-api.md`（dsh 接口）、`docs/integration.md`、模块 `README.md`。

---

## 第二部分 · 美工备选调研（可迁移的设计）

### 2.1 现状盘点

- **令牌层已存在**：`assets/styles.css` 的 `:root`（`--bg` / `--surface` / `--accent` / `--radius-*` / `--shadow-card` / `--font` 等）；蓄水池面板与各模块样式全部读这些令牌——**令牌层就是现成的迁移缝**，换美工首先换令牌。
- **现状是两套并存**：月 / 周视图 = 蓝灰冷色（accent `#3370ff`、白卡、灰底）；日视图 = 珊瑚暖色纸质（`--d-coral` 系列、便签、渐变背景）；蓄水池面板跟随冷色令牌。
- **硬约束**（`AGENTS.md`）：零运行时依赖、无构建步骤、不引 CDN / 外部字体（只能用系统字体栈）；模块样式 `.mod-<name>-` 前缀、不改全局元素选择器；主干样式属主干，修改即主干修改，需需求方明确要求——你这条「可能需要更换美工」是候选授权，具体方案待你选定后生效。

### 2.2 「可迁移」怎么落地

- 迁移 = **抄设计语言，不抄代码**：把配色 / 圆角 / 阴影 / 密度 / 字体栈译成 `:root` 令牌与模块样式，全部手写，不引入框架文件，不发网络请求。
- **不推荐的直迁**：classless 框架（Pico / Water / MVP / Sakura / new.css / Beer CSS）是全局样式表，与现有手写布局 CSS 直接冲突，采用等于全站重写——除非接受重写，否则不列入备选（链接附在 2.3 末尾供参考）。
- **令牌源可单买**：Open Props、USWDS 提供成熟令牌体系，可作为任一视觉方向的底座 vendor 进 `:root`。

### 2.3 备选清单

| # | 方向 | 视觉特征 | 迁移量 | 风险 / 注意 | 参考 |
| --- | --- | --- | --- | --- | --- |
| 1 | **Geist（Vercel）** | 中性灰阶、高对比、紧圆角（6–8px）、细边框、克制阴影；仪表盘风 | 中（换令牌 + 调密度） | 低 | [vercel.com/geist](https://vercel.com/geist)、[vercel/geist-font](https://github.com/vercel/geist-font) |
| 2 | **Linear 风** | 暗色优先、低饱和、微渐变、8px 圆角、信息密度高 | 中–大（暗色令牌 + 图表配色重调） | 中：暗色下 chip / 日程色块对比度需逐色重验 | [nexu-io/open-design](https://github.com/nexu-io/open-design)（Linear-inspired DESIGN.md） |
| 3 | **shadcn / Radix 令牌体系** | `--background / --foreground / --card / --primary / --muted / --border` 语义令牌 + 12 阶色阶；亮暗双主题一套变量 | 小–中（映射成熟） | 低 | [ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming)、[radix-ui/colors](https://github.com/radix-ui/colors) |
| 4 | **Material 3** | tonal palette（主色派生五组色调）、大圆角（16–28px）、elevation 阶 | 大（色彩体系重算） | 中：大圆角 / 高 elevations 与现有紧凑网格冲突 | [m3.material.io baseline](https://m3.material.io/styles/color/static/baseline) |
| 5 | **Fluent 2** | 云母 / 亚克力层、8 / 12px 圆角、shadow token 体系 | 中 | 中：`backdrop-filter` 在低端机上的性能与可读性 | [fluent2.microsoft.design/design-tokens](https://fluent2.microsoft.design/design-tokens) |
| 6 | **Apple / iOS 风** | 毛玻璃、系统字体栈（`-apple-system`）、分组圆角列表、大标题 | 中 | 低–中 | [Apple HIG](https://developer.apple.com/design/human-interface-guidelines) |
| 7 | **纸质 / 文档风（Tufte）** | 衬线标题（系统衬线栈）、纸色背景、少边框多留白 | 小–中 | 低；与日视图现有暖纸风最近，可把全站统一成「纸」 | [edwardtufte.github.io/tufte-css](https://edwardtufte.github.io/tufte-css) |
| 8 | **国风 / 中文排版** | 墨色 + 朱砂点缀、宋体标题（`Songti SC / Noto Serif SC` 系统栈）、细竖排点缀 | 中 | 中：衬线在小字号可读性需验证 | （方向性参考，无单一权威源） |
| 9 | **Open Props 作令牌源** | 不是视觉方向，是现成 CSS 变量（色阶 / 圆角 / 阴影 / 字体），vendor 进 `:root` 当底座 | 小 | 低 | [argyleink/open-props](https://github.com/argyleink/open-props) |
| 10 | **USWDS** | 政府设计系统；令牌 + 规范完整，色彩无障碍体系成熟 | 中 | 低 | [designsystem.digital.gov](https://designsystem.digital.gov/) |

classless 直迁参考（不推荐，理由见 2.2）：[Pico](https://picocss.com/)、[Water.css](https://watercss.kognise.dev/)、[MVP.css](https://andybreaker.github.io/mvp/)、[Sakura](https://oxal.org/projects/sakura/)、[new.css](https://newcss.net)、[Beer CSS](https://beercss.com/)。

### 2.4 与蓄水池改动的关系

- 面板样式已读全局令牌 → **换美工后面板自动跟随**；进度 / 反馈新控件按令牌写，不吃死颜色，换肤零成本。
- **建议顺序：先定美工（令牌层），再实现进度反馈**；反过来做，反馈控件要二次改样式。
- 若暂不想换美工：进度反馈可按现状令牌先落地——第一部分不依赖美工决策，两者可解耦。

### 2.5 实现时的视觉验证要求（交付条件）

- UI 改动必须提供同视口、同主题、同场景的 Baseline / After 证据（证据留 `local/evidence/`，PR 只给文字结论，不贴图）；
- 1440 / 1024 / 768 / 390 无页面横向溢出；
- 若选暗色方向（如 Linear），亮 / 暗两套主题各一套证据；
- 换肤后重验 chip / 日程色块 / 进度态的对比度（无障碍）。

---

## 第三部分 · 待你决定的清单

1. **进度与反馈范围**：A（会话内轻反馈）/ B（本机持久 + 条目进度，推荐）/ C（再加清单联动，建议暂缓）？
2. **进度字段范围**：全部条目可标进度，还是只 `source=work` 的条目可标？（推荐：全部可标、默认不标，工作条目自然用上）
3. **反馈呈现位置**：面板内「反馈」视图（推荐，零主干登记）还是日视图新增卡片（需主干槽位登记、接口评审）？
4. **持久化边界**：接受「浏览器本机存储」作为记录与进度的持久层（推荐，与 `local/schedule.json` 同边界：只在本机、不入库）？还是坚持只写 `local/schedule.json`（由机器人 / 你手动维护文件，UI 编辑仍然刷新即失）？
5. **美工方向**：2.3 十项选一，或组合（如「shadcn 令牌 + Geist 密度」）？或暂不换、只统一现有两套并存的问题？
6. **借机调整项**：取用排序规则（目前是暂定「会话内未取用过优先 + 加入倒序」）是否本次一起定？

## 第四部分 · 建议路径

1. 你按第三部分清单回复 → 定稿范围（本稿升级为实现计划）。
2. 美工先行：令牌层落地 + 全站换肤（含 Baseline / After 证据）。
3. 进度与反馈实现：模块四件套 + 主干最小登记 + 文档同步 + `npm test` + 4 视口验证。
4. 每一步一个 PR，保持聚焦；接口登记点在 PR 中标注待评审。

---

### 附：本稿边界

- 只出方案，不含实现代码、不含具体日程内容、不含截图；机制层 / 内容分离原则不变。
- 引用仅限公开设计系统文档与本仓库既有契约；不出现飞书私有内容。
- 方案中的工作量与风险为工程估计，实现前可在 PR 中细化。
