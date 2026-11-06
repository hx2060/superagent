/**
 * Inbox module: editable day-view 清单 (task inbox) and 便签 (sticky notes).
 *
 * The module owns the two sidebar panels and renders them from
 * `services.inbox` (see store.js). Task status cycling keeps the existing
 * `[data-task-row]` / `[data-task-toggle]` / `[data-task-progress-*]` contract.
 * New editing controls use `data-inbox-*` attributes.
 *
 * It only reads/writes inside `context.root` and never imports app internals.
 */

import { toDateKey } from '../../calendar.js';
import { TASK_STATUS_LABELS, nextTaskStatus } from '../../tasks.js';
import {
  NOTE_TEXT_MAX_LENGTH,
  NOTE_TONES,
  TASK_TITLE_MAX_LENGTH,
} from './store.js';

export {
  DEFAULT_TASK_ICON,
  NOTE_TEXT_MAX_LENGTH,
  NOTE_TONES,
  TASK_TITLE_MAX_LENGTH,
  createInboxStore,
  normalizeNoteText,
  normalizeTaskTitle,
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

function plusIcon() {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
}

function pencilIcon() {
  return '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.5 3.2 2.3 2.3L6 12.3l-3.1.8.8-3.1 6.8-6.8Z"/><path d="m9.3 4.4 2.3 2.3"/></svg>';
}

function trashIcon() {
  return '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 4.5h9M6.5 4.5V3.2h3v1.3M5 4.5l.6 8.3h4.8l.6-8.3"/><path d="M7 7v3.5M9 7v3.5"/></svg>';
}

/**
 * @param {{
 *   root: HTMLElement,
 *   state: Readonly<{ view: 'month'|'week'|'day', anchor: Date }>,
 *   data: object,
 *   services: { inbox: ReturnType<import('./store.js').createInboxStore> }
 * }} context
 */
export function mount(context) {
  const root = context?.root;
  const inbox = context?.services?.inbox;
  if (!root) throw new Error('inbox: context.root is required.');
  if (!inbox) throw new Error('inbox: services.inbox is required.');

  let dateKey = toDateKey(context.state?.anchor instanceof Date ? context.state.anchor : new Date());
  let addingTask = false;
  let taskDraft = '';
  let addingNote = false;
  let noteDraft = '';
  let editingTaskId = null;
  let taskEditDraft = '';
  let editingNoteId = null;
  let noteEditDraft = '';
  let formError = null;
  let pendingDelete = null;
  let focusRequest = null;
  let announcement = null;

  function errorMessage(error) {
    if (error?.code === 'INBOX_TASK_TITLE_INVALID') {
      return `请输入 1–${TASK_TITLE_MAX_LENGTH} 个字符的任务名称`;
    }
    if (error?.code === 'INBOX_NOTE_TEXT_INVALID') {
      return `请输入 1–${NOTE_TEXT_MAX_LENGTH} 个字符的便签内容`;
    }
    return '保存失败，请稍后重试';
  }

  function formErrorHtml(kind, id) {
    if (!formError || formError.kind !== kind || formError.id !== id) return '';
    return `<p class="mod-inbox-error" role="alert">${escapeHtml(formError.message)}</p>`;
  }

  function renderTaskRow(task) {
    const id = escapeHtml(task.id);
    const title = escapeHtml(task.title);
    const status = task.status;
    const label = TASK_STATUS_LABELS[status] ?? status;

    if (editingTaskId === task.id) {
      return `<li class="day-task mod-inbox-task is-editing" data-task-row="${id}" data-status="${status}">
        <form class="mod-inbox-task-form" data-inbox-task-form="${id}" novalidate>
          <label class="mod-inbox-sr-only" for="mod-inbox-task-edit-${id}">修改任务名称</label>
          <input
            id="mod-inbox-task-edit-${id}"
            class="mod-inbox-input"
            data-inbox-task-edit-input
            name="title"
            type="text"
            maxlength="${TASK_TITLE_MAX_LENGTH}"
            autocomplete="off"
            value="${escapeHtml(taskEditDraft)}"
          />
          <div class="mod-inbox-form-actions">
            <button type="submit" class="mod-inbox-primary">保存</button>
            <button type="button" class="mod-inbox-secondary" data-inbox-cancel>取消</button>
          </div>
          ${formErrorHtml('task', task.id)}
        </form>
      </li>`;
    }

    const confirming = pendingDelete?.kind === 'task' && pendingDelete.id === task.id;
    return `<li class="day-task mod-inbox-task" data-task-row="${id}" data-status="${status}">
      <span class="task-emoji" aria-hidden="true">${escapeHtml(task.icon)}</span>
      <span class="task-body">
        <span class="task-title">${title}</span>
        <span class="task-status-label">${label}</span>
      </span>
      <span class="mod-inbox-actions">
        <button
          type="button"
          class="mod-inbox-icon-btn"
          data-inbox-edit-task="${id}"
          aria-label="修改任务「${title}」"
          title="修改"
        >${pencilIcon()}</button>
        <button
          type="button"
          class="mod-inbox-icon-btn mod-inbox-icon-btn--danger${confirming ? ' is-confirming' : ''}"
          data-inbox-delete-task="${id}"
          aria-label="${confirming ? `确认删除任务「${title}」` : `删除任务「${title}」`}"
          title="${confirming ? '再次点击确认删除' : '删除'}"
        >${confirming ? '确认删除' : trashIcon()}</button>
      </span>
      <button
        type="button"
        class="task-check"
        data-task-toggle="${id}"
        data-status="${status}"
        aria-label="切换任务「${title}」的状态，当前${label}"
        title="点击切换：${STATUS_CYCLE_HINT}"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.2 8.4 3 3 6.6-7"/></svg>
      </button>
    </li>`;
  }

  function renderTaskAddForm() {
    return `<form class="mod-inbox-task-form mod-inbox-task-form--new" id="mod-inbox-task-add" data-inbox-task-form="new" novalidate>
      <label class="mod-inbox-sr-only" for="mod-inbox-task-add-input">新任务名称</label>
      <input
        id="mod-inbox-task-add-input"
        class="mod-inbox-input"
        data-inbox-task-add-input
        name="title"
        type="text"
        maxlength="${TASK_TITLE_MAX_LENGTH}"
        autocomplete="off"
        placeholder="新任务，例如：整理桌面"
        value="${escapeHtml(taskDraft)}"
      />
      <div class="mod-inbox-form-actions">
        <button type="submit" class="mod-inbox-primary">添加</button>
        <button type="button" class="mod-inbox-secondary" data-inbox-cancel>取消</button>
      </div>
      ${formErrorHtml('task', 'new')}
    </form>`;
  }

  function renderTasksPanel(tasks, counts) {
    const rows = tasks.length
      ? `<ul class="day-task-list">${tasks.map(renderTaskRow).join('')}</ul>`
      : '<div class="day-empty">这一天还没有清单任务</div>';
    return `<section class="day-panel day-tasks-panel mod-inbox-panel mod-inbox-tasks" aria-labelledby="mod-inbox-tasks-title">
      <header class="day-panel-head">
        <h2 class="day-panel-title" id="mod-inbox-tasks-title"><span class="day-dot day-dot--green" aria-hidden="true"></span>清单</h2>
        <div class="day-task-progress">
          <span data-task-progress-text>${counts.done} / ${counts.total} 完成</span>
          <span class="task-progress-track" aria-hidden="true"><span class="task-progress-fill" data-task-progress-fill style="width:${counts.percent}%"></span></span>
        </div>
        <button
          type="button"
          class="mod-inbox-add"
          data-inbox-add-task
          aria-expanded="${addingTask ? 'true' : 'false'}"
          ${addingTask ? 'aria-controls="mod-inbox-task-add"' : ''}
          aria-label="${addingTask ? '收起添加清单任务' : '添加清单任务'}"
          title="${addingTask ? '收起' : '添加清单任务'}"
        >${plusIcon()}</button>
      </header>
      ${rows}
      ${addingTask ? renderTaskAddForm() : ''}
      <p class="day-task-hint">点圆点切换状态 · 点铅笔修改 · 删除需再次确认</p>
      <p class="mod-inbox-sr-only" aria-live="polite" data-task-live></p>
    </section>`;
  }

  function renderNoteCard(note) {
    const id = escapeHtml(note.id);
    const tone = NOTE_TONES.includes(note.tone) ? note.tone : 'yellow';
    const tilt = Number.isFinite(note.tilt) ? note.tilt : 0;

    if (editingNoteId === note.id) {
      return `<article class="day-note day-note--${tone} mod-inbox-note is-editing" data-note-row="${id}" style="--tilt:${tilt}deg">
        <form class="mod-inbox-note-form" data-inbox-note-form="${id}" novalidate>
          <label class="mod-inbox-sr-only" for="mod-inbox-note-edit-${id}">修改便签内容</label>
          <textarea
            id="mod-inbox-note-edit-${id}"
            class="mod-inbox-textarea"
            data-inbox-note-edit-input
            rows="3"
            maxlength="${NOTE_TEXT_MAX_LENGTH}"
          >${escapeHtml(noteEditDraft)}</textarea>
          <div class="mod-inbox-form-actions">
            <button type="submit" class="mod-inbox-primary">保存</button>
            <button type="button" class="mod-inbox-secondary" data-inbox-cancel>取消</button>
          </div>
          ${formErrorHtml('note', note.id)}
        </form>
      </article>`;
    }

    const confirming = pendingDelete?.kind === 'note' && pendingDelete.id === note.id;
    const text = escapeHtml(note.text);
    return `<article class="day-note day-note--${tone} mod-inbox-note" data-note-row="${id}" style="--tilt:${tilt}deg">
      <div class="mod-inbox-note-actions">
        <button
          type="button"
          class="mod-inbox-icon-btn"
          data-inbox-edit-note="${id}"
          aria-label="修改便签"
          title="修改"
        >${pencilIcon()}</button>
        <button
          type="button"
          class="mod-inbox-icon-btn mod-inbox-icon-btn--danger${confirming ? ' is-confirming' : ''}"
          data-inbox-delete-note="${id}"
          aria-label="${confirming ? '确认删除便签' : '删除便签'}"
          title="${confirming ? '再次点击确认删除' : '删除'}"
        >${confirming ? '确认删除' : trashIcon()}</button>
      </div>
      <p>${text}</p>
      <span class="day-note-foot">随手记</span>
    </article>`;
  }

  function renderNoteAddForm() {
    return `<form class="mod-inbox-note-form mod-inbox-note-form--new" id="mod-inbox-note-add" data-inbox-note-form="new" novalidate>
      <label class="mod-inbox-sr-only" for="mod-inbox-note-add-input">新便签内容</label>
      <textarea
        id="mod-inbox-note-add-input"
        class="mod-inbox-textarea"
        data-inbox-note-add-input
        rows="3"
        maxlength="${NOTE_TEXT_MAX_LENGTH}"
        placeholder="写点什么…"
      >${escapeHtml(noteDraft)}</textarea>
      <div class="mod-inbox-form-actions">
        <button type="submit" class="mod-inbox-primary">保存</button>
        <button type="button" class="mod-inbox-secondary" data-inbox-cancel>取消</button>
      </div>
      ${formErrorHtml('note', 'new')}
    </form>`;
  }

  function renderNotesPanel(notes) {
    const cards = notes.length
      ? `<div class="day-notes">${notes.map(renderNoteCard).join('')}</div>`
      : '<div class="day-empty">这一天还没有便签</div>';
    return `<section class="day-panel day-notes-panel mod-inbox-panel mod-inbox-notes" aria-labelledby="mod-inbox-notes-title">
      <header class="day-panel-head">
        <h2 class="day-panel-title" id="mod-inbox-notes-title"><span class="day-dot day-dot--butter" aria-hidden="true"></span>便签</h2>
        <div class="mod-inbox-head-actions">
          <span class="day-panel-meta">${notes.length} 条</span>
          <button
            type="button"
            class="mod-inbox-add"
            data-inbox-add-note
            aria-expanded="${addingNote ? 'true' : 'false'}"
            ${addingNote ? 'aria-controls="mod-inbox-note-add"' : ''}
            aria-label="${addingNote ? '收起添加便签' : '添加便签'}"
            title="${addingNote ? '收起' : '添加便签'}"
          >${plusIcon()}</button>
        </div>
      </header>
      ${cards}
      ${addingNote ? renderNoteAddForm() : ''}
      <p class="mod-inbox-sr-only" aria-live="polite" data-inbox-note-live></p>
    </section>`;
  }

  function focusSelector(request) {
    switch (request.type) {
      case 'task-add':
        return '[data-inbox-add-task]';
      case 'task-add-input':
        return '[data-inbox-task-add-input]';
      case 'task-edit-input':
        return '[data-inbox-task-edit-input]';
      case 'task-edit-button':
        return `[data-inbox-edit-task="${CSS.escape(request.id)}"]`;
      case 'task-delete-button':
        return `[data-inbox-delete-task="${CSS.escape(request.id)}"]`;
      case 'task-toggle':
        return `[data-task-toggle="${CSS.escape(request.id)}"]`;
      case 'note-add':
        return '[data-inbox-add-note]';
      case 'note-add-input':
        return '[data-inbox-note-add-input]';
      case 'note-edit-input':
        return '[data-inbox-note-edit-input]';
      case 'note-edit-button':
        return `[data-inbox-edit-note="${CSS.escape(request.id)}"]`;
      case 'note-delete-button':
        return `[data-inbox-delete-note="${CSS.escape(request.id)}"]`;
      default:
        return '';
    }
  }

  function restoreFocus() {
    if (!focusRequest) return;
    const request = focusRequest;
    focusRequest = null;
    const selector = focusSelector(request);
    const element = selector ? root.querySelector(selector) : null;
    if (!element) return;
    element.focus();
    if (request.type.endsWith('-input')) element.closest('form')?.scrollIntoView({ block: 'nearest' });
  }

  function flushAnnouncement() {
    if (!announcement) return;
    const { scope, text } = announcement;
    announcement = null;
    scheduleFrame(() => {
      const live = root.querySelector(scope === 'note' ? '[data-inbox-note-live]' : '[data-task-live]');
      if (live) live.textContent = text;
    });
  }

  function render() {
    const tasks = inbox.listTasks();
    const notes = inbox.listNotes(dateKey);
    const counts = inbox.taskProgress();
    root.innerHTML = `${renderTasksPanel(tasks, counts)}${renderNotesPanel(notes)}`;
    restoreFocus();
    flushAnnouncement();
  }

  function closeOtherForms() {
    addingTask = false;
    addingNote = false;
    editingTaskId = null;
    editingNoteId = null;
    formError = null;
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const addTaskButton = target.closest('[data-inbox-add-task]');
    if (addTaskButton) {
      const wasAdding = addingTask;
      closeOtherForms();
      pendingDelete = null;
      taskDraft = '';
      if (wasAdding) {
        addingTask = false;
        focusRequest = { type: 'task-add' };
      } else {
        addingTask = true;
        focusRequest = { type: 'task-add-input' };
      }
      render();
      return;
    }

    const addNoteButton = target.closest('[data-inbox-add-note]');
    if (addNoteButton) {
      const wasAdding = addingNote;
      closeOtherForms();
      pendingDelete = null;
      noteDraft = '';
      if (wasAdding) {
        addingNote = false;
        focusRequest = { type: 'note-add' };
      } else {
        addingNote = true;
        focusRequest = { type: 'note-add-input' };
      }
      render();
      return;
    }

    const cancel = target.closest('[data-inbox-cancel]');
    if (cancel) {
      const taskForm = cancel.closest('[data-inbox-task-form]');
      if (taskForm) {
        const id = taskForm.dataset.inboxTaskForm;
        formError = null;
        if (id === 'new') {
          addingTask = false;
          taskDraft = '';
          focusRequest = { type: 'task-add' };
        } else {
          editingTaskId = null;
          taskEditDraft = '';
          focusRequest = { type: 'task-edit-button', id };
        }
        render();
        return;
      }
      const noteForm = cancel.closest('[data-inbox-note-form]');
      if (noteForm) {
        const id = noteForm.dataset.inboxNoteForm;
        formError = null;
        if (id === 'new') {
          addingNote = false;
          noteDraft = '';
          focusRequest = { type: 'note-add' };
        } else {
          editingNoteId = null;
          noteEditDraft = '';
          focusRequest = { type: 'note-edit-button', id };
        }
        render();
      }
      return;
    }

    const editTaskButton = target.closest('[data-inbox-edit-task]');
    if (editTaskButton) {
      const id = editTaskButton.dataset.inboxEditTask;
      const task = inbox.listTasks().find((item) => item.id === id);
      if (!task) return;
      closeOtherForms();
      pendingDelete = null;
      editingTaskId = id;
      taskEditDraft = task.title;
      focusRequest = { type: 'task-edit-input' };
      render();
      return;
    }

    const deleteTaskButton = target.closest('[data-inbox-delete-task]');
    if (deleteTaskButton) {
      const id = deleteTaskButton.dataset.inboxDeleteTask;
      const task = inbox.listTasks().find((item) => item.id === id);
      if (!task) return;
      closeOtherForms();
      if (pendingDelete?.kind === 'task' && pendingDelete.id === id) {
        pendingDelete = null;
        const removed = inbox.deleteTask(id);
        announcement = { scope: 'task', text: `已删除任务「${removed.title}」` };
        focusRequest = { type: 'task-add' };
        render();
      } else {
        pendingDelete = { kind: 'task', id };
        announcement = { scope: 'task', text: `再次点击垃圾桶确认删除「${task.title}」` };
        focusRequest = { type: 'task-delete-button', id };
        render();
      }
      return;
    }

    const editNoteButton = target.closest('[data-inbox-edit-note]');
    if (editNoteButton) {
      const id = editNoteButton.dataset.inboxEditNote;
      const note = inbox.listNotes(dateKey).find((item) => item.id === id);
      if (!note) return;
      closeOtherForms();
      pendingDelete = null;
      editingNoteId = id;
      noteEditDraft = note.text;
      focusRequest = { type: 'note-edit-input' };
      render();
      return;
    }

    const deleteNoteButton = target.closest('[data-inbox-delete-note]');
    if (deleteNoteButton) {
      const id = deleteNoteButton.dataset.inboxDeleteNote;
      const note = inbox.listNotes(dateKey).find((item) => item.id === id);
      if (!note) return;
      closeOtherForms();
      if (pendingDelete?.kind === 'note' && pendingDelete.id === id) {
        pendingDelete = null;
        inbox.deleteNote(id);
        announcement = { scope: 'note', text: '已删除便签' };
        focusRequest = { type: 'note-add' };
        render();
      } else {
        pendingDelete = { kind: 'note', id };
        announcement = { scope: 'note', text: '再次点击垃圾桶确认删除便签' };
        focusRequest = { type: 'note-delete-button', id };
        render();
      }
      return;
    }

    const toggle = target.closest('[data-task-toggle]');
    if (toggle) {
      const id = toggle.dataset.taskToggle;
      const task = inbox.listTasks().find((item) => item.id === id);
      if (!task) return;
      pendingDelete = null;
      const next = nextTaskStatus(task.status);
      announcement = {
        scope: 'task',
        text: `「${task.title}」已标记为${TASK_STATUS_LABELS[next] ?? next}`,
      };
      focusRequest = { type: 'task-toggle', id };
      inbox.setTaskStatus(id, next);
    }
  }

  function handleSubmit(event) {
    const form = event.target instanceof Element ? event.target.closest('form') : null;
    if (!form) return;

    const taskForm = form.matches('[data-inbox-task-form]') ? form : null;
    if (taskForm) {
      event.preventDefault();
      const id = taskForm.dataset.inboxTaskForm;
      if (id === 'new') {
        const input = taskForm.querySelector('[data-inbox-task-add-input]');
        taskDraft = input?.value ?? taskDraft;
        try {
          const task = inbox.addTask({ title: taskDraft });
          addingTask = false;
          taskDraft = '';
          formError = null;
          announcement = { scope: 'task', text: `已添加任务「${task.title}」` };
          focusRequest = { type: 'task-edit-button', id: task.id };
          render();
        } catch (error) {
          formError = { kind: 'task', id: 'new', message: errorMessage(error) };
          focusRequest = { type: 'task-add-input' };
          render();
        }
        return;
      }

      const input = taskForm.querySelector('[data-inbox-task-edit-input]');
      taskEditDraft = input?.value ?? taskEditDraft;
      try {
        const task = inbox.updateTask(id, { title: taskEditDraft });
        editingTaskId = null;
        taskEditDraft = '';
        formError = null;
        announcement = { scope: 'task', text: `已保存任务「${task.title}」` };
        focusRequest = { type: 'task-edit-button', id };
        render();
      } catch (error) {
        formError = { kind: 'task', id, message: errorMessage(error) };
        focusRequest = { type: 'task-edit-input' };
        render();
      }
      return;
    }

    const noteForm = form.matches('[data-inbox-note-form]') ? form : null;
    if (!noteForm) return;
    event.preventDefault();
    const id = noteForm.dataset.inboxNoteForm;

    if (id === 'new') {
      const input = noteForm.querySelector('[data-inbox-note-add-input]');
      noteDraft = input?.value ?? noteDraft;
      try {
        const note = inbox.addNote({ date: dateKey, text: noteDraft });
        addingNote = false;
        noteDraft = '';
        formError = null;
        announcement = { scope: 'note', text: '已添加便签' };
        focusRequest = { type: 'note-edit-button', id: note.id };
        render();
      } catch (error) {
        formError = { kind: 'note', id: 'new', message: errorMessage(error) };
        focusRequest = { type: 'note-add-input' };
        render();
      }
      return;
    }

    const input = noteForm.querySelector('[data-inbox-note-edit-input]');
    noteEditDraft = input?.value ?? noteEditDraft;
    try {
      inbox.updateNote(id, { text: noteEditDraft });
      editingNoteId = null;
      noteEditDraft = '';
      formError = null;
      announcement = { scope: 'note', text: '已保存便签' };
      focusRequest = { type: 'note-edit-button', id };
      render();
    } catch (error) {
      formError = { kind: 'note', id, message: errorMessage(error) };
      focusRequest = { type: 'note-edit-input' };
      render();
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('[data-inbox-task-add-input]')) taskDraft = target.value;
    else if (target.matches('[data-inbox-task-edit-input]')) taskEditDraft = target.value;
    else if (target.matches('[data-inbox-note-add-input]')) noteDraft = target.value;
    else if (target.matches('[data-inbox-note-edit-input]')) noteEditDraft = target.value;
    else return;

    if (formError) {
      formError = null;
      target.closest('form')?.querySelector('.mod-inbox-error')?.remove();
    }
  }

  function handleKeydown(event) {
    if (event.key !== 'Escape') return;

    if (editingTaskId) {
      const id = editingTaskId;
      editingTaskId = null;
      taskEditDraft = '';
      formError = null;
      focusRequest = { type: 'task-edit-button', id };
      render();
      return;
    }
    if (editingNoteId) {
      const id = editingNoteId;
      editingNoteId = null;
      noteEditDraft = '';
      formError = null;
      focusRequest = { type: 'note-edit-button', id };
      render();
      return;
    }
    if (addingTask) {
      addingTask = false;
      taskDraft = '';
      formError = null;
      focusRequest = { type: 'task-add' };
      render();
      return;
    }
    if (addingNote) {
      addingNote = false;
      noteDraft = '';
      formError = null;
      focusRequest = { type: 'note-add' };
      render();
      return;
    }
    if (pendingDelete) {
      pendingDelete = null;
      render();
    }
  }

  const unsubscribe = inbox.subscribe(() => render());
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
    },
  };
}
