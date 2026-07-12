import { entityBasePath, entityBaseViewName } from '../bases-config';
import { baseViewRendersInline, hasBaseValue, parseBaseFile, readBaseSummary } from '../bases-parse';
import { CANVAS_GENERATORS, buildAgentAuditCanvas, buildEntityContextCanvas, buildProcessCanvas, entityLifecycle, isAgentRunFile, mergeGeneratedCanvas, ownedIdsOf, serializeCanvas, type CanvasData, type CanvasManifest } from '../canvas';
import { BUILTIN_DASHBOARD_DEFAULTS, DASHBOARD_WIDGET_CATALOG, PURE_DASHBOARD_WIDGET_TYPES, type DashboardBlueprint, dashboardProviderRowValue, summarizeDashboardBlueprint } from '../dashboards';
import { FIELD_HELP, HELP_TOPICS, SOURCE_SECTION_HELP, WIDGET_GUIDES, WIDGET_INTRO } from '../help-content';
import { BUILT_SURFACES, ENTITIES, activityDate, activityTitle, dealLostStages, dealStageField, dealTerminalStages, dealValueField, dealWonStages, entityKeyFromFile, getDealStages, isOpenEntityRecord, primaryFieldKey } from '../entities';
import { compareEntitiesByBaseSort, entityPrimaryValue, entityValue, fmtValue, listEntities, listEntityFiles, readEntity } from '../entity-files';
import { CadenceReminderEditModal } from '../modals/capture';
import { CadencePromptModal, confirmModal } from '../modals/common';
import { CadenceEntityCreateModal } from '../modals/entity-create';
import { CadenceImportModal } from '../modals/import';
import { ALL_SURFACES, NAV_GROUPS, SECONDARY_TABS, SURFACE_BY_ID, VIEW_TYPE_CADENCE_APP, cloneConfig, reorderPinnedList } from '../nav';
import { isTabBackedSurface, surfaceMatchesTab } from '../nav-helpers';
import { createEntity, ensureDailyNote, parseSections, replaceSection } from '../notes';
import { parseH2Sections, parseTasksList, readProjectMeta, stringifyMilestones, stringifyTasks } from '../project-notes';
import { findProjectTaskReminder, projectNameFromPath, reminderBucket, reminderTimeStr } from '../reminders';
import { reloadEntityConfiguration } from '../runtime-config';
import { DEFAULT_SETTINGS, applyDashboardContext, entityFolder } from '../settings';
import { buildProductivitySnapshot } from '../snapshots';
import { createTaskNote, listTodayTaskNotes, toggleTaskNoteStatus } from '../task-notes';
import { addDays, dailyNotePath, dateInfo, ensureFolderSync, greeting, isTemplatePath, pctBand, sameDay, startOfDay, startOfWeek, weekDates, ymd } from '../utils';
import { filterEntitiesByBaseConfig, normalizeWidgetSortSpec, normalizeWidgetSourceConfig, resolveWidgetSource } from '../widgets';
import { exportEntitiesXLSX, selectedWorkbookEntityKeys, workbookExportFolder, workbookExportGroups } from '../workbook';
import { WORKSPACE_CONFIG, WORKSPACE_HAS_NAVIGATION, configuredDashboardDefinition, configuredSurfaceActions, dashboardWidgetSchema, normalizeDashboardConfigShape, resolveSurfaceConfig, saveWorkspaceConfig, validateDashboardConfig, workspaceConfiguredEntityEntries, workspaceConfiguredEntityKeys, workspaceHasEntity } from '../workspace-config';
import * as obsidian from 'obsidian';
import type { CadencePlugin } from '../plugin';
import type {
  BaseConfig,
  BobSettings,
  DashboardCard,
  DashboardConfig,
  EntityDef,
  EntityField,
  EntityRecord,
  Frontmatter,
  NavGroup,
  NavSurface,
  Reminder,
  SecondaryTab,
  WidgetSourceConfig,
} from '../types';

/* ── Module-local types (type-only; erased by esbuild) ─────────── */

/**
 * CadencePlugin with the members this view consumes sharpened (signatures
 * read from src/plugin.ts) while remaining assignable to CadencePlugin.
 */
interface PluginHandle extends CadencePlugin {
  settings: BobSettings;
  saveSettings(): Promise<void>;
  refreshOpenViews(): void;
  openQuickCapture(prefill?: { text?: string; when?: string | null; repeat?: string }): void;
  updateReminder(id: string, patch: Partial<Reminder>): Promise<Reminder | null>;
  deleteReminder(id: string): Promise<void>;
  snoozeReminder(id: string, ms: number): Promise<Reminder | null>;
  completeReminder(id: string): Promise<Reminder | null>;
}

/** Obsidian internals used by this view that are not part of the public API. */
type AppWithInternals = obsidian.App & {
  commands: { executeCommandById: (id: string) => unknown };
  setting: { open: () => void; openTabById: (id: string) => void };
  embedRegistry?: {
    embedByExtension?: Record<string, BaseEmbedCreator | undefined>;
    getEmbedCreator?: (file: obsidian.TFile) => BaseEmbedCreator | undefined;
  };
  openWithDefaultApp: (path: string) => void;
};

/** Inline embed component created by the (internal) embed registry. */
type BaseEmbed = obsidian.Component & {
  loadFile?: () => Promise<unknown>;
  load?: () => unknown;
};
type BaseEmbedCreator = (
  context: { app: obsidian.App; containerEl: HTMLElement; sourcePath: string; linktext: string; showInline: boolean; depth: number },
  file: obsidian.TFile,
  subpath: string
) => BaseEmbed | null;

/**
 * workspace.json dashboard card / config blobs as the renderers read them —
 * authored JSON with many ad-hoc keys. This is a genuinely dynamic
 * parsed-config boundary (see the Frontmatter rationale in types.ts).
 */
type CardLike = DashboardCard & Frontmatter;
type DashConfigLike = DashboardConfig & Frontmatter;

/** Result of normalizeWidgetSourceConfig() — authored source spec, normalized. */
type NormalizedWidgetSource = WidgetSourceConfig & Frontmatter;

/** Result shape of resolveWidgetSource() (src/widgets.ts). */
interface ResolvedWidgetSource {
  entityKey?: string | null;
  def?: EntityDef | null;
  entities: EntityRecord[];
  warnings?: string[];
  source?: NormalizedWidgetSource;
  metadata?: Frontmatter;
  displayFields?: EntityField[];
}

/** Widget data loader shared by the config-dashboard renderers (cached per surface render). */
type GetWidgetEntities = (source: unknown, fallbackEntityKey?: string | null) => Promise<ResolvedWidgetSource>;

/** Progress descriptor accepted by `_renderRowProgress`. */
interface ProgressLike {
  value?: number | string;
  percent?: number | string;
  pct?: number | string;
  label?: string;
}

/** Row produced for dashboard list/bar widgets and snapshot providers. */
interface ProviderRow extends Frontmatter {
  title?: string;
  meta?: string;
  file?: obsidian.TFile | null;
  entityKey?: string;
  surface?: string;
  command?: string;
  url?: string;
  action?: ActionInput;
  value?: number;
  values?: Record<string, number>;
  progress?: ProgressLike;
}

/** Normalized action spec for dashboard/header actions (authored JSON). */
interface ActionSpec extends Frontmatter {
  label?: string;
  type?: string;
  command?: string;
  surface?: string;
  entityKey?: string;
  path?: string;
  url?: string;
  primary?: boolean;
  danger?: boolean;
  description?: string;
  route?: string;
  action?: string;
}
type ActionInput = string | ActionSpec | null | undefined;

/** Reminder plus the free-form `notes` body the modal/inbox read (not yet in types.Reminder). */
type ReminderLike = Reminder & { notes?: string };

/** Nav structures come from workspace.json (extra ad-hoc keys allowed). */
type NavSurfaceLike = NavSurface & { placement?: string };
type NavGroupLike = Omit<NavGroup, 'items'> & { module?: string; icon?: string; items?: NavSurfaceLike[] };
type SecondaryTabLike = SecondaryTab & { children?: SecondaryTabLike[] };

/** Persisted per-surface dashboard control state (user-authored JSON values). */
type DashboardState = Record<string, any>;

/** Option entry of a selector control card (authored JSON: scalar or object). */
type SelectorOptionLike = string | number | { value?: unknown; id?: unknown; key?: unknown; label?: unknown; title?: unknown; filter?: unknown } | null;

/** Normalized dropdown option built by the selector / date-range widgets. */
interface SelectorOption { value: string; label?: string; filter?: string }

/** Options bag for `renderConfigDashboard` (also fed from EntityListOptions). */
interface DashboardRenderOptions {
  config?: DashConfigLike | null;
  skipHeader?: boolean;
}

/** Options bag for `renderEntityList` / `renderEntityTabs`. */
interface EntityListOptions {
  filter?: (entity: EntityRecord) => boolean;
  forceInternal?: boolean;
  title?: string;
  titleSuffix?: string;
  renderHeaderControls?: (right: HTMLElement, entityKey?: string) => void;
  emptyDescription?: string | null;
  columns?: string[];
  config?: DashConfigLike;
  skipHeader?: boolean;
}

/** Header-render options for `_renderPageHeader`. */
interface PageHeaderOptions {
  surfaceId?: string;
  configuredActions?: boolean;
}
type PageHeaderActionsFn = (right: HTMLElement, ctx: { surfaceId: string; configuredActionCount: number; hasConfiguredActions: boolean }) => void;

/** Daily-note sections as returned by parseSections() (src/notes.ts). */
interface DailySections {
  tasks: string[];
  journal: string;
}

/** Project metadata as returned by readProjectMeta() (src/project-notes.ts). */
interface ProjectMetaLike {
  milestones: MilestoneItem[];
  sections: Record<string, string>;
  done: number;
  total: number;
  percent: number;
  next?: MilestoneItem | null;
}
/** Milestone row as parsed/serialized by project-notes.ts. */
interface MilestoneItem {
  done: boolean;
  date?: Date | null;
  title: string;
  notes?: string;
}
/** Task row in a project's `## Tasks` section. */
interface ProjectTaskItem {
  done: boolean;
  title: string;
  id?: string;
}
/** Text-section descriptor consumed by `_renderProjectTextSection` (runtime
 * shape of `EntityDef.detailSections` items — `string[]` in types.ts; gap). */
interface ProjectTextSectionDef {
  key: string;
  label: string;
  rows?: number;
  placeholder?: string;
}

/** Where a task-completion propagation originated. */
interface TaskCompleteSource {
  kind?: 'project' | 'reminder' | 'daily' | (string & {});
  file?: obsidian.TFile;
  id?: string;
  date?: Date;
}

/** Item shape for the daily-task → project picker SuggestModal. */
interface ProjectPickItem {
  file?: obsidian.TFile;
  name: string;
  unlink?: boolean;
}

/** Inline-editable table cell / saved-badge DOM expandos. */
type EditableCellEl = HTMLTableCellElement & { _cadEditing?: boolean; _cadEditTimer?: ReturnType<typeof setTimeout> };
type SavedBadgeEl = HTMLSpanElement & { _t?: ReturnType<typeof setTimeout> };

/** Drag payload for the dashboard designer layout board. */
interface DesignerDragPos { rowIdx: number; colIdx: number; cardIdx: number }

/** Normalized kanban column produced by `_renderKanbanWidget`'s normalizeGroup. */
interface KanbanGroup {
  value: string;
  label: string;
  empty: string;
  description?: string;
  limit?: number | null;
  wipLimit?: number | null;
}
/** Authored kanban column spec: scalar shorthand or an object with ad-hoc keys. */
type KanbanGroupInput = string | number | Frontmatter | null;

/** One bar of the bar-chart widget (entity-grouped or provider-row backed). */
interface BarChartEntry {
  group: { value: string; label: string };
  /** Entities backing the bar; the click handler also probes a provider-row style `entityKey`. */
  items: (EntityRecord & { entityKey?: string })[];
  value: number;
  meta?: string;
}

/** Scalar value normalized for gauge/progress widgets. */
interface ScalarWidgetValue {
  value: number;
  max: number;
  percent: number;
  label: string;
  sub: string;
  suffix: string;
}

/** One date bucket in the streak heatmap widget. */
interface HeatmapBucket {
  date: Date;
  key: string;
  value: number;
}

/**
 * Runtime shape of `EntityDef.baseView` / `EntityDef.externalBaseView` as set
 * by parseBaseFile() (src/bases-parse.ts) — `{ type, name, basePath }`.
 * types.ts declares them as `string` (shared-type gap; see final report).
 */
interface BaseViewRef { type?: string; name?: string; basePath?: string }
/** Runtime shape of `EntityDef.baseGroupBy` (also `string` in types.ts — same gap). */
interface BaseGroupBySpec { property?: string; direction?: string }

/**
 * Supertype view of ProductivityTaskNote (src/task-notes.ts) used by the
 * notes widget — it reads `text`/`title`, which the snapshot rows never carry
 * (latent main.js carry-over; the fallback label always wins at runtime).
 */
interface ProductivityTaskRowLike {
  file?: obsidian.TFile;
  text?: string;
  title?: string;
  date?: string;
  done?: boolean;
}

/** Per-day planner column data. */
interface PlannerDay {
  date: Date;
  path: string;
  exists: boolean;
  file?: obsidian.TFile;
  tasks: string[];
}

export class CadenceAppView extends obsidian.ItemView {
  declare plugin: PluginHandle;
  /** Active surface id (route). */
  declare mode: string;
  declare todayFile: obsidian.TFile | null;
  declare todayParsed: DailySections | null;
  declare plannerAnchor: Date;
  declare detailFile: obsidian.TFile | null;
  declare detailEntityKey: string | null;
  declare canvasFile: obsidian.TFile | null;
  declare _canvasLeaf: obsidian.WorkspaceLeaf | null;
  declare mobileNavOpen: boolean;
  declare _navScrollTop: number;
  declare _renderSeq: number;
  declare _navEl: HTMLElement | undefined;
  declare _pinDragId: string | null;
  /** Selected sub-tab per parent surface id. */
  declare _secondaryTabState: Record<string, string> | undefined;
  /** Sort state per `${mode}::${entityKey}` table. */
  declare _tableSortState: Record<string, { key: string | null; dir: string }> | undefined;
  declare _columnFilterCleanup: (() => void) | null;
  declare _openHelpPanels: Set<string> | undefined;
  /** Client Work client/project selector state. */
  declare _clientWorkClientId: string | undefined;
  declare _clientWorkProjectId: string | undefined;
  /** Surface Designer state. */
  declare _dashEditorSurfaceId: string | undefined;
  declare _dashEditorDraft: DashConfigLike | undefined;
  declare _dashEditorMode: string | undefined;
  /** In-memory dashboard control state per surface id (mirrored to settings.dashboardState). */
  declare _dashboardState: Record<string, DashboardState> | undefined;
  /** Optional parsed-base cache cleared on metadata changes (set externally when present). */
  declare _basesCache: Map<string, unknown> | undefined;
  /**
   * NOTE: never assigned on this view — `renderExport()` reads it and passes
   * `undefined` to workbook helpers (latent bug carried over from main.js;
   * it almost certainly should be `this.plugin.settings`).
   */
  declare settings: BobSettings | undefined;
  constructor(leaf: obsidian.WorkspaceLeaf, plugin: CadencePlugin) {
    super(leaf);
    this.plugin = plugin;
    // Migrate older mode IDs from previous versions
    const raw = plugin.settings.defaultTab || 'planner.today';
    this.mode = this._migrateModeId(raw);
    // Today state
    this.todayFile = null;
    this.todayParsed = null;
    // Planner state
    this.plannerAnchor = startOfDay(new Date());
    // Detail-view state — when set, renders the entity form instead of the surface
    this.detailFile = null;
    this.detailEntityKey = null;
    // Full-page canvas state — when set, renders a .canvas embed instead of the surface
    this.canvasFile = null;
    // Ephemeral leaf hosting the live interactive canvas (detached on teardown)
    this._canvasLeaf = null;
    // Mobile nav drawer state (ephemeral, not persisted)
    this.mobileNavOpen = false;
    // Preserve left-nav scroll position across full re-renders.
    this._navScrollTop = 0;
    this._renderSeq = 0;
  }

  _toggleMobileNav(force?: boolean) {
    const root = this.containerEl.children[1];
    this.mobileNavOpen = (typeof force === 'boolean') ? force : !this.mobileNavOpen;
    if (root) root.toggleClass('cad-mobile-nav-open', this.mobileNavOpen);
  }

  async openEntityDetail(entityKey: string, file: obsidian.TFile) {
    if (!file || !entityKey) return;
    this.detailEntityKey = entityKey;
    this.detailFile = file;
    await this.render();
  }

  async openEntityDetailFromFile(file: obsidian.TFile, entityKey: string | null = null) {
    const key = entityKey || entityKeyFromFile(this.app, file);
    if (!key) {
      // Not a Cadence entity — fall back to opening the markdown
      this.app.workspace.openLinkText(file.path, '', false);
      return;
    }
    return this.openEntityDetail(key, file);
  }

  async closeEntityDetail() {
    this.detailFile = null;
    this.detailEntityKey = null;
    await this.render();
  }

  _migrateModeId(id: string) {
    if (id === 'today')   return 'planner.today';
    if (id === 'planner') return 'planner.calendar';
    if (id === 'srm.suppliers') return 'procurement.suppliers';
    if (id === 'finance.supplier-invoices') return 'procurement.supplier-invoices';
    // Built-in utility surfaces have route handlers but are not part of the
    // configured workspace.json nav, so they're absent from SURFACE_BY_ID.
    // Preserve them (opened via command palette) instead of falling back to home.
    if (id === 'misc.dashboard-editor' || id === 'misc.export' || id === 'misc.import') return id;
    return SURFACE_BY_ID[id] ? id : (SURFACE_BY_ID.home ? 'home' : (ALL_SURFACES[0]?.id || 'home'));
  }

  /* Toggle Cadence-app dark mode. Scoped to `.cadence-app` only —
     does not affect Obsidian's overall light/dark mode. Persisted in settings. */
  async _toggleCadenceDark() {
    this.plugin.settings.cadenceAppDark = !this.plugin.settings.cadenceAppDark;
    await this.plugin.saveSettings();
    this.render();
  }

  _visibleNavGroups() {
    const mods = this.plugin.settings.modules || { crm: true, 'client-work': true, prm: true, finance: true, procurement: true, planner: true, ai: true };
    const disabled = new Set(this.plugin.settings.disabledSurfaces || []);
    const showSecondary = !!this.plugin.settings.showSecondaryNav;
    const showSetup = !!this.plugin.settings.showSetupNav;
    return NAV_GROUPS
      .map((g: NavGroupLike) => {
        if (!Array.isArray(g.items)) return g; // separator group — pass through as-is
        if (g.module && mods[g.module] === false) return null;
        const items = g.items.filter((it) => {
          if (it.module && mods[it.module] === false) return false;
          if (disabled.has(it.id)) return false;
          if (it.placement === 'navigation') return true;
          if (WORKSPACE_HAS_NAVIGATION && isTabBackedSurface(it)) return false;
          if (it.navLevel === 'secondary' && !showSecondary) return false;
          if (it.navLevel === 'setup' && !showSetup) return false;
          return true;
        });
        if (!items.length) return null;
        return Object.assign({}, g, { items });
      })
      .filter(Boolean);
  }

  _pinnedNavSurfaceIds() {
    const pinned = this.plugin.settings.pinnedSurfaces || [];
    return pinned.filter((surfaceId, idx, arr) => surfaceId && SURFACE_BY_ID[surfaceId] && arr.indexOf(surfaceId) === idx);
  }

  async _togglePinnedNavSurface(surfaceId: string) {
    if (!surfaceId || !SURFACE_BY_ID[surfaceId]) return;
    const pinned = new Set(this.plugin.settings.pinnedSurfaces || []);
    if (pinned.has(surfaceId)) pinned.delete(surfaceId);
    else pinned.add(surfaceId);
    this.plugin.settings.pinnedSurfaces = Array.from(pinned);
    await this.plugin.saveSettings();
  }

  // Move a pinned surface to another pinned surface's position. Operates on the
  // raw (deduped) settings list so pins for surfaces not currently shown survive.
  _reorderPinnedSurface(draggedId: string, targetId: string) {
    const next = reorderPinnedList(this.plugin.settings.pinnedSurfaces, draggedId, targetId);
    if (!next) return false;
    this.plugin.settings.pinnedSurfaces = next;
    return true;
  }

  /* Link a daily-note task to a project. Keyed by (dailyPath, taskText). */
  _taskLinkKey(dailyPath: string, text: string) { return `${dailyPath}::${(text || '').trim()}`; }

  _getTaskProjectLink(dailyPath: string, text: string) {
    const map = (this.plugin.settings && this.plugin.settings.taskProjectLinks) || {};
    return map[this._taskLinkKey(dailyPath, text)] || null;
  }

  async _setTaskProjectLink(dailyPath: string, text: string, projectPath: string | null) {
    if (!this.plugin.settings.taskProjectLinks) this.plugin.settings.taskProjectLinks = {};
    const key = this._taskLinkKey(dailyPath, text);
    if (projectPath) {
      this.plugin.settings.taskProjectLinks[key] = projectPath;
    } else {
      delete this.plugin.settings.taskProjectLinks[key];
    }
    await this.plugin.saveSettings();
    this.render();
  }

  _openTaskProjectPicker(dailyPath: string, text: string, currentLink: string | null) {
    const projectFiles = listEntityFiles(this.app, 'project');
    if (!projectFiles.length) {
      new obsidian.Notice('No projects yet. Create one in Planner → Projects first.');
      return;
    }
    const view = this;
    const projects = projectFiles.map((f: obsidian.TFile) => ({
      file: f,
      name: projectNameFromPath(this.app, f.path),
    }));

    const picker = new (class extends obsidian.SuggestModal<ProjectPickItem> {
      declare projs: ProjectPickItem[];
      declare hasLink: boolean;
      constructor(app: obsidian.App, projs: ProjectPickItem[], hasLink: boolean) {
        super(app);
        this.projs = projs;
        this.hasLink = hasLink;
        this.setPlaceholder(hasLink ? 'Pick a project (or type "unlink" to remove)' : 'Pick a project to link this task to');
      }
      getSuggestions(query: string) {
        const q = (query || '').toLowerCase();
        const matches = this.projs.filter((p) => p.name.toLowerCase().includes(q));
        if (this.hasLink && (q === '' || 'unlink'.includes(q))) {
          return [{ unlink: true, name: '— Remove link —' }, ...matches];
        }
        return matches;
      }
      renderSuggestion(item: ProjectPickItem, el: HTMLElement) {
        if (item.unlink) {
          el.setText(item.name);
          el.style.color = 'var(--text-error, #c0392b)';
        } else {
          el.setText('📁  ' + item.name);
        }
      }
      onChooseSuggestion(item: ProjectPickItem) {
        if (item.unlink) view._setTaskProjectLink(dailyPath, text, null);
        else view._setTaskProjectLink(dailyPath, text, item.file.path);
      }
    })(this.app, projects, !!currentLink);
    picker.open();
  }

  _inboxOverdueCount() {
    const reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
    const now = Date.now();
    return reminders.filter((r) => r.when && new Date(r.when).getTime() <= now).length;
  }

  getViewType()    { return VIEW_TYPE_CADENCE_APP; }
  getDisplayText() { return 'BOB Workspace'; }
  getIcon()        { return 'sparkles'; }

  async setMode(m: string) {
    this.mode = this._migrateModeId(m);
    if (this.mode === 'client-work.overview') {
      // Land on the CONFIGURED first tab (workspace.json secondaryTabs), not a
      // hardcoded one, so this parent honors config like every other tab parent.
      const state = this._secondaryTabState || (this._secondaryTabState = {});
      const firstTab = this._tabsForParent('client-work.overview')[0];
      state['client-work.overview'] = firstTab ? (firstTab.entityKey || firstTab.route) : 'client-work.dashboard';
    }
    // Switching surfaces clears any open detail form / canvas
    this.detailFile = null;
    this.detailEntityKey = null;
    this.canvasFile = null;
    await this.render();
  }

  async toggleGroup(groupId: string) {
    const collapsed = this.plugin.settings.collapsedGroups || {};
    collapsed[groupId] = !collapsed[groupId];
    this.plugin.settings.collapsedGroups = collapsed;
    await this.plugin.saveSettings();
    await this.render();
  }

  async onOpen() {
    this.containerEl.children[1].empty();
    await this.render();

    this.registerEvent(this.app.vault.on('modify', (file) => {
      // Skip refresh while the user is editing this exact file in detail view —
      // re-rendering would steal focus from inputs they're still typing in.
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      // A hosted canvas saves on every edit; re-rendering would tear it down.
      if (this.canvasFile) return;
      if (this.mode === 'planner.today' && this.todayFile && file.path === this.todayFile.path) {
        return this.render();
      }
      if (this.mode === 'planner.calendar') {
        const days = weekDates(this.plannerAnchor, this.plugin.settings.weekStartsOn);
        const paths = days.map((d) => dailyNotePath(this.plugin.settings, d));
        if (paths.includes(file.path)) return this.render();
      }
      if (this._modeUsesEntityFolder(file.path)) return this.render();
    }));

    const entityRefresh = (file: obsidian.TAbstractFile) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this.canvasFile) return;
      if (this._modeUsesEntityFolder(file && file.path)) this.render();
    };
    this.registerEvent(this.app.vault.on('create', entityRefresh));
    this.registerEvent(this.app.vault.on('delete', entityRefresh));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this.canvasFile) return;
      if (this._modeUsesEntityFolder(file && file.path) || this._modeUsesEntityFolder(oldPath)) this.render();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (this._basesCache) this._basesCache.clear();
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this.canvasFile) return;
      if (this._modeUsesEntityFolder(file && file.path)) this.render();
    }));
  }

  _modeUsesEntityFolder(path: string | null | undefined) {
    if (!path) return false;
    // Entity surfaces can now show secondary tabs backed by folders outside
    // the old Cadence/* tree, so refresh if the touched path belongs to any
    // configured entity folder.
    return Object.keys(ENTITIES).some((key) => {
      const folder = entityFolder(key);
      return folder && (path === folder || path.startsWith(folder + '/'));
    });
  }

  // Dispose any open column-filter menu (appended to document.body with a
  // document click listener) — otherwise a re-render or view close orphans it.
  _closeColumnFilterMenu() {
    if (this._columnFilterCleanup) this._columnFilterCleanup();
  }

  async render() {
    this._closeColumnFilterMenu();
    this._teardownCanvasLeaf();
    const root = this.containerEl.children[1];
    const previousNav = root.querySelector ? root.querySelector('.cad-app-nav') : null;
    const previousNavScrollTop = previousNav ? previousNav.scrollTop : (this._navScrollTop || 0);
    const renderSeq = ++this._renderSeq;
    root.empty();
    root.addClass('cadence-app');
    root.toggleClass('cad-dark', !!this.plugin.settings.cadenceAppDark);

    if (!SURFACE_BY_ID[this.mode]) this.mode = this._migrateModeId(this.mode);
    const active = SURFACE_BY_ID[this.mode] || SURFACE_BY_ID.home || ALL_SURFACES[0] || {
      id: 'home', label: 'Workspace', icon: 'layout-dashboard', desc: 'No configured surfaces.',
    };
    const activeParentId = active?.parent || null;

    /* ── Top brand bar ──────────────────────── */
    const topbar = root.createDiv({ cls: 'cad-app-topbar' });

    /* Hamburger — visible only on mobile via CSS, toggles the nav drawer */
    const burger = topbar.createEl('button', { cls: 'cad-mobile-burger' });
    try { obsidian.setIcon(burger, 'menu'); } catch (_) {}
    burger.title = 'Show nav';
    burger.addEventListener('click', () => this._toggleMobileNav());

    const brand = topbar.createDiv({ cls: 'cad-app-brand' });
    brand.createSpan({ cls: 'cad-app-brand-mark', text: '◐' });
    brand.createSpan({ cls: 'cad-app-brand-text', text: 'BOB Workspace' });

    const topRight = topbar.createDiv({ cls: 'cad-app-topbar-right' });

    /* BOB Workspace dark mode toggle (scoped — does NOT touch Obsidian's mode) */
    const dark = !!this.plugin.settings.cadenceAppDark;
    const themeBtn = topRight.createEl('button', { cls: 'cad-topbar-icon-btn' });
    try { obsidian.setIcon(themeBtn, dark ? 'sun' : 'moon'); } catch (_) {}
    themeBtn.title = dark ? 'BOB Workspace: switch to light' : 'BOB Workspace: switch to dark';
    themeBtn.addEventListener('click', () => this._toggleCadenceDark());

    const eyebrow = topRight.createDiv({ cls: 'cad-app-topbar-meta' });
    eyebrow.setText(active.label.toUpperCase());

    /* ── Body: left grouped nav + main content ──────── */
    const body = root.createDiv({ cls: 'cad-app-body' });

    /* Backdrop — only visible on mobile when drawer is open; tapping dismisses. */
    const backdrop = body.createDiv({ cls: 'cad-mobile-backdrop' });
    backdrop.addEventListener('click', () => this._toggleMobileNav(false));

    const nav = body.createDiv({ cls: 'cad-app-nav' });
    this._navScrollTop = previousNavScrollTop;
    const collapsed = this.plugin.settings.collapsedGroups || {};
    const pinnedIds = this._pinnedNavSurfaceIds();
    const pinnedSet = new Set(pinnedIds);

    if (pinnedIds.length) {
      const pinnedWrap = nav.createDiv({ cls: 'cad-nav-pinned' });
      const pinnedRow = pinnedWrap.createDiv({ cls: 'cad-nav-pinned-row' });
      pinnedIds.forEach((surfaceId) => {
        const surface = SURFACE_BY_ID[surfaceId];
        const pinWrap = pinnedRow.createDiv({ cls: 'cad-nav-pinned-item-wrap' });
        const pin = pinWrap.createEl('button', {
          cls: 'cad-nav-pinned-item' + (this.mode === surfaceId ? ' active' : ''),
          attr: { type: 'button' },
        });
        pin.title = surface.label;
        const ic = pin.createSpan({ cls: 'cad-nav-pinned-icon' });
        try { obsidian.setIcon(ic, surface.icon); } catch (_) {}
        pin.addEventListener('click', () => {
          this.setMode(surfaceId);
          if (this.mobileNavOpen) this._toggleMobileNav(false);
        });
        const remove = pinWrap.createEl('button', {
          cls: 'cad-nav-pinned-remove',
          attr: { type: 'button', 'aria-label': `Unpin ${surface.label}` },
        });
        remove.title = `Unpin ${surface.label}`;
        remove.draggable = false;
        try { obsidian.setIcon(remove, 'pin-off'); } catch (_) {}
        remove.addEventListener('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await this._togglePinnedNavSurface(surfaceId);
          await this.render();
        });

        // Drag to reorder pins.
        pinWrap.draggable = true;
        pinWrap.addEventListener('dragstart', (ev) => {
          this._pinDragId = surfaceId;
          pinWrap.addClass('dragging');
          try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', surfaceId); } catch (_) {}
        });
        pinWrap.addEventListener('dragend', () => {
          this._pinDragId = null;
          pinWrap.removeClass('dragging');
          pinnedRow.findAll('.drag-over').forEach((el) => el.removeClass('drag-over'));
        });
        pinWrap.addEventListener('dragover', (ev) => {
          if (!this._pinDragId || this._pinDragId === surfaceId) return;
          ev.preventDefault();
          try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
          pinWrap.addClass('drag-over');
        });
        pinWrap.addEventListener('dragleave', () => pinWrap.removeClass('drag-over'));
        pinWrap.addEventListener('drop', async (ev) => {
          ev.preventDefault();
          pinWrap.removeClass('drag-over');
          const dragged = this._pinDragId || (ev.dataTransfer && ev.dataTransfer.getData('text/plain'));
          this._pinDragId = null;
          if (dragged && dragged !== surfaceId && this._reorderPinnedSurface(dragged, surfaceId)) {
            await this.plugin.saveSettings();
            await this.render();
          }
        });
      });
    }

    const visibleGroups = this._visibleNavGroups();
    visibleGroups.forEach((group) => {
      if (!Array.isArray(group.items)) { nav.createEl('hr', { cls: 'cad-nav-separator' }); return; }
      const groupEl = nav.createDiv({ cls: 'cad-nav-group' });
      const isCollapsed = !!collapsed[group.id];

      if (group.label) {
        const head = groupEl.createDiv({ cls: 'cad-nav-group-head' });
        const chev = head.createSpan({ cls: 'cad-nav-group-chev' });
        try { obsidian.setIcon(chev, isCollapsed ? 'chevron-right' : 'chevron-down'); } catch (_) {}
        if (group.icon) {
          const groupIcon = head.createSpan({ cls: 'cad-nav-group-icon' });
          try { obsidian.setIcon(groupIcon, group.icon); } catch (_) {}
        }
        head.createSpan({ cls: 'cad-nav-group-label', text: group.label.toUpperCase() });
        head.addEventListener('click', () => this.toggleGroup(group.id));
      }

      if (!isCollapsed || !group.label) {
        const list = groupEl.createDiv({ cls: 'cad-nav-group-items' });
        group.items.forEach((s) => {
          const isActive = this.mode === s.id;
          const isActiveParent = activeParentId === s.id;
          const item = list.createDiv({
            cls: 'cad-app-nav-item' + (isActive ? ' active' : '') + (isActiveParent ? ' active-parent' : ''),
          });
          if (isActive) item.setAttribute('aria-current', 'page');
          const ic = item.createSpan({ cls: 'cad-app-nav-icon' });
          try { obsidian.setIcon(ic, s.icon); } catch (_) {}
          item.createSpan({ cls: 'cad-app-nav-label', text: s.label });
          if (!BUILT_SURFACES.has(s.id) && !s.entityKey) {
            item.createSpan({ cls: 'cad-app-nav-badge', text: 'soon' });
          }
          const isPinned = pinnedSet.has(s.id);
          const pinBtn = item.createEl('button', {
            cls: 'cad-nav-pin-toggle' + (isPinned ? ' is-pinned' : ''),
            attr: { type: 'button' },
          });
          pinBtn.title = isPinned ? `Unpin ${s.label}` : `Pin ${s.label}`;
          try { obsidian.setIcon(pinBtn, isPinned ? 'pin' : 'pin-off'); } catch (_) {}
          pinBtn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await this._togglePinnedNavSurface(s.id);
            await this.render();
          });
          // Inbox: badge with overdue count
          if (s.id === 'planner.inbox') {
            const overdue = this._inboxOverdueCount();
            if (overdue > 0) item.createSpan({ cls: 'cad-app-nav-badge cad-nav-badge-alert', text: String(overdue) });
          }
          item.addEventListener('click', () => {
            this.setMode(s.id);
            // On mobile, picking a nav item closes the drawer.
            if (this.mobileNavOpen) this._toggleMobileNav(false);
          });
        });
      }
    });

    this._navEl = nav;
    const restoreNavScroll = () => {
      if (this._renderSeq !== renderSeq) return;
      if (this._navEl !== nav) return;
      nav.scrollTop = this._navScrollTop || 0;
    };
    restoreNavScroll();
    requestAnimationFrame(restoreNavScroll);

    const content = body.createDiv({ cls: 'cad-app-content' });

    // Detail view trumps the normal surface routing
    if (this.detailFile && this.detailEntityKey) {
      await this.renderEntityDetail(content, this.detailEntityKey, this.detailFile);
      return;
    }

    // Full-page canvas render trumps surface routing too
    if (this.canvasFile) {
      await this.renderCanvasSurface(content, this.canvasFile);
      return;
    }

    // planner.today renders its configured dashboard when workspace.json defines
    // one; otherwise it falls through to the route map's today-diary pane.
    const configuredDashboard = resolveSurfaceConfig(this.mode);
    if (configuredDashboard) {
      await this.renderConfigDashboard(this.mode, content, { config: configuredDashboard });
      return;
    }

    const route: Record<string, () => void | Promise<void>> = {
      'home': () => this.renderHome(content),
      'planner.inbox': () => this.renderInbox(content),
      'planner.today': () => this.renderTodayPane(content),
      'planner.calendar': () => this.renderPlannerPane(content),
      'planner.projects': () => this.renderProjectsView(content),
      'crm.dashboard': () => this.renderConfigDashboard('crm.dashboard', content),
      'crm.pipeline': () => this.renderConfigDashboard('crm.pipeline', content),
      'prm.analytics': () => this.renderPRMAnalytics(content),
      'reports.pipeline': () => this.renderConfigDashboard('reports.pipeline', content),
      'reports.sales': () => this.renderConfigDashboard('reports.sales', content),
      'reports.partners': () => this.renderConfigDashboard('reports.partners', content),
      'reports.activity': () => this.renderConfigDashboard('reports.activity', content),
      'reports.productivity': () => this.renderProductivity(content),
      'team': () => this.renderTeam(content),
      'settings': () => this.openSettingsTab(content),
      'misc.dashboard-editor': () => this.renderDashboardEditor(content),
      'misc.canvases': () => this.renderCanvasLibrary(content),
      'misc.export': () => this.renderExport(content),
      'misc.import': () => this.renderImport(content),
      'client-work.overview': () => this.renderClientWorkWorkspace(content),
    };
    if (route[this.mode]) {
      await route[this.mode]();
    } else if (SECONDARY_TABS[this.mode]?.length) {
      const firstTab = this._tabsForParent(this.mode)[0] || ({} as SecondaryTabLike);
      await this.renderEntityTabs(content, this.mode, firstTab.entityKey || firstTab.route);
    } else if (active && active.entityKey && ENTITIES[active.entityKey]) {
      await this.renderEntityList(content, active.entityKey);
    } else {
      this.renderComingSoon(content, active);
    }
  }

  renderComingSoon(root: HTMLElement, surface: Partial<NavSurfaceLike>) {
    root.addClass('cadence-soon');
    const wrap = root.createDiv({ cls: 'cad-soon-wrap' });
    wrap.createDiv({ cls: 'cad-eyebrow', text: 'COMING SOON' });
    wrap.createDiv({ cls: 'cad-soon-title', text: surface.label });
    wrap.createDiv({ cls: 'cad-soon-desc', text: surface.desc });

    const ic = wrap.createDiv({ cls: 'cad-soon-icon' });
    try { obsidian.setIcon(ic, surface.icon); } catch (_) {}

    const meta = wrap.createDiv({ cls: 'cad-soon-meta' });
    meta.setText('This surface is scaffolded but not yet built. Tell the team to flesh it out next.');
  }

  /* ── Canvas (Obsidian .canvas) surfaces ────────────────── */

  // Every .canvas file in the vault (excluding template folders), newest first.
  _scanCanvasFiles(): obsidian.TFile[] {
    return this.app.vault.getFiles()
      .filter((f) => f.extension === 'canvas' && !isTemplatePath(f.path))
      .sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0));
  }

  // Open a canvas full-page inside the BOB shell (viewer; edit via "Pop out").
  async openCanvas(file: obsidian.TFile) {
    if (!file) return;
    this.detailFile = null;
    this.detailEntityKey = null;
    this.canvasFile = file;
    await this.render();
  }

  // #2 — the canvas library: every canvas is reachable from BOB.
  renderCanvasLibrary(root: HTMLElement) {
    const files = this._scanCanvasFiles();
    this._renderPageHeader(root, 'Canvases',
      `${files.length} ${files.length === 1 ? 'canvas' : 'canvases'} in the vault · open full-page or in a tab`,
      (right) => {
        const gen = right.createEl('button', { cls: 'cad-btn cad-btn-small', text: '+ Generate' });
        gen.addEventListener('click', (e) => this._openCanvasGenerateMenu(e));
      }, { configuredActions: false });
    if (!files.length) {
      const card = root.createDiv({ cls: 'cad-dash-card' });
      card.createDiv({ cls: 'cad-dash-card-body' })
        .createDiv({ cls: 'cad-empty', text: 'No canvases yet. Create one in Obsidian (New canvas) and it will appear here.' });
      return;
    }
    const wrap = root.createDiv({ cls: 'cad-canvas-library' });
    const search = wrap.createEl('input', { cls: 'cad-canvas-search', type: 'search', placeholder: 'Search canvases…' });
    const list = wrap.createDiv({ cls: 'cad-canvas-list' });
    const draw = (q: string) => {
      list.empty();
      const needle = String(q || '').trim().toLowerCase();
      const shown = needle ? files.filter((f) => f.path.toLowerCase().includes(needle)) : files;
      if (!shown.length) { list.createDiv({ cls: 'cad-empty', text: 'No canvases match.' }); return; }
      shown.forEach((f) => this._renderCanvasRow(list, f));
    };
    search.addEventListener('input', () => draw(search.value));
    draw('');
  }

  // Phase 2 — generate a canvas from vault data, then open it inline.
  _openCanvasGenerateMenu(evt: MouseEvent) {
    const menu = new obsidian.Menu();
    for (const gen of CANVAS_GENERATORS) {
      menu.addItem((item) => item.setTitle(gen.label).setIcon(gen.icon).onClick(() => void this._generateCanvas(gen.id)));
    }
    menu.showAtMouseEvent(evt);
  }

  async _generateCanvas(generatorId: string) {
    const gen = CANVAS_GENERATORS.find((g) => g.id === generatorId);
    if (!gen) return;
    let data = null;
    try { data = gen.build(this.app); } catch (err) {
      new obsidian.Notice(`Canvas generation failed: ${(err as Error)?.message || String(err)}`);
      return;
    }
    if (!data || !data.nodes.length) {
      new obsidian.Notice('Nothing to generate — no matching records found.');
      return;
    }
    await this._writeGeneratedCanvas(gen.label.split(' (')[0], data, this._boardManifest(gen.id, data));
  }

  // Manifest for the schematic generators (board / runway) — enough to drive
  // manual-edit preservation on regeneration.
  _boardManifest(template: string, data: CanvasData): CanvasManifest {
    return {
      source_path: '', source_type: 'board', template,
      generated_at: new Date().toISOString(),
      query_hash: String(data.nodes.length),
      bob_owned_node_ids: ownedIdsOf(data),
    };
  }

  // Single writer for every generated canvas. Regenerate-fresh, but merged over
  // an existing file so hand-added nodes/edges survive: BOB owns only the ids
  // recorded in the sidecar manifest. Opens the result inline.
  async _writeGeneratedCanvas(rawName: string, data: CanvasData, manifest: CanvasManifest) {
    const folder = 'BOB Workspace/Canvases';
    await ensureFolderSync(this.app, folder);
    const name = rawName.replace(/[\\/:*?"<>|]/g, '-');
    const canvasPath = `${folder}/${name}.canvas`;
    const metaPath = `${folder}/${name}.canvas.bobmeta.json`;
    let out = data;
    const existing = this.app.vault.getAbstractFileByPath(canvasPath);
    if (existing instanceof obsidian.TFile) {
      try {
        const oldData = JSON.parse(await this.app.vault.read(existing)) as CanvasData;
        let oldOwned: string[] = [];
        const mf = this.app.vault.getAbstractFileByPath(metaPath);
        if (mf instanceof obsidian.TFile) {
          try { oldOwned = (JSON.parse(await this.app.vault.read(mf)) as CanvasManifest).bob_owned_node_ids || []; } catch (_) { /* ignore */ }
        }
        out = mergeGeneratedCanvas(oldData, oldOwned, data);
      } catch (_) { out = data; }
    }
    await this._writeOrModify(canvasPath, serializeCanvas(out));
    await this._writeOrModify(metaPath, JSON.stringify(manifest, null, 2));
    const f = this.app.vault.getAbstractFileByPath(canvasPath);
    if (f instanceof obsidian.TFile) await this.openCanvas(f);
    else new obsidian.Notice(`Canvas written to ${canvasPath}`);
  }

  // Entity Context Canvas — render the full operational context around a note
  // (evidence · people/systems · outputs · risks) and open it inline. Written to
  // a stable path; regeneration refreshes BOB's nodes while preserving any nodes
  // the user added by hand (see _writeGeneratedCanvas).
  async _generateContextCanvas(file: obsidian.TFile) {
    if (!(file instanceof obsidian.TFile)) { new obsidian.Notice('No note to build context from.'); return; }
    // Agent-run notes (ai-session-log / agent signals) get the Agent Audit
    // surface; everything else gets the Entity Context surface.
    const isAgentRun = isAgentRunFile(this.app, file);
    let result = null;
    try {
      result = isAgentRun ? buildAgentAuditCanvas(this.app, file) : buildEntityContextCanvas(this.app, file);
    } catch (err) {
      new obsidian.Notice(`Context canvas failed: ${(err as Error)?.message || String(err)}`);
      return;
    }
    if (!result || !result.data.nodes.length) { new obsidian.Notice('No context to render for this note.'); return; }
    const prefix = isAgentRun ? 'Agent audit' : 'Context';
    await this._writeGeneratedCanvas(`${prefix} - ${file.basename}`, result.data, result.manifest);
  }

  // Process Execution Canvas — render an entity type's lifecycle as a left-to-
  // right runway (records by stage, blockers flagged), opened inline.
  async _generateProcessCanvas(entityKey: string) {
    const def = ENTITIES[entityKey];
    if (!def) return;
    let data = null;
    try { data = buildProcessCanvas(this.app, entityKey); } catch (err) {
      new obsidian.Notice(`Process canvas failed: ${(err as Error)?.message || String(err)}`);
      return;
    }
    if (!data || !data.nodes.length) { new obsidian.Notice('This type has no stage/status lifecycle to render.'); return; }
    await this._writeGeneratedCanvas(`Process - ${def.plural}`, data, this._boardManifest('process-runway', data));
  }

  async _writeOrModify(path: string, content: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof obsidian.TFile) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(path, content);
  }

  _renderCanvasRow(list: HTMLElement, file: obsidian.TFile) {
    const row = list.createDiv({ cls: 'cad-canvas-row' });
    const icon = row.createDiv({ cls: 'cad-canvas-row-icon' });
    try { obsidian.setIcon(icon, 'layout-dashboard'); } catch (_) {}
    const main = row.createDiv({ cls: 'cad-canvas-row-main' });
    main.createDiv({ cls: 'cad-canvas-row-name', text: file.basename });
    const folder = file.parent?.path && file.parent.path !== '/' ? file.parent.path : '';
    const modified = file.stat?.mtime ? new Date(file.stat.mtime).toISOString().slice(0, 10) : '';
    main.createDiv({ cls: 'cad-canvas-row-meta', text: [folder, modified ? `modified ${modified}` : ''].filter(Boolean).join(' · ') });
    row.addEventListener('click', () => { void this.openCanvas(file); });
    const actions = row.createDiv({ cls: 'cad-canvas-row-actions' });
    const openBtn = actions.createEl('button', { cls: 'cad-btn cad-btn-small', text: 'Open' });
    openBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.openCanvas(file); });
    const tabBtn = actions.createEl('button', { cls: 'cad-btn cad-btn-small cad-btn-ghost', text: 'Open in tab' });
    tabBtn.addEventListener('click', (e) => { e.stopPropagation(); this.app.workspace.openLinkText(file.path, '', true); });
  }

  // #1 — full-page canvas render inside the BOB shell.
  async renderCanvasSurface(root: HTMLElement, file: obsidian.TFile) {
    const folder = file.parent?.path && file.parent.path !== '/' ? file.parent.path : 'Canvas';
    this._renderPageHeader(root, file.basename, folder, (right) => {
      const back = right.createEl('button', { cls: 'cad-btn cad-btn-small cad-btn-ghost', text: '← Canvases' });
      back.addEventListener('click', () => { void this.setMode('misc.canvases'); });
      const edit = right.createEl('button', { cls: 'cad-btn cad-btn-small', text: 'Pop out to edit' });
      edit.addEventListener('click', () => { this.app.workspace.openLinkText(file.path, '', true); });
    }, { configuredActions: false });
    const stage = root.createDiv({ cls: 'cad-canvas-stage' });
    try {
      await this._mountLiveCanvas(stage, file);
    } catch (err) {
      stage.empty();
      const fb = stage.createDiv({ cls: 'cad-canvas-fallback' });
      fb.createDiv({ cls: 'cad-soon-desc', text: `Couldn't render this canvas inline (${(err as Error)?.message || String(err)}).` });
      const open = fb.createEl('button', { cls: 'cad-btn', text: 'Open canvas in Obsidian' });
      open.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', true));
    }
  }

  // Host Obsidian's REAL interactive CanvasView inside the BOB pane: create an
  // ephemeral leaf, load the canvas into it, and reparent its DOM. The embed
  // registry only yields a static click-to-open preview (colored boxes), so we
  // host the actual view instead. This uses unofficial internals (the
  // WorkspaceLeaf constructor + setViewState), so it is fully guarded — on any
  // failure we detach and throw, and the caller shows the open-in-tab fallback.
  async _mountLiveCanvas(body: HTMLElement, file: obsidian.TFile) {
    this._teardownCanvasLeaf();
    const WorkspaceLeafCtor = (obsidian as unknown as {
      WorkspaceLeaf?: new (app: obsidian.App) => obsidian.WorkspaceLeaf;
    }).WorkspaceLeaf;
    if (typeof WorkspaceLeafCtor !== 'function') throw new Error('WorkspaceLeaf constructor unavailable');
    let leaf: obsidian.WorkspaceLeaf | null = null;
    try {
      leaf = new WorkspaceLeafCtor(this.app);
      await leaf.setViewState({ type: 'canvas', state: { file: file.path }, active: false });
      const view = leaf.view as (obsidian.View & {
        canvas?: { requestFrame?: () => void; zoomToFit?: () => void };
        onResize?: () => void;
      }) | undefined;
      const viewEl = view?.containerEl || (leaf as unknown as { containerEl?: HTMLElement }).containerEl;
      if (!viewEl) throw new Error('canvas view element not found');
      body.addClass('cad-canvas-stage-live');
      body.appendChild(viewEl);
      this._canvasLeaf = leaf;
      // The canvas must relayout inside its new parent; kick it once the DOM settles.
      window.setTimeout(() => {
        try { view?.onResize?.(); view?.canvas?.requestFrame?.(); view?.canvas?.zoomToFit?.(); } catch (_) { /* best effort */ }
      }, 60);
    } catch (err) {
      if (leaf) { try { leaf.detach(); } catch (_) { /* ignore */ } }
      this._canvasLeaf = null;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  // Detach the ephemeral canvas leaf (idempotent). Called on every re-render,
  // navigation, and view close so the hosted CanvasView never leaks.
  _teardownCanvasLeaf() {
    if (!this._canvasLeaf) return;
    try { this._canvasLeaf.detach(); } catch (_) { /* ignore */ }
    this._canvasLeaf = null;
  }

  /* ── Generic page header ────────────────── */
  _renderPageHeader(root: HTMLElement, title: string, subtitle: string | null, actions?: PageHeaderActionsFn | null, options: PageHeaderOptions = {}) {
    const head = root.createDiv({ cls: 'cad-page-header' });
    const left = head.createDiv({ cls: 'cad-page-header-left' });
    left.createDiv({ cls: 'cad-eyebrow', text: 'BOB WORKSPACE' });
    left.createDiv({ cls: 'cad-page-title', text: title });
    if (subtitle) left.createDiv({ cls: 'cad-page-subtitle', text: subtitle });
    const right = head.createDiv({ cls: 'cad-page-header-right' });
    const surfaceId = options.surfaceId || this.mode;
    const renderConfigured = options.configuredActions !== false;
    const configuredActionCount = renderConfigured ? this._configuredHeaderActionCount(surfaceId) : 0;
    const ctx = { surfaceId, configuredActionCount, hasConfiguredActions: configuredActionCount > 0 };
    if (typeof actions === 'function') actions(right, ctx);
    if (renderConfigured) this._renderConfiguredHeaderActions(right, surfaceId);
    return head;
  }

  _configuredHeaderActionCount(surfaceId: string) {
    return (configuredSurfaceActions(surfaceId) as ActionInput[]).filter((action) => this._isConfiguredHeaderActionRenderable(action)).length;
  }

  _isConfiguredHeaderActionRenderable(action: ActionInput) {
    if (!action || typeof action !== 'object') return false;
    if (action.entityKey) return workspaceHasEntity(action.entityKey) && !!ENTITIES[action.entityKey]?.label;
    const actionId = String(action.action || '').trim();
    const route = String(action.route || '').trim();
    return actionId === 'quick-capture' || actionId === 'today-task' || !!(route && SURFACE_BY_ID[route]);
  }

  _renderConfiguredHeaderActions(container: HTMLElement, surfaceId: string) {
    let rendered = 0;
    (configuredSurfaceActions(surfaceId) as ActionSpec[]).forEach((action) => {
      if (!this._isConfiguredHeaderActionRenderable(action)) return;
      if (action.entityKey) {
        const def = ENTITIES[action.entityKey];
        const btn = container.createEl('button', {
          cls: `cad-btn${action.primary ? ' primary' : ''}`,
          text: action.label || `+ ${def.label}`,
        });
        btn.addEventListener('click', () => this._createEntityFromPrompt(action.entityKey));
        rendered++;
        return;
      }

      const actionId = String(action.action || '').trim();
      const route = String(action.route || '').trim();
      const label = action.label || (
        actionId === 'quick-capture' ? '+ Inbox' :
        actionId === 'today-task' ? '+ Task' :
        route && SURFACE_BY_ID[route] ? SURFACE_BY_ID[route].label :
        ''
      );
      if (!label) return;
      const btn = container.createEl('button', {
        cls: `cad-btn${action.primary ? ' primary' : ''}`,
        text: label,
      });
      btn.addEventListener('click', () => {
        if (actionId === 'quick-capture') this.plugin.openQuickCapture();
        else if (actionId === 'today-task') this._quickAddTodayTask();
        else if (route && SURFACE_BY_ID[route]) this.setMode(route);
      });
      rendered++;
    });
    return rendered;
  }

  _renderEntityViewSelect(container: HTMLElement, entityKey: string) {
    const basePath = entityBasePath(this.plugin.settings, entityKey);
    if (!basePath) return;

    const select = container.createEl('select', {
      cls: 'dropdown cad-page-view-select',
      attr: { 'aria-label': 'Base view' },
    });
    select.title = 'Base view';
    select.createEl('option', { value: '', text: 'Loading views...' });
    select.disabled = true;

    const currentView = entityBaseViewName(this.plugin.settings, entityKey);
    const baseFile = this.app.vault.getAbstractFileByPath(basePath);
    if (!(baseFile instanceof obsidian.TFile)) {
      select.empty();
      select.createEl('option', { value: '', text: 'Base not found' });
      return;
    }

    readBaseSummary(this.app, baseFile).then((summary) => {
      const views = summary?.views || [];
      if (!views.length) {
        select.remove();
        return;
      }
      select.empty();
      select.createEl('option', { value: '', text: 'All properties' });
      views.forEach((viewName: string) => {
        select.createEl('option', { value: viewName, text: viewName });
      });
      select.value = views.includes(currentView) ? currentView : '';
      select.disabled = false;
    });

    select.addEventListener('change', async () => {
      const viewName = select.value;
      if (!this.plugin.settings.baseViews) this.plugin.settings.baseViews = {};
      if (viewName) this.plugin.settings.baseViews[entityKey] = viewName;
      else delete this.plugin.settings.baseViews[entityKey];
      await this.plugin.saveSettings();
      await reloadEntityConfiguration(this.app, this.plugin.settings);
      this.plugin.refreshOpenViews();
    });
  }

  async _openEntityBase(entityKey: string) {
    const basePath = entityBasePath(this.plugin.settings, entityKey) || (ENTITIES[entityKey]?.externalBaseView as BaseViewRef | undefined)?.basePath;
    if (!basePath) return;
    const viewName = entityBaseViewName(this.plugin.settings, entityKey) || (ENTITIES[entityKey]?.baseView as BaseViewRef | undefined)?.name || '';
    const baseFile = this.app.vault.getAbstractFileByPath(basePath);
    if (!(baseFile instanceof obsidian.TFile)) {
      new obsidian.Notice(`BOB Workspace: Base not found: ${basePath}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(baseFile, viewName ? { eState: { subpath: `#${viewName}` } } : {});
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  _renderExternalBaseView(root: HTMLElement, entityKey: string) {
    const def = ENTITIES[entityKey];
    const external = def?.externalBaseView as BaseViewRef | undefined;
    if (!external) return false;
    // A non-table view (board/calendar/cards) has no plugin-native editable
    // equivalent, but Obsidian can render it inline via an `![[base#view]]`
    // embed — the same mechanism the base-view widget uses. Mount it live here
    // (read-only, native Bases UI) instead of a dead placeholder; the page
    // header already carries an "Open Base" action for the full-screen version.
    // Fall back to a short note if the embed can't mount.
    const wrap = root.createDiv({ cls: 'cad-external-base-view' });
    const body = wrap.createDiv({ cls: 'cad-external-base-view-body' });
    const file = external.basePath ? this.app.vault.getAbstractFileByPath(external.basePath) : null;
    if (file instanceof obsidian.TFile) {
      void this._mountLiveBaseView(body, file, external.basePath, external.name || '').catch(() => {
        body.empty();
        const fb = body.createDiv({ cls: 'cad-empty-state' });
        fb.createDiv({ cls: 'cad-empty-state-title', text: external.name || 'Base view' });
        fb.createDiv({ cls: 'cad-empty-state-desc', text: `This ${external.type || 'non-table'} view couldn't be embedded here — use “Open Base” above to view it in Obsidian Bases.` });
        const btn = fb.createEl('button', { cls: 'cad-btn primary', text: 'Open in Base' });
        btn.addEventListener('click', () => this._openEntityBase(entityKey));
      });
    } else {
      const fb = body.createDiv({ cls: 'cad-empty-state' });
      fb.createDiv({ cls: 'cad-empty-state-title', text: external.name || 'Base view' });
      fb.createDiv({ cls: 'cad-empty-state-desc', text: external.basePath ? `Base file not found: ${external.basePath}` : 'No Base file configured for this view.' });
      const btn = fb.createEl('button', { cls: 'cad-btn primary', text: 'Open in Base' });
      btn.addEventListener('click', () => this._openEntityBase(entityKey));
    }
    return true;
  }

  _renderUnsupportedBaseFilters(root: HTMLElement, def: EntityDef) {
    const unsupported = def?.unsupportedBaseFilters || [];
    if (!unsupported.length) return;
    const details = root.createEl('details', { cls: 'cad-base-filter-warnings' });
    details.createEl('summary', { text: `${unsupported.length} Base filter${unsupported.length === 1 ? '' : 's'} not applied` });
    const list = details.createEl('ul');
    unsupported.forEach((filter: string) => {
      list.createEl('li').createEl('code', { text: filter });
    });
  }

  _groupEntitiesForView(entities: EntityRecord[], def: EntityDef) {
    const groupBy = def?.baseGroupBy as BaseGroupBySpec | undefined;
    if (!groupBy?.property) return null;
    const groups = new Map();
    entities.forEach((entity) => {
      const raw = entityValue(entity, groupBy.property, def);
      const values = Array.isArray(raw) ? raw : [raw];
      const nonEmpty = values.map((v) => String(v ?? '').trim()).filter(Boolean);
      const keys = nonEmpty.length ? nonEmpty : ['(blank)'];
      keys.forEach((key) => {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entity);
      });
    });
    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
    if (groupBy.direction === 'DESC') sorted.reverse();
    return sorted;
  }

  _renderEntityTable(root: HTMLElement, entities: EntityRecord[], entityKey: string, cols: EntityField[]) {
    const def = ENTITIES[entityKey];
    const selected = new Set<string>(); // selected file paths

    const bulkBar = root.createDiv({ cls: 'cad-bulk-bar cad-bulk-bar-hidden' });
    const bulkCount = bulkBar.createSpan({ cls: 'cad-bulk-count' });
    const bulkDelete = bulkBar.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete selected' });
    bulkDelete.addEventListener('click', async () => {
      // Resolve all files before any deletion so paths can't shift mid-loop
      const filesToDelete = [...selected]
        .map((path) => this.app.vault.getAbstractFileByPath(path) as obsidian.TFile)
        .filter(Boolean);
      if (!filesToDelete.length) return;
      const names = filesToDelete.map((f) => f.basename).join('\n• ');
      if (!(await confirmModal(this.app, `Move to trash:\n• ${names}\n\n${filesToDelete.length} ${filesToDelete.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} will be deleted.`, { title: 'Delete files', cta: 'Move to trash' }))) return;
      for (const file of filesToDelete) {
        try { await this.app.vault.trash(file, true); } catch (e) { new obsidian.Notice(`Delete failed for ${file.basename}: ${e.message}`); }
      }
      await this.render();
    });

    const updateBulkBar = () => {
      if (selected.size > 0) {
        bulkBar.removeClass('cad-bulk-bar-hidden');
        bulkCount.setText(`${selected.size} selected`);
      } else {
        bulkBar.addClass('cad-bulk-bar-hidden');
      }
    };

    // filterState: fieldKey → Set of included values (missing = no filter)
    const filterState = new Map<string, Set<string>>();
    const applyFilters = (arr: EntityRecord[]) => {
      if (filterState.size === 0) return arr;
      return arr.filter((e) => {
        for (const [key, vals] of filterState) {
          if (!vals || vals.size === 0) continue;
          const v = String(entityValue(e, key, def) ?? '');
          if (!vals.has(v)) return false;
        }
        return true;
      });
    };

    const openFilterDropdown = (th: HTMLElement, field: EntityField, filterBtn: HTMLElement) => {
      document.querySelector('.cad-filter-dropdown')?.remove();
      const current = filterState.get(field.key); // Set or undefined
      const dropdown = document.createElement('div');
      dropdown.className = 'cad-filter-dropdown';
      // Prevent clicks inside dropdown from bubbling to th (which would trigger sort)
      dropdown.addEventListener('click', (ev) => ev.stopPropagation());

      const hdr = document.createElement('div');
      hdr.className = 'cad-filter-header';
      hdr.textContent = field.label;
      const clearBtn = document.createElement('button');
      clearBtn.className = 'cad-filter-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        filterState.delete(field.key);
        filterBtn.classList.remove('cad-filter-btn-active');
        dropdown.remove();
        renderBody(applyFilters(sortEntities([...entities])));
      });
      hdr.appendChild(clearBtn);
      dropdown.appendChild(hdr);

      // Keep a live ref to current selection so checkboxes stay in sync
      let sel = current ? new Set(current) : null; // null = all
      field.options.forEach((opt) => {
        const label = document.createElement('label');
        label.className = 'cad-filter-option';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !sel || sel.has(opt);
        cb.addEventListener('change', () => {
          if (!sel) sel = new Set(field.options); // expand from "all"
          if (cb.checked) sel.add(opt); else sel.delete(opt);
          const isAll = sel.size === field.options.length;
          if (isAll) { filterState.delete(field.key); sel = null; }
          else filterState.set(field.key, new Set(sel));
          filterBtn.classList.toggle('cad-filter-btn-active', filterState.has(field.key));
          renderBody(applyFilters(sortEntities([...entities])));
        });
        label.appendChild(cb);
        label.append(` ${opt}`);
        dropdown.appendChild(label);
      });

      const rect = th.getBoundingClientRect();
      dropdown.style.position = 'fixed';
      dropdown.style.top = rect.bottom + 'px';
      dropdown.style.left = rect.left + 'px';
      // Only one column-filter menu at a time; also lets render()/onClose dispose it.
      this._closeColumnFilterMenu();
      document.body.appendChild(dropdown);

      const onDocClick = (ev: MouseEvent) => {
        if (!dropdown.contains(ev.target as Node)) this._closeColumnFilterMenu();
      };
      this._columnFilterCleanup = () => {
        dropdown.remove();
        document.removeEventListener('click', onDocClick);
        this._columnFilterCleanup = null;
      };
      setTimeout(() => document.addEventListener('click', onDocClick), 0);
    };

    const tableWrap = root.createDiv({ cls: 'cad-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'cad-table' });

    const thead = table.createEl('thead');
    const trh = thead.createEl('tr');
    const sortState = this._tableSortState || (this._tableSortState = {});
    const stateKey = `${this.mode || ''}::${entityKey}`;
    const currentSort = sortState[stateKey] || { key: null, dir: 'ASC' };

    const normSortVal = (val: unknown, type?: string) => {
      if (val == null) return null;
      if (Array.isArray(val)) val = val.join(', ');
      if (type === 'currency' || type === 'number') {
        const n = Number(val);
        return isNaN(n) ? null : n;
      }
      if (type === 'date') {
        const t = new Date(String(val).slice(0, 10)).getTime();
        return isNaN(t) ? null : t;
      }
      return String(val).toLowerCase();
    };

    const sortEntities = (arr: EntityRecord[]) => {
      if (!currentSort.key) return arr;
      const field = cols.find((c) => c.key === currentSort.key);
      if (!field) return arr;
      const dirMul = currentSort.dir === 'DESC' ? -1 : 1;
      const withIdx = arr.map((e, i) => ({ e, i }));
      withIdx.sort((a, b) => {
        const av = normSortVal(entityValue(a.e, field.key, def), field.type);
        const bv = normSortVal(entityValue(b.e, field.key, def), field.type);
        if (av == null && bv == null) return a.i - b.i;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul || (a.i - b.i);
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dirMul || (a.i - b.i);
      });
      return withIdx.map((x) => x.e);
    };

    let selectAllCb: HTMLInputElement | null = null;
    let currentArr: EntityRecord[] = [];
    const tbody = table.createEl('tbody');
    const renderBody = (arr: EntityRecord[]) => {
      currentArr = arr;
      tbody.empty();
      selected.clear();
      updateBulkBar();
      if (selectAllCb) { selectAllCb.checked = false; selectAllCb.indeterminate = false; }
      arr.forEach((e) => {
        const tr = tbody.createEl('tr', { cls: 'cad-row' });
        tr.addEventListener('dblclick', () => {
          tr.querySelectorAll('td').forEach((cell: EditableCellEl) => {
            clearTimeout(cell._cadEditTimer);
            delete cell._cadEditTimer;
          });
          this.openEntityDetail(entityKey, e.file);
        });

        // Checkbox cell
        const tdCb = tr.createEl('td', { cls: 'cad-col-cb' });
        const cb = tdCb.createEl('input', { type: 'checkbox', cls: 'cad-row-cb' });
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(e.file.path); else selected.delete(e.file.path);
          tr.toggleClass('cad-row-selected', cb.checked);
          updateBulkBar();
          if (selectAllCb) {
            selectAllCb.indeterminate = selected.size > 0 && selected.size < arr.length;
            selectAllCb.checked = selected.size === arr.length;
          }
        });
        // Prevent checkbox click from triggering dblclick-to-detail
        tdCb.addEventListener('dblclick', (ev) => ev.stopPropagation());

        cols.forEach((f, i) => {
          const td = tr.createEl('td');
          const val = entityValue(e, f.key, def);
          const formatted = fmtValue(val, f.type);
          if (i === 0) {
            const a = td.createEl('a', { cls: 'cad-row-primary', text: formatted || e.basename });
            a.addEventListener('click', (ev) => {
              ev.preventDefault();
              this.openEntityDetail(entityKey, e.file);
            });
          } else {
            this._makeInlineEditable(td, e, f, def, formatted);
          }
        });
      });
    };

    const renderHeader = () => {
      trh.empty();
      // Select-all checkbox header
      const thCb = trh.createEl('th', { cls: 'cad-col-cb' });
      selectAllCb = thCb.createEl('input', { type: 'checkbox', cls: 'cad-row-cb' });
      selectAllCb.addEventListener('change', () => {
        if (selectAllCb.checked) currentArr.forEach((e) => selected.add(e.file.path));
        else selected.clear();
        tbody.querySelectorAll('tr').forEach((tr, idx) => {
          const cb = tr.querySelector<HTMLInputElement>('.cad-row-cb');
          if (cb) cb.checked = selectAllCb.checked;
          tr.toggleClass('cad-row-selected', selectAllCb.checked);
        });
        selectAllCb.indeterminate = false;
        updateBulkBar();
      });
      cols.forEach((f) => {
        const isActive = currentSort.key === f.key;
        const th = trh.createEl('th', {
          cls: 'cad-th-sortable' + (isActive ? ' cad-th-sorted' : ''),
        });
        const label = th.createSpan({ cls: 'cad-th-label' });
        label.createSpan({ text: f.label });
        const ind = label.createSpan({ cls: 'cad-th-indicator' });
        if (isActive) ind.setText(currentSort.dir === 'DESC' ? 'v' : '^');
        else ind.setText('');
        th.addEventListener('click', () => {
          if (currentSort.key === f.key) currentSort.dir = currentSort.dir === 'ASC' ? 'DESC' : 'ASC';
          else { currentSort.key = f.key; currentSort.dir = 'ASC'; }
          sortState[stateKey] = { key: currentSort.key, dir: currentSort.dir };
          renderHeader();
          renderBody(applyFilters(sortEntities([...entities])));
        });
        if (f.type === 'enum' && f.options?.length) {
          const isFiltered = filterState.has(f.key);
          const filterBtn = th.createEl('button', {
            cls: 'cad-filter-btn' + (isFiltered ? ' cad-filter-btn-active' : ''),
            text: '▾',
          });
          filterBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openFilterDropdown(th, f, filterBtn);
          });
        }
      });
    };
    renderHeader();

    renderBody(applyFilters(sortEntities([...entities])));
  }

  _makeInlineEditable(td: EditableCellEl, entity: EntityRecord, field: EntityField, def: EntityDef, initialFormatted: string) {
    td.addClass('cad-cell-editable');
    td.setText(initialFormatted || '');
    td._cadEditing = false;

    const refreshCell = () => {
      const cache = this.app.metadataCache.getFileCache(entity.file);
      const fm = cache?.frontmatter || {};
      const newVal = entityValue({ file: entity.file, frontmatter: fm, basename: entity.basename }, field.key, def);
      td.empty();
      td.removeClass('cad-cell-editing');
      td._cadEditing = false;
      td.setText(fmtValue(newVal, field.type) || '');
    };

    const saveField = async (raw: string) => {
      const fieldType = field.type || 'text';
      let value: string | string[] | number | null = raw;
      if (fieldType === 'tags') {
        value = (raw || '').split(',').map((t) => t.trim()).filter(Boolean);
      } else if (fieldType === 'number' || fieldType === 'currency') {
        const n = Number(raw);
        value = isNaN(n) ? null : n;
      } else if (raw === '' || raw == null) {
        value = null;
      }
      try {
        await this.app.fileManager.processFrontMatter(entity.file, (fm) => {
          if (value == null || (Array.isArray(value) && value.length === 0)) {
            delete fm[field.key];
          } else {
            fm[field.key] = value;
          }
        });
      } catch (err) {
        new obsidian.Notice(`Save failed: ${err.message}`);
      }
      refreshCell();
    };

    const activateEdit = () => {
      if (td._cadEditing) return;
      td._cadEditing = true;
      const cache = this.app.metadataCache.getFileCache(entity.file);
      const currentVal = entityValue(
        { file: entity.file, frontmatter: cache?.frontmatter || {}, basename: entity.basename },
        field.key, def
      );
      const fieldType = field.type || 'text';
      td.empty();
      td.addClass('cad-cell-editing');

      const cancel = () => {
        td.empty();
        td.removeClass('cad-cell-editing');
        td._cadEditing = false;
        td.setText(fmtValue(currentVal, field.type) || '');
      };

      if (fieldType === 'enum') {
        const sel = td.createEl('select', { cls: 'cad-cell-input' });
        sel.createEl('option', { value: '', text: '—' });
        (field.options || []).forEach((opt) => {
          const o = sel.createEl('option', { value: opt, text: opt });
          if (String(currentVal || '') === opt) o.selected = true;
        });
        let committed = false;
        sel.addEventListener('change', () => { committed = true; saveField(sel.value); });
        sel.addEventListener('blur', () => { if (!committed) { committed = true; cancel(); } });
        sel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { committed = true; cancel(); } });
        sel.focus();
      } else if (fieldType === 'date') {
        const inp = td.createEl('input', { type: 'date', cls: 'cad-cell-input' });
        inp.lang = navigator.language || '';
        if (currentVal) {
          const d = new Date(String(currentVal).slice(0, 10));
          if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
        }
        let committed = false;
        inp.addEventListener('change', () => { committed = true; saveField(inp.value); });
        inp.addEventListener('blur', () => { if (!committed) { committed = true; cancel(); } });
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { if (!committed) { committed = true; saveField(inp.value); } }
          if (ev.key === 'Escape') { committed = true; cancel(); }
        });
        inp.focus();
      } else {
        const inputType = fieldType === 'email' ? 'email' : (fieldType === 'number' || fieldType === 'currency') ? 'number' : 'text';
        const inp = td.createEl('input', { type: inputType, cls: 'cad-cell-input' });
        if (fieldType === 'tags' && Array.isArray(currentVal)) inp.value = currentVal.join(', ');
        else if (currentVal != null) inp.value = String(currentVal);
        let committed = false;
        inp.addEventListener('blur', () => { if (!committed) { committed = true; saveField(inp.value); } });
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { if (!committed) { committed = true; saveField(inp.value); } }
          if (ev.key === 'Escape') { committed = true; cancel(); }
        });
        inp.focus();
        inp.select();
      }
    };

    td.addEventListener('click', () => {
      if (td._cadEditing) return;
      clearTimeout(td._cadEditTimer);
      td._cadEditTimer = setTimeout(() => activateEdit(), 250);
    });
  }

  _tabsForParent(parentId: string) {
    const tabs: SecondaryTabLike[] = SECONDARY_TABS[parentId] || [];
    return tabs.flatMap((tab) => {
      if (!tab.children) return [tab];
      return tab.children.map((child) => Object.assign({}, child, { label: `${tab.label} · ${child.label}` }));
    }).filter((tab) => {
      const surface = ALL_SURFACES.find((item) => item.parent === parentId && surfaceMatchesTab(item, tab)) as NavSurfaceLike | undefined;
      return surface?.placement !== 'navigation';
    });
  }

  async renderEntityTabs(root: HTMLElement, parentId: string, defaultEntityKey: string, opts: EntityListOptions = {}) {
    const tabs = this._tabsForParent(parentId);
    const state = this._secondaryTabState || (this._secondaryTabState = {});
    const current = state[parentId] || defaultEntityKey;
    const activeTab = tabs.find((tab) => tab.entityKey === current || tab.route === current) || tabs[0];
    const activeKey = activeTab?.entityKey || activeTab?.route || defaultEntityKey;
    state[parentId] = activeKey;

    const tabWrap = root.createDiv({ cls: 'cad-secondary-tabs' });
    tabs.forEach((tab) => {
      const key = tab.entityKey || tab.route;
      const btn = tabWrap.createEl('button', {
        cls: 'cad-secondary-tab' + (key === activeKey ? ' active' : ''),
        text: tab.label,
      });
      btn.addEventListener('click', async () => {
        state[parentId] = key;
        await this.render();
      });
    });

    if (activeTab?.route) return this._renderSecondaryRoute(root, activeTab.route, opts);
    return this.renderEntityList(root, activeTab?.entityKey || defaultEntityKey, opts);
  }

  async _renderSecondaryRoute(root: HTMLElement, route: string, opts: EntityListOptions = {}) {
    if (configuredDashboardDefinition(route)) return this.renderConfigDashboard(route, root, opts);
    if (route === 'client-work.dashboard') return this.renderClientWorkDashboard(root, opts);
    if (route === 'finance.gl.overview') return this.renderFinanceGLDashboard(root);
    if (route === 'finance.setup.overview') return this.renderFinanceSetupDashboard(root);
    if (route === 'procurement.overview') return this.renderProcurementDashboard(root);
    if (route === 'tax.dashboard') return this.renderTaxDashboard(root);
    if (route === 'prm.partners.overview') return this.renderPartnerWorkspaceDashboard(root);
    if (route === 'crm.campaigns.overview') return this.renderCampaignWorkspaceDashboard(root);
    if (route === 'prm.analytics') return this.renderPRMAnalytics(root);
    return this.renderComingSoon(root, { label: route, icon: 'layout-dashboard', desc: 'Workspace overview.' });
  }

  _clientWorkOptions() {
    const seen = new Set<string>();
    return (listEntities(this.app, 'client') as EntityRecord[])
      .map((client) => {
        const id = String(entityValue(client, 'client_id', ENTITIES.client) || '').trim();
        if (!id) return null;
        const name = String(entityValue(client, 'client_name', ENTITIES.client) || entityValue(client, 'name', ENTITIES.client) || client.basename || id).trim();
        return { id, label: name && name !== id ? `${name} (${id})` : id };
      })
      .filter(Boolean)
      .filter((client) => {
        if (seen.has(client.id)) return false;
        seen.add(client.id);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  }

  _clientWorkProjectOptions() {
    const seen = new Set<string>();
    return (listEntities(this.app, 'project') as EntityRecord[])
      .map((project) => {
        const id = String(entityValue(project, 'project_id', ENTITIES.project) || project.basename || '').trim();
        if (!id) return null;
        const name = String(entityValue(project, 'project_name', ENTITIES.project) || entityValue(project, 'name', ENTITIES.project) || entityValue(project, 'project', ENTITIES.project) || project.basename || id).trim();
        const client = String(entityValue(project, 'client_id', ENTITIES.project) || '').trim();
        const label = name && name !== id ? `${name} (${id})` : id;
        return { id, label: client ? `${label} · ${client}` : label };
      })
      .filter(Boolean)
      .filter((project) => {
        if (seen.has(project.id)) return false;
        seen.add(project.id);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  }

  _entityMatchesClient(entity: EntityRecord, clientId: string) {
    if (!clientId) return true;
    const direct = entity.frontmatter?.client_id;
    const endClient = entity.frontmatter?.end_client_id;
    const values = [
      ...(Array.isArray(direct) ? direct : [direct]),
      ...(Array.isArray(endClient) ? endClient : [endClient]),
    ];
    return values.some((value) => String(value ?? '').trim() === clientId);
  }

  _entityMatchesProject(entity: EntityRecord, projectId: string) {
    if (!projectId) return true;
    const ids = entity.frontmatter?.project_id;
    const previousProject = entity.frontmatter?.project;
    const values = [
      ...(Array.isArray(ids) ? ids : [ids]),
      ...(Array.isArray(previousProject) ? previousProject : [previousProject]),
    ];
    return values.some((value) => String(value ?? '').trim() === projectId);
  }

  _renderClientWorkSelector(container: HTMLElement) {
    const wrap = container.createDiv({ cls: 'cad-client-work-filter' });
    const clientSelect = wrap.createEl('select', { cls: 'dropdown cad-client-work-client-select' });
    clientSelect.createEl('option', { value: '', text: 'All clients' });
    const clients = this._clientWorkOptions();
    clients.forEach((client) => {
      clientSelect.createEl('option', { value: client.id, text: client.label });
    });
    if (this._clientWorkClientId && !clients.some((client) => client.id === this._clientWorkClientId)) {
      this._clientWorkClientId = '';
    }
    clientSelect.value = this._clientWorkClientId || '';
    clientSelect.addEventListener('change', async () => {
      this._clientWorkClientId = clientSelect.value;
      await this.render();
    });

    const projectSelect = wrap.createEl('select', { cls: 'dropdown cad-client-work-project-select' });
    projectSelect.createEl('option', { value: '', text: 'All projects' });
    const projects = this._clientWorkProjectOptions();
    projects.forEach((project) => {
      projectSelect.createEl('option', { value: project.id, text: project.label });
    });
    if (this._clientWorkProjectId && !projects.some((project) => project.id === this._clientWorkProjectId)) {
      this._clientWorkProjectId = '';
    }
    projectSelect.value = this._clientWorkProjectId || '';
    projectSelect.addEventListener('change', async () => {
      this._clientWorkProjectId = projectSelect.value;
      await this.render();
    });
  }

	  async renderClientWorkWorkspace(root: HTMLElement) {
	    if (this._clientWorkClientId && !this._clientWorkOptions().some((client) => client.id === this._clientWorkClientId)) {
	      this._clientWorkClientId = '';
	    }
	    if (this._clientWorkProjectId && !this._clientWorkProjectOptions().some((project) => project.id === this._clientWorkProjectId)) {
	      this._clientWorkProjectId = '';
	    }
	    const selectedClientId = this._clientWorkClientId || '';
	    const selectedProjectId = this._clientWorkProjectId || '';
	    const titleParts = [selectedClientId, selectedProjectId].filter(Boolean);
	    const firstTab = this._tabsForParent('client-work.overview')[0];
	    const defaultTab = firstTab ? (firstTab.entityKey || firstTab.route) : 'client-work.dashboard';
	    return this.renderEntityTabs(root, 'client-work.overview', defaultTab, {
	      filter: (entity) => this._entityMatchesClient(entity, selectedClientId) && this._entityMatchesProject(entity, selectedProjectId),
	      forceInternal: true,
	      titleSuffix: titleParts.length ? ` · ${titleParts.join(' · ')}` : '',
	      renderHeaderControls: (right) => this._renderClientWorkSelector(right),
	      emptyDescription: titleParts.length
	        ? `No records matching ${titleParts.join(' / ')} in this tab.`
	        : null,
	    });
	  }

  _isOpenEntity(entity: EntityRecord, entityKey: string) {
    return isOpenEntityRecord(entity, entityKey, ENTITIES);
  }

  _dateValue(entity: EntityRecord, entityKey: string, fields: string[]) {
    const def = ENTITIES[entityKey];
    for (const field of fields) {
      const value = entityValue(entity, field, def);
      if (value) {
        const date = new Date(String(value).slice(0, 10));
        if (!isNaN(date.getTime())) return date;
      }
    }
    return null;
  }

  _normalizeWidgetSource(source: unknown, fallbackEntityKey: string | null = null) {
    return normalizeWidgetSourceConfig(source, fallbackEntityKey);
  }

  _widgetSourceSpec(card: CardLike, fallbackEntityKey: string | null = null) {
    if (!card || typeof card !== 'object') return card;
    const source = card.source && typeof card.source === 'object'
      ? Object.assign({}, card.source)
      : (typeof card.source === 'string' ? { source: card.source } : {});
    const base = card.base && typeof card.base === 'object'
      ? card.base
      : (typeof card.base === 'string' ? { file: card.base } : {});
    const spec = Object.assign({}, source);
    if (base.file || base.base || base.path || base.basePath) {
      spec.base = base.file || base.base || base.path || base.basePath;
    }
    if (base.view || base.baseView || base.base_view) {
      spec.view = base.view || base.baseView || base.base_view;
    }
    if (base.entity || card.entity || fallbackEntityKey) {
      spec.entity = base.entity || card.entity || fallbackEntityKey;
    }
    return spec;
  }

  async _resolveWidgetEntities(source: unknown, fallbackEntityKey: string | null = null): Promise<ResolvedWidgetSource> {
    return resolveWidgetSource(this.app, source, fallbackEntityKey, this.plugin.settings);
  }

  _dashboardDateRangePresets(card: CardLike, state: DashboardState = {}) {
    const today = startOfDay(new Date());
    const y = today.getFullYear();
    const m = today.getMonth();
    const weekStart = startOfWeek(today, this.plugin.settings.weekStartsOn || 1);
    const q = Math.floor(m / 3);
    return [
      { value: 'all', label: String(card.allLabel || 'All').trim(), from: '', to: '', filter: 'true' },
      { value: 'today', label: 'Today', from: today, to: today },
      { value: 'this-week', label: 'This week', from: weekStart, to: addDays(weekStart, 6) },
      { value: 'this-month', label: 'This month', from: startOfDay(new Date(y, m, 1)), to: startOfDay(new Date(y, m + 1, 0)) },
      { value: 'last-30-days', label: 'Last 30 days', from: addDays(today, -29), to: today },
      { value: 'this-quarter', label: 'This quarter', from: startOfDay(new Date(y, q * 3, 1)), to: startOfDay(new Date(y, q * 3 + 3, 0)) },
      { value: 'custom', label: 'Custom', from: state[`${card.key || card.name || card.field || 'dateRange'}Start`] || '', to: state[`${card.key || card.name || card.field || 'dateRange'}End`] || '' },
    ];
  }

  _applyDateRangeControlState(state: DashboardState, card: CardLike, presetValue: string | null = null) {
    const key = String(card.key || card.name || card.field || 'dateRange').trim();
    if (!key) return;
    const field = String(card.field || 'date').trim();
    const filterKey = `${key}Filter`;
    const startKey = `${key}Start`;
    const endKey = `${key}End`;
    const presetKey = `${key}Preset`;
    const toYmd = (value: string | number | Date) => {
      const d = value instanceof Date ? value : new Date(value);
      return isNaN(d.getTime()) ? '' : ymd(d);
    };
    const requested = String(presetValue || state[presetKey] || state[key] || card.default || 'this-month').trim() || 'this-month';
    const presets = this._dashboardDateRangePresets(card, state);
    const preset = presets.find((item) => item.value === requested) || presets.find((item) => item.value === 'this-month') || presets[0];
    state[presetKey] = preset.value;
    state[key] = preset.value;
    if (preset.value === 'all') {
      delete state[startKey];
      delete state[endKey];
      state[filterKey] = 'true';
      return;
    }
    if (preset.value === 'custom') {
      const start = state[startKey] ? toYmd(state[startKey]) : '';
      const end = state[endKey] ? toYmd(state[endKey]) : '';
      state[filterKey] = start && end ? `${field} >= ${JSON.stringify(start)} && ${field} <= ${JSON.stringify(end)}` : 'true';
      return;
    }
    const from = toYmd(preset.from);
    const to = toYmd(preset.to);
    state[startKey] = from;
    state[endKey] = to;
    state[filterKey] = from && to ? `${field} >= ${JSON.stringify(from)} && ${field} <= ${JSON.stringify(to)}` : 'true';
  }

  _initializeDashboardControlState(surfaceId: string, controls: CardLike[] = []) {
    const state = this._dashboardStateFor(surfaceId);
    controls.forEach((card) => {
      if (!card || typeof card !== 'object') return;
      const kind = String(card.kind || '').trim().toLowerCase();
      const isDateRange = kind === 'date-range' || String(card.mode || card.type || '').trim().toLowerCase() === 'date-range';
      const key = String(card.key || card.name || card.field || card.entity || '').trim();
      if (!key) return;
      const filterKey = `${key}Filter`;
      if (isDateRange) {
        if (!state[filterKey]) this._applyDateRangeControlState(state, card);
        return;
      }
      if (kind !== 'selector') return;
      if (state[filterKey]) return;
      const defaultValue = String(card.default || '').trim();
      state[key] = defaultValue;
      state[filterKey] = 'true';
      if (!defaultValue || !Array.isArray(card.options)) return;
      const selected = card.options.find((opt: SelectorOptionLike) => {
        if (opt == null) return false;
        if (typeof opt === 'string' || typeof opt === 'number') return String(opt) === defaultValue;
        return String(opt.value ?? opt.id ?? opt.key ?? opt.label ?? '').trim() === defaultValue;
      });
      if (selected && typeof selected === 'object' && selected.filter) {
        state[filterKey] = String(selected.filter);
      } else if (selected != null && card.field) {
        state[filterKey] = `${String(card.field).trim()} == ${JSON.stringify(defaultValue)}`;
      }
    });
  }

  async renderConfigDashboard(surfaceId: string, root: HTMLElement, opts: DashboardRenderOptions = {}) {
    const config = (opts.config || resolveSurfaceConfig(surfaceId)) as DashConfigLike | null;
    if (!config) {
      const surface = SURFACE_BY_ID[surfaceId] || ({} as NavSurface);
      if (!opts.skipHeader) {
        this._renderPageHeader(root, surface.label || surfaceId || 'Dashboard', 'No dashboard configuration found');
      }
      const card = root.createDiv({ cls: 'cad-dash-card' });
      const body = card.createDiv({ cls: 'cad-dash-card-body' });
      body.createDiv({
        cls: 'cad-empty',
        text: `Add dashboards.${surfaceId} to workspace.json to render this surface.`,
      });
      return;
    }
    root.toggleClass('cadence-report', config.kind === 'report' || String(surfaceId || '').startsWith('reports.'));
    root.toggleClass('cadence-planner', config.kind === 'planner' || String(surfaceId || '').startsWith('planner.'));

    const dashboardWarnings: string[] = [];
    const widgetCache = new Map<string, Promise<ResolvedWidgetSource>>();
    const dashboardState = this._dashboardStateFor(surfaceId);
    this._initializeDashboardControlState(surfaceId, config.controls || []);
    const dashboardContext = Object.assign({
      clientId: this._clientWorkClientId || '',
      projectId: this._clientWorkProjectId || '',
    }, dashboardState);
    const getWidgetEntities = async (source: unknown, fallbackEntityKey: string | null = null) => {
      const normalized = this._normalizeWidgetSource(applyDashboardContext(source, dashboardContext), fallbackEntityKey);
      const cacheKey = JSON.stringify({
        entityKey: normalized.entityKey,
        mode: normalized.mode,
        base: normalized.base,
        view: normalized.view,
        section: normalized.section || null,
        filters: normalized.filters || null,
        groupBy: normalized.groupBy || null,
        sort: normalized.sort || null,
        limit: normalized.limit,
        contextFilter: config.contextFilter || '',
      });
      if (!widgetCache.has(cacheKey)) {
        widgetCache.set(cacheKey, this._resolveWidgetEntities(normalized, normalized.entityKey).then((resolved) => {
          if (Array.isArray(resolved.warnings) && resolved.warnings.length) {
            dashboardWarnings.push(...resolved.warnings);
          }
          let entities = resolved.entities || [];
          if (config.contextFilter === 'client-work') {
            const cid = this._clientWorkClientId || '';
            const pid = this._clientWorkProjectId || '';
            entities = entities.filter((e) => this._entityMatchesClient(e, cid) && this._entityMatchesProject(e, pid));
          }
          return Object.assign({}, resolved, { entities });
        }));
      }
      return widgetCache.get(cacheKey);
    };

    // Warm the per-render widget cache for every layout card up front, in
    // parallel. The paint loop below renders cards sequentially (to preserve
    // layout order); without this, each card resolves its source — including
    // disk-reading snapshot sources on Home — only when it is reached, so the
    // sections reveal one at a time. Kicking the resolutions off concurrently
    // here lets the slow ones (snapshots) overlap, and the paint loop then hits
    // already-resolved promises. Idempotent: getWidgetEntities dedupes by key.
    const prewarmLayout = (async () => {
      const cards: CardLike[] = [];
      for (const row of config.layout || []) {
        for (const colDef of row) {
          for (const card of (Array.isArray(colDef) ? colDef : [colDef])) cards.push(card);
        }
      }
      await Promise.all(cards.map((card) =>
        getWidgetEntities(this._widgetSourceSpec(card, card.entity), card.entity).catch((): null => null)
      ));
    })();

    const titleSuffix = config.contextFilter === 'client-work'
      ? [this._clientWorkClientId, this._clientWorkProjectId].filter(Boolean).join(' · ')
      : '';
    if (!opts.skipHeader) {
      this._renderPageHeader(
        root,
        config.title + (titleSuffix ? ` · ${titleSuffix}` : ''),
        config.subtitle,
        (r, ctx) => {
          if (config.contextFilter === 'client-work') this._renderClientWorkSelector(r);
          const exportBtn = r.createEl('button', { cls: 'cad-btn', text: 'Save' });
          exportBtn.addEventListener('click', async () => {
            exportBtn.disabled = true;
            exportBtn.textContent = 'Saving…';
            try {
              const path = await this._exportConfigDashboard(surfaceId, config, getWidgetEntities, dashboardContext);
              new obsidian.Notice(`BOB Workspace: saved note to ${path}`, 6000);
            } catch (e) {
              new obsidian.Notice(`BOB Workspace: save failed — ${e.message}`, 8000);
            } finally {
              exportBtn.disabled = false;
              exportBtn.textContent = 'Save';
            }
          });
        }
      );
    }

    if (Array.isArray(config.controls) && config.controls.length) {
      const controlsSection = root.createDiv({ cls: 'cad-dash-filter-group' });
      const controlsHead = controlsSection.createDiv({ cls: 'cad-dash-filter-group-head' });
      controlsHead.createDiv({ cls: 'cad-dash-card-title', text: 'FILTERS' });
      controlsHead.createDiv({ cls: 'cad-dash-filter-group-note', text: 'All filters are combined with AND.' });
      const controlsWrap = controlsSection.createDiv({ cls: 'cad-dash-controls' });
      for (const control of config.controls) {
        await this._renderConfigCard(controlsWrap.createDiv({ cls: 'cad-dash-col' }), control, getWidgetEntities);
      }
    }

    if (config.stats?.length) {
      const statItems = await Promise.all(config.stats.map(async (s: CardLike) => {
        const resolved = await getWidgetEntities(s.source || s, s.entity);
        const entities = resolved.entities;
        const builtInData = resolved.metadata?.builtInData || resolved.metadata?.providerData || null;
        const def = resolved.def || ENTITIES[s.entity];
        const metric = String(s.metric || s.count?.metric || '').trim();
        const field = s.field || s.valueField || s.count?.field || '';
        const hasEntityModel = !!def && !!s.entity;
        const stageField = hasEntityModel ? dealStageField(def) : '';
        const dealValue = (e: EntityRecord) => Number(entityValue(e, field || (hasEntityModel ? dealValueField(def) : field), def)) || 0;
        const countOpen = hasEntityModel ? entities.filter((e) => this._isOpenEntity(e, s.entity)).length : 0;
        const countWon = hasEntityModel ? entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        const countLost = hasEntityModel ? entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        let value;
        if (builtInData && field && Object.prototype.hasOwnProperty.call(builtInData, field)) {
          value = builtInData[field];
        } else if (metric === 'sum') {
          value = entities.reduce((sum, e) => sum + dealValue(e), 0);
        } else if (metric === 'avg') {
          value = entities.length ? entities.reduce((sum, e) => sum + dealValue(e), 0) / entities.length : 0;
        } else if (metric === 'weightedForecast') {
          const stageConfidenceRaw = def?.stageConfidence || { lead: 0.1, qualified: 0.25, proposal: 0.5, negotiation: 0.75 };
          const stageConfidence = Object.fromEntries(Object.entries(stageConfidenceRaw).map(([k, v]) => [String(k).toLowerCase(), Number(v) || 0]));
          value = entities.reduce((sum, e) => {
            const stage = String(entityValue(e, stageField, def) || '').toLowerCase();
            return sum + dealValue(e) * (stageConfidence[stage] || 0);
          }, 0);
        } else if (metric === 'winRate') {
          value = countWon + countLost === 0 ? 0 : Math.round((countWon / (countWon + countLost)) * 100);
        } else if (metric === 'captureRate') {
          const wonValue = entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const lostValue = entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const total = wonValue + lostValue;
          value = total === 0 ? 0 : Math.round((wonValue / total) * 100);
        } else if (metric === 'uniqueCount') {
          value = new Set(entities.map((e) => String(entityValue(e, field, def) || '').trim()).filter(Boolean)).size;
        } else if (s.count === 'open' || s.count === 'active') {
          // "active" is an accepted alias for "open" (status not done/archived).
          value = countOpen;
        } else if (s.count && typeof s.count === 'object' && s.count.field) {
          value = entities.filter((e) => entityValue(e, s.count.field, def)).length;
        } else {
          value = entities.length;
        }
        let sub = s.sub;
        if (sub && typeof sub === 'object') {
          const subKey = sub.entity || s.entity;
          const subResolved = await getWidgetEntities(sub.source || sub, subKey);
          const subEnts = subResolved.entities;
          const subCount = (sub.count === 'open' || sub.count === 'active')
            ? subEnts.filter(e => this._isOpenEntity(e, subKey)).length
            : subEnts.length;
          sub = `${subCount} ${sub.suffix}`;
        }
        return { label: s.label, value, sub, accent: s.accent, mode: s.mode };
      }));
      this._dashboardStats(root, statItems);
    }

    await prewarmLayout;
    for (const row of config.layout || []) {
      const cols = root.createDiv({ cls: 'cad-dash-cols' });
      for (const colDef of row) {
        const col = cols.createDiv({ cls: 'cad-dash-col' });
        for (const card of (Array.isArray(colDef) ? colDef : [colDef])) {
          await this._renderConfigCard(col, card, getWidgetEntities, dashboardContext);
        }
      }
    }

    for (const cr of config.conditionalRows || []) {
      const resolvedConditions = await Promise.all((cr.condition?.entities || []).map((key: string) => getWidgetEntities(null, key)));
      const hasData = resolvedConditions.some((resolved) => resolved.entities.length > 0);
      if (!hasData) continue;
      const extra = root.createDiv({ cls: 'cad-dash-cols' });
      for (const card of cr.cards) {
        await this._renderConfigCard(extra.createDiv({ cls: 'cad-dash-col' }), card, getWidgetEntities, dashboardContext);
      }
    }

    if (dashboardWarnings.length) {
      const details = root.createEl('details', { cls: 'cad-base-filter-warnings' });
      details.createEl('summary', { text: `${dashboardWarnings.length} dashboard warning${dashboardWarnings.length === 1 ? '' : 's'}` });
      const list = details.createEl('ul');
      dashboardWarnings.forEach((warning: string) => {
        list.createEl('li').createEl('code', { text: warning });
      });
    }

    if (config.legend === 'finance-statements') this._renderFinanceStatementLegend(root);
  }

  async _renderConfigCard(col: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities, dashboardContext: DashboardState = {}) {
    try {
      const resolvedCard = applyDashboardContext(card, dashboardContext);
      if (await this._renderWidgetByKind(col, resolvedCard, getWidgetEntities)) return;
      const rows = await this._resolveCardRows(resolvedCard, getWidgetEntities);
      this._dashCardSection(col, resolvedCard.title, rows, resolvedCard.empty || '');
    } catch (error) {
      this._renderWidgetErrorCard(col, card, error);
    }
  }

  _renderWidgetErrorCard(col: HTMLElement, card: CardLike | null | undefined, error: unknown) {
    const title = String(card?.title || card?.kind || 'Widget').trim();
    const cardEl = col.createDiv({ cls: 'cad-dash-card cad-widget-error-card' });
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: title });
    head.createSpan({ cls: 'cad-widget-catalog-badge cad-widget-error-badge', text: 'Error' });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    body.createDiv({ cls: 'cad-empty', text: 'This widget failed to render.' });
    const details = body.createEl('details', { cls: 'cad-widget-error-details' });
    details.createEl('summary', { text: 'Show details' });
    details.createEl('code', { text: String((error as Error | null)?.message || error || 'Unknown widget error') });
  }

  _renderRowProgress(parent: HTMLElement, progress: ProgressLike | null | undefined) {
    if (!progress || typeof progress !== 'object') return;
    const value = Math.max(0, Math.min(100, Number(progress.value ?? progress.percent ?? progress.pct ?? 0) || 0));
    const wrap = parent.createDiv({ cls: 'cad-proj-progress-wrap cad-row-progress' });
    wrap.dataset.pctBand = pctBand(value);
    const label = wrap.createDiv({ cls: 'cad-proj-progress-label' });
    label.createSpan({ text: String(progress.label || 'Progress') });
    label.createSpan({ cls: 'cad-proj-progress-pct', text: String(progress.pct || `${value}%`) });
    const bar = wrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
    fill.style.width = `${value}%`;
  }

  _applyCardTone(cardEl: HTMLElement, card: CardLike = {}) {
    if (!cardEl) return;
    const explicit = String(card.tone || card.accent || '').trim().toLowerCase();
    const text = String(card.title || card.label || card.kind || '').toLowerCase();
    const source = card.source && typeof card.source === 'object' ? String(card.source.section || card.source.builtIn || '') : '';
    const seed = explicit || source.toLowerCase() || text;
    let tone = 'sky';
    if (/today|done|won|complete|activity/.test(seed)) tone = 'emerald';
    else if (/week|project|partner|base/.test(seed)) tone = 'mint';
    else if (/upcoming|pipeline|date|warning|risk/.test(seed)) tone = 'warn';
    else if (/inbox|overdue|lost|error/.test(seed)) tone = 'rose';
    else if (/brief|top|jump|action/.test(seed)) tone = 'sky';
    cardEl.dataset.tone = tone;
  }

  async _exportConfigDashboard(surfaceId: string, config: DashConfigLike, getWidgetEntities: GetWidgetEntities, dashboardContext: DashboardState) {
    const exportFolder = workbookExportFolder(this.plugin.settings);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const title = String(config.title || surfaceId || 'Report').trim();
    const slug = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
    const path = `${exportFolder}/${slug}_${stamp}.md`;
    await ensureFolderSync(this.app, exportFolder);

    const lines: string[] = [];
    lines.push(`# ${config.title || surfaceId}`);
    if (config.subtitle) lines.push(`\n${config.subtitle}`);
    lines.push(`\n- Surface: \`${surfaceId}\``);
    if (config.contextFilter) lines.push(`- Context: \`${config.contextFilter}\``);
    const selectorBits = Object.entries(dashboardContext || {})
      .filter(([key, value]) => key.endsWith('Filter') && String(value || '').trim())
      .map(([key, value]) => `  - ${key}: \`${value}\``);
    if (selectorBits.length) {
      lines.push('\n## Filters');
      lines.push(...selectorBits);
    }

    if (Array.isArray(config.controls) && config.controls.length) {
      lines.push('\n## Controls');
      for (const control of config.controls) {
        const title = String(control.title || control.label || control.kind || 'Control').trim();
        lines.push(`- ${title}`);
        if (control.kind === 'selector') {
          const key = String(control.key || control.name || control.field || control.entity || '').trim();
          const value = String(dashboardContext?.[key] || '').trim();
          lines.push(`  - key: \`${key}\``);
          lines.push(`  - value: \`${value || 'All'}\``);
        }
      }
    }

    if (Array.isArray(config.stats) && config.stats.length) {
      lines.push('\n## Metrics');
      for (const stat of config.stats as CardLike[]) {
        const resolved = await getWidgetEntities(stat.source || stat, stat.entity);
        const entities = resolved.entities || [];
        const def = resolved.def || ENTITIES[stat.entity];
        const builtInData = resolved.metadata?.builtInData || resolved.metadata?.providerData || null;
        const metric = String(stat.metric || stat.count?.metric || '').trim();
        const field = stat.field || stat.valueField || stat.count?.field || '';
        const hasEntityModel = !!def && !!stat.entity;
        const stageField = hasEntityModel ? dealStageField(def) : '';
        const valueField = field || (hasEntityModel ? dealValueField(def) : '');
        const dealValue = (e: EntityRecord) => Number(entityValue(e, valueField, def)) || 0;
        const numericValues = entities.map((e) => dealValue(e)).filter((value) => Number.isFinite(value));
        const countOpen = hasEntityModel ? entities.filter((e) => this._isOpenEntity(e, stat.entity)).length : 0;
        const countWon = hasEntityModel ? entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        const countLost = hasEntityModel ? entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        let value;
        const filledCount = entities.filter((e) => {
          const raw = entityValue(e, valueField, def);
          return hasBaseValue(raw);
        }).length;
        const emptyCount = Math.max(0, entities.length - filledCount);
        if (metric === 'sum') value = entities.reduce((sum, e) => sum + dealValue(e), 0);
        else if (metric === 'avg') value = entities.length ? entities.reduce((sum, e) => sum + dealValue(e), 0) / entities.length : 0;
        else if (metric === 'min') value = numericValues.length ? Math.min(...numericValues) : 0;
        else if (metric === 'max') value = numericValues.length ? Math.max(...numericValues) : 0;
        else if (metric === 'filled') value = filledCount;
        else if (metric === 'empty') value = emptyCount;
        else if (metric === 'weightedForecast') {
          const stageConfidenceRaw = def?.stageConfidence || { lead: 0.1, qualified: 0.25, proposal: 0.5, negotiation: 0.75 };
          const stageConfidence = Object.fromEntries(Object.entries(stageConfidenceRaw).map(([k, v]) => [String(k).toLowerCase(), Number(v) || 0]));
          value = entities.reduce((sum, e) => sum + dealValue(e) * (stageConfidence[String(entityValue(e, stageField, def) || '').toLowerCase()] || 0), 0);
        } else if (metric === 'winRate') {
          value = countWon + countLost === 0 ? 0 : Math.round((countWon / (countWon + countLost)) * 100);
        } else if (metric === 'captureRate') {
          const wonValue = entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const lostValue = entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const total = wonValue + lostValue;
          value = total === 0 ? 0 : Math.round((wonValue / total) * 100);
        } else if (metric === 'uniqueCount') {
          value = new Set(entities.map((e) => String(entityValue(e, field, def) || '').trim()).filter(Boolean)).size;
        } else if (metric === 'ratio') {
          const numeratorSpec = stat.numerator ?? stat.ratio?.numerator ?? stat.ratio?.top ?? stat.ratio?.value;
          const denominatorSpec = stat.denominator ?? stat.ratio?.denominator ?? stat.ratio?.bottom ?? stat.ratio?.total;
          const resolveRatioValue = (spec: unknown) => {
            if (typeof spec === 'number') return spec;
            if (typeof spec === 'string' && spec.trim()) {
              return entities.reduce((sum, entity) => sum + (Number(entityValue(entity, spec.trim(), def)) || 0), 0);
            }
            return 0;
          };
          const numerator = resolveRatioValue(numeratorSpec);
          const denominator = resolveRatioValue(denominatorSpec);
          value = denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
        } else if (stat.count === 'open') {
          value = countOpen;
        } else if (builtInData && field && Object.prototype.hasOwnProperty.call(builtInData, field)) {
          value = builtInData[field];
        } else {
          value = entities.length;
        }
        lines.push(`- ${stat.label}: ${value}${stat.sub ? ` (${typeof stat.sub === 'string' ? stat.sub : stat.sub.suffix || ''})` : ''}`);
      }
    }

    let sectionIndex = 0;
    for (const row of config.layout || []) {
      for (const colDef of row) {
        for (const card of (Array.isArray(colDef) ? colDef : [colDef])) {
          sectionIndex++;
          const title = String(card.title || card.label || card.kind || `Widget ${sectionIndex}`).trim();
          lines.push(`\n## ${title}`);
          if (card.kind === 'selector') {
            const key = String(card.key || card.name || card.field || card.entity || '').trim();
            const value = dashboardContext?.[key] || '';
            lines.push(`- Selector: \`${key}\``);
            lines.push(`- Value: \`${value || 'All'}\``);
            continue;
          }
          if (card.kind === 'actions') {
            (Array.isArray(card.actions) ? card.actions : []).map((action: ActionInput) => this._normalizeActionSpec(action)).filter(Boolean).forEach((action: ActionSpec) => {
              lines.push(`- ${action.label}${action.surface ? ` -> surface \`${action.surface}\`` : ''}${action.command ? ` -> command \`${action.command}\`` : ''}${action.entityKey ? ` -> create \`${action.entityKey}\`` : ''}`);
            });
            continue;
          }
          if (card.kind === 'markdown') {
            const md = await this._resolveMarkdownWidgetContent(card);
            const snippet = String(md.text || '').trim().split('\n').slice(0, 12).join('\n');
            lines.push(snippet ? `\n${snippet}` : '- No markdown content');
            continue;
          }
          if (card.kind === 'base-link') {
            const base = await this._resolveBaseWidgetTarget(card);
            lines.push(`- Base: \`${base.basePath || '—'}\``);
            if (base.viewName) lines.push(`- View: \`${base.viewName}\``);
            continue;
          }
          if (card.kind === 'base-embed') {
            const base = await this._resolveBaseWidgetTarget(card);
            const resolved = base.entityKey ? await getWidgetEntities(this._widgetSourceSpec(card, base.entityKey), base.entityKey).catch((): null => null) : null;
            const preview = (resolved?.entities || []).slice(0, Math.max(1, Number(card.limit || 5) || 5));
            lines.push(`- Base: \`${base.basePath || '—'}\``);
            if (base.viewName) lines.push(`- View: \`${base.viewName}\``);
            preview.forEach((entity: EntityRecord) => {
              const titleFields = Array.isArray(card.titleFields) && card.titleFields.length ? card.titleFields : ['title', 'name', 'subject'];
              const metaFields = Array.isArray(card.metaFields) && card.metaFields.length ? card.metaFields : ['status', 'date', 'value'];
              const entityTitle = titleFields.map((field: string) => String(entityValue(entity, field, base.entityDef) || '').trim()).find(Boolean) || entity.basename;
              const metaBits = metaFields.map((field: string) => fmtValue(entityValue(entity, field, base.entityDef), base.entityDef?.fields?.find((f: EntityField) => f.key === field)?.type)).filter(Boolean);
              lines.push(`- ${entityTitle}${metaBits.length ? ` · ${metaBits.join(' · ')}` : ''}`);
            });
            continue;
          }
          const rows = await this._resolveCardRows(card, getWidgetEntities);
          if (!rows.length) {
            lines.push('- No rows');
            continue;
          }
          rows.slice(0, 10).forEach((row) => {
            lines.push(`- ${row.title}${row.meta ? ` · ${row.meta}` : ''}`);
          });
          if (rows.length > 10) lines.push(`- …and ${rows.length - 10} more`);
        }
      }
    }

    const file = await this.app.vault.create(path, `${lines.join('\n')}\n`);
    await this.app.workspace.openLinkText(file.path, '', false);
    return file.path;
  }

  async _resolveCardRows(card: CardLike, getWidgetEntities: GetWidgetEntities): Promise<ProviderRow[]> {
    if (card.merge) {
      const merged: ProviderRow[] = [];
      for (const m of card.merge) {
        merged.push(...await this._resolveSourceRows(m, getWidgetEntities));
      }
      return merged
        .sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0))
        .slice(0, 6);
    }
    return this._resolveSourceRows(card, getWidgetEntities);
  }

  async _resolveSourceRows(def: CardLike, getWidgetEntities: GetWidgetEntities): Promise<ProviderRow[]> {
    const sourceSpec = this._widgetSourceSpec(def, def.entity);
    const resolved = await getWidgetEntities(sourceSpec, def.entity);
    const all = resolved.entities || [];
    // The entity key can live in the source (source.entityKey / source.entity),
    // not just the card's top-level `entity` — use the RESOLVED key everywhere so
    // a widget authored as { source: { mode:'entity', entityKey:'deal' } } works
    // (otherwise ENTITIES[undefined].fields threw).
    const entityKey = resolved.entityKey || String(sourceSpec.entity || def.entity || '') || null;
    const entityDef = resolved.def || (entityKey ? ENTITIES[entityKey] : null);
    const source = typeof def.source === 'string' ? def.source : String(sourceSpec.source || sourceSpec.kind || 'recent');
    if (sourceSpec.mode === 'built-in') {
      return this._resolveBuiltInRows(def, resolved);
    }
    const sortSpec = sourceSpec.sort || def.sort || null;
    const limit = sourceSpec.limit || def.limit || 6;
    if (source === 'recent') return this._recentRows(entityKey, all, def.titleFields, def.metaFields, sortSpec, limit, entityDef);
    if (source === 'recent-open') return this._recentRows(entityKey, all.filter(e => this._isOpenEntity(e, entityKey)), def.titleFields, def.metaFields, sortSpec, limit, entityDef);
    if (source === 'due') return this._dueRows(entityKey, all, def.dateFields, def.titleFields, limit);
    if (source === 'due-open') return this._dueRows(entityKey, all.filter(e => this._isOpenEntity(e, entityKey)), def.dateFields, def.titleFields, limit);
    if (source === 'base' || source === 'table' || source === 'list' || source === 'entity') {
      return this._recentRows(entityKey, all, def.titleFields, def.metaFields, sortSpec, limit, entityDef);
    }
    return [];
  }

  _resolveBuiltInRows(def: CardLike, resolved: ResolvedWidgetSource): ProviderRow[] {
    const builtIn = String(resolved.source?.builtIn || resolved.metadata?.builtIn || '').trim().toLowerCase();
    const builtInData = resolved.metadata?.builtInData || null;
    if (!builtInData) return [];
    if (builtIn === 'home') {
      const section = String(resolved.source?.section || def.section || def.mode || '').trim().toLowerCase();
      if (section === 'briefing') return builtInData.briefing || [];
      if (section === 'inbox') return builtInData.inbox || [];
      if (section === 'today') return builtInData.todayRows || [];
      if (section === 'week' || section === 'this-week') return builtInData.weekRows || [];
      if (section === 'upcoming') return builtInData.upcomingRows || [];
      if (section === 'partners') return builtInData.partners || [];
      if (section === 'projects') return builtInData.projects || [];
      if (section === 'pipeline') return builtInData.pipelineRows || [];
      if (section === 'activities') return builtInData.activityRows || [];
      return [
        { title: 'Inbox', meta: String(builtInData.inbox?.length || 0), action: { surface: 'planner.inbox' } },
        { title: 'Today', meta: String(builtInData.todayRows?.length || 0), action: { surface: 'planner.today' } },
        { title: 'Week', meta: String(builtInData.weekRows?.length || 0), action: { surface: 'planner.calendar' } },
      ];
    }
    if (builtIn === 'planner') {
      const section = String(resolved.source?.section || def.section || def.mode || '').trim().toLowerCase();
      if (section === 'overview') return builtInData.overviewRows || builtInData.briefing || [];
      if (section === 'inbox') return builtInData.inbox || [];
      if (section === 'today') return builtInData.todayRows || [];
      if (section === 'calendar' || section === 'week') return builtInData.calendarRows || [];
      if (section === 'projects') return builtInData.projectsRows || [];
      return [
        { title: 'Inbox', meta: String(builtInData.inboxCount || 0), action: { surface: 'planner.inbox' } },
        { title: 'Today', meta: String(builtInData.todayCount || 0), action: { surface: 'planner.today' } },
        { title: 'Calendar', meta: String(builtInData.calendarCount || 0), action: { surface: 'planner.calendar' } },
        { title: 'Projects', meta: String(builtInData.projectCount || 0), action: { surface: 'planner.projects' } },
      ];
    }
    if (builtIn !== 'productivity') return [];
    const section = String(resolved.source?.section || def.section || def.mode || '').trim().toLowerCase();
    if (section === 'per-day' || section === 'perday' || section === 'trend') {
      return (builtInData.perDay || [])
        .slice()
        .reverse()
        .map((item: Frontmatter) => ({
          title: fmtValue(item.date, 'date'),
          date: item.date,
          meta: `done ${item.done} · open ${item.open}${item.jChars ? ` · journal ${item.jChars}` : ''}`,
          value: Number(item.done) || 0,
          values: {
            done: Number(item.done) || 0,
            open: Number(item.open) || 0,
            journal: Number(item.jChars) || 0,
            total: (Number(item.done) || 0) + (Number(item.open) || 0),
          },
        }));
    }
    if (section === 'weeks' || section === 'weekly') {
      return (builtInData.weeks || []).map((item: Frontmatter) => ({
        title: item.label || fmtValue(item.start, 'date'),
        meta: `${item.done} done · ${item.open} open`,
        value: Number(item.done) || 0,
        values: {
          done: Number(item.done) || 0,
          open: Number(item.open) || 0,
          total: (Number(item.done) || 0) + (Number(item.open) || 0),
        },
      }));
    }
    if (section === 'weekday' || section === 'day-buckets' || section === 'daybuckets') {
      const labels = resolved.source?.labels || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      return (builtInData.dayBuckets || []).map((item: Frontmatter, idx: number) => {
        const total = item.done + item.open;
        const pct = total === 0 ? 0 : Math.round((item.done / total) * 100);
        return {
          title: labels[idx] || `DAY ${idx + 1}`,
          meta: total === 0 ? 'no data' : `${pct}% · ${item.done}/${total}`,
          value: pct,
          values: {
            pct,
            done: Number(item.done) || 0,
            open: Number(item.open) || 0,
            total,
          },
        };
      });
    }
    if (section === 'task-notes' || section === 'tasknotes' || section === 'notes') {
      return (builtInData.taskNotes || []).map((task: Frontmatter) => ({
        title: task.text || task.title || 'Task note',
        meta: `${task.date || '—'} · ${task.done ? 'done' : 'open'}`,
        file: task.file || null,
      }));
    }
    if (section === 'projects' || section === 'project') {
      return (builtInData.projectBuckets || []).map((item: Frontmatter) => ({
        title: item.title || 'Project',
        meta: item.meta || '',
        value: Number(item.value) || 0,
        values: Object.assign({}, item.values || {}),
      }));
    }
    if (section === 'contexts' || section === 'context') {
      return (builtInData.contextBuckets || []).map((item: Frontmatter) => ({
        title: item.title || 'Context',
        meta: item.meta || '',
        value: Number(item.value) || 0,
        values: Object.assign({}, item.values || {}),
      }));
    }
    if (section === 'overdue' || section === 'overdue-open') {
      return (builtInData.overdueTasks || []).map((task: Frontmatter) => ({
        title: task.title || task.file?.basename || 'Task note',
        meta: [task.due ? `due ${task.due}` : '', task.scheduled ? `scheduled ${task.scheduled}` : '', task.priority ? task.priority : '']
          .filter(Boolean)
          .join(' · '),
        file: task.file || null,
      }));
    }
    if (section === 'high-priority' || section === 'priority-open') {
      return (builtInData.highPriorityTasks || []).map((task: Frontmatter) => ({
        title: task.title || task.file?.basename || 'Task note',
        meta: [task.priority || '', task.due ? `due ${task.due}` : '', task.scheduled ? `scheduled ${task.scheduled}` : '']
          .filter(Boolean)
          .join(' · '),
        file: task.file || null,
      }));
    }
    return [
      { title: 'Tasks done', meta: String(builtInData.totalDone ?? 0) },
      { title: 'Tasks open', meta: String(builtInData.totalOpen ?? 0) },
      { title: 'Streak', meta: `${builtInData.streak ?? 0}d` },
    ];
  }

  async _renderWidgetByKind(col: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const kind = String(card.kind || '').trim().toLowerCase();
    if (!kind) return false;
    if (kind === 'kanban') {
      await this._renderKanbanWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'list') {
      await this._renderListWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'task-list' || kind === 'tasklist' || kind === 'checklist') {
      await this._renderTaskListWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'quick-add' || kind === 'quickadd') {
      this._renderQuickAddWidget(col, card);
      return true;
    }
    if (kind === 'date-hero' || kind === 'date') {
      this._renderDateHeroWidget(col, card);
      return true;
    }
    if (kind === 'note-section' || kind === 'journal') {
      await this._renderNoteSectionWidget(col, card);
      return true;
    }
    if (kind === 'bar-chart' || kind === 'chart-bar') {
      await this._renderBarChartWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'gauge' || kind === 'score-gauge' || kind === 'dial') {
      await this._renderGaugeWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'progress' || kind === 'progress-bar') {
      await this._renderProgressWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'heatmap' || kind === 'streak-heatmap') {
      await this._renderHeatmapWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'base-link') {
      await this._renderBaseLinkWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'base-embed') {
      await this._renderBaseEmbedWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'base-view') {
      await this._renderBaseViewWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'markdown') {
      await this._renderMarkdownWidget(col, card);
      return true;
    }
    if (kind === 'actions') {
      await this._renderActionsWidget(col, card);
      return true;
    }
    if (kind === 'selector') {
      await this._renderSelectorWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'date-range') {
      await this._renderDateRangeWidget(col, card);
      return true;
    }
    return false;
  }

  _dashboardStateFor(surfaceId: string) {
    const state = this._dashboardState || (this._dashboardState = {});
    const persisted = this.plugin.settings.dashboardState || (this.plugin.settings.dashboardState = {});
    if (!state[surfaceId]) {
      state[surfaceId] = cloneConfig(persisted[surfaceId] || {});
      persisted[surfaceId] = state[surfaceId];
    } else if (persisted[surfaceId] !== state[surfaceId]) {
      persisted[surfaceId] = state[surfaceId];
    }
    return state[surfaceId];
  }

  async _persistDashboardState() {
    try {
      await this.plugin.saveSettings();
    } catch (_) {}
  }

  async _resolveBaseWidgetTarget(card: CardLike) {
    // Resolve the base + view through the SAME normalizer every other widget
    // uses (_widgetSourceSpec), so base-view/base-embed/base-link accept BOTH
    // config shapes identically: top-level `base`/`entity`/`view` and the
    // `source: { base: {file, view} }` form the designer's picker writes. No
    // separate resolution path.
    const spec = this._widgetSourceSpec(card, card.entity as string | null) as Frontmatter;
    const specBase = spec.base;
    const explicitBase = typeof specBase === 'string' ? specBase
      : (specBase && typeof specBase === 'object' ? String((specBase as Frontmatter).file || (specBase as Frontmatter).base || (specBase as Frontmatter).path || (specBase as Frontmatter).basePath || '') : '');
    const specView = String(spec.view || (specBase && typeof specBase === 'object' ? ((specBase as Frontmatter).view || (specBase as Frontmatter).baseView || (specBase as Frontmatter).base_view || '') : '') || '');
    const entityKey = String(spec.entity || '').trim();
    // An explicit base path/filename is used as authored; an entity with no
    // explicit base falls back to its mapped base (entityBasePath, which honors
    // basesFolder + verbatim directory paths).
    const basePath = (explicitBase || (entityKey ? entityBasePath(this.plugin.settings, entityKey) : '')).trim();
    const viewName = specView.trim();
    const label = String(card.title || 'Base').trim();
    const description = String(card.description || card.subtitle || '').trim();
    const resolvedEntity = entityKey ? await this._resolveWidgetEntities(null, entityKey).catch((): null => null) : null;
    const entityDef = resolvedEntity?.def || ENTITIES[entityKey] || null;
    const summary = basePath ? await readBaseSummary(this.app, this.app.vault.getAbstractFileByPath(basePath) as obsidian.TFile).catch((): null => null) : null;
    return { baseDef: (typeof specBase === 'object' ? specBase : {}) as Frontmatter, entityKey, basePath, viewName, label, description, entityDef, summary };
  }

  async _renderBaseLinkWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const { entityKey, basePath, viewName, label, description, entityDef, summary } = await this._resolveBaseWidgetTarget(card);

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-base-link-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'base-link' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    if (viewName) head.createSpan({ cls: 'cad-widget-catalog-badge', text: viewName });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (description) body.createDiv({ cls: 'cad-dash-card-sub', text: description });
    if (basePath) {
      body.createDiv({ cls: 'cad-dash-card-path', text: basePath });
    } else {
      body.createDiv({ cls: 'cad-empty', text: 'No Base file selected.' });
    }
    if (summary) {
      const meta = body.createDiv({ cls: 'cad-dashboard-inventory-meta' });
      meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.label || 'base' });
      if (Array.isArray(summary.views) && summary.views.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: `${summary.views.length} views` });
      }
      if (Array.isArray(summary.typeFilters) && summary.typeFilters.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.typeFilters.join(', ') });
      }
    }
    if ((entityDef?.externalBaseView as BaseViewRef | undefined)?.basePath) {
      body.createDiv({ cls: 'setting-item-description', text: `Entity-backed Base target for ${entityDef.label} is available through the configured entity mapping.` });
    }
    const actions = body.createDiv({ cls: 'cad-de-actions' });
    const openBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Open Base' });
    openBtn.addEventListener('click', async () => {
      if (entityKey && entityDef?.externalBaseView) {
        this._openEntityBase(entityKey);
        return;
      }
      if (!basePath) return;
      const file = this.app.vault.getAbstractFileByPath(basePath);
      if (file instanceof obsidian.TFile) {
        await this.app.workspace.openLinkText(file.path, '', false);
      } else {
        new obsidian.Notice(`Base file not found: ${basePath}`);
      }
    });
    if (viewName && basePath) {
      const copyBtn = actions.createEl('button', { cls: 'cad-btn', text: 'Copy config' });
      copyBtn.addEventListener('click', async () => {
        const snippet = JSON.stringify({ base: { file: basePath, view: viewName } }, null, 2);
        try {
          await navigator.clipboard.writeText(snippet);
          new obsidian.Notice('Copied Base widget config.');
        } catch (_) {}
      });
    }
  }

  async _renderBaseEmbedWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const { entityKey, basePath, viewName, label, description, entityDef, summary } = await this._resolveBaseWidgetTarget(card);
    const entitySource = entityKey ? await getWidgetEntities(this._widgetSourceSpec(card, entityKey), entityKey).catch((): null => null) : null;
    const entities = entitySource?.entities || [];
    const titleFields = Array.isArray(card.titleFields) && card.titleFields.length
      ? card.titleFields
      : ['title', 'name', 'subject'];
    const metaFields = Array.isArray(card.metaFields) && card.metaFields.length
      ? card.metaFields
      : [String(card.groupBy || card.field || '').trim(), 'status', 'date', 'value'].filter(Boolean);
    const limit = Math.max(1, Number(card.limit || 5) || 5);
    const preview = entities.slice(0, limit);

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-base-embed-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'base-embed' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    if (viewName) head.createSpan({ cls: 'cad-widget-catalog-badge', text: viewName });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (description) body.createDiv({ cls: 'cad-dash-card-sub', text: description });
    if (basePath) body.createDiv({ cls: 'cad-dash-card-path', text: basePath });

    const meta = body.createDiv({ cls: 'cad-dashboard-inventory-meta' });
    if (summary) {
      meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.label || 'base' });
      if (Array.isArray(summary.views) && summary.views.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: `${summary.views.length} views` });
      }
      if (Array.isArray(summary.typeFilters) && summary.typeFilters.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.typeFilters.join(', ') });
      }
    }
    meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: `${preview.length}${entities.length > preview.length ? ` / ${entities.length}` : ''} rows` });
    if ((entityDef?.externalBaseView as BaseViewRef | undefined)?.basePath) {
      meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: 'external view' });
    }

    const actions = body.createDiv({ cls: 'cad-de-actions' });
    const openBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Open Base' });
    openBtn.addEventListener('click', async () => {
      if (entityKey && entityDef?.externalBaseView) {
        this._openEntityBase(entityKey);
        return;
      }
      if (!basePath) return;
      const file = this.app.vault.getAbstractFileByPath(basePath);
      if (file instanceof obsidian.TFile) {
        await this.app.workspace.openLinkText(file.path, '', false);
      } else {
        new obsidian.Notice(`Base file not found: ${basePath}`);
      }
    });

    if (!preview.length) {
      body.createDiv({ cls: 'cad-empty', text: entitySource ? 'No rows matched this Base/view.' : 'No rows available for preview.' });
      return;
    }

    const list = body.createDiv({ cls: 'cad-home-list cad-base-embed-list' });
    preview.forEach((entity: EntityRecord) => {
      const row = list.createDiv({ cls: 'cad-home-row cad-base-embed-row' });
      const title = titleFields.map((field: string) => String(entityValue(entity, field, entityDef) || '').trim()).find(Boolean) || entity.basename;
      const metaBits = metaFields
        .map((field: string) => fmtValue(entityValue(entity, field, entityDef), entityDef?.fields?.find((f) => f.key === field)?.type))
        .filter(Boolean);
      row.createDiv({ cls: 'cad-home-row-date', text: entity.file?.basename || '' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: title });
      if (metaBits.length) {
        main.createDiv({ cls: 'cad-home-row-meta', text: metaBits.join(' · ') });
      }
      if (entity.file) {
        row.classList.add('clickable');
        row.addEventListener('click', () => this.openEntityDetailFromFile(entity.file));
      }
    });
  }

  _normalizeBaseViewHeight(value: unknown) {
    if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null;
    if (String(value).trim().toLowerCase() === 'auto') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 360;
  }

  async _renderBaseViewWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const target = await this._resolveBaseWidgetTarget(card);
    const { basePath, viewName, label } = target;

    if (!basePath) {
      await this._renderBaseViewFallback(root, card, getWidgetEntities, 'No Base file configured');
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(basePath);
    if (!(file instanceof obsidian.TFile)) {
      await this._renderBaseViewFallback(root, card, getWidgetEntities, `Base file not found: ${basePath}`);
      return;
    }

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-base-view-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'base-view' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label || card.title || 'Base view' });
    if (viewName) head.createSpan({ cls: 'cad-widget-catalog-badge', text: viewName });

    const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-base-view-body' });
    const normalizedHeight = this._normalizeBaseViewHeight(card.height);
    if (normalizedHeight) body.style.height = `${normalizedHeight}px`;

    try {
      await this._mountLiveBaseView(body, file, basePath, viewName);
    } catch (err) {
      body.empty();
      await this._renderBaseViewFallbackContent(body, card, getWidgetEntities, err?.message || String(err || 'Base view unavailable'));
    }
  }

  async _mountLiveBaseView(body: HTMLElement, file: obsidian.TFile, basePath: string, viewName: string) {
    // Render the real Base view via the embed registry (the static
    // MarkdownRenderer only leaves an unloaded placeholder for .base files). The
    // view is selected by the SUBPATH, which — like every Obsidian subpath —
    // INCLUDES the leading `#`. Passing a bare name (no `#`) is what made it fall
    // back to the base's default view.
    const reg = (this.app as AppWithInternals).embedRegistry;
    const creator = reg?.embedByExtension?.base || reg?.getEmbedCreator?.(file);
    if (!creator) throw new Error('Base embed unavailable (Obsidian Bases API not found)');
    const subpath = viewName ? `#${viewName}` : '';
    const linktext = `${basePath}${subpath}`;
    const embed = creator(
      { app: this.app, containerEl: body, sourcePath: basePath, linktext, showInline: true, depth: 0 },
      file,
      subpath,
    );
    if (!embed) throw new Error('Base embed creator returned no embed');
    if (typeof this.addChild === 'function') this.addChild(embed);
    await (embed.loadFile?.() ?? embed.load?.());
    // View is applied by the constructor subpath (verified load-bearing).
    // Give it a moment to mount, then confirm an embed wrapper is present.
    for (let i = 0; i < 20; i++) {
      await this._waitForBaseEmbedRender();
      if (this._baseEmbedMounted(body, `![[${linktext}]]`, linktext)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Base view did not render inline');
  }

  async _waitForBaseEmbedRender() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => {
      const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : null);
      if (raf) raf(resolve);
      else setTimeout(resolve, 0);
    });
  }

  // True once an embed wrapper for the Base has mounted (it may still be loading
  // rows). Fails only when nothing embedded, the link is unresolved, or the body
  // is just the literal `![[…]]` / path text.
  _baseEmbedMounted(body: HTMLElement, md: string, linktext: string) {
    const embed = body.querySelector?.([
      '.bases-embed', '.base-embed', '.bases-view', '.bases-embed-container',
      '.bases-view-container', '.block-language-base', '[data-type="base"]',
      '[data-embed-type="base"]', '[src$=".base"]',
      '.internal-embed', '.markdown-embed', '.file-embed',
    ].join(','));
    if (!embed) return false;
    if ((embed as HTMLElement).classList?.contains('is-unresolved')) return false;
    const text = String(body.textContent || '').replace(/\s+/g, ' ').trim();
    const basePathOnly = String(linktext || '').split('#')[0] || '';
    if (text === md || text === linktext || text === basePathOnly) return false;
    return true;
  }

  async _renderBaseViewFallback(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities, reason: string) {
    const mode = String(card.fallback || 'preview').trim().toLowerCase();
    if (mode === 'preview') {
      await this._renderBaseEmbedWidget(root, card, getWidgetEntities);
      return;
    }
    if (mode === 'link') {
      await this._renderBaseLinkWidget(root, card, getWidgetEntities);
      return;
    }
    const fallbackCard = root.createDiv({ cls: 'cad-dash-card cad-base-view-card cad-base-view-fallback' });
    this._applyCardTone(fallbackCard, Object.assign({ kind: 'base-view' }, card));
    const head = fallbackCard.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: card.title || 'Base view' });
    fallbackCard.createDiv({ cls: 'cad-dash-card-body' })
      .createDiv({ cls: 'cad-soon-desc', text: `Base view unavailable (${reason})` });
  }

  async _renderBaseViewFallbackContent(body: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities, reason: string) {
    const mode = String(card.fallback || 'preview').trim().toLowerCase();
    if (mode === 'link') {
      const target = await this._resolveBaseWidgetTarget(card);
      body.createDiv({ cls: 'cad-soon-desc', text: reason });
      if (target.basePath) {
        const btn = body.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Open Base' });
        btn.addEventListener('click', () => this.app.workspace.openLinkText(target.basePath, '', false));
      }
      return;
    }
    if (mode === 'preview' && typeof getWidgetEntities === 'function') {
      const target = await this._resolveBaseWidgetTarget(card);
      const resolved = target.entityKey
        ? await getWidgetEntities(this._widgetSourceSpec(card, target.entityKey), target.entityKey).catch((): null => null)
        : null;
      const entities = Array.isArray(resolved?.entities) ? resolved.entities : [];
      const rows = entities.slice(0, Math.max(1, Number(card.limit || 5) || 5));
      body.createDiv({ cls: 'cad-soon-desc', text: reason });
      if (rows.length) {
        const list = body.createDiv({ cls: 'cad-base-embed-list cad-base-view-preview-list' });
        rows.forEach((entity: EntityRecord & Frontmatter) => {
          const row = list.createDiv({ cls: 'cad-base-embed-row' });
          row.createDiv({ cls: 'cad-home-row-title', text: entity?.title || entity?.name || entity?.file?.basename || entity?.basename || 'Untitled' });
          if (entity?.file) {
            row.classList.add('clickable');
            row.addEventListener('click', () => this.openEntityDetailFromFile(entity.file));
          }
        });
      } else {
        body.createDiv({ cls: 'cad-empty', text: 'No rows available for preview.' });
      }
      if (target.basePath) {
        const btn = body.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Open Base' });
        btn.addEventListener('click', () => this.app.workspace.openLinkText(target.basePath, '', false));
      }
      return;
    }
    body.createDiv({ cls: 'cad-soon-desc', text: `Base view unavailable (${reason})` });
  }

  async _resolveMarkdownWidgetContent(card: CardLike) {
    const source = card.source;
    const body = String(card.body || card.markdown || card.text || '').trim();
    const heading = String(card.heading || card.section || '').trim();
    if (body) return { text: body, sourcePath: '' };

    const sourcePath = typeof source === 'string'
      ? source
      : String(source?.file || source?.path || source?.note || source?.source || '').trim();
    if (!sourcePath) return { text: '', sourcePath: '' };

    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof obsidian.TFile)) return { text: '', sourcePath };
    let content;
    try { content = await this.app.vault.read(file); }
    catch (_) { return { text: '', sourcePath: file.path }; } // file removed mid-render
    if (!heading) return { text: content, sourcePath: file.path };

    const sections = parseH2Sections(content);
    if (sections[heading] != null) return { text: sections[heading], sourcePath: file.path };
    const normalizedHeading = heading.toLowerCase();
    const match = Object.entries(sections).find(([key]) => key.trim().toLowerCase() === normalizedHeading);
    return { text: match ? match[1] : content, sourcePath: file.path };
  }

  async _renderMarkdownWidget(root: HTMLElement, card: CardLike) {
    const title = String(card.title || 'Note').trim();
    const subtitle = String(card.subtitle || card.description || '').trim();
    const { text, sourcePath } = await this._resolveMarkdownWidgetContent(card);
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-markdown-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'markdown' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: title });
    if (sourcePath) head.createSpan({ cls: 'cad-widget-catalog-badge', text: sourcePath.split('/').pop().replace(/\.md$/i, '') });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-markdown-body' });
    if (subtitle) body.createDiv({ cls: 'cad-dash-card-sub', text: subtitle });
    if (!text) {
      body.createDiv({ cls: 'cad-empty', text: 'No markdown content supplied.' });
      return;
    }
    const target = body.createDiv({ cls: 'cad-markdown-render' });
    try {
      if (obsidian.MarkdownRenderer?.renderMarkdown) {
        await obsidian.MarkdownRenderer.renderMarkdown(text, target, sourcePath || '', this);
      } else {
        target.createEl('pre', { text });
      }
    } catch (_) {
      target.createEl('pre', { text });
    }
  }

  _normalizeActionSpec(action: ActionInput): ActionSpec | null {
    if (!action) return null;
    if (typeof action === 'string') return { label: action, command: action };
    if (typeof action !== 'object' || Array.isArray(action)) return null;
    const spec = Object.assign({}, action);
    spec.label = String(spec.label || spec.title || spec.text || spec.name || 'Action').trim();
    spec.type = String(spec.type || spec.kind || spec.action || '').trim().toLowerCase();
    spec.command = String(spec.command || spec.commandId || spec.cmd || '').trim();
    spec.surface = String(spec.surface || spec.mode || spec.route || spec.view || '').trim();
    spec.entityKey = String(spec.entityKey || spec.entity || '').trim();
    spec.path = String(spec.path || spec.file || spec.note || '').trim();
    spec.url = String(spec.url || spec.href || '').trim();
    return spec;
  }

  async _runActionSpec(action: ActionInput) {
    const spec = this._normalizeActionSpec(action);
    if (!spec) return;
    if (spec.type === 'surface' || spec.surface) {
      this.setMode(spec.surface);
      return;
    }
    if (spec.type === 'quick-capture' || spec.label.toLowerCase() === 'quick capture') {
      this.plugin.openQuickCapture();
      return;
    }
    if (spec.type === 'today-task') {
      this._quickAddTodayTask();
      return;
    }
    if (spec.type === 'command' || spec.command) {
      if (spec.command) {
        try {
          await (this.app as AppWithInternals).commands.executeCommandById(spec.command);
        } catch (e) {
          new obsidian.Notice(`Failed to run command: ${e.message}`);
        }
      }
      return;
    }
    if (spec.type === 'url' || spec.url) {
      if (spec.url) window.open(spec.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (spec.type === 'note' || spec.path) {
      if (!spec.path) return;
      const file = this.app.vault.getAbstractFileByPath(spec.path);
      if (file instanceof obsidian.TFile) {
        await this.app.workspace.openLinkText(file.path, '', false);
      } else {
        new obsidian.Notice(`Note not found: ${spec.path}`);
      }
      return;
    }
    if (spec.type === 'create' || spec.type === 'create-entity' || spec.entityKey) {
      if (!spec.entityKey) return;
      await this._createEntityFromPrompt(spec.entityKey);
      return;
    }
  }

  async _renderActionsWidget(root: HTMLElement, card: CardLike) {
    const actions = Array.isArray(card.actions)
      ? card.actions
      : Array.isArray(card.buttons)
        ? card.buttons
        : [];
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-actions-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'actions' }, card));
    const title = String(card.title || '').trim();
    if (title) {
      const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
      head.createDiv({ cls: 'cad-dash-card-title', text: title });
    }
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    const bar = body.createDiv({ cls: 'cad-actions-bar' });
    if (!actions.length) {
      bar.createDiv({ cls: 'cad-empty', text: 'No actions configured.' });
      return;
    }
    actions.map((action: ActionInput) => this._normalizeActionSpec(action)).filter(Boolean).forEach((action: ActionSpec) => {
      const isCreate = !!action.entityKey;
      const isPrimaryAction = action.type === 'quick-capture' || action.type === 'today-task' || isCreate || !!action.primary;
      const btn = bar.createEl('button', {
        cls: `cad-btn${(isPrimaryAction ? ' primary' : '')}${action.danger ? ' cad-btn-danger' : ''}`,
        text: action.entityKey
          ? `+ New ${ENTITIES[action.entityKey]?.label || action.entityKey}`
          : (action.type === 'quick-capture' ? '+ Capture' : action.label),
      });
      if (action.description) btn.title = action.description;
      btn.addEventListener('click', async () => { await this._runActionSpec(action); });
    });
  }

  async _renderSelectorWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const surfaceId = this.mode;
    const state = this._dashboardStateFor(surfaceId);
    const key = String(card.key || card.name || card.field || card.entity || '').trim();
    const label = String(card.label || card.title || key || 'Filter').trim();
    const filterKey = `${key}Filter`;
    const dateRangeMode = String(card.mode || card.type || '').trim().toLowerCase() === 'date-range';
    if (!key) {
      const cardEl = root.createDiv({ cls: 'cad-dash-card cad-selector-card' });
      this._applyCardTone(cardEl, Object.assign({ kind: 'selector' }, card));
      const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
      body.createDiv({ cls: 'cad-empty', text: 'Selector needs a key.' });
      return;
    }

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-selector-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'selector' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }

    const row = body.createDiv({ cls: 'cad-selector-row' });
    const select = row.createEl('select', { cls: 'dropdown cad-selector-select' });

    const options: SelectorOption[] = [];
    const allLabel = String(card.allLabel || 'All').trim();
    options.push({ value: '', label: allLabel, filter: 'true' });

    if (dateRangeMode) {
      const today = startOfDay(new Date());
      const y = today.getFullYear();
      const m = today.getMonth();
      const startOfMonth = startOfDay(new Date(y, m, 1));
      const endOfMonth = startOfDay(new Date(y, m + 1, 0));
      const weekStart = startOfWeek(today, this.plugin.settings.weekStartsOn || 1);
      const weekEnd = addDays(weekStart, 6);
      const q = Math.floor(m / 3);
      const quarterStart = startOfDay(new Date(y, q * 3, 1));
      const quarterEnd = startOfDay(new Date(y, q * 3 + 3, 0));
      const addRange = (value: string, labelText: string, from: Date, to: Date) => {
        const field = String(card.field || 'date').trim();
        options.push({
          value,
          label: labelText,
          filter: `${field} >= ${JSON.stringify(ymd(from))} && ${field} <= ${JSON.stringify(ymd(to))}`,
        });
      };
      addRange('today', 'Today', today, today);
      addRange('this-week', 'This week', weekStart, weekEnd);
      addRange('this-month', 'This month', startOfMonth, endOfMonth);
      addRange('last-30-days', 'Last 30 days', addDays(today, -29), today);
      addRange('this-quarter', 'This quarter', quarterStart, quarterEnd);
    } else if (Array.isArray(card.options) && card.options.length) {
      card.options.forEach((opt: SelectorOptionLike) => {
        if (opt == null) return;
        if (typeof opt === 'string' || typeof opt === 'number') {
          const value = String(opt);
          options.push({ value, label: value, filter: `${String(card.field || '').trim()} == ${JSON.stringify(value)}` });
          return;
        }
        if (typeof opt === 'object') {
          const value = String(opt.value ?? opt.id ?? opt.key ?? opt.label ?? '').trim();
          if (!value) return;
          options.push({
            value,
            label: String(opt.label || opt.title || value).trim(),
            filter: String(opt.filter || `${String(card.field || '').trim()} == ${JSON.stringify(value)}`),
          });
        }
      });
    } else if (card.entity && card.field) {
      const resolved = await getWidgetEntities(this._widgetSourceSpec(card, card.entity), card.entity).catch((): null => null);
      const entities = resolved?.entities || [];
      const def = resolved?.def || ENTITIES[card.entity];
      const fieldKey = String(card.field || '').trim();
      const values = new Set<string>();
      entities.forEach((entity) => {
        const raw = entityValue(entity, fieldKey, def);
        const valuesList = Array.isArray(raw) ? raw : [raw];
        valuesList.forEach((value) => {
          const normalized = String(value ?? '').trim();
          if (normalized) values.add(normalized);
        });
      });
      [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).forEach((value) => {
        options.push({ value, label: value, filter: `${fieldKey} == ${JSON.stringify(value)}` });
      });
    }

    options.forEach((opt) => {
      const option = select.createEl('option', { value: opt.value, text: opt.label });
      if ((state[key] ?? String(card.default || '').trim()) === opt.value) option.selected = true;
    });

    const syncState = () => {
      const selected = options.find((opt) => opt.value === select.value) || options[0] || { value: '', filter: 'true' };
      state[key] = selected.value;
      state[filterKey] = selected.filter || 'true';
    };
    syncState();
    select.addEventListener('change', async () => {
      syncState();
      await this._persistDashboardState();
      await this.render();
    });

    const hint = body.createDiv({ cls: 'cad-selector-hint' });
    hint.createSpan({ text: `${key}: ` });
    hint.createSpan({ cls: 'cad-selector-current', text: select.value || allLabel });
  }

  async _renderDateRangeWidget(root: HTMLElement, card: CardLike) {
    const surfaceId = this.mode;
    const state = this._dashboardStateFor(surfaceId);
    const key = String(card.key || card.name || card.field || 'dateRange').trim();
    const label = String(card.label || card.title || key || 'Date range').trim();
    const field = String(card.field || 'date').trim();
    const filterKey = `${key}Filter`;
    const startKey = `${key}Start`;
    const endKey = `${key}End`;
    const presetKey = `${key}Preset`;
    const current = String(state[presetKey] || card.default || 'this-month').trim() || 'this-month';
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-selector-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'date-range' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }

    const presets = [
      { value: 'all', label: String(card.allLabel || 'All').trim(), from: '', to: '', filter: 'true' },
      { value: 'today', label: 'Today', from: startOfDay(new Date()), to: startOfDay(new Date()) },
      { value: 'this-week', label: 'This week', from: startOfWeek(new Date(), this.plugin.settings.weekStartsOn || 1), to: addDays(startOfWeek(new Date(), this.plugin.settings.weekStartsOn || 1), 6) },
      { value: 'this-month', label: 'This month', from: startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: startOfDay(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)) },
      { value: 'last-30-days', label: 'Last 30 days', from: addDays(startOfDay(new Date()), -29), to: startOfDay(new Date()) },
      { value: 'this-quarter', label: 'This quarter', from: startOfDay(new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1)), to: startOfDay(new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3 + 3, 0)) },
      { value: 'custom', label: 'Custom', from: state[startKey] ? new Date(state[startKey]) : '', to: state[endKey] ? new Date(state[endKey]) : '' },
    ];

    const toYmd = (value: string | number | Date) => {
      const d = value instanceof Date ? value : new Date(value);
      return isNaN(d.getTime()) ? '' : ymd(d);
    };
    const updateFromPreset = (presetValue: string) => {
      const preset = presets.find((item) => item.value === presetValue) || presets[3];
      state[presetKey] = preset.value;
      state[key] = preset.value;
      if (preset.value === 'all') {
        delete state[startKey];
        delete state[endKey];
        state[filterKey] = 'true';
        return;
      }
      if (preset.value === 'custom') {
        const start = state[startKey] ? toYmd(state[startKey]) : '';
        const end = state[endKey] ? toYmd(state[endKey]) : '';
        state[filterKey] = start && end ? `${field} >= ${JSON.stringify(start)} && ${field} <= ${JSON.stringify(end)}` : 'true';
        return;
      }
      const from = toYmd(preset.from);
      const to = toYmd(preset.to);
      state[startKey] = from;
      state[endKey] = to;
      state[filterKey] = from && to ? `${field} >= ${JSON.stringify(from)} && ${field} <= ${JSON.stringify(to)}` : 'true';
    };
    if (!state[presetKey]) updateFromPreset(current);

    const presetRow = body.createDiv({ cls: 'cad-selector-row' });
    const presetSelect = presetRow.createEl('select', { cls: 'dropdown cad-selector-select' });
    presets.forEach((preset) => {
      const option = presetSelect.createEl('option', { value: preset.value, text: preset.label });
      if ((state[presetKey] || current) === preset.value) option.selected = true;
    });

    const rangeWrap = body.createDiv({ cls: 'cad-date-range' });
    const startInput = rangeWrap.createEl('input', { type: 'date', cls: 'cad-selector-date' });
    const endInput = rangeWrap.createEl('input', { type: 'date', cls: 'cad-selector-date' });
    startInput.value = state[startKey] || '';
    endInput.value = state[endKey] || '';
    startInput.disabled = (state[presetKey] || current) !== 'custom';
    endInput.disabled = (state[presetKey] || current) !== 'custom';

    const renderState = async () => {
      await this._persistDashboardState();
      await this.render();
    };
    presetSelect.addEventListener('change', async () => {
      updateFromPreset(presetSelect.value);
      startInput.disabled = presetSelect.value !== 'custom';
      endInput.disabled = presetSelect.value !== 'custom';
      await renderState();
    });
    const commitCustom = async () => {
      state[presetKey] = 'custom';
      state[key] = 'custom';
      state[startKey] = startInput.value || '';
      state[endKey] = endInput.value || '';
      state[filterKey] = startInput.value && endInput.value
        ? `${field} >= ${JSON.stringify(startInput.value)} && ${field} <= ${JSON.stringify(endInput.value)}`
        : 'true';
      await renderState();
    };
    startInput.addEventListener('change', commitCustom);
    endInput.addEventListener('change', commitCustom);

    const hint = body.createDiv({ cls: 'cad-selector-hint' });
    hint.createSpan({ text: `${key}: ` });
    hint.createSpan({ cls: 'cad-selector-current', text: state[presetKey] || current });
  }

  _coerceFiniteNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  _normalizePercent(value: number, max = 100) {
    const safeMax = Math.max(1, Number(max) || 100);
    return Math.max(0, Math.min(100, Math.round((value / safeMax) * 100)));
  }

  _explicitScalarValue(card: CardLike): number | null {
    for (const key of ['value', 'score', 'percent', 'pct', 'current']) {
      if (card[key] === undefined || card[key] === null || card[key] === '') continue;
      const n = Number(card[key]);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  _aggregateEntitiesForScalar(card: CardLike, resolved: ResolvedWidgetSource): number {
    const entities = resolved.entities || [];
    const entityKey = resolved.entityKey || card.entity || '';
    const def = resolved.def || ENTITIES[entityKey] || null;
    const field = String(card.field || card.valueField || '').trim();
    const metric = String(card.metric || card.aggregate || (field ? 'avg' : 'count')).trim().toLowerCase();
    const numericValue = (entity: EntityRecord) => Number(entityValue(entity, field, def)) || 0;
    const values = field ? entities.map(numericValue).filter((value) => Number.isFinite(value)) : [];
    if (metric === 'sum') return values.reduce((sum, value) => sum + value, 0);
    if (metric === 'min') return values.length ? Math.min(...values) : 0;
    if (metric === 'max') return values.length ? Math.max(...values) : 0;
    if (metric === 'filled') return field ? entities.filter((entity) => hasBaseValue(entityValue(entity, field, def))).length : 0;
    if (metric === 'empty') return field ? entities.filter((entity) => !hasBaseValue(entityValue(entity, field, def))).length : 0;
    if (metric === 'open') return entityKey ? entities.filter((entity) => this._isOpenEntity(entity, entityKey)).length : 0;
    if (metric === 'unique' || metric === 'uniquecount') {
      return field ? new Set(entities.map((entity) => String(entityValue(entity, field, def) || '').trim()).filter(Boolean)).size : 0;
    }
    if (metric === 'ratio') {
      const numeratorSpec = card.numerator ?? card.ratio?.numerator ?? card.ratio?.top ?? card.ratio?.value;
      const denominatorSpec = card.denominator ?? card.ratio?.denominator ?? card.ratio?.bottom ?? card.ratio?.total;
      const resolveRatioValue = (spec: unknown) => {
        if (typeof spec === 'number') return spec;
        if (typeof spec === 'string' && spec.trim()) {
          return entities.reduce((sum, entity) => sum + (Number(entityValue(entity, spec.trim(), def)) || 0), 0);
        }
        return 0;
      };
      const numerator = resolveRatioValue(numeratorSpec);
      const denominator = resolveRatioValue(denominatorSpec);
      return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
    }
    if (metric === 'avg') return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return entities.length;
  }

  async _resolveScalarWidgetValue(card: CardLike, getWidgetEntities: GetWidgetEntities): Promise<ScalarWidgetValue> {
    const max = Math.max(1, this._coerceFiniteNumber(card.max ?? card.target ?? card.total, 100));
    let value = this._explicitScalarValue(card);
    let resolved: ResolvedWidgetSource | null = null;
    const field = String(card.field || card.valueField || card.metric || '').trim();
    const sourceSpec = this._widgetSourceSpec(card, card.entity);
    const hasSource = !!card.source || !!card.entity || !!sourceSpec?.builtIn || !!sourceSpec?.mode;

    if (value == null && hasSource) {
      resolved = await getWidgetEntities(sourceSpec, card.entity).catch((): null => null);
      const builtInData = resolved?.metadata?.builtInData || resolved?.metadata?.providerData || null;
      if (builtInData && field && Object.prototype.hasOwnProperty.call(builtInData, field)) {
        value = Number(builtInData[field]) || 0;
      } else if (resolved?.source?.mode === 'built-in' || resolved?.metadata?.builtIn) {
        const rows = this._resolveBuiltInRows(card, resolved);
        const metric = String(card.metric || card.aggregate || 'avg').trim().toLowerCase();
        const values = rows.map((row) => dashboardProviderRowValue(row, field)).filter((n) => Number.isFinite(n));
        if (metric === 'sum') value = values.reduce((sum, n) => sum + n, 0);
        else if (metric === 'count') value = rows.length;
        else if (metric === 'min') value = values.length ? Math.min(...values) : 0;
        else if (metric === 'max') value = values.length ? Math.max(...values) : 0;
        else value = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
      } else if (resolved) {
        value = this._aggregateEntitiesForScalar(card, resolved);
      }
    }

    value = Number.isFinite(Number(value)) ? Number(value) : 0;
    const percent = this._normalizePercent(value, max);
    const suffix = String(card.suffix ?? (max === 100 ? '%' : '')).trim();
    const label = String(card.label || card.title || '').trim();
    const sub = String(card.sub || card.subtitle || card.description || '').trim();
    return { value, max, percent, label, sub, suffix };
  }

  _formatScalarValue(resolved: ScalarWidgetValue, card: CardLike) {
    if (card.format === 'currency') return fmtValue(resolved.value, 'currency');
    if (card.format === 'number') return fmtValue(resolved.value, 'number');
    const display = Math.round(resolved.value * 10) / 10;
    return `${Number.isInteger(display) ? String(display) : display.toFixed(1)}${resolved.suffix}`;
  }

  async _renderGaugeWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const resolved = await this._resolveScalarWidgetValue(card, getWidgetEntities);
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-gauge-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'gauge' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'Gauge').trim() });
    head.createSpan({ cls: 'cad-widget-catalog-badge', text: `${resolved.percent}%` });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-gauge-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    const gauge = body.createDiv({ cls: 'cad-gauge' });
    gauge.dataset.pctBand = pctBand(resolved.percent);
    gauge.style.setProperty('--cad-gauge-pct', `${resolved.percent}%`);
    gauge.title = `${resolved.percent}% of ${resolved.max}`;
    const center = gauge.createDiv({ cls: 'cad-gauge-center' });
    center.createDiv({ cls: 'cad-gauge-value', text: this._formatScalarValue(resolved, card) });
    center.createDiv({ cls: 'cad-gauge-label', text: String(card.caption || resolved.label || 'score').trim() });
    if (resolved.sub) body.createDiv({ cls: 'cad-gauge-sub', text: resolved.sub });
  }

  async _renderProgressWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const resolved = await this._resolveScalarWidgetValue(card, getWidgetEntities);
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-progress-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'progress' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'Progress').trim() });
    head.createSpan({ cls: 'cad-widget-catalog-badge', text: `${resolved.percent}%` });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-progress-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    const top = body.createDiv({ cls: 'cad-progress-widget-label' });
    top.createSpan({ text: String(card.label || resolved.label || 'Built').trim() });
    top.createSpan({ cls: 'cad-progress-widget-value', text: this._formatScalarValue(resolved, card) });
    const track = body.createDiv({ cls: 'cad-progress-widget-track' });
    track.dataset.pctBand = pctBand(resolved.percent);
    const fill = track.createDiv({ cls: 'cad-progress-widget-fill' });
    fill.style.width = `${resolved.percent}%`;
    if (resolved.sub) body.createDiv({ cls: 'cad-progress-widget-sub', text: resolved.sub });
  }

  _heatmapDateFromValue(value: unknown): Date | null {
    if (value instanceof Date && !isNaN(value.getTime())) return startOfDay(value);
    if (typeof value === 'number' && Number.isFinite(value)) {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : startOfDay(d);
    }
    const text = String(value || '').trim();
    if (!text) return null;
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : startOfDay(d);
  }

  _heatmapValueFromRow(row: Frontmatter, field: string) {
    if (field) return dashboardProviderRowValue(row, field);
    return dashboardProviderRowValue(row, '');
  }

  async _resolveHeatmapBuckets(card: CardLike, getWidgetEntities: GetWidgetEntities): Promise<HeatmapBucket[]> {
    const days = Math.max(7, Math.min(371, Number(card.days || 35) || 35));
    const end = startOfDay(new Date());
    const start = addDays(end, -(days - 1));
    const buckets = new Map<string, HeatmapBucket>();
    for (let idx = 0; idx < days; idx++) {
      const date = addDays(start, idx);
      buckets.set(ymd(date), { date, key: ymd(date), value: 0 });
    }
    const field = String(card.valueField || card.field || '').trim();
    const dateField = String(card.dateField || card.date || 'date').trim();
    const addBucket = (rawDate: unknown, rawValue: unknown = 1) => {
      const date = this._heatmapDateFromValue(rawDate);
      if (!date) return;
      const key = ymd(date);
      const bucket = buckets.get(key);
      if (!bucket) return;
      const value = Number(rawValue);
      bucket.value += Number.isFinite(value) ? value : 1;
    };

    if (Array.isArray(card.items)) {
      card.items.forEach((item: Frontmatter) => {
        if (!item || typeof item !== 'object') return;
        addBucket(item[dateField] ?? item.date ?? item.day ?? item.start, item.value ?? (field ? item[field] : 1));
      });
      return [...buckets.values()];
    }

    const sourceSpec = this._widgetSourceSpec(card, card.entity);
    const hasSource = !!card.source || !!card.entity || !!sourceSpec?.builtIn || !!sourceSpec?.mode;
    if (!hasSource) return [...buckets.values()];
    const resolved = await getWidgetEntities(sourceSpec, card.entity).catch((): null => null);
    if (!resolved) return [...buckets.values()];
    if (resolved.source?.mode === 'built-in' || resolved.metadata?.builtIn) {
      this._resolveBuiltInRows(card, resolved).forEach((row) => {
        addBucket(row[dateField] ?? row.date ?? row.day ?? row.start ?? row.title, this._heatmapValueFromRow(row, field));
      });
      return [...buckets.values()];
    }
    const def = resolved.def || ENTITIES[resolved.entityKey || card.entity] || null;
    (resolved.entities || []).forEach((entity) => {
      const rawDate = entityValue(entity, dateField, def) || entity.file?.stat?.mtime;
      const rawValue = field ? entityValue(entity, field, def) : 1;
      addBucket(rawDate, rawValue);
    });
    return [...buckets.values()];
  }

  async _renderHeatmapWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const buckets = await this._resolveHeatmapBuckets(card, getWidgetEntities);
    const max = Math.max(1, ...buckets.map((bucket) => bucket.value));
    const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0);
    const columns = Math.max(7, Math.min(53, Number(card.columns || Math.ceil(buckets.length / 7)) || 7));
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-heatmap-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'heatmap' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'Heatmap').trim() });
    head.createSpan({ cls: 'cad-widget-catalog-badge', text: `${Math.round(total)} total` });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-heatmap-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    if (!buckets.length) {
      body.createDiv({ cls: 'cad-empty', text: String(card.empty || 'No heatmap buckets').trim() });
      return;
    }
    const grid = body.createDiv({ cls: 'cad-heatmap-grid' });
    grid.style.setProperty('--cad-heatmap-columns', String(columns));
    buckets.forEach((bucket) => {
      const cell = grid.createDiv({ cls: 'cad-heatmap-cell' });
      const ratio = bucket.value / max;
      cell.dataset.level = bucket.value <= 0 ? '0' : ratio < 0.25 ? '1' : ratio < 0.5 ? '2' : ratio < 0.75 ? '3' : '4';
      cell.title = `${fmtValue(bucket.key, 'date')} — ${Math.round(bucket.value * 10) / 10}`;
    });
    const footer = body.createDiv({ cls: 'cad-heatmap-footer' });
    footer.createSpan({ text: `${buckets.length} days` });
    footer.createSpan({ text: `Peak ${Math.round(max * 10) / 10}` });
  }

  async _renderKanbanWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const resolved = await getWidgetEntities(this._widgetSourceSpec(card, card.entity), card.entity);
    const def = resolved.def || ENTITIES[resolved.entityKey || card.entity];
    const entities = resolved.entities || [];
    const entityKey = resolved.entityKey || card.entity;
    if (!def || !entityKey) return;

    const groupBy = String(card.groupBy || card.group || card.field || dealStageField(def) || 'stage').trim();
    const valueField = String(card.valueField || dealValueField(def) || '').trim();
    const titleFields = Array.isArray(card.cardTitleFields) && card.cardTitleFields.length
      ? card.cardTitleFields
      : (Array.isArray(card.titleFields) && card.titleFields.length ? card.titleFields : ['title', 'name']);
    const metaFields = Array.isArray(card.cardMetaFields) && card.cardMetaFields.length
      ? card.cardMetaFields
      : (Array.isArray(card.metaFields) && card.metaFields.length ? card.metaFields : [groupBy, valueField, 'company'].filter(Boolean));
    const sortMode = String(card.sort || 'mtime-desc').trim().toLowerCase();

    const normalizeGroup = (entry: KanbanGroupInput) => {
      if (entry == null) return null;
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        const value = String(entry.value ?? entry.id ?? entry.key ?? entry.label ?? '').trim();
        if (!value) return null;
        return {
          value,
          label: String(entry.label || entry.title || value).trim(),
          empty: String(entry.empty || entry.description || '').trim(),
          description: String(entry.description || '').trim(),
          limit: entry.limit != null ? Number(entry.limit) : null,
          wipLimit: entry.wipLimit != null ? Number(entry.wipLimit) : null,
        };
      }
      const value = String(entry).trim();
      if (!value) return null;
      return { value, label: value, empty: '' };
    };

    let groups: KanbanGroup[] = [];
    if (Array.isArray(card.columns) && card.columns.length) {
      groups = card.columns.map(normalizeGroup).filter(Boolean);
    } else if (Array.isArray(card.groups) && card.groups.length) {
      groups = card.groups.map(normalizeGroup).filter(Boolean);
    } else {
      const optionField = def.fields?.find((field) => field.key === groupBy);
      if (Array.isArray(optionField?.options) && optionField.options.length) {
        groups = optionField.options.map(normalizeGroup).filter(Boolean);
      } else {
        groups = [...new Set(entities.map((entity) => String(entityValue(entity, groupBy, def) || '').trim()).filter(Boolean))]
          .sort((a: string, b: string) => a.localeCompare(b))
          .map((value) => ({ value, label: value, empty: '' }));
      }
    }
    if (!groups.length) groups = [{ value: '(blank)', label: '(blank)', empty: '' }];

    const orderForSort = new Map(groups.map((group, idx): [string, number] => [group.value, idx]));
    const sortEntities = (items: EntityRecord[]) => {
      const sorted = [...items];
      if (sortMode === 'title') {
        sorted.sort((a, b) => String(entityPrimaryValue(a, def)).localeCompare(String(entityPrimaryValue(b, def))));
      } else if (sortMode === 'value-asc' && valueField) {
        sorted.sort((a, b) => (Number(entityValue(a, valueField, def)) || 0) - (Number(entityValue(b, valueField, def)) || 0));
      } else if (sortMode === 'value-desc' && valueField) {
        sorted.sort((a, b) => (Number(entityValue(b, valueField, def)) || 0) - (Number(entityValue(a, valueField, def)) || 0));
      } else if (sortMode === 'group') {
        sorted.sort((a, b) => {
          const av = String(entityValue(a, groupBy, def) || '');
          const bv = String(entityValue(b, groupBy, def) || '');
          return (orderForSort.get(av) ?? 999) - (orderForSort.get(bv) ?? 999);
        });
      } else {
        sorted.sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0));
      }
      return sorted;
    };

    const board = root.createDiv({ cls: 'cad-kanban-board' });
    const isMobile = !!(obsidian.Platform && obsidian.Platform.isMobile);
    let activeDragPath: string | null = null;
    groups.forEach((group) => {
      const items = entities.filter((e) => String(entityValue(e, groupBy, def) || '').trim() === group.value);
      const columnValue = items.reduce((sum, e) => sum + (Number(entityValue(e, valueField, def)) || 0), 0);
      const groupLimit = Number(group.limit || group.wipLimit || card.wipLimit || 0);
      const overLimit = groupLimit > 0 && items.length > groupLimit;

      const col = board.createDiv({ cls: 'cad-kanban-col' });
      if (overLimit) col.addClass('cad-kanban-col-over-limit');
      col.dataset.stage = group.value;
      const head = col.createDiv({ cls: 'cad-kanban-col-head' });
      head.createDiv({ cls: 'cad-kanban-col-title', text: group.label });
      const headMeta = head.createDiv({ cls: 'cad-kanban-col-meta' });
      headMeta.setText(`${items.length}${valueField ? ` · ${fmtValue(columnValue, 'currency')}` : ''}`);
      if (groupLimit > 0) {
        const limitChip = head.createSpan({ cls: 'cad-kanban-col-limit', text: `${items.length}/${groupLimit}` });
        if (overLimit) limitChip.addClass('is-over-limit');
      }
      if (group.description) {
        col.createDiv({ cls: 'cad-kanban-col-description', text: group.description });
      }

      const list = col.createDiv({ cls: 'cad-kanban-col-list' });
      const onDropEntity = async (filePath: string) => {
        if (!filePath || !groupBy) return;
        try {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (!(file instanceof obsidian.TFile)) return;
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm[groupBy] = group.value;
          });
          new obsidian.Notice(`Moved to ${group.label}`);
        } catch (e) {
          new obsidian.Notice(`Failed to move: ${e.message}`);
        }
      };
      const allowDrop = (event: DragEvent) => {
        const hasPath = !!event.dataTransfer?.getData('text/cadence-entity') || !!activeDragPath;
        if (!hasPath) return false;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        col.addClass('drag-over');
        return true;
      };
      col.addEventListener('dragover', allowDrop);
      col.addEventListener('dragleave', () => col.removeClass('drag-over'));
      col.addEventListener('drop', async (event) => {
        if (!allowDrop(event)) return;
        col.removeClass('drag-over');
        const filePath = activeDragPath || event.dataTransfer?.getData('text/cadence-entity');
        activeDragPath = null;
        await onDropEntity(filePath);
      });
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: group.empty || '—' });
        return;
      }
      sortEntities(items)
        .forEach((entity) => {
          const cardEl = list.createDiv({ cls: 'cad-kanban-card' });
          cardEl.dataset.path = entity.file.path;
          const title = titleFields
            .map((field: string) => String(entityValue(entity, field, def) || '').trim())
            .find(Boolean) || entityPrimaryValue(entity, def) || entity.basename;
          cardEl.createDiv({ cls: 'cad-kanban-card-title', text: title });
          const meta = cardEl.createDiv({ cls: 'cad-kanban-card-meta' });
          const value = valueField ? entityValue(entity, valueField, def) : null;
          if (value != null && value !== '') meta.createSpan({ cls: 'cad-kanban-card-value', text: fmtValue(value, 'currency') });
          const metaText = metaFields
            .map((field: string) => {
              if (!field) return '';
              if (field === valueField) return '';
              const current = entityValue(entity, field, def);
              if (current == null || current === '') return '';
              const fieldDef = def.fields?.find((f) => f.key === field);
              return fmtValue(current, fieldDef?.type || 'text');
            })
            .filter(Boolean)
            .join(' · ');
          if (metaText) meta.createSpan({ cls: 'cad-kanban-card-company', text: metaText });
          if (overLimit) cardEl.addClass('cad-kanban-card-over-limit');
          if (!isMobile) {
            cardEl.draggable = true;
            cardEl.addEventListener('dragstart', (ev) => {
              activeDragPath = entity.file.path;
              cardEl.addClass('dragging');
              try {
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/cadence-entity', entity.file.path);
                ev.dataTransfer.setData('text/cadence-stage', group.value);
                ev.dataTransfer.setData('text/plain', `[[${entity.file.basename}]]`);
              } catch (_) {}
            });
            cardEl.addEventListener('dragend', () => {
              activeDragPath = null;
              cardEl.removeClass('dragging');
            });
          } else {
            cardEl.addClass('cad-kanban-card-touch');
          }
          cardEl.addEventListener('click', () => this.openEntityDetail(entityKey, entity.file));
      });
    });
  }

  async _renderListWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const rows = await this._resolveCardRows(card, getWidgetEntities);
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-list-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'list' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'List').trim() });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    if (!rows.length) {
      body.createDiv({ cls: 'cad-empty', text: String(card.empty || 'No rows').trim() });
      return;
    }
    const list = body.createDiv({ cls: 'cad-home-list cad-list-widget' });
    rows.slice(0, Math.max(1, Number(card.limit || 6) || 6)).forEach((row) => {
      const item = list.createDiv({ cls: 'cad-home-row cad-list-row' });
      const main = item.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: row.title || 'Untitled' });
      if (row.meta) main.createDiv({ cls: 'cad-home-row-meta', text: row.meta });
      this._renderRowProgress(main, row.progress);
      if (row.file || row.surface || row.command || row.url || row.action) {
        item.classList.add('clickable');
        item.addEventListener('click', async () => {
          if (row.file) {
            if (row.entityKey) {
              this.openEntityDetail(row.entityKey, row.file);
              return;
            }
            this.openEntityDetailFromFile(row.file);
            return;
          }
          if (row.action) {
            await this._runActionSpec(row.action);
            return;
          }
          if (row.surface) {
            this.setMode(row.surface);
            return;
          }
          if (row.command) {
            await this._runActionSpec({ command: row.command });
            return;
          }
          if (row.url) {
            window.open(row.url, '_blank', 'noopener,noreferrer');
          }
        });
      }
    });
  }

  // Interactive task list: like _renderListWidget but rows carry a checkbox that
  // writes back. TaskNote-record rows (entity/base sources) toggle frontmatter
  // status via toggleTaskNoteStatus; built-in daily-note rows (no file) are shown
  // read-only for now (write-back for those is Phase 2).
  async _renderTaskListWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const rows = await this._resolveCardRows(card, getWidgetEntities);
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-list-card cad-task-list-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'task-list' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'Tasks').trim() });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    if (!rows.length) {
      body.createDiv({ cls: 'cad-empty', text: String(card.empty || 'No tasks').trim() });
      return;
    }
    const list = body.createDiv({ cls: 'cad-home-list cad-task-list-widget' });
    rows.slice(0, Math.max(1, Number(card.limit || 12) || 12)).forEach((row) => {
      const file = row.file || null;
      const fm = file ? (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) : {};
      const dailyIdx = typeof row.taskIndex === 'number' ? row.taskIndex : null;
      const done = file ? String(fm.status || '').trim().toLowerCase() === 'done' : !!row.done;
      const item = list.createDiv({ cls: 'cad-task-row cad-dash-task-row' + (done ? ' done' : '') });
      const cb = item.createEl('input', { type: 'checkbox' });
      cb.checked = done;
      if (file) {
        cb.addEventListener('change', async () => {
          await toggleTaskNoteStatus(this.app, file, cb.checked);
          this.render();
        });
      } else if (dailyIdx != null) {
        cb.addEventListener('change', async () => {
          await this._toggleDailyTaskByIndex(dailyIdx, cb.checked);
          this.render();
        });
      } else {
        cb.disabled = true;
      }
      const main = item.createDiv({ cls: 'cad-task-text cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: row.title || 'Untitled' });
      if (row.meta) main.createDiv({ cls: 'cad-home-row-meta', text: row.meta });
      if (file) {
        main.classList.add('clickable');
        main.addEventListener('click', () => {
          if (row.entityKey) { this.openEntityDetail(row.entityKey, file); return; }
          this.openEntityDetailFromFile(file);
        });
      }
    });
  }

  // Toggle a checkbox task in today's daily note by its index in the tasks
  // section (used by the interactive task-list widget on built-in 'today' rows).
  async _toggleDailyTaskByIndex(idx: number, checked: boolean) {
    const file = await ensureDailyNote(this.app, this.plugin.settings) as obsidian.TFile;
    const content = await this.app.vault.read(file);
    const parsed = parseSections(content, this.plugin.settings);
    const taskText = String(parsed.tasks[idx] || '').replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
    const newTasks = parsed.tasks.map((line, i) => {
      if (i !== idx) return line;
      return checked
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    await this.app.vault.modify(file, replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n')));
    if (taskText) await this._propagateTaskComplete(taskText, checked, { kind: 'daily', file, date: new Date() });
  }

  // Append a checkbox task to today's daily note (creating it if missing).
  async _appendDailyTask(text: string) {
    const file = await ensureDailyNote(this.app, this.plugin.settings) as obsidian.TFile;
    const content = await this.app.vault.read(file);
    const parsed = parseSections(content, this.plugin.settings);
    const newTasks = [...parsed.tasks, `- [ ] ${text}`];
    await this.app.vault.modify(file, replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n')));
  }

  // Quick-add input: type + Enter appends a task to today's daily note.
  _renderQuickAddWidget(root: HTMLElement, card: CardLike) {
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-quick-add-card' });
    if (card.title || card.label) {
      cardEl.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label).trim() });
    }
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    const input = body.createEl('input', { type: 'text', cls: 'cad-quick-add-input', attr: { placeholder: String(card.placeholder || 'Add a task and press Enter…') } });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await this._appendDailyTask(text);
      this.render();
    });
  }

  // Read-only date hero (weekday / day / month / year).
  _renderDateHeroWidget(root: HTMLElement, card: CardLike) {
    const info = dateInfo(new Date());
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-date-hero-card' });
    cardEl.createDiv({ cls: 'cad-eyebrow', text: String(card.eyebrow || info.weekday).toUpperCase() });
    const hero = cardEl.createDiv({ cls: 'cad-date-hero' });
    hero.createDiv({ cls: 'cad-date-day', text: String(info.day) });
    const col = hero.createDiv();
    col.createDiv({ cls: 'cad-month', text: info.month });
    col.createDiv({ cls: 'cad-year', text: String(info.year) });
  }

  // Editable note-body section (e.g. the daily-note Journal), saved on blur.
  async _renderNoteSectionWidget(root: HTMLElement, card: CardLike) {
    const heading = String(card.section || card.heading || '').trim() || this.plugin.settings.journalHeading || '## Journal';
    const headingFull = heading.startsWith('#') ? heading : `## ${heading}`;
    const readSection = (content: string): string => {
      const lines = content.split('\n');
      const idx = lines.findIndex((l) => l.trim() === headingFull.trim());
      if (idx < 0) return '';
      const out: string[] = [];
      for (let i = idx + 1; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i])) break;
        out.push(lines[i]);
      }
      return out.join('\n').replace(/\s+$/, '');
    };
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-note-section-card' });
    cardEl.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: String(card.title || 'Today’s entry').trim() });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    const path = dailyNotePath(this.plugin.settings);
    const existing = this.app.vault.getAbstractFileByPath(path) as obsidian.TFile | null;
    let current = '';
    if (existing) current = readSection(await this.app.vault.read(existing));
    const ta = body.createEl('textarea', { cls: 'cad-journal cad-note-section-textarea' });
    ta.value = current;
    ta.spellcheck = false;
    ta.addEventListener('blur', async () => {
      const file = await ensureDailyNote(this.app, this.plugin.settings) as obsidian.TFile;
      const content = await this.app.vault.read(file);
      await this.app.vault.modify(file, replaceSection(content, headingFull, ta.value || ''));
    });
  }

  async _renderBarChartWidget(root: HTMLElement, card: CardLike, getWidgetEntities: GetWidgetEntities) {
    const resolved = await getWidgetEntities(this._widgetSourceSpec(card, card.entity), card.entity);
    const builtInData = resolved.metadata?.builtInData || resolved.metadata?.providerData || null;
    const builtInName = String(resolved.source?.builtIn || '').trim().toLowerCase();
    const isBuiltIn = !!builtInData && !!builtInName;
    const isProductivityBuiltIn = builtInName === 'productivity';
    const entityKey = resolved.entityKey || card.entity || (isBuiltIn ? builtInName : '');
    const def = resolved.def || ENTITIES[resolved.entityKey || card.entity] || null;
    const entities = resolved.entities || [];
    if (!def && !isBuiltIn) return;
    if (!isBuiltIn && !entityKey) return;

    const groupBy = String(card.groupBy || card.group || (isProductivityBuiltIn ? '' : card.field || (def ? dealStageField(def) : 'date'))).trim();
    const metric = String(card.metric || card.aggregate || 'count').trim().toLowerCase();
    const valueField = String(card.valueField || card.field || (isProductivityBuiltIn ? '' : (def ? dealValueField(def) : ''))).trim();
    const limit = Math.max(1, Number(card.limit || 8) || 8);
    const labels = new Map();
    const normalizeGroup = (entry: KanbanGroupInput) => {
      if (entry == null) return null;
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        const value = String(entry.value ?? entry.id ?? entry.key ?? entry.label ?? '').trim();
        if (!value) return null;
        return { value, label: String(entry.label || entry.title || value).trim() };
      }
      const value = String(entry).trim();
      if (!value) return null;
      return { value, label: value };
    };
    let groups: { value: string; label: string }[] = [];
    if (Array.isArray(card.groups) && card.groups.length) {
      groups = card.groups.map(normalizeGroup).filter(Boolean);
    } else if (Array.isArray(card.columns) && card.columns.length) {
      groups = card.columns.map(normalizeGroup).filter(Boolean);
    } else {
      const fieldDef = def?.fields?.find((field) => field.key === groupBy);
      if (Array.isArray(fieldDef?.options) && fieldDef.options.length) {
        groups = fieldDef.options.map(normalizeGroup).filter(Boolean);
      } else {
        groups = [...new Set(entities.map((entity) => String(entityValue(entity, groupBy, def) || '').trim()).filter(Boolean))]
          .sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
          .map((value) => ({ value, label: value }));
      }
    }
    if (!groups.length) groups = [{ value: '(blank)', label: '(blank)' }];
    const valuesForGroup = (groupValue: string) => entities.filter((entity) => String(entityValue(entity, groupBy, def) || '').trim() === groupValue);
    const numericValue = (entity: EntityRecord) => Number(entityValue(entity, valueField, def)) || 0;
    const computeValue = (items: EntityRecord[]) => {
      if (metric === 'sum') return items.reduce((sum, entity) => sum + numericValue(entity), 0);
      if (metric === 'avg') return items.length ? items.reduce((sum, entity) => sum + numericValue(entity), 0) / items.length : 0;
      if (metric === 'unique' || metric === 'uniquecount') {
        return new Set(items.map((entity) => String(entityValue(entity, valueField || groupBy, def) || '').trim()).filter(Boolean)).size;
      }
      if (metric === 'open') return items.filter((entity) => this._isOpenEntity(entity, entityKey)).length;
      return items.length;
    };
    const builtInRows = isBuiltIn
      ? this._resolveBuiltInRows(Object.assign({}, card, { source: Object.assign({}, resolved.source, { section: resolved.source?.section || card.section || '' }) }), resolved)
      : null;
    const chartValues = Array.isArray(builtInRows) && builtInRows.length
      ? builtInRows.slice(0, limit).map((row): BarChartEntry => {
        const label = String(row.title || '').trim() || '—';
        const value = dashboardProviderRowValue(row, valueField);
        return {
          group: { value: label, label },
          items: [],
          value,
          meta: row.meta || '',
        };
      })
      : groups.map((group): BarChartEntry => {
        const items = valuesForGroup(group.value);
        return {
          group,
          items,
          value: computeValue(items),
        };
      }).sort((a, b) => b.value - a.value).slice(0, limit);
    const max = Math.max(1, ...chartValues.map((entry) => Number(entry.value) || 0));

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-bar-chart-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'bar-chart' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'Bar chart').trim() });
    const badge = isProductivityBuiltIn ? (valueField || String(resolved.source?.section || card.section || '').trim()) : groupBy;
    if (badge) head.createSpan({ cls: 'cad-widget-catalog-badge', text: badge });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    const chart = body.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    chartValues.forEach((entry) => {
      labels.set(entry.group.value, entry.group.label);
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(Number(entry.value) / max) * 100}%`;
      const ratio = Number(entry.value) / max;
      bar.dataset.band = Number(entry.value) === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `${entry.group.label} — ${fmtValue(entry.value, metric === 'sum' || metric === 'avg' ? 'currency' : 'number')}${entry.meta ? ` · ${entry.meta}` : ''}`;
      col.createDiv({ cls: 'cad-bar-label', text: entry.group.label });
      col.createDiv({ cls: 'cad-bar-value', text: String(entry.value) });
      if (entry.items.length && entry.items[0]?.file) {
        col.addEventListener('click', () => {
          const first = entry.items[0];
          if (first.entityKey) {
            this.openEntityDetail(first.entityKey, first.file);
            return;
          }
          this.openEntityDetailFromFile(first.file);
        });
      }
    });
  }

  _dashboardStats(root: HTMLElement, stats: CardLike[]) {
    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    stats.forEach((item) => {
      const card = grid.createDiv({ cls: 'cad-stat-card' });
      if (item.accent) card.dataset.accent = item.accent;
      card.createDiv({ cls: 'cad-stat-label', text: item.label });
      card.createDiv({ cls: 'cad-stat-value', text: String(item.value) });
      if (item.sub) card.createDiv({ cls: 'cad-stat-sub', text: item.sub });
      if (item.mode) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => this.setMode(item.mode));
      }
    });
  }

  _renderWidgetCatalog(root: HTMLElement) {
    const section = root.createDiv({ cls: 'cad-widget-catalog' });
    section.createDiv({ cls: 'cad-section-label-lg', text: 'Widget catalog' });
    section.createEl('p', {
      cls: 'setting-item-description',
      text: 'This catalog shows the dashboard widget shapes that can be expressed in workspace.json today, plus the gaps we still want to close.',
    });

    const grid = section.createDiv({ cls: 'cad-widget-catalog-grid' });
    DASHBOARD_WIDGET_CATALOG.forEach((entry) => {
      const card = grid.createDiv({ cls: `cad-widget-catalog-card cad-widget-catalog-${entry.status}` });
      const head = card.createDiv({ cls: 'cad-widget-catalog-head' });
      head.createDiv({ cls: 'cad-widget-catalog-title', text: entry.label });
      head.createSpan({ cls: 'cad-widget-catalog-badge', text: entry.status });
      card.createDiv({ cls: 'cad-widget-catalog-id', text: entry.id });
      card.createDiv({ cls: 'cad-widget-catalog-desc', text: entry.description });
      const chips = card.createDiv({ cls: 'cad-widget-catalog-chips' });
      entry.config.forEach((key) => chips.createSpan({ cls: 'cad-widget-catalog-chip', text: key }));
      if (entry.examples?.length) {
        const ex = card.createDiv({ cls: 'cad-widget-catalog-examples' });
        ex.createSpan({ cls: 'cad-widget-catalog-examples-label', text: 'Examples' });
        ex.createSpan({ cls: 'cad-widget-catalog-examples-value', text: entry.examples.join(' · ') });
      }
    });

    const gap = section.createDiv({ cls: 'cad-widget-gap' });
    gap.createDiv({ cls: 'cad-widget-gap-title', text: 'Configuration gap snapshot' });
    gap.createDiv({
      cls: 'setting-item-description',
      text: 'Metric stats, list, bar chart, card lists, merged sources, kanban, Base links, Base previews, markdown, actions and selectors are already config-driven. The remaining work is mostly about richer report composition, stronger Base integration, and any remaining runtime-snapshot-backed sections.',
    });
  }

  _renderDashboardInventory(root: HTMLElement) {
    const section = root.createDiv({ cls: 'cad-dashboard-inventory' });
    section.createDiv({ cls: 'cad-section-label-lg', text: 'Built-in dashboard inventory' });
    section.createEl('p', {
      cls: 'setting-item-description',
      text: 'Use this inventory to compare the shipped dashboards against the widget catalog and see where we still rely on runtime-snapshot-backed sections.',
    });

    const grid = section.createDiv({ cls: 'cad-dashboard-inventory-grid' });
    Object.entries(BUILTIN_DASHBOARD_DEFAULTS).forEach(([id, config]) => {
      const summary = summarizeDashboardBlueprint(id, config as DashboardBlueprint);
      const card = grid.createDiv({ cls: 'cad-dashboard-inventory-card' });
      const head = card.createDiv({ cls: 'cad-dashboard-inventory-head' });
      head.createDiv({ cls: 'cad-dashboard-inventory-title', text: summary.title });
      head.createSpan({ cls: 'cad-dashboard-inventory-id', text: id });
      const meta = card.createDiv({ cls: 'cad-dashboard-inventory-meta' });
      meta.createSpan({ text: `kind: ${summary.kind}` });
      meta.createSpan({ text: `${summary.statsCount} stats` });
      meta.createSpan({ text: `${summary.cardCount} cards` });
      if (summary.contextFilter) meta.createSpan({ text: `context: ${summary.contextFilter}` });
      if (summary.legend) meta.createSpan({ text: `legend: ${summary.legend}` });
      const kindRow = card.createDiv({ cls: 'cad-dashboard-inventory-row' });
      kindRow.createSpan({ cls: 'cad-dashboard-inventory-label', text: 'Widgets' });
      (summary.widgetKinds.length ? summary.widgetKinds : ['none']).forEach((kind) => {
        kindRow.createSpan({ cls: 'cad-dashboard-inventory-chip', text: kind });
      });
      const sourceRow = card.createDiv({ cls: 'cad-dashboard-inventory-row' });
      sourceRow.createSpan({ cls: 'cad-dashboard-inventory-label', text: 'Sources' });
      (summary.sourceKinds.length ? summary.sourceKinds : ['n/a']).forEach((kind) => {
        sourceRow.createSpan({ cls: 'cad-dashboard-inventory-chip', text: kind });
      });
    });
  }

  _recentRows(entityKey: string | null, entities: EntityRecord[], titleFields: string[] = ['title', 'name'], metaFields: string[] = ['status'], sortSpec: unknown = null, limit: number = 6, _entityDef: EntityDef | null = null) {
    // Fall back to the resolved def (e.g. schema entity) when the key isn't a
    // built-in; may still be null for an unknown entity — guard every def access.
    const def = (entityKey ? ENTITIES[entityKey] : null) || _entityDef || null;
    const sort = normalizeWidgetSortSpec(sortSpec);
    const sorted = [...entities];
    if (sort.length) {
      sorted.sort((a, b) => compareEntitiesByBaseSort(a, b, Object.assign({}, def || {}, { baseSort: sort })));
    } else {
      sorted.sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0));
    }
    return sorted
      .slice(0, Math.max(1, Number(limit) || 6))
      .map((entity) => {
        const titleField = titleFields.find((field) => entityValue(entity, field, def));
        const title = (titleField ? entityValue(entity, titleField, def) : '') || entity.basename;
        const meta = (metaFields || ['status']).map((field) => fmtValue(entityValue(entity, field, def), def?.fields?.find((f) => f.key === field)?.type)).filter(Boolean).join(' · ');
        return { title, meta: meta || 'No status', file: entity.file };
      });
  }

  _dueRows(entityKey: string | null, entities: EntityRecord[], dateFields: string[], titleFields: string[] = ['title', 'name'], limit: number = 6) {
    const today = startOfDay(new Date());
    const horizon = addDays(today, 30);
    const def = (entityKey ? ENTITIES[entityKey] : null) || null;
    return entities
      .map((entity) => ({ entity, date: this._dateValue(entity, entityKey, dateFields) }))
      .filter((item) => item.date && item.date.getTime() <= horizon.getTime())
      .sort((a, b) => (a.date as unknown as number) - (b.date as unknown as number))
      .slice(0, Math.max(1, Number(limit) || 6))
      .map(({ entity, date }) => {
        const titleField = titleFields.find((field) => entityValue(entity, field, def));
        return {
          title: (titleField ? entityValue(entity, titleField, def) : '') || entity.basename,
          meta: `${fmtValue(date, 'date')} · ${entityValue(entity, 'status', def) || 'open'}`,
          file: entity.file,
        };
      });
  }

  _renderFinanceStatementLegend(root: HTMLElement) {
    const card = root.createDiv({ cls: 'cad-dash-card cad-finance-legend' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'FINANCIAL STATEMENT LEGEND' });
    const body = card.createDiv({ cls: 'cad-dash-card-body cad-finance-legend-grid' });
    [
      ['SOFP', 'Statement of Financial Position', 'Balance sheet: assets, liabilities and equity at a date.'],
      ['SOPL', 'Statement of Profit or Loss', 'Income statement / P&L for the period.'],
      ['SOCI', 'Statement of Comprehensive Income', 'Profit or loss plus other comprehensive income.'],
      ['SOCF', 'Statement of Cash Flows', 'Operating, investing and financing cash movements.'],
      ['SOCE', 'Statement of Changes in Equity', 'Opening equity, profit/loss, contributions, distributions and closing equity.'],
    ].forEach(([code, title, desc]) => {
      const item = body.createDiv({ cls: 'cad-finance-legend-item' });
      item.createDiv({ cls: 'cad-finance-legend-code', text: code });
      const text = item.createDiv({ cls: 'cad-finance-legend-text' });
      text.createDiv({ cls: 'cad-finance-legend-title', text: title });
      text.createDiv({ cls: 'cad-finance-legend-desc', text: desc });
    });
  }

  async renderClientWorkDashboard(root: HTMLElement, opts: DashboardRenderOptions = {}) {
    return this.renderConfigDashboard('client-work.dashboard', root, opts);
  }

  async renderFinanceGLDashboard(root: HTMLElement) {
    return this.renderConfigDashboard('finance.gl.overview', root);
  }

  async renderFinanceSetupDashboard(root: HTMLElement) {
    return this.renderConfigDashboard('finance.setup.overview', root);
  }

  async renderProcurementDashboard(root: HTMLElement) {
    return this.renderConfigDashboard('procurement.overview', root);
  }

  async renderTaxDashboard(root: HTMLElement) {
    return this.renderConfigDashboard('tax.dashboard', root);
  }

  async renderPartnerWorkspaceDashboard(root: HTMLElement) {
    return this.renderConfigDashboard('prm.partners.overview', root);
  }

  async renderCampaignWorkspaceDashboard(root: HTMLElement) {
    return this.renderConfigDashboard('crm.campaigns.overview', root);
  }

  async renderExport(root: HTMLElement) {
    this._renderPageHeader(root, 'Export', 'Export your data to an Excel workbook');

    const section = (parent: HTMLElement, title: string, desc: string) => {
      const s = parent.createDiv({ cls: 'cad-data-section' });
      s.createDiv({ cls: 'cad-data-section-title', text: title });
      if (desc) s.createDiv({ cls: 'cad-data-section-desc', text: desc });
      return s;
    };

    const exportGroups = workbookExportGroups();
    const exportSec = section(root, 'Export to XLSX',
      'Select one or more groups and export to an Excel workbook. Each group becomes a separate sheet.');

    const checked = new Set(exportGroups.map(g => g.id));
    if (exportGroups.length) {
      const groupsWrap = exportSec.createDiv({ cls: 'cad-data-group-list' });
      exportGroups.forEach(g => {
        const lbl = groupsWrap.createEl('label', { cls: 'cad-data-group-item' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => { if (cb.checked) checked.add(g.id); else checked.delete(g.id); });
        lbl.createSpan({ text: g.label });
        lbl.createSpan({ cls: 'cad-data-group-count', text: `${g.entityKeys.length} types` });
      });
    }

    const destDesc = exportSec.createDiv({ cls: 'cad-data-section-desc' });
    destDesc.setText('Output folder: ');
    destDesc.createEl('strong', { text: workbookExportFolder(this.settings) });

    const exportRow = exportSec.createDiv({ cls: 'cad-data-action-row' });
    const exportBtnRow = exportRow.createDiv({ cls: 'cad-data-btn-row' });
    const exportBtn = exportBtnRow.createEl('button', { cls: 'cad-btn', text: 'Export workbook' });
    const exportStatus = exportRow.createDiv({ cls: 'cad-data-status' });
    exportBtn.addEventListener('click', async () => {
      const keys = exportGroups.length
        ? selectedWorkbookEntityKeys([...checked])
        : [...workspaceConfiguredEntityKeys(WORKSPACE_CONFIG)];
      if (!keys.length) { exportStatus.className = 'cad-data-status cad-data-status-error'; exportStatus.setText('Nothing to export.'); return; }
      exportBtn.disabled = true;
      exportBtn.setText('Exporting…');
      exportStatus.className = 'cad-data-status';
      exportStatus.setText('');
      try {
        const suffix = exportGroups.length && checked.size < exportGroups.length ? 'selected' : '';
        const path = await exportEntitiesXLSX(this.app, keys, suffix, this.settings);
        exportStatus.className = 'cad-data-status cad-data-status-ok';
        exportStatus.setText('Saved to ');
        exportStatus.createEl('strong', { text: path });
        exportStatus.createSpan({ text: ' — ' });
        const openLink = exportStatus.createEl('a', { cls: 'cad-data-open-link', text: 'Open file', href: '#' });
        openLink.addEventListener('click', (evt) => {
          evt.preventDefault();
          (this.app as AppWithInternals).openWithDefaultApp(path);
        });
      } catch (e) {
        exportStatus.className = 'cad-data-status cad-data-status-error';
        exportStatus.setText(`Export failed — ${e.message}`);
      } finally {
        exportBtn.disabled = false;
        exportBtn.setText('Export workbook');
      }
    });

    // ── Export import template ───────────────────────────────────────
    const tmplSec = section(root, 'Export import template',
      'Download a pre-filled template file to use as a starting point for importing a specific entity type.');
    const tmplRow = tmplSec.createDiv({ cls: 'cad-data-btn-row' });
    const tmplSelect = tmplRow.createEl('select', { cls: 'cad-de-select' });
    workspaceConfiguredEntityEntries(WORKSPACE_CONFIG)
      .forEach(([key, def]) => tmplSelect.createEl('option', { value: key, text: def.plural || def.label || key }));
    const tmplCsvBtn  = tmplRow.createEl('button', { cls: 'cad-btn', text: 'CSV template' });
    const tmplXlsxBtn = tmplRow.createEl('button', { cls: 'cad-btn', text: 'XLSX template' });
    tmplCsvBtn.addEventListener('click', async () => {
      const modal = new CadenceImportModal(this.app, { entityKey: tmplSelect.value });
      await modal._exportTemplateCSV();
    });
    tmplXlsxBtn.addEventListener('click', async () => {
      const modal = new CadenceImportModal(this.app, { entityKey: tmplSelect.value });
      await modal._exportTemplateXLSX();
    });
  }

  renderImport(root: HTMLElement) {
    new CadenceImportModal(this.app, {}).open();
  }

  // Reusable, toggleable colored help panel. `key` persists open/closed state
  // for this session; `build` populates the panel body (headings, paragraphs,
  // lists). Returns nothing — appends a "Help" toggle + collapsible panel.
  _helpPanel(parent: HTMLElement, key: string, title: string, build: (body: HTMLElement) => void) {
    if (!this._openHelpPanels) this._openHelpPanels = new Set<string>();
    const open = this._openHelpPanels.has(key);
    const block = parent.createDiv({ cls: 'cad-help-block' });
    const toggle = block.createEl('button', { cls: 'cad-help-toggle' + (open ? ' is-open' : ''), attr: { type: 'button' } });
    const icon = toggle.createSpan({ cls: 'cad-help-toggle-icon' });
    try { obsidian.setIcon(icon, 'help-circle'); } catch (_) { icon.setText('?'); }
    toggle.createSpan({ cls: 'cad-help-toggle-label', text: title });
    const chevron = toggle.createSpan({ cls: 'cad-help-toggle-chevron', text: open ? '▾' : '▸' });
    const panel = block.createDiv({ cls: 'cad-help-panel' });
    if (!open) panel.style.display = 'none';
    build(panel);
    toggle.addEventListener('click', () => {
      const nowOpen = panel.style.display === 'none';
      panel.style.display = nowOpen ? '' : 'none';
      toggle.toggleClass('is-open', nowOpen);
      chevron.setText(nowOpen ? '▾' : '▸');
      if (nowOpen) this._openHelpPanels.add(key); else this._openHelpPanels.delete(key);
    });
  }

  // Render a named help topic (from help-content.ts) as a collapsible panel.
  _renderHelpTopic(parent: HTMLElement, topicKey: string) {
    const topic = HELP_TOPICS[topicKey];
    if (!topic) return;
    this._helpPanel(parent, topicKey, topic.title, (body) => {
      topic.sections.forEach((section) => this._helpBlock(body, section.heading, section.lines));
    });
  }

  // Small helper: render a heading + paragraph/list items into a help panel body.
  _helpBlock(body: HTMLElement, heading: string, lines: (string | [string, string])[]) {
    body.createDiv({ cls: 'cad-help-heading', text: heading });
    lines.forEach((line) => {
      const row = body.createDiv({ cls: 'cad-help-line' });
      if (Array.isArray(line)) {
        row.createSpan({ cls: 'cad-help-term', text: line[0] });
        row.createSpan({ cls: 'cad-help-desc', text: line[1] });
      } else {
        row.createSpan({ cls: 'cad-help-desc', text: line });
      }
    });
  }

  async renderDashboardEditor(root: HTMLElement) {
    // Deep-link target from the Modules settings "Edit dashboard" action.
    if (this.plugin.pendingDesignerSurface) {
      this._dashEditorSurfaceId = this.plugin.pendingDesignerSurface;
      this.plugin.pendingDesignerSurface = null;
    }
    this._renderPageHeader(root, 'Surface Designer', 'Customize dashboards, reports and widgets');

    this._renderHelpTopic(root, 'designer-overview');

    const builtinIds = Object.keys(BUILTIN_DASHBOARD_DEFAULTS);
    const builtinPlannerIds = Object.keys(WORKSPACE_CONFIG.planner || {});
    const workspaceDashIds = Object.keys(WORKSPACE_CONFIG.dashboards || {});
    const customOnlyIds = workspaceDashIds.filter(id => !builtinIds.includes(id) && !builtinPlannerIds.includes(id));
    const allIds = [...builtinIds, ...builtinPlannerIds, ...customOnlyIds];

    const toolbar = root.createDiv({ cls: 'cad-de-toolbar' });
    toolbar.createDiv({ cls: 'cad-de-toolbar-label', text: 'Dashboard' });
    const sel = toolbar.createEl('select', { cls: 'cad-de-select' });
    allIds.forEach(id => {
      const opt = sel.createEl('option', { text: id, value: id });
      if (id === (this._dashEditorSurfaceId || builtinIds[0])) opt.selected = true;
    });
    const newSurfaceWrap = toolbar.createDiv({ cls: 'cad-de-toolbar-new-surface' });
    const newSurfaceInput = newSurfaceWrap.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', placeholder: 'New route id' });
    const newSurfaceKind = newSurfaceWrap.createEl('select', { cls: 'cad-de-select' });
    ['dashboard', 'report', 'planner'].forEach((kind) => newSurfaceKind.createEl('option', { value: kind, text: kind }));
    const addSurfaceBtn = newSurfaceWrap.createEl('button', { cls: 'cad-btn', text: '+ Add surface' });
    addSurfaceBtn.addEventListener('click', async () => {
      const id = String(newSurfaceInput.value || '').trim();
      if (!id) {
        new obsidian.Notice('Enter a surface id first.');
        return;
      }
      const targetStore = id.startsWith('planner.') ? 'planner' : 'dashboards';
      if (!WORKSPACE_CONFIG[targetStore]) WORKSPACE_CONFIG[targetStore] = {};
      if (WORKSPACE_CONFIG[targetStore][id]) {
        this._dashEditorSurfaceId = id;
        this._dashEditorDraft = getConfig(id);
        renderEditorPane(id);
        renderPreview(id);
        return;
      }
      WORKSPACE_CONFIG[targetStore][id] = {
        kind: newSurfaceKind.value,
        title: id,
        subtitle: '',
        layout: [],
        stats: [],
      };
      try {
        await saveWorkspaceConfig(this.app, JSON.stringify(WORKSPACE_CONFIG, null, 2));
        this._dashEditorSurfaceId = id;
        this._dashEditorDraft = getConfig(id);
        new obsidian.Notice(`Created dashboard surface "${id}".`);
        renderEditorPane(id);
        renderPreview(id);
      } catch (e) {
        new obsidian.Notice(`Create failed: ${e.message}`);
      }
    });

    const modeToggle = toolbar.createDiv({ cls: 'cad-de-mode-toggle' });
    if (!this._dashEditorMode) this._dashEditorMode = 'visual';
    const visualBtn = modeToggle.createEl('button', { cls: `cad-de-mode-btn${this._dashEditorMode === 'visual' ? ' active' : ''}`, text: 'Visual' });
    const jsonBtn   = modeToggle.createEl('button', { cls: `cad-de-mode-btn${this._dashEditorMode === 'json'   ? ' active' : ''}`, text: 'JSON' });

    const split       = root.createDiv({ cls: 'cad-de-split' });
    const editorPane  = split.createDiv({ cls: 'cad-de-editor-pane' });
    const previewPane = split.createDiv({ cls: 'cad-de-preview-pane' });

    const getConfig = (id: string): DashConfigLike => {
      const plannerConfig = (WORKSPACE_CONFIG.planner || {})[id];
      if (plannerConfig) return normalizeDashboardConfigShape(JSON.parse(JSON.stringify(plannerConfig)));
      const ws = (WORKSPACE_CONFIG.dashboards || {})[id];
      if (ws) return normalizeDashboardConfigShape(JSON.parse(JSON.stringify(ws)));
      const bi = BUILTIN_DASHBOARD_DEFAULTS[id];
      if (bi) return normalizeDashboardConfigShape(JSON.parse(JSON.stringify(bi)));
      return { title: id, layout: [] };
    };

    const renderPreview = async (id: string) => {
      previewPane.empty();
      const prevDash = WORKSPACE_CONFIG.dashboards;
      const prevPlanner = WORKSPACE_CONFIG.planner;
      try {
        if (String(id || '').startsWith('planner.')) {
          WORKSPACE_CONFIG.planner = Object.assign({}, prevPlanner, { [id]: this._dashEditorDraft });
        } else {
          WORKSPACE_CONFIG.dashboards = Object.assign({}, prevDash, { [id]: this._dashEditorDraft });
        }
        await this.renderConfigDashboard(id, previewPane);
      } finally {
        WORKSPACE_CONFIG.dashboards = prevDash;
        WORKSPACE_CONFIG.planner = prevPlanner;
      }
    };

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const triggerPreview = (id: string) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderPreview(id), 400);
    };

    const isEditable = (id: string) => !!(WORKSPACE_CONFIG.dashboards || {})[id] || !!(WORKSPACE_CONFIG.planner || {})[id] || customOnlyIds.includes(id);

    const renderEditorPane = (id: string) => {
      editorPane.empty();
      const editable = isEditable(id);
      const config = this._dashEditorDraft;

      editorPane.createDiv({
        cls: `cad-de-badge ${editable ? 'cad-de-badge-custom' : 'cad-de-badge-builtin'}`,
        text: editable ? 'Custom override' : 'Built-in (read-only)',
      });

      const reRender = () => { renderEditorPane(id); triggerPreview(id); };
      const validationStatus = editorPane.createDiv({ cls: 'cad-de-validation-status' });
      let validationTimer: ReturnType<typeof setTimeout> | null = null;
      const setValidationStatus = (message: string, ok: boolean) => {
        validationStatus.setText(message);
        validationStatus.toggleClass('is-valid', !!ok);
        validationStatus.toggleClass('is-invalid', !ok);
      };
      const validateDraft = () => {
        try {
          validateDashboardConfig(config, `dashboards.${id}`);
          setValidationStatus('Valid dashboard config', true);
          return true;
        } catch (e) {
          setValidationStatus(`Invalid dashboard: ${e.message}`, false);
          return false;
        }
      };
      const scheduleValidation = () => {
        clearTimeout(validationTimer);
        validationTimer = setTimeout(() => { validateDraft(); }, 150);
      };

      if (this._dashEditorMode === 'visual') {
        this._renderDashboardDesigner(editorPane, config, editable, reRender, () => {
          scheduleValidation();
          triggerPreview(id);
        });
      } else {
        const ta = editorPane.createEl('textarea', { cls: 'cad-de-textarea' });
        ta.value = JSON.stringify(config, null, 2);
        ta.readOnly = !editable;
        ta.spellcheck = false;
        if (editable) {
          ta.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              try {
                this._dashEditorDraft = normalizeDashboardConfigShape(JSON.parse(ta.value));
                validateDraft();
                renderPreview(id);
              } catch (e) {
                setValidationStatus(`Invalid JSON: ${e.message}`, false);
              }
            }, 600);
          });
        }
      }

      const actions = editorPane.createDiv({ cls: 'cad-de-actions' });
      if (!editable) {
        const customizeBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Customize' });
        customizeBtn.addEventListener('click', () => {
          const targetStore = id.startsWith('planner.') ? 'planner' : 'dashboards';
          if (!WORKSPACE_CONFIG[targetStore]) WORKSPACE_CONFIG[targetStore] = {};
          WORKSPACE_CONFIG[targetStore][id] = JSON.parse(JSON.stringify(BUILTIN_DASHBOARD_DEFAULTS[id] || getConfig(id)));
          this._dashEditorDraft = getConfig(id);
          renderEditorPane(id);
          renderPreview(id);
        });
      } else {
        const saveBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Save' });
        saveBtn.addEventListener('click', async () => {
          try {
            if (!validateDraft()) return;
            this._dashEditorDraft = normalizeDashboardConfigShape(this._dashEditorDraft);
            const targetStore = id.startsWith('planner.') ? 'planner' : 'dashboards';
            if (!WORKSPACE_CONFIG[targetStore]) WORKSPACE_CONFIG[targetStore] = {};
            WORKSPACE_CONFIG[targetStore][id] = this._dashEditorDraft;
            await saveWorkspaceConfig(this.app, JSON.stringify(WORKSPACE_CONFIG, null, 2));
            new obsidian.Notice('Dashboard saved.');
          } catch (e) { new obsidian.Notice(`Save failed: ${e.message}`); }
        });
        if (BUILTIN_DASHBOARD_DEFAULTS[id] || id.startsWith('planner.')) {
          const resetBtn = actions.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Reset to built-in' });
          resetBtn.addEventListener('click', async () => {
            const stores = id.startsWith('planner.') ? ['planner', 'dashboards'] : ['dashboards'];
            stores.forEach((targetStore: 'planner' | 'dashboards') => {
              if (!WORKSPACE_CONFIG[targetStore]) return;
              delete WORKSPACE_CONFIG[targetStore][id];
              if (Object.keys(WORKSPACE_CONFIG[targetStore]).length === 0) delete WORKSPACE_CONFIG[targetStore];
            });
            await saveWorkspaceConfig(this.app, JSON.stringify(WORKSPACE_CONFIG, null, 2));
            new obsidian.Notice('Reset to built-in.');
            this._dashEditorDraft = getConfig(id);
            renderEditorPane(id);
            renderPreview(id);
          });
        }
      }
      validateDraft();
    };

    const renderAll = (id: string) => {
      this._dashEditorSurfaceId = id;
      this._dashEditorDraft = getConfig(id);
      renderEditorPane(id);
      renderPreview(id);
    };

    sel.addEventListener('change', () => renderAll(sel.value));
    visualBtn.addEventListener('click', () => {
      this._dashEditorMode = 'visual'; visualBtn.addClass('active'); jsonBtn.removeClass('active');
      renderEditorPane(this._dashEditorSurfaceId);
    });
    jsonBtn.addEventListener('click', () => {
      this._dashEditorMode = 'json'; jsonBtn.addClass('active'); visualBtn.removeClass('active');
      renderEditorPane(this._dashEditorSurfaceId);
    });

    const initialId = this._dashEditorSurfaceId && allIds.includes(this._dashEditorSurfaceId)
      ? this._dashEditorSurfaceId : allIds[0];
    sel.value = initialId;
    renderAll(initialId);
  }

  _renderDashboardDesigner(pane: HTMLElement, config: DashConfigLike, editable: boolean, reRender: () => void, triggerPreview: () => void) {
    const entityKeys = workspaceConfiguredEntityEntries(WORKSPACE_CONFIG).map(([key]) => key);
    const defaultEntityKey = entityKeys[0] || Object.keys(ENTITIES)[0] || 'contact';
    const summarizeCardSource = (source: string | Frontmatter | unknown[] | null | undefined) => {
      if (!source) return '';
      if (typeof source === 'string') return source.trim();
      if (Array.isArray(source)) return `${source.length} items`;
      if (typeof source === 'object') {
        const bits = [
          source.builtIn || source.kind || source.mode || source.source,
          source.section,
          source.entity,
          source.field,
          source.base?.file || source.base?.base || source.base?.path || source.base?.basePath,
        ].filter(Boolean).map((value) => String(value).trim());
        return bits.join(' · ') || 'object';
      }
      return String(source).trim();
    };

    // Header fields
    const metaSection = pane.createDiv({ cls: 'cad-de-section' });
    metaSection.createDiv({ cls: 'cad-de-section-label', text: 'Header' });
    const titleInput = metaSection.createEl('input', { type: 'text', cls: 'cad-de-field', value: config.title || '', placeholder: 'Title' });
    titleInput.disabled = !editable;
    titleInput.addEventListener('input', () => { config.title = titleInput.value; triggerPreview(); });
    const subInput = metaSection.createEl('input', { type: 'text', cls: 'cad-de-field', value: config.subtitle || '', placeholder: 'Subtitle' });
    subInput.disabled = !editable;
    subInput.addEventListener('input', () => { config.subtitle = subInput.value; triggerPreview(); });
    const kindRow = metaSection.createDiv({ cls: 'cad-de-form-row' });
    kindRow.createDiv({ cls: 'cad-de-form-label', text: 'Kind' });
    const kindSelect = kindRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const defaultKind = String(config.kind || (String(this._dashEditorSurfaceId || '').startsWith('planner.') ? 'planner' : 'dashboard')).trim().toLowerCase() || 'dashboard';
    ['dashboard', 'report', 'planner'].forEach((kind) => {
      const opt = kindSelect.createEl('option', { value: kind, text: kind });
      if (defaultKind === kind) opt.selected = true;
    });
    kindSelect.disabled = !editable;
    kindSelect.addEventListener('change', () => { config.kind = kindSelect.value; triggerPreview(); });
    const contextRow = metaSection.createDiv({ cls: 'cad-de-form-row' });
    contextRow.createDiv({ cls: 'cad-de-form-label', text: 'Context' });
    const contextSelect = contextRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    [
      { value: '', label: 'none' },
      { value: 'client-work', label: 'selected client/project' },
    ].forEach(({ value, label }) => {
      const opt = contextSelect.createEl('option', { value, text: label });
      if (String(config.contextFilter || '') === value) opt.selected = true;
    });
    contextSelect.disabled = !editable;
    contextSelect.addEventListener('change', () => {
      if (contextSelect.value) config.contextFilter = contextSelect.value;
      else delete config.contextFilter;
      triggerPreview();
    });

    // Stats
    const statsSection = pane.createDiv({ cls: 'cad-de-section' });
    const statsHead = statsSection.createDiv({ cls: 'cad-de-section-head' });
    statsHead.createDiv({ cls: 'cad-de-section-label', text: `Stats (${(config.stats || []).length})` });
    if (editable) {
      const addBtn = statsHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add stat' });
      addBtn.addEventListener('click', () => {
        (config.stats || (config.stats = [])).push({ label: 'NEW STAT', entity: defaultEntityKey, count: 'all' });
        reRender();
      });
    }
    (config.stats || []).forEach((stat: CardLike, idx: number) => {
      const chip = statsSection.createDiv({ cls: 'cad-de-stat-chip' });
      const lbl = chip.createEl('input', { type: 'text', cls: 'cad-de-stat-label' });
      lbl.value = stat.label || ''; lbl.placeholder = 'LABEL'; lbl.disabled = !editable;
      lbl.addEventListener('input', () => { stat.label = lbl.value; triggerPreview(); });
      const ent = chip.createEl('select', { cls: 'cad-de-stat-select' });
      ent.disabled = !editable;
      if (stat.entity && !entityKeys.includes(stat.entity) && ENTITIES[stat.entity]) {
        const o = ent.createEl('option', { value: stat.entity, text: stat.entity });
        o.selected = true;
      }
      entityKeys.forEach(k => { const o = ent.createEl('option', { value: k, text: k }); if (k === stat.entity) o.selected = true; });
      ent.addEventListener('change', () => { stat.entity = ent.value; triggerPreview(); });
      const cnt = chip.createEl('select', { cls: 'cad-de-stat-select' });
      cnt.disabled = !editable;
      ['all', 'open'].forEach(v => { const o = cnt.createEl('option', { value: v, text: v }); if (v === stat.count) o.selected = true; });
      cnt.addEventListener('change', () => { stat.count = cnt.value; triggerPreview(); });
      if (editable) {
        const del = chip.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.addEventListener('click', () => { config.stats.splice(idx, 1); reRender(); });
      }
    });

    const controlsSection = pane.createDiv({ cls: 'cad-de-section' });
    const controlsHead = controlsSection.createDiv({ cls: 'cad-de-section-head' });
    controlsHead.createDiv({ cls: 'cad-de-section-label', text: `Controls (${(config.controls || []).length})` });
    if (editable) {
      const addBtn = controlsHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add control' });
      addBtn.addEventListener('click', () => {
        (config.controls || (config.controls = [])).push({ kind: 'selector', key: 'filter', label: 'New control', allLabel: 'All' });
        reRender();
      });
    }
    (config.controls || []).forEach((control: CardLike, idx: number) => {
      const chip = controlsSection.createDiv({ cls: 'cad-de-stat-chip cad-de-control-chip' });
      const lbl = chip.createEl('input', { type: 'text', cls: 'cad-de-stat-label' });
      lbl.value = control.title || control.label || ''; lbl.placeholder = 'LABEL'; lbl.disabled = !editable;
      lbl.addEventListener('input', () => { control.label = lbl.value; triggerPreview(); });
      const typ = chip.createEl('select', { cls: 'cad-de-stat-select' });
      typ.disabled = !editable;
      ['selector', 'date-range', 'markdown', 'actions', 'base-link', 'base-embed', 'base-view'].forEach((type) => {
        const o = typ.createEl('option', { value: type, text: type });
        if (type === (control.kind || 'selector')) o.selected = true;
      });
      typ.addEventListener('change', () => { control.kind = typ.value; triggerPreview(); });
      if (editable) {
        const del = chip.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.addEventListener('click', () => { config.controls.splice(idx, 1); reRender(); });
      }
    });

    // Normalize layout columns to arrays
    if (!config.layout) config.layout = [];
    config.layout = config.layout.map((row: (CardLike | CardLike[])[]) => row.map(col => Array.isArray(col) ? col : [col]));

    // Layout board
    const layoutSection = pane.createDiv({ cls: 'cad-de-section' });
    layoutSection.createDiv({ cls: 'cad-de-section-label', text: 'Layout' });

    let activeDrag: DesignerDragPos | null = null;

    config.layout.forEach((row: CardLike[][], rowIdx: number) => {
      const rowEl = layoutSection.createDiv({ cls: 'cad-de-layout-row' });
      const rowHead = rowEl.createDiv({ cls: 'cad-de-row-head' });
      rowHead.createDiv({ cls: 'cad-de-row-label', text: `Row ${rowIdx + 1}` });
      if (editable) {
        const addCol = rowHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Col' });
        addCol.addEventListener('click', () => {
          row.push([{ kind: 'list', title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' }]);
          reRender();
        });
        const delRow = rowHead.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '× Row' });
        delRow.addEventListener('click', () => { config.layout.splice(rowIdx, 1); reRender(); });
      }

      const cols = rowEl.createDiv({ cls: 'cad-de-row-cols' });
      row.forEach((col, colIdx) => {
        const colEl = cols.createDiv({ cls: 'cad-de-layout-col' });

        if (editable && row.length > 1) {
          const delCol = colEl.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger cad-de-del-col', text: '× Col' });
          delCol.addEventListener('click', () => { row.splice(colIdx, 1); reRender(); });
        }

        col.forEach((card, cardIdx) => {
          const cardEl = colEl.createDiv({ cls: 'cad-de-card' });
          cardEl.draggable = editable;
          if (editable) {
            cardEl.addEventListener('dragstart', (ev) => {
              activeDrag = { rowIdx, colIdx, cardIdx };
              ev.dataTransfer.effectAllowed = 'move';
              ev.dataTransfer.setData('text/cad-dash', JSON.stringify(activeDrag));
              setTimeout(() => cardEl.addClass('cad-de-dragging'), 0);
            });
            cardEl.addEventListener('dragend', () => { activeDrag = null; cardEl.removeClass('cad-de-dragging'); });
            cardEl.addEventListener('dragover', (ev) => {
              if (!activeDrag) return; ev.preventDefault(); ev.stopPropagation(); cardEl.addClass('drag-over');
            });
            cardEl.addEventListener('dragleave', () => cardEl.removeClass('drag-over'));
            cardEl.addEventListener('drop', (ev) => {
              ev.preventDefault(); ev.stopPropagation(); cardEl.removeClass('drag-over');
              if (!activeDrag) return;
              const src = activeDrag;
              const [moved] = config.layout[src.rowIdx][src.colIdx].splice(src.cardIdx, 1);
              let tgt = cardIdx;
              if (src.rowIdx === rowIdx && src.colIdx === colIdx && src.cardIdx < cardIdx) tgt--;
              config.layout[rowIdx][colIdx].splice(Math.max(0, tgt), 0, moved);
              reRender();
            });
          }

          const cardHead = cardEl.createDiv({ cls: 'cad-de-card-head' });
          if (editable) cardHead.createSpan({ cls: 'cad-de-drag-handle', text: '⠿' });
          const titleSpan = cardHead.createSpan({ cls: 'cad-de-card-title-text', text: card.title || '(untitled)' });
          const badges = cardHead.createDiv({ cls: 'cad-de-card-badges' });
          badges.createSpan({ cls: 'cad-de-card-badge', text: card.kind || card.entity || '?' });
          const sourceLabel = summarizeCardSource(card.source);
          if (sourceLabel && sourceLabel !== 'recent') badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: sourceLabel });

          if (editable) {
            const acts = cardHead.createDiv({ cls: 'cad-de-card-actions' });
            const editBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Edit' });
            editBtn.addEventListener('mousedown', ev => ev.stopPropagation());
            editBtn.addEventListener('dragstart', ev => ev.stopPropagation());
            editBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const existing = cardEl.querySelector('.cad-de-card-form');
              if (existing) { existing.remove(); return; }
              this._renderCardForm(cardEl, card, () => {
                titleSpan.textContent = card.title || '(untitled)';
                badges.empty();
                badges.createSpan({ cls: 'cad-de-card-badge', text: card.kind || card.entity || '?' });
                const updatedSourceLabel = summarizeCardSource(card.source);
                if (updatedSourceLabel && updatedSourceLabel !== 'recent') {
                  badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: updatedSourceLabel });
                }
                triggerPreview();
              });
            });
            const delBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
            delBtn.addEventListener('mousedown', ev => ev.stopPropagation());
            delBtn.addEventListener('click', () => { col.splice(cardIdx, 1); reRender(); });
          }
        });

        if (editable) {
          const dropZone = colEl.createDiv({ cls: 'cad-de-col-drop-zone', text: '+ Add card' });
          dropZone.addEventListener('dragover', (ev) => {
            if (!activeDrag) return; ev.preventDefault(); ev.stopPropagation(); dropZone.addClass('drag-over');
          });
          dropZone.addEventListener('dragleave', () => dropZone.removeClass('drag-over'));
          dropZone.addEventListener('drop', (ev) => {
            ev.preventDefault(); ev.stopPropagation(); dropZone.removeClass('drag-over');
            if (!activeDrag) return;
            const src = activeDrag;
            const [moved] = config.layout[src.rowIdx][src.colIdx].splice(src.cardIdx, 1);
            config.layout[rowIdx][colIdx].push(moved);
            reRender();
          });
          dropZone.addEventListener('click', () => {
            col.push({ title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' });
            reRender();
          });
        }
      });
    });

    if (editable) {
      const addRowBtn = layoutSection.createEl('button', { cls: 'cad-btn cad-btn-sm cad-de-add-row-btn', text: '+ Add row' });
      addRowBtn.addEventListener('click', () => {
        config.layout.push([[{ title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' }]]);
        reRender();
      });
    }

    // Conditional rows — same visual pattern as layout rows; each card in cr.cards = one column
    if ((config.conditionalRows || []).length > 0 || editable) {
      const crSection = pane.createDiv({ cls: 'cad-de-section' });
      crSection.createDiv({ cls: 'cad-de-section-label', text: 'Conditional rows' });
      const newCard = () => ({ title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' });
      (config.conditionalRows || []).forEach((cr: Frontmatter, crIdx: number) => {
        const crEl = crSection.createDiv({ cls: 'cad-de-layout-row' });
        const crRowHead = crEl.createDiv({ cls: 'cad-de-row-head' });
        crRowHead.createDiv({ cls: 'cad-de-row-label', text: 'Show when' });
        const condInp = crRowHead.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
        condInp.value = (cr.condition?.entities || []).join(', ');
        condInp.placeholder = 'entities with data (comma-separated)';
        condInp.disabled = !editable;
        condInp.addEventListener('input', () => {
          if (!cr.condition) cr.condition = {};
          cr.condition.entities = condInp.value.split(',').map(s => s.trim()).filter(Boolean);
          triggerPreview();
        });
        if (editable) {
          const addCol = crRowHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Col' });
          addCol.addEventListener('click', () => { (cr.cards || (cr.cards = [])).push(newCard()); reRender(); });
          const delCr = crRowHead.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '× Row' });
          delCr.addEventListener('click', () => { config.conditionalRows.splice(crIdx, 1); reRender(); });
        }
        const crCols = crEl.createDiv({ cls: 'cad-de-row-cols' });
        (cr.cards || []).forEach((card: CardLike, cardIdx: number) => {
          const col = crCols.createDiv({ cls: 'cad-de-layout-col' });
          if (editable && (cr.cards || []).length > 1) {
            const delCol = col.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger cad-de-del-col', text: '× Col' });
            delCol.addEventListener('click', () => { cr.cards.splice(cardIdx, 1); reRender(); });
          }
          const cardEl = col.createDiv({ cls: 'cad-de-card' });
          const cardHead = cardEl.createDiv({ cls: 'cad-de-card-head' });
          const titleSpan = cardHead.createSpan({ cls: 'cad-de-card-title-text', text: card.title || '(untitled)' });
          const badges = cardHead.createDiv({ cls: 'cad-de-card-badges' });
          badges.createSpan({ cls: 'cad-de-card-badge', text: card.entity || '?' });
          const sourceLabel = summarizeCardSource(card.source);
          if (sourceLabel && sourceLabel !== 'recent') badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: sourceLabel });
          if (editable) {
            const acts = cardHead.createDiv({ cls: 'cad-de-card-actions' });
            const editBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Edit' });
            editBtn.addEventListener('mousedown', ev => ev.stopPropagation());
            editBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const existing = cardEl.querySelector('.cad-de-card-form');
              if (existing) { existing.remove(); return; }
              this._renderCardForm(cardEl, card, () => {
                titleSpan.textContent = card.title || '(untitled)';
                badges.empty();
                badges.createSpan({ cls: 'cad-de-card-badge', text: card.entity || '?' });
                const updatedSourceLabel = summarizeCardSource(card.source);
                if (updatedSourceLabel && updatedSourceLabel !== 'recent') {
                  badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: updatedSourceLabel });
                }
                triggerPreview();
              });
            });
            const delBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
            delBtn.addEventListener('click', () => { cr.cards.splice(cardIdx, 1); reRender(); });
          }
        });
      });
      if (editable) {
        const addRowBtn = crSection.createEl('button', { cls: 'cad-btn cad-btn-sm cad-de-add-row-btn', text: '+ Add conditional row' });
        addRowBtn.addEventListener('click', () => {
          (config.conditionalRows || (config.conditionalRows = [])).push({ condition: { entities: [] }, cards: [newCard()] });
          reRender();
        });
      }
    }
  }

  _renderCardForm(parent: HTMLElement, card: CardLike, onChange: () => void) {
    // These four names were referenced but never defined in the original
    // monolithic main.js — the widget editor threw ReferenceError on render.
    // Defined here with the values the surrounding code clearly intends.
    const editable = true;
    const config = card;
    const entityDef = ENTITIES[card.entity];
    const defaultEntityKey = Object.keys(ENTITIES)[0] || '';
    const form = parent.createDiv({ cls: 'cad-de-card-form' });
    let _dlId = 0;
    const entityFieldKeys = [...new Set((ENTITIES[card.entity]?.fields || []).map((field) => field.key).filter(Boolean))];
    const fieldSuggestions = entityFieldKeys.length ? entityFieldKeys : ['title', 'name', 'status', 'value', 'date'];
    const addSuggestion = (dl: HTMLDataListElement | null, value: unknown) => {
      const text = String(value || '').trim();
      if (!dl || !text) return;
      if ([...dl.querySelectorAll('option')].some((opt) => opt.value === text)) return;
      dl.createEl('option', { value: text });
    };
    const isScalarValue = (value: unknown) => value == null || ['string', 'number', 'boolean'].includes(typeof value);
    const formatFieldValue = (value: unknown) => {
      if (Array.isArray(value)) {
        if (value.every(isScalarValue)) return value.join(', ');
        return JSON.stringify(value, null, 2);
      }
      if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
      return value == null ? '' : String(value);
    };
    const parseFieldValue = (value: unknown, current: unknown) => {
      if (Array.isArray(current)) {
        if (current.every(isScalarValue)) {
          return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
        }
        try { return JSON.parse(String(value || '')); } catch (_) { return String(value || ''); }
      }
      if (current && typeof current === 'object') {
        try { return JSON.parse(String(value || '')); } catch (_) { return String(value || ''); }
      }
      return value;
    };
    // Field-level help (FIELD_HELP) lives in help-content.ts — shown on hover.
    const addRow = (label: string, key: string, opts?: string[], combobox = false) => {
      const r = form.createDiv({ cls: 'cad-de-form-row' });
      const labelEl = r.createDiv({ cls: 'cad-de-form-label', text: label });
      const help = FIELD_HELP[key];
      if (help) labelEl.setAttribute('title', help);
      if (opts && !combobox) {
        const sel = r.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
        opts.forEach(v => { const o = sel.createEl('option', { value: v, text: v }); if (v === card[key]) o.selected = true; });
        sel.addEventListener('change', () => { card[key] = sel.value; onChange(); });
      } else if (opts && combobox) {
        const dlId = `cad-de-dl-${++_dlId}`;
        const inp = r.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', attr: { list: dlId } });
        inp.value = formatFieldValue(card[key]);
        const dl = r.createEl('datalist', { attr: { id: dlId } });
        opts.forEach(v => dl.createEl('option', { value: v }));
        inp.addEventListener('input', () => {
          card[key] = parseFieldValue(inp.value, card[key]);
          onChange();
        });
        return dl;
      } else {
        const current = card[key];
        if (Array.isArray(current) && !current.every(isScalarValue)) {
          const ta = r.createEl('textarea', { cls: 'cad-de-textarea cad-de-json-field' });
          ta.rows = 4;
          ta.value = formatFieldValue(current);
          ta.spellcheck = false;
          ta.addEventListener('input', () => {
            card[key] = parseFieldValue(ta.value, current);
            onChange();
          });
        } else if (current && typeof current === 'object') {
          const ta = r.createEl('textarea', { cls: 'cad-de-textarea cad-de-json-field' });
          ta.rows = 4;
          ta.value = formatFieldValue(current);
          ta.spellcheck = false;
          ta.addEventListener('input', () => {
            card[key] = parseFieldValue(ta.value, current);
            onChange();
          });
        } else {
          const val = formatFieldValue(current);
          const inp = r.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
          inp.value = val; inp.placeholder = key;
          inp.addEventListener('input', () => {
            card[key] = inp.value;
            onChange();
          });
        }
      }
      return null;
    };
    const getObjectField = (key: string, fallback: Frontmatter = {}) => {
      const current = card[key];
      if (current && typeof current === 'object' && !Array.isArray(current)) return current;
      return Object.assign({}, fallback);
    };
    const setObjectField = (key: string, patch: Frontmatter) => {
      const next = getObjectField(key);
      Object.entries(patch).forEach(([prop, value]) => {
        if (value == null || value === '') delete next[prop];
        else next[prop] = value;
      });
      card[key] = next;
      onChange();
    };
    const currentSource = () => getObjectField('source', typeof card.source === 'string' ? { source: card.source } : {});
    const applyWidgetTypeDefaults = (kind: string) => {
      const type = String(kind || '').trim();
      const sourceObj = currentSource();
      const builtInName = String(sourceObj.builtIn || '').trim().toLowerCase();
      const setSourceDefaults = (patch: Frontmatter) => {
        card.source = Object.assign({}, sourceObj, patch);
      };
      if (!card.title) {
        if (type === 'gauge') card.title = 'SCORE';
        else if (type === 'progress') card.title = 'PROGRESS';
        else if (type === 'heatmap') card.title = 'CADENCE';
      }
      if (type === 'gauge') {
        card.max = 100;
        card.suffix = '%';
        if (card.caption == null) card.caption = 'score';
        if (builtInName === 'productivity') {
          card.field = 'completion';
          delete card.valueField;
          setSourceDefaults({ mode: 'built-in', builtIn: 'productivity', section: null });
        } else if (!card.field) {
          card.field = 'value';
        }
      }
      if (type === 'progress') {
        if (builtInName === 'productivity') {
          card.field = 'activeDays';
          card.max = 30;
          card.suffix = '/30';
          card.label = card.label || 'Days with activity';
          delete card.valueField;
          setSourceDefaults({ mode: 'built-in', builtIn: 'productivity', section: null });
        } else {
          if (card.max == null) card.max = 100;
          if (card.suffix == null) card.suffix = '%';
          if (card.label == null) card.label = 'Built';
        }
      }
      if (type === 'heatmap') {
        if (!card.dateField) card.dateField = 'date';
        if (card.days == null) card.days = 35;
        if (card.columns == null) card.columns = 7;
        if (builtInName === 'productivity') {
          card.field = 'journal';
          delete card.valueField;
          setSourceDefaults({ mode: 'built-in', builtIn: 'productivity', section: 'per-day' });
        }
      }
    };
    const sortedEntityKeys = workspaceConfiguredEntityEntries(WORKSPACE_CONFIG).map(([key]) => key);
    if (card.entity && ENTITIES[card.entity] && !sortedEntityKeys.includes(card.entity)) {
      sortedEntityKeys.unshift(card.entity);
    }
    // Show only the fields relevant to this widget kind — the schema declares
    // them in `supports`. An unknown kind shows everything (safe fallback).
    const widgetKind = String(card.kind || (Array.isArray(card.merge) ? 'merge' : 'list')).trim() || 'list';
    const cardSchema = dashboardWidgetSchema(widgetKind);
    const supportedFields = new Set(cardSchema?.supports || []);
    const fieldOn = (...keys: string[]) => !cardSchema || keys.some((k) => supportedFields.has(k));
    const usesSource = fieldOn('source', 'entity', 'base');

    // WIDGET_INTRO / WIDGET_GUIDES live in help-content.ts.
    const guide = WIDGET_GUIDES[widgetKind];
    if (guide) {
      this._helpPanel(form, `widget-${widgetKind}`, `About the “${cardSchema?.label || widgetKind}” widget`, (body) => {
        this._helpBlock(body, 'What it does', [guide.what]);
        this._helpBlock(body, 'When to use it', [guide.use]);
        if (guide.fields.length) this._helpBlock(body, 'Key settings', guide.fields);
      });
    }

    const basicsSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
    const basicsLabel = basicsSection.createDiv({ cls: 'cad-de-section-label', text: `Settings — ${cardSchema?.label || widgetKind}` });
    if (WIDGET_INTRO[widgetKind]) basicsLabel.setAttribute('title', WIDGET_INTRO[widgetKind]);
    addRow('Title', 'title');
    if (fieldOn('entity')) addRow('Entity', 'entity', sortedEntityKeys, true);
    let titleFieldList: HTMLDataListElement | null = null;
    let metaFieldList: HTMLDataListElement | null = null;
    if (fieldOn('titleFields')) titleFieldList = addRow('Title fields', 'titleFields', fieldSuggestions, true) || null;
    if (fieldOn('metaFields')) metaFieldList = addRow('Meta fields', 'metaFields', fieldSuggestions, true) || null;
    if (fieldOn('placeholder')) addRow('Placeholder', 'placeholder');
    if (fieldOn('eyebrow')) addRow('Eyebrow', 'eyebrow');
    if (fieldOn('empty')) addRow('Empty text', 'empty');
    if (fieldOn('section', 'heading')) addRow('Section', 'section');
    if (fieldOn('tone')) addRow('Tone', 'tone', ['emerald', 'mint', 'sky', 'warn', 'rose']);
    if (fieldOn('accent')) addRow('Accent', 'accent', ['emerald', 'mint', 'sky', 'warn', 'rose']);
    if (fieldOn('field')) addRow('Field', 'field', fieldSuggestions, true);
    if (fieldOn('valueField')) addRow('Value field', 'valueField');
    if (fieldOn('metric')) addRow('Metric', 'metric', ['count', 'sum', 'avg', 'min', 'max', 'filled', 'empty', 'open', 'uniqueCount', 'ratio'], true);
    if (fieldOn('groupBy')) addRow('Group by', 'groupBy');
    if (fieldOn('limit')) addRow('Limit', 'limit');
    // Resolve the base path this widget reads from: an explicit source.base.file,
    // else the widget entity's mapped base. Used to populate the View dropdown.
    const cardSrc = (card.source && typeof card.source === 'object' && !Array.isArray(card.source)) ? card.source as Frontmatter : {};
    const srcBaseRef = cardSrc.base;
    const explicitBaseFile = typeof srcBaseRef === 'string' ? srcBaseRef
      : (srcBaseRef && typeof srcBaseRef === 'object' ? String(srcBaseRef.file || srcBaseRef.base || srcBaseRef.path || '') : '');
    const resolvedBaseFile = explicitBaseFile || (card.entity ? entityBasePath(this.plugin.settings, String(card.entity)) : '');

    // View — a dropdown of the resolved base's views, each labelled with its type
    // and how it renders (editable table vs live read-only embed). Falls back to
    // a free-text row when no base is resolvable.
    if (fieldOn('view', 'base')) {
      if (resolvedBaseFile) {
        const r = form.createDiv({ cls: 'cad-de-form-row' });
        r.createDiv({ cls: 'cad-de-form-label', text: 'View', attr: { title: FIELD_HELP.view || '' } });
        const sel = r.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
        sel.createEl('option', { value: '', text: '— default view —' });
        const currentView = String((card.view as string) || '').trim();
        if (currentView) { const o = sel.createEl('option', { value: currentView, text: `${currentView} (loading…)` }); o.selected = true; }
        const file = this.app.vault.getAbstractFileByPath(resolvedBaseFile);
        if (file instanceof obsidian.TFile) {
          void readBaseSummary(this.app, file).then((summary) => {
            const metas = summary?.viewMeta?.length ? summary.viewMeta
              : (summary?.views || []).map((name) => ({ name, type: 'table' }));
            sel.empty();
            sel.createEl('option', { value: '', text: '— default view —' });
            metas.forEach(({ name, type }) => {
              const editable = baseViewRendersInline(type);
              const o = sel.createEl('option', { value: name, text: `${name} — ${type} · ${editable ? 'editable table' : 'live embed'}` });
              if (name === currentView) o.selected = true;
            });
          }).catch(() => {});
        }
        sel.addEventListener('change', () => {
          const v = sel.value;
          if (v) card.view = v; else delete card.view;
          // keep source.base.view in sync when the source is an explicit base object
          if (cardSrc.base && typeof cardSrc.base === 'object' && !Array.isArray(cardSrc.base)) {
            if (v) (cardSrc.base as Frontmatter).view = v; else delete (cardSrc.base as Frontmatter).view;
          }
          onChange();
        });
      } else {
        addRow('View', 'view');
      }
    }

    // Base picker — point this widget's source at an existing .base file. Changing
    // it re-renders the form so the View dropdown repopulates for the new base.
    if (fieldOn('base', 'source')) (() => {
      const r = form.createDiv({ cls: 'cad-de-form-row' });
      r.createDiv({ cls: 'cad-de-form-label', text: 'Base' });
      const sel = r.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
      sel.createEl('option', { value: '', text: '— none (use entity) —' });
      this.app.vault.getFiles().filter((f) => f.extension === 'base').map((f) => f.path).sort()
        .forEach((p) => { const o = sel.createEl('option', { value: p, text: p }); if (p === explicitBaseFile) o.selected = true; });
      sel.addEventListener('change', () => {
        if (sel.value) {
          const view = String((card.view as string) || '').trim();
          card.source = Object.assign({}, view ? { view } : {}, { base: view ? { file: sel.value, view } : { file: sel.value } });
        } else if (card.source && typeof card.source === 'object' && !Array.isArray(card.source)) {
          delete (card.source as Frontmatter).base;
          if (!Object.keys(card.source as Frontmatter).length) delete card.source;
        }
        onChange();
        form.remove();
        this._renderCardForm(parent, card, onChange);
      });
    })();
    if (fieldOn('height')) addRow('Height', 'height');
    if (fieldOn('fallback')) addRow('Fallback', 'fallback', ['preview', 'link', 'error']);

    const typeRow = form.createDiv({ cls: 'cad-de-form-row' });
    typeRow.createDiv({ cls: 'cad-de-form-label', text: 'Widget type' });
    const typeSelect = typeRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const widgetTypes = [...PURE_DASHBOARD_WIDGET_TYPES];
    const currentType = String(card.kind || (Array.isArray(card.merge) ? 'merge' : 'list')).trim() || 'list';
    if (!widgetTypes.includes(currentType)) widgetTypes.push(currentType);
    widgetTypes.forEach((type) => {
      const option = typeSelect.createEl('option', { value: type, text: type });
      if (type === currentType) option.selected = true;
    });
    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'merge') {
        card.kind = '';
        if (!Array.isArray(card.merge)) card.merge = [{ entity: card.entity || defaultEntityKey, source: 'recent' }];
      } else {
        card.kind = typeSelect.value;
        delete card.merge;
        applyWidgetTypeDefaults(typeSelect.value);
      }
      onChange();
      form.remove();
      this._renderCardForm(parent, card, onChange);
    });
    const source = currentSource();
    const sourceModeValue = (() => {
      const raw = String(source.mode || '').trim().toLowerCase();
      return raw || (String(source.builtIn || '').trim() ? 'built-in' : 'recent');
    })();
    const setSourceField = (patch: Frontmatter, opts: { clearSource?: boolean } = {}) => {
      const normalizedPatch = Object.assign({}, patch);
      const next = Object.assign({}, getObjectField('source', { mode: sourceModeValue || 'recent' }), normalizedPatch);
      if (String(next.mode || '').trim() !== 'built-in') delete next.builtIn;
      if (opts.clearSource && !String(next.mode || '').trim()) delete next.source;
      card.source = next;
      onChange();
    };
    const sourceSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
    // Sourceless widgets (quick-add, date-hero, note-section) don't read data —
    // hide the whole Source details block so their editor stays simple.
    if (!usesSource) sourceSection.style.display = 'none';
    sourceSection.createDiv({ cls: 'cad-de-section-label', text: 'Where does the data come from?' })
      .setAttribute('title', SOURCE_SECTION_HELP);
    const sourceModeRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceModeRow.createDiv({ cls: 'cad-de-form-label', text: 'Mode' });
    const sourceMode = sourceModeRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    ['recent', 'recent-open', 'due', 'due-open', 'entity', 'base', 'list', 'table', 'built-in'].forEach((mode) => {
      const opt = sourceMode.createEl('option', { value: mode, text: mode });
      if (sourceModeValue === mode || (!sourceModeValue && mode === 'recent')) opt.selected = true;
    });
    sourceMode.addEventListener('change', () => {
      if (sourceMode.value === 'built-in') {
        setSourceField({
          mode: 'built-in',
          builtIn: sourceProvider.value || 'home',
          section: sectionSelect.value || null,
        }, { clearSource: false });
      } else {
        setSourceField({ mode: sourceMode.value }, { clearSource: true });
      }
      syncBuiltInControls();
    });

    const sourceProviderRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceProviderRow.createDiv({ cls: 'cad-de-form-label', text: 'Built-in source' });
    const sourceProvider = sourceProviderRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const builtInSourceOptions = [
      { value: 'home', label: 'home' },
      { value: 'planner', label: 'planner' },
      { value: 'productivity', label: 'productivity' },
    ];
    const currentBuiltInSource = String(source.builtIn || (sourceModeValue === 'built-in' ? 'home' : '')).trim().toLowerCase();
    builtInSourceOptions.forEach((choice) => {
      const opt = sourceProvider.createEl('option', { value: choice.value, text: choice.label });
      if ((currentBuiltInSource || 'home') === choice.value) opt.selected = true;
    });
    sourceProvider.disabled = !editable || sourceModeValue !== 'built-in';
    sourceProvider.addEventListener('change', () => {
      const builtInName = sourceProvider.value || 'home';
      const selectedSection = builtInSectionOptions(builtInName)[0]?.value || '';
      setSourceField({
        mode: 'built-in',
        builtIn: builtInName,
        section: selectedSection,
      }, { clearSource: false });
      syncBuiltInControls();
    });

    const sourceEntityRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceEntityRow.createDiv({ cls: 'cad-de-form-label', text: 'Source entity' });
    const sourceEntity = sourceEntityRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    sourceEntity.value = source.entity || card.entity || '';
    sourceEntity.placeholder = 'entity key';
    sourceEntity.addEventListener('input', () => {
      card.entity = sourceEntity.value || '';
      setSourceField({ entity: sourceEntity.value || null }, { clearSource: false });
    });

    const sourceFiltersRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceFiltersRow.createDiv({ cls: 'cad-de-form-label', text: 'Filters' });
    const sourceFilters = sourceFiltersRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    sourceFilters.value = source.filters || card.filters || '';
    sourceFilters.placeholder = 'YAML/SQL-like filter expression';
    sourceFilters.addEventListener('input', () => {
      setSourceField({ filters: sourceFilters.value });
    });

    const sourceGroupRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceGroupRow.createDiv({ cls: 'cad-de-form-label', text: 'Group by' });
    const sourceGroup = sourceGroupRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', attr: { list: `cad-de-group-${++_dlId}` } });
    sourceGroup.value = source.groupBy || card.groupBy || '';
    sourceGroup.placeholder = 'field key';
    const sourceGroupList = sourceGroupRow.createEl('datalist', { attr: { id: `cad-de-group-${_dlId}` } });
    fieldSuggestions.forEach((field) => sourceGroupList.createEl('option', { value: field }));
    sourceGroup.addEventListener('input', () => {
      card.groupBy = sourceGroup.value || '';
      setSourceField({ groupBy: sourceGroup.value });
    });

    const sourceSortRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceSortRow.createDiv({ cls: 'cad-de-form-label', text: 'Sort' });
    const sourceSort = sourceSortRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', attr: { list: `cad-de-sort-${++_dlId}` } });
    sourceSort.value = source.sort || card.sort || '';
    sourceSort.placeholder = 'field ASC';
    const sourceSortList = sourceSortRow.createEl('datalist', { attr: { id: `cad-de-sort-${_dlId}` } });
    fieldSuggestions.forEach((field) => {
      sourceSortList.createEl('option', { value: `${field} ASC` });
      sourceSortList.createEl('option', { value: `${field} DESC` });
    });
    sourceSort.addEventListener('input', () => {
      card.sort = sourceSort.value || '';
      setSourceField({ sort: sourceSort.value });
    });

    const builtInSectionOptions = (builtInName: string) => {
      const builtIns: Record<string, { value: string; label: string }[]> = {
        home: [
          { value: 'briefing', label: 'Briefing' },
          { value: 'inbox', label: 'Inbox' },
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'pipeline', label: 'Pipeline' },
          { value: 'partners', label: 'Partners' },
          { value: 'projects', label: 'Projects' },
          { value: 'activities', label: 'Recent activity' },
        ],
        planner: [
          { value: 'overview', label: 'Overview' },
          { value: 'inbox', label: 'Inbox' },
          { value: 'today', label: 'Today' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'projects', label: 'Projects' },
        ],
        productivity: [
          { value: 'per-day', label: 'Per day' },
          { value: 'weeks', label: 'Weeks' },
          { value: 'weekday', label: 'Weekday mix' },
          { value: 'task-notes', label: 'Task notes' },
        ],
      };
      return builtIns[builtInName] || [];
    };
    const inferBuiltInSection = (builtInName: string) => {
      const builtIn = String(builtInName || '').trim().toLowerCase();
      const title = String(config.title || card.title || '').trim().toLowerCase();
      const choices = builtInSectionOptions(builtIn);
      const byLabel = choices.find((choice) => String(choice.label || '').trim().toLowerCase() === title);
      if (byLabel) return byLabel.value;
      const aliases: Record<string, Record<string, string>> = {
        home: {
          'top of the day': 'briefing',
          briefing: 'briefing',
          inbox: 'inbox',
          today: 'today',
          'this week': 'week',
          week: 'week',
          upcoming: 'upcoming',
          pipeline: 'pipeline',
          partners: 'partners',
          projects: 'projects',
          'recent activity': 'activities',
          activity: 'activities',
          activities: 'activities',
        },
        planner: {
          overview: 'overview',
          inbox: 'inbox',
          today: 'today',
          calendar: 'calendar',
          projects: 'projects',
        },
        productivity: {
          'per day': 'per-day',
          'week day mix': 'weekday',
          'weekday mix': 'weekday',
          'task notes': 'task-notes',
          'tasknotes': 'task-notes',
          weeks: 'weeks',
        },
      };
      return aliases[builtIn]?.[title] || '';
    };
    const sourceSectionRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceSectionRow.createDiv({ cls: 'cad-de-form-label', text: 'Built-in section' });
    const sectionWrap = sourceSectionRow.createDiv({ cls: 'cad-de-source-section-wrap' });
    const sectionSelect = sectionWrap.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const syncBuiltInControls = () => {
      const isBuiltIn = sourceMode.value === 'built-in';
      const builtInName = String(sourceProvider.value || 'home').trim().toLowerCase() || 'home';
      const choices = builtInSectionOptions(builtInName);
      const selectedValue = String(card.section || source.section || inferBuiltInSection(builtInName) || choices[0]?.value || '').trim();
      sourceProvider.disabled = !editable || !isBuiltIn;
      sourceSectionRow.style.display = isBuiltIn ? '' : 'none';
      sectionSelect.empty();
      if (choices.length) {
        choices.forEach((choice) => {
          const opt = sectionSelect.createEl('option', { value: choice.value, text: choice.label });
          if (choice.value === selectedValue) opt.selected = true;
        });
        sectionSelect.disabled = !editable || !isBuiltIn;
        sectionSelect.style.display = '';
      } else {
        const opt = sectionSelect.createEl('option', { value: '', text: 'No sections available' });
        opt.selected = true;
        sectionSelect.disabled = true;
        sectionSelect.style.display = '';
      }
    };
    sectionSelect.addEventListener('change', () => {
      const section = sectionSelect.value || '';
      card.section = section;
      setSourceField({ section: section || null });
    });
    syncBuiltInControls();

    const sourceLabelsRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceLabelsRow.createDiv({ cls: 'cad-de-form-label', text: 'Labels' });
    const sourceLabels = sourceLabelsRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    sourceLabels.value = Array.isArray(source.labels) ? source.labels.join(', ') : '';
    sourceLabels.placeholder = 'Comma-separated labels';
    sourceLabels.addEventListener('input', () => {
      const labels = String(sourceLabels.value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      setSourceField({ labels: labels.length ? labels : null });
    });

    const baseObj = getObjectField('base');
    const baseMetadataSource = baseObj && typeof baseObj === 'object' ? baseObj : {};
    void (async () => {
      const basePath = String(
        baseMetadataSource.file ||
        baseMetadataSource.base ||
        baseMetadataSource.path ||
        baseMetadataSource.basePath ||
        source.base?.file ||
        source.base?.base ||
        source.base?.path ||
        source.base?.basePath ||
        ''
      ).trim();
      if (!basePath) return;
      const baseFile = this.app.vault.getAbstractFileByPath(basePath);
      if (!(baseFile instanceof obsidian.TFile)) return;
      const baseViewName = String(
        baseMetadataSource.view ||
        baseMetadataSource.baseView ||
        baseMetadataSource.base_view ||
        source.base?.view ||
        source.base?.baseView ||
        source.base?.base_view ||
        ''
      ).trim();
      const baseConfig = await parseBaseFile(this.app, basePath, baseViewName).catch((): null => null);
      if (!baseConfig) return;
      const baseFields = Array.isArray(baseConfig.fields) ? baseConfig.fields : [];
      const extraFields = new Set<string>();
      const addField = (field: EntityField) => {
        const key = String(field?.key || '').trim();
        if (!key) return;
        extraFields.add(key);
        const label = String(field?.label || '').trim();
        if (label && label !== key) extraFields.add(label);
      };
      baseFields.forEach(addField);
      (entityDef?.fields || []).forEach(addField);
      extraFields.forEach((field) => {
        addSuggestion(titleFieldList, field);
        addSuggestion(metaFieldList, field);
        addSuggestion(sourceGroupList, field);
        addSuggestion(sourceSortList, `${field} ASC`);
        addSuggestion(sourceSortList, `${field} DESC`);
      });
    })();

    const sourceLimitRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceLimitRow.createDiv({ cls: 'cad-de-form-label', text: 'Limit' });
    const sourceLimit = sourceLimitRow.createEl('input', { type: 'number', cls: 'cad-de-field cad-de-field-sm' });
    sourceLimit.value = source.limit != null ? String(source.limit) : (card.limit != null ? String(card.limit) : '');
    sourceLimit.placeholder = 'rows';
    sourceLimit.addEventListener('input', () => {
      const limitValue = sourceLimit.value === '' ? null : Number(sourceLimit.value);
      card.limit = limitValue;
      setObjectField('source', { limit: limitValue });
    });

    const baseSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
    baseSection.createDiv({ cls: 'cad-de-section-label', text: 'Base target' });
    const baseFileRow = baseSection.createDiv({ cls: 'cad-de-form-row' });
    baseFileRow.createDiv({ cls: 'cad-de-form-label', text: 'Base file' });
    const baseFile = baseFileRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    baseFile.value = baseObj.file || '';
    baseFile.placeholder = '00-CORE/Bases/... .base';
    baseFile.addEventListener('input', () => {
      setObjectField('base', { file: baseFile.value });
    });
    const baseViewRow = baseSection.createDiv({ cls: 'cad-de-form-row' });
    baseViewRow.createDiv({ cls: 'cad-de-form-label', text: 'Base view' });
    const baseView = baseViewRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    baseView.value = baseObj.view || '';
    baseView.placeholder = 'View name';
    baseView.addEventListener('input', () => {
      setObjectField('base', { view: baseView.value });
    });
    const baseEntityRow = baseSection.createDiv({ cls: 'cad-de-form-row' });
    baseEntityRow.createDiv({ cls: 'cad-de-form-label', text: 'Base entity' });
    const baseEntity = baseEntityRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    baseEntity.value = baseObj.entity || '';
    baseEntity.placeholder = 'entity key';
    baseEntity.addEventListener('input', () => {
      setObjectField('base', { entity: baseEntity.value });
    });

    if (String(card.kind || '').trim() === 'selector') {
      const selectorSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
      selectorSection.createDiv({ cls: 'cad-de-section-label', text: 'Selector details' });
      addRow('Key', 'key');
      addRow('Label', 'label');
      addRow('Field', 'field');
      addRow('All label', 'allLabel');
      addRow('Mode', 'mode', ['value', 'date-range']);
      addRow('Options', 'options');
    }

    if (['gauge', 'score-gauge', 'dial', 'progress', 'progress-bar'].includes(String(card.kind || '').trim().toLowerCase())) {
      const scalarSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
      scalarSection.createDiv({ cls: 'cad-de-section-label', text: String(card.kind || '').trim().toLowerCase() === 'progress' ? 'Progress details' : 'Gauge details' });
      addRow('Value', 'value');
      addRow('Field', 'field', fieldSuggestions, true);
      addRow('Metric', 'metric', ['count', 'sum', 'avg', 'min', 'max', 'filled', 'empty', 'open', 'uniqueCount', 'ratio'], true);
      addRow('Max / target', 'max');
      addRow('Suffix', 'suffix');
      addRow('Label', 'label');
      addRow('Caption', 'caption');
      addRow('Subtext', 'sub');
    }

    if (['heatmap', 'streak-heatmap'].includes(String(card.kind || '').trim().toLowerCase())) {
      const heatmapSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
      heatmapSection.createDiv({ cls: 'cad-de-section-label', text: 'Heatmap details' });
      addRow('Date field', 'dateField', ['date', 'day', 'created', 'createdAt', 'updated', 'modified', 'start', 'scheduled', 'due'], true);
      addRow('Value field', 'field', fieldSuggestions, true);
      addRow('Days', 'days');
      addRow('Columns', 'columns');
      addRow('Items', 'items');
    }

    if (String(card.kind || '').trim() === 'kanban') {
      const kanbanSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
      kanbanSection.createDiv({ cls: 'cad-de-section-label', text: 'Kanban details' });
      addRow('Group by', 'groupBy');
      addRow('Columns', 'columns');
      addRow('Groups', 'groups');
      addRow('Value field', 'valueField');
      addRow('Title fields', 'titleFields');
      addRow('Meta fields', 'metaFields');
      addRow('Sort', 'sort');
    }
  }

  /* ── Generic entity LIST view ───────────── */
  async renderEntityList(root: HTMLElement, entityKey: string, opts: EntityListOptions = {}) {
    root.addClass('cadence-list');
    const def = ENTITIES[entityKey];
    if (!def) { this.renderComingSoon(root, SURFACE_BY_ID[this.mode]); return; }

    const entities = listEntities(this.app, entityKey);
    const filtered = opts.filter ? entities.filter(opts.filter) : entities;
    const unsupported = def.unsupportedBaseFilters || [];
    const unsupportedText = unsupported.length
      ? ` · ${unsupported.length} Base filter${unsupported.length === 1 ? '' : 's'} not applied`
      : '';

    const title = `${opts.title || def.plural}${opts.titleSuffix || ''}`;
    this._renderPageHeader(root, title, `${filtered.length} ${filtered.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} in ${entityFolder(entityKey)}${unsupportedText}`, (right, ctx) => {
      if (opts.renderHeaderControls) opts.renderHeaderControls(right, entityKey);
      this._renderEntityViewSelect(right, entityKey);
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase(entityKey));
      }
      if (entityLifecycle(def)) {
        const procBtn = right.createEl('button', { cls: 'cad-btn', text: 'Process canvas' });
        procBtn.addEventListener('click', () => void this._generateProcessCanvas(entityKey));
      }
      if (!ctx.hasConfiguredActions) {
        const btn = right.createEl('button', { cls: 'cad-btn primary', text: `+ New ${def.label}` });
        btn.addEventListener('click', () => this._createEntityFromPrompt(entityKey));
      }
    });

    if (!opts.forceInternal && this._renderExternalBaseView(root, entityKey)) return;
    this._renderUnsupportedBaseFilters(root, def);

    if (!filtered.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: `No ${def.plural.toLowerCase()} yet` });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: opts.emptyDescription || `Drop a markdown note in ${entityFolder(entityKey)}/ with frontmatter, or hit "+ New" above.` });
      return;
    }

    const cols = opts.columns
      ? opts.columns.map((k) => def.fields.find((f) => f.key === k)).filter(Boolean)
      : def.fields;
    const groups = this._groupEntitiesForView(filtered, def);
    if (groups) {
      groups.forEach(([label, items]) => {
        root.createDiv({ cls: 'cad-section-label-lg', text: `${label} · ${items.length}` });
        this._renderEntityTable(root, items, entityKey, cols);
      });
    } else {
      this._renderEntityTable(root, filtered, entityKey, cols);
    }
  }

  /* ── Entity DETAIL view (in-app form, autosaves to frontmatter) ── */
  async renderEntityDetail(root: HTMLElement, entityKey: string, file: obsidian.TFile) {
    // Projects get a richer PM-style detail view
    if (entityKey === 'project') return this.renderProjectDetail(root, file);

    root.addClass('cadence-detail');
    const def = ENTITIES[entityKey];
    if (!def || !file) { this.closeEntityDetail(); return; }

    // Read current entity
    const cache = this.app.metadataCache.getFileCache(file) || {} as obsidian.CachedMetadata;
    const fm = Object.assign({}, cache.frontmatter || {});
    const primaryKey = primaryFieldKey(def);
    const titleVal = primaryKey ? entityValue({ file, frontmatter: fm, basename: file.basename }, primaryKey, def) : file.basename;

    // Header: back / breadcrumb / title / actions
    const head = root.createDiv({ cls: 'cad-detail-header' });
    const headLeft = head.createDiv({ cls: 'cad-detail-header-left' });

    const back = headLeft.createEl('button', { cls: 'cad-btn cad-detail-back', text: '← ' + def.plural });
    back.addEventListener('click', () => this.closeEntityDetail());

    const breadcrumb = headLeft.createDiv({ cls: 'cad-detail-breadcrumb' });
    breadcrumb.createSpan({ cls: 'cad-eyebrow', text: def.plural.toUpperCase() });
    breadcrumb.createSpan({ cls: 'cad-detail-title', text: String(titleVal) });
    breadcrumb.createDiv({ cls: 'cad-detail-path', text: file.path });

    const headRight = head.createDiv({ cls: 'cad-detail-header-right' });
    const savedBadge: SavedBadgeEl = headRight.createSpan({ cls: 'cad-detail-saved', text: '' });
    const openNote = headRight.createEl('button', { cls: 'cad-btn', text: 'Open as note' });
    openNote.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
    const ctxCanvas = headRight.createEl('button', { cls: 'cad-btn', text: 'Context canvas' });
    ctxCanvas.addEventListener('click', () => void this._generateContextCanvas(file));
    const deleteBtn = headRight.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
    deleteBtn.addEventListener('click', async () => {
      if (!(await confirmModal(this.app, `Delete this ${def.label.toLowerCase()}? This moves the file to trash.`, { title: 'Delete', cta: 'Delete' }))) return;
      try {
        await this.app.vault.trash(file, true);
        new obsidian.Notice(`Deleted ${def.label}: ${file.basename}`);
        this.closeEntityDetail();
      } catch (e) {
        new obsidian.Notice(`Delete failed: ${e.message}`);
      }
    });

    // Form
    const form = root.createDiv({ cls: 'cad-detail-form' });
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const flashSaved = () => {
      savedBadge.setText('Saved');
      savedBadge.addClass('show');
      clearTimeout(savedBadge._t);
      savedBadge._t = setTimeout(() => savedBadge.removeClass('show'), 1400);
    };
    const writeField = async (key: string, raw: string) => {
      try {
        let value: string | string[] | number | null = raw;
        // Coerce based on field type
        const fdef = def.fields.find((f) => f.key === key);
        if (fdef) {
          if (fdef.type === 'tags') {
            value = (raw || '').split(',').map((t) => t.trim()).filter(Boolean);
          } else if (fdef.type === 'number' || fdef.type === 'currency') {
            const n = Number(raw);
            value = isNaN(n) ? null : n;
          } else if (raw === '') {
            value = null;
          }
        }
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (value == null || (Array.isArray(value) && value.length === 0)) {
            delete frontmatter[key];
          } else {
            frontmatter[key] = value;
          }
        });
        flashSaved();
      } catch (e) {
        new obsidian.Notice(`Save failed: ${e.message}`);
      }
    };
    const debouncedWrite = (key: string, val: string) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => writeField(key, val), 350);
    };

    // Render each field as a labelled row
    def.fields.forEach((f) => {
      const row = form.createDiv({ cls: 'cad-form-row' });
      row.createDiv({ cls: 'cad-form-label', text: f.label.toUpperCase() });

      const current = fm[f.key];
      const fieldType = f.type || 'text';

      if (fieldType === 'enum') {
        const sel = row.createEl('select', { cls: 'cad-form-input' });
        // Allow empty
        sel.createEl('option', { value: '', text: '—' });
        (f.options || []).forEach((opt) => {
          const o = sel.createEl('option', { value: opt, text: opt });
          if (String(current || '') === opt) o.selected = true;
        });
        sel.addEventListener('change', () => writeField(f.key, sel.value));
      } else if (fieldType === 'date') {
        const inp = row.createEl('input', { type: 'date', cls: 'cad-form-input' });
        inp.lang = navigator.language || '';
        if (current) {
          const d = new Date(current);
          if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
        }
        inp.addEventListener('change', () => writeField(f.key, inp.value));
      } else if (fieldType === 'number' || fieldType === 'currency') {
        const inp = row.createEl('input', { type: 'number', cls: 'cad-form-input' });
        if (current != null) inp.value = String(current);
        if (fieldType === 'currency') inp.placeholder = `${this.plugin.settings.currency || 'USD'} amount`;
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else if (fieldType === 'email') {
        const inp = row.createEl('input', { type: 'email', cls: 'cad-form-input' });
        if (current) inp.value = String(current);
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else if (fieldType === 'tags') {
        const inp = row.createEl('input', { type: 'text', cls: 'cad-form-input', placeholder: 'tag1, tag2, tag3' });
        if (Array.isArray(current)) inp.value = current.join(', ');
        else if (current) inp.value = String(current);
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else {
        const inp = row.createEl('input', { type: 'text', cls: 'cad-form-input' });
        if (current) inp.value = String(current);
        if (def.typeFilter === 'project') {
          if (f.key === 'project_id') inp.placeholder = 'Project ID';
          if (f.key === 'project_name') inp.placeholder = 'Project Name';
        } else if (f.key === primaryKey) {
          inp.placeholder = `${def.label} name`;
        }
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      }
    });

    // Body section — link out for full editing
    const bodyHint = root.createDiv({ cls: 'cad-detail-body-hint' });
    bodyHint.createDiv({ cls: 'cad-eyebrow', text: 'NOTE BODY' });
    bodyHint.createDiv({ cls: 'cad-detail-body-desc', text: 'Brief, milestones, notes and any other markdown lives in the note body.' });
    const openBody = bodyHint.createEl('button', { cls: 'cad-btn primary', text: 'Open as note for full editing' });
    openBody.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
  }

  /* ── Project DETAIL view (real PM surface) ─────── */
  async renderProjectDetail(root: HTMLElement, file: obsidian.TFile) {
    root.addClass('cadence-project-detail');
    const def = ENTITIES.project;
    const cache = this.app.metadataCache.getFileCache(file) || {} as obsidian.CachedMetadata;
    const fm = Object.assign({}, cache.frontmatter || {});
    const meta = await readProjectMeta(this.app, file);
    const primaryKey = def.fields?.find((f) => f.primary)?.key || 'name';
    const titleVal = projectNameFromPath(this.app, file.path) || fm.project_name || fm.name || fm.project || fm[primaryKey] || file.basename;

    const status = String(fm.status || 'active');
    const priority = String(fm.priority || '');

    /* Header */
    const head = root.createDiv({ cls: 'cad-detail-header' });
    const headLeft = head.createDiv({ cls: 'cad-detail-header-left' });
    const back = headLeft.createEl('button', { cls: 'cad-btn cad-detail-back', text: '← Projects' });
    back.addEventListener('click', () => this.closeEntityDetail());
    const breadcrumb = headLeft.createDiv({ cls: 'cad-detail-breadcrumb' });
    breadcrumb.createSpan({ cls: 'cad-eyebrow', text: 'PROJECT' });
    breadcrumb.createSpan({ cls: 'cad-detail-title', text: String(titleVal) });
    breadcrumb.createDiv({ cls: 'cad-detail-path', text: file.path });

    const headRight = head.createDiv({ cls: 'cad-detail-header-right' });
    const savedBadge: SavedBadgeEl = headRight.createSpan({ cls: 'cad-detail-saved', text: '' });
    const flashSaved = () => {
      savedBadge.setText('Saved');
      savedBadge.addClass('show');
      clearTimeout(savedBadge._t);
      savedBadge._t = setTimeout(() => savedBadge.removeClass('show'), 1400);
    };
    const openNote = headRight.createEl('button', { cls: 'cad-btn', text: 'Open as note' });
    openNote.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
    const deleteBtn = headRight.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
    deleteBtn.addEventListener('click', async () => {
      if (!(await confirmModal(this.app, `Delete this project? This moves the file to trash.`, { title: 'Delete project', cta: 'Delete' }))) return;
      try {
        await this.app.vault.trash(file, true);
        new obsidian.Notice(`Deleted project: ${file.basename}`);
        this.closeEntityDetail();
      } catch (e) {
        new obsidian.Notice(`Delete failed: ${e.message}`);
      }
    });

    /* Hero — name (already in breadcrumb), pills, meta, progress */
    const hero = root.createDiv({ cls: 'cad-pd-hero' });
    const pillRow = hero.createDiv({ cls: 'cad-pd-pills' });
    const mkSelect = (cls: string, options: string[], current: string, onChange: (value: string) => void) => {
      const wrap = pillRow.createDiv({ cls: `cad-pd-select-wrap ${cls}` });
      const sel = wrap.createEl('select', { cls: 'cad-pd-select' });
      options.forEach((opt) => {
        const o = sel.createEl('option', { value: opt, text: opt });
        if (String(current) === opt) o.selected = true;
      });
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    };
    const statusOptions   = def.fields?.find((f) => f.key === 'status')?.options   || ['active', 'on_hold', 'backlog', 'done', 'cancelled'];
    const priorityOptions = def.fields?.find((f) => f.key === 'priority')?.options || ['low', 'medium', 'high'];
    mkSelect('cad-pill cad-pill-' + status.toLowerCase().replace(/\s+/g, '-'),
      statusOptions, status,
      (v) => this._writeProjectFrontmatter(file, { status: v }, flashSaved));
    mkSelect('cad-pill cad-pill-prio-' + (priority || priorityOptions[1] || 'medium').toLowerCase(),
      priorityOptions, priority || priorityOptions[1] || 'medium',
      (v) => this._writeProjectFrontmatter(file, { priority: v }, flashSaved));

    const metaRow = hero.createDiv({ cls: 'cad-pd-meta' });
    const mkMeta = (label: string, key: string, type?: string) => {
      const cell = metaRow.createDiv({ cls: 'cad-pd-meta-cell' });
      cell.createDiv({ cls: 'cad-pd-meta-label', text: label });
      const inp = cell.createEl('input', { type: type || 'text', cls: 'cad-pd-meta-input' });
      const cur = fm[key];
      if (type === 'date' && cur) {
        const d = new Date(cur);
        if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
      } else if (cur != null) {
        inp.value = String(cur);
      }
      let t: ReturnType<typeof setTimeout> | undefined;
      const commit = () => this._writeProjectFrontmatter(file, { [key]: inp.value || null }, flashSaved);
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(commit, 350); });
      inp.addEventListener('blur', commit);
    };
    const defaultMetaFields = [
      { key: 'owner',   label: 'OWNER' },
      { key: 'started', label: 'STARTED', type: 'date' },
      { key: 'due',     label: 'DUE',     type: 'date' },
    ];
    ((def.detailMetaFields || defaultMetaFields) as { key: string; label: string; type?: string }[]).forEach((mf) => mkMeta(mf.label, mf.key, mf.type));

    const progWrap = hero.createDiv({ cls: 'cad-proj-progress-wrap cad-pd-progress' });
    progWrap.dataset.pctBand = pctBand(meta.percent);
    const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
    progLabel.createSpan({ text: `${meta.done}/${meta.total} milestones complete` });
    progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${meta.percent}%` });
    const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
    fill.style.width = `${meta.percent}%`;

    /* Two-column body */
    const cols = root.createDiv({ cls: 'cad-pd-cols' });
    const left = cols.createDiv({ cls: 'cad-pd-col' });
    const right = cols.createDiv({ cls: 'cad-pd-col' });

    /* ── Milestones ── */
    this._renderMilestoneSection(left, file, meta.milestones, flashSaved);

    /* ── Tasks ── */
    const taskList = parseTasksList(meta.sections['Tasks'] || '');
    this._renderTaskSection(left, file, taskList, flashSaved);

    /* ── Body sections (right column) ── */
    const defaultBodySections = [
      { key: 'Brief',        label: 'BRIEF',        rows: 4, placeholder: 'The outcome we want, why now.' },
      { key: 'Scope',        label: 'SCOPE',        rows: 5, placeholder: 'In scope / out of scope.' },
      { key: 'Risks',        label: 'RISKS',        rows: 4, placeholder: 'What could go wrong.' },
      { key: 'Stakeholders', label: 'STAKEHOLDERS', rows: 3, placeholder: 'Who cares about this project.' },
      { key: 'Notes',        label: 'NOTES',        rows: 5, placeholder: 'Anything else.' },
    ];
    const bodySections = (def.detailSections || defaultBodySections) as ProjectTextSectionDef[];
    bodySections.forEach((s) => this._renderProjectTextSection(right, file, meta.sections, s, flashSaved));
  }

  _renderMilestoneSection(parent: HTMLElement, file: obsidian.TFile, milestones: MilestoneItem[], flashSaved: () => void) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    const head = card.createDiv({ cls: 'cad-pd-card-head' });
    head.createDiv({ cls: 'cad-pd-card-title', text: `MILESTONES · ${milestones.filter((m) => m.done).length}/${milestones.length}` });
    const addBtn = head.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add' });

    const list = card.createDiv({ cls: 'cad-pd-checklist' });
    const renderRows = (items: MilestoneItem[]) => {
      list.empty();
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: 'No milestones yet — add the first one.' });
        return;
      }
      items.forEach((m, idx) => {
        const wrapper = list.createDiv({ cls: 'cad-mile-wrapper' });
        const row = wrapper.createDiv({ cls: 'cad-pd-mile-row' + (m.done ? ' done' : '') });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = !!m.done;
        cb.addEventListener('change', async () => {
          items[idx].done = cb.checked;
          await this._commitMilestones(file, items, flashSaved);
        });
        const dateInp = row.createEl('input', { type: 'date', cls: 'cad-pd-mile-date' });
        dateInp.lang = navigator.language || '';
        if (m.date instanceof Date && !isNaN(m.date.getTime())) {
          dateInp.value = m.date.toISOString().slice(0, 10);
        }
        let dt: ReturnType<typeof setTimeout> | undefined;
        dateInp.addEventListener('input', () => {
          clearTimeout(dt);
          dt = setTimeout(async () => {
            items[idx].date = dateInp.value ? new Date(dateInp.value) : null;
            await this._commitMilestones(file, items, flashSaved, true);
          }, 350);
        });
        const titleInp = row.createEl('input', { type: 'text', cls: 'cad-pd-mile-title' });
        titleInp.value = m.title || '';
        titleInp.placeholder = 'Milestone title';
        let tt: ReturnType<typeof setTimeout> | undefined;
        titleInp.addEventListener('input', () => {
          clearTimeout(tt);
          tt = setTimeout(async () => {
            items[idx].title = titleInp.value;
            await this._commitMilestones(file, items, flashSaved, true);
          }, 400);
        });
        const del = row.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.title = 'Delete milestone';
        del.addEventListener('click', async () => {
          items.splice(idx, 1);
          await this._commitMilestones(file, items, flashSaved);
        });

        // Notes section — preview ⇄ textarea, indented under the milestone in markdown
        const notesEl = wrapper.createDiv({ cls: 'cad-mile-notes-section' });
        const renderNotesIdle = () => {
          notesEl.empty();
          const hasNotes = (items[idx].notes || '').trim().length > 0;
          if (hasNotes) {
            const preview = notesEl.createDiv({ cls: 'cad-mile-notes-preview' });
            preview.setText(items[idx].notes);
            preview.title = 'Click to edit notes';
            preview.addEventListener('click', openNotesEditor);
          } else {
            const addBtn = notesEl.createEl('a', { cls: 'cad-mile-notes-add', text: '+ Add notes' });
            addBtn.addEventListener('click', (e) => { e.preventDefault(); openNotesEditor(); });
          }
        };
        const openNotesEditor = () => {
          notesEl.empty();
          const ta = notesEl.createEl('textarea', { cls: 'cad-mile-notes-textarea' });
          ta.value = items[idx].notes || '';
          ta.placeholder = 'Notes — context, follow-ups, what happened…';
          const autosize = () => {
            ta.style.height = 'auto';
            ta.style.height = Math.max(60, ta.scrollHeight + 2) + 'px';
          };
          let nt: ReturnType<typeof setTimeout> | undefined;
          ta.addEventListener('input', () => {
            autosize();
            clearTimeout(nt);
            nt = setTimeout(async () => {
              items[idx].notes = ta.value;
              await this._commitMilestones(file, items, flashSaved, true);
            }, 400);
          });
          ta.addEventListener('blur', async () => {
            items[idx].notes = ta.value;
            await this._commitMilestones(file, items, flashSaved, true);
            renderNotesIdle();
          });
          setTimeout(() => { ta.focus(); autosize(); }, 0);
        };
        renderNotesIdle();
      });
    };

    renderRows(milestones);

    addBtn.addEventListener('click', async () => {
      const today = new Date();
      milestones.push({ done: false, date: today, title: '' });
      await this._commitMilestones(file, milestones, flashSaved);
    });
  }

  async _commitMilestones(file: obsidian.TFile, items: MilestoneItem[], flashSaved: () => void, skipRender = false) {
    const body = stringifyMilestones(items as Parameters<typeof stringifyMilestones>[0]);
    const content = await this.app.vault.read(file);
    const next = replaceSection(content, '## Milestones', body || '');
    await this.app.vault.modify(file, next);
    if (typeof flashSaved === 'function') flashSaved();
    // Re-render only when needed (checkbox toggle, add, delete) — text/date
    // edits skip render so the user's input keeps focus.
    if (!skipRender) this.render();
  }

  _renderTaskSection(parent: HTMLElement, file: obsidian.TFile, tasks: ProjectTaskItem[], flashSaved: () => void) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    const head = card.createDiv({ cls: 'cad-pd-card-head' });
    const open = tasks.filter((t) => !t.done).length;
    head.createDiv({ cls: 'cad-pd-card-title', text: `TASKS · ${open} open · ${tasks.length - open} done` });
    const addBtn = head.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add' });

    const list = card.createDiv({ cls: 'cad-pd-checklist' });
    const renderRows = (items: ProjectTaskItem[]) => {
      list.empty();
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: 'No tasks yet.' });
        return;
      }
      items.forEach((t, idx) => {
        const row = list.createDiv({ cls: 'cad-pd-task-row' + (t.done ? ' done' : '') });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = !!t.done;
        cb.addEventListener('change', async () => {
          items[idx].done = cb.checked;
          await this._commitTasks(file, items, flashSaved);
          const txt = (items[idx].title || '').trim();
          if (txt) await this._propagateTaskComplete(txt, cb.checked, { kind: 'project', file });
        });
        const titleInp = row.createEl('input', { type: 'text', cls: 'cad-pd-task-title' });
        titleInp.value = t.title || '';
        titleInp.placeholder = 'Task description';
        let tt: ReturnType<typeof setTimeout> | undefined;
        titleInp.addEventListener('input', () => {
          clearTimeout(tt);
          tt = setTimeout(async () => {
            items[idx].title = titleInp.value;
            await this._commitTasks(file, items, flashSaved, true);
          }, 400);
        });

        /* Bell — set or edit a reminder linked to this task. */
        const linked = findProjectTaskReminder(this.plugin, file.path, t.title || '');
        const bell = row.createEl('button', {
          cls: 'cad-btn cad-btn-sm cad-pd-task-bell' + (linked ? ' linked' : ''),
          text: linked ? '🔔' : '🔕',
        });
        bell.title = linked
          ? `Edit reminder${linked.when ? ' · ' + reminderTimeStr(linked.when) : ''}`
          : 'Set a reminder for this task';
        bell.addEventListener('click', async () => {
          // Always commit any pending title edit first so the link key is fresh
          items[idx].title = titleInp.value;
          await this._commitTasks(file, items, flashSaved, true);

          const taskText = titleInp.value.trim();
          if (!taskText) {
            new obsidian.Notice('Add a task title first.');
            titleInp.focus();
            return;
          }
          const existing = findProjectTaskReminder(this.plugin, file.path, taskText);
          if (existing) {
            new CadenceReminderEditModal(this.app, this.plugin, existing).open();
          } else {
            new CadenceReminderEditModal(this.app, this.plugin, {
              text: taskText,
              when: null,
              repeat: 'none',
              notes: '',
              project: file.path,
            }, { isNew: true }).open();
          }
        });

        const del = row.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.addEventListener('click', async () => {
          items.splice(idx, 1);
          await this._commitTasks(file, items, flashSaved);
        });
      });
    };

    renderRows(tasks);

    addBtn.addEventListener('click', async () => {
      tasks.push({ done: false, title: '' });
      await this._commitTasks(file, tasks, flashSaved);
    });
  }

  async _commitTasks(file: obsidian.TFile, items: ProjectTaskItem[], flashSaved: () => void, skipRender = false) {
    const body = stringifyTasks(items);
    const content = await this.app.vault.read(file);
    const next = replaceSection(content, '## Tasks', body || '');
    await this.app.vault.modify(file, next);
    if (typeof flashSaved === 'function') flashSaved();
    if (!skipRender) this.render();
  }

  _renderProjectTextSection(parent: HTMLElement, file: obsidian.TFile, sections: Record<string, string>, def: ProjectTextSectionDef, flashSaved: () => void) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    card.createDiv({ cls: 'cad-pd-card-head' }).createDiv({ cls: 'cad-pd-card-title', text: def.label });
    const ta = card.createEl('textarea', { cls: 'cad-pd-textarea' });
    ta.placeholder = def.placeholder || '';
    ta.rows = def.rows || 4;
    const initial = (sections[def.key] || '').replace(/^\s+|\s+$/g, '');
    ta.value = initial;
    let tmr: ReturnType<typeof setTimeout> | undefined;
    ta.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(async () => {
        const content = await this.app.vault.read(file);
        const next = replaceSection(content, `## ${def.key}`, ta.value || '');
        await this.app.vault.modify(file, next);
        flashSaved();
      }, 500);
    });
  }

  async _writeProjectFrontmatter(file: obsidian.TFile, patch: Frontmatter, flashSaved: () => void) {
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        Object.entries(patch).forEach(([k, v]) => {
          if (v == null || v === '') delete fm[k];
          else fm[k] = v;
        });
      });
      if (typeof flashSaved === 'function') flashSaved();
    } catch (e) {
      new obsidian.Notice(`Save failed: ${e.message}`);
    }
  }

  /* ── Projects: rich card grid with milestone progress ─ */
  async renderProjectsView(root: HTMLElement) {
    root.addClass('cadence-projects');
    const def = ENTITIES.project;
    const files = listEntityFiles(this.app, 'project');

    const projectFolderLabel = ENTITIES.project.folders ? ENTITIES.project.folders.join(', ') : entityFolder('project');
    const unsupported = def.unsupportedBaseFilters || [];
    const unsupportedText = unsupported.length
      ? ` · ${unsupported.length} Base filter${unsupported.length === 1 ? '' : 's'} not applied`
      : '';
    this._renderPageHeader(root, 'Projects', `${files.length} ${files.length === 1 ? 'project' : 'projects'} in ${projectFolderLabel}${unsupportedText}`, (right, ctx) => {
      this._renderEntityViewSelect(right, 'project');
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase('project'));
      }
      if (!ctx.hasConfiguredActions) {
        const btn = right.createEl('button', { cls: 'cad-btn primary', text: '+ New Project' });
        btn.addEventListener('click', () => this._createEntityFromPrompt('project'));
      }
    });

    if (this._renderExternalBaseView(root, 'project')) return;
    this._renderUnsupportedBaseFilters(root, def);

    if (!files.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: 'No projects yet' });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: 'Hit "+ New Project" — you\'ll get a templated note with Brief, Scope, Milestones, Tasks, Risks and Stakeholders sections ready to fill in.' });
      return;
    }

    const projects = await Promise.all(files.map(async (f) => {
      const e = readEntity(this.app, f);
      const meta = await readProjectMeta(this.app, f);
      return { entity: e, meta };
    }));

    // Group by status — keys derived from entity definition
    const statusOpts = def.fields?.find((f) => f.key === 'status')?.options || ['active', 'on_hold', 'backlog', 'done', 'cancelled'];
    const groups = Object.fromEntries(statusOpts.map((s): [string, typeof projects] => [s, []]));
    const fallbackStatus = statusOpts[0] || 'active';
    projects.forEach((p) => {
      const status = String(entityValue(p.entity, 'status', def) || fallbackStatus).toLowerCase().replace(/[-\s]+/g, '_');
      const key = groups[status] !== undefined ? status : fallbackStatus;
      groups[key].push(p);
    });

    const grid = root.createDiv({ cls: 'cad-proj-grid' });
    const renderCard = (p: typeof projects[number]) => {
      const card = grid.createDiv({ cls: 'cad-proj-card' });
      const head = card.createDiv({ cls: 'cad-proj-card-head' });
      const title = head.createEl('a', { cls: 'cad-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
      title.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.openEntityDetailFromFile(p.entity.file); });
      card.classList.add('clickable');
      card.addEventListener('click', () => this.openEntityDetailFromFile(p.entity.file));
      const status = String(entityValue(p.entity, 'status', def) || 'active');
      const priority = String(entityValue(p.entity, 'priority', def) || '');
      const pillRow = head.createDiv({ cls: 'cad-proj-pills' });
      pillRow.createSpan({ cls: `cad-pill cad-pill-${status.toLowerCase().replace(/\s+/g, '-')}`, text: status });
      if (priority) pillRow.createSpan({ cls: `cad-pill cad-pill-prio-${priority.toLowerCase()}`, text: priority });

      const metaRow = card.createDiv({ cls: 'cad-proj-meta' });
      const owner = entityValue(p.entity, 'owner', def);
      const due = entityValue(p.entity, 'due', def);
      if (owner) metaRow.createSpan({ text: `Owner: ${owner}` });
      if (due) metaRow.createSpan({ text: `Due: ${fmtValue(due, 'date')}` });

      // Progress
      const progWrap = card.createDiv({ cls: 'cad-proj-progress-wrap' });
      progWrap.dataset.pctBand = pctBand(p.meta.percent);
      const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
      progLabel.createSpan({ text: `${p.meta.done}/${p.meta.total} milestones` });
      progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${p.meta.percent}%` });
      const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
      const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
      fill.style.width = `${p.meta.percent}%`;

      // Next milestone
      if (p.meta.next) {
        const nextRow = card.createDiv({ cls: 'cad-proj-next' });
        nextRow.createSpan({ cls: 'cad-proj-next-label', text: 'NEXT · ' });
        nextRow.createSpan({ cls: 'cad-proj-next-date', text: fmtValue(p.meta.next.date, 'date') });
        if (p.meta.next.title) nextRow.createSpan({ text: ` — ${p.meta.next.title}` });
      }
    };

    const renderSection = (label: string, list: typeof projects) => {
      if (!list.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: label });
      list.forEach(renderCard);
    };

    // We render section labels by intercepting renderCard placement
    // Reset grid: render in groups
    grid.remove();
    const order = ['active', 'on_hold', 'backlog', 'done', 'cancelled'];
    const sectionLabels: Record<string, string> = { active: 'ACTIVE', on_hold: 'ON HOLD', backlog: 'BACKLOG', done: 'DONE', cancelled: 'CANCELLED' };
    order.forEach((key) => {
      const list = groups[key];
      if (!list.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: sectionLabels[key] });
      const section = root.createDiv({ cls: 'cad-proj-grid' });
      list.forEach((p) => {
        const card = section.createDiv({ cls: 'cad-proj-card' });
        const head = card.createDiv({ cls: 'cad-proj-card-head' });
        const title = head.createEl('a', { cls: 'cad-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
        title.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.openEntityDetailFromFile(p.entity.file); });
        card.classList.add('clickable');
        card.addEventListener('click', () => this.openEntityDetailFromFile(p.entity.file));
        const status = String(entityValue(p.entity, 'status', def) || 'active');
        const priority = String(entityValue(p.entity, 'priority', def) || '');
        const pillRow = head.createDiv({ cls: 'cad-proj-pills' });
        pillRow.createSpan({ cls: `cad-pill cad-pill-${status.toLowerCase().replace(/\s+/g, '-')}`, text: status });
        if (priority) pillRow.createSpan({ cls: `cad-pill cad-pill-prio-${priority.toLowerCase()}`, text: priority });

        const metaRow = card.createDiv({ cls: 'cad-proj-meta' });
        const owner = entityValue(p.entity, 'owner', def);
        const due = entityValue(p.entity, 'due', def);
        if (owner) metaRow.createSpan({ text: `Owner: ${owner}` });
        if (due) metaRow.createSpan({ text: `Due: ${fmtValue(due, 'date')}` });

        const progWrap = card.createDiv({ cls: 'cad-proj-progress-wrap' });
        const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
        progLabel.createSpan({ text: `${p.meta.done}/${p.meta.total} milestones` });
        progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${p.meta.percent}%` });
        const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
        const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
        fill.style.width = `${p.meta.percent}%`;

        if (p.meta.next) {
          const nextRow = card.createDiv({ cls: 'cad-proj-next' });
          nextRow.createSpan({ cls: 'cad-proj-next-label', text: 'NEXT · ' });
          nextRow.createSpan({ cls: 'cad-proj-next-date', text: fmtValue(p.meta.next.date, 'date') });
          if (p.meta.next.title) nextRow.createSpan({ text: ` — ${p.meta.next.title}` });
        }
      });
    });
  }

  /* ── Home / Command Centre ───────────────── */
  async renderHome(root: HTMLElement) {
    root.addClass('cadence-home');
    const today = new Date();
    const dateStr = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    this._renderPageHeader(root, `${greeting()}.`, dateStr);
    await this.renderConfigDashboard('home', root, { skipHeader: true });
  }

  /* ── Inbox (Planner reminders + captures) ── */
  async renderInbox(root: HTMLElement) {
    root.addClass('cadence-inbox');
    const all = (this.plugin.settings.reminders || []).filter((r) => !r.done);

    // Sort: scheduled by when, captures by createdAt
    all.sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      if (wa !== wb) return wa - wb;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return cb - ca;
    });

    // Bucket
    const buckets: Record<string, Reminder[]> = { now: [], today: [], week: [], later: [] };
    all.forEach((r) => buckets[reminderBucket(r.when)].push(r));

    this._renderPageHeader(root, 'Inbox', `${all.length} ${all.length === 1 ? 'item' : 'items'} · capture once, surface at the right time`, (right, ctx) => {
      if (!ctx.hasConfiguredActions) {
        const captureBtn = right.createEl('button', { cls: 'cad-btn primary', text: '+ Quick capture' });
        captureBtn.addEventListener('click', () => this.plugin.openQuickCapture());
      }
    });

    if (!all.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: 'Inbox zero' });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: 'Capture anything with + Quick capture above (or Cmd+Shift+I). Add a time and BOB Workspace will remind you.' });
      return;
    }

    const sectionLabels: Record<string, string> = { now: 'NOW · OVERDUE OR DUE WITHIN 1 HOUR', today: 'TODAY', week: 'THIS WEEK', later: 'LATER · UNSCHEDULED' };
    ['now', 'today', 'week', 'later'].forEach((key) => {
      const items = buckets[key];
      if (!items.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: `${sectionLabels[key]} · ${items.length}` });
      const list = root.createDiv({ cls: 'cad-inbox-list' });
      items.forEach((r) => this._renderInboxRow(list, r, key));
    });

    /* ── PROJECT TASKS — every open `- [ ]` from every project's ## Tasks ── */
    await this._renderProjectTasksSection(root);
  }

  async _renderProjectTasksSection(root: HTMLElement) {
    const projectFiles = listEntityFiles(this.app, 'project');
    if (!projectFiles.length) return;

    /* Read each project's Tasks section + collect open tasks */
    const groups: { file: obsidian.TFile; name: string | null; tasks: ProjectTaskItem[] }[] = [];
    let totalOpen = 0;
    for (const file of projectFiles) {
      let content;
      try { content = await this.app.vault.read(file); }
      catch (_) { continue; }
      const sections = parseH2Sections(content);
      const tasksText = sections['Tasks'] || '';
      if (!tasksText.trim()) continue;
      const tasks = parseTasksList(tasksText);
      const open = tasks.filter((t) => !t.done && t.title);
      if (!open.length) continue;
      totalOpen += open.length;
      groups.push({
        file,
        name: projectNameFromPath(this.app, file.path),
        tasks: open,
      });
    }

    if (!totalOpen) return;

    root.createDiv({ cls: 'cad-section-label-lg', text: `PROJECT TASKS · ${totalOpen} open across ${groups.length} ${groups.length === 1 ? 'project' : 'projects'}` });
    const wrap = root.createDiv({ cls: 'cad-pt-wrap' });

    groups.forEach((g) => {
      const card = wrap.createDiv({ cls: 'cad-pt-group' });
      const head = card.createDiv({ cls: 'cad-pt-group-head' });
      const link = head.createEl('a', { cls: 'cad-pt-group-link', text: '📁 ' + g.name });
      link.addEventListener('click', (e) => { e.preventDefault(); this.openEntityDetailFromFile(g.file); });
      head.createSpan({ cls: 'cad-pt-group-meta', text: `${g.tasks.length} open` });

      const list = card.createDiv({ cls: 'cad-pt-list' });
      g.tasks.forEach((t) => {
        const linked = findProjectTaskReminder(this.plugin, g.file.path, t.title);
        const row = list.createDiv({ cls: 'cad-pt-row' });
        row.createSpan({ cls: 'cad-pt-bullet', text: '•' });
        const txt = row.createSpan({ cls: 'cad-pt-text', text: t.title });
        void txt;
        if (linked && linked.when) {
          row.createSpan({ cls: 'cad-pt-when', text: reminderTimeStr(linked.when) });
        }
        const bell = row.createEl('button', {
          cls: 'cad-btn cad-btn-sm cad-pt-bell' + (linked ? ' linked' : ''),
          text: linked ? '🔔' : '🔕',
        });
        bell.title = linked ? 'Edit reminder' : 'Set a reminder';
        bell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const existing = findProjectTaskReminder(this.plugin, g.file.path, t.title);
          if (existing) {
            new CadenceReminderEditModal(this.app, this.plugin, existing).open();
          } else {
            new CadenceReminderEditModal(this.app, this.plugin, {
              text: t.title,
              when: null,
              repeat: 'none',
              notes: '',
              project: g.file.path,
            }, { isNew: true }).open();
          }
        });
        row.addEventListener('click', () => this.openEntityDetailFromFile(g.file));
      });
    });
  }

  _renderInboxRow(parent: HTMLElement, r: ReminderLike, bucket: string) {
    const row = parent.createDiv({ cls: 'cad-inbox-row' + (bucket === 'now' ? ' overdue' : '') });

    const left = row.createDiv({ cls: 'cad-inbox-row-left' });
    const tWrap = left.createDiv({ cls: 'cad-inbox-time' });
    if (r.when) {
      tWrap.createSpan({ cls: 'cad-inbox-time-text', text: reminderTimeStr(r.when) });
      if (r.repeat && r.repeat !== 'none') {
        tWrap.createSpan({ cls: 'cad-inbox-repeat', text: r.repeat === 'daily' ? '↻ daily' : '↻ weekly' });
      }
    } else {
      tWrap.createSpan({ cls: 'cad-inbox-time-text muted', text: 'unscheduled' });
    }

    const main = row.createDiv({ cls: 'cad-inbox-row-main' });
    main.createDiv({ cls: 'cad-inbox-row-text', text: r.text });

    if (r.project) {
      const chipRow = main.createDiv({ cls: 'cad-inbox-row-meta-row' });
      const chip = chipRow.createEl('a', { cls: 'cad-rem-project-chip', text: '📁 ' + (projectNameFromPath(this.app, r.project) || 'Project') });
      chip.title = 'Open project';
      chip.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const file = this.app.vault.getAbstractFileByPath(r.project);
        if (file && file instanceof obsidian.TFile) this.openEntityDetailFromFile(file);
      });
    }

    if (r.notes) {
      const previewLine = String(r.notes).split('\n').find((l) => l.trim()) || '';
      if (previewLine) {
        const note = main.createDiv({ cls: 'cad-inbox-row-notes' });
        note.createSpan({ cls: 'cad-inbox-row-notes-icon', text: '📝 ' });
        note.appendText(previewLine.length > 120 ? previewLine.slice(0, 117) + '…' : previewLine);
      }
    }

    // Row body click → open edit modal
    const openEdit = () => new CadenceReminderEditModal(this.app, this.plugin, r).open();
    left.addEventListener('click', openEdit);
    main.addEventListener('click', openEdit);
    left.style.cursor = 'pointer';
    main.style.cursor = 'pointer';

    const actions = row.createDiv({ cls: 'cad-inbox-actions' });
    const mk = (label: string, title: string, fn: () => void) => {
      const b = actions.createEl('button', { cls: 'cad-btn cad-btn-sm', text: label });
      b.title = title;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      return b;
    };
    if (r.when) {
      mk('+15m',  'Snooze 15 minutes', () => this.plugin.snoozeReminder(r.id, 15 * 60 * 1000));
      mk('+1h',   'Snooze 1 hour',     () => this.plugin.snoozeReminder(r.id, 60 * 60 * 1000));
      mk('Tom.',  'Snooze to tomorrow 9am', () => {
        const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
        this.plugin.updateReminder(r.id, { when: d.toISOString(), notified: false });
      });
    } else {
      mk('Schedule', 'Add a time', () => openEdit());
    }
    mk('Edit', 'Edit details + notes', () => openEdit());
    const doneBtn = mk('Done', 'Mark done', async () => {
      await this.plugin.completeReminder(r.id);
      if (r.text) await this._propagateTaskComplete(r.text, true, { kind: 'reminder', id: r.id });
    });
    doneBtn.classList.add('primary');
    const delBtn = mk('×', 'Delete', async () => {
      if (await confirmModal(this.app, 'Delete this reminder?', { title: 'Delete reminder', cta: 'Delete' })) this.plugin.deleteReminder(r.id);
    });
    delBtn.classList.add('cad-btn-danger');
  }

  async _quickAddTodayTask() {
    const text = await this._prompt({
      title: 'Quick add — today',
      placeholder: 'What needs doing?',
      cta: 'Add task',
    });
    if (!text) return;
    try {
      // ensureDailyNote always resolves the .md daily note (TAbstractFile-typed; TFile at runtime).
      const file = await ensureDailyNote(this.app, this.plugin.settings) as obsidian.TFile;
      const content = await this.app.vault.read(file);
      const parsed = parseSections(content, this.plugin.settings);
      const newTasks = [...parsed.tasks, `- [ ] ${text}`];
      const next = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
      await this.app.vault.modify(file, next);
      new obsidian.Notice('Added to today');
    } catch (e) {
      new obsidian.Notice(`Couldn't add task: ${e.message}`);
    }
  }

  /* ── Pipeline kanban (deals grouped by stage) ───── */
  /* ── CRM Dashboard ──────────────────────── */
  /* Reusable list card on the dashboard. */
  _dashCardSection(parent: HTMLElement, title: string, rows: ProviderRow[], emptyMsg: string) {
    const card = parent.createDiv({ cls: 'cad-dash-card' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: title });
    const body = card.createDiv({ cls: 'cad-dash-card-body' });
    if (!rows || !rows.length) {
      body.createDiv({ cls: 'cad-empty', text: emptyMsg || 'Nothing here yet.' });
      return;
    }
    rows.forEach((r) => {
      const row = body.createDiv({ cls: 'cad-dash-row' });
      row.createDiv({ cls: 'cad-dash-row-title', text: r.title });
      row.createDiv({ cls: 'cad-dash-row-meta', text: r.meta });
      if (r.file) row.addEventListener('click', () => {
        if (r.entityKey) {
          this.openEntityDetail(r.entityKey, r.file);
          return;
        }
        this.openEntityDetailFromFile(r.file);
      });
    });
  }

  /* ── Reports: Productivity (over daily notes) ── */
  async renderProductivity(root: HTMLElement) {
    return this.renderConfigDashboard('reports.productivity', root);
  }

  /* ── PRM Analytics ──────────────────────── */
  async renderPRMAnalytics(root: HTMLElement) {
    root.addClass('cadence-report');
    const partnerDef = ENTITIES.partner;
    const dealDef = ENTITIES.deal;
    const partners = listEntities(this.app, 'partner');
    const deals = listEntities(this.app, 'deal');
    const dealValue = (e: EntityRecord) => Number(entityValue(e, dealValueField(dealDef), dealDef)) || 0;
    const sumVal = (arr: EntityRecord[]) => arr.reduce((s, e) => s + dealValue(e), 0);
    const partnerSourced = deals.filter((e) => entityValue(e, 'partner', dealDef));
    const partnerWon = partnerSourced.filter((e) => dealWonStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));

    this._renderPageHeader(root, 'PRM analytics', 'Partner programme health, tier mix and revenue contribution');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label: string, value: string | number, sub: string, accent: string) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('PARTNERS',         partners.length,                            'on the books',                              'sky');
    stat('SOURCED DEALS',    partnerSourced.length,                      fmtValue(sumVal(partnerSourced), 'currency'),'mint');
    stat('PARTNER REVENUE',  fmtValue(sumVal(partnerWon), 'currency'),   `${partnerWon.length} won`,                  'emerald');
    const totalSourcedValue = sumVal(partnerSourced);
    const totalDealValue = sumVal(deals);
    const sharePct = totalDealValue === 0 ? 0 : Math.round((totalSourcedValue / totalDealValue) * 100);
    stat('PARTNER SHARE',    `${sharePct}%`,                             'of total pipeline value',                   'warn');

    /* Tier breakdown */
    const tierMap = new Map();
    const tierValueMap = new Map();
    partners.forEach((p) => {
      const t = String(entityValue(p, 'tier', partnerDef) || 'Untiered');
      tierMap.set(t, (tierMap.get(t) || 0) + 1);
      tierValueMap.set(t, tierValueMap.get(t) || 0);
    });
    // Add tier-attributed revenue: deals where partner matches partner-name and partner.tier is known
    const partnerByName = new Map();
    partners.forEach((p) => partnerByName.set(String(entityValue(p, 'name', partnerDef) || p.basename), p));
    partnerWon.forEach((d) => {
      const pname = String(entityValue(d, 'partner', dealDef) || '');
      const partner = partnerByName.get(pname);
      if (!partner) return;
      const tier = String(entityValue(partner, 'tier', partnerDef) || 'Untiered');
      tierValueMap.set(tier, (tierValueMap.get(tier) || 0) + dealValue(d));
    });

    if (tierMap.size) {
      root.createDiv({ cls: 'cad-section-label-lg', text: 'PARTNERS BY TIER' });
      const tierCard = root.createDiv({ cls: 'cad-dash-card' });
      tierCard.style.margin = '0 36px 18px 36px';
      const tierBody = tierCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
      const tierAccent: Record<string, string> = { 'Gold': 'warn', 'Silver': 'sky', 'Bronze': 'rose', 'Standard': 'mint', 'Untiered': 'mint' };
      [...tierMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([tier, count]) => {
        const value = tierValueMap.get(tier) || 0;
        const mini = tierBody.createDiv({ cls: 'cad-mini-stat' });
        mini.dataset.accent = tierAccent[tier] || 'sky';
        mini.createDiv({ cls: 'cad-mini-stat-value', text: String(count) });
        mini.createDiv({ cls: 'cad-mini-stat-label', text: tier.toUpperCase() });
        const sub = mini.createDiv({ cls: 'cad-stat-sub' });
        sub.style.marginTop = '4px';
        sub.setText(value > 0 ? fmtValue(value, 'currency') : '—');
      });
    }

    /* Two-col: top partners by revenue + funnel */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Top partners by won revenue
    const partnerRevenue = new Map();
    partnerWon.forEach((d) => {
      const p = String(entityValue(d, 'partner', dealDef) || '(direct)');
      partnerRevenue.set(p, (partnerRevenue.get(p) || 0) + dealValue(d));
    });
    const topPartnerRows = [...partnerRevenue.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p, v]) => {
        const partner = partnerByName.get(p);
        const file = partner ? partner.file : null;
        return {
          title: p,
          meta: fmtValue(v, 'currency'),
          file,
        };
      });
    this._dashCardSection(left, 'TOP PARTNERS · by won revenue', topPartnerRows, 'No partner-attributed wins yet.');

    // Funnel: Sourced → Open → Won
    const sourcedOpen = partnerSourced.filter((e) => !dealTerminalStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));
    const sourcedLost = partnerSourced.filter((e) => dealLostStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));
    const conv = partnerSourced.length === 0 ? 0 : Math.round((partnerWon.length / partnerSourced.length) * 100);
    const funnelCard = right.createDiv({ cls: 'cad-dash-card' });
    funnelCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'PARTNER FUNNEL' });
    const funnelBody = funnelCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const mkF = (label: string, val: string | number, sub: string, accent: string) => {
      const m = funnelBody.createDiv({ cls: 'cad-mini-stat' });
      m.dataset.accent = accent;
      m.createDiv({ cls: 'cad-mini-stat-value', text: String(val) });
      m.createDiv({ cls: 'cad-mini-stat-label', text: label });
      const s = m.createDiv({ cls: 'cad-stat-sub' });
      s.style.marginTop = '4px';
      s.setText(sub);
    };
    mkF('SOURCED', partnerSourced.length, fmtValue(sumVal(partnerSourced), 'currency'), 'sky');
    mkF('OPEN',    sourcedOpen.length,    fmtValue(sumVal(sourcedOpen),    'currency'), 'mint');
    mkF('WON',     partnerWon.length,     fmtValue(sumVal(partnerWon),     'currency'), 'emerald');
    mkF('LOST',    sourcedLost.length,    fmtValue(sumVal(sourcedLost),    'currency'), 'rose');

    const convCard = right.createDiv({ cls: 'cad-dash-card' });
    convCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: `CONVERSION · sourced → won` });
    const convBody = convCard.createDiv({ cls: 'cad-dash-card-body' });
    convBody.style.padding = '20px 16px';
    const convWrap = convBody.createDiv({ cls: 'cad-proj-progress-wrap' });
    convWrap.dataset.pctBand = pctBand(conv);
    const convLabel = convWrap.createDiv({ cls: 'cad-proj-progress-label' });
    convLabel.createSpan({ text: `${partnerWon.length}/${partnerSourced.length} sourced deals won` });
    convLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${conv}%` });
    const convBar = convWrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const convFill = convBar.createDiv({ cls: 'cad-proj-progress-fill' });
    convFill.style.width = `${conv}%`;
  }

  /* ── Team (configurable People categories) ─ */
  async renderTeam(root: HTMLElement) {
    const configured = Array.isArray(this.plugin.settings.teamPersonCategories)
      ? this.plugin.settings.teamPersonCategories
      : DEFAULT_SETTINGS.teamPersonCategories;
    const categories = new Set(configured.map((v) => String(v || '').toLowerCase()).filter(Boolean));
    return this.renderEntityList(root, 'contact', {
      title: 'Team',
      filter: (e) => {
        const category = String(entityValue(e, 'person_category', ENTITIES.contact) || '').toLowerCase();
        return categories.has(category);
      },
      columns: ['name', 'person_category', 'role', 'email', 'company'],
    });
  }

  /* ── Settings (opens Obsidian settings → BOB Workspace) ─ */
  async openSettingsTab(root: HTMLElement) {
    root.addClass('cadence-soon');
    const wrap = root.createDiv({ cls: 'cad-soon-wrap' });
    const ic = wrap.createDiv({ cls: 'cad-soon-icon' });
    try { obsidian.setIcon(ic, 'settings-2'); } catch (_) {}
    wrap.createDiv({ cls: 'cad-eyebrow', text: 'BOB WORKSPACE' });
    wrap.createDiv({ cls: 'cad-soon-title', text: 'Settings' });
    wrap.createDiv({ cls: 'cad-soon-desc', text: 'Configure folders, headings, week start, default tab, and the future BOB Workspace backend connection.' });
    const btn = wrap.createEl('button', { cls: 'cad-btn primary', text: 'Open BOB Workspace settings' });
    btn.style.marginTop = '12px';
    btn.addEventListener('click', () => {
      (this.app as AppWithInternals).setting.open();
      (this.app as AppWithInternals).setting.openTabById(this.plugin.manifest.id);
    });
  }

  /* ── Task completion propagation ──
     When a task is ticked or unticked anywhere, mirror the state to:
       - matching reminders by text (and via reminder.project to the linked project)
       - matching task lines in today's daily note + the linked reminder's date note
     Match is by exact (trimmed) task text. Renaming a task breaks the link. */
  async _propagateTaskComplete(text: string, done: boolean, source: TaskCompleteSource) {
    const t = String(text || '').trim();
    if (!t) return;
    source = source || {};

    const reminders = (this.plugin.settings.reminders || []).slice();
    const matches = reminders.filter((r) => r.text && r.text.trim() === t);

    /* 1. Sync matching reminders (skip the source reminder) */
    for (const r of matches) {
      if (source.kind === 'reminder' && r.id === source.id) continue;
      if (!!r.done === !!done) continue;
      await this.plugin.updateReminder(r.id, { done: !!done });
    }

    /* 2. For any matching reminder linked to a project, tick that project's task line */
    const projectsTouched = new Set<string>();
    for (const r of matches) {
      if (!r.project) continue;
      if (source.kind === 'project' && source.file && source.file.path === r.project) continue;
      if (projectsTouched.has(r.project)) continue;
      projectsTouched.add(r.project);
      const file = this.app.vault.getAbstractFileByPath(r.project);
      if (!file || !(file instanceof obsidian.TFile)) continue;
      await this._tickProjectTaskByText(file, t, !!done);
    }

    /* 3. Tick matching task line in relevant daily notes (today + each match's date note + source date) */
    const datesToCheck = new Set([ymd(new Date())]);
    matches.forEach((r) => {
      if (r.when) {
        const d = new Date(r.when);
        if (!isNaN(d.getTime())) datesToCheck.add(ymd(d));
      }
      if (r.createdAt) {
        const d = new Date(r.createdAt);
        if (!isNaN(d.getTime())) datesToCheck.add(ymd(d));
      }
    });
    if (source.kind === 'daily' && source.date) datesToCheck.add(ymd(source.date));
    const settings = this.plugin.settings;
    for (const dateStr of datesToCheck) {
      const path = settings.dailyNoteFolder
        ? `${settings.dailyNoteFolder.replace(/\/$/, '')}/${dateStr}.md`
        : `${dateStr}.md`;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof obsidian.TFile)) continue;
      if (source.kind === 'daily' && source.file && source.file.path === file.path) continue;
      await this._tickDailyNoteTaskByText(file, t, !!done);
    }
  }

  async _tickProjectTaskByText(file: obsidian.TFile, text: string, done: boolean) {
    let content;
    try { content = await this.app.vault.read(file); } catch (_) { return; }
    const sections = parseH2Sections(content);
    const tasks = parseTasksList(sections['Tasks'] || '');
    let changed = false;
    const updated = tasks.map((tk) => {
      if (tk.title.trim() === text && !!tk.done !== !!done) {
        changed = true;
        return Object.assign({}, tk, { done: !!done });
      }
      return tk;
    });
    if (!changed) return;
    const newSection = stringifyTasks(updated);
    const next = replaceSection(content, '## Tasks', newSection);
    await this.app.vault.modify(file, next);
  }

  async _tickDailyNoteTaskByText(file: obsidian.TFile, text: string, done: boolean) {
    let content;
    try { content = await this.app.vault.read(file); } catch (_) { return; }
    const parsed = parseSections(content, this.plugin.settings);
    let changed = false;
    const updatedTasks = parsed.tasks.map((line) => {
      const lineText = line.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
      if (lineText !== text) return line;
      const isDone = / \[(x|X)\] /.test(line);
      if (isDone === !!done) return line;
      changed = true;
      return done
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    if (!changed) return;
    const newSection = updatedTasks.join('\n');
    const next = replaceSection(content, this.plugin.settings.tasksHeading, newSection);
    await this.app.vault.modify(file, next);
  }

  /* ── Cadence-styled prompt modal ─ */
  _prompt(opts: { title?: string; placeholder?: string; defaultValue?: string; cta?: string }) {
    return new Promise((resolve) => {
      new CadencePromptModal(this.app, {
        title: opts.title || 'Enter a name',
        placeholder: opts.placeholder || '',
        defaultValue: opts.defaultValue || '',
        cta: opts.cta || 'Create',
        onSubmit: resolve,
      }).open();
    });
  }

  async _createEntityFromPrompt(entityKey: string) {
    const def = ENTITIES[entityKey];
    new CadenceEntityCreateModal(this.app, entityKey, {
      onSubmit: async (result) => {
        if (!result) return;
        try {
          const file = await createEntity(this.app, entityKey, result.name, { values: result.values });
          // Patch frontmatter with whatever else the user filled in (skip primary key — already set by template).
          const primaryKey = primaryFieldKey(def);
          const extras = Object.assign({}, result.values);
          delete extras[primaryKey];
          if (Object.keys(extras).length) {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
              Object.entries(extras).forEach(([k, v]) => {
                if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return;
                fm[k] = v;
              });
            });
          }
          new obsidian.Notice(`Created ${def.label}: ${file.basename}\nSaved to ${file.path}`, 4000);
          await this.openEntityDetail(entityKey, file);
        } catch (e) {
          new obsidian.Notice(`BOB Workspace: failed to create ${def.label} — ${e.message}`);
        }
      },
    }).open();
  }

  /* ── Today pane ─────────────────────────── */
  async renderTodayPane(root: HTMLElement) {
    root.addClass('cadence-today');
    this.todayFile = await ensureDailyNote(this.app, this.plugin.settings) as obsidian.TFile;
    const fileContent = await this.app.vault.read(this.todayFile);
    this.todayParsed = parseSections(fileContent, this.plugin.settings);

    const info = dateInfo();
    root.createDiv({ cls: 'cad-eyebrow', text: info.weekday.toUpperCase() });
    const hero = root.createDiv({ cls: 'cad-date-hero' });
    hero.createSpan({ cls: 'cad-day', text: String(info.day) });
    const monthCol = hero.createDiv();
    monthCol.createDiv({ cls: 'cad-month', text: info.month });
    monthCol.createDiv({ cls: 'cad-year',  text: String(info.year) });

    const taskCount = this.todayParsed.tasks.filter((l) => / \[ \] /.test(l)).length;
    root.createDiv({
      cls: 'cad-greet',
      text: taskCount === 0
        ? `${greeting()}. Nothing on the books — your day is clear.`
        : `${greeting()}. You have ${taskCount} ${taskCount === 1 ? 'thing' : 'things'} to handle.`,
    });

    /* Tasks */
    const taskMode = this.plugin.settings.taskMode || 'checkbox';
    const taskSection = root.createDiv({ cls: 'cad-section' });
    const taskLabel = taskSection.createDiv({ cls: 'cad-section-label' });
    taskLabel.createSpan({ text: 'TODAY' });

    /* ── Checkbox tasks (checkbox + hybrid) ── */
    if (taskMode === 'checkbox' || taskMode === 'hybrid') {
      const total = this.todayParsed.tasks.length;
      const open  = this.todayParsed.tasks.filter((l) => / \[ \] /.test(l)).length;
      taskLabel.createSpan({ cls: 'cad-count', text: `${open} open · ${total - open} done` });

      if (!this.todayParsed.tasks.length) {
        taskSection.createDiv({ cls: 'cad-empty', text: 'No tasks in today\'s note yet.' });
      } else {
        const dailyPath = this.todayFile.path;
        this.todayParsed.tasks.forEach((rawLine, idx) => {
          const checked = / \[(x|X)\] /.test(rawLine);
          const text    = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
          const row = taskSection.createDiv({ cls: 'cad-task-row' + (checked ? ' done' : '') });
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = checked;
          cb.addEventListener('change', () => this.toggleTodayTask(idx, cb.checked));
          row.createSpan({ cls: 'cad-task-text', text });

          /* Project link */
          const linkedProject = this._getTaskProjectLink(dailyPath, text);
          if (linkedProject) {
            const chip = row.createEl('a', { cls: 'cad-task-proj-chip', text: '📁 ' + (projectNameFromPath(this.app, linkedProject) || 'Project') });
            chip.title = 'Open linked project';
            chip.addEventListener('click', (ev) => {
              ev.preventDefault(); ev.stopPropagation();
              const f = this.app.vault.getAbstractFileByPath(linkedProject);
              if (f instanceof obsidian.TFile) this.openEntityDetailFromFile(f);
            });
          }
          const linkBtn = row.createEl('button', { cls: 'cad-task-link-btn' + (linkedProject ? ' linked' : ''), text: linkedProject ? '✎' : '📁' });
          linkBtn.title = linkedProject ? 'Change linked project' : 'Link to a project';
          linkBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this._openTaskProjectPicker(dailyPath, text, linkedProject); });

          /* Promote button (hybrid only) */
          if (taskMode === 'hybrid') {
            const promBtn = row.createEl('button', { cls: 'cad-task-link-btn', text: '↑', title: 'Promote to TaskNote' });
            promBtn.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              await createTaskNote(this.app, this.plugin.settings, text);
              new obsidian.Notice(`TaskNote created: ${text}`);
            });
          }
        });
      }
    }

    /* ── TaskNotes (tasknotes + hybrid) ── */
    if (taskMode === 'tasknotes' || taskMode === 'hybrid') {
      if (taskMode === 'hybrid') taskSection.createDiv({ cls: 'cad-section-label', text: 'TASKNOTES TODAY' });
      const notes = listTodayTaskNotes(this.app, this.plugin.settings);
      if (!notes.length) {
        taskSection.createDiv({ cls: 'cad-empty', text: 'No TaskNotes due today.' });
      } else {
        if (taskMode === 'tasknotes') {
          taskLabel.createSpan({ cls: 'cad-count', text: `${notes.length} due today` });
        }
        notes.forEach(({ file, fm }) => {
          const done = fm.status === 'done';
          const row  = taskSection.createDiv({ cls: 'cad-task-row' + (done ? ' done' : '') });
          const cb   = row.createEl('input', { type: 'checkbox' });
          cb.checked = done;
          cb.addEventListener('change', async () => {
            await toggleTaskNoteStatus(this.app, file, cb.checked);
            this.render();
          });
          const lbl = row.createEl('a', { cls: 'cad-task-text', text: fm.title || file.basename });
          lbl.title = 'Open TaskNote';
          lbl.addEventListener('click', (ev) => { ev.preventDefault(); this.app.workspace.openLinkText(file.path, '', false); });
          if (fm.priority && fm.priority !== 'normal') {
            row.createSpan({ cls: 'cad-count', text: fm.priority });
          }
        });
      }
    }

    const quickWrap = taskSection.createDiv();
    quickWrap.style.marginTop = '8px';
    const quick = quickWrap.createEl('input', {
      type: 'text',
      placeholder: taskMode === 'checkbox' ? 'Quick add a task — Enter to save' : 'New TaskNote — Enter to create',
    });
    quick.style.width = '100%';
    quick.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && quick.value.trim()) {
        const v = quick.value.trim();
        quick.value = '';
        if (taskMode === 'checkbox') {
          this.appendTodayTask(v);
        } else {
          await createTaskNote(this.app, this.plugin.settings, v);
          new obsidian.Notice(`TaskNote created: ${v}`);
          this.render();
        }
      }
    });

    /* Journal */
    const journalSection = root.createDiv({ cls: 'cad-section' });
    journalSection.createDiv({ cls: 'cad-section-label' }).setText('TODAY’S ENTRY');
    const ta = journalSection.createEl('textarea', { cls: 'cad-journal' });
    ta.value = this.todayParsed.journal;
    ta.placeholder = 'Write what’s on your mind…';
    ta.rows = Math.max(8, ta.value.split('\n').length + 2);
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
    ta.addEventListener('blur', () => {
      this.saveTodayJournal(ta.value);
    });
    setTimeout(() => { ta.style.height = ta.scrollHeight + 'px'; }, 0);

    /* Footer */
    const footer = root.createDiv();
    footer.style.marginTop = '24px';
    footer.style.fontSize = '12px';
    footer.style.color = 'var(--cad-ink-4)';
    const link = footer.createEl('a', { text: 'Open today\'s daily note →' });
    link.style.color = 'var(--cad-emerald-deep)';
    link.style.cursor = 'pointer';
    link.addEventListener('click', () => {
      this.app.workspace.openLinkText(this.todayFile.path, '', false);
    });
  }

  async toggleTodayTask(idx: number, checked: boolean) {
    const content = await this.app.vault.read(this.todayFile);
    const parsed = parseSections(content, this.plugin.settings);
    const taskLine = parsed.tasks[idx] || '';
    const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
    const newTasks = parsed.tasks.map((line, i) => {
      if (i !== idx) return line;
      return checked
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(this.todayFile, newContent);
    if (taskText) {
      await this._propagateTaskComplete(taskText, checked, { kind: 'daily', file: this.todayFile, date: new Date() });
    }
    this.render();
  }

  async appendTodayTask(text: string) {
    const content = await this.app.vault.read(this.todayFile);
    const parsed = parseSections(content, this.plugin.settings);
    const newTasks = [...parsed.tasks, `- [ ] ${text}`];
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(this.todayFile, newContent);
    this.render();
  }

  async saveTodayJournal(body: string) {
    const content = await this.app.vault.read(this.todayFile);
    const newContent = replaceSection(content, this.plugin.settings.journalHeading, body || '');
    await this.app.vault.modify(this.todayFile, newContent);
  }

  /* ── Planner pane ───────────────────────── */
  async renderPlannerPane(root: HTMLElement) {
    root.addClass('cadence-planner');
    const settings = this.plugin.settings;
    const days = weekDates(this.plannerAnchor, settings.weekStartsOn);
    const today = startOfDay(new Date());

    const header = root.createDiv({ cls: 'cad-pl-header' });
    const titleWrap = header.createDiv({ cls: 'cad-pl-title-wrap' });
    titleWrap.createDiv({ cls: 'cad-eyebrow', text: 'WEEK OF' });
    const startStr = days[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    const endStr   = days[6].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    titleWrap.createDiv({ cls: 'cad-pl-title', text: `${startStr} – ${endStr}` });

    const nav = header.createDiv({ cls: 'cad-pl-nav' });
    const mkBtn = (label: string, fn: () => void, cls = '') => {
      const b = nav.createEl('button', { text: label, cls: 'cad-pl-btn ' + cls });
      b.addEventListener('click', fn);
    };
    mkBtn('◀',     () => { this.plannerAnchor = addDays(this.plannerAnchor, -7); this.render(); });
    mkBtn('Today', () => { this.plannerAnchor = startOfDay(new Date());           this.render(); }, 'primary');
    mkBtn('▶',     () => { this.plannerAnchor = addDays(this.plannerAnchor,  7); this.render(); });

    let totalOpen = 0, totalDone = 0;
    const dayData = await Promise.all(days.map(async (d): Promise<PlannerDay> => {
      const path = dailyNotePath(settings, d);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof obsidian.TFile)) {
        return { date: d, path, exists: false, tasks: [] };
      }
      const content = await this.app.vault.read(file);
      const parsed = parseSections(content, settings);
      return { date: d, path, exists: true, file, tasks: parsed.tasks };
    }));
    dayData.forEach((d) => {
      d.tasks.forEach((l) => {
        if (/ \[(x|X)\] /.test(l)) totalDone++;
        else if (/ \[ \] /.test(l)) totalOpen++;
      });
    });

    const stats = root.createDiv({ cls: 'cad-pl-stats' });
    const mkStat = (label: string, value: string | number) => {
      const c = stats.createDiv({ cls: 'cad-pl-stat' });
      c.createDiv({ cls: 'cad-pl-stat-label', text: label });
      c.createDiv({ cls: 'cad-pl-stat-value', text: String(value) });
    };
    mkStat('OPEN', totalOpen);
    mkStat('DONE', totalDone);
    mkStat('TOTAL', totalOpen + totalDone);

    const grid = root.createDiv({ cls: 'cad-pl-grid' });
    dayData.forEach((d) => {
      const isToday = sameDay(d.date, today);
      const col = grid.createDiv({ cls: 'cad-pl-day' + (isToday ? ' today' : '') });

      const colHead = col.createDiv({ cls: 'cad-pl-day-head' });
      colHead.createDiv({
        cls: 'cad-pl-weekday',
        text: d.date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
      });
      colHead.createDiv({ cls: 'cad-pl-daynum', text: String(d.date.getDate()) });
      const open = d.tasks.filter((l) => / \[ \] /.test(l)).length;
      const done = d.tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
      colHead.createDiv({
        cls: 'cad-pl-meta',
        text: d.exists ? `${open} open · ${done} done` : 'no note',
      });
      colHead.addEventListener('click', async () => {
        if (!d.exists) {
          await ensureDailyNote(this.app, settings, d.date);
        }
        this.app.workspace.openLinkText(d.path, '', false);
      });

      const list = col.createDiv({ cls: 'cad-pl-tasks' });
      if (!d.tasks.length) {
        list.createDiv({ cls: 'cad-empty', text: d.exists ? '—' : '' });
      } else {
        d.tasks.forEach((rawLine, idx) => {
          const checked = / \[(x|X)\] /.test(rawLine);
          const text = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
          const row = list.createDiv({ cls: 'cad-pl-task' + (checked ? ' done' : '') });
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = checked;
          cb.addEventListener('change', () => this.togglePlannerTask(d, idx, cb.checked));
          row.createSpan({ text });
        });
      }
    });
  }

  async togglePlannerTask(day: PlannerDay, idx: number, checked: boolean) {
    if (!day.file) return;
    const content = await this.app.vault.read(day.file);
    const parsed = parseSections(content, this.plugin.settings);
    const taskLine = parsed.tasks[idx] || '';
    const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
    const newTasks = parsed.tasks.map((line, i) => {
      if (i !== idx) return line;
      return checked
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(day.file, newContent);
    if (taskText) {
      await this._propagateTaskComplete(taskText, checked, { kind: 'daily', file: day.file, date: day.date });
    }
    this.render();
  }

  async onClose() { this._closeColumnFilterMenu(); this._teardownCanvasLeaf(); }
}

/* ─────────── Settings tab ─────────── */
