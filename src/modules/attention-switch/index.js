/**
 * Attention-switch module entry: the 蓄水池 (option pool) panel.
 *
 * The host registers ONE persistent root in the page shell (outside the view
 * root) plus a toolbar entry button; app.js toggles the root's `hidden`. The
 * module owns everything inside its root: the three learning-state tabs, the
 * handful of options per state, the three capture forms (manual form, dsh via
 * `window.schedule.pool`, local content file) and the one-way import from the
 * inbox task list.
 *
 * Visibility protocol with the host:
 * - host → module: dispatch `attention-switch:opened` on the root after
 *   unhiding it (the module then moves focus into the panel);
 * - module → host: dispatch `attention-switch:close` (bubbling) from the close
 *   button, the backdrop or Escape; the host hides the root and restores focus.
 *
 * State lives in `services.pool` (see store.js); this file is UI only.
 */

export {
  POOL_DEFAULT_OPTION_COUNT,
  POOL_NOTE_MAX_LENGTH,
  POOL_SOURCES,
  POOL_SOURCE_LABELS,
  POOL_TIERS,
  POOL_TIER_LABELS,
  POOL_TITLE_MAX_LENGTH,
  createPoolStore,
  normalizePoolItem,
} from './store.js';

import {
  POOL_DEFAULT_OPTION_COUNT,
  POOL_SOURCE_LABELS,
  POOL_TIER_LABELS,
  POOL_TIERS,
} from './store.js';

const CLOSE_EVENT = 'attention-switch:close';
const OPENED_EVENT = 'attention-switch:opened';
const DEFAULT_TIER = 'browse';

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

function scheduleFrame(callback) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    setTimeout(callback, 0);
  }
}

function emptyDraft() {
  return { title: '', url: '', source: 'course', tiers: [], note: '' };
}

/**
 * @param {{
 *   root: HTMLElement,
 *   state: Readonly<{ view: 'month'|'week'|'day', anchor: Date }>,
 *   data: object,
 *   services: { pool: ReturnType<import('./store.js').createPoolStore>, inbox?: { listTasks: () => Array<{ id: string, title: string, status: string }> } }
 * }} context
 * @returns {{ update?: (context: object) => void, destroy: () => void }}
 */
