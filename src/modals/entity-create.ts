import { ENTITIES, primaryFieldKey } from '../entities';
import { listEntities, entityValue, resolveEntityFieldDefault } from '../entity-files';
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

    const baseRequired: CreateFormControl[] = [];
    const labelFor: Record<string, { el: HTMLElement; text: string }> = {};
    const inputFor: Record<string, CreateFormControl> = {};

    const primaryKey = primaryFieldKey(this.def);
    this.def.fields.forEach((f) => {
      const isPrimary = f.key === primaryKey;
      const isRequired = isPrimary || f.required === true;
      const row = form.createDiv({ cls: 'bob-create-row' });
      const label = row.createDiv({ cls: 'bob-create-label' });
      label.setText(f.label.toUpperCase() + (isRequired ? ' *' : ''));
      labelFor[f.key] = { el: label, text: f.label.toUpperCase() };

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
        // Reference fields are picked from what exists rather than typed from
        // memory: a mistyped `[[link]]` silently fails to resolve, and an
        // unresolvable partner ref is exactly the attribution gap this guards.
        if (f.refEntity) this._attachRefDatalist(row, input as HTMLInputElement, f.refEntity);
      }
      const defaultValue = resolveEntityFieldDefault(f);
      if (!isPrimary && defaultValue !== undefined) {
        input.value = Array.isArray(defaultValue) ? defaultValue.join(', ') : String(defaultValue);
      }
      input.dataset.fieldKey = f.key;
      input.dataset.fieldType = fieldType;
      if (isRequired) {
        input.required = true;
        baseRequired.push(input);
      }
      inputFor[f.key] = input;
      inputs.push(input);
    });

    /* Action row */
    const actions = contentEl.createDiv({ cls: 'bob-create-actions' });
    const cancel = actions.createEl('button', { cls: 'bob-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());

    const submitBtn = actions.createEl('button', { cls: 'bob-btn primary', text: `Create ${this.def.label}` });
    submitBtn.type = 'button';

    /* Conditional requirements are re-evaluated on every edit, not fixed at open:
     * the rule "source = partner ⇒ partner_ref required" only binds once the user
     * has chosen that source, and must unbind again if they change their mind. */
    const rules = this.def.conditionalRequired || [];
    const syncRequired = () => {
      const active = new Set(baseRequired);
      const conditional = new Set<string>();
      rules.forEach((rule) => {
        const matches = Object.entries(rule.when || {})
          .every(([k, v]) => String(inputFor[k]?.value ?? '').trim() === String(v));
        if (!matches) return;
        (rule.require || []).forEach((key) => {
          const el = inputFor[key];
          if (el) { active.add(el); conditional.add(key); }
        });
      });
      // Reflect the requirement in the label and in `required`, so the form says
      // why the button is disabled instead of just being disabled.
      Object.entries(labelFor).forEach(([key, lbl]) => {
        const el = inputFor[key];
        const req = el ? active.has(el) : false;
        if (el) el.required = req;
        lbl.el.setText(lbl.text + (req ? ' *' : ''));
        lbl.el.toggleClass('bob-create-label-conditional', conditional.has(key));
      });
      const filled = [...active].every((el) => (el.value || '').trim().length > 0);
      submitBtn.disabled = !filled;
      submitBtn.classList.toggle('bob-btn-disabled', !filled);
    };
    inputs.forEach((el) => {
      el.addEventListener('input', syncRequired);
      el.addEventListener('change', syncRequired);
    });
    syncRequired();

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
      // Enter-to-submit bypasses the disabled button, so re-check the rules here.
      for (const rule of rules) {
        const matches = Object.entries(rule.when || {})
          .every(([k, v]) => String(inputFor[k]?.value ?? '').trim() === String(v));
        if (!matches) continue;
        const missing = (rule.require || []).find((key) => !String(inputFor[key]?.value ?? '').trim());
        if (missing) { inputFor[missing]?.focus(); return; }
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

  /** Back a text input with a datalist of an entity's records, offered as the
   * `[[wikilink]]` the frontmatter field actually stores. */
  _attachRefDatalist(row: HTMLElement, input: HTMLInputElement, entityKey: string) {
    const def = ENTITIES[entityKey];
    if (!def) return;
    const primary = primaryFieldKey(def);
    const names = listEntities(this.app, entityKey)
      .map((e) => String(entityValue(e, primary, def) || e.basename).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (!names.length) return;
    const listId = `bob-ref-${entityKey}-${Math.random().toString(36).slice(2, 8)}`;
    const list = row.createEl('datalist');
    list.id = listId;
    names.forEach((n) => list.createEl('option', { value: `[[${n}]]` }));
    input.setAttr('list', listId);
    input.placeholder = `e.g. [[${names[0]}]]`;
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
