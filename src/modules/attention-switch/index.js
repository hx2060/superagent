/**
 * Attention-switch module — PLACEHOLDER ONLY, not implemented.
 *
 * 设计讨论见 README.md。本文件只是按模块契约保留的占位骨架：
 * 未在 `src/app.js` 注册、不新增 service 键、不带样式与测试。
 * 需求方对 README 中的开放问题给出方向后，再按 AGENTS.md 提接口提案并实现。
 *
 * 契约与其它模块一致：只操作 `context.root` 内部，返回
 * `{ update?, destroy() }`；占位面板不依赖 `services`，可在任何上下文试挂载。
 */

const PLACEHOLDER_TITLE = '注意力切换';
const PLACEHOLDER_NOTE = '模块设计中，暂未启用';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * @param {{
 *   root: HTMLElement,
 *   state: Readonly<{ view: 'month'|'week'|'day', anchor: Date }>,
 *   data: object,
 *   services: object
 * }} context
 * @returns {{ update?: (context: object) => void, destroy: () => void }}
 */
export function mount(context) {
  const root = context?.root;
  if (!root) throw new Error('attention-switch: context.root is required.');

  root.classList.add('mod-attention-switch-slot');

  function render() {
    root.innerHTML = `<section class="mod-attention-switch" aria-labelledby="mod-attention-switch-title">
      <h3 class="mod-attention-switch-title" id="mod-attention-switch-title">${escapeHtml(PLACEHOLDER_TITLE)}</h3>
      <p class="mod-attention-switch-note">${escapeHtml(PLACEHOLDER_NOTE)}</p>
    </section>`;
  }

  render();

  return {
    update: render,
    destroy() {
      root.innerHTML = '';
      root.classList.remove('mod-attention-switch-slot');
    },
  };
}
