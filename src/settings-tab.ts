import { setWorkspaceConfig } from './workspace-config';
import { entityBasePath, entityBaseViewName, generateMissingBases } from './bases-config';
import { baseSummaryCompatibleWithEntity, readBaseSummary } from './bases-parse';
import { summarizeDashboardBlueprint } from './dashboards';
import { ENTITIES } from './entities';
import { CadenceIconPickerModal, CadencePromptModal, confirmModal } from './modals/common';
import { NAV_GROUPS, SURFACE_BY_ID, VIEW_TYPE_CADENCE_APP, migrateWorkspacePlannerConfig } from './nav';
import { isTabBackedSurface, makeNavigationSurfacePrimary, navigationSurfaceFromTab, normalizeStandaloneNavigationSurfaces, removeSurfaceFromGroups, surfaceMatchesTab } from './nav-helpers';
import { reloadEntityConfiguration, workspaceConfigTemplate } from './runtime-config';
import { applyEditableSchemaFieldDefault, applyEditableSchemaFieldType, bootstrapCanonicalSchemaSources, bootstrapCanonicalSchemaSourcesIfMissing, editableSchemaFieldDefault, editableSchemaFieldType, loadCanonicalSchemaSources, regenerateSchemaOutputs, validateSourceSchemaDefinition, type SourceSchema, type SourceSchemaField } from './schema-designer';
import { SCHEMA_FOLDER_DEFAULT, SCHEMA_TO_ENTITY_KEY, pluralizeEntityLabel } from './schemas';
import { DEFAULT_SETTINGS, syncEntityFolders } from './settings';
import { CURRENCY_OPTIONS, ensureFolderSync } from './utils';
import { CadenceAppView } from './views/app-view';
import { exportEntitiesXLSX, promptImportWorkbook, selectedWorkbookEntityKeys, workbookExportFolder, workbookExportGroups } from './workbook';
import { PLUGIN_DIR, WORKSPACE_BACKUP_PATH, WORKSPACE_CONFIG, WORKSPACE_CONFIG_PATH, configuredBaseDefinition, effectiveSchemaSettings, saveWorkspaceConfig, validateWorkspaceConfig, workspaceConfiguredEntityEntries } from './workspace-config';
import { applyWorkspaceTemplate, loadWorkspaceTemplates, workspaceTemplateKey } from './workspace-templates';
import * as obsidian from 'obsidian';
import type { CadencePlugin } from './plugin';
import type {
  JsonValue,
  NavGroup,
  NavSurface,
  PartialSettings,
  BobSettings,
  SchemaField,
  SchemaSource,
  SecondaryTab,
  WorkbookExportGroup,
  WorkspaceBaseRef,
  WorkspaceConfig,
} from './types';

/* ── Module-local types (type-only; erased by esbuild) ─────────── */

/** Drag-and-drop payload exchanged between the navigation designer zones. */
type NavDragPayload =
  | { type: 'group'; groupIndex: number }
  | { type: 'item'; groupIndex: number; itemIndex: number }
  | { type: 'tab'; parentId: string; tabIndex: number }
  | { type: 'entity'; entityKey: string };

/** Nav surface as the designer mutates it (`placement` is designer-authored). */
interface DraftNavSurface extends NavSurface {
  placement?: string;
}

/** Nav group inside the workspace.json draft (adds module/icon over NavGroup). */
interface DraftNavGroup {
  id: string;
  label: string;
  icon?: string;
  module?: string;
  items: DraftNavSurface[];
}

/** Secondary tab as authored in workspace.json (adds icon/children). */
interface DraftSecondaryTab extends SecondaryTab {
  icon?: string;
  children?: DraftSecondaryTab[];
}

/** Base mapping entry; legacy drafts may carry base/baseView keys. */
interface DraftBaseRef extends WorkspaceBaseRef {
  base?: string;
  baseView?: string;
}

/**
 * Unvalidated workspace.json widget/card JSON as scanned by the Review tab —
 * user-authored JSON with ad-hoc keys, read for display only. This is a
 * genuinely dynamic boundary (same posture as Frontmatter in types.ts).
 */
type ReviewCard = Record<string, any>;

/**
 * Dashboard/planner surface config shape walked by the widget review.
 * `layout` cells are card-or-card-array JSON; kept `any[][]` (and the index
 * signature `any`) so this stays assignable to the shared DashboardConfig —
 * which keeps WorkspaceDraft assignable to WorkspaceConfig with no casts.
 */
interface ReviewSurfaceConfig {
  stats?: ReviewCard[];
  controls?: ReviewCard[];
  layout?: any[][];
  conditionalRows?: { cards?: ReviewCard[]; condition?: ReviewCard | string }[];
  [key: string]: any;
}

/** One row of a Review-tab table; cells are formatted via reviewText(). */
type ReviewRow = unknown[];

/**
 * The workspace.json draft held in the Settings textarea. Mirrors the shared
 * WorkspaceConfig but with the designer-mutable shapes above (types.ts models
 * the validated shape, not the legacy keys the designers still read/write).
 */
interface WorkspaceDraft {
  schemas?: { enabled?: boolean; folder?: string };
  bases?: Record<string, DraftBaseRef>;
  navigation?: {
    groups?: DraftNavGroup[];
    secondaryTabs?: Record<string, DraftSecondaryTab[]>;
    actions?: Record<string, JsonValue>;
  };
  workbookGroups?: WorkbookExportGroup[];
  dashboards?: Record<string, ReviewSurfaceConfig>;
  planner?: Record<string, ReviewSurfaceConfig>;
  settings?: PartialSettings;
  [key: string]: unknown;
}

/** `_template` metadata block carried by workspace template JSON files. */
interface TemplateMeta {
  id?: string;
  name?: string;
  label?: string;
  description?: string;
  [key: string]: JsonValue | undefined;
}

/** A workspace template as returned by loadWorkspaceTemplates(). */
interface WorkspaceTemplate extends WorkspaceConfig {
  _template?: TemplateMeta;
  _templatePath?: string;
}

/** NAV_GROUPS registry entry (runtime nav groups carry module/icon too). */
interface NavGroupConfig extends NavGroup {
  module?: string;
  icon?: string;
}

/** Canonical schema field with the designer-edited extras. */
type DesignerSchemaField = SourceSchemaField;

/** Canonical schema source with the designer-edited optional blocks. */
type DesignerSchemaSource = SourceSchema;

/** Cadence app leaf view re-rendered after settings changes. */
type RenderableViewLike = obsidian.View & { render?: () => void };

/**
 * Detached CadenceAppView (built from its prototype, never attached to a
 * leaf) that hosts the dashboard editor / widget catalog inside Settings.
 */
interface SettingsDashboardRenderer {
  app: obsidian.App;
  plugin: CadencePlugin;
  settings: BobSettings;
  mode: string;
  detailFile: obsidian.TFile | null;
  detailEntityKey: string | null;
  _dashboardState: Record<string, unknown>;
  _clientWorkClientId: string;
  _clientWorkProjectId: string;
  render: () => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  openEntityDetailFromFile: (file: obsidian.TFile) => void;
  renderDashboardEditor: (root: HTMLElement) => Promise<void>;
  _renderWidgetCatalog: (root: HTMLElement) => void;
  _renderDashboardInventory: (root: HTMLElement) => void;
}

export class CadenceSettingTab extends obsidian.PluginSettingTab {
  declare plugin: CadencePlugin;
  declare _reviewActiveTab: string;
  declare _reviewRenderSeq: number;
  declare _activeSettingsTab: string;
  declare _collapsedModules: Set<string>;
  declare _dashboardRenderer: SettingsDashboardRenderer;
  declare _schemaDesignerSelectedPath: string;
  constructor(app: obsidian.App, plugin: CadencePlugin) { super(app, plugin); this.plugin = plugin; this._reviewActiveTab = 'overview'; this._reviewRenderSeq = 0; }

