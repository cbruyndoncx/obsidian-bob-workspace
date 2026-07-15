import { ENTITIES, primaryFieldKey } from './entities';
import { taskNoteFolders } from './task-notes';
import * as obsidian from 'obsidian';
import type { BobSettings, EntityDef, Frontmatter, PartialSettings } from './types';

/* Template/dashboard placeholder context: ad-hoc string-keyed values. */
type PlaceholderContext = Record<string, unknown>;

/* Context bag passed through entity-create flows (modal values, raw name,
   target file path). Open-keyed: callers add ad-hoc placeholder values. */
interface EntityCreateContext {
  values?: Record<string, unknown>;
  rawName?: string;
  filePath?: string;
  [key: string]: unknown;
}

/* Normalized record template (EntityTemplateSpec object form; body may be a
   line array, and workspace.json templates can carry extra keys). */
interface TemplateSpec {
  path?: string;
  frontmatter?: Frontmatter;
  body?: string | string[];
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: BobSettings = {
  dailyNoteFolder: 'daily',
  journalHeading: '## Journal',
  tasksHeading: '## Today',
  weekStartsOn: 1, // 0 = Sunday, 1 = Monday
  defaultTab: 'home',
  openOnStartup: false,
  activeWorkspaceTemplate: '',
  collapsedGroups: {}, // { [groupId]: true }
  pinnedSurfaces: [], // [surfaceId]
  dashboardState: {}, // { [surfaceId]: { [controlKey]: value } }
  currency: 'USD',
  bobAppDark: false,
  taskProjectLinks: {}, // { "dailyPath::taskText": "Cadence/Projects/X.md" }
  modules: { crm: false, 'client-work': false, prm: false, finance: false, procurement: false, planner: false, ai: false },
  disabledSurfaces: [],    // surface IDs hidden from nav regardless of module toggle
  showSecondaryNav: false,
  showSetupNav: false,
  inlineNativeViews: false,
  teamPersonCategories: ['employee', 'freelancer', 'contractor'],
  desktopNotifications: false,
  reminders: [], // [{ id, text, when (ISO|null), repeat ('none'|'daily'|'weekly'), notified, done, createdAt }]
  // Task mode
  taskMode: 'checkbox',              // 'checkbox' | 'tasknotes' | 'hybrid'
  taskNotesFolder: '00-CORE/TaskNotes/Tasks',
  taskNotesArchiveFolder: '00-CORE/TaskNotes/Archive',
  workbookExportFolder: 'BOB Workspace/Exports',
  canvasFolder: 'BOB Workspace/Canvases',
  // Entity folder locations (all configurable)
  folderContacts: '10-ME/10-PEOPLE',
  folderCompanies: '20-COMPANY/00-PROFILE',
  folderClients: '30-CLIENTS',
  folderSuppliers: '20-COMPANY/30-SUPPLIERS',
  folderPipeline: '30-CLIENTS',
  folderPartners: '20-COMPANY/35-PARTNERS',
  folderRegistrations: '20-COMPANY/35-PARTNERS',
  folderCommissions: '20-COMPANY/35-PARTNERS',
  folderLeads: '20-COMPANY/55-LEADS',
  folderCertifications: '20-COMPANY/35-PARTNERS',
  folderActivities: '30-CLIENTS',
  folderSequences: '20-COMPANY/60-SALES/SEQUENCES',
  folderCampaigns: '20-COMPANY/60-SALES/CAMPAIGNS',
  folderProjects: '30-CLIENTS',
  folderPlaybooks: '00-CORE/Playbooks',
  folderSkills: '00-CORE/Agents/skills',
  projectFolders: [],   // extra folders to scan; first non-empty = default for new projects
  ignoredFolders: [],   // folders excluded from every entity scan (e.g. ['99-TMP']) — speeds up large vaults
  baseFiles: {
    contact: '00-CORE/Bases/People.base',
    client: '00-CORE/Bases/Clients.base',
    company: '00-CORE/Bases/Companies.base',
    deal: '00-CORE/Bases/Pipeline.base',
    activity: '00-CORE/Bases/Activities.base',
    lead: '00-CORE/Bases/Sales-Leads.base',
    partner: '00-CORE/Bases/Partners.base',
    registration: '00-CORE/Bases/Partner-Registrations.base',
    commission: '00-CORE/Bases/Partner-Commissions.base',
    certification: '00-CORE/Bases/Partner-Certifications.base',
    campaign: '00-CORE/Bases/Campaigns.base',
    sequence: '00-CORE/Bases/Sequences.base',
    meeting: '00-CORE/Bases/Meetings.base',
    'comms-thread': '00-CORE/Bases/Comms.base',
    deliverable: '00-CORE/Bases/Deliverables.base',
    feedback: '00-CORE/Bases/Feedback.base',
    survey: '00-CORE/Bases/Surveys.base',
    testimonial: '00-CORE/Bases/Testimonials.base',
    decision: '00-CORE/Bases/Decisions.base',
    project: '00-CORE/Bases/Projects.base',
    supplier: '00-CORE/Bases/Suppliers.base',
    'accounting-period': '00-CORE/Bases/Accounting-Periods.base',
    'bank-account': '00-CORE/Bases/Bank-Accounts.base',
    'bank-reconciliation': '00-CORE/Bases/Bank-Reconciliations.base',
    'chart-of-accounts': '00-CORE/Bases/Chart-of-Accounts.base',
    'financial-statement': '00-CORE/Bases/Financial-Statements.base',
    'fs-notes': '00-CORE/Bases/FS-Notes.base',
    'fx-rates-table': '00-CORE/Bases/FX-Rates-Tables.base',
    inventory: '00-CORE/Bases/Inventory.base',
    invoice: '00-CORE/Bases/AR.base',
    'journal-entry': '00-CORE/Bases/Journal-Entries.base',
    'purchase-requisition': '00-CORE/Bases/Purchase-Requisitions.base',
    'purchase-order': '00-CORE/Bases/Purchase-Orders.base',
    'supplier-invoice': '00-CORE/Bases/Supplier-Invoices.base',
    'trial-balance': '00-CORE/Bases/Trial-Balances.base',
    'vat-return': '00-CORE/Bases/VAT-Returns.base',
    'corporate-tax-return': '00-CORE/Bases/Corporate-Tax-Returns.base',
    'deferred-tax': '00-CORE/Bases/Deferred-Tax.base',
    'transfer-pricing': '00-CORE/Bases/Transfer-Pricing.base',
    'free-zone-status': '00-CORE/Bases/Free-Zone-Status.base',
    'legal-rule': '00-CORE/Bases/Legal-Rules.base',
    'document-retention': '00-CORE/Bases/Document-Retention.base',
  },  // { [entityKey]: 'path/to/entity.base' }
  baseViews: {},  // { [entityKey]: 'View name inside selected .base' }
  basesFolder: '00-CORE/Bases',  // vault folder where entity .base files live (authoritative; baseFiles supplies the filename)
  schemasFolder: '00-CORE/Schemas/source',  // Metadata Menu schema source folder
  useSchemas: false,    // toggle: read entity defs from schema YAML files
};

/* Module-level — kept in sync by the plugin so helpers can resolve folders
   without threading settings through every call. */
export let CURRENT_CURRENCY = 'USD';

export function setCurrentCurrency(currency: string) {
  CURRENT_CURRENCY = currency || 'USD';
}

/* Folders excluded from every entity file scan. Kept module-level so
   listEntityFiles() (which doesn't receive settings) can consult it.
   Normalized to trimmed, slash-stripped, non-empty paths. */
export let IGNORED_FOLDERS: string[] = [];

export function setIgnoredFolders(folders: unknown): void {
  IGNORED_FOLDERS = (Array.isArray(folders) ? folders : [])
    .map((f) => String(f ?? '').trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
}

/* True when a file path falls under any ignored folder (prefix match on
   full path segments, so '99-TMP' ignores '99-TMP/...' but not '99-TMPX/...'). */
export function isIgnoredPath(path: string): boolean {
  if (!IGNORED_FOLDERS.length) return false;
  const p = String(path || '');
  return IGNORED_FOLDERS.some((folder) => p === folder || p.startsWith(folder + '/'));
}
export let ENTITY_FOLDERS: Record<string, string> = {
  contact: '10-ME/10-PEOPLE',
  company: '20-COMPANY/00-PROFILE',
  client: '30-CLIENTS',
  supplier: '20-COMPANY/30-SUPPLIERS',
  deal: '30-CLIENTS',
  partner: '20-COMPANY/35-PARTNERS',
  registration: '20-COMPANY/35-PARTNERS',
  commission: '20-COMPANY/35-PARTNERS',
  lead: '20-COMPANY/55-LEADS',
  certification: '20-COMPANY/35-PARTNERS',
  activity: '30-CLIENTS',
  sequence: '20-COMPANY/60-SALES/SEQUENCES',
  campaign: '20-COMPANY/60-SALES/CAMPAIGNS',
  project: '30-CLIENTS',
};

export function syncEntityFolders(settings: PartialSettings): void {
  ENTITY_FOLDERS.contact      = (settings.folderContacts      || '').trim() || '10-ME/10-PEOPLE';
  ENTITY_FOLDERS.company      = (settings.folderCompanies     || '').trim() || '20-COMPANY/00-PROFILE';
  ENTITY_FOLDERS.client       = (settings.folderClients       || '').trim() || '30-CLIENTS';
  ENTITY_FOLDERS.supplier     = (settings.folderSuppliers     || '').trim() || '20-COMPANY/30-SUPPLIERS';
  ENTITY_FOLDERS.deal         = (settings.folderPipeline      || '').trim() || '30-CLIENTS';
  ENTITY_FOLDERS.partner      = (settings.folderPartners      || '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.registration = (settings.folderRegistrations || '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.commission   = (settings.folderCommissions   || '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.lead         = (settings.folderLeads         || '').trim() || '20-COMPANY/55-LEADS';
  ENTITY_FOLDERS.certification= (settings.folderCertifications|| '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.activity     = (settings.folderActivities    || '').trim() || '30-CLIENTS';
  ENTITY_FOLDERS.sequence     = (settings.folderSequences     || '').trim() || '20-COMPANY/60-SALES/SEQUENCES';
  ENTITY_FOLDERS.campaign     = (settings.folderCampaigns     || '').trim() || '20-COMPANY/60-SALES/CAMPAIGNS';
  ENTITY_FOLDERS.playbook     = (settings.folderPlaybooks     || '').trim() || '00-CORE/Playbooks';
  ENTITY_FOLDERS.skill        = (settings.folderSkills        || '').trim() || '00-CORE/Agents/skills';
  const extraProjectFolders = (settings.projectFolders || []).filter(f => f && f.trim());
  const allProjectFolders = [
    (settings.folderProjects || '').trim() || '30-CLIENTS',
    ...extraProjectFolders,
  ];
  ENTITY_FOLDERS.project = allProjectFolders[0];
  ENTITIES.project.folders = allProjectFolders.length > 1 ? allProjectFolders : undefined;
  if (!ENTITIES.project.folders) delete ENTITIES.project.folders;
  ENTITY_FOLDERS.task = (settings.taskNotesFolder || '').trim() || '00-CORE/TaskNotes/Tasks';
  ENTITIES.task.folder = ENTITY_FOLDERS.task;
  ENTITIES.task.folders = taskNoteFolders(settings);
  setIgnoredFolders(settings.ignoredFolders);
}

export function entityFolder(entityKey: string): string {
  // Schema/entities.json `folders` array wins (first entry = default for new files)
  if (ENTITIES[entityKey]?.folders?.[0]) return ENTITIES[entityKey].folders[0];
  return ENTITY_FOLDERS[entityKey] || ENTITIES[entityKey]?.folder || '';
}

export function normalizePathSegment(value: unknown): string {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizedLookupKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function normalizeProjectId(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase();
}

export function humanizeProjectName(value: unknown): string {
  const text = String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text
    .split(' ')
    .map((part) => {
      if (!part) return '';
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

export function buildEntityCreateValueMap(def: EntityDef, context: EntityCreateContext = {}): Map<string, unknown> {
  const values: Record<string, unknown> = Object.assign({}, context.values || {});
  const map = new Map<string, unknown>();
  const add = (key: string, value: unknown) => {
    if (value == null || value === '') return;
    const normalized = normalizedLookupKey(key);
    if (normalized) map.set(normalized, value);
  };

  Object.entries(values).forEach(([key, value]) => add(key, value));
  if (context.rawName) {
    const primaryKey = primaryFieldKey(def);
    if (primaryKey) add(primaryKey, context.rawName);
    add('name', context.rawName);
    add('title', context.rawName);
  }
  if (context.filePath) {
    add('file_path', context.filePath);
    add('path', context.filePath);
  }
  return map;
}

export function lookupCreateValue(name: string, valueMap: Map<string, unknown>): unknown {
  const key = normalizedLookupKey(name);
  if (!key) return '';
  if (valueMap.has(key)) return valueMap.get(key);
  return '';
}

export function resolveLocationPatternFolder(pattern: string, def: EntityDef, context: EntityCreateContext = {}): string {
  if (!pattern) return '';
  const valueMap = buildEntityCreateValueMap(def, context);
  const candidates = String(pattern)
    .split(/\s+or\s+/i)
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const resolvedPaths: { path: string; depth: number; fullyResolved: boolean }[] = [];

  for (const candidate of candidates) {
    const segments = candidate.split('/').map((segment) => segment.trim()).filter(Boolean);
    const pathSegments: string[] = [];
    let blocked = false;
    let hadPlaceholder = false;

    for (const segment of segments) {
      if (!segment.includes('{')) {
        const clean = normalizePathSegment(segment);
        if (clean) pathSegments.push(clean);
        continue;
      }

      hadPlaceholder = true;
      let segmentResolved = segment;
      let unresolved = false;
      segmentResolved = segmentResolved.replace(/\{([^}]+)\}/g, (_: string, placeholder: string) => {
        const value = lookupCreateValue(placeholder, valueMap);
        if (value === '') {
          unresolved = true;
          return '';
        }
        return normalizePathSegment(value);
      });

      if (unresolved) {
        blocked = true;
        break;
      }

      const clean = normalizePathSegment(segmentResolved);
      if (clean) pathSegments.push(clean);
    }

    resolvedPaths.push({
      path: pathSegments.join('/'),
      depth: pathSegments.length,
      fullyResolved: !blocked && (!hadPlaceholder || pathSegments.length === segments.length),
    });
  }

  const fullMatch = resolvedPaths
    .filter((item) => item.path && item.fullyResolved)
    .sort((a, b) => b.depth - a.depth)[0];
  if (fullMatch) return fullMatch.path;

  const bestPartial = resolvedPaths
    .filter((item) => item.path)
    .sort((a, b) => b.depth - a.depth)[0];
  return bestPartial?.path || '';
}

export function resolveEntityCreateFolder(entityKey: string, rawName: string, context: EntityCreateContext = {}): string {
  const def = ENTITIES[entityKey];
  if (!def) return entityFolder(entityKey);
  const pattern = def.locationPattern || def.location_pattern || '';
  const resolved = resolveLocationPatternFolder(pattern, def, Object.assign({}, context, { rawName }));
  return resolved || entityFolder(entityKey);
}

export function normalizeTemplateSpec(template: unknown): TemplateSpec | null {
  if (!template) return null;
  if (typeof template === 'string') return { body: template };
  if (typeof template === 'object' && !Array.isArray(template)) return template as TemplateSpec;
  return null;
}

export function applyTemplatePlaceholders(value: string, context?: PlaceholderContext): string;
export function applyTemplatePlaceholders<T>(value: T, context?: PlaceholderContext): T;
export function applyTemplatePlaceholders(value: unknown, context: PlaceholderContext = {}): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{([^}]+)\}\}/g, (_: string, key: string) => {
    const lookup = String(key || '').trim();
    if (!lookup) return '';
    const candidates = [lookup, lookup.toLowerCase(), lookup.replace(/\s+/g, '_').toLowerCase()];
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(context, candidate) && context[candidate] != null) {
        return String(context[candidate]);
      }
    }
    return '';
  });
}

export function applyDashboardContext<T>(value: T, context?: PlaceholderContext): T;
export function applyDashboardContext(value: unknown, context: PlaceholderContext = {}): unknown {
  if (typeof value === 'string') return applyTemplatePlaceholders(value, context);
  if (Array.isArray(value)) return value.map((item) => applyDashboardContext(item, context));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, item]) => {
      out[key] = applyDashboardContext(item, context);
    });
    return out;
  }
  return value;
}

