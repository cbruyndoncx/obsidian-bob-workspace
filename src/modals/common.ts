import * as obsidian from 'obsidian';
import type { App } from 'obsidian';

interface BobPromptModalOptions {
  title?: string;
  placeholder?: string;
  defaultValue?: string;
  cta?: string;
  onSubmit: (value: string | null) => void;
}

export class BobPromptModal extends obsidian.Modal {
  declare title: string;
  declare placeholder: string;
  declare defaultValue: string;
  declare cta: string;
  declare onSubmit: (value: string | null) => void;
  declare _submitted: boolean;
  constructor(app: App, opts: BobPromptModalOptions) {
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
    contentEl.addClass('bob-prompt-modal');
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
interface BobConfirmModalOptions {
  message?: string;
  title?: string;
  cta?: string;
  danger?: boolean;
  onResolve: (confirmed: boolean) => void;
}

export class BobConfirmModal extends obsidian.Modal {
  declare message: string;
  declare heading: string;
  declare cta: string;
  declare danger: boolean;
  declare onResolve: (confirmed: boolean) => void;
  declare _answered: boolean;
  constructor(app: App, opts: BobConfirmModalOptions) {
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
    contentEl.addClass('bob-confirm-modal');
    contentEl.createEl('h3', { text: this.heading });
    String(this.message).split('\n').forEach((line) => contentEl.createEl('p', { text: line }));

    const row = contentEl.createDiv({ cls: 'bob-confirm-actions' });
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
export function confirmModal(app: App, message: string, opts: Partial<Omit<BobConfirmModalOptions, 'message' | 'onResolve'>> = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    new BobConfirmModal(app, { message, ...opts, onResolve: resolve }).open();
  });
}

/* ─────────── Obsidian icon picker ─────────── */
interface IconSuggestion {
  iconId: string;
  /** Sentinel row that clears the current icon. */
  clear?: boolean;
}

export class BobIconPickerModal extends obsidian.SuggestModal<IconSuggestion> {
  declare currentIcon: string;
  declare onChoose: (iconId: string) => void;
  declare iconIds: string[];
  constructor(app: App, currentIcon: string, onChoose: (iconId: string) => void) {
    super(app);
    this.currentIcon = currentIcon || '';
    this.onChoose = onChoose;
    this.iconIds = typeof obsidian.getIconIds === 'function'
      ? obsidian.getIconIds().slice().sort()
      : [];
    this.setPlaceholder('Search Obsidian icons by name...');
  }

  getSuggestions(query: string): IconSuggestion[] {
    const q = String(query || '').trim().toLowerCase();
    const matches: IconSuggestion[] = this.iconIds
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

  renderSuggestion(item: IconSuggestion, el: HTMLElement) {
    el.addClass('bob-icon-picker-result');
    const preview = el.createSpan({ cls: 'bob-icon-picker-preview' });
    try { obsidian.setIcon(preview, item.clear ? 'circle-x' : item.iconId); } catch (_) {}
    el.createSpan({ cls: 'bob-icon-picker-name', text: item.clear ? 'No icon' : item.iconId });
    if (!item.clear && item.iconId === this.currentIcon) {
      el.createSpan({ cls: 'bob-icon-picker-current', text: 'current' });
    }
  }

  onChooseSuggestion(item: IconSuggestion) {
    if (this.onChoose) this.onChoose(item.iconId || '');
  }
}

/* ─────────── Template-backed dashboard examples ─────────── */
