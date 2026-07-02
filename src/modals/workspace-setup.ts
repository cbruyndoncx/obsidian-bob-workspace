import { applyWorkspaceTemplate } from '../workspace-templates';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import type { CadencePlugin } from '../plugin';
import type { WorkspaceConfig } from '../types';

/** Bundled starter template: a WorkspaceConfig carrying `_template` metadata. */
interface WorkspaceTemplateMeta {
  id?: string;
  label?: string;
  description?: string;
}
type WorkspaceTemplate = WorkspaceConfig & { _template?: WorkspaceTemplateMeta };

export class CadenceWorkspaceSetupModal extends obsidian.Modal {
  declare plugin: CadencePlugin;
  declare templates: WorkspaceTemplate[];
  declare selected: WorkspaceTemplate | null;
  constructor(app: App, plugin: CadencePlugin, templates: WorkspaceTemplate[]) {
    super(app);
    this.plugin = plugin;
    this.templates = templates;
    this.selected = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-setup-modal');
    contentEl.createEl('h2', { text: 'Welcome to BOB Workspace' });
    contentEl.createEl('p', { cls: 'cad-setup-subtitle', text: 'Choose a starter workspace to get going. You can customise it at any time from Settings → BOB Workspace → Workspace.' });

    const grid = contentEl.createDiv({ cls: 'cad-template-grid' });
    for (const tpl of this.templates) {
      const meta = tpl._template;
      const card = grid.createDiv({ cls: 'cad-template-card' });
      card.createEl('strong', { text: meta.label });
      card.createEl('p', { text: meta.description });
      card.addEventListener('click', () => {
        grid.querySelectorAll('.cad-template-card').forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        this.selected = tpl;
        applyBtn.disabled = false;
      });
    }

    const footer = contentEl.createDiv({ cls: 'cad-setup-footer' });
    const applyBtn = footer.createEl('button', { text: 'Apply template', cls: 'mod-cta' });
    applyBtn.disabled = true;
    applyBtn.addEventListener('click', async () => {
      if (!this.selected) return;
      applyBtn.disabled = true;
      try {
        const meta = await applyWorkspaceTemplate(this.app, this.plugin, this.selected);
        this.close();
        new obsidian.Notice(`BOB Workspace: "${meta.label}" template applied.`);
      } catch (e) {
        applyBtn.disabled = false;
        new obsidian.Notice(`BOB Workspace: could not apply template - ${e?.message || e}`);
      }
    });

    const skipBtn = footer.createEl('button', { text: 'Skip for now', cls: 'cad-setup-skip' });
    skipBtn.addEventListener('click', async () => {
      this.plugin.settings.setupDismissed = true;
      await this.plugin.saveSettings();
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ─────────── The plugin ─────────── */
