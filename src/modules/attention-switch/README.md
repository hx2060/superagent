# attention-switch · 蓄水池（多种类任务切换注意力）

空白 / 瓶颈时刻的「选项池」：把所拥有的所有有效内容（网课、论文、网页、工作任务、日常杂事）收进池子，按**三档学习状态**（娱乐性学习 / 简单看过 / 理解学习）各给出几个选项，让注意力有去处，且不需要思考「切换成什么」。

设计讨论与决策记录见本文件 git 历史与 PR #8；本文档描述**已实现**的契约。

## 文件

```
index.js            mount(context) 与面板 UI（常驻入口 + 蓄水池界面）
store.js            纯逻辑：PoolItem 校验、分档、选取、会话内取用标记（无 DOM）
styles.css          命名空间样式（.mod-attention-switch-*）
__tests__/          node:test 单测（store）
README.md           本文件
```

## 输入

```ts
interface PoolItem {
  id: string;                  // 集合内唯一
  title: string;               // 纯文本，1–80 字符
  url?: string;                // http(s) 链接；省略时条目只有详情
  source: 'course' | 'paper' | 'web' | 'work' | 'chore';   // 来源；网课最多
  tiers: Array<'leisure' | 'browse' | 'deep'>;             // 三档归属，非空、可多档
  note?: string;               // 纯文本，最多 200 字符
  createdAt: string;           // YYYY-MM-DD
}
```

档位标签：`leisure` = 娱乐性学习，`browse` = 简单看过，`deep` = 理解学习。

`mount(context)`：

- `context.root`：页面级面板根 `<div data-module-root="attention-switch">`（在 `#view-root` 之外，常驻）；模块只操作这个节点内部。
- `context.state` / `context.data`：快照；面板与日期无关，实际数据一律走 `services.pool`。
- `context.services.pool`：主干预先创建的 store，接口见下。
- `context.services.inbox`：可选；「从清单加入」只读它的任务列表。

## 输出

```js
mount(context) -> {
  update(nextContext),   // 保留；面板常驻，无日期相关刷新
  destroy(),             // 退订并清空 root
}
```

**生命周期（与日视图模块不同）**：面板根在页面骨架中常驻，`app.js` 只挂载一次；视图切换不销毁它。可见性协议：

- 宿主 → 模块：入口按钮点击后取消 `hidden`，并在 root 上派发 `attention-switch:opened`（模块随后把焦点移入面板）；
- 模块 → 宿主：关闭按钮 / 背景 / `Escape` 在 root 上派发冒泡的 `attention-switch:close`（宿主收起并让焦点回到入口按钮）。

## store 接口

`createPoolStore(seedItems, options)` 返回（`options.createId` / `options.now` 供测试注入）：

| 方法 | 说明 |
| --- | --- |
| `addItem({ id?, title, url?, source, tiers, note? })` | 新增；返回副本；非法输入抛带 `code` 的 `Error` |
| `updateItem(id, changes)` | 局部更新（标题 / 链接 / 来源 / 档位 / 备注）；保留 `createdAt` |
| `deleteItem(id)` | 删除并清除其会话内取用标记 |
| `listItems()` | 全部条目副本（按加入顺序） |
| `listByTier(tier)` | 含该档的条目副本 |
| `optionsFor(tier, count = 5)` | 该档选项：会话内未取用过优先，同级按加入时间倒序；`count` 暂定 5 |
| `markUsed(id)` | 会话内取用标记（只影响排序，不产生历史） |
| `subscribe(listener)` | 返回退订函数；增改删 / 取用时同步通知 |

错误码：`POOL_TITLE_INVALID`、`POOL_URL_INVALID`、`POOL_SOURCE_INVALID`、`POOL_TIER_INVALID`、`POOL_NOTE_INVALID`、`POOL_DUPLICATE_ID`、`POOL_NOT_FOUND`。种子加载对坏条目**跳过不抛错**（与本地内容文件的宽容读取一致）。

## 界面与交互

- **入口**：顶栏常驻「蓄水池」按钮（`[data-pool-toggle]`），`aria-expanded` 同步开合；任何视图下可用。
- **面板**：模态层（背景 + 白板），标题、条目总数、三档标签（含各档计数）。
- **取用**：点档位 → 显示该档最多 5 个选项；点选项——有链接的新标签页打开（`noopener`）并标记取用、排到后面；无链接的展开详情（备注 / 链接）。
- **收录（三种形式）**：① 面板内表单（标题 / 链接 / 来源 / 档位多选 / 备注）；② dsh 下发 `window.schedule.pool.add`；③ 本地内容文件 `local/schedule.json` 的 `pool` 键（启动时读取）。
- **从清单加入**：面板内只读 `services.inbox` 的任务列表，点「加入」把任务标题带入收录表单（来源默认「工作」，档位自选）——单向联动，池内容不回清单。
- **编辑 / 删除**：行内编辑走同一表单；删除两步确认（再点一次「确认删除」）。
- **无障碍**：面板 `role="dialog"`；档位按钮 `aria-pressed`；增改删 / 打开通过 `[data-attention-switch-live]`（`aria-live="polite"`）播报；`Escape` 依次收起表单 / 导入列表 / 关闭面板；面板打开时方向键不驱动日历翻页。
- 校验失败：表单保持打开，错误信息 `role="alert"`，标题框获得焦点。

## 数据与不变量

- 池是**新实体**，与 `Task` / `DailyTask` 并列；不改造它们，也不与它们同步状态。
- 一条目可属多档；同一内容不必录两遍。
- 编辑只存当前页面会话；刷新后回到 `local/schedule.json` 的 `pool` 初值（与其它模块一致）。
- 所有文本按纯文本渲染转义；不写入 HTML；不读取凭据。
- 样式全部 `.mod-attention-switch-` 前缀，不修改全局元素样式；零运行时依赖。

## 注册点（主干改动，接口登记点）

- `index.html`：顶栏 `.topbar-right` 包裹视图切换 + `<button class="pool-entry" data-pool-toggle>`；`#view-root` 之后新增 `<div id="pool-panel" data-module-root="attention-switch" hidden>`；一行模块样式 `<link>`。
- `src/app.js`：import 模块；`createPoolStore(seed.pool)`；`services.pool` 传入模块；入口点击 / `attention-switch:close` 控制可见性；面板打开时屏蔽日历方向键；`window.schedule.pool`。
- `src/data.js`：`samplePool`（空）+ `pickSeedData` 增加可选 `pool` 键。
- `assets/styles.css`：`.topbar-right` / `.pool-entry` 两条顶栏样式（模块面板样式在模块内）。

## 测试与验收

- `npm test`：store 覆盖校验、多档、选取与排序、会话标记、订阅、种子容错（13 项）。
- 浏览器验证（本地 headless，证据在 `local/evidence/attention-switch/`，不入仓库）：1440 / 1024 / 768 / 390 无页面横向溢出（含面板打开态）；Baseline（`origin/main`，同视口同内容）对比仅新增顶栏入口；三档切换、多档命中、三种收录、从清单加入、编辑、两步删除、`Escape`、焦点回归、方向键屏蔽、月 / 周 / 日视图回归、无 console error 均通过（44 项）。
