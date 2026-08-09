import { setCurrentCurrency } from './settings';
import { setWorkspaceConfig } from './workspace-config';
import { generateMissingBases } from './bases-config';
import { BobCaptureModal } from './modals/capture';
import { BobImportModal } from './modals/import';
import { BobWorkspaceSetupModal } from './modals/workspace-setup';
import { invalidateEntityScanCache } from './entity-files';
import { VIEW_TYPE_BOB_APP } from './nav';
import { ensureDailyNote, parseSections, replaceSection } from './notes';
import { nextRepeat, reminderId, reminderTimeStr } from './reminders';
import { reloadEntityConfiguration, workspaceConfigTemplate } from './runtime-config';
import { bootstrapCanonicalSchemaSources, regenerateSchemaOutputs } from './schema-designer';
import { CURRENT_CURRENCY, DEFAULT_SETTINGS, syncEntityFolders } from './settings';
import { BobSettingTab } from './settings-tab';
import { sameDay, startOfDay, ymd } from './utils';
import { BobAppView } from './views/app-view';
import { BobPlaybookRunnerView, PLAYBOOK_RUNNER_VIEW_TYPE } from './views/playbook-runner';
import { exportAllEntitiesXLSX, promptImportWorkbook } from './workbook';
import { WORKSPACE_CONFIG, WORKSPACE_CONFIG_PATH, WORKSPACE_LOAD_FAILED, WORKSPACE_OWNED_SETTING_KEYS, applyWorkspaceOwnedSettings, initPluginPaths, loadWorkspaceConfig, persistedWorkspaceOwnedSettings, saveWorkspaceConfig, validateWorkspaceConfig } from './workspace-config';
import { loadWorkspaceTemplates, seedWorkspaceTemplates } from './workspace-templates';
import * as obsidian from 'obsidian';
import type { BobSettings, PartialSettings, Reminder } from './types';

/* ── Module-local types (type-only; erased by esbuild) ─────────── */

/**
 * Loose handle to the BobAppView leaf view. Typed locally (instead of
 * importing the view class) because only these few members are touched and
 * plugin.ts ↔ app-view.ts already share a runtime import edge.
 */
type AppViewLike = obsidian.View & {
  mode?: string;
  plannerAnchor?: Date;
  canvasFile?: obsidian.TFile | null;
  setMode?: (mode: string) => Promise<void>;
  render?: () => void;
  _generateContextCanvas?: (file: obsidian.TFile) => Promise<void>;
};

/**
 * Fields accepted when creating a reminder. Wider than the persisted shape:
 * the reminder edit modal also sends notes/project/notified.
 */
interface ReminderDraft {
  text: string;
  when?: string | null;
  repeat?: string;
  notes?: string;
  project?: string | null;
  notified?: boolean;
}

/** Persisted reminder. types.ts Reminder misses the `notes` field quick capture stores. */
interface StoredReminder extends Reminder {
  notes?: string;
}