export function mount(context) {
  const root = context?.root;
  const pool = context?.services?.pool;
  if (!root) throw new Error('attention-switch: context.root is required.');
  if (!pool) throw new Error('attention-switch: services.pool is required.');
  const inbox = context?.services?.inbox;

  root.classList.add('mod-attention-switch-slot');

  let selectedTier = DEFAULT_TIER;
  /** @type {{ mode: 'add'|'edit', id?: string, draft: { title: string, url: string, source: string, tiers: string[], note: string }, error: string } | null} */
  let form = null;
  let importOpen = false;
  let expandedId = null;
  let deleteArmedId = null;
  let announcement = '';
  let focusTitle = false;
  let focusOptionId = null;
  let focusAddButton = false;
  let focusTier = false;

  const unsubscribe = pool.subscribe(() => render());

  function requestClose() {
    root.dispatchEvent(new CustomEvent(CLOSE_EVENT, { bubbles: true }));
  }

  function focusPending() {
    if (focusTitle) {
      focusTitle = false;
      root.querySelector('[data-attention-switch-input="title"]')?.focus();
    }
    if (focusOptionId) {
      const id = focusOptionId;
      focusOptionId = null;
      root.querySelector(`[data-attention-switch-open="${escapeHtml(id)}"]`)?.focus();
    }
    if (focusAddButton) {
      focusAddButton = false;
      root.querySelector('[data-attention-switch-add-toggle]')?.focus();
    }
    if (focusTier) {
      focusTier = false;
      root.querySelector('[data-attention-switch-tier]')?.focus();
    }
  }

  function announce(text) {
    announcement = text;
  }

  function tierCounts() {
    const counts = new Map(POOL_TIERS.map((tier) => [tier, 0]));
    for (const item of pool.listItems()) {
      for (const tier of item.tiers) counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    return counts;
  }

  function renderTierTabs() {
    const counts = tierCounts();
    return `<nav class="mod-attention-switch-tiers" aria-label="学习状态">
      ${POOL_TIERS.map(
        (tier) => `<button
          type="button"
          class="mod-attention-switch-tier"
          data-attention-switch-tier="${tier}"
          data-active="${tier === selectedTier ? 'true' : 'false'}"
          aria-pressed="${tier === selectedTier ? 'true' : 'false'}"
        ><span class="mod-attention-switch-tier-label">${escapeHtml(POOL_TIER_LABELS[tier])}</span><span class="mod-attention-switch-tier-count">${counts.get(tier) ?? 0}</span></button>`
      ).join('')}
    </nav>`;
  }

  function renderOption(item) {
    const id = escapeHtml(item.id);
    const title = escapeHtml(item.title);
    const tiers = item.tiers.map((tier) => POOL_TIER_LABELS[tier] ?? tier).join(' / ');
    const source = POOL_SOURCE_LABELS[item.source] ?? item.source;
    const meta = [source, tiers, item.createdAt].filter(Boolean).join(' · ');
    const expanded = expandedId === item.id;
    const deleting = deleteArmedId === item.id;

    return `<li class="mod-attention-switch-option" data-attention-switch-option="${id}" data-expanded="${expanded ? 'true' : 'false'}">
      <div class="mod-attention-switch-option-main">
        <button
          type="button"
          class="mod-attention-switch-open"
          data-attention-switch-open="${id}"
          title="${item.url ? '打开：' : '展开：'}${title}"
        >
          <span class="mod-attention-switch-open-icon" aria-hidden="true">${item.url ? '↗' : '▸'}</span>
          <span class="mod-attention-switch-open-title">${title}</span>
        </button>
        <p class="mod-attention-switch-meta">${escapeHtml(meta)}</p>
        ${
          expanded || !item.url
            ? `<p class="mod-attention-switch-note">${item.note ? escapeHtml(item.note) : '没有备注。'}${
                item.url ? `<span class="mod-attention-switch-url">${escapeHtml(item.url)}</span>` : ''
              }</p>`
            : ''
        }
      </div>
      <div class="mod-attention-switch-option-actions">
        <button type="button" class="mod-attention-switch-action" data-attention-switch-edit="${id}">编辑</button>
        <button
          type="button"
          class="mod-attention-switch-action mod-attention-switch-action--danger"
          data-attention-switch-delete="${id}"
          data-armed="${deleting ? 'true' : 'false'}"
        >${deleting ? '确认删除' : '删除'}</button>
      </div>
    </li>`;
  }

  function renderOptions() {
    const options = pool.optionsFor(selectedTier, POOL_DEFAULT_OPTION_COUNT);
    const total = pool.listByTier(selectedTier).length;
    if (options.length === 0) {
      return `<p class="mod-attention-switch-empty">这一档还是空的。用「收录」加一条，或「从清单加入」把清单任务放进来。</p>`;
    }
    return `<ul class="mod-attention-switch-options">${options.map(renderOption).join('')}</ul>
      ${
        total > options.length
          ? `<p class="mod-attention-switch-more">这一档共 ${total} 条，先看这 ${options.length} 条；用过的会排到后面。</p>`
          : ''
      }`;
  }

  function renderForm() {
    if (!form) return '';
    const draft = form.draft;
    const editing = form.mode === 'edit';
    return `<form class="mod-attention-switch-form" data-attention-switch-form novalidate>
      <label class="mod-attention-switch-field mod-attention-switch-field--title">
        <span>标题</span>
        <input
          data-attention-switch-input="title"
          name="title"
          type="text"
          maxlength="80"
          autocomplete="off"
          placeholder="例如：乐理入门第 2 章"
          value="${escapeHtml(draft.title)}"
        />
      </label>
      <label class="mod-attention-switch-field">
        <span>链接（可留空）</span>
        <input
          data-attention-switch-input="url"
          name="url"
          type="text"
          autocomplete="off"
          placeholder="https://www.bilibili.com/video/…"
          value="${escapeHtml(draft.url)}"
        />
      </label>
      <label class="mod-attention-switch-field">
        <span>来源</span>
        <select data-attention-switch-input="source" name="source">
          ${Object.entries(POOL_SOURCE_LABELS)
            .map(
              ([value, label]) =>
                `<option value="${value}"${value === draft.source ? ' selected' : ''}>${escapeHtml(label)}</option>`
            )
            .join('')}
        </select>
      </label>
      <fieldset class="mod-attention-switch-field mod-attention-switch-field--tiers">
        <legend>档位（可多选）</legend>
        ${POOL_TIERS.map(
          (tier) => `<label class="mod-attention-switch-check">
            <input
              type="checkbox"
              data-attention-switch-input="tier"
              name="tiers"
              value="${tier}"
              ${draft.tiers.includes(tier) ? 'checked' : ''}
            />
            <span>${escapeHtml(POOL_TIER_LABELS[tier])}</span>
          </label>`
        ).join('')}
      </fieldset>
      <label class="mod-attention-switch-field mod-attention-switch-field--note">
        <span>备注（可留空）</span>
        <textarea
          data-attention-switch-input="note"
          name="note"
          rows="2"
          maxlength="200"
          placeholder="为什么想学 / 要做什么">${escapeHtml(draft.note)}</textarea>
      </label>
      ${form.error ? `<p class="mod-attention-switch-error" role="alert">${escapeHtml(form.error)}</p>` : ''}
      <div class="mod-attention-switch-form-actions">
        <button type="submit" class="mod-attention-switch-submit">${editing ? '保存' : '加入'}</button>
        <button type="button" class="mod-attention-switch-cancel" data-attention-switch-cancel>取消</button>
      </div>
    </form>`;
  }

  function renderImport() {
    if (!importOpen) return '';
    const tasks = inbox ? inbox.listTasks() : [];
    const rows = tasks.length
      ? `<ul class="mod-attention-switch-import-list">
          ${tasks
            .map(
              (task) => `<li class="mod-attention-switch-import-row" data-attention-switch-import-row="${escapeHtml(task.id)}">
              <span class="mod-attention-switch-import-title">${escapeHtml(task.title)}</span>
              <button type="button" class="mod-attention-switch-action" data-attention-switch-import-pick="${escapeHtml(task.id)}">加入</button>
            </li>`
            )
            .join('')}
        </ul>`
      : `<p class="mod-attention-switch-empty">清单还是空的——先用「＋ 收录」直接加一条。</p>`;
    return `<div class="mod-attention-switch-import" data-attention-switch-import>
      <p class="mod-attention-switch-import-hint">把清单任务收进蓄水池（收录后各管各的，互不影响）。</p>
      ${rows}
    </div>`;
  }

  function render() {
    const total = pool.listItems().length;
    root.innerHTML = `<div class="mod-attention-switch-backdrop" data-attention-switch-close></div>
      <section class="mod-attention-switch" role="dialog" aria-labelledby="mod-attention-switch-title">
        <header class="mod-attention-switch-head">
          <h2 class="mod-attention-switch-title" id="mod-attention-switch-title">蓄水池</h2>
          <span class="mod-attention-switch-count">${total} 条</span>
          <button type="button" class="mod-attention-switch-close" data-attention-switch-close aria-label="关闭蓄水池">✕</button>
        </header>
        <p class="mod-attention-switch-lead">选一个你现在的状态，从池子里挑一个去处。</p>
        ${renderTierTabs()}
        ${renderOptions()}
        <div class="mod-attention-switch-actions">
          <button type="button" class="mod-attention-switch-add" data-attention-switch-add-toggle aria-expanded="${form ? 'true' : 'false'}">${form ? '收起收录' : '＋ 收录'}</button>
          <button type="button" class="mod-attention-switch-add" data-attention-switch-import-toggle aria-expanded="${importOpen ? 'true' : 'false'}">${importOpen ? '收起清单' : '从清单加入'}</button>
        </div>
        ${renderForm()}
        ${renderImport()}
        <p class="mod-attention-switch-sr-only" aria-live="polite" data-attention-switch-live></p>
      </section>`;

    focusPending();

    if (announcement) {
      const text = announcement;
      announcement = '';
      scheduleFrame(() => {
        const live = root.querySelector('[data-attention-switch-live]');
        if (live) live.textContent = text;
      });
    }
  }

  function openForm(mode, item) {
    form = {
      mode,
      id: item?.id,
      draft: item
        ? {
            title: item.title,
            url: item.url ?? '',
            source: item.source,
            tiers: Array.isArray(item.tiers) ? [...item.tiers] : [],
            note: item.note ?? '',
          }
        : emptyDraft(),
      error: '',
    };
    importOpen = false;
    expandedId = null;
    deleteArmedId = null;
    focusTitle = true;
    render();
  }

  function closeForm() {
    form = null;
    focusAddButton = true;
    render();
  }

  function readDraft(formEl) {
    const title = formEl.querySelector('[data-attention-switch-input="title"]')?.value ?? '';
    const url = formEl.querySelector('[data-attention-switch-input="url"]')?.value ?? '';
    const source = formEl.querySelector('[data-attention-switch-input="source"]')?.value ?? '';
    const note = formEl.querySelector('[data-attention-switch-input="note"]')?.value ?? '';
    const tiers = [...formEl.querySelectorAll('[data-attention-switch-input="tier"]:checked')].map(
      (box) => box.value
    );
    return { title, url, source, tiers, note };
  }

  function handleClick(event) {
    const close = event.target.closest('[data-attention-switch-close]');
    if (close) {
      requestClose();
      return;
    }

    const tier = event.target.closest('[data-attention-switch-tier]');
    if (tier) {
      selectedTier = tier.dataset.attentionSwitchTier;
      expandedId = null;
      deleteArmedId = null;
      render();
      return;
    }

    const open = event.target.closest('[data-attention-switch-open]');
    if (open) {
      const id = open.dataset.attentionSwitchOpen;
      const item = pool.listItems().find((entry) => entry.id === id);
      if (!item) return;
      if (item.url) {
        window.open(item.url, '_blank', 'noopener');
        pool.markUsed(id);
        announce(`已打开「${item.title}」`);
      } else {
        expandedId = expandedId === id ? null : id;
        announce(expandedId ? `展开「${item.title}」` : `收起「${item.title}」`);
        render();
      }
      return;
    }

    const edit = event.target.closest('[data-attention-switch-edit]');
    if (edit) {
      const id = edit.dataset.attentionSwitchEdit;
      const item = pool.listItems().find((entry) => entry.id === id);
      if (item) openForm('edit', item);
      return;
    }

    const remove = event.target.closest('[data-attention-switch-delete]');
    if (remove) {
      const id = remove.dataset.attentionSwitchDelete;
      if (deleteArmedId !== id) {
        deleteArmedId = id;
        announce('再点一次「确认删除」生效');
        render();
        return;
      }
      const removed = pool.deleteItem(id);
      deleteArmedId = null;
      announce(`已删除「${removed.title}」`);
      return;
    }

    const importPick = event.target.closest('[data-attention-switch-import-pick]');
    if (importPick) {
      const task = inbox
        ?.listTasks()
        .find((entry) => entry.id === importPick.dataset.attentionSwitchImportPick);
      if (!task) return;
      openForm('add', { title: task.title, source: 'work' });
      announce(`已把清单任务「${task.title}」带入收录表单，选好档位后加入`);
      return;
    }

    const addToggle = event.target.closest('[data-attention-switch-add-toggle]');
    if (addToggle) {
      if (form) closeForm();
      else openForm('add');
      return;
    }

    const importToggle = event.target.closest('[data-attention-switch-import-toggle]');
    if (importToggle) {
      importOpen = !importOpen;
      form = null;
      render();
      return;
    }

    const cancel = event.target.closest('[data-attention-switch-cancel]');
    if (cancel) {
      closeForm();
    }
  }

  function handleSubmit(event) {
    const formEl = event.target.closest?.('[data-attention-switch-form]');
    if (!formEl) return;
    event.preventDefault();

    const draft = readDraft(formEl);
    try {
      if (form?.mode === 'edit' && form.id) {
        const updated = pool.updateItem(form.id, draft);
        form = null;
        announce(`已保存「${updated.title}」`);
        focusOptionId = updated.id;
        render();
      } else {
        const added = pool.addItem(draft);
        form = null;
        announce(`已加入「${added.title}」`);
        focusOptionId = added.id;
        selectedTier = added.tiers[0];
        render();
      }
    } catch (error) {
      form.error =
        error?.code === 'POOL_TITLE_INVALID'
          ? '标题需要 1–80 个字符'
          : error?.code === 'POOL_URL_INVALID'
            ? '链接要以 http:// 或 https:// 开头'
            : error?.code === 'POOL_TIER_INVALID'
              ? '至少勾选一个档位'
              : error?.code === 'POOL_NOTE_INVALID'
                ? '备注最多 200 个字符'
                : error?.code === 'POOL_DUPLICATE_ID'
                  ? 'id 重复，请换一个'
                  : '保存失败，请稍后重试';
      focusTitle = true;
      render();
    }
  }

  function handleInput(event) {
    const field = event.target.closest?.('[data-attention-switch-input]');
    if (!field || !form) return;
    if (field.dataset.attentionSwitchInput === 'tier') {
      const tier = field.value;
      form.draft.tiers = field.checked
        ? [...new Set([...form.draft.tiers, tier])]
        : form.draft.tiers.filter((entry) => entry !== tier);
    }
    if (form.error) {
      form.error = '';
      render();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      if (form) {
        closeForm();
      } else if (importOpen) {
        importOpen = false;
        render();
      } else {
        requestClose();
      }
      event.stopPropagation();
    }
  }

  function handleOpened() {
    focusTier = true;
    render();
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('input', handleInput);
  root.addEventListener('keydown', handleKeydown);
  root.addEventListener(OPENED_EVENT, handleOpened);

  render();

  return {
    update(nextContext) {
      // The panel is persistent and date-independent; nothing to refresh from
      // the context snapshot (services.pool is live). Kept for the contract.
      if (nextContext?.state) render();
    },
    destroy() {
      unsubscribe();
      root.removeEventListener('click', handleClick);
      root.removeEventListener('submit', handleSubmit);
      root.removeEventListener('input', handleInput);
      root.removeEventListener('keydown', handleKeydown);
      root.removeEventListener(OPENED_EVENT, handleOpened);
      root.innerHTML = '';
      root.classList.remove('mod-attention-switch-slot');
    },
  };
}
