import * as obsidian from 'obsidian';
export const PLAYBOOK_RUNNER_VIEW_TYPE = 'agent-client-playbook-runner';
export const PLAYBOOK_RUNNER_PINNED_KEY = 'bob-pinned-playbooks';

export class CadencePlaybookRunnerView extends ((obsidian as any).BasesView || class {}) {
  // Migrated from untyped main.js: instance fields are not yet declared.
  [key: string]: any;
  constructor(controller, parentEl, app) {
    super(controller);
    this._app = app;
    this._pinned = CadencePlaybookRunnerView._loadPinned();
    this._root = parentEl.createDiv({ cls: 'cad-pb-runner' });
  }

  static _loadPinned() {
    try { return new Set(JSON.parse(localStorage.getItem(PLAYBOOK_RUNNER_PINNED_KEY) || '[]')); }
    catch { return new Set<any>(); }
  }
  static _savePinned(set) {
    localStorage.setItem(PLAYBOOK_RUNNER_PINNED_KEY, JSON.stringify([...set]));
  }

  onDataUpdated() {
    this._root.empty();
    let total = 0;
    for (const group of (this.data?.groupedData || [])) {
      for (const entry of group.entries) {
        total++;
        const path = entry.file.path;
        const name = entry.file.basename;
        const title = String(entry.getValue?.('note.title') ?? entry.getValue?.('file.name') ?? name);
        const trigger = String(entry.getValue?.('note.trigger') ?? '');

        const card = this._root.createDiv({ cls: 'cad-pb-card' });

        const pinBtn = card.createEl('button', { cls: 'cad-pb-pin' + (this._pinned.has(path) ? ' cad-pb-pin--active' : '') });
        pinBtn.setText(this._pinned.has(path) ? '★' : '☆');
        pinBtn.title = this._pinned.has(path) ? 'Unpin' : 'Pin';
        pinBtn.addEventListener('click', () => {
          this._pinned.has(path) ? this._pinned.delete(path) : this._pinned.add(path);
          CadencePlaybookRunnerView._savePinned(this._pinned);
          this.onDataUpdated();
        });

        const info = card.createDiv({ cls: 'cad-pb-card-info' });
        const titleEl = info.createSpan({ cls: 'cad-pb-card-title', text: title });
        if (trigger) { info.createSpan({ cls: 'cad-pb-card-trigger', text: trigger }); titleEl.title = trigger; }

        const runBtn = card.createEl('button', { cls: 'cad-btn primary cad-pb-run', text: '▶' });
        runBtn.title = 'Run playbook in AI chat session';
        runBtn.addEventListener('click', () => this._runPlaybook(title));
      }
    }
    if (total === 0) this._root.createDiv({ cls: 'cad-empty-state-title', text: 'No playbooks found' });
  }

  async _runPlaybook(title) {
    const ACW_CHAT = 'agent-client-chat-view';
    const cmd = `/playbook-runner ${title}`;
    const { workspace } = this._app;

    const send = async (view) => {
      view.setInputState({ text: cmd, files: [] });
      if (typeof view.sendMessage === 'function') await view.sendMessage();
    };

    // Reveal existing leaf
    const existing = workspace.getLeavesOfType(ACW_CHAT);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      await send(existing[0].view);
      return;
    }

    // Open a new split and wait for the view to mount
    const leaf = workspace.getLeaf('split', 'vertical');
    try {
      await leaf.setViewState({ type: ACW_CHAT, active: true });
      workspace.revealLeaf(leaf);
      setTimeout(() => {
        if (typeof leaf.view?.setInputState === 'function') send(leaf.view);
      }, 400);
    } catch {
      leaf.detach();
      await navigator.clipboard.writeText(cmd);
      new obsidian.Notice(`Agent chat unavailable. Copied to clipboard:\n${cmd}`, 5000);
    }
  }
}

/* ─────────── Workspace template picker ─────────── */
