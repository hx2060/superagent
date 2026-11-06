# src/modules

后续功能模块的默认目录。模块通过 `mount(context)` 接入，不直接修改 `src/app.js` 内部实现。

```
src/modules/<name>/
  index.js       导出 mount(context) -> { update?, destroy? }
  README.md      输入 / 输出 / 依赖 / 不变量
  styles.css     可选，类名必须带 .mod-<name>- 前缀
  __tests__/     可选
```

完整契约见仓库根目录 `AGENTS.md` 与 `docs/interfaces.md`。当前主干尚未实现模块注册器；首个模块 PR 需要提交最小注册点 / `services` 接口提案。模块不得暴露飞书私有内容、凭据或真实用户数据。
