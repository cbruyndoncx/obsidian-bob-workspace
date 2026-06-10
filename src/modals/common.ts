import * as obsidian from 'obsidian';
export class CadencePromptModal extends obsidian.Modal {
  // Migrated from untyped main.js: instance fields are not yet declared.
  [key: string]: any;
  constructor(app, opts) {
    super(app);
    this.title = opts.title || 'Enter a name';
    this.placeholder = opts.placeholder || '';
    this.defaultValue = opts.defaultValue || '';
    this.cta = opts.cta || 'Create';
    this.onSubmit = opts.onSubmit;
    this._submitted = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-prompt-modal');
    contentEl.createEl('h3', { text: this.title });

    const input = contentEl.createEl('input', { type: 'text' });
    input.placeholder = this.placeholder;
    input.value = this.defaultValue;
    input.style.width = '100%';
    input.style.padding = '8px 10px';
    input.style.fontSize = '14px';
    input.style.marginTop = '4px';

    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      this._submitted = true;
      this.close();
      this.onSubmit(v);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });

    const row = contentEl.createDiv();
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';
    row.style.marginTop = '14px';
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: this.cta, cls: 'mod-cta' });
    ok.addEventListener('click', submit);

    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* ─────────── Yes/No confirmation modal ─────────── */
export class CadenceConfirmModal extends obsidian.Modal {
  // Migrated from untyped main.js: instance fields are not yet declared.
  [key: string]: any;
  constructor(app, opts) {
    super(app);
    this.message = opts.message || 'Are you sure?';
    this.heading = opts.title || 'Confirm';
    this.cta = opts.cta || 'Confirm';
    this.danger = opts.danger !== false; // destructive styling by default
    this.onResolve = opts.onResolve;
    this._answered = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-confirm-modal');
    contentEl.createEl('h3', { text: this.heading });
    String(this.message).split('\n').forEach((line) => contentEl.createEl('p', { text: line }));

    const row = contentEl.createDiv({ cls: 'cad-confirm-actions' });
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: this.cta, cls: this.danger ? 'mod-warning' : 'mod-cta' });
    ok.addEventListener('click', () => { this._answered = true; this.close(); this.onResolve(true); });

    setTimeout(() => ok.focus(), 0);
  }
  onClose() {
    if (!this._answered && this.onResolve) this.onResolve(false);
    this.contentEl.empty();
  }
}

// Promise-based replacement for window.confirm(); resolves true on confirm, false otherwise.
export function confirmModal(app, message, opts: any = {}) {
  return new Promise((resolve) => {
    new CadenceConfirmModal(app, { message, ...opts, onResolve: resolve }).open();
  });
}

/* ─────────── Obsidian icon picker ─────────── */
export class CadenceIconPickerModal extends obsidian.SuggestModal<any> {
  // Migrated from untyped main.js: instance fields are not yet declared.
  [key: string]: any;
  constructor(app, currentIcon, onChoose) {
    super(app);
    this.currentIcon = currentIcon || '';
    this.onChoose = onChoose;
    this.iconIds = typeof obsidian.getIconIds === 'function'
      ? obsidian.getIconIds().slice().sort()
      : [];
    this.setPlaceholder('Search Obsidian icons by name...');
  }

  getSuggestions(query) {
    const q = String(query || '').trim().toLowerCase();
    const matches = this.iconIds
      .filter((iconId) => !q || iconId.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = q && a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = q && b.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      })
      .slice(0, 150)
      .map((iconId) => ({ iconId }));
    if (!q || 'none'.includes(q) || 'clear'.includes(q) || 'remove'.includes(q)) {
      matches.unshift({ iconId: '', clear: true });
    }
    return matches;
  }

  renderSuggestion(item, el) {
    el.addClass('cad-icon-picker-result');
    const preview = el.createSpan({ cls: 'cad-icon-picker-preview' });
    try { obsidian.setIcon(preview, item.clear ? 'circle-x' : item.iconId); } catch (_) {}
    el.createSpan({ cls: 'cad-icon-picker-name', text: item.clear ? 'No icon' : item.iconId });
    if (!item.clear && item.iconId === this.currentIcon) {
      el.createSpan({ cls: 'cad-icon-picker-current', text: 'current' });
    }
  }

  onChooseSuggestion(item) {
    if (this.onChoose) this.onChoose(item.iconId || '');
  }
}

/* ─────────── Template-backed dashboard examples ─────────── */
