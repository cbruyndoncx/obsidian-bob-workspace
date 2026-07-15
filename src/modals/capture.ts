import { listEntityFiles } from '../entity-files';
import { VIEW_TYPE_BOB_APP } from '../nav';
import { projectNameFromPath, reminderTimeStr } from '../reminders';
import { confirmModal } from './common';
import * as obsidian from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { BobPlugin } from '../plugin';
import type { Reminder } from '../types';

/* Type-only declarations (erased at build time). */
export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface CaptureResult {
  text: string;
  when: string | null;
  repeat: string;
}

interface BobCaptureModalOptions {
  onSubmit: (result: CaptureResult | null) => void;
  defaultText?: string;
  defaultWhen?: string | null;
  defaultRepeat?: string;
}

/** Reminder being edited: persisted Reminder or a not-yet-saved draft. */
type EditableReminder = Partial<Reminder> & { notes?: string };

interface BobReminderEditModalOptions {
  isNew?: boolean;
}

interface ReminderPatch {
  text: string;
  notes: string;
  repeat: string;
  project: string | null;
  when?: string | null;
  notified?: boolean;
}

interface ProjectSuggestion {
  file: TFile;
  name: string;
}

export function attachRequiredValidation(submitBtn: HTMLButtonElement, requiredInputs: FormControl[]) {
  if (!submitBtn || !requiredInputs?.length) return;
  const check = () => {
    const allFilled = requiredInputs.every(inp => {
      if (!inp) return true;
      if (inp.type === 'checkbox' || inp.type === 'radio') return (inp as HTMLInputElement).checked;
      return (inp.value || '').trim().length > 0;
    });
    submitBtn.disabled = !allFilled;
    submitBtn.classList.toggle('bob-btn-disabled', !allFilled);
  };
  requiredInputs.forEach(inp => {
    if (!inp) return;
    inp.addEventListener('input', check);
    inp.addEventListener('change', check);
  });
  check();
}

/* ─────────── Quick-capture modal ─────────── */
export class BobCaptureModal extends obsidian.Modal {
  declare onSubmit: (result: CaptureResult | null) => void;
  declare defaultText: string;
  declare defaultWhen: string | null;
  declare defaultRepeat: string;
  declare _submitted: boolean;
  constructor(app: App, opts: BobCaptureModalOptions) {
    super(app);
    this.onSubmit = opts.onSubmit;
    this.defaultText = opts.defaultText || '';
    this.defaultWhen = opts.defaultWhen || null; // ISO or null
    this.defaultRepeat = opts.defaultRepeat || 'none';
    this._submitted = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bob-capture-modal');
    contentEl.createEl('h3', { text: 'Quick capture' });

    const textRow = contentEl.createDiv({ cls: 'bob-form-row' });
    textRow.createDiv({ cls: 'bob-form-label', text: 'WHAT' });
    const textInput = textRow.createEl('input', { type: 'text', cls: 'bob-form-input' });
    textInput.placeholder = 'What needs doing?';
    textInput.value = this.defaultText;

    // Schedule toggle
    const schedToggleRow = contentEl.createDiv();
    schedToggleRow.style.marginTop = '14px';
    schedToggleRow.style.display = 'flex';
    schedToggleRow.style.alignItems = 'center';
    schedToggleRow.style.gap = '8px';
    const schedCb = schedToggleRow.createEl('input', { type: 'checkbox' });
    const schedLbl = schedToggleRow.createEl('label', { text: 'Remind me' });
    schedLbl.style.fontSize = '13px';
    schedLbl.style.cursor = 'pointer';
    schedLbl.addEventListener('click', () => { schedCb.checked = !schedCb.checked; schedCb.dispatchEvent(new Event('change')); });

    // Schedule fields (hidden until toggled)
    const schedFields = contentEl.createDiv({ cls: 'bob-capture-sched' });
    schedFields.style.display = 'none';
    schedFields.style.marginTop = '12px';
    schedFields.style.gap = '12px';
    schedFields.style.display = 'none';

    const dateRow = schedFields.createDiv({ cls: 'bob-form-row' });
    dateRow.createDiv({ cls: 'bob-form-label', text: 'WHEN' });
    const dateInput = dateRow.createEl('input', { type: 'datetime-local', cls: 'bob-form-input' });
    if (this.defaultWhen) {
      const d = new Date(this.defaultWhen);
      if (!isNaN(d.getTime())) dateInput.value = toLocalDatetimeValue(d);
    } else {
      // Default to now + 1 hour, rounded to next 15min
      const dft = new Date(Date.now() + 60 * 60 * 1000);
      dft.setMinutes(Math.ceil(dft.getMinutes() / 15) * 15, 0, 0);
      dateInput.value = toLocalDatetimeValue(dft);
    }

    // Quick-pick buttons
    const quick = schedFields.createDiv();
    quick.style.display = 'flex';
    quick.style.gap = '6px';
    quick.style.marginTop = '8px';
    quick.style.flexWrap = 'wrap';
    const setQuick = (deltaMs: number) => {
      const d = new Date(Date.now() + deltaMs);
      d.setSeconds(0, 0);
      dateInput.value = toLocalDatetimeValue(d);
    };
    const mkQ = (label: string, deltaMs: number | (() => void)) => {
      const b = quick.createEl('button', { cls: 'bob-btn bob-btn-sm', text: label });
      b.type = 'button';
      b.addEventListener('click', () => setQuick(deltaMs as number));
    };
    mkQ('+15m', 15 * 60 * 1000);
    mkQ('+1h',  60 * 60 * 1000);
    mkQ('+3h',  3 * 60 * 60 * 1000);
    mkQ('Tomorrow 9am', () => {});
    quick.lastChild.addEventListener('click', () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      dateInput.value = toLocalDatetimeValue(d);
    });