export function renderTemplateFrontmatter(frontmatter: Frontmatter | null | undefined, context: PlaceholderContext = {}): Frontmatter {
  const result: Frontmatter = {};
  Object.entries(frontmatter || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      result[key] = value.map((item) => applyTemplatePlaceholders(item, context));
      return;
    }
    if (value && typeof value === 'object') {
      result[key] = renderTemplateFrontmatter(value, context);
      return;
    }
    result[key] = applyTemplatePlaceholders(value, context);
  });
  return result;
}

export function renderTemplateBody(body: string | string[] | null | undefined, context: PlaceholderContext = {}): string {
  const lines = Array.isArray(body) ? body : String(body || '').split('\n');
  return lines.map((line) => applyTemplatePlaceholders(line, context)).join('\n');
}

export function renderTemplateDocument(template: unknown, context: PlaceholderContext = {}, fallback: TemplateSpec | null = null): string {
  const spec = normalizeTemplateSpec(template);
  const body = spec?.body != null ? spec.body : fallback?.body;
  const frontmatter = spec?.frontmatter != null ? spec.frontmatter : fallback?.frontmatter;
  const fm = renderTemplateFrontmatter(frontmatter || {}, context);
  const fmLines = ['---'];
  Object.entries(fm).forEach(([key, value]) => {
    fmLines.push(obsidian.stringifyYaml({ [key]: value }).trim() || `${key}:`);
  });
  fmLines.push('---', '');
  const renderedBody = renderTemplateBody(body != null ? body : '', context);
  return [fmLines.join('\n'), renderedBody].filter(Boolean).join('\n');
}

