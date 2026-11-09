# 机制层交接（GitHub）

版本：`0.6`
适用范围：本仓库的 Issue / PR / 提交 / 文档 / 测试

本文档说明**哪些内容写入 GitHub，哪些只保留在本地**，以及为什么。需求方的约定是：**GitHub 上的 PR 只提交机制层；具体的时间 / 任务安排不提交 GitHub；截图与视觉证据不写入仓库。** 如果后续需要改变这个分工，必须由需求方明确确认，并在 PR 中记录例外。

## 1. 两层内容

| 层 | 内容 | 保存位置 | 是否提交 GitHub |
| --- | --- | --- | --- |
| 机制层 | 视图、模块、纯函数、数据契约、接口文档、测试、空白种子、协作规则 | `src/`、`assets/`、`tests/`、`docs/`、`AGENTS.md` | 是 |
| 内容层 | 具体任务名称、日期、开始 / 截止时间、便签文本、每日任务实例、真实日程 | `local/schedule.json`、`local/本地内容交接.md` | 否 |
| 视觉证据 | 截图、录屏、对比图、预览产物 | `local/evidence/` | 否 |

机制层必须能解释“怎么加、怎么变、怎么验证”，但不能包含“这个人的具体安排是什么”。

## 2. 本地内容目录

`local/` 已被 `.gitignore` 忽略，应用启动时尝试读取 `local/schedule.json`：

```
local/
  schedule.json          具体日程内容（可选；缺失时日历保持空白）
  本地内容交接.md         本地内容说明、数据格式、添加流程（不提交）
  evidence/              截图 / 录屏等视觉证据（不提交）
  examples/              测试实例的例子内容（scripts/gen-examples.mjs 生成，不提交）
  audit/                 评估 / 实施记录（不提交）
```

- 缺失或损坏的 `local/schedule.json` 不会影响应用：`src/data.js` 的空白种子作为回退。
- 应用**不会**把 UI 编辑写回本地文件；页面内新增 / 修改 / 删除仍只在当前会话有效。需要持久化的内容由机器人或使用者写入 `local/schedule.json` 后刷新。
- 公开预览是脱敏副本，不能包含 `local/`（见 `docs/integration.md` 第 4 节）。

## 3. 截图与视觉验证

- 仓库与 PR **不提交图片**；`.gitignore` 忽略 `docs/screenshots/` 与常见图片后缀。
- UI 改动仍在本地按 **1440 / 1024 / 768 / 390** 宽度、同主题、同场景验证；证据保存在 `local/evidence/`。
- PR 描述用文字记录：基线（改动前的真实状态）、改动后场景、视口、检查项与结果、已知限制。不要把截图贴进 PR，也不要用旧截图冒充基线。
- 没有真实基线时，PR 必须如实说明“基线不可用”，不得声称视觉验证完整。

## 4. PR / Issue / 提交约定

- PR 描述说明：改了什么、接口 / 数据是否变化、如何验证（文字）、关联 Issue、机制层与内容层的边界。
- 不在 Issue、PR、提交信息、测试夹具、示例数据中写入真实任务名称、日期、时间、便签或飞书私有内容。
- 示例数据使用中性占位（如“示例任务 A”“示例日程”），并保持空白种子。
- 不提交设计备选、临时预览文件、截图生成脚本的私有产物。
- 需要图片才能说明的视觉问题，在 PR 中描述现象与复现步骤，证据留在本地；不要把图片转成 base64 塞进文档。
- 例外（例如需求方明确要求某张图进入仓库）必须先在 Issue / PR 中记录，得到确认后再做。

## 5. 对接需要关注的变化（接口 0.6）

后续模块 / 机器人 / 后端对接前，先读 `docs/interfaces.md` 第 6 节的迁移说明。要点：