    const repeatRow = schedFields.createDiv({ cls: 'bob-form-row' });
    repeatRow.style.marginTop = '10px';
    repeatRow.createDiv({ cls: 'bob-form-label', text: 'REPEAT' });
    const repeatSelect = repeatRow.createEl('select', { cls: 'bob-form-input' });
    [['none', 'No repeat'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([v, l]) => {
      const o = repeatSelect.createEl('option', { value: v, text: l });
      if (v === this.defaultRepeat) o.selected = true;
    });

    schedCb.addEventListener('change', () => {
      schedFields.style.display = schedCb.checked ? 'block' : 'none';
    });
    if (this.defaultWhen) { schedCb.checked = true; schedFields.style.display = 'block'; }

    // Action row
    const row = contentEl.createDiv();
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';
    row.style.marginTop = '18px';
    const cancel = row.createEl('button', { cls: 'bob-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { cls: 'bob-btn primary', text: 'Capture' });
    ok.type = 'button';
    attachRequiredValidation(ok, [textInput]);

    const submit = () => {
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      const result: CaptureResult = { text, when: null, repeat: 'none' };
      if (schedCb.checked && dateInput.value) {
        const d = fromLocalDatetimeValue(dateInput.value);
        if (d && !isNaN(d.getTime())) {
          result.when = d.toISOString();
          result.repeat = repeatSelect.value || 'none';
        }
      }
      this._submitted = true;
      this.close();
      this.onSubmit(result);
    };
    ok.addEventListener('click', submit);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => textInput.focus(), 0);
  }
  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* Helpers for <input type="datetime-local"> ↔ Date in local TZ */
export function toLocalDatetimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalDatetimeValue(s: string) {
  if (!s) return null;
  // datetime-local has no timezone — interpret as local time
  return new Date(s);
}

/* ─────────── Reminder edit modal (text/when/repeat/notes/delete) ─────────── */
export class BobReminderEditModal extends obsidian.Modal {
  declare plugin: BobPlugin;
  declare reminder: EditableReminder;
  declare isNew: boolean;
  declare _submitted: boolean;
  constructor(app: App, plugin: BobPlugin, reminder: EditableReminder, opts?: BobReminderEditModalOptions) {
    super(app);
    this.plugin = plugin;
    this.reminder = reminder;
    this.isNew = (opts && opts.isNew) || false;
    this._submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bob-create-modal');
    contentEl.addClass('bob-reminder-edit-modal');
    contentEl.createEl('h3', { cls: 'bob-create-title', text: this.isNew ? 'New reminder' : 'Edit reminder' });

    const form = contentEl.createDiv({ cls: 'bob-create-form' });

    /* Text */
    const textRow = form.createDiv({ cls: 'bob-create-row' });
    textRow.createDiv({ cls: 'bob-create-label', text: 'WHAT *' });
    const textInput = textRow.createEl('input', { type: 'text', cls: 'bob-create-input' });
    textInput.value = this.reminder.text || '';
    textInput.placeholder = 'What needs doing?';

    /* When */
    const whenRow = form.createDiv({ cls: 'bob-create-row' });
    whenRow.createDiv({ cls: 'bob-create-label', text: 'WHEN' });
    const whenWrap = whenRow.createDiv();
    whenWrap.style.display = 'flex';
    whenWrap.style.gap = '8px';
    whenWrap.style.alignItems = 'center';
    const dateInput = whenWrap.createEl('input', { type: 'datetime-local', cls: 'bob-create-input' });
    dateInput.style.flex = '1';
    if (this.reminder.when) {
      const d = new Date(this.reminder.when);
      if (!isNaN(d.getTime())) dateInput.value = toLocalDatetimeValue(d);
    }
    const clearBtn = whenWrap.createEl('button', { cls: 'bob-btn bob-btn-sm', text: 'Clear' });
    clearBtn.type = 'button';
    clearBtn.title = 'Move to unscheduled';
    clearBtn.addEventListener('click', () => { dateInput.value = ''; });

    /* Repeat */
    const repeatRow = form.createDiv({ cls: 'bob-create-row' });
    repeatRow.createDiv({ cls: 'bob-create-label', text: 'REPEAT' });
    const repeatSel = repeatRow.createEl('select', { cls: 'bob-create-input' });
    [['none', 'No repeat'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([v, l]) => {
      const o = repeatSel.createEl('option', { value: v, text: l });
      if (v === (this.reminder.repeat || 'none')) o.selected = true;
    });

    /* Project link */
    const projectRow = form.createDiv({ cls: 'bob-create-row' });
    projectRow.createDiv({ cls: 'bob-create-label', text: 'PROJECT' });
    const projectField = projectRow.createDiv({ cls: 'bob-rem-project-field' });
    const renderProjectField = () => {
      projectField.empty();
      if (this.reminder.project) {
        const chip = projectField.createEl('a', { cls: 'bob-rem-project-chip', text: '📁 ' + (projectNameFromPath(this.app, this.reminder.project) || 'Project') });
        chip.title = 'Open project (closes this modal)';
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(this.reminder.project);
          if (file && file instanceof obsidian.TFile) {
            this._submitted = true;
            this.close();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOB_APP)[0];
            const leafView = leaf?.view as obsidian.View & { openEntityDetailFromFile?: (file: TFile) => void };
            if (leaf && leafView && typeof leafView.openEntityDetailFromFile === 'function') {
              leafView.openEntityDetailFromFile(file);
            }
          }
        });
        const changeBtn = projectField.createEl('button', { cls: 'bob-btn bob-btn-sm', text: 'Change' });
        changeBtn.type = 'button';
        changeBtn.addEventListener('click', () => this._openReminderProjectPicker(renderProjectField));
        const removeBtn = projectField.createEl('button', { cls: 'bob-btn bob-btn-sm bob-btn-danger', text: 'Remove' });
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => {
          this.reminder.project = null;
          renderProjectField();
        });
      } else {
        const linkBtn = projectField.createEl('button', { cls: 'bob-btn bob-btn-sm', text: '📁 Link to project' });
        linkBtn.type = 'button';
        linkBtn.addEventListener('click', () => this._openReminderProjectPicker(renderProjectField));
      }
    };
    renderProjectField();

