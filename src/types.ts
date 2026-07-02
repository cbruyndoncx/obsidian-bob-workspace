/*
 * Shared domain model for BOB Workspace.
 *
 * Frontmatter and workspace.json content are user-authored JSON/YAML, so
 * their value types are genuinely dynamic — those use `unknown`-leaning
 * shapes (`JsonValue`, index signatures) rather than `any`. Everything the
 * plugin itself defines (entities, settings, navigation, dashboards) is
 * typed structurally.
 */
import type { TFile } from 'obsidian';

/** Arbitrary JSON-compatible value (workspace.json, .base files, YAML). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Note frontmatter. Values are user-authored YAML — deliberately `any` so
 * field access stays ergonomic at this dynamic boundary; narrow at use sites.
 */
export type Frontmatter = Record<string, any>;

/* ── Entities ─────────────────────────────────────────────── */

export type EntityFieldType = 'text' | 'email' | 'number' | 'currency' | 'date' | 'enum' | 'tags';

export interface EntityField {
  key: string;
  label?: string;
  /** UI type; defaults to 'text'. Schema-derived fields may carry other strings. */
  type?: EntityFieldType | (string & {});
  options?: string[];
  primary?: boolean;
  required?: boolean;
  default?: JsonValue;
}

/** Template spec on an entity definition: a path string or { path, ... }. */
export type EntityTemplateSpec = string | { path?: string; frontmatter?: Record<string, JsonValue>; body?: string };

export interface EntityDef {
  label?: string;
  plural?: string;
  fields?: EntityField[];
  columns?: string[];
  /** Single folder prefix (fallback when neither typeFilter nor folders set). */
  folder?: string;
  /** Multi-root folders (OR within the array, AND with other filter kinds). */
  folders?: string[];
  /** Frontmatter `type:` value to match. */
  typeFilter?: string;
  /** Multi-field frontmatter discriminators, e.g. { type: 'profile', profile_type: 'partner' }. */
  typeFilters?: Record<string, string>;
  /** Match by file basename (e.g. skills match only SKILL.md). */
  filenameFilter?: string;
  icon?: string;
  desc?: string;
  description?: string;
  module?: string;
  folderKey?: string;
  template?: EntityTemplateSpec;
  /** CSV/XLSX import header synonyms per field key. */
  fieldAliases?: Record<string, string[]>;
  /** Deal-style extras. */
  stageField?: string;
  valueField?: string;
  closeByField?: string;
  wonStages?: string[];
  lostStages?: string[];
  stageConfidence?: Record<string, number>;
  statusField?: string;
  terminalStatuses?: string[];
  dateField?: string;
  titleField?: string;
  detailMetaFields?: string[];
  detailSections?: string[];
  /** Carried over from a selected .base file (see mergeBaseConfigIntoEntity). */
  base?: string;
  baseView?: string;
  externalBaseView?: string;
  baseFilters?: BaseFilterNode[];
  baseSort?: BaseSortSpec[];
  baseGroupBy?: string;
  unsupportedBaseFilters?: string[];
  unsupportedBaseFeatures?: string[];
}

export type EntityRegistry = Record<string, EntityDef>;

/** A vault note resolved as an entity instance. */
export interface EntityRecord {
  file: TFile;
  frontmatter: Frontmatter;
  basename: string;
}

/* ── Bases (.base files) ──────────────────────────────────── */

/** Parsed Base filter tree: 'and'/'or' groups or raw condition strings. */
export type BaseFilterNode = string | { op: 'and' | 'or'; children: BaseFilterNode[] };

export interface BaseSortSpec {
  key: string;
  direction?: 'ASC' | 'DESC' | (string & {});
}

/** Result of parseBaseFile(): entity display behavior from a .base view. */
export interface BaseConfig {
  fields?: EntityField[];
  columns?: string[];
  baseFilters?: BaseFilterNode[];
  baseSort?: BaseSortSpec[];
  baseGroupBy?: string;
  baseView?: string;
  externalBaseView?: string;
  unsupportedBaseFilters?: string[];
  unsupportedBaseFeatures?: string[];
}

/* ── Navigation ───────────────────────────────────────────── */

export interface NavSurface {
  id: string;
  label?: string;
  icon?: string;
  desc?: string;
  module?: string;
  entityKey?: string;
  folderKey?: string;
  navLevel?: 'secondary' | 'setup' | (string & {});
  parent?: string;
  /** Marker used by the navigation designer when promoting tabs to surfaces. */
  placement?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavSurface[];
  icon?: string;
  module?: string;
}

export interface SecondaryTab {
  label: string;
  entityKey?: string;
  route?: string;
  id?: string;
  icon?: string;
  children?: SecondaryTab[];
}

export interface WorkbookExportGroup {
  id: string;
  label: string;
  entityKeys: string[];
}

/* ── Reminders / capture ──────────────────────────────────── */

export interface Reminder {
  id: string;
  text: string;
  /** ISO datetime or null for undated inbox items. */
  when: string | null;
  repeat: 'none' | 'daily' | 'weekly' | (string & {});
  notified?: boolean;
  done?: boolean;
  createdAt?: string;
  /** Project note path when the reminder is linked to a project task. */
  project?: string | null;
  /** Optional free-text notes captured with the reminder. */
  notes?: string;
}

