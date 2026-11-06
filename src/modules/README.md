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

- `inbox/`：日视图「清单」与「便签」的新增 / 修改 / 删除。注册点为 `<aside class="day-sidebar" data-module-root="inbox">`，共享状态走 `services.inbox`，模块样式在 `index.html` 中以单独 `<link>` 加载。

## 注册点约定

首个模块 PR 提交了最小注册点 / `services` 接口提案：

- 主干在日视图渲染函数中保留一行模块根节点（inbox 使用 `.day-sidebar[data-module-root="inbox"]`）。
- 主干在日视图渲染后 `mount` 模块；切换视图时先调用模块返回的 `destroy()`。
- 模块样式由 `index.html` 中一行 `<link rel="stylesheet">` 加载，模块 CSS 使用 `.mod-<name>-` 前缀。
- 共享状态通过 `context.services` 传递，当前导出 `services.inbox`。

后续模块应复用该模式；新增共享能力先提交最小接口提案，不直接 `import` `src/app.js` 内部符号。完整契约见仓库根目录 `AGENTS.md` 与 `docs/interfaces.md`。模块不得暴露飞书私有内容、凭据或真实用户数据。
