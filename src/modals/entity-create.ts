import { ENTITIES, primaryFieldKey } from '../entities';
import { resolveEntityFieldDefault } from '../entity-files';
import { attachRequiredValidation } from './capture';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import type { BobEntityDef, BobEntityField } from '../entities';

/** Inputs rendered by the create form (no textarea fields here). */
type CreateFormControl = HTMLInputElement | HTMLSelectElement;

export interface EntityCreateResult {
  name: string;
  values: Record<string, string | number | string[]>;
}

interface BobEntityCreateModalOptions {
  onSubmit: (result: EntityCreateResult | null) => void;
}

export class BobEntityCreateModal extends obsidian.Modal {
  declare entityKey: string;
  declare def: BobEntityDef;
  declare onSubmit: (result: EntityCreateResult | null) => void;
  declare _submitted: boolean;
  constructor(app: App, entityKey: string, opts: BobEntityCreateModalOptions) {
    super(app);
    this.entityKey = entityKey;
    this.def = ENTITIES[entityKey];
    this.onSubmit = opts.onSubmit;
    this._submitted = false;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass('bob-create-modal');
    if (modalEl) modalEl.addClass('bob-create-modal-shell');

    contentEl.createEl('h3', { cls: 'bob-create-title', text: `New ${this.def.label}` });

    const form = contentEl.createDiv({ cls: 'bob-create-form' });
    const inputs: CreateFormControl[] = [];

    const requiredInputs: CreateFormControl[] = [];

    const primaryKey = primaryFieldKey(this.def);
    this.def.fields.forEach((f) => {
      const isPrimary = f.key === primaryKey;
      const isRequired = isPrimary || f.required === true;
      const row = form.createDiv({ cls: 'bob-create-row' });
      const label = row.createDiv({ cls: 'bob-create-label' });
      label.setText(f.label.toUpperCase() + (isRequired ? ' *' : ''));

      let input: CreateFormControl;
      const fieldType = f.type || 'text';

      if (fieldType === 'enum') {
        input = row.createEl('select', { cls: 'bob-create-input' });
        input.createEl('option', { value: '', text: '— —' });
        (f.options || []).forEach((opt) => input.createEl('option', { value: opt, text: opt }));
      } else if (fieldType === 'date') {
        input = row.createEl('input', { type: 'date', cls: 'bob-create-input' });
        input.lang = navigator.language || '';
      } else if (fieldType === 'number' || fieldType === 'currency') {
        input = row.createEl('input', { type: 'number', cls: 'bob-create-input' });
        input.placeholder = '0';
      } else if (fieldType === 'email') {
        input = row.createEl('input', { type: 'email', cls: 'bob-create-input' });
        input.placeholder = 'name@example.com';
      } else if (fieldType === 'tags') {
        input = row.createEl('input', { type: 'text', cls: 'bob-create-input' });
        input.placeholder = 'tag1, tag2';
      } else {
        input = row.createEl('input', { type: 'text', cls: 'bob-create-input' });
        input.placeholder = this._placeholderFor(f, isPrimary);
      }
      const defaultValue = resolveEntityFieldDefault(f);
      if (!isPrimary && defaultValue !== undefined) {
        input.value = Array.isArray(defaultValue) ? defaultValue.join(', ') : String(defaultValue);
      }
      input.dataset.fieldKey = f.key;
      input.dataset.fieldType = fieldType;
      if (isRequired) {
        input.required = true;
        requiredInputs.push(input);
      }
      inputs.push(input);
    });

    /* Action row */
    const actions = contentEl.createDiv({ cls: 'bob-create-actions' });
    const cancel = actions.createEl('button', { cls: 'bob-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());

    const submitBtn = actions.createEl('button', { cls: 'bob-btn primary', text: `Create ${this.def.label}` });
    submitBtn.type = 'button';
    attachRequiredValidation(submitBtn, requiredInputs);

    const submit = () => {
      const values: Record<string, string | number | string[]> = {};
      let primaryValue: string | null = null;
      inputs.forEach((el, idx) => {
        const key = el.dataset.fieldKey;
        const type = el.dataset.fieldType;
        let raw: string | number | string[] | null = el.value;
        if (key === primaryKey) primaryValue = (raw || '').trim();
        if (raw === '' || raw == null) return;
        if (type === 'tags') raw = raw.split(',').map((t) => t.trim()).filter(Boolean);
        else if (type === 'number' || type === 'currency') {
          const n = Number(raw);
          raw = isNaN(n) ? null : n;
        }
        if (raw == null) return;
        if (Array.isArray(raw) && raw.length === 0) return;
        values[key] = raw;
      });
      if (!primaryValue) {
        const primaryInput = inputs.find((input) => input.dataset.fieldKey === primaryKey);
        if (primaryInput) primaryInput.focus();
        return;
      }
      this._submitted = true;
      this.close();
      this.onSubmit({ name: primaryValue, values });
    };
    submitBtn.addEventListener('click', submit);

    // Submit on Enter from any text input
    inputs.forEach((el) => {
      el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') this.close();
      });
    });

    setTimeout(() => { if (inputs[0]) { inputs[0].focus(); } }, 0);
  }

  _placeholderFor(field: BobEntityField, isPrimary: boolean): string {
    if (!isPrimary) return '';
    const ek = this.entityKey;
    const examples: Record<string, string> = {
      contact:      'e.g. Jane Smith',
      company:      'e.g. Acme Corp',
      partner:      'e.g. Acme Distribution',
      deal:         'e.g. Acme — FTTH expansion',
      registration: 'e.g. Vodacom 12-site FTTB',
      commission:   'e.g. C-2026-Q2-0042',
      lead:         'e.g. Sarah from Vodacom',
      certification:'e.g. Cisco CCNP — May 2026',
      activity:     'e.g. Discovery call with Jane',
      sequence:     'e.g. Outbound — SMB',
      project:      'e.g. Q3 Cadence launch',
    };
    return examples[ek] || '';
  }

  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* ─────────── Prompt modal (replaces blocked window.prompt) ─────────── */