  _dashboardSettingsRenderer() {
    if (!this._dashboardRenderer) {
      const renderer = Object.create(CadenceAppView.prototype);
      renderer.mode = 'settings.dashboard-editor';
      renderer.detailFile = null;
      renderer.detailEntityKey = null;
      renderer._dashboardState = {};
      renderer._clientWorkClientId = '';
      renderer._clientWorkProjectId = '';
      renderer.render = async () => {};
      renderer.setMode = async (mode: string) => this.plugin.openApp(mode);
      renderer.openEntityDetailFromFile = (file: obsidian.TFile) => {
        if (!file?.path) return;
        this.plugin.app.workspace.openLinkText(file.path, '', false);
      };
      this._dashboardRenderer = renderer;
    }
    this._dashboardRenderer.app = this.plugin.app;
    this._dashboardRenderer.plugin = this.plugin;
    this._dashboardRenderer.settings = this.plugin.settings;
    return this._dashboardRenderer;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'BOB Workspace' });

    const fork = containerEl.createEl('p', { cls: 'setting-item-description' });
    fork.appendText('BOB Workspace is a fork of the ');
    fork.createEl('a', {
      text: 'Upstream Cadence Planner',
      href: 'https://github.com/iotool/obsidian-cadence-planner',
    }).setAttribute('target', '_blank');
    fork.appendText(' Obsidian plugin, extended with canonical schema editing, .base files, vault-aware entity mapping, and configurable folders. ');
    fork.createEl('strong', { text: 'Folder structure alignment with upstream Cadence is available, but should be verified in any mixed-vault setup' });
    fork.appendText(' — if you switch between forks, back up your vault first.');

    /* ─── Settings tab bar ─── */
    const TAB_IDS = ['workspace', 'review', 'navigation', 'dashboards', 'widgets', 'modules', 'data-model', 'planner', 'app', 'exports', 'data'];
    const TAB_LABELS = ['Workspace', 'Review', 'Navigation', 'Dashboards', 'Widgets', 'Modules', 'Data model', 'Planner', 'App', 'Exports', 'Data'];
    if (!this._activeSettingsTab) this._activeSettingsTab = 'workspace';
    if (!this._collapsedModules) this._collapsedModules = new Set<string>();
    const tabBar = containerEl.createDiv({ cls: 'cad-settings-tabs' });
    const tabPanels: Record<string, HTMLDivElement> = {};
    const tabBtns: Record<string, HTMLButtonElement> = {};
    TAB_IDS.forEach((id, i) => {
      const btn = tabBar.createEl('button', { cls: 'cad-settings-tab', text: TAB_LABELS[i] });
      if (id === this._activeSettingsTab) btn.addClass('is-active');
      btn.addEventListener('click', () => {
        TAB_IDS.forEach((tid) => {
          tabPanels[tid].style.display = tid === id ? '' : 'none';
          tabBtns[tid].toggleClass('is-active', tid === id);
        });
        this._activeSettingsTab = id;
      });
      tabBtns[id] = btn;
      const panel = containerEl.createDiv({ cls: 'cad-settings-tab-panel' });
      if (id !== this._activeSettingsTab) panel.style.display = 'none';
      tabPanels[id] = panel;
    });
    const pWs = tabPanels['workspace'];
    const pReview = tabPanels['review'];
    const pNav = tabPanels['navigation'];
    const pDash = tabPanels['dashboards'];
    const pWidgets = tabPanels['widgets'];
    const pMod = tabPanels['modules'];
    const pDm = tabPanels['data-model'];
    const pPlanner = tabPanels['planner'];
    const pApp = tabPanels['app'];
    const pExp = tabPanels['exports'];
    const pData = tabPanels['data'];

    /* ─── Workspace configuration (workspace.json) ─── */
    pWs.createEl('h3', { text: 'Workspace definition' });
    const workspaceDesc = pWs.createEl('p', { cls: 'setting-item-description' });
    workspaceDesc.appendText('Define schema loading, Base/view associations and templates in ');
    workspaceDesc.createEl('code', { text: 'workspace.json' });
    workspaceDesc.appendText(' next to plugin data. Use the other tabs for navigation, dashboards, widget catalog and export-group editing.');

    const workspaceWrap = pWs.createDiv({ cls: 'cad-settings-entities' });
    const workspaceStatus = workspaceWrap.createDiv({ cls: 'cad-settings-entities-status' });
    const workspaceTa = workspaceWrap.createEl('textarea', { cls: 'cad-settings-entities-textarea' });
    workspaceTa.rows = 18;
    workspaceTa.spellcheck = false;
    workspaceTa.style.width = '100%';
    workspaceTa.style.fontFamily = 'var(--font-monospace)';
    workspaceTa.style.fontSize = '12px';
    const adapter = this.plugin.app.vault.adapter;
    let renderWorkspaceDesigners: () => void;
    (async () => {
      try {
        if (await adapter.exists(WORKSPACE_CONFIG_PATH)) {
          workspaceTa.value = await adapter.read(WORKSPACE_CONFIG_PATH);
          workspaceStatus.setText(`Loaded ${WORKSPACE_CONFIG_PATH}`);
        } else {
          workspaceTa.value = workspaceConfigTemplate(this.plugin.settings);
          workspaceStatus.setText('No workspace.json yet - edit and Save to make navigation/config file-managed.');
        }
        renderWorkspaceDesigners();
      } catch (e) {
        workspaceStatus.setText(`Read error: ${e.message}`);
      }
    })();
    const setWorkspaceStatus = (message: string, ok: boolean) => {
      workspaceStatus.setText(message);
      workspaceStatus.style.color = ok ? 'var(--text-success)' : 'var(--text-error)';
    };
    workspaceTa.addEventListener('input', () => {
      try {
        const parsed = validateWorkspaceConfig(JSON.parse(workspaceTa.value));
        const count = parsed.navigation?.groups?.length || 0;
        setWorkspaceStatus(`Valid - ${count} navigation group${count === 1 ? '' : 's'}`, true);
        void renderWorkspaceReview();
      } catch (e) {
        setWorkspaceStatus(`Invalid JSON/config: ${e.message}`, false);
      }
    });
    const workspaceBtns = workspaceWrap.createDiv({ cls: 'cad-settings-entities-btns' });
    workspaceBtns.style.display = 'flex';
    workspaceBtns.style.gap = '8px';
    workspaceBtns.style.marginTop = '8px';
    const workspaceFormatBtn = workspaceBtns.createEl('button', { text: 'Format' });
    workspaceFormatBtn.addEventListener('click', () => {
      try {
        workspaceTa.value = JSON.stringify(validateWorkspaceConfig(JSON.parse(workspaceTa.value)), null, 2);
        setWorkspaceStatus('Formatted', true);
        renderWorkspaceDesigners();
      } catch (e) {
        setWorkspaceStatus(`Cannot format: ${e.message}`, false);
      }
    });
    const workspaceSaveBtn = workspaceBtns.createEl('button', { text: 'Save and apply', cls: 'mod-cta' });
    workspaceSaveBtn.addEventListener('click', async () => {
      try {
        const parsed = validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(workspaceTa.value)));
        await saveWorkspaceConfig(this.plugin.app, workspaceTa.value);
        if (parsed.schemas?.enabled) {
          const bootstrap = await bootstrapCanonicalSchemaSourcesIfMissing(this.plugin.app, this.plugin.settings);
          if (bootstrap.count) {
            await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
          }
        }
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice('BOB Workspace: workspace.json saved and applied.');
        this.display();
      } catch (e) {
        setWorkspaceStatus(`Save failed: ${e.message}`, false);
        new obsidian.Notice(`BOB Workspace: workspace.json save failed - ${e.message}`);
      }
    });
    const workspaceRestoreBtn = workspaceBtns.createEl('button', { text: 'Restore backup' });
    workspaceRestoreBtn.addEventListener('click', async () => {
      try {
        if (!(await adapter.exists(WORKSPACE_BACKUP_PATH))) {
          setWorkspaceStatus('No workspace backup file found', false);
          return;
        }
        workspaceTa.value = await adapter.read(WORKSPACE_BACKUP_PATH);
        setWorkspaceStatus('Backup loaded into editor - click Save and apply', true);
        renderWorkspaceDesigners();
      } catch (e) {
        setWorkspaceStatus(`Restore failed: ${e.message}`, false);
      }
    });
    const workspaceMigrateBtn = workspaceBtns.createEl('button', { text: 'Import Bases from settings' });
    workspaceMigrateBtn.addEventListener('click', () => {
      try {
        const config = validateWorkspaceConfig(JSON.parse(workspaceTa.value));
        config.bases = config.bases || {};
        Object.entries(this.plugin.settings.baseFiles || {}).forEach(([entityKey, file]) => {
          if (!file) return;
          config.bases[entityKey] = { file };
          if ((this.plugin.settings.baseViews || {})[entityKey]) {
            config.bases[entityKey].view = this.plugin.settings.baseViews[entityKey];
          }
        });
        workspaceTa.value = JSON.stringify(config, null, 2);
        setWorkspaceStatus('Base associations imported into workspace draft - click Save and apply', true);
        renderWorkspaceDesigners();
      } catch (e) {
        setWorkspaceStatus(`Import failed: ${e.message}`, false);
      }
    });

    pWs.createEl('h3', { text: 'Workspace templates' });
    const templateDesc = pWs.createEl('p', { cls: 'setting-item-description' });
    templateDesc.appendText('Select a workspace template from ');
    templateDesc.createEl('code', { text: `${PLUGIN_DIR}/templates` });
    templateDesc.appendText('. Applying a template writes the active ');
    templateDesc.createEl('code', { text: 'workspace.json' });
    templateDesc.appendText(' and stores the selected template in plugin data.');
    const templateWrap = pWs.createDiv({ cls: 'setting-group cad-settings-section' });
    const templatePanel = templateWrap.createDiv({ cls: 'setting-items' });
    const templateStatus = templatePanel.createDiv({ cls: 'setting-item-description' });
    const templateRow = templatePanel.createDiv({ cls: 'cad-workspace-template-row' });
    const templateSelect = templateRow.createEl('select', { cls: 'dropdown' });
    const templateReloadBtn = templateRow.createEl('button', { text: 'Reload' });
    const templateApplyBtn = templateRow.createEl('button', { text: 'Apply selected', cls: 'mod-cta' });
    const templateMeta = templatePanel.createDiv({ cls: 'setting-item-description' });
    let workspaceTemplates: WorkspaceTemplate[] = [];
    const renderTemplateMeta = () => {
      const selected = workspaceTemplates.find((tpl) => workspaceTemplateKey(tpl) === templateSelect.value);
      const meta = selected?._template;
      if (!meta) {
        templateMeta.setText('');
        templateApplyBtn.disabled = true;
        return;
      }
      templateApplyBtn.disabled = false;
      const pathText = selected._templatePath ? ` · ${selected._templatePath}` : '';
      templateMeta.setText(`${meta.label || workspaceTemplateKey(selected)}${meta.description ? ` - ${meta.description}` : ''}${pathText}`);
    };
    const refreshWorkspaceTemplateSelector = async () => {
      workspaceTemplates = await loadWorkspaceTemplates(this.plugin.app);
      templateSelect.empty();
      if (!workspaceTemplates.length) {
        templateSelect.createEl('option', { value: '', text: 'No templates found' });
        templateStatus.setText(`No template JSON files found in ${PLUGIN_DIR}/templates.`);
        templateApplyBtn.disabled = true;
        renderTemplateMeta();
        return;
      }
      workspaceTemplates.forEach((tpl) => {
        const key = workspaceTemplateKey(tpl);
        const meta = tpl._template || {};
        const option = templateSelect.createEl('option', { value: key, text: meta.label || key });
        if (key === this.plugin.settings.activeWorkspaceTemplate) option.selected = true;
      });
      if (!templateSelect.value && workspaceTemplates[0]) templateSelect.value = workspaceTemplateKey(workspaceTemplates[0]);
      const active = this.plugin.settings.activeWorkspaceTemplate || 'none';
      templateStatus.setText(`Loaded ${workspaceTemplates.length} template${workspaceTemplates.length === 1 ? '' : 's'} · active: ${active}`);
      renderTemplateMeta();
    };
    templateSelect.addEventListener('change', renderTemplateMeta);
    templateReloadBtn.addEventListener('click', () => refreshWorkspaceTemplateSelector());
    templateApplyBtn.addEventListener('click', async () => {
      const selected = workspaceTemplates.find((tpl) => workspaceTemplateKey(tpl) === templateSelect.value);
      if (!selected) return;
      try {
        const meta = await applyWorkspaceTemplate(this.plugin.app, this.plugin, selected);
        if (await adapter.exists(WORKSPACE_CONFIG_PATH)) {
          workspaceTa.value = await adapter.read(WORKSPACE_CONFIG_PATH);
        }
        setWorkspaceStatus(`Applied template: ${meta.label}`, true);
        templateStatus.setText(`Loaded ${workspaceTemplates.length} template${workspaceTemplates.length === 1 ? '' : 's'} · active: ${workspaceTemplateKey(selected)}`);
        renderWorkspaceDesigners();
        void renderWorkspaceReview();
        new obsidian.Notice(`BOB Workspace: "${meta.label}" template applied.`);
      } catch (e) {
        templateStatus.setText(`Template apply failed: ${e.message}`);
        new obsidian.Notice(`BOB Workspace: template apply failed - ${e.message}`);
      }
    });
    setTimeout(() => refreshWorkspaceTemplateSelector(), 0);

    const navDesigner = pNav.createDiv({ cls: 'cad-nav-designer' });
    const navDesignerHead = navDesigner.createDiv({ cls: 'cad-nav-designer-head' });
    navDesignerHead.createEl('h4', { text: 'Navigation designer' });
    navDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Drag unassigned tabs or record types into groups and move existing menu items between groups. Choose icons from Obsidian\'s registered icon library. Remove an item to return it to its available pool. Changes update the workspace JSON draft; use Save and apply above to persist them.',
    });
    const navDesignerBody = navDesigner.createDiv({ cls: 'cad-nav-designer-body' });
    pExp.createEl('h3', { text: 'Exports' });
    const workbookDesigner = pExp.createDiv({ cls: 'cad-workbook-designer' });
    const workbookDesignerHead = workbookDesigner.createDiv({ cls: 'cad-nav-designer-head' });
    workbookDesignerHead.createEl('h4', { text: 'Workbook export groups' });
    workbookDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Define reusable XLSX export bundles in workspace.json. Assign a record type to more than one bundle when separate exports need overlapping data.',
    });
    const workbookDesignerBody = workbookDesigner.createDiv({ cls: 'cad-workbook-designer-body' });

    const readWorkspaceDraft = () => validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(workspaceTa.value))) as WorkspaceDraft;
    const reviewText = (value: unknown, fallback = '—') => {
      if (value == null || value === '') return fallback;
      if (Array.isArray(value)) return value.length ? value.join(', ') : fallback;
      if (value && typeof value === 'object') {
        const text = JSON.stringify(value);
        return text.length > 120 ? `${text.slice(0, 117)}…` : text;
      }
      return String(value);
    };
    const renderReviewTable = (parent: HTMLElement, title: string, headers: string[], rows: ReviewRow[], emptyText = 'Nothing to review yet') => {
      const section = parent.createDiv({ cls: 'cad-review-section' });
      section.createDiv({ cls: 'cad-section-label-lg', text: title });
      if (!rows.length) {
        section.createDiv({ cls: 'cad-empty', text: emptyText });
        return section;
      }
      const wrap = section.createDiv({ cls: 'cad-review-table-wrap' });
      const table = wrap.createEl('table', { cls: 'cad-review-table' });
      const thead = table.createEl('thead');
      const headRow = thead.createEl('tr');
      headers.forEach((header) => headRow.createEl('th', { text: header }));
      const tbody = table.createEl('tbody');
      rows.forEach((row) => {
        const tr = tbody.createEl('tr');
        row.forEach((cell) => tr.createEl('td', { text: reviewText(cell) }));
      });
      return section;
    };
    const widgetSourceSummary = (source: ReviewCard | string | null | undefined) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return reviewText(source, '');
      const bits: string[] = [];
      if (source.mode) bits.push(`mode:${source.mode}`);
      if (source.builtIn) bits.push(`built-in:${source.builtIn}`);
      if (source.section) bits.push(`section:${source.section}`);
      if (source.entity || source.entityKey) bits.push(`entity:${source.entity || source.entityKey}`);
      if (source.base) {
        const base = source.base;
        const file = base.file || base.base || base.path || base.basePath || base;
        bits.push(`base:${reviewText(file, '')}`);
      }
      if (source.view) bits.push(`view:${source.view}`);
      if (source.groupBy) bits.push(`groupBy:${source.groupBy}`);
      if (source.field) bits.push(`field:${source.field}`);
      if (source.limit != null) bits.push(`limit:${source.limit}`);
      return bits.join(' · ');
    };
    const collectWidgetRows = (surfaceId: string, surfaceConfig: ReviewSurfaceConfig = {}) => {
      const rows: ReviewRow[] = [];
      const pushCard = (section: string, card: ReviewCard, idx: number, extra = '') => {
        if (!card || typeof card !== 'object') return;
        rows.push([
          card.title || card.label || '(untitled)',
          surfaceId,
          section,
          idx,
          card.kind || 'list',
          widgetSourceSummary(card.source),
          card.entity || card.source?.entity || card.source?.entityKey || '',
          card.metric || card.count?.metric || '',
          card.field || card.valueField || card.groupBy || '',
          card.limit != null ? String(card.limit) : '',
          extra,
        ]);
      };
      (surfaceConfig.stats || []).forEach((stat, idx) => pushCard('stats', stat, idx + 1));
      (surfaceConfig.controls || []).forEach((control, idx) => pushCard('controls', control, idx + 1));
      (surfaceConfig.layout || []).forEach((row, rowIdx) => {
        (row || []).forEach((colDef, colIdx) => {
          (Array.isArray(colDef) ? colDef : [colDef]).forEach((card, cardIdx) => {
            pushCard(`layout ${rowIdx + 1}.${colIdx + 1}`, card, cardIdx + 1);
          });
        });
      });
      (surfaceConfig.conditionalRows || []).forEach((row, rowIdx) => {
        (row.cards || []).forEach((card, cardIdx) => {
          pushCard(`conditional ${rowIdx + 1}`, card, cardIdx + 1, widgetSourceSummary(row.condition));
        });
      });
      return rows;
    };
    const loadReviewSchemaSources = async (folder: string) => {
      const adapter = this.plugin.app.vault.adapter;
      const result: { folder: string; schemas: { path: string; schema: DesignerSchemaSource }[]; errors: string[] } = { folder, schemas: [], errors: [] };
      if (!folder || !await adapter.exists(folder)) return result;
      const listed = await adapter.list(folder);
      for (const filePath of (listed.files || []).filter((file) => /\.ya?ml$/i.test(file))) {
        try {
          const schema = validateSourceSchemaDefinition(obsidian.parseYaml(await adapter.read(filePath)));
          result.schemas.push({ path: filePath, schema });
        } catch (e) {
          result.errors.push(`${filePath}: ${e.message}`);
        }
      }
      return result;
    };
    const renderWorkspaceReview = async () => {
      if (!pReview) return;
      const reviewSeq = ++this._reviewRenderSeq;
      pReview.empty();
      let config: WorkspaceDraft;
      try {
        config = readWorkspaceDraft();
      } catch (_) {
        config = WORKSPACE_CONFIG as WorkspaceDraft;
      }
      const activeTab = this._reviewActiveTab || 'overview';
      const reviewTabs = [
        ['overview', 'Overview'],
        ['navigation', 'Navigation'],
        ['secondary', 'Secondary tabs'],
        ['bases', 'Bases'],
        ['surfaces', 'Dashboards + planner'],
        ['widgets', 'Widgets'],
        ['reverse', 'Reverse map'],
        ['unassigned', 'Unassigned'],
      ];
      if (!reviewTabs.some(([id]) => id === activeTab)) this._reviewActiveTab = 'overview';
      const tabBar = pReview.createDiv({ cls: 'cad-settings-tabs cad-review-tabs' });
      const panel = pReview.createDiv({ cls: 'cad-settings-tab-panel cad-review-panel' });
      const setActiveTab = (id: string) => {
        this._reviewActiveTab = id;
        void renderWorkspaceReview();
      };
      reviewTabs.forEach(([id, label]) => {
        const btn = tabBar.createEl('button', { cls: 'cad-settings-tab cad-review-tab', text: label });
        btn.toggleClass('is-active', id === activeTab);
        btn.addEventListener('click', () => setActiveTab(id));
      });

      const navigation = config.navigation || {};
      const navGroups = Array.isArray(navigation.groups) ? navigation.groups : [];
      const secondaryTabs = navigation.secondaryTabs || {};
      const dashboardEntries = Object.entries(config.dashboards || {}).sort(([a], [b]) => a.localeCompare(b));
      const plannerEntries = Object.entries(config.planner || {}).sort(([a], [b]) => a.localeCompare(b));
      const baseKeys = Array.from(new Set([
        ...Object.keys(config.bases || {}),
        ...Object.keys(this.plugin.settings.baseFiles || {}),
        ...Object.keys(this.plugin.settings.baseViews || {}),
      ])).sort();
      const schemaFolder = (config.schemas?.folder || this.plugin.settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
      const schemaSources = await loadReviewSchemaSources(schemaFolder);
      if (this._reviewRenderSeq !== reviewSeq) return;
      const counts = [
        ['Nav groups', navGroups.length],
        ['Primary nav items', navGroups.reduce((sum, group) => sum + (group.items?.length || 0), 0)],
        ['Secondary tab sets', Object.keys(secondaryTabs).length],
        ['Base mappings', baseKeys.length],
        ['Dashboards', dashboardEntries.length],
        ['Planner surfaces', plannerEntries.length],
        ['Workbook groups', Array.isArray(config.workbookGroups) ? config.workbookGroups.length : 0],
        ['Schema sources', schemaSources.schemas.length],
      ];

      const configuredNavIds = new Set(navGroups.flatMap((group) => (group.items || []).map((item) => item.id)));
      const navRows: ReviewRow[] = [];
      NAV_GROUPS.forEach((group, groupIndex) => {
        (group.items || []).forEach((surface, itemIndex) => {
          const visibleReasons: string[] = [];
          if ((this.plugin.settings.disabledSurfaces || []).includes(surface.id)) visibleReasons.push('disabled');
          if (surface.module && this.plugin.settings.modules?.[surface.module] === false) visibleReasons.push(`module:${surface.module} off`);
          if (surface.navLevel === 'secondary' && !this.plugin.settings.showSecondaryNav) visibleReasons.push('secondary hidden');
          if (surface.navLevel === 'setup' && !this.plugin.settings.showSetupNav) visibleReasons.push('setup hidden');
          navRows.push([
            surface.label || surface.id || '',
            surface.id || '',
            group.label || group.id || '',
            `${groupIndex + 1}.${itemIndex + 1}`,
            surface.parent || '',
            surface.navLevel || 'primary',
            surface.module || '',
            surface.entityKey || '',
            configuredNavIds.has(surface.id) ? 'configured' : 'fallback',
            visibleReasons.length ? visibleReasons.join(' · ') : 'visible',
          ]);
        });
      });

      const secondaryRows: ReviewRow[] = [];
      Object.entries(secondaryTabs).forEach(([parentId, tabs]) => {
        (tabs || []).forEach((tab, idx) => {
          secondaryRows.push([
            tab.label || tab.route || tab.entityKey || `Tab ${idx + 1}`,
            parentId,
            idx + 1,
            tab.route || '',
            tab.entityKey || '',
            tab.icon || '',
            Array.isArray(tab.children) ? `${tab.children.length} children` : '',
          ]);
        });
      });

      const baseRows = baseKeys.map((entityKey) => {
        const configured = config.bases?.[entityKey] || {};
        const effectivePath = entityBasePath(this.plugin.settings, entityKey);
        const effectiveView = entityBaseViewName(this.plugin.settings, entityKey);
        const source = config.bases?.[entityKey] ? 'workspace.json.bases' : ((this.plugin.settings.baseFiles || {})[entityKey] || (this.plugin.settings.baseViews || {})[entityKey] ? 'plugin settings' : '');
        return [
          ENTITIES[entityKey]?.label || entityKey,
          entityKey,
          effectivePath || configured.file || configured.base || '',
          effectiveView || configured.view || configured.baseView || '',
          source,
        ];
      });

      const surfaceConfigs = [
        ...dashboardEntries.map(([id, surfaceConfig]) => ({ store: 'dashboards', id, surfaceConfig })),
        ...plannerEntries.map(([id, surfaceConfig]) => ({ store: 'planner', id, surfaceConfig })),
      ];
      const surfaceRows = surfaceConfigs.map(({ store, id, surfaceConfig }) => {
        const summary = summarizeDashboardBlueprint(id, surfaceConfig || {});
        return [
          summary.title,
          store,
          id,
          summary.kind,
          summary.statsCount,
          summary.cardCount,
          summary.widgetKinds.join(', ') || 'none',
          summary.sourceKinds.join(', ') || 'n/a',
          summary.contextFilter || '',
        ];
      });
      const widgetRows = surfaceConfigs.flatMap(({ id, surfaceConfig }) => collectWidgetRows(id, surfaceConfig || {}));

      const allEntityKeys = new Set([
        ...schemaSources.schemas.map(({ schema }) => (SCHEMA_TO_ENTITY_KEY as Record<string, string>)[schema.entity] || schema.entity),
        ...baseKeys,
        ...navGroups.flatMap((group) => (group.items || []).map((surface) => surface.entityKey).filter(Boolean)),
        ...Object.values(secondaryTabs).flatMap((tabs) => (tabs || []).map((tab) => tab.entityKey).filter(Boolean)),
      ]);
      const allEntityRows = [...allEntityKeys]
        .sort((a, b) => String(ENTITIES[a]?.label || a).localeCompare(String(ENTITIES[b]?.label || b)))
        .map((entityKey) => {
          const schemaSource = schemaSources.schemas.find(({ schema }) => ((SCHEMA_TO_ENTITY_KEY as Record<string, string>)[schema.entity] || schema.entity) === entityKey) || null;
          const navMatches: string[] = [];
          navGroups.forEach((group) => {
            (group.items || []).forEach((surface) => {
              if (surface.entityKey !== entityKey) return;
              navMatches.push(`${group.label || group.id || ''} / ${surface.label || surface.id || surface.entityKey}`);
            });
          });
          const tabMatches: string[] = [];
          Object.entries(secondaryTabs).forEach(([parentId, tabs]) => {
            const parentSurface = navGroups.flatMap((group) => group.items || []).find((surface) => surface.id === parentId);
            (tabs || []).forEach((tab) => {
              if (tab.entityKey !== entityKey) return;
              tabMatches.push(`${parentSurface?.label || parentId} / ${tab.label || tab.route || tab.entityKey}`);
            });
          });
          const basePath = entityBasePath(this.plugin.settings, entityKey) || config.bases?.[entityKey]?.file || config.bases?.[entityKey]?.base || '';
          const baseView = entityBaseViewName(this.plugin.settings, entityKey) || config.bases?.[entityKey]?.view || config.bases?.[entityKey]?.baseView || '';
          const inMenu = navMatches.length > 0 || tabMatches.length > 0;
          const sourceBits = [];
          if (schemaSource?.path) sourceBits.push('schema');
          if (basePath) sourceBits.push('base');
          if (!sourceBits.length) sourceBits.push('unmapped');
          return {
            label: ENTITIES[entityKey]?.label || schemaSource?.schema?.label || entityKey,
            entityKey,
            schemaPath: schemaSource?.path || '',
            basePath,
            baseView,
            navMatches,
            tabMatches,
            menuStatus: inMenu ? 'in menu' : 'not in menu',
            sourceStatus: sourceBits.join(' + '),
          };
        });
      const reverseRows = allEntityRows.map((row) => ([
        row.label,
        row.entityKey,
        row.schemaPath || '—',
        row.basePath || '—',
        row.baseView || '—',
        row.navMatches.length ? row.navMatches.join(' · ') : '—',
        row.tabMatches.length ? row.tabMatches.join(' · ') : '—',
        row.menuStatus,
        row.sourceStatus,
      ]));
      const unassignedRows = allEntityRows
        .filter((row) => row.menuStatus !== 'in menu' && (row.schemaPath || row.basePath))
        .map((row) => ([
          row.label,
          row.entityKey,
          row.schemaPath || '—',
          row.basePath || '—',
          row.baseView || '—',
          row.sourceStatus,
        ]));

      if (schemaSources.errors.length) {
        const details = panel.createEl('details', { cls: 'cad-base-filter-warnings' });
        details.createEl('summary', { text: `${schemaSources.errors.length} schema source warning${schemaSources.errors.length === 1 ? '' : 's'}` });
        const list = details.createEl('ul');
        schemaSources.errors.forEach((error) => {
          list.createEl('li').createEl('code', { text: error });
        });
      }

      if (activeTab === 'overview') {
        const summary = panel.createDiv({ cls: 'cad-review-summary' });
        counts.forEach(([label, value]) => {
          const card = summary.createDiv({ cls: 'cad-review-summary-card' });
          card.createDiv({ cls: 'cad-review-summary-value', text: String(value) });
          card.createDiv({ cls: 'cad-review-summary-label', text: String(label) });
        });
        const note = panel.createDiv({ cls: 'cad-widget-gap' });
        note.createDiv({ cls: 'cad-widget-gap-title', text: 'Review focus' });
        note.createDiv({
          cls: 'setting-item-description',
          text: 'Use the dedicated tabs to inspect navigation, bases, dashboards, widgets, and the reverse entity mapping. The reverse map shows which schema and base-backed entities are not yet represented in the menu tree.',
        });
        const missingCount = allEntityRows.filter((row) => row.menuStatus !== 'in menu' && (row.schemaPath || row.basePath)).length;
        const missingCard = note.createDiv({ cls: 'cad-review-summary-card' });
        missingCard.createDiv({ cls: 'cad-review-summary-value', text: String(missingCount) });
        missingCard.createDiv({ cls: 'cad-review-summary-label', text: 'Entities not in menu' });
      } else if (activeTab === 'navigation') {
        renderReviewTable(panel, 'Navigation inventory', ['Label', 'Surface', 'Group', 'Order', 'Parent', 'Level', 'Module', 'Entity', 'Source', 'Visibility'], navRows, 'No navigation items are available.');
      } else if (activeTab === 'secondary') {
        renderReviewTable(panel, 'Secondary tabs', ['Tab', 'Parent', '#', 'Route', 'Entity', 'Icon', 'Children'], secondaryRows, 'No secondary tabs are configured.');
      } else if (activeTab === 'bases') {
        renderReviewTable(panel, 'Effective base mappings', ['Label', 'Entity', 'Base file', 'View', 'Source'], baseRows, 'No base mappings are configured.');
      } else if (activeTab === 'surfaces') {
        renderReviewTable(panel, 'Configured dashboards and planner surfaces', ['Title', 'Store', 'Surface', 'Kind', 'Stats', 'Cards', 'Widgets', 'Sources', 'Context'], surfaceRows, 'No dashboard or planner surfaces are configured.');
      } else if (activeTab === 'widgets') {
        renderReviewTable(panel, 'Widget inventory', ['Title', 'Surface', 'Section', '#', 'Kind', 'Source', 'Entity', 'Metric', 'Field / Group', 'Limit', 'Condition / Notes'], widgetRows, 'No widgets are configured.');
      } else if (activeTab === 'reverse') {
        renderReviewTable(panel, 'Reverse entity map', ['Label', 'Entity', 'Schema file', 'Base file', 'View', 'Nav group/item', 'Tab parent/tab', 'Menu status', 'Source status'], reverseRows, 'No schema or base mappings are available.');
      } else if (activeTab === 'unassigned') {
        renderReviewTable(panel, 'Entities missing from the menu tree', ['Label', 'Entity', 'Schema file', 'Base file', 'View', 'Source status'], unassignedRows, 'No schema-backed or base-backed entities are currently missing from the menu tree.');
      }
    };
    let dashboardRenderer: SettingsDashboardRenderer | null = null;
    renderWorkspaceDesigners = () => {
      renderNavDesigner();
      renderWorkbookDesigner();
      void renderWorkspaceReview();
      if (dashboardRenderer) {
        pDash.empty();
        void dashboardRenderer.renderDashboardEditor(pDash).catch((e) => {
          pDash.createDiv({ cls: 'setting-item-description', text: `Dashboard editor failed: ${e.message}` });
        });
        pWidgets.empty();
        dashboardRenderer._renderWidgetCatalog(pWidgets);
      }
    };
    const updateWorkspaceDraft = (config: WorkspaceDraft, message?: string) => {
      workspaceTa.value = JSON.stringify(config, null, 2);
      setWorkspaceStatus(message || 'Workspace changed - click Save and apply', true);
      setWorkspaceConfig(validateWorkspaceConfig(migrateWorkspacePlannerConfig(config)));
      renderWorkspaceDesigners();
    };
    const saveWorkspaceBase = async (entityKey: string, file: string, view: string) => {
      const config = readWorkspaceDraft();
      config.bases = config.bases || {};
      if (file) {
        config.bases[entityKey] = { file };
        if (view) config.bases[entityKey].view = view;
      } else {
        delete config.bases[entityKey];
      }
      workspaceTa.value = JSON.stringify(config, null, 2);
      await saveWorkspaceConfig(this.plugin.app, workspaceTa.value);
      await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
      this.plugin.refreshOpenViews();
    };
    let activeDragPayload: NavDragPayload | null = null;
    const parseDragData = (event: DragEvent): NavDragPayload | null => {
      if (activeDragPayload) return activeDragPayload;
      try {
        const raw = event.dataTransfer.getData('text/bob-workspace-nav') || event.dataTransfer.getData('text/plain');
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    };
    const dragPayload = (event: DragEvent, payload: NavDragPayload) => {
      activeDragPayload = payload;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/bob-workspace-nav', JSON.stringify(payload));
      event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    };
    const clearDragPayload = () => {
      activeDragPayload = null;
      navDesigner.querySelectorAll('.drag-over').forEach((element) => element.removeClass('drag-over'));
    };
    const createIconPickerButton = (parent: HTMLElement, initialIcon: string | undefined, onChange: (iconId: string) => void, emptyText = 'Choose icon') => {
      let currentIcon = initialIcon || '';
      const button = parent.createEl('button', {
        cls: 'cad-nav-designer-icon-button',
        attr: { type: 'button', title: 'Choose an Obsidian icon' },
      });
      button.draggable = false;
      const render = () => {
        button.empty();
        const preview = button.createSpan({ cls: 'cad-nav-designer-icon-preview' });
        try { obsidian.setIcon(preview, currentIcon || 'shapes'); } catch (_) {}
        button.createSpan({ cls: 'cad-nav-designer-icon-name', text: currentIcon || emptyText });
      };
      button.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('dragstart', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        new CadenceIconPickerModal(this.plugin.app, currentIcon, (iconId) => {
          currentIcon = iconId;
          render();
          onChange(iconId);
        }).open();
      });
      render();
      return button;
    };
    const moveGroup = (config: WorkspaceDraft, sourceGroupIndex: number, targetGroupIndex: number) => {
      if (sourceGroupIndex === targetGroupIndex) return false;
      const groups = config.navigation.groups;
      const moved = groups.splice(sourceGroupIndex, 1)[0];
      if (!moved) return false;
      let destination = targetGroupIndex;
      if (sourceGroupIndex < targetGroupIndex) destination--;
      groups.splice(destination, 0, moved);
      return true;
    };
    const mutateGroupsForDrop = (config: WorkspaceDraft, payload: NavDragPayload, targetGroupIndex: number, targetItemIndex: number | null = null) => {
      const groups = config.navigation.groups;
      const target = groups[targetGroupIndex];
      if (!target) return false;
      let surface: DraftNavSurface | undefined;
      if (payload.type === 'item') {
        const sourceGroup = groups[payload.groupIndex];
        if (!sourceGroup?.items?.[payload.itemIndex]) return false;
        surface = sourceGroup.items.splice(payload.itemIndex, 1)[0];
        if (payload.groupIndex === targetGroupIndex && targetItemIndex != null && payload.itemIndex < targetItemIndex) {
          targetItemIndex--;
        }
      } else if (payload.type === 'tab') {
        const tab = config.navigation.secondaryTabs?.[payload.parentId]?.[payload.tabIndex];
        if (!tab) return false;
        const all = groups.flatMap((group) => group.items || []);
        surface = navigationSurfaceFromTab(payload.parentId, tab, all);
        removeSurfaceFromGroups(groups, surface.id);
      } else if (payload.type === 'entity') {
        const def = Object.assign({}, ENTITIES[payload.entityKey] || {});
        if (!def.label) return false;
        surface = groups.flatMap((group) => group.items || []).find((item) => item.entityKey === payload.entityKey);
        if (surface) removeSurfaceFromGroups(groups, surface.id);
        else surface = {
          id: `records.${payload.entityKey}`,
          label: def.plural || pluralizeEntityLabel(def.label),
          icon: def.icon || 'file-text',
          entityKey: payload.entityKey,
          desc: def.desc || `${def.plural || pluralizeEntityLabel(def.label)} records`,
        };
        delete surface.navLevel;
        delete surface.parent;
      } else {
        return false;
      }
      if (target.module) surface.module = target.module;
      else delete surface.module;
      if (!Array.isArray(target.items)) target.items = [];
      if (targetItemIndex == null || targetItemIndex > target.items.length) target.items.push(surface);
      else target.items.splice(Math.max(0, targetItemIndex), 0, surface);
      return true;
    };
    const movePayloadToTabs = (config: WorkspaceDraft, payload: NavDragPayload, targetParentId: string) => {
      const tabsByParent = config.navigation.secondaryTabs || (config.navigation.secondaryTabs = {});
      const targetTabs = tabsByParent[targetParentId] || (tabsByParent[targetParentId] = []);
      let tab: DraftSecondaryTab | undefined;
      if (payload.type === 'item') {
        const sourceGroup = config.navigation.groups[payload.groupIndex];
        const surface = sourceGroup?.items?.[payload.itemIndex];
        if (!surface || surface.id === targetParentId || !surface.entityKey) return false;
        sourceGroup.items.splice(payload.itemIndex, 1);
        for (const [parentId, tabs] of Object.entries(tabsByParent)) {
          const existingIndex = tabs.findIndex((candidate) => surfaceMatchesTab(surface, candidate));
          if (existingIndex >= 0) {
            if (parentId === targetParentId) return true;
            tab = tabs.splice(existingIndex, 1)[0];
            break;
          }
        }
        tab = tab || {
          label: surface.label,
          entityKey: surface.entityKey,
          route: surface.entityKey ? undefined : surface.id,
          icon: surface.icon,
        };
      } else if (payload.type === 'entity') {
        const def = Object.assign({}, ENTITIES[payload.entityKey] || {});
        if (!def.label || targetTabs.some((candidate) => candidate.entityKey === payload.entityKey)) return false;
        tab = {
          label: def.plural || pluralizeEntityLabel(def.label),
          entityKey: payload.entityKey,
          icon: def.icon,
        };
      } else if (payload.type === 'tab') {
        const sourceTabs = tabsByParent[payload.parentId];
        if (!sourceTabs?.[payload.tabIndex] || payload.parentId === targetParentId) return false;
        tab = sourceTabs.splice(payload.tabIndex, 1)[0];
      } else {
        return false;
      }
      if (!tab || targetTabs.some((candidate) =>
        (tab.entityKey && candidate.entityKey === tab.entityKey) || (tab.route && candidate.route === tab.route)
      )) return true;
      targetTabs.push(tab);
      return true;
    };

    const renderNavDesigner = () => {
      navDesignerBody.empty();
      let config: WorkspaceDraft;
      try {
        config = readWorkspaceDraft();
      } catch (e) {
        navDesignerBody.createDiv({ cls: 'setting-item-description', text: `Fix workspace JSON to use the designer: ${e.message}` });
        return;
      }
      if (!config.navigation?.groups) {
        navDesignerBody.createDiv({ cls: 'setting-item-description', text: 'Add navigation.groups to workspace.json to arrange navigation visually.' });
        return;
      }
      const groups = config.navigation.groups;
      if (normalizeStandaloneNavigationSurfaces(groups, config.navigation.secondaryTabs || {}, true)) {
        workspaceTa.value = JSON.stringify(config, null, 2);
        setWorkspaceStatus('Converted ungrouped secondary/setup items to primary navigation - click Save and apply', true);
      }
      const allSurfaces = groups.flatMap((group) => group.items || []);
      const assignedSurfaces = allSurfaces.filter((surface) =>
        !isTabBackedSurface(surface, config.navigation.secondaryTabs || {}) || surface.placement === 'navigation'
      );
      const addGroupRow = navDesignerBody.createDiv({ cls: 'cad-nav-designer-add-group' });
      const newGroupInput = addGroupRow.createEl('input', { type: 'text', placeholder: 'New group label' });
      let newGroupIcon = '';
      createIconPickerButton(addGroupRow, '', (iconId) => { newGroupIcon = iconId; });
      const addGroupBtn = addGroupRow.createEl('button', { text: '+ Add group' });
      addGroupBtn.addEventListener('click', () => {
        const label = newGroupInput.value.trim();
        if (!label) return;
        const seed = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
        let id = seed;
        let suffix = 2;
        while (groups.some((group) => group.id === id)) id = `${seed}-${suffix++}`;
        const group: DraftNavGroup = { id, label, module: id, items: [] };
        if (newGroupIcon) group.icon = newGroupIcon;
        groups.push(group);
        updateWorkspaceDraft(config, `${label} group added - click Save and apply`);
      });
      const palette = navDesignerBody.createDiv({ cls: 'cad-nav-designer-tabs' });
      palette.createDiv({ cls: 'cad-nav-designer-label', text: 'Tabs - drag a tab into navigation, or drop an item into a parent tab area' });
      const tabParents = palette.createDiv({ cls: 'cad-nav-designer-tab-parents' });
      const tabEntityKeys = new Set<string>();
      Object.entries(config.navigation.secondaryTabs || {}).forEach(([parentId, tabs]) => {
        const parentSurface = allSurfaces.find((surface) => surface.id === parentId);
        const parentEl = tabParents.createDiv({ cls: 'cad-nav-designer-tab-parent' });
        const parentHead = parentEl.createDiv({ cls: 'cad-nav-designer-tab-parent-head' });
        parentHead.createSpan({ text: parentSurface?.label || parentId });
        if (!tabs.length) {
          const removeTabs = parentHead.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
          removeTabs.addEventListener('click', () => {
            delete config.navigation.secondaryTabs[parentId];
            updateWorkspaceDraft(config, `${parentSurface?.label || parentId} tab area removed - click Save and apply`);
          });
        }
        const tabChips = parentEl.createDiv({ cls: 'cad-nav-designer-tab-chips' });
        tabs.forEach((tab, tabIndex) => {
          if (tab.entityKey) tabEntityKeys.add(tab.entityKey);
          const existing = assignedSurfaces.find((surface) =>
            surface.id !== parentId &&
            ((tab.entityKey && surface.entityKey === tab.entityKey) || (tab.route && surface.id === tab.route))
          );
          if (existing) return;
          const chip = tabChips.createDiv({ cls: 'cad-nav-designer-tab' });
          chip.draggable = true;
          chip.createSpan({ text: tab.label });
          const removeTab = chip.createEl('button', { cls: 'cad-nav-designer-tab-remove', text: '\u00d7' });
          removeTab.type = 'button';
          removeTab.title = `Remove ${tab.label} tab`;
          removeTab.draggable = false;
          removeTab.addEventListener('mousedown', (event) => event.stopPropagation());
          removeTab.addEventListener('dragstart', (event) => event.stopPropagation());
          removeTab.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            tabs.splice(tabIndex, 1);
            const primarySurface = groups.flatMap((group) => group.items || []).find((surface) =>
              surface.parent === parentId && surfaceMatchesTab(surface, tab)
            );
            makeNavigationSurfacePrimary(primarySurface);
            updateWorkspaceDraft(config, primarySurface
              ? `${tab.label} removed from ${parentSurface?.label || parentId} tabs and set as primary navigation - click Save and apply`
              : `${tab.label} removed from ${parentSurface?.label || parentId} tabs - click Save and apply`);
          });
          chip.addEventListener('dragstart', (event) => dragPayload(event, { type: 'tab', parentId, tabIndex }));
          chip.addEventListener('dragend', clearDragPayload);
        });
        if (!tabChips.childElementCount) tabChips.createSpan({ cls: 'cad-nav-designer-empty', text: 'Drop a child here' });
        parentEl.addEventListener('dragover', (event) => {
          const payload = parseDragData(event);
          const itemSurface = payload?.type === 'item'
            ? groups[payload.groupIndex]?.items?.[payload.itemIndex]
            : null;
          if (!payload || payload.type === 'group' ||
              (payload.type === 'tab' && payload.parentId === parentId) ||
              (payload.type === 'item' && (!itemSurface?.entityKey || itemSurface.id === parentId))) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          parentEl.addClass('drag-over');
        });
        parentEl.addEventListener('dragleave', () => parentEl.removeClass('drag-over'));
        parentEl.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          parentEl.removeClass('drag-over');
          const payload = parseDragData(event);
          if (payload && movePayloadToTabs(config, payload, parentId)) {
            updateWorkspaceDraft(config, `Tabs for ${parentSurface?.label || parentId} updated - click Save and apply`);
          }
          clearDragPayload();
        });
      });
      if (!tabParents.childElementCount) tabParents.createSpan({ cls: 'cad-nav-designer-empty', text: 'Create a tab area from a navigation parent to add tabs.' });
      const entityPalette = navDesignerBody.createDiv({ cls: 'cad-nav-designer-tabs' });
      entityPalette.createDiv({ cls: 'cad-nav-designer-label', text: 'Unassigned record types - drag into a navigation group' });
      const entityChips = entityPalette.createDiv({ cls: 'cad-nav-designer-tab-chips' });
      workspaceConfiguredEntityEntries(config).forEach(([entityKey, def]) => {
        if (!def || !def.label) return;
        const existing = assignedSurfaces.find((surface) => surface.entityKey === entityKey);
        if (existing || tabEntityKeys.has(entityKey)) return;
        const chip = entityChips.createDiv({ cls: 'cad-nav-designer-tab' });
        chip.draggable = true;
        chip.createSpan({ text: def.plural || pluralizeEntityLabel(def.label) });
        chip.addEventListener('dragstart', (event) => dragPayload(event, { type: 'entity', entityKey }));
        chip.addEventListener('dragend', clearDragPayload);
      });
      if (!entityChips.childElementCount) entityChips.createSpan({ cls: 'cad-nav-designer-empty', text: 'All record types are assigned.' });

      const removeZone = navDesignerBody.createDiv({ cls: 'cad-nav-designer-remove', text: 'Drop a navigation item here to remove it and return it to the available pool' });
      removeZone.addEventListener('dragover', (event) => {
        if (parseDragData(event)?.type !== 'item') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        removeZone.addClass('drag-over');
      });
      removeZone.addEventListener('dragleave', () => removeZone.removeClass('drag-over'));
      removeZone.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeZone.removeClass('drag-over');
        const payload = parseDragData(event);
        const surface = payload?.type === 'item' ? groups[payload.groupIndex]?.items?.splice(payload.itemIndex, 1)[0] : null;
        if (surface) updateWorkspaceDraft(config, `${surface.label} removed from navigation - click Save and apply`);
        clearDragPayload();
      });

      const board = navDesignerBody.createDiv({ cls: 'cad-nav-designer-board' });
      groups.forEach((group, groupIndex) => {
        const groupEl = board.createDiv({ cls: 'cad-nav-designer-group' });
        groupEl.dataset.groupIndex = String(groupIndex);
        groupEl.addEventListener('dragover', (event) => {
          if (!parseDragData(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          groupEl.addClass('drag-over');
        });
        groupEl.addEventListener('dragleave', () => groupEl.removeClass('drag-over'));
        groupEl.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          groupEl.removeClass('drag-over');
          const payload = parseDragData(event);
          if (payload?.type === 'group') {
            if (moveGroup(config, payload.groupIndex, groupIndex)) updateWorkspaceDraft(config);
          } else if (payload && mutateGroupsForDrop(config, payload, groupIndex)) {
            updateWorkspaceDraft(config);
          }
          clearDragPayload();
        });
        const groupHead = groupEl.createDiv({ cls: 'cad-nav-designer-group-head' });
        groupHead.draggable = true;
        groupHead.addEventListener('dragstart', (event) => {
          event.stopPropagation();
          dragPayload(event, { type: 'group', groupIndex });
        });
        groupHead.addEventListener('dragend', clearDragPayload);
        groupHead.createSpan({ cls: 'cad-nav-designer-handle', text: '::' });
        const groupTitleInput = groupHead.createEl('input', { cls: 'cad-nav-designer-group-title-input', type: 'text' });
        groupTitleInput.value = group.label || '';
        groupTitleInput.placeholder = group.id;
        groupTitleInput.title = 'Group label (leave blank for no heading)';
        groupTitleInput.draggable = false;
        groupTitleInput.addEventListener('mousedown', (event) => event.stopPropagation());
        groupTitleInput.addEventListener('dragstart', (event) => event.stopPropagation());
        groupTitleInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); groupTitleInput.blur(); } });
        groupTitleInput.addEventListener('change', () => {
          const next = groupTitleInput.value.trim();
          if (next === (group.label || '')) return;
          group.label = next;
          updateWorkspaceDraft(config, `${next || group.id} label updated - click Save and apply`);
        });
        createIconPickerButton(groupHead, group.icon, (iconId) => {
          if (iconId) group.icon = iconId;
          else delete group.icon;
          updateWorkspaceDraft(config, `${group.label || group.id} icon updated - click Save and apply`);
        });
        if (!(group.items || []).length) {
          const removeGroup = groupHead.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
          removeGroup.draggable = false;
          removeGroup.addEventListener('mousedown', (event) => event.stopPropagation());
          removeGroup.addEventListener('click', (event) => {
            event.stopPropagation();
            groups.splice(groupIndex, 1);
            updateWorkspaceDraft(config, `${group.label || group.id} group removed - click Save and apply`);
          });
        }
        const groupItems = groupEl.createDiv({ cls: 'cad-nav-designer-items' });
        (group.items || []).forEach((surface, itemIndex) => {
          const isTabBacked = isTabBackedSurface(surface, config.navigation.secondaryTabs || {});
          if (isTabBacked && surface.placement !== 'navigation') return;
          const item = groupItems.createDiv({ cls: 'cad-nav-designer-item' });
          item.draggable = true;
          item.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            dragPayload(event, { type: 'item', groupIndex, itemIndex });
          });
          item.addEventListener('dragend', clearDragPayload);
          item.addEventListener('dragover', (event) => {
            if (!parseDragData(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            item.addClass('drag-over');
          });
          item.addEventListener('dragleave', () => item.removeClass('drag-over'));
          item.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
            item.removeClass('drag-over');
            const payload = parseDragData(event);
            if (payload?.type === 'group') {
              if (moveGroup(config, payload.groupIndex, groupIndex)) updateWorkspaceDraft(config);
            } else if (payload && mutateGroupsForDrop(config, payload, groupIndex, itemIndex)) {
              updateWorkspaceDraft(config);
            }
            clearDragPayload();
          });
          item.createSpan({ cls: 'cad-nav-designer-handle', text: '::' });
          const itemText = item.createSpan({ cls: 'cad-nav-designer-item-text', text: surface.label });
          itemText.title = surface.id;
          createIconPickerButton(item, surface.icon, (iconId) => {
            if (iconId) surface.icon = iconId;
            else delete surface.icon;
            updateWorkspaceDraft(config, `${surface.label} icon updated - click Save and apply`);
          });
          if (surface.navLevel) item.createSpan({ cls: 'cad-nav-designer-level', text: surface.navLevel });
          if (!surface.parent && !Object.prototype.hasOwnProperty.call(config.navigation.secondaryTabs || {}, surface.id)) {
            const addTabs = item.createEl('button', { cls: 'cad-nav-designer-action', text: '+ Tabs' });
            addTabs.draggable = false;
            addTabs.addEventListener('mousedown', (event) => event.stopPropagation());
            addTabs.addEventListener('click', (event) => {
              event.stopPropagation();
              if (!config.navigation.secondaryTabs) config.navigation.secondaryTabs = {};
              config.navigation.secondaryTabs[surface.id] = surface.entityKey
                ? [{ label: surface.label, entityKey: surface.entityKey, icon: surface.icon }]
                : [];
              updateWorkspaceDraft(config, `Tab area added for ${surface.label} - click Save and apply`);
            });
          }
          const remove = item.createEl('button', {
            cls: 'cad-nav-designer-action danger',
            text: isTabBacked ? 'As tabs' : 'Remove',
          });
          remove.draggable = false;
          remove.addEventListener('mousedown', (event) => event.stopPropagation());
          remove.addEventListener('click', (event) => {
            event.stopPropagation();
            group.items.splice(itemIndex, 1);
            updateWorkspaceDraft(config, isTabBacked
              ? `${surface.label} moved to tabs - click Save and apply`
              : `${surface.label} removed from navigation - click Save and apply`);
          });
        });
        const empty = groupItems.createDiv({ cls: 'cad-nav-designer-dropzone', text: 'Drop available item here' });
        empty.addEventListener('dragover', (event) => {
          if (!parseDragData(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          empty.addClass('drag-over');
        });
        empty.addEventListener('dragleave', () => empty.removeClass('drag-over'));
        empty.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          empty.removeClass('drag-over');
          const payload = parseDragData(event);
          if (payload?.type === 'group') {
            if (moveGroup(config, payload.groupIndex, groupIndex)) updateWorkspaceDraft(config);
          } else if (payload && mutateGroupsForDrop(config, payload, groupIndex)) {
            updateWorkspaceDraft(config);
          }
          clearDragPayload();
        });
      });
    };
    const renderWorkbookDesigner = () => {
      workbookDesignerBody.empty();
      let config: WorkspaceDraft;
      try {
        config = readWorkspaceDraft();
      } catch (e) {
        workbookDesignerBody.createDiv({ cls: 'setting-item-description', text: `Fix workspace JSON to edit export groups: ${e.message}` });
        return;
      }
      if (!Array.isArray(config.workbookGroups)) config.workbookGroups = [];
      const addRow = workbookDesignerBody.createDiv({ cls: 'cad-nav-designer-add-group' });
      const newGroupInput = addRow.createEl('input', { type: 'text', placeholder: 'New export group label' });
      const addGroup = addRow.createEl('button', { text: '+ Add export group' });
      addGroup.addEventListener('click', () => {
        const label = newGroupInput.value.trim();
        if (!label) return;
        const seed = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
        let id = seed;
        let suffix = 2;
        while (config.workbookGroups.some((group) => group.id === id)) id = `${seed}-${suffix++}`;
        config.workbookGroups.push({ id, label, entityKeys: [] });
        updateWorkspaceDraft(config, `${label} export group added - click Save and apply`);
      });
      if (!config.workbookGroups.length) {
        workbookDesignerBody.createDiv({ cls: 'cad-nav-designer-empty', text: 'No export groups defined. Add a group to make selected workbook exports available.' });
        return;
      }
      const entities = workspaceConfiguredEntityEntries(config);
      const board = workbookDesignerBody.createDiv({ cls: 'cad-workbook-designer-board' });
      config.workbookGroups.forEach((group, groupIndex) => {
        const card = board.createDiv({ cls: 'cad-workbook-designer-group' });
        const head = card.createDiv({ cls: 'cad-workbook-designer-group-head' });
        const labelInput = head.createEl('input', { type: 'text', cls: 'cad-workbook-designer-title' });
        labelInput.value = group.label;
        labelInput.addEventListener('change', () => {
          const next = labelInput.value.trim();
          if (!next) {
            labelInput.value = group.label;
            return;
          }
          group.label = next;
          updateWorkspaceDraft(config, `${next} export group renamed - click Save and apply`);
        });
        const up = head.createEl('button', { cls: 'cad-nav-designer-action', text: 'Up' });
        up.disabled = groupIndex === 0;
        up.addEventListener('click', () => {
          if (groupIndex === 0) return;
          [config.workbookGroups[groupIndex - 1], config.workbookGroups[groupIndex]] =
            [config.workbookGroups[groupIndex], config.workbookGroups[groupIndex - 1]];
          updateWorkspaceDraft(config, 'Export group order updated - click Save and apply');
        });
        const down = head.createEl('button', { cls: 'cad-nav-designer-action', text: 'Down' });
        down.disabled = groupIndex === config.workbookGroups.length - 1;
        down.addEventListener('click', () => {
          if (groupIndex >= config.workbookGroups.length - 1) return;
          [config.workbookGroups[groupIndex], config.workbookGroups[groupIndex + 1]] =
            [config.workbookGroups[groupIndex + 1], config.workbookGroups[groupIndex]];
          updateWorkspaceDraft(config, 'Export group order updated - click Save and apply');
        });
        const remove = head.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
        remove.addEventListener('click', () => {
          config.workbookGroups.splice(groupIndex, 1);
          updateWorkspaceDraft(config, `${group.label} export group removed - click Save and apply`);
        });
        const choices = card.createDiv({ cls: 'cad-workbook-designer-choices' });
        entities.forEach(([entityKey, def]) => {
          const row = choices.createEl('label', { cls: 'cad-workbook-designer-choice' });
          const checkbox = row.createEl('input', { type: 'checkbox' });
          checkbox.checked = group.entityKeys.includes(entityKey);
          row.createSpan({ text: def.plural || pluralizeEntityLabel(def.label) });
          checkbox.addEventListener('change', () => {
            if (checkbox.checked && !group.entityKeys.includes(entityKey)) group.entityKeys.push(entityKey);
            if (!checkbox.checked) group.entityKeys = group.entityKeys.filter((key) => key !== entityKey);
            updateWorkspaceDraft(config, `${group.label} export records updated - click Save and apply`);
          });
        });
      });
    };
    workspaceTa.addEventListener('input', () => {
      try {
        const parsed = readWorkspaceDraft();
        setWorkspaceConfig(parsed);
        setWorkspaceStatus(`Valid - ${parsed.navigation?.groups?.length || 0} navigation group${(parsed.navigation?.groups?.length || 0) === 1 ? '' : 's'}`, true);
        renderWorkspaceDesigners();
      } catch (e) {
        setWorkspaceStatus(`Invalid JSON/config: ${e.message}`, false);
      }
    });
    setTimeout(renderWorkspaceDesigners, 0);

    /* ─── Dashboards ─── */
    pDash.createEl('h3', { text: 'Dashboards' });
    pDash.createEl('p', {
      cls: 'setting-item-description',
      text: 'Use the dashboard editor to tune the shipped surfaces. The dashboard tab stays focused on composition; the widget catalog and gap analysis live next door.',
    });
    dashboardRenderer = this._dashboardSettingsRenderer();
    void dashboardRenderer.renderDashboardEditor(pDash).catch((e) => {
      pDash.createDiv({ cls: 'setting-item-description', text: `Dashboard editor failed: ${e.message}` });
    });
    dashboardRenderer._renderDashboardInventory(pDash);

    /* ─── Widgets ─── */
    pWidgets.createEl('h3', { text: 'Widget catalog' });
    dashboardRenderer._renderWidgetCatalog(pWidgets);

    /* ─── Modules (consolidated: toggle + surfaces + folders + base files) ─── */
    pMod.createEl('p', {
      text: 'Each module groups its toggle, the surfaces it contains, and the folders/.base files that back them. Disable a module to hide its whole section; disable an individual surface to hide just that nav item.',
      cls: 'setting-item-description',
    });

    const ensureMods = () => {
      if (!this.plugin.settings.modules) {
        this.plugin.settings.modules = { crm: true, 'client-work': true, prm: true, srm: true, finance: true, procurement: true, tax: true, planner: true };
      }
      if (this.plugin.settings.modules['client-work'] == null) this.plugin.settings.modules['client-work'] = true;
      if (this.plugin.settings.modules.finance == null) this.plugin.settings.modules.finance = true;
      if (this.plugin.settings.modules.procurement == null) this.plugin.settings.modules.procurement = true;
      if (this.plugin.settings.modules.tax == null) this.plugin.settings.modules.tax = true;
      NAV_GROUPS.filter((group: NavGroupConfig) => group.module).forEach((group: NavGroupConfig) => {
        if (this.plugin.settings.modules[group.module] == null) this.plugin.settings.modules[group.module] = true;
      });
      return this.plugin.settings.modules;
    };
    const moduleLabels: Record<string, string> = {
      planner: 'Planner — daily planning, projects and capture.',
      crm:     'Customer Relationship Management — Contacts, Clients, My Companies, Pipeline, Activities.',
      'client-work': 'Client Work — Meetings, communications, deliverables, feedback, surveys, testimonials and decisions.',
      srm:     'Supplier Relationship Management — Suppliers, contracts, spend.',
      prm:     'Partner Relationship Management — Partners, Registrations, Commissions, Leads, Certifications, Analytics.',
      finance: 'Finance — periods, bank, journals, invoices, purchases, trial balances and statements.',
      procurement: 'Procurement — internal purchase requests and formal supplier purchase orders.',
      tax:     'Tax & Compliance — VAT, corporate tax, deferred tax, transfer pricing, legal rules and retention.',
      ai:      'AI Workspace — playbooks and installed skills.',
    };

    const baseFiles = this.plugin.app.vault.getFiles()
      .filter(f => f.extension === 'base')
      .sort((a, b) => a.path.localeCompare(b.path));
    const baseSummariesPromise = Promise.all(baseFiles.map((file) => readBaseSummary(this.plugin.app, file)))
      .then((items) => items.filter(Boolean).sort((a, b) => a.label.localeCompare(b.label)));

    NAV_GROUPS.forEach((group: NavGroupConfig) => {
      const items = group.items.filter((s) => !['home', 'team', 'settings'].includes(s.id));
      if (!items.length) return;
      // Skip the empty-id 'misc' group and Reports/Workflow without a module
      const isModuleGroup = !!group.module;
      const headingText = group.label || (isModuleGroup ? group.id.toUpperCase() : '');
      if (!headingText) return;

      const moduleDisabled = isModuleGroup && ensureMods()[group.module] === false;

      const cardKey = group.module || group.id;
      const isCollapsed = this._collapsedModules.has(cardKey);
      const card = pMod.createDiv({ cls: 'cad-module-card' + (moduleDisabled ? ' is-off' : '') + (isCollapsed ? ' is-collapsed' : '') });
      const cardHead = card.createDiv({ cls: 'cad-module-card-head' });
      cardHead.createSpan({ text: headingText, cls: 'cad-module-card-label' });
      const chevron = cardHead.createSpan({ cls: 'cad-module-card-chevron', text: isCollapsed ? '›' : '⌄' });
      cardHead.addEventListener('click', () => {
        if (this._collapsedModules.has(cardKey)) {
          this._collapsedModules.delete(cardKey);
          card.removeClass('is-collapsed');
          chevron.setText('⌄');
        } else {
          this._collapsedModules.add(cardKey);
          card.addClass('is-collapsed');
          chevron.setText('›');
        }
      });
      const cardBody = card.createDiv({ cls: 'cad-module-card-body' });
      const settingGroup = cardBody.createDiv({ cls: 'setting-group' + (moduleDisabled ? ' cad-settings-panel-off' : '') });
      const panel = settingGroup.createDiv({ cls: 'setting-items' });

      // Module enable/disable toggle (only for groups with a module ID)
      if (isModuleGroup) {
        new obsidian.Setting(panel)
          .setName(`Enable ${headingText}`)
          .setDesc(moduleLabels[group.module] || `${headingText} module defined in workspace.json.`)
          .addToggle((t) => t
            .setValue(ensureMods()[group.module] !== false)
            .onChange(async (v) => {
              ensureMods()[group.module] = v;
              await this.plugin.saveSettings();
              this.plugin.refreshOpenViews();
              this.display();   // re-render to update surface row enabled state
            }));
      }

      // One row per surface: visibility toggle + folder text input + base file dropdown
      const disabled = new Set(this.plugin.settings.disabledSurfaces || []);
      items.forEach((surface) => {
        const eDef = surface.entityKey ? ENTITIES[surface.entityKey] : null;
        const overridden = eDef && (eDef.typeFilter || Array.isArray(eDef.folders));
        const level = surface.navLevel || 'primary';
        const levelLabel = level === 'secondary' ? 'Secondary tab'
          : level === 'setup' ? 'Setup'
          : 'Primary';
        const desc = [];
        desc.push(levelLabel);
        if (surface.parent) desc.push(`parent: ${SURFACE_BY_ID[surface.parent]?.label || surface.parent}`);
        if (overridden) {
          if (eDef.typeFilter)            desc.push(`type: "${eDef.typeFilter}"`);
          if (Array.isArray(eDef.folders))desc.push(`folders: [${eDef.folders.join(', ')}]`);
        } else {
          desc.push(surface.id);
        }
        const managedBase = !!configuredBaseDefinition(surface.entityKey);
        if (managedBase) desc.push('Base from workspace.json');
        const s = new obsidian.Setting(panel)
          .setName(`${surface.label} (${levelLabel})`)
          .setDesc(desc.join(' · '));
        if (moduleDisabled) s.settingEl.classList.add('cad-setting-disabled');

        // Visibility toggle
        s.addToggle((t) => {
          t.setValue(!disabled.has(surface.id))
            .onChange(async (v) => {
              const arr = this.plugin.settings.disabledSurfaces || [];
              if (!v) { if (!arr.includes(surface.id)) arr.push(surface.id); }
              else { const i = arr.indexOf(surface.id); if (i >= 0) arr.splice(i, 1); }
              this.plugin.settings.disabledSurfaces = arr;
              await this.plugin.saveSettings();
              this.plugin.refreshOpenViews();
            });
          if (moduleDisabled) t.setDisabled(true);
        });

        // Folder text input (if this surface has a folderKey and isn't overridden by schema or .base)
        if (surface.folderKey && !overridden) {
          const placeholder = eDef?.folders?.[0] || (DEFAULT_SETTINGS[surface.folderKey] as string) || '';
          s.addText((t) => {
            t.setPlaceholder(placeholder)
              .setValue((this.plugin.settings[surface.folderKey] as string) || '')
              .onChange(async (v) => {
                const trimmed = v.trim();
                if (trimmed) this.plugin.settings[surface.folderKey] = trimmed;
                else delete this.plugin.settings[surface.folderKey];
                await this.plugin.saveSettings();
                syncEntityFolders(this.plugin.settings);
                this.plugin.refreshOpenViews();
              });
            if (moduleDisabled) t.setDisabled(true);
          });
        }

        // Base file dropdown (for surfaces backed by an entity)
        if (surface.entityKey) {
          const currentBase = entityBasePath(this.plugin.settings, surface.entityKey);
          const currentView = entityBaseViewName(this.plugin.settings, surface.entityKey);
          s.addDropdown((dd) => {
            dd.addOption('', 'Loading bases...');
            dd.setValue('');
            baseSummariesPromise.then((summaries) => {
              const compatible = summaries.filter((summary) => baseSummaryCompatibleWithEntity(summary, surface.entityKey));
              const selectedSummary = currentBase ? summaries.find((summary) => summary.path === currentBase) : null;
              const options = selectedSummary && !compatible.some((summary) => summary.path === selectedSummary.path)
                ? [selectedSummary, ...compatible]
                : compatible;
              dd.selectEl.empty();
              dd.addOption('', '— no base —');
              options.forEach((summary) => {
                const label = summary === selectedSummary && !baseSummaryCompatibleWithEntity(summary, surface.entityKey)
                  ? `[incompatible] ${summary.label}`
                  : summary.label;
                dd.addOption(summary.path, label);
              });
              dd.setValue(currentBase);
            });
            dd.onChange(async (v) => {
              await saveWorkspaceBase(surface.entityKey, v, '');
              this.display();
            });
            if (moduleDisabled) dd.setDisabled(true);
          });
          s.addDropdown((dd) => {
            dd.addOption('', currentBase ? 'Loading views...' : '— all properties —');
            dd.setValue('');
            if (!currentBase || moduleDisabled) dd.setDisabled(true);
            if (currentBase) {
              baseSummariesPromise.then((summaries) => {
                const summary = summaries.find((item) => item.path === currentBase);
                dd.selectEl.empty();
                dd.addOption('', '— all properties —');
                (summary?.views || []).forEach((viewName) => dd.addOption(viewName, viewName));
                dd.setValue(currentView);
                if (!moduleDisabled) dd.setDisabled(false);
              });
            }
            dd.onChange(async (v) => {
              await saveWorkspaceBase(surface.entityKey, currentBase, v);
              this.display();
            });
          });
        }
      });

      // Special case: Projects gets a multi-folder editor below its row
      if (group.id === 'planner') {
        const projectFoldersEl = panel.createDiv({ cls: 'cad-project-folders' });
        projectFoldersEl.style.cssText = 'padding:0 16px 12px;';
        const renderProjectFolders = () => {
          projectFoldersEl.empty();
          projectFoldersEl.createEl('div', { text: 'Project folders (first = default, additional = also scanned)', cls: 'setting-item-description' });
          const allFolders = [
            (this.plugin.settings.folderProjects || '30-CLIENTS'),
            ...(this.plugin.settings.projectFolders || []),
          ];
          allFolders.forEach((folder, idx) => {
            const row = projectFoldersEl.createDiv({ cls: 'cad-folder-row' });
            row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;';
            const inp = row.createEl('input', { type: 'text', cls: 'cad-folder-input' });
            inp.style.cssText = 'flex:1;';
            inp.value = folder;
            inp.placeholder = idx === 0 ? 'Default folder' : 'Additional folder';
            if (idx === 0) row.createEl('span', { text: 'default' }).style.cssText = 'font-size:10px;opacity:.6;';
            inp.addEventListener('change', async () => {
              const updated = [...allFolders];
              updated[idx] = inp.value.trim();
              this.plugin.settings.folderProjects = updated[0] || '30-CLIENTS';
              this.plugin.settings.projectFolders = updated.slice(1).filter(f => f);
              await this.plugin.saveSettings();
              syncEntityFolders(this.plugin.settings);
              this.plugin.refreshOpenViews();
            });
            if (idx > 0) {
              const rm = row.createEl('button', { text: '✕' });
              rm.addEventListener('click', async () => {
                const updated = allFolders.filter((_, i) => i !== idx);
                this.plugin.settings.folderProjects = updated[0] || '30-CLIENTS';
                this.plugin.settings.projectFolders = updated.slice(1).filter(f => f);
                await this.plugin.saveSettings();
                syncEntityFolders(this.plugin.settings);
                this.plugin.refreshOpenViews();
                renderProjectFolders();
              });
            }
          });
          const addBtn = projectFoldersEl.createEl('button', { text: '+ Add folder' });
          addBtn.style.marginTop = '4px';
          addBtn.addEventListener('click', async () => {
            if (!this.plugin.settings.projectFolders) this.plugin.settings.projectFolders = [];
            this.plugin.settings.projectFolders.push('');
            await this.plugin.saveSettings();
            renderProjectFolders();
          });
        };
        renderProjectFolders();
      }
    });

    pApp.createEl('h3', { text: 'Reminders' });
    const remindersGroup = pApp.createDiv({ cls: 'setting-group cad-settings-section' });
    const remindersPanel = remindersGroup.createDiv({ cls: 'setting-items' });
    new obsidian.Setting(remindersPanel)
      .setName('Desktop notifications')
      .setDesc('In addition to the in-app banner, fire a system notification when a reminder is due. Requires browser permission.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.desktopNotifications)
        .onChange(async (v) => {
          this.plugin.settings.desktopNotifications = v;
          await this.plugin.saveSettings();
          if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (_) {}
          }
        }));

    new obsidian.Setting(remindersPanel)
      .setName('Notification permission')
      .setDesc(typeof Notification === 'undefined'
        ? 'Notifications API not available in this environment.'
        : `Current status: ${Notification.permission}`)
      .addButton((b) => b.setButtonText('Request permission').onClick(async () => {
        if (typeof Notification === 'undefined') return;
        try { await Notification.requestPermission(); this.display(); } catch (_) {}
      }));

    new obsidian.Setting(remindersPanel)
      .setName('Clear completed reminders')
      .setDesc(`${(this.plugin.settings.reminders || []).filter((r) => r.done).length} completed reminders stored.`)
      .addButton((b) => b.setButtonText('Clear').onClick(async () => {
        this.plugin.settings.reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
        this.display();
      }));

    /* ─── App ─── */
    const appGroup = pApp.createDiv({ cls: 'setting-group cad-settings-section' });
    const appPanel = appGroup.createDiv({ cls: 'setting-items' });
    /* ─── Planner settings ─── */
    const plannerGroup = pPlanner.createDiv({ cls: 'setting-group cad-settings-section' });
    const plannerPanel = plannerGroup.createDiv({ cls: 'setting-items' });

    const peopleCategories = ENTITIES.contact.fields.find((f) => f.key === 'person_category')?.options
      || DEFAULT_SETTINGS.teamPersonCategories;
    const selectedTeamCategories = new Set(
      (Array.isArray(this.plugin.settings.teamPersonCategories)
        ? this.plugin.settings.teamPersonCategories
        : DEFAULT_SETTINGS.teamPersonCategories)
        .map((v) => String(v || '').toLowerCase())
    );
    const teamSetting = new obsidian.Setting(appPanel)
      .setName('Team person categories')
      .setDesc('People categories included on the Team screen.');
    const teamControls = teamSetting.controlEl.createDiv({ cls: 'cad-settings-checkboxes' });
    peopleCategories.forEach((category) => {
      const label = teamControls.createEl('label', { cls: 'cad-settings-checkbox' });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = selectedTeamCategories.has(category);
      label.createEl('span', { text: category });
      checkbox.addEventListener('change', async () => {
        const next = new Set(
          (Array.isArray(this.plugin.settings.teamPersonCategories)
            ? this.plugin.settings.teamPersonCategories
            : DEFAULT_SETTINGS.teamPersonCategories)
            .map((v) => String(v || '').toLowerCase())
        );
        if (checkbox.checked) next.add(category);
        else next.delete(category);
        this.plugin.settings.teamPersonCategories = Array.from(next);
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
      });
    });

    new obsidian.Setting(plannerPanel)
      .setName('Daily note folder')
      .setDesc('Folder under which daily notes live, e.g. "daily" or "Journal/Daily".')
      .addText((t) => t
        .setPlaceholder('daily')
        .setValue(this.plugin.settings.dailyNoteFolder)
        .onChange(async (v) => { this.plugin.settings.dailyNoteFolder = v; await this.plugin.saveSettings(); }));

    /* ── Task mode ── */
    const taskModeEl = new obsidian.Setting(plannerPanel)
      .setName('Task mode')
      .setDesc('How tasks are stored and displayed in the Planner.')
      .addDropdown((d) => d
        .addOption('checkbox',  'Checkbox only — inline checkboxes in daily notes')
        .addOption('tasknotes', 'TaskNotes only — full markdown note per task')
        .addOption('hybrid',    'Hybrid — checkboxes with Promote ↑ to TaskNote')
        .setValue(this.plugin.settings.taskMode || 'checkbox')
        .onChange(async (v) => {
          this.plugin.settings.taskMode = v;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
          this.display(); // re-render settings to show/hide folder field
        }));

    if ((this.plugin.settings.taskMode || 'checkbox') !== 'checkbox') {
      new obsidian.Setting(plannerPanel)
        .setName('TaskNotes folder')
        .setDesc('Vault path where TaskNote files are stored.')
        .addText((t) => t
          .setPlaceholder('00-CORE/TaskNotes/Tasks')
          .setValue(this.plugin.settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks')
          .onChange(async (v) => {
            this.plugin.settings.taskNotesFolder = v.trim() || '00-CORE/TaskNotes/Tasks';
            await this.plugin.saveSettings();
          }));
      new obsidian.Setting(plannerPanel)
        .setName('TaskNotes archive folder')
        .setDesc('Vault path where archived TaskNote files are stored and included in productivity history.')
        .addText((t) => t
          .setPlaceholder('00-CORE/TaskNotes/Archive')
          .setValue(this.plugin.settings.taskNotesArchiveFolder || '00-CORE/TaskNotes/Archive')
          .onChange(async (v) => {
            this.plugin.settings.taskNotesArchiveFolder = v.trim() || '00-CORE/TaskNotes/Archive';
            await this.plugin.saveSettings();
          }));
    }

    new obsidian.Setting(plannerPanel)
      .setName('Tasks heading')
      .setDesc('The H2 inside each daily note where tasks live. Default "## Today".')
      .addText((t) => t
        .setValue(this.plugin.settings.tasksHeading)
        .onChange(async (v) => { this.plugin.settings.tasksHeading = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(plannerPanel)
      .setName('Journal heading')
      .setDesc('The H2 where today\'s journal entry lives. Default "## Journal".')
      .addText((t) => t
        .setValue(this.plugin.settings.journalHeading)
        .onChange(async (v) => { this.plugin.settings.journalHeading = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(appPanel)
      .setName('Currency')
      .setDesc('Used to format money values across Pipeline, Reports and Commissions.')
      .addDropdown((d) => {
        CURRENCY_OPTIONS.forEach((c) => d.addOption(c.code, c.label));
        d.setValue(this.plugin.settings.currency || 'USD');
        d.onChange(async (v) => {
          this.plugin.settings.currency = v;
          await this.plugin.saveSettings();
          // Re-render any open Cadence tabs so values reformat immediately
          this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP).forEach((leaf) => {
            if (leaf.view && typeof (leaf.view as RenderableViewLike).render === 'function') (leaf.view as RenderableViewLike).render();
          });
        });
      });

    new obsidian.Setting(appPanel)
      .setName('Week starts on')
      .setDesc('First day of the week shown in the Planner tab.')
      .addDropdown((d) => d
        .addOption('1', 'Monday')
        .addOption('0', 'Sunday')
        .setValue(String(this.plugin.settings.weekStartsOn))
        .onChange(async (v) => {
          this.plugin.settings.weekStartsOn = Number(v) === 0 ? 0 : 1;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(appPanel)
      .setName('Open BOB Workspace on Obsidian startup')
      .setDesc('Auto-open the BOB Workspace Home command centre when Obsidian launches.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.openOnStartup)
        .onChange(async (v) => { this.plugin.settings.openOnStartup = v; await this.plugin.saveSettings(); }));

    const defaultDrop = new obsidian.Setting(appPanel)
      .setName('Default tab')
      .setDesc('Which surface opens first when you launch BOB Workspace.');
    defaultDrop.addDropdown((d) => {
      NAV_GROUPS.forEach((g) => {
        g.items.forEach((s) => {
          const prefix = g.label ? `${g.label} · ` : '';
          d.addOption(s.id, prefix + s.label);
        });
      });
      d.setValue(this.plugin.settings.defaultTab || 'planner.today');
      d.onChange(async (v) => { this.plugin.settings.defaultTab = v; await this.plugin.saveSettings(); });
    });

    /* ─── Schemas ─── */
    pDm.createEl('h3', { text: 'Data model' });

    /* ─── Bases ─── */
    const basesGroup = pDm.createDiv({ cls: 'setting-group cad-settings-section' });
    const basesPanel = basesGroup.createDiv({ cls: 'setting-items' });
    new obsidian.Setting(basesPanel)
      .setName('Bases folder')
      .setDesc('Vault folder where entity .base files live. Authoritative: changing it relocates where every base is resolved (the filename comes from the entity config, the folder from here).')
      .addText((t) => t
        .setPlaceholder('00-CORE/Bases')
        .setValue(this.plugin.settings.basesFolder || '00-CORE/Bases')
        .onChange(async (v) => {
          this.plugin.settings.basesFolder = v.trim() || '00-CORE/Bases';
          await this.plugin.saveSettings();
          await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
          this.plugin.refreshOpenViews();
        }));
    new obsidian.Setting(basesPanel)
      .setName('Generate missing bases')
      .setDesc('Create a .base file (filter + table view) for each entity that does not have one yet, in the Bases folder. Existing files are left untouched.')
      .addButton((button) => button
        .setButtonText('Generate missing bases')
        .onClick(async () => {
          if (!(await confirmModal(this.plugin.app, "Generate .base files for entities that don't have one yet? Existing files are left untouched.", { title: 'Generate missing bases', cta: 'Generate', danger: false }))) return;
          try {
            const result = await generateMissingBases(this.plugin.app, this.plugin.settings);
            await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
            this.plugin.refreshOpenViews();
            new obsidian.Notice(`BOB Workspace: created ${result.count} base${result.count === 1 ? '' : 's'} in ${result.folder}${result.skipped ? `; skipped ${result.skipped} existing` : ''}${result.failed.length ? `; ${result.failed.length} failed` : ''}.`);
          } catch (e) {
            new obsidian.Notice(`BOB Workspace: generate bases failed — ${e.message}`);
          }
        }));

    const schemasGroup = pDm.createDiv({ cls: 'setting-group cad-settings-section' });
    const schemasPanel = schemasGroup.createDiv({ cls: 'setting-items' });
    const configuredSchemas = WORKSPACE_CONFIG.schemas || {};
    const schemaSettings = effectiveSchemaSettings(this.plugin.settings);
    const schemasManaged = configuredSchemas.enabled != null || !!configuredSchemas.folder;
    if (schemasManaged) {
      const banner = schemasPanel.createDiv({ cls: 'cad-managed-banner' });
      const icon = banner.createSpan({ cls: 'cad-managed-banner-icon' });
      try { obsidian.setIcon(icon, 'lock'); } catch (_) {}
      banner.createSpan({ text: 'Schema settings are controlled by ' });
      banner.createEl('code', { text: 'workspace.json' });
      banner.createSpan({ text: '. Edit the ' });
      const wsLink = banner.createEl('a', { text: 'Workspace tab', cls: 'cad-managed-banner-link' });
      wsLink.addEventListener('click', () => {
        const wsTab = containerEl.querySelector<HTMLElement>('.cad-settings-tab[data-tab="workspace"]');
        if (wsTab) wsTab.click();
      });
      banner.createSpan({ text: ' to change them.' });
    }
    new obsidian.Setting(schemasPanel)
      .setName('Use schema YAML files')
      .setDesc('Read entity definitions (folders, type filters, field types, enum options) from Metadata Menu schema YAML files.')
      .addToggle((t) => {
        t.setValue(!!schemaSettings.useSchemas);
        if (schemasManaged) t.setDisabled(true);
        return t.onChange(async (v) => {
          this.plugin.settings.useSchemas = v;
          await this.plugin.saveSettings();
          await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
          this.plugin.refreshOpenViews();
        });
      });
    new obsidian.Setting(schemasPanel)
      .setName('Schemas folder')
      .setDesc('Vault path where schema YAML files live (one per entity).')
      .addText((t) => {
        t.setPlaceholder('00-CORE/Schemas/source').setValue(schemaSettings.schemasFolder);
        if (schemasManaged) t.setDisabled(true);
        return t.onChange(async (v) => {
          this.plugin.settings.schemasFolder = v.trim() || '00-CORE/Schemas/source';
          await this.plugin.saveSettings();
        });
      });
    new obsidian.Setting(schemasPanel)
      .setName('Regenerate derived schema outputs')
      .setDesc('Validate canonical YAML sources and regenerate Metadata Menu FileClasses and JSON Schemas.')
      .addButton((button) => button
        .setButtonText('Regenerate outputs')
        .onClick(async () => {
          try {
            const result = await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
            new obsidian.Notice(`BOB Workspace: generated ${result.count} FileClass and JSON Schema output(s); removed ${result.removed} stale output(s)${result.datamodelUpdated ? `; updated ${result.datamodelUpdated} DATAMODEL section(s)` : ''}.`);
            await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
            this.plugin.refreshOpenViews();
          } catch (e) {
            new obsidian.Notice(`BOB Workspace: output generation failed - ${e.message}`);
          }
        }));

    const schemaBootstrapBanner = schemasPanel.createDiv({ cls: 'cad-managed-banner cad-schema-bootstrap-banner' });
    schemaBootstrapBanner.style.display = 'none';
    const bootstrapIcon = schemaBootstrapBanner.createSpan({ cls: 'cad-managed-banner-icon' });
    try { obsidian.setIcon(bootstrapIcon, 'database'); } catch (_) {}
    const bootstrapText = schemaBootstrapBanner.createSpan({ text: 'No schema sources found in the configured folder.' });
    schemaBootstrapBanner.createSpan({ text: ' ' });
    const bootstrapAction = schemaBootstrapBanner.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Bootstrap schemas' });
    bootstrapAction.addEventListener('click', async () => {
      if (!(await confirmModal(this.plugin.app, 'Create canonical schema YAML from the current workspace entity definitions? Existing source files will be left untouched.', { title: 'Bootstrap schemas', cta: 'Bootstrap', danger: false }))) return;
      try {
        const result = await bootstrapCanonicalSchemaSources(this.plugin.app, this.plugin.settings);
        const regen = await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice(`BOB Workspace: bootstrapped ${result.count} schema source file${result.count === 1 ? '' : 's'}${result.skipped ? `; skipped ${result.skipped} existing source file${result.skipped === 1 ? '' : 's'}` : ''}. Generated ${regen.count} FileClass and JSON Schema output(s).`);
        this.display();
      } catch (e) {
        new obsidian.Notice(`BOB Workspace: schema bootstrap failed - ${e.message}`);
      }
    });

    const schemaDesigner = schemasPanel.createDiv({ cls: 'cad-schema-designer' });
    const schemaDesignerHead = schemaDesigner.createDiv({ cls: 'cad-schema-designer-head' });
    schemaDesignerHead.createEl('h4', { text: 'Data model designer' });
    schemaDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Edit canonical entity schema YAML visually. Schema sources define record structure and BOB display hints; generated JSON Schemas and Metadata Menu FileClasses are derived with one click.',
    });
    const schemaToolbar = schemaDesigner.createDiv({ cls: 'cad-schema-designer-toolbar' });
    const schemaSelect = schemaToolbar.createEl('select', { cls: 'dropdown' });
    const schemaNew = schemaToolbar.createEl('button', { text: '+ New entity' });
    const schemaReload = schemaToolbar.createEl('button', { text: 'Reload source' });
    const schemaSave = schemaToolbar.createEl('button', { text: 'Save schema source', cls: 'mod-cta' });
    const schemaSaveGenerate = schemaToolbar.createEl('button', { text: 'Save and regenerate', cls: 'mod-cta' });
    const schemaDelete = schemaToolbar.createEl('button', { text: 'Archive source', cls: 'mod-warning' });
    const schemaStatus = schemaDesigner.createDiv({ cls: 'cad-schema-designer-status setting-item-description' });
    const schemaForm = schemaDesigner.createDiv({ cls: 'cad-schema-designer-form' });
    let sourceSchema: DesignerSchemaSource | null = null;
    let sourceSchemaPath = '';
    let schemaDirty = false;
    let schemaFiles: string[] = [];
    const initialSchemaPath = this._schemaDesignerSelectedPath || '';
    const schemaFolder = (schemaSettings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
    (async () => {
      try {
        const loaded = await loadCanonicalSchemaSources(this.plugin.app, this.plugin.settings);
        const empty = !loaded.schemas.length;
        schemaBootstrapBanner.style.display = empty ? '' : 'none';
        bootstrapText.setText(empty
          ? `No schema sources found in ${schemaFolder}.`
          : `Found ${loaded.schemas.length} schema source${loaded.schemas.length === 1 ? '' : 's'} in ${schemaFolder}.`);
      } catch (_) {
        schemaBootstrapBanner.style.display = 'none';
      }
    })();

    const setSchemaStatus = (text: string, ok = true) => {
      schemaStatus.setText(text || '');
      schemaStatus.toggleClass('cad-status-ok', !!ok);
      schemaStatus.toggleClass('cad-status-err', !ok);
    };
    const highlightSaveButtons = (on: boolean) => {
      schemaSave.toggleClass('cad-schema-save-needed', on);
      schemaSaveGenerate.toggleClass('cad-schema-save-needed', on);
    };
    const autoSaveSchema = async () => {
      if (!sourceSchema || !sourceSchemaPath) return;
      try { validateSourceSchemaDefinition(sourceSchema); } catch (e) {
        setSchemaStatus(`Fix before saving: ${e.message}`, false);
        highlightSaveButtons(true);
        return;
      }
      const renamedPath = `${schemaFolder}/${sourceSchema.entity}.yaml`;
      if (sourceSchemaPath !== renamedPath && await adapter.exists(sourceSchemaPath)) {
        setSchemaStatus('Entity key changed — use Save to rename the file', false);
        highlightSaveButtons(true);
        return;
      }
      try {
        const targetPath = (await adapter.exists(sourceSchemaPath)) ? sourceSchemaPath : renamedPath;
        await ensureFolderSync(this.plugin.app, schemaFolder);
        if (await adapter.exists(targetPath)) {
          await adapter.write(`${targetPath}.backup`, await adapter.read(targetPath));
        }
        await adapter.write(targetPath, obsidian.stringifyYaml(sourceSchema));
        sourceSchemaPath = targetPath;
        schemaDirty = false;
        highlightSaveButtons(false);
        this._schemaDesignerSelectedPath = sourceSchemaPath;
        if (!schemaFiles.includes(sourceSchemaPath)) schemaFiles.push(sourceSchemaPath);
        setSchemaStatus('Saved', true);
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        await refreshSchemaSelect(sourceSchemaPath);
      } catch (e) {
        setSchemaStatus(`Auto-save failed: ${e.message}`, false);
        highlightSaveButtons(true);
      }
    };
    const markSchemaDirty = () => {
      schemaDirty = true;
      setSchemaStatus('Unsaved changes', true);
    };
    const commaList = (value: JsonValue[] | undefined) => Array.isArray(value) ? value.join(', ') : '';
    const parseList = (value: string) => String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    const parsePairs = (value: string) => String(value || '').split(/\n/).map((line) => parseList(line)).filter((pair) => pair.length);
    const discriminatorText = (value: Record<string, JsonValue> | undefined) => Object.entries(value || {}).map(([key, item]) => `${key}: ${item}`).join('\n');
    const parseDiscriminator = (value: string) => {
      const parsed: Record<string, string> = {};
      String(value || '').split(/\n/).forEach((line) => {
        const separator = line.indexOf(':');
        if (separator < 0) return;
        const key = line.slice(0, separator).trim();
        const item = line.slice(separator + 1).trim();
        if (key && item) parsed[key] = item;
      });
      return parsed;
    };
    const fieldAliasesText = (value: Record<string, string[]> | undefined) => Object.entries(value || {})
      .map(([key, aliases]) => `${key}: ${(Array.isArray(aliases) ? aliases : []).join(', ')}`)
      .join('\n');
    const parseFieldAliases = (value: string) => {
      const parsed: Record<string, string[]> = {};
      String(value || '').split(/\n/).forEach((line) => {
        const separator = line.indexOf(':');
        if (separator < 0) return;
        const key = line.slice(0, separator).trim();
        const aliases = parseList(line.slice(separator + 1));
        if (key && aliases.length) parsed[key] = aliases;
      });
      return parsed;
    };
    const fieldRow = (parent: HTMLElement, label: string) => {
      const row = parent.createDiv({ cls: 'cad-schema-designer-row' });
      row.createDiv({ cls: 'cad-schema-designer-label', text: label });
      return row.createDiv({ cls: 'cad-schema-designer-control' });
    };
    const textControl = (parent: HTMLElement, label: string, value: string | undefined, onInput: (value: string) => void, multiline = false) => {
      const control = fieldRow(parent, label);
      const input = multiline
        ? control.createEl('textarea', { cls: 'cad-schema-designer-input' })
        : control.createEl('input', { type: 'text', cls: 'cad-schema-designer-input' });
      input.value = value || '';
      if (multiline) (input as HTMLTextAreaElement).rows = 2;
      input.addEventListener('input', () => {
        onInput(input.value);
        markSchemaDirty();
      });
      input.addEventListener('blur', () => {
        if (schemaDirty) autoSaveSchema();
      });
      return input;
    };
    const renderSourceSchema = () => {
      schemaForm.empty();
      if (!sourceSchema) {
        schemaForm.createDiv({ cls: 'setting-item-description', text: 'Select an entity schema, or create a new one.' });
        return;
      }
      const identity = schemaForm.createDiv({ cls: 'cad-schema-designer-section' });
      identity.createEl('h5', { text: sourceSchemaPath || sourceSchema.entity });
      textControl(identity, 'Entity key', sourceSchema.entity, (value) => { sourceSchema.entity = value.trim(); });
      textControl(identity, 'Label', sourceSchema.label, (value) => { sourceSchema.label = value; });
      textControl(identity, 'Plural label', sourceSchema.plural, (value) => {
        if (value.trim()) sourceSchema.plural = value.trim();
        else delete sourceSchema.plural;
      });
      const iconControl = fieldRow(identity, 'Default icon');
      const iconButton = iconControl.createEl('button', { cls: 'cad-nav-designer-icon-button', attr: { type: 'button' } });
      const renderSchemaIcon = () => {
        iconButton.empty();
        const preview = iconButton.createSpan({ cls: 'cad-nav-designer-icon-preview' });
        try { obsidian.setIcon(preview, sourceSchema.icon || 'file-text'); } catch (_) {}
        iconButton.createSpan({ cls: 'cad-nav-designer-icon-name', text: sourceSchema.icon || 'Choose icon' });
      };
      iconButton.addEventListener('click', () => new CadenceIconPickerModal(this.plugin.app, sourceSchema.icon, (iconId) => {
        if (iconId) sourceSchema.icon = iconId;
        else delete sourceSchema.icon;
        markSchemaDirty();
        autoSaveSchema();
        renderSchemaIcon();
      }).open());
      renderSchemaIcon();
      textControl(identity, 'Type value', sourceSchema.type_value, (value) => { sourceSchema.type_value = value.trim(); });
      textControl(identity, 'Location pattern', sourceSchema.location_pattern, (value) => { sourceSchema.location_pattern = value.trim(); });
      textControl(identity, 'Definition', sourceSchema.description, (value) => { sourceSchema.description = value; }, true);
      textControl(identity, 'Scope', sourceSchema.scope, (value) => {
        if (value && value.trim()) sourceSchema.scope = value.trim();
        else delete sourceSchema.scope;
      });
      textControl(identity, 'Key fields', commaList(sourceSchema.key_fields), (value) => { sourceSchema.key_fields = parseList(value); });
      textControl(identity, 'Lifecycle', commaList(sourceSchema.status_lifecycle), (value) => { sourceSchema.status_lifecycle = parseList(value); });
      textControl(identity, 'Co-required pairs', (sourceSchema.co_required || []).map((pair) => pair.join(', ')).join('\n'), (value) => {
        const pairs = parsePairs(value);
        if (pairs.length) sourceSchema.co_required = pairs;
        else delete sourceSchema.co_required;
      }, true);
      textControl(identity, 'Discriminator', discriminatorText(sourceSchema.discriminator), (value) => {
        const discriminator = parseDiscriminator(value);
        if (Object.keys(discriminator).length) sourceSchema.discriminator = discriminator;
        else delete sourceSchema.discriminator;
      }, true);
      textControl(identity, 'Import field aliases', fieldAliasesText(sourceSchema.field_aliases), (value) => {
        const aliases = parseFieldAliases(value);
        if (Object.keys(aliases).length) sourceSchema.field_aliases = aliases;
        else delete sourceSchema.field_aliases;
      }, true);
      textControl(identity, 'BOB behavior JSON', sourceSchema.bob ? JSON.stringify(sourceSchema.bob, null, 2) : '', (value) => {
        if (!value.trim()) {
          delete sourceSchema.bob;
          return;
        }
        try {
          sourceSchema.bob = JSON.parse(value);
        } catch (_) {
          sourceSchema.bob = value as unknown as SourceSchema['bob'];
        }
      }, true);

      const fieldsSection = schemaForm.createDiv({ cls: 'cad-schema-designer-section' });
      const fieldsHead = fieldsSection.createDiv({ cls: 'cad-schema-designer-fields-head' });
      fieldsHead.createEl('h5', { text: 'Fields' });
      const addField = fieldsHead.createEl('button', { text: '+ Add field' });
      addField.addEventListener('click', () => {
        if (!Array.isArray(sourceSchema.fields)) sourceSchema.fields = [];
        sourceSchema.fields.push({ name: '', type: 'string', required: false });
        markSchemaDirty();
        autoSaveSchema();
        renderSourceSchema();
      });
      (sourceSchema.fields || []).forEach((field, index) => {
        const card = fieldsSection.createDiv({ cls: 'cad-schema-field' });
        const row = card.createDiv({ cls: 'cad-schema-field-main' });
        const nameInput = row.createEl('input', { type: 'text', cls: 'cad-schema-designer-input', placeholder: 'field_name' });
        nameInput.value = field.name || '';
        nameInput.addEventListener('input', () => { field.name = nameInput.value.trim(); markSchemaDirty(); });
        nameInput.addEventListener('blur', () => { if (schemaDirty) autoSaveSchema(); });
        const typeSelect = row.createEl('select', { cls: 'dropdown cad-schema-field-type' });
        [['string', 'Text'], ['number', 'Number'], ['integer', 'Integer'], ['boolean', 'Boolean'], ['array', 'Array'], ['date', 'Date'], ['datetime', 'Date/time'], ['enum', 'Enum']].forEach(([value, label]) => {
          typeSelect.createEl('option', { value, text: label });
        });
        typeSelect.value = editableSchemaFieldType(field);
        typeSelect.addEventListener('change', () => {
          applyEditableSchemaFieldType(field, typeSelect.value);
          markSchemaDirty();
          autoSaveSchema();
          renderSourceSchema();
        });
        const requiredWrap = row.createEl('label', { cls: 'cad-schema-required' });
        const required = requiredWrap.createEl('input', { type: 'checkbox' });
        required.checked = !!field.required;
        requiredWrap.appendText(' Required');
        required.addEventListener('change', () => { field.required = required.checked; markSchemaDirty(); autoSaveSchema(); });
        const up = row.createEl('button', { cls: 'cad-nav-designer-action', text: '\u2191', attr: { title: 'Move up' } });
        up.disabled = index === 0;
        up.addEventListener('click', () => {
          if (index === 0) return;
          [sourceSchema.fields[index - 1], sourceSchema.fields[index]] = [sourceSchema.fields[index], sourceSchema.fields[index - 1]];
          markSchemaDirty();
          autoSaveSchema();
          renderSourceSchema();
        });
        const down = row.createEl('button', { cls: 'cad-nav-designer-action', text: '\u2193', attr: { title: 'Move down' } });
        down.disabled = index === sourceSchema.fields.length - 1;
        down.addEventListener('click', () => {
          if (index >= sourceSchema.fields.length - 1) return;
          [sourceSchema.fields[index], sourceSchema.fields[index + 1]] = [sourceSchema.fields[index + 1], sourceSchema.fields[index]];
          markSchemaDirty();
          autoSaveSchema();
          renderSourceSchema();
        });
        const remove = row.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
        remove.addEventListener('click', () => {
          sourceSchema.fields.splice(index, 1);
          markSchemaDirty();
          autoSaveSchema();
          renderSourceSchema();
        });
        const detail = card.createDiv({ cls: 'cad-schema-field-detail' });
        const displayControl = fieldRow(detail, 'BOB display');
        const displayType = displayControl.createEl('select', { cls: 'dropdown cad-schema-field-type' });
        [['', 'Derived'], ['text', 'Text'], ['email', 'Email'], ['currency', 'Currency'], ['tags', 'Tags'], ['date', 'Date'], ['enum', 'Enum'], ['number', 'Number']].forEach(([value, label]) => {
          displayType.createEl('option', { value, text: label });
        });
        displayType.value = field.bob_type || '';
        displayType.addEventListener('change', () => {
          if (displayType.value) field.bob_type = displayType.value;
          else delete field.bob_type;
          markSchemaDirty();
          autoSaveSchema();
        });
        if (typeSelect.value === 'enum') {
          textControl(detail, 'Options', commaList(field.enum), (value) => { field.enum = parseList(value); });
        }
        textControl(detail, 'Default value', editableSchemaFieldDefault(field), (value) => {
          applyEditableSchemaFieldDefault(field, value);
        });
        textControl(detail, 'Description', field.description, (value) => {
          if (value.trim()) field.description = value;
          else delete field.description;
        });
      });
    };
    const loadSourceSchema = async (path: string) => {
      if (!path) {
        sourceSchema = null;
        sourceSchemaPath = '';
        schemaDirty = false;
        renderSourceSchema();
        return;
      }
      try {
        sourceSchema = validateSourceSchemaDefinition(obsidian.parseYaml(await adapter.read(path)));
        sourceSchemaPath = path;
        this._schemaDesignerSelectedPath = path;
        schemaDirty = false;
        schemaSelect.value = path;
        setSchemaStatus(`Loaded ${path}`, true);
        renderSourceSchema();
      } catch (e) {
        sourceSchema = null;
        sourceSchemaPath = path;
        setSchemaStatus(`Cannot load ${path}: ${e.message}`, false);
        renderSourceSchema();
      }
    };
    const refreshSchemaSelect = async (preferredPath: string) => {
      try {
        const listed = await adapter.list(schemaFolder);
        schemaFiles = (listed.files || [])
          .filter((path) => /\.ya?ml$/i.test(path))
          .sort((a, b) => a.localeCompare(b));
      } catch (_) {
        schemaFiles = [];
      }
      schemaSelect.empty();
      schemaSelect.createEl('option', { value: '', text: '\u2014 select schema \u2014' });
      schemaFiles.forEach((path) => schemaSelect.createEl('option', { value: path, text: path.slice(schemaFolder.length + 1) }));
      const target = preferredPath || schemaFiles[0] || '';
      schemaSelect.value = target;
      await loadSourceSchema(target);
    };
    schemaSelect.addEventListener('change', async () => {
      if (schemaDirty && !(await confirmModal(this.plugin.app, 'Discard unsaved schema changes?', { title: 'Discard changes', cta: 'Discard' }))) {
        schemaSelect.value = sourceSchemaPath;
        return;
      }
      await loadSourceSchema(schemaSelect.value);
    });
    schemaReload.addEventListener('click', async () => {
      if (schemaDirty && !(await confirmModal(this.plugin.app, 'Discard unsaved schema changes?', { title: 'Discard changes', cta: 'Discard' }))) return;
      await refreshSchemaSelect(sourceSchemaPath);
    });
    schemaNew.addEventListener('click', () => {
      new CadencePromptModal(this.plugin.app, {
        title: 'New entity schema',
        placeholder: 'entity-key',
        cta: 'Create',
        onSubmit: async (value) => {
          if (!value) return;
          const entity = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (!entity) return;
          const path = `${schemaFolder}/${entity}.yaml`;
          if (await adapter.exists(path)) {
            new obsidian.Notice(`BOB Workspace: schema already exists at ${path}.`);
            await loadSourceSchema(path);
            return;
          }
          sourceSchemaPath = path;
          sourceSchema = {
            entity,
            label: entity.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
            type_value: entity,
            location_pattern: `20-COMPANY/${entity.toUpperCase()}/`,
            description: '',
            key_fields: [],
            fields: [{ name: 'type', type: 'string', required: true, enum: [entity] }],
            status_lifecycle: [],
          };
          sourceSchema.plural = pluralizeEntityLabel(sourceSchema.label);
          schemaDirty = true;
          setSchemaStatus(`New schema draft: ${path}`, true);
          renderSourceSchema();
        },
      }).open();
    });
    const saveSchemaSource = async (regenerate: boolean) => {
      if (!sourceSchema || !sourceSchemaPath) return;
      try {
        validateSourceSchemaDefinition(sourceSchema);
        await ensureFolderSync(this.plugin.app, schemaFolder);
        const renamedPath = `${schemaFolder}/${sourceSchema.entity}.yaml`;
        if (sourceSchemaPath !== renamedPath && await adapter.exists(sourceSchemaPath)) {
          if (!(await confirmModal(this.plugin.app, `Rename schema source file to ${sourceSchema.entity}.yaml to match its entity key?`, { title: 'Rename schema source', cta: 'Rename', danger: false }))) {
            throw new Error('Entity key changes require renaming the canonical source file');
          }
          if (await adapter.exists(renamedPath)) throw new Error(`${renamedPath} already exists`);
          await adapter.write(`${sourceSchemaPath}.backup`, await adapter.read(sourceSchemaPath));
          await adapter.rename(sourceSchemaPath, renamedPath);
          sourceSchemaPath = renamedPath;
        } else if (!(await adapter.exists(sourceSchemaPath))) {
          sourceSchemaPath = renamedPath;
        }
        if (await adapter.exists(sourceSchemaPath)) {
          await adapter.write(`${sourceSchemaPath}.backup`, await adapter.read(sourceSchemaPath));
        }
        await adapter.write(sourceSchemaPath, obsidian.stringifyYaml(sourceSchema));
        let outputText = '';
        if (regenerate) {
          const result = await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
          outputText = ` Generated ${result.count} FileClass and JSON Schema output(s); removed ${result.removed} stale output(s)${result.datamodelUpdated ? `; updated ${result.datamodelUpdated} DATAMODEL section(s)` : ''}.`;
        }
        schemaDirty = false;
        this._schemaDesignerSelectedPath = sourceSchemaPath;
        if (!schemaFiles.includes(sourceSchemaPath)) schemaFiles.push(sourceSchemaPath);
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice(`BOB Workspace: schema source saved and applied.${outputText}`);
        this.display();
      } catch (e) {
        setSchemaStatus(`Save failed: ${e.message}`, false);
        new obsidian.Notice(`BOB Workspace: schema source save failed - ${e.message}`);
      }
    };
    schemaSave.addEventListener('click', async () => saveSchemaSource(false));
    schemaSaveGenerate.addEventListener('click', async () => saveSchemaSource(true));
    schemaDelete.addEventListener('click', async () => {
      if (!sourceSchemaPath || !(await adapter.exists(sourceSchemaPath))) return;
      if (!(await confirmModal(this.plugin.app, `Archive ${sourceSchemaPath}? It will stop loading as a record type and remain available as a timestamped backup.`, { title: 'Archive schema source', cta: 'Archive' }))) return;
      try {
        const archivedPath = `${sourceSchemaPath}.archived-${Date.now()}`;
        await adapter.rename(sourceSchemaPath, archivedPath);
        sourceSchema = null;
        sourceSchemaPath = '';
        schemaDirty = false;
        this._schemaDesignerSelectedPath = '';
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice(`BOB Workspace: schema archived at ${archivedPath}.`);
        this.display();
      } catch (e) {
        setSchemaStatus(`Archive failed: ${e.message}`, false);
      }
    });
    setTimeout(() => refreshSchemaSelect(initialSchemaPath), 0);

    pData.createEl('h3', { text: 'Data import/export' });
    const dataGroup = pData.createDiv({ cls: 'setting-group cad-settings-section' });
    const dataPanel = dataGroup.createDiv({ cls: 'setting-items' });
    new obsidian.Setting(dataPanel)
      .setName('Workbook export folder')
      .setDesc('Vault folder where XLSX workbook exports are written.')
      .addText((t) => t
        .setPlaceholder(DEFAULT_SETTINGS.workbookExportFolder)
        .setValue(this.plugin.settings.workbookExportFolder || DEFAULT_SETTINGS.workbookExportFolder)
        .onChange(async (v) => {
          this.plugin.settings.workbookExportFolder = v.trim().replace(/^\/+/, '').replace(/\/+$/, '') || DEFAULT_SETTINGS.workbookExportFolder;
          await this.plugin.saveSettings();
        }));
    const exportGroups = workbookExportGroups();
    const exportSetting = new obsidian.Setting(dataPanel)
      .setName('Export entity groups to XLSX')
      .setDesc(`Select one or more configured export groups to create a limited workbook under ${workbookExportFolder(this.plugin.settings)}.`);
    const exportControl = exportSetting.controlEl.createDiv({ cls: 'cad-workbook-export-control' });
    const groupSelect = exportControl.createEl('select', { cls: 'dropdown cad-workbook-group-select', attr: { multiple: 'multiple' } });
    groupSelect.size = Math.min(Math.max(exportGroups.length, 6), 12);
    exportGroups.forEach((group) => {
      const option = groupSelect.createEl('option', {
        value: group.id,
        text: `${group.label} (${group.entityKeys.length})`,
      });
      option.selected = true;
    });
    const exportBtn = exportControl.createEl('button', { cls: 'mod-cta', text: 'Export workbook' });
    exportBtn.addEventListener('click', async () => {
      const selectedGroups = Array.from(groupSelect.selectedOptions).map((option) => option.value);
      const entityKeys = selectedWorkbookEntityKeys(selectedGroups);
      if (!entityKeys.length) {
        new obsidian.Notice('BOB Workspace: select at least one group to export.');
        return;
      }
      try {
        const suffix = selectedGroups.length === exportGroups.length ? '' : 'selected';
        const path = await exportEntitiesXLSX(this.plugin.app, entityKeys, suffix, this.plugin.settings);
        new obsidian.Notice(`BOB Workspace: exported workbook to ${path}`, 6000);
      } catch (e) {
        new obsidian.Notice(`BOB Workspace: XLSX export failed — ${e.message}`, 8000);
      }
    });
    new obsidian.Setting(dataPanel)
      .setName('Import entities from XLSX')
      .setDesc('Imports workbook sheets named after entity keys, labels or plurals, using field keys as column headers.')
      .addButton((b) => b
        .setButtonText('Import workbook')
        .onClick(async () => {
          await promptImportWorkbook(this.plugin.app, async () => this.plugin.refreshOpenViews());
        }));

    pData.createEl('h3', { text: 'Sync' });
    pData.createEl('p', {
      cls: 'setting-item-description',
      text: 'Cloud sync remains a future bridge. The settings stay here so the eventual backend configuration has a stable home.',
    });
    const syncGroup = pData.createDiv({ cls: 'setting-group cad-settings-section cad-settings-panel-off cad-sync-disabled' });
    const syncPanel = syncGroup.createDiv({ cls: 'setting-items' });
    const cloudDesc = syncPanel.createEl('p', { cls: 'setting-item-description cad-sync-disabled-desc' });
    cloudDesc.appendText('Future option to two-way sync your vault with a live BOB Workspace / Cadence backend, so contacts, deals and partners stay aligned across desktop and mobile. ');
    cloudDesc.createEl('strong', { text: 'Not active yet.' });
    cloudDesc.appendText(' These fields are persisted but unused until the sync feature ships in a later release.');
    new obsidian.Setting(syncPanel)
      .setName('Backend base URL')
      .setDesc('Coming soon')
      .addText((t) => {
        t.setPlaceholder('https://your-cadence-instance')
         .setValue(this.plugin.settings.cadenceApiUrl)
         .onChange(async (v) => { this.plugin.settings.cadenceApiUrl = v; await this.plugin.saveSettings(); });
        t.inputEl.disabled = true;
      });
    new obsidian.Setting(syncPanel)
      .setName('API token')
      .setDesc('Coming soon')
      .addText((t) => {
        t.setPlaceholder('paste JWT here when sync ships')
         .setValue(this.plugin.settings.cadenceApiToken)
         .onChange(async (v) => { this.plugin.settings.cadenceApiToken = v; await this.plugin.saveSettings(); });
        t.inputEl.disabled = true;
      });
  }
}

/* ─────────── Playbook Runner Bases view ─────────── */
