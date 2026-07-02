import { BUNDLED_WORKSPACE_TEMPLATES } from './bundled/templates';
import { BUILTIN_SURFACE_IDS, BUILT_SURFACES } from './entities';
import { normalizeStandaloneNavigationSurfaces } from './nav-helpers';
import type { DashboardConfig, JsonValue, NavGroup, NavSurface, SecondaryTab, WorkbookExportGroup, WorkspaceConfig } from './types';
export const VIEW_TYPE_CADENCE_APP = 'bob-workspace-app';

/* ─────────── Nav structure ─────────── */
/* Mirrors the Cadence web-app left nav exactly. Groups can be collapsed.
   Built surfaces have a render method; the rest fall through to the
   coming-soon placeholder, which describes what each surface will do. */
export const BUILTIN_NAV_GROUPS: NavGroup[] = [
  {
    id: 'home_group', label: '',
    items: [
      { id: 'home', label: 'Home', icon: 'home', desc: 'Command centre — today, projects, pipeline and upcoming, all on one screen.' },
    ],
  },
  {
    id: 'misc', label: '',
    items: [
      { id: 'team',                  label: 'Team',             icon: 'user-cog',          desc: 'Team members, roles, seats — admin view of your BOB Workspace.' },
      { id: 'settings',              label: 'Settings',         icon: 'settings-2',        desc: 'BOB Workspace settings — folders, headings, week start, API connection.' },
      { id: 'misc.dashboard-editor', label: 'Surface Designer', icon: 'layout-panel-left', desc: 'Customize dashboard layouts, reports and widgets — live preview updates as you type.' },
      { id: 'misc.export',            label: 'Export',           icon: 'download',          desc: 'Export data to XLSX workbooks.' },
      { id: 'misc.import',            label: 'Import',           icon: 'upload',            desc: 'Import data from XLSX workbooks or CSV files.' },
    ],
  },
];

export const BUILTIN_SECONDARY_TABS: Record<string, SecondaryTab[]> = {};
export const BUILTIN_WORKBOOK_EXPORT_GROUPS: WorkbookExportGroup[] = [];

export function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function normalizePinnedSurfaces(value: unknown): string[] {
  // Dedupe + drop blanks only. Do NOT filter against SURFACE_BY_ID here: this
  // runs during loadSettings (via applyWorkspaceOwnedSettings) BEFORE the
  // workspace.json navigation surfaces are built, so filtering would discard
  // every pin for a configured surface and the next save would persist the
  // emptied list. Rendering and the pin toggle already guard surface existence,
  // so a pin for a not-yet-registered (or removed) surface is harmless.
  const list: string[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return list.filter((surfaceId) => {
    if (!surfaceId || typeof surfaceId !== 'string' || seen.has(surfaceId)) return false;
    seen.add(surfaceId);
    return true;
  });
}

// Move draggedId to targetId's position within a (deduped) pinned list.
// Returns the new array, or null if it's a no-op / either id is absent.
export function reorderPinnedList(list: string[] | null | undefined, draggedId: string, targetId: string): string[] | null {
  const ids = (Array.isArray(list) ? list : []).filter((id, i, arr) => id && arr.indexOf(id) === i);
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  ids.splice(from, 1);
  ids.splice(to, 0, draggedId);
  return ids;
}

export function migrateWorkspacePlannerConfig(config: WorkspaceConfig): WorkspaceConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const next: WorkspaceConfig = JSON.parse(JSON.stringify(config));
  const planner: Record<string, JsonValue | DashboardConfig> = next.planner && typeof next.planner === 'object' && !Array.isArray(next.planner)
    ? Object.assign({}, next.planner)
    : {};
  const dashboards: Record<string, DashboardConfig> | null = next.dashboards && typeof next.dashboards === 'object' && !Array.isArray(next.dashboards)
    ? Object.assign({}, next.dashboards)
    : null;
  if (dashboards) {
    let moved = false;
    // (a) Nested container shape: `dashboards.planner` is a map of planner
    // surface ids → configs (as the shipped templates author it). The literal
    // key "planner" is never a routable surface, so hoist its planner.* entries
    // to the top-level `planner` block and drop the container.
    const nestedPlanner = dashboards.planner as unknown;
    if (nestedPlanner && typeof nestedPlanner === 'object' && !Array.isArray(nestedPlanner)
      && Object.keys(nestedPlanner as Record<string, unknown>).some((id) => String(id || '').startsWith('planner.'))) {
      Object.entries(nestedPlanner as Record<string, DashboardConfig>).forEach(([surfaceId, config]) => {
        if (!String(surfaceId || '').startsWith('planner.')) return;
        if (planner[surfaceId] == null) planner[surfaceId] = config;
      });
      delete dashboards.planner;
      moved = true;
    }
    // (b) Flat shape: `dashboards["planner.*"]` keys authored at the top level.
    Object.keys(dashboards).forEach((surfaceId) => {
      if (!String(surfaceId || '').startsWith('planner.')) return;
      if (planner[surfaceId] == null) planner[surfaceId] = dashboards[surfaceId];
      delete dashboards[surfaceId];
      moved = true;
    });
    if (moved) {
      if (Object.keys(planner).length) next.planner = planner as Record<string, JsonValue>;
      else delete next.planner;
      if (Object.keys(dashboards).length) next.dashboards = dashboards;
      else delete next.dashboards;
    }
  }
  return next;
}

