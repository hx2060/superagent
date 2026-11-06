/**
 * Daily recurring tasks module entry.
 *
 * The module renders a compact "每日任务" bar at the top of the day view and
 * talks to the host through `services.dailyTasks` (see README.md). It never
 * imports `src/app.js` or touches state outside its own root.
 */

import { toDateKey } from '../../calendar.js';
import { TASK_STATUS_LABELS, nextTaskStatus } from '../../tasks.js';

export {
  DAILY_TASK_DEFAULT_ICON,
  DAILY_TASK_ICON_MAX_CODE_POINTS,
  DAILY_TASK_RECURRENCE,
  DAILY_TASK_TITLE_MAX_LENGTH,
  createDailyTaskStore,
  normalizeDailyTask,
} from './store.js';

const STATUS_CYCLE_HINT = '待完成 → 部分完成 → 完成';

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

function renderItem({ task, status }) {
  const label = TASK_STATUS_LABELS[status] ?? status;
  return `<li class="mod-daily-tasks-item" data-daily-task-row="${escapeHtml(task.id)}" data-status="${status}">
    <button
      type="button"
      class="mod-daily-tasks-chip"
      data-daily-tasks-toggle="${escapeHtml(task.id)}"
      data-status="${status}"
      aria-label="切换每日任务「${escapeHtml(task.title)}」的状态，当前${label}"
      title="${escapeHtml(task.title)} · ${label}。点击切换：${STATUS_CYCLE_HINT}"
    >
      <span class="mod-daily-tasks-icon" aria-hidden="true">${escapeHtml(task.icon)}</span>
      <span class="mod-daily-tasks-copy">
        <span class="mod-daily-tasks-name">${escapeHtml(task.title)}</span>
        <span class="mod-daily-tasks-state">${label}</span>
      </span>
      <span class="mod-daily-tasks-check" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3.2 8.4 3 3 6.6-7"/></svg>
      </span>
    </button>
  </li>`;
}

/**
 * @param {{
 *   root: HTMLElement,
 *   state: Readonly<{ view: 'month'|'week'|'day', anchor: Date }>,
 *   data: object,
 *   services: { dailyTasks: ReturnType<import('./store.js').createDailyTaskStore> }
 * }} context
 */