/* ── Settings ─────────────────────────────────────────────── */

export interface BobSettings {
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  journalHeading: string;
  tasksHeading: string;
  weekStartsOn: number;
  defaultTab: string;
  openOnStartup: boolean;
  activeWorkspaceTemplate: string;
  collapsedGroups: Record<string, boolean>;
  pinnedSurfaces: string[];
  dashboardState: Record<string, Record<string, JsonValue>>;
  currency: string;
  cadenceAppDark: boolean;
  taskProjectLinks: Record<string, string>;
  modules: Record<string, boolean>;
  disabledSurfaces: string[];
  showSecondaryNav: boolean;
  showSetupNav: boolean;
  teamPersonCategories: string[];
  desktopNotifications: boolean;
  reminders: Reminder[];
  taskMode: 'checkbox' | 'tasknotes' | 'hybrid' | (string & {});
  taskNotesFolder: string;
  taskNotesArchiveFolder: string;
  workbookExportFolder: string;
  folderContacts: string;
  folderCompanies: string;
  folderClients: string;
  folderSuppliers: string;
  folderPipeline: string;
  folderPartners: string;
  folderRegistrations: string;
  folderCommissions: string;
  folderLeads: string;
  folderCertifications: string;
  folderActivities: string;
  folderSequences: string;
  folderCampaigns: string;
  folderProjects: string;
  folderPlaybooks: string;
  folderSkills: string;
  projectFolders: string[];
  /** Top-level (or nested) vault folders excluded from all entity scans for performance. */
  ignoredFolders: string[];
  baseFiles: Record<string, string>;
  baseViews: Record<string, string>;
  basesFolder: string;
  schemasFolder: string;
  useSchemas: boolean;
  /** Set when the first-run template picker is dismissed without applying. */
  setupDismissed?: boolean;
  /** Persisted plugin data may carry additional keys from older versions. */
  [key: string]: unknown;
}

/** Helpers routinely receive partial settings (tests, defaults). */
export type PartialSettings = Partial<BobSettings>;

/* ── Dashboards / widgets ─────────────────────────────────── */

export interface WidgetSourceConfig {
  mode?: string;
  source?: string;
  builtIn?: string;
  section?: string;
  base?: string;
  view?: string;
  entity?: string;
  filters?: BaseFilterNode[];
  groupBy?: string;
  sort?: BaseSortSpec[] | string[];
  limit?: number;
  [key: string]: JsonValue | BaseSortSpec[] | BaseFilterNode[] | undefined;
}

/**
 * A dashboard card/widget definition from workspace.json. Authored JSON with
 * a known core; renderers read many optional keys.
 */
export interface DashboardCard {
  kind?: string;
  title?: string;
  entity?: string;
  source?: string | WidgetSourceConfig;
  merge?: DashboardCard[];
  section?: string;
  [key: string]: JsonValue | WidgetSourceConfig | DashboardCard[] | undefined;
}

export interface DashboardConfig {
  title?: string;
  stats?: DashboardCard[];
  cards?: DashboardCard[];
  rows?: DashboardCard[][];
  [key: string]: JsonValue | DashboardCard[] | DashboardCard[][] | undefined;
}

/* ── workspace.json ───────────────────────────────────────── */

export interface WorkspaceNavigationConfig {
  groups?: NavGroup[];
  secondaryTabs?: Record<string, SecondaryTab[]>;
  actions?: Record<string, JsonValue>;
}

export interface WorkspaceSchemasConfig {
  enabled?: boolean;
  folder?: string;
}

export interface WorkspaceBaseRef {
  file?: string;
  view?: string;
  /** Legacy keys still read by the settings Review tab. */
  base?: string;
  baseView?: string;
}

export interface WorkspaceConfig {
  schemas?: WorkspaceSchemasConfig;
  bases?: Record<string, WorkspaceBaseRef>;
  navigation?: WorkspaceNavigationConfig;
  workbookGroups?: WorkbookExportGroup[];
  dashboards?: Record<string, DashboardConfig>;
  planner?: Record<string, JsonValue>;
  templates?: Record<string, JsonValue>;
  settings?: PartialSettings;
  /** Deprecated entity overrides (pre-schema migration path). */
  entities?: Record<string, EntityDef & Record<string, JsonValue>>;
  _template?: { id?: string; name?: string; label?: string; description?: string; order?: number; [key: string]: JsonValue | undefined };
  _assets?: { schemas?: Record<string, string>; bases?: Record<string, string> };
  [key: string]: JsonValue | undefined | unknown;
}

/* ── Schemas (canonical YAML sources) ─────────────────────── */

export interface SchemaField {
  name: string;
  type?: string;
  required?: boolean;
  options?: string[];
  default?: JsonValue;
  description?: string;
  [key: string]: JsonValue | undefined;
}

export interface SchemaSource {
  entity: string;
  label?: string;
  plural?: string;
  icon?: string;
  type_value?: string;
  location_pattern?: string;
  key_fields?: string[];
  fields?: SchemaField[];
  field_aliases?: Record<string, string[]>;
  description?: string;
  [key: string]: JsonValue | undefined;
}

/* ── Misc shared shapes ───────────────────────────────────── */