export function loadBuiltinDashboardDefaults(): Record<string, DashboardConfig> {
  // Sourced from the templates bundled into main.js (see BUNDLED_WORKSPACE_TEMPLATES).
  // Reading from disk via fs/__dirname does not work in Obsidian's plugin runtime,
  // and the templates/ folder isn't delivered by the store installer.
  const defaults: Record<string, DashboardConfig> = {};
  ['workspace-bob.json', 'workspace-cadence.json', 'workspace-crm.json'].forEach((fileName) => {
    const parsed = BUNDLED_WORKSPACE_TEMPLATES[fileName];
    if (!parsed) return;
    Object.entries(parsed.dashboards || {} as Record<string, DashboardConfig>).forEach(([surfaceId, config]) => {
      defaults[surfaceId] = cloneConfig(config);
    });
  });
  return defaults;
}

export let NAV_GROUPS: NavGroup[] = cloneConfig(BUILTIN_NAV_GROUPS);
export let ALL_SURFACES: NavSurface[] = [];
export let SURFACE_BY_ID: Record<string, NavSurface> = {};
export let SURFACES_BY_ENTITY_KEY: Record<string, NavSurface> = {};
export let SECONDARY_TABS: Record<string, SecondaryTab[]> = cloneConfig(BUILTIN_SECONDARY_TABS);
export let WORKBOOK_EXPORT_GROUPS: WorkbookExportGroup[] = cloneConfig(BUILTIN_WORKBOOK_EXPORT_GROUPS);

export function rebuildSurfaceLookups(): void {
  ALL_SURFACES = NAV_GROUPS.flatMap((group) => group.items || []);
  SURFACE_BY_ID = Object.fromEntries(ALL_SURFACES.map((surface): [string, NavSurface] => [surface.id, surface]));
  SURFACES_BY_ENTITY_KEY = Object.fromEntries(
    ALL_SURFACES.filter((surface) => surface.entityKey).map((surface): [string, NavSurface] => [surface.entityKey, surface])
  );
}

rebuildSurfaceLookups();

/* ─────────── Entity registry ───────────
   Each entity = a folder of markdown notes with a known frontmatter shape.
   The generic renderEntityList renders any of them; specialised views
   (Pipeline kanban, Dashboard, Reports) compose on top of the same data. */

export function resetWorkspaceRegistries(): void {
  NAV_GROUPS = cloneConfig(BUILTIN_NAV_GROUPS);
  SECONDARY_TABS = cloneConfig(BUILTIN_SECONDARY_TABS);
  WORKBOOK_EXPORT_GROUPS = cloneConfig(BUILTIN_WORKBOOK_EXPORT_GROUPS);
  for (const id of [...BUILT_SURFACES]) {
    if (!BUILTIN_SURFACE_IDS.has(id)) BUILT_SURFACES.delete(id);
  }
  rebuildSurfaceLookups();
}

export function applyWorkspaceRegistries(config: WorkspaceConfig = {}): void {
  const navigation = config.navigation || {};
  if (Array.isArray(navigation.groups)) NAV_GROUPS = cloneConfig(navigation.groups);
  if (navigation.secondaryTabs && typeof navigation.secondaryTabs === 'object') {
    SECONDARY_TABS = cloneConfig(navigation.secondaryTabs);
  }
  normalizeStandaloneNavigationSurfaces(NAV_GROUPS, SECONDARY_TABS, Array.isArray(navigation.groups));
  if (Array.isArray(config.workbookGroups)) WORKBOOK_EXPORT_GROUPS = cloneConfig(config.workbookGroups);
  NAV_GROUPS.flatMap((group) => group.items || []).forEach((surface) => {
    if (surface.entityKey || SECONDARY_TABS[surface.id] || config.dashboards?.[surface.id] || config.planner?.[surface.id]) {
      BUILT_SURFACES.add(surface.id);
    }
  });
  rebuildSurfaceLookups();
}