    /* Notes */
    const notesRow = form.createDiv({ cls: 'bob-create-row' });
    notesRow.style.alignItems = 'flex-start';
    notesRow.createDiv({ cls: 'bob-create-label', text: 'NOTES' });
    const notesArea = notesRow.createEl('textarea', { cls: 'bob-create-input' });
    notesArea.rows = 6;
    notesArea.placeholder = 'Context, follow-ups, what happened, related links…';
    notesArea.value = this.reminder.notes || '';
    notesArea.style.resize = 'vertical';
    notesArea.style.fontFamily = 'inherit';

    /* Actions */
    const actions = contentEl.createDiv({ cls: 'bob-create-actions' });
    if (!this.isNew) {
      const del = actions.createEl('button', { cls: 'bob-btn bob-btn-danger', text: 'Delete' });
      del.type = 'button';
      del.style.marginRight = 'auto';
      del.addEventListener('click', async () => {
        if (!(await confirmModal(this.app, 'Delete this reminder?', { title: 'Delete reminder', cta: 'Delete' }))) return;
        await this.plugin.deleteReminder(this.reminder.id);
        this._submitted = true;
        this.close();
      });
    }
    const cancel = actions.createEl('button', { cls: 'bob-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'bob-btn primary', text: this.isNew ? 'Create reminder' : 'Save' });
    save.type = 'button';
    attachRequiredValidation(save, [textInput]);

    const submit = async () => {
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      const fields: ReminderPatch = {
        text,
        notes: notesArea.value,
        repeat: repeatSel.value || 'none',
        project: this.reminder.project || null,
      };
      if (dateInput.value) {
        const d = fromLocalDatetimeValue(dateInput.value);
        if (d && !isNaN(d.getTime())) {
          fields.when = d.toISOString();
          if (fields.when !== this.reminder.when) fields.notified = false;
        }
      } else {
        fields.when = null;
        fields.notified = false;
      }
      if (this.isNew) {
        await this.plugin.addReminder(fields);
        new obsidian.Notice(fields.when
          ? `Reminder set · ${reminderTimeStr(fields.when)}`
          : 'Captured to Inbox');
      } else {
        await this.plugin.updateReminder(this.reminder.id, fields);
      }
      this._submitted = true;
      this.close();
    };
    save.addEventListener('click', submit);

    // Submit on Cmd/Ctrl+Enter from notes area; Esc cancels
    notesArea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => textInput.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }

  _openReminderProjectPicker(rerender: () => void) {
    const projectFiles = listEntityFiles(this.app, 'project');
    if (!projectFiles.length) {
      new obsidian.Notice('No projects yet. Create one in Planner → Projects first.');
      return;
    }
    const projects = projectFiles.map((f: TFile) => ({ file: f, name: projectNameFromPath(this.app, f.path) }));
    const reminder = this.reminder;
    const picker = new (class extends obsidian.SuggestModal<ProjectSuggestion> {
      declare projs: ProjectSuggestion[];
      constructor(app: App, projs: ProjectSuggestion[]) {
        super(app);
        this.projs = projs;
        this.setPlaceholder('Search projects to link this reminder to…');
      }
      getSuggestions(query: string) {
        const q = (query || '').toLowerCase();
        return this.projs.filter((p) => p.name.toLowerCase().includes(q));
      }
      renderSuggestion(item: ProjectSuggestion, el: HTMLElement) { el.setText('📁  ' + item.name); }
      onChooseSuggestion(item: ProjectSuggestion) {
        reminder.project = item.file.path;
        rerender();
      }
    })(this.app, projects);
    picker.open();
  }
}

/* ─────────── CSV parser (handles quoted fields, escaped quotes, newlines) ─────────── */