1. **任务占据哪些天，只有一个答案**：`src/tasks.js` 的 `taskWindow` / `taskDayEntry` / `taskReviewGroups` 是月 / 周 / 日三视图共用的唯一口径。新模块要判断「任务在某天是否出现、算什么状态」时调用它们，**不要另写一套日期逻辑**（0.5 之前三套逻辑漂移正是本轮问题的根因）。
2. **`Task.date` 不带 `start` / `duration` 现在是全天任务**：进入当日计划与周 / 月视图，不进时间表。`add({ date })` 不再静默忽略日期。
3. **`updateTask` 清空时间 ≠ 解绑**：清空 `start` / `duration`（保留 `date`）= 变为全天任务；显式 `date: ''` = 回到收集区。
4. **`due` 不得早于 `date`**：写入抛 `INBOX_TASK_DUE_INVALID`；本地种子里的矛盾数据按 `date` 当天呈现（不报错、不丢任务）。
5. **日视图「清单」= 当日计划 + 收集区**：成员规则与日进度口径见 `docs/interfaces.md` 2.3；读取收集区用 `services.inbox.listUnscheduledTasks()`。
6. **逾期回顾区**：周 / 月视图展示截止已过且未删除的任务（`taskReviewGroups`），分「逾期未完成 / 已完成」，保留至删除。
7. 新增稳定选择器：`[data-inbox-section]`、`[data-all-day]`、`[data-inbox-task-add-allday]` / `[data-inbox-task-edit-allday]`、`[data-task-flag]`、`[data-week-chart-review]` / `[data-week-chart-review-row]`、`[data-review-group]`、`[data-month-review]` / `[data-review-item]`。

## 6. 本地 / 测试两个实例

同代码、两个端口、两份 `/local/schedule.json`：

- 本地实例：`npm start`（内容 = `local/schedule.json`，只放真实本地内容，不放测试例子）。
- 测试实例：`npm start -- --content local/examples`（内容 = `node scripts/gen-examples.mjs` 生成的例子，日期相对今天，覆盖全部功能场景）。
- `scripts/serve.mjs --content <目录>` 把 `/local/*` 改由该目录提供；点号路径（`.git` 等）一律拒绝，测试实例不会暴露真实本地内容。
- 部署机上的端口映射由反代配置完成（内网限制），本地走既有常驻端口、测试单独一个端口。

## 7. 两份交接文档

| 文档 | 位置 | 内容 |
| --- | --- | --- |
| GitHub 机制层交接 | `docs/mechanism-handoff.md`（本文件） | 仓库边界、PR / 截图 / 内容规则、本地目录分工 |
| 本地内容交接 | `local/本地内容交接.md`（不提交） | 当前本地内容、数据格式、机器人添加流程、验证记录 |

接口细节分别写入 `docs/interfaces.md`（稳定契约）和 `docs/schedule-api.md`（添加日程的机器人接口）。

## 8. 机器人添加工作的分工

1. 机器人先读 `docs/schedule-api.md`，确认数据格式、校验规则与错误码。
2. 具体内容写入 `local/schedule.json`（或通过页面运行时 `window.schedule` 做当前会话操作），**不要**改 `src/data.js` 的空白种子，也不要提交内容文件。
3. 刷新页面后验证：清单、日视图时间表、周图、月视图使用同一份任务数据。
4. 汇报时只描述机制与验证结果；具体任务内容留在本地交接文档。

## 9. 检查清单

- [ ] 本次改动只包含机制层代码、测试、文档与空白种子。
- [ ] 没有图片、截图、录屏或 `local/` 内容进入提交。
- [ ] 没有真实任务 / 日期 / 时间 / 便签 / 飞书私有内容进入 Issue、PR 或测试。
- [ ] PR 用文字说明了基线、场景、视口与验证结果。
- [ ] 本地内容已写入 `local/schedule.json`，并在 `local/本地内容交接.md` 记录。
- [ ] 接口变更同步了 `docs/interfaces.md` / `docs/schedule-api.md`，迁移说明覆盖第 5 节全部要点。
- [ ] 涉及「任务出现在哪些天」的改动复用了 `src/tasks.js` 共享映射，没有新增第二套日期逻辑。
- [ ] 本地 / 测试两个实例均已验证：本地只有真实内容，测试只有例子内容且不暴露 `local/` 与 `.git`。