export function mount(context) {
  const root = context?.root;
  const dailyTasks = context?.services?.dailyTasks;
  if (!root) throw new Error('daily-tasks: context.root is required.');
  if (!dailyTasks) throw new Error('daily-tasks: services.dailyTasks is required.');

  let dateKey = toDateKey(context.state?.anchor instanceof Date ? context.state.anchor : new Date());
  let formOpen = false;
  let draft = '';
  let errorText = '';
  let announcement = '';
  let focusInput = false;
  let focusTaskId = null;
  let focusAddButton = false;

  root.classList.add('mod-daily-tasks-slot');

  const unsubscribe = dailyTasks.subscribe(() => render());

  function focusPending() {
    if (focusInput) {
      focusInput = false;
      root.querySelector('[data-daily-tasks-input]')?.focus();
    }
    if (focusTaskId) {
      const taskId = focusTaskId;
      focusTaskId = null;
      for (const button of root.querySelectorAll('[data-daily-tasks-toggle]')) {
        if (button.dataset.dailyTasksToggle === taskId) {
          button.focus();
          break;
        }
      }
    }
    if (focusAddButton) {
      focusAddButton = false;
      root.querySelector('[data-daily-tasks-add-toggle]')?.focus();
    }
  }

  function render() {
    const items = dailyTasks.listForDate(dateKey);
    const counts = dailyTasks.statusCounts(dateKey);
    const chips = items.length
      ? `<ul class="mod-daily-tasks-list">${items.map(renderItem).join('')}</ul>`
      : '<p class="mod-daily-tasks-empty">还没有每日任务</p>';

    root.innerHTML = `<section class="mod-daily-tasks${formOpen ? ' is-adding' : ''}" aria-labelledby="mod-daily-tasks-title">
      <div class="mod-daily-tasks-head">
        <h3 class="mod-daily-tasks-title" id="mod-daily-tasks-title">
          <span class="mod-daily-tasks-dot" aria-hidden="true"></span>每日任务
        </h3>
        <span class="mod-daily-tasks-progress" data-daily-tasks-progress>${counts.done} / ${counts.total} 完成</span>
        <span class="mod-daily-tasks-track" aria-hidden="true"><span style="width:${counts.percent}%"></span></span>
      </div>
      ${chips}
      <span class="mod-daily-tasks-hint">点任务切换状态 · 每天重置</span>
      <button
        type="button"
        class="mod-daily-tasks-add"
        data-daily-tasks-add-toggle
        aria-expanded="${formOpen ? 'true' : 'false'}"
        aria-controls="mod-daily-tasks-form"
        aria-label="${formOpen ? '收起添加每日任务' : '添加每日任务'}"
      >${formOpen ? '收起' : '＋ 添加'}</button>
      <form class="mod-daily-tasks-form" id="mod-daily-tasks-form" data-daily-tasks-form novalidate ${formOpen ? '' : 'hidden'}>
        <label class="mod-daily-tasks-sr-only" for="mod-daily-tasks-input">新每日任务名称</label>
        <input
          id="mod-daily-tasks-input"
          class="mod-daily-tasks-input"
          data-daily-tasks-input
          name="title"
          type="text"
          maxlength="80"
          placeholder="新每日任务，例如：读 20 页书"
          autocomplete="off"
          value="${escapeHtml(draft)}"
        />
        <button type="submit" class="mod-daily-tasks-submit">加入</button>
        <button type="button" class="mod-daily-tasks-cancel" data-daily-tasks-cancel>取消</button>
        ${errorText ? `<p class="mod-daily-tasks-error" role="alert">${escapeHtml(errorText)}</p>` : ''}
      </form>
      <p class="mod-daily-tasks-sr-only" aria-live="polite" data-daily-tasks-live></p>
    </section>`;

    focusPending();

    if (announcement) {
      const text = announcement;
      announcement = '';
      scheduleFrame(() => {
        const live = root.querySelector('[data-daily-tasks-live]');
        if (live) live.textContent = text;
      });
    }
  }

  function handleClick(event) {
    const addToggle = event.target.closest('[data-daily-tasks-add-toggle]');
    if (addToggle) {
      formOpen = !formOpen;
      errorText = '';
      if (formOpen) focusInput = true;
      else focusAddButton = true;
      render();
      return;
    }

    const cancel = event.target.closest('[data-daily-tasks-cancel]');
    if (cancel) {
      formOpen = false;
      draft = '';
      errorText = '';
      focusAddButton = true;
      render();
      return;
    }

    const toggle = event.target.closest('[data-daily-tasks-toggle]');
    if (toggle) {
      const taskId = toggle.dataset.dailyTasksToggle;
      const item = dailyTasks.listForDate(dateKey).find(({ task }) => task.id === taskId);
      if (!item) return;

      const next = nextTaskStatus(item.status);
      announcement = `「${item.task.title}」已标记为${TASK_STATUS_LABELS[next] ?? next}`;
      focusTaskId = taskId;
      dailyTasks.toggleStatus(taskId, dateKey);
    }
  }

  function handleSubmit(event) {
    const form = event.target.closest?.('[data-daily-tasks-form]');
    if (!form) return;
    event.preventDefault();

    const input = form.querySelector('[data-daily-tasks-input]');
    draft = input?.value ?? draft;

    try {
      const task = dailyTasks.addTask({ title: draft });
      draft = '';
      formOpen = false;
      errorText = '';
      announcement = `已添加每日任务「${task.title}」`;
      focusTaskId = task.id;
      render();
    } catch (error) {
      errorText =
        error?.code === 'DAILY_TASK_INVALID'
          ? '请输入 1–80 个字符的任务名称'
          : '添加失败，请稍后重试';
      focusInput = true;
      render();
    }
  }

  function handleInput(event) {
    const input = event.target.closest?.('[data-daily-tasks-input]');
    if (!input) return;
    draft = input.value;
    if (errorText) {
      errorText = '';
      input.closest('[data-daily-tasks-form]')?.querySelector('.mod-daily-tasks-error')?.remove();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && formOpen) {
      formOpen = false;
      draft = '';
      errorText = '';
      focusAddButton = true;
      render();
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('input', handleInput);
  root.addEventListener('keydown', handleKeydown);

  render();

  return {
    update(nextContext) {
      if (nextContext?.state?.anchor instanceof Date) {
        dateKey = toDateKey(nextContext.state.anchor);
      }
      render();
    },
    destroy() {
      unsubscribe();
      root.removeEventListener('click', handleClick);
      root.removeEventListener('submit', handleSubmit);
      root.removeEventListener('input', handleInput);
      root.removeEventListener('keydown', handleKeydown);
      root.innerHTML = '';
      root.classList.remove('mod-daily-tasks-slot');
    },
  };
}