export class BobPlugin extends obsidian.Plugin {
  settings: BobSettings;
  // Set by the Modules settings "Edit dashboard" action to deep-link the Surface
  // Designer to a specific surface; consumed (once) by renderDashboardEditor.
  pendingDesignerSurface: string | null = null;
  async onload() {
    initPluginPaths(this);
    await seedWorkspaceTemplates(this.app);
    await this.loadSettings();
    await reloadEntityConfiguration(this.app, this.settings);

    this.registerView(
      VIEW_TYPE_BOB_APP,
      (leaf) => new BobAppView(leaf, this)
    );

    // Drop the shared entity scan cache whenever vault content changes, so the
    // cache only ever lives within an unchanged window (one render pass).
    const dropScanCache = () => invalidateEntityScanCache();
    this.registerEvent(this.app.vault.on('create', dropScanCache));
    this.registerEvent(this.app.vault.on('delete', dropScanCache));
    this.registerEvent(this.app.vault.on('rename', dropScanCache));
    this.registerEvent(this.app.metadataCache.on('changed', dropScanCache));

    // Register playbook runner as a Bases custom view type (used in Playbooks.base Runner tabs)
    if (typeof this.registerBasesView === 'function') {
      this.registerBasesView(PLAYBOOK_RUNNER_VIEW_TYPE, {
        name: 'Playbook Runner',
        icon: 'play-circle',
        factory: (controller, parentEl) => new BobPlaybookRunnerView(controller, parentEl, this.app) as unknown as obsidian.BasesView,
      });
    }

    // Single ribbon icon → opens the BOB Workspace app
    this.addRibbonIcon('sparkles', 'Open BOB Workspace', () => this.openApp());

    this.addCommand({
      id: 'open-bob',
      name: 'Open BOB Workspace',
      callback: () => this.openApp(),
    });
    this.addCommand({
      id: 'open-bob-home',
      name: 'Open BOB Workspace — Home (command centre)',
      callback: () => this.openApp('home'),
    });
    this.addCommand({
      id: 'open-bob-today',
      name: 'Open BOB Workspace — Today',
      callback: () => this.openApp('planner.today'),
    });
    this.addCommand({
      id: 'open-bob-calendar',
      name: 'Open BOB Workspace — Calendar (week)',
      callback: () => this.openApp('planner.calendar'),
    });
    this.addCommand({
      id: 'open-bob-pipeline',
      name: 'Open BOB Workspace — Pipeline',
      callback: () => this.openApp('crm.pipeline'),
    });
    this.addCommand({
      // Surface Designer isn't in any workspace.json nav (applyWorkspaceRegistries
      // replaces the built-in nav), so give it a command entry point like Export/Import.
      id: 'open-surface-designer',
      name: 'Open BOB Workspace — Surface Designer',
      callback: () => this.openApp('misc.dashboard-editor'),
    });
    this.addCommand({
      // The canvas library isn't necessarily in a workspace.json nav, so give it
      // a command entry point too (always reachable, like Surface Designer).
      id: 'open-canvases',
      name: 'Open BOB Workspace — Canvases',
      callback: () => this.openApp('misc.canvases'),
    });
    this.addCommand({
      id: 'context-canvas',
      name: 'BOB: Context canvas for active note',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new obsidian.Notice('Open a note first — the context canvas is built around the active note.'); return; }
        const view = await this.openApp();
        if (view && typeof view._generateContextCanvas === 'function') await view._generateContextCanvas(file);
      },
    });
    this.addCommand({
      id: 'new-daily-entry',
      name: 'New today entry (creates if missing)',
      callback: async () => {
        const file = await ensureDailyNote(this.app, this.settings);
        this.app.workspace.openLinkText(file.path, '', false);
      },
    });

    this.addSettingTab(new BobSettingTab(this.app, this));

    // ─── Quick capture (with optional reminder) ───
    this.addRibbonIcon('plus-circle', 'BOB Workspace quick capture', () => this.openQuickCapture());
    this.addCommand({
      id: 'quick-capture',
      name: 'Quick capture (with optional reminder)',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'i' }],
      callback: () => this.openQuickCapture(),
    });
    this.addCommand({
      id: 'open-bob-inbox',
      name: 'Open BOB Workspace — Inbox',
      callback: () => this.openApp('planner.inbox'),
    });

    this.addCommand({
      id: 'bob-import-csv',
      name: 'Import from CSV',
      callback: () => {
        // Default to whichever entity list the user is on, fallback to contact
        let entityKey = 'contact';
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOB_APP)[0];
        if (leaf && leaf.view) {
          const m = String((leaf.view as AppViewLike).mode || '');
          if (m === 'crm.contacts')  entityKey = 'contact';
          else if (m === 'crm.companies') entityKey = 'company';
          else if (m === 'crm.activities') entityKey = 'activity';
          else if (m === 'crm.pipeline') entityKey = 'deal';
          else if (m === 'prm.partners') entityKey = 'partner';
          else if (m === 'prm.registrations') entityKey = 'registration';
          else if (m === 'prm.commissions') entityKey = 'commission';
          else if (m === 'crm.leads') entityKey = 'lead';
          else if (m === 'crm.campaigns') entityKey = 'campaign';
          else if (m === 'prm.certifications') entityKey = 'certification';
          else if (m === 'crm.sequences') entityKey = 'sequence';
          else if (m === 'planner.projects') entityKey = 'project';
        }
        new BobImportModal(this.app, { entityKey }).open();
      },
    });

    this.addCommand({
      id: 'bob-workspace-export-xlsx',
      name: 'Export all entities to XLSX',
      callback: async () => {
        try {
          const path = await exportAllEntitiesXLSX(this.app, this.settings);
          new obsidian.Notice(`BOB Workspace: exported workbook to ${path}`, 6000);
        } catch (e) {
          new obsidian.Notice(`BOB Workspace: XLSX export failed — ${e.message}`, 8000);
        }
      },
    });

    this.addCommand({
      id: 'bob-workspace-import-xlsx',
      name: 'Import entities from XLSX workbook',
      callback: async () => {
        await promptImportWorkbook(this.app, async () => this.refreshOpenViews());
      },
    });

    this.addCommand({
      id: 'create-workspace-config',
      name: 'Create workspace.json template',
      callback: async () => {
        if (await this.app.vault.adapter.exists(WORKSPACE_CONFIG_PATH)) {
          new obsidian.Notice(`workspace.json already exists at ${WORKSPACE_CONFIG_PATH}`);
          return;
        }
        await this.app.vault.adapter.write(WORKSPACE_CONFIG_PATH, workspaceConfigTemplate(this.settings));
        await reloadEntityConfiguration(this.app, this.settings);
        this.refreshOpenViews();
        new obsidian.Notice(`Created ${WORKSPACE_CONFIG_PATH} - edit it via Settings -> BOB Workspace -> Workspace definition.`);
      },
    });

    this.addCommand({
      id: 'apply-workspace-template',
      name: 'Apply workspace template…',
      callback: async () => {
        const templates = await loadWorkspaceTemplates(this.app);
        if (templates.length === 0) {
          new obsidian.Notice('BOB Workspace: no templates found in plugin templates/ folder.');
          return;
        }
        new BobWorkspaceSetupModal(this.app, this, templates).open();
      },
    });

    this.addCommand({
      id: 'reload-workspace-config',
      name: 'Reload workspace.json',
      callback: async () => {
        await this.reloadWorkspaceConfiguration();
        this.refreshOpenViews();
        new obsidian.Notice('BOB Workspace: workspace configuration reloaded.');
      },
    });

    this.addCommand({
      id: 'bootstrap-canonical-schemas',
      name: 'Bootstrap canonical schemas from workspace',
      callback: async () => {
        try {
          const result = await bootstrapCanonicalSchemaSources(this.app, this.settings);
          const regen = await regenerateSchemaOutputs(this.app, this.settings);
          await reloadEntityConfiguration(this.app, this.settings);
          this.refreshOpenViews();
          new obsidian.Notice(`BOB Workspace: bootstrapped ${result.count} schema source file${result.count === 1 ? '' : 's'}${result.skipped ? `; skipped ${result.skipped} existing source file${result.skipped === 1 ? '' : 's'}` : ''}. Generated ${regen.count} FileClass and JSON Schema output(s).`);
        } catch (e) {
          new obsidian.Notice(`BOB Workspace: schema bootstrap failed - ${e.message}`);
        }
      },
    });

    this.addCommand({
      id: 'generate-missing-bases',
      name: 'Generate missing bases',
      callback: async () => {
        try {
          const result = await generateMissingBases(this.app, this.settings);
          await reloadEntityConfiguration(this.app, this.settings);
          this.refreshOpenViews();
          new obsidian.Notice(`BOB Workspace: created ${result.count} base${result.count === 1 ? '' : 's'} in ${result.folder}${result.skipped ? `; skipped ${result.skipped} existing` : ''}${result.failed.length ? `; ${result.failed.length} failed` : ''}.`);
        } catch (e) {
          new obsidian.Notice(`BOB Workspace: generate bases failed — ${e.message}`);
        }
      },
    });

    // ─── Reminders engine ───
    // Tick once on load (catches anything that fired while Obsidian was closed),
    // then every 30s.
    this.app.workspace.onLayoutReady(() => this.tickReminders());
    this.registerInterval(window.setInterval(() => this.tickReminders(), 30 * 1000));

    // ─── First-run workspace template picker ───
    this.app.workspace.onLayoutReady(async () => {
      const hasWorkspace = await this.app.vault.adapter.exists(WORKSPACE_CONFIG_PATH);
      if (!hasWorkspace && !this.settings.setupDismissed) {
        const templates = await loadWorkspaceTemplates(this.app);
        if (templates.length > 0) {
          new BobWorkspaceSetupModal(this.app, this, templates).open();
        }
      }
    });

    // Optional: open BOB Workspace Home on Obsidian startup.
    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => this.openApp('home'));
    }
  }

  /* ── Quick capture API ── */
  openQuickCapture(prefill?: { text?: string; when?: string | null; repeat?: string }) {
    new BobCaptureModal(this.app, {
      defaultText: prefill && prefill.text ? prefill.text : '',
      defaultWhen: prefill && prefill.when ? prefill.when : null,
      defaultRepeat: prefill && prefill.repeat ? prefill.repeat : 'none',
      onSubmit: async (result) => {
        if (!result) return;
        await this.addReminder({
          text: result.text,
          when: result.when,
          repeat: result.repeat || 'none',
        });

        // Also append to the relevant daily note's tasks section.
        // - Scheduled today / unscheduled → today's note
        // - Scheduled future date → that day's note
        const targetDate = result.when ? new Date(result.when) : new Date();
        let noteDate = new Date();
        if (!isNaN(targetDate.getTime())) noteDate = targetDate;
        let dailyNoteAppended = false;
        try {
          const file = await ensureDailyNote(this.app, this.settings, noteDate) as obsidian.TFile;
          const content = await this.app.vault.read(file);
          const parsed = parseSections(content, this.settings);
          const newTasks = [...parsed.tasks, `- [ ] ${result.text}`];
          const next = replaceSection(content, this.settings.tasksHeading, newTasks.join('\n'));
          await this.app.vault.modify(file, next);
          dailyNoteAppended = true;
        } catch (_) { /* non-fatal — reminder is still saved */ }

        const noteLabel = sameDay(noteDate, new Date()) ? "today's note" : `${ymd(noteDate)} note`;
        if (result.when) {
          new obsidian.Notice(`Reminder set · ${reminderTimeStr(result.when)}${dailyNoteAppended ? ` · added to ${noteLabel}` : ''}`);
        } else {
          new obsidian.Notice(`Captured to Inbox${dailyNoteAppended ? ` · added to ${noteLabel}` : ''}`);
        }
      },
    }).open();
  }

  /* ── Reminders CRUD ── */
  async addReminder(partial: ReminderDraft) {
    const r: StoredReminder = {
      id: reminderId(),
      text: partial.text,
      when: partial.when || null,
      repeat: partial.repeat || 'none',
      notes: partial.notes || '',
      project: partial.project || null,  // file path of linked project, if any
      notified: false,
      done: false,
      createdAt: new Date().toISOString(),
    };
    if (!Array.isArray(this.settings.reminders)) this.settings.reminders = [];
    this.settings.reminders.push(r);
    await this.saveSettings();
    this.refreshOpenViews();
    return r;
  }

  async updateReminder(id: string, patch: Partial<StoredReminder>): Promise<Reminder | null> {
    const i = (this.settings.reminders || []).findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.settings.reminders[i] = Object.assign({}, this.settings.reminders[i], patch);
    await this.saveSettings();
    this.refreshOpenViews();
    return this.settings.reminders[i];
  }

  async deleteReminder(id: string) {
    this.settings.reminders = (this.settings.reminders || []).filter((r) => r.id !== id);
    await this.saveSettings();
    this.refreshOpenViews();
  }

  async snoozeReminder(id: string, ms: number) {
    const target = new Date(Date.now() + ms);
    return this.updateReminder(id, {
      when: target.toISOString(),
      notified: false,
    });
  }

  async completeReminder(id: string) {
    return this.updateReminder(id, { done: true, notified: true });
  }

  refreshOpenViews() {
    // Settings/config changes (ignored folders, schema reloads) can change the
    // scannable set without a vault event, so drop the cache before re-render.
    invalidateEntityScanCache();
    this.app.workspace.getLeavesOfType(VIEW_TYPE_BOB_APP).forEach((leaf) => {
      const view = leaf.view as AppViewLike;
      // Don't tear down a hosted interactive canvas on incidental refreshes
      // (reminder tick, schema reload). Navigation re-renders it explicitly.
      if (view && view.canvasFile) return;
      if (view && typeof view.render === 'function') view.render();
    });
  }

  /* ── Reminder ticker ── */
  tickReminders() {
    if (!Array.isArray(this.settings.reminders)) return;
    const now = Date.now();
    let dirty = false;
    const additions: Reminder[] = [];
    for (const r of this.settings.reminders) {
      if (r.done || r.notified) continue;
      if (!r.when) continue;
      const w = new Date(r.when).getTime();
      if (isNaN(w) || w > now) continue;
      this._fireReminder(r);
      r.notified = true;
      dirty = true;
      const next = nextRepeat(new Date(r.when), r.repeat);
      if (next) {
        additions.push({
          id: reminderId(),
          text: r.text,
          when: next.toISOString(),
          repeat: r.repeat,
          notified: false,
          done: false,
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (additions.length) this.settings.reminders.push(...additions);
    if (dirty) {
      this.saveSettings().then(() => this.refreshOpenViews());
    }
  }

  _fireReminder(r: Reminder) {
    new obsidian.Notice(`⏰  ${r.text}`, 8000);
    if (this.settings.desktopNotifications && typeof Notification !== 'undefined') {
      try {
        if (Notification.permission === 'granted') {
          new Notification('BOB Workspace reminder', { body: r.text });
        }
      } catch (_) {}
    }
  }

  async openApp(mode: string | null = null) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOB_APP)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_BOB_APP, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view: AppViewLike = leaf.view;
    if (view && typeof view.setMode === 'function') {
      const target = mode || view.mode || 'home';
      // Reset week-view anchor to current week when (re)opening that surface
      if (target === 'planner.calendar') view.plannerAnchor = startOfDay(new Date());
      await view.setMode(target);
    }
    return view;
  }

  onunload() {
    // Obsidian manages view leaf lifecycle on unload; detaching here is a
    // documented anti-pattern that disrupts the user's saved layout.
  }

  async loadSettings() {
    const data: PartialSettings | null = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.baseFiles = Object.assign({}, DEFAULT_SETTINGS.baseFiles || {}, data?.baseFiles || {});
    this.settings.baseViews = Object.assign({}, DEFAULT_SETTINGS.baseViews || {}, data?.baseViews || {});
    this.settings.modules = Object.assign({}, DEFAULT_SETTINGS.modules || {}, data?.modules || {});
    this.settings.collapsedGroups = Object.assign({}, DEFAULT_SETTINGS.collapsedGroups || {}, data?.collapsedGroups || {});
    await loadWorkspaceConfig(this.app);
    this.settings = applyWorkspaceOwnedSettings(this.settings) as BobSettings;
    // Prune completed reminders older than 30 days: every fired repeat leaves
    // a row behind, and the whole array is serialized into data.json AND
    // workspace.json on every save — unbounded growth made each save slower.
    // Only `done` entries are pruned; unfinished (even long-overdue) reminders
    // are user-visible items and stay.
    if (Array.isArray(this.settings.reminders)) {
      const cutoff = Date.now() - 30 * 86400000;
      this.settings.reminders = this.settings.reminders.filter((r) => {
        if (!r?.done) return true;
        const stamp = new Date(r.when || r.createdAt || 0).getTime();
        return isNaN(stamp) || stamp >= cutoff;
      });
    }
    setCurrentCurrency(this.settings.currency);
    syncEntityFolders(this.settings);
  }
  async saveSettings() {
    const workspaceSettings = persistedWorkspaceOwnedSettings(this.settings);
    const dataToSave = Object.assign({}, this.settings);
    WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
      delete dataToSave[key];
    });
    await this.saveData(dataToSave);
    const workspaceConfig = validateWorkspaceConfig(Object.assign({}, WORKSPACE_CONFIG, { settings: workspaceSettings }));
    setWorkspaceConfig(workspaceConfig);
    // Never overwrite a workspace.json that failed to load — an incidental save
    // (toggle, reminder tick) would replace the user's recoverable config with
    // an empty `{ settings }` shell and clobber the backup. The settings editor's
    // explicit "Save and apply" goes through saveWorkspaceConfig directly, which
    // clears the guard once the file is valid again.
    if (!WORKSPACE_LOAD_FAILED && (await this.app.vault.adapter.exists(WORKSPACE_CONFIG_PATH) || Object.keys(workspaceSettings).length)) {
      // Incidental settings-only write (reminder tick, selector, toggle): don't
      // snapshot the backup — keep it pinned to the last deliberate structural edit.
      await saveWorkspaceConfig(this.app, JSON.stringify(workspaceConfig, null, 2), false);
    }
    setCurrentCurrency(this.settings.currency);
    syncEntityFolders(this.settings);
  }

  // Refresh WORKSPACE_CONFIG from disk, then re-overlay workspace-owned settings
  // onto plugin.settings BEFORE rebuilding registries — so a manual workspace.json
  // edit or a Settings "Save and apply" is reflected in this.settings and not
  // reverted by the next saveSettings(). Mirrors the tail of loadSettings().
  async reloadWorkspaceConfiguration() {
    await loadWorkspaceConfig(this.app);
    this.settings = applyWorkspaceOwnedSettings(this.settings) as BobSettings;
    setCurrentCurrency(this.settings.currency);
    await reloadEntityConfiguration(this.app, this.settings);
  }
}


