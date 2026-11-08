# src/modules

功能模块目录。模块通过 `mount(context)` 接入，不直接修改 `src/app.js` 内部实现。

```
src/modules/<name>/
  index.js       导出 mount(context) -> { update?, destroy? }
  README.md      输入 / 输出 / 依赖 / 不变量
  styles.css     可选，类名必须带 .mod-<name>- 前缀
  __tests__/     可选
```

当前已落地的模块：

- `daily-tasks/`：每日重复任务。日视图通过 `[data-module-root="daily-tasks"]` 注册点挂载，共享状态走 `services.dailyTasks`；样式在 `index.html` 中以单独 `<link>` 加载。
- `inbox/`：日视图「清单」与「便签」的新增 / 修改 / 删除；清单任务可选开始时间与持续分钟，并同步到日视图时间表、周图与月视图；也可带可选截止日期并在行内展示。注册点为 `<aside class="day-sidebar" data-module-root="inbox">`，共享状态走 `services.inbox`，模块样式在 `index.html` 中以单独 `<link>` 加载。
- `week-chart/`：周视图任务 × 时间方块图。注册点为 `<div class="mod-week-chart-root" data-module-root="week-chart">`，通过 `services.inbox` 读取同一份任务并切换状态；几何与行模型在 `chart.js`。

## 占位 / 设计中

- `attention-switch/`：多种类任务切换注意力、缓解逃避。**占位阶段**：只有 `index.js` 骨架与设计讨论 README，未注册、未实现；方向见该模块 README 的「开放问题」，需求方确认后再提接口提案。

## 模块入口模板

```js
/** @param {{ root: HTMLElement, state, data, services }} context */
export function mount({ root, state, data, services }) {
  function render() {
    root.innerHTML = `<div class="mod-example">...</div>`;
  }
  const onClick = () => {};
  root.addEventListener('click', onClick);
  render();
  return {
    update: render,              // 可选，当前主干视图切换会 destroy + 重新 mount
    destroy() {
      root.removeEventListener('click', onClick);
      root.innerHTML = '';
    },
  };
}
```

- `state` / `data` / `services` 都是只读快照；跨模块共享状态只能走 `services`。
- 只操作 `root` 内部；不要 import `src/app.js` 或其它模块内部文件。
- 在 `destroy()` 中清理 root / window / document 监听器、定时器与订阅。
- 模块样式必须加 `.mod-<name>-` 前缀，通过 `index.html` 一行 `<link>` 加载。

## 注册点约定

模块 PR 提交最小注册点 / `services` 接口提案：

- 主干在对应视图渲染函数中保留模块根节点：每日任务为 `<div data-module-root="daily-tasks"></div>`，清单 / 便签为 `<aside class="day-sidebar" data-module-root="inbox">`，周图为 `<div class="mod-week-chart-root" data-module-root="week-chart"></div>`。
- 主干在视图渲染后 `mount` 模块；切换视图时先调用模块返回的 `destroy()`。
- 模块样式由 `index.html` 中一行 `<link rel="stylesheet">` 加载，模块 CSS 使用 `.mod-<name>-` 前缀。
- 共享状态通过 `context.services` 传递，当前导出 `services.dailyTasks` 与 `services.inbox`。

## 新增模块检查清单

- [ ] `src/modules/<name>/` 含 `index.js`、`README.md`，按需加 `styles.css` / `__tests__/`。
- [ ] `mount(context)` 返回 `{ destroy }`（可选 `update`）；只读写 `root`。
- [ ] 共享状态先提案最小 service，加入可选的 `context.services` 键；文档写清方法、错误码、同步语义。
- [ ] 日视图槽位、mount / destroy、样式入口按现有模块模式登记；不改既有槽位。
- [ ] store / 纯逻辑有 node:test；UI 在本地按 1440 / 1024 / 768 / 390 验证，证据留在 `local/evidence/`，不入仓库。
- [ ] `docs/interfaces.md`（模块契约 / 数据 / 选择器）与 `docs/integration.md`（接入步骤）已更新。
- [ ] 无 console error、无横向溢出；空白启动 / 空状态 / 深链回归通过。

后续模块应复用该模式；新增共享能力先提交最小接口提案，不直接 `import` `src/app.js` 内部符号。完整契约见仓库根目录 `AGENTS.md` 与 `docs/interfaces.md`。模块不得暴露飞书私有内容、凭据或真实用户数据。
