import { dashboardWidgetKind } from './dashboards';
import { ENTITIES } from './entities';
import { cloneConfig, migrateWorkspacePlannerConfig, normalizePinnedSurfaces } from './nav';
import { DEFAULT_SETTINGS } from './settings';
import * as obsidian from 'obsidian';
export let PLUGIN_DIR = '';
export let WORKSPACE_CONFIG_PATH = 'Cadence/workspace.json';
export let WORKSPACE_BACKUP_PATH = 'Cadence/workspace.backup.json';
export let WORKSPACE_CONFIG: Record<string, any> = {};

// Modules outside this one must replace the active config via this setter —
// ES module imports are read-only live bindings.
export function setWorkspaceConfig(config: Record<string, any>) {
  WORKSPACE_CONFIG = config || {};
}
export let WORKSPACE_HAS_NAVIGATION = false;
export let CONFIGURED_BASE_ENTITY_KEYS = new Set<any>();
export let SCHEMA_ENTITY_KEYS = new Set<any>();

export function initPluginPaths(plugin) {
  const dir = (plugin.manifest && plugin.manifest.dir) || `.obsidian/plugins/${plugin.manifest.id}`;
  PLUGIN_DIR = dir;
  WORKSPACE_CONFIG_PATH = `${dir}/workspace.json`;
  WORKSPACE_BACKUP_PATH = `${dir}/workspace.backup.json`;
}

export function validateWorkspaceConfig(config) {
  config = migrateWorkspacePlannerConfig(config);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Must be a JSON object');
  }
  if (config.settings != null && (typeof config.settings !== 'object' || Array.isArray(config.settings))) {
    throw new Error('settings must be an object');
  }
  const navigation = config.navigation;
  if (navigation != null && (typeof navigation !== 'object' || Array.isArray(navigation))) {
    throw new Error('navigation must be an object');
  }
  if (navigation?.groups != null && !Array.isArray(navigation.groups)) {
    throw new Error('navigation.groups must be an array');
  }
  const surfaceIds = new Set<any>();
  for (const group of navigation?.groups || []) {
    if (!group || typeof group !== 'object' || !group.id) {
      throw new Error('Every navigation group needs an id');
    }
    if (!Array.isArray(group.items)) continue; // separator group — no items to validate
    for (const surface of group.items) {
      if (!surface || !surface.id || !surface.label) {
        throw new Error(`Navigation group "${group.id}" has an item without id/label`);
      }
      if (surface.placement != null && surface.placement !== 'navigation') {
        throw new Error(`Navigation item "${surface.id}" has unsupported placement "${surface.placement}"`);
      }
      if (surfaceIds.has(surface.id)) throw new Error(`Duplicate surface id "${surface.id}"`);
      surfaceIds.add(surface.id);
    }
  }
  if (navigation?.secondaryTabs != null && (typeof navigation.secondaryTabs !== 'object' || Array.isArray(navigation.secondaryTabs))) {
    throw new Error('navigation.secondaryTabs must be an object keyed by parent surface id');
  }
  for (const [parentId, tabs] of Object.entries<any>(navigation?.secondaryTabs || {})) {
    if (!Array.isArray(tabs)) throw new Error(`secondaryTabs "${parentId}" must be an array`);
    for (const tab of tabs) {
      if (!tab || !tab.label || (!tab.entityKey && !tab.route && !Array.isArray(tab.children))) {
        throw new Error(`secondaryTabs "${parentId}" has a tab without label and entityKey/route/children`);
      }
    }
  }
  if (navigation?.actions != null && (typeof navigation.actions !== 'object' || Array.isArray(navigation.actions))) {
    throw new Error('navigation.actions must be an object keyed by surface id');
  }
  for (const [surfaceId, actions] of Object.entries<any>(navigation?.actions || {})) {
    if (!Array.isArray(actions)) throw new Error(`actions "${surfaceId}" must be an array`);
    for (const action of actions) {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new Error(`actions "${surfaceId}" has an invalid action`);
      }
      if (!action.entityKey && !action.action && !action.route) {
        throw new Error(`actions "${surfaceId}" needs entityKey, action or route`);
      }
    }
  }
  if (config.entities != null) {
    throw new Error('entities is no longer supported; define record types in schema YAML');
  }
  if (config.bases != null && (typeof config.bases !== 'object' || Array.isArray(config.bases))) {
    throw new Error('bases must be an object keyed by entity type');
  }
  for (const [entityKey, base] of Object.entries<any>(config.bases || {})) {
    if (!base || typeof base !== 'object' || Array.isArray(base) || !String(base.file || base.base || '').trim()) {
      throw new Error(`bases "${entityKey}" needs a file path`);
    }
  }
  if (config.dashboards != null && (typeof config.dashboards !== 'object' || Array.isArray(config.dashboards))) {
    throw new Error('dashboards must be an object keyed by surface id');
  }
  for (const [surfaceId, dashboard] of Object.entries<any>(config.dashboards || {})) {
    validateDashboardConfig(dashboard, `dashboards.${surfaceId}`);
  }
  if (config.planner != null && (typeof config.planner !== 'object' || Array.isArray(config.planner))) {
    throw new Error('planner must be an object keyed by surface id');
  }
  for (const [surfaceId, plannerSurface] of Object.entries<any>(config.planner || {})) {
    validateDashboardConfig(plannerSurface, `planner.${surfaceId}`);
  }
  if (config.workbookGroups != null && !Array.isArray(config.workbookGroups)) {
    throw new Error('workbookGroups must be an array');
  }
  const workbookGroupIds = new Set<any>();
  for (const group of config.workbookGroups || []) {
    if (!group || typeof group !== 'object' || !String(group.id || '').trim() ||
        !String(group.label || '').trim() || !Array.isArray(group.entityKeys)) {
      throw new Error('Every workbook group needs an id, label and entityKeys array');
    }
    if (workbookGroupIds.has(group.id)) throw new Error(`Duplicate workbook group id "${group.id}"`);
    if (group.entityKeys.some((key) => !String(key || '').trim())) {
      throw new Error(`Workbook group "${group.id}" has an invalid entity key`);
    }
    if (new Set(group.entityKeys).size !== group.entityKeys.length) {
      throw new Error(`Workbook group "${group.id}" contains duplicate entity keys`);
    }
    workbookGroupIds.add(group.id);
  }
  return config;
}

export function dashboardWidgetSchema(kind) {
  const schemas = {
    metric: {
      label: 'Metric',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['count', 'metric', 'field', 'source', 'sub', 'accent'],
    },
    list: {
      label: 'List',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['entity', 'source', 'titleFields', 'metaFields', 'limit', 'empty'],
    },
    'bar-chart': {
      label: 'Bar chart',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['entity', 'source', 'groupBy', 'groups', 'columns', 'metric', 'field', 'limit'],
    },
    kanban: {
      label: 'Kanban',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['entity', 'source', 'groupBy', 'groups', 'columns', 'sort', 'titleFields', 'metaFields', 'valueField'],
    },
    'base-link': {
      label: 'Base link',
      allowSourceOnly: true,
      requiresBaseOrEntity: true,
      supports: ['base', 'view', 'label', 'description'],
    },
    'base-embed': {
      label: 'Base embed',
      allowSourceOnly: true,
      requiresBaseOrEntity: true,
      supports: ['base', 'view', 'entity', 'source', 'titleFields', 'metaFields', 'limit'],
    },
    'base-view': {
      label: 'Base view (live)',
      allowSourceOnly: true,
      requiresBaseOrEntity: true,
      supports: ['base', 'view', 'entity', 'height', 'fallback', 'title'],
    },
    markdown: {
      label: 'Markdown',
      allowSourceOnly: true,
      supports: ['body', 'markdown', 'text', 'source', 'heading', 'section', 'title', 'subtitle'],
    },
    actions: {
      label: 'Actions',
      allowSourceOnly: true,
      supports: ['actions', 'buttons', 'label', 'icon', 'description'],
    },
    selector: {
      label: 'Selector',
      allowSourceOnly: true,
      supports: ['key', 'label', 'entity', 'field', 'options', 'allLabel', 'default', 'mode', 'type'],
    },
    'date-range': {
      label: 'Date range',
      allowSourceOnly: true,
      supports: ['key', 'label', 'field', 'allLabel', 'default', 'presets', 'mode', 'type'],
    },
    merge: {
      label: 'Merge',
      allowSourceOnly: true,
      supports: ['merge', 'title', 'empty'],
    },
  };
  return schemas[kind] || null;
}

export function validateDashboardConfig(config, path) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${path} must be an object`);
  }
  if (config.title != null && typeof config.title !== 'string') {
    throw new Error(`${path}.title must be a string`);
  }
  if (config.subtitle != null && typeof config.subtitle !== 'string') {
    throw new Error(`${path}.subtitle must be a string`);
  }
  if (config.contextFilter != null && typeof config.contextFilter !== 'string') {
    throw new Error(`${path}.contextFilter must be a string`);
  }
  if (config.kind != null) {
    if (typeof config.kind !== 'string') {
      throw new Error(`${path}.kind must be a string`);
    }
    const kind = config.kind.trim().toLowerCase();
    if (kind && !['dashboard', 'report', 'planner'].includes(kind)) {
      throw new Error(`${path}.kind must be "dashboard", "report" or "planner"`);
    }
  }
  if (config.legend != null && typeof config.legend !== 'string') {
    throw new Error(`${path}.legend must be a string`);
  }
  if (config.stats != null) {
    if (!Array.isArray(config.stats)) throw new Error(`${path}.stats must be an array`);
    config.stats.forEach((stat, idx) => validateDashboardStat(stat, `${path}.stats[${idx}]`));
  }
  if (config.layout != null) {
    if (!Array.isArray(config.layout)) throw new Error(`${path}.layout must be an array`);
    config.layout.forEach((row, rowIdx) => {
      if (!Array.isArray(row)) throw new Error(`${path}.layout[${rowIdx}] must be an array`);
      row.forEach((col, colIdx) => {
        const cards = Array.isArray(col) ? col : [col];
        cards.forEach((card, cardIdx) => validateDashboardCard(card, `${path}.layout[${rowIdx}][${colIdx}][${cardIdx}]`));
      });
    });
  }
  if (config.controls != null) {
    if (!Array.isArray(config.controls)) throw new Error(`${path}.controls must be an array`);
    config.controls.forEach((card, idx) => validateDashboardCard(card, `${path}.controls[${idx}]`));
  }
  if (config.conditionalRows != null) {
    if (!Array.isArray(config.conditionalRows)) throw new Error(`${path}.conditionalRows must be an array`);
    config.conditionalRows.forEach((row, rowIdx) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`${path}.conditionalRows[${rowIdx}] must be an object`);
      }
      if (row.condition != null) {
        if (!row.condition || typeof row.condition !== 'object' || Array.isArray(row.condition)) {
          throw new Error(`${path}.conditionalRows[${rowIdx}].condition must be an object`);
        }
        if (row.condition.entities != null && !Array.isArray(row.condition.entities)) {
          throw new Error(`${path}.conditionalRows[${rowIdx}].condition.entities must be an array`);
        }
      }
      if (!Array.isArray(row.cards)) {
        throw new Error(`${path}.conditionalRows[${rowIdx}].cards must be an array`);
      }
      row.cards.forEach((card, cardIdx) => validateDashboardCard(card, `${path}.conditionalRows[${rowIdx}].cards[${cardIdx}]`));
    });
  }
}

export function validateDashboardStat(stat, path) {
  if (!stat || typeof stat !== 'object' || Array.isArray(stat)) {
    throw new Error(`${path} must be an object`);
  }
  if (!String(stat.label || '').trim()) {
    throw new Error(`${path}.label is required`);
  }
  const statSource = typeof stat.source === 'object' && stat.source && !Array.isArray(stat.source) ? stat.source : null;
  const statMode = String(statSource?.mode || '').trim().toLowerCase();
  const statBuiltIn = String(statSource?.builtIn || '').trim().toLowerCase();
  const isBuiltInStat = statMode === 'built-in' && !!statBuiltIn;
  const hasEntity = String(stat.entity || '').trim();
  const hasField = String(stat.field || stat.valueField || stat.count?.field || '').trim();
  if (!hasEntity && !isBuiltInStat) {
    throw new Error(`${path}.entity is required`);
  }
  if (stat.count != null) {
    const ok = stat.count === 'all' || stat.count === 'open' || (typeof stat.count === 'object' && !Array.isArray(stat.count) && String(stat.count.field || '').trim());
    if (!ok) throw new Error(`${path}.count must be "all", "open", or an object with field`);
  }
  if (isBuiltInStat && !hasField && !stat.metric) {
    throw new Error(`${path}.field is required for built-in stats`);
  }
  if (stat.metric != null && typeof stat.metric !== 'string') {
    throw new Error(`${path}.metric must be a string`);
  }
  if (stat.source != null && typeof stat.source !== 'string' && (typeof stat.source !== 'object' || Array.isArray(stat.source))) {
    throw new Error(`${path}.source must be a string or object`);
  }
  if (stat.sub != null && typeof stat.sub === 'object' && !Array.isArray(stat.sub)) {
    if (stat.sub.entity != null && !String(stat.sub.entity).trim()) {
      throw new Error(`${path}.sub.entity must be a non-empty string when provided`);
    }
    if (stat.sub.source != null && typeof stat.sub.source !== 'string' && (typeof stat.sub.source !== 'object' || Array.isArray(stat.sub.source))) {
      throw new Error(`${path}.sub.source must be a string or object when provided`);
    }
  }
}

export function validateDashboardCard(card, path) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error(`${path} must be an object`);
  }
  const kind = dashboardWidgetKind(card) || (Array.isArray(card.merge) ? 'merge' : '');
  const schema = dashboardWidgetSchema(kind);
  if (card.kind != null && typeof card.kind !== 'string') {
    throw new Error(`${path}.kind must be a string`);
  }
  if (schema && kind === 'selector' && !String(card.key || card.name || card.field || card.entity || '').trim()) {
    throw new Error(`${path}.key is required`);
  }
  if (!String(card.title || '').trim() && !String(card.kind || '').trim()) {
    throw new Error(`${path}.title is required`);
  }
  const hasEntity = String(card.entity || '').trim();
  const hasMerge = Array.isArray(card.merge);
  const hasSource = !!card.source || !!card.base;
  const sourceMode = String(card.source?.mode || '').trim().toLowerCase();
  const builtInMode = sourceMode === 'built-in' || !!card.source?.builtIn;
  if (schema?.requiresBaseOrEntity && !hasEntity && !hasSource && !hasMerge) {
    throw new Error(`${path} needs a Base, source or entity`);
  }
  if (schema?.requiresEntityOrSource && !hasEntity && !hasSource && !hasMerge && !builtInMode) {
    throw new Error(`${path} needs an entity, built-in source or merge array`);
  }
  if (!hasEntity && !hasMerge && !hasSource && !builtInMode && !schema?.allowSourceOnly) {
    throw new Error(`${path} needs an entity, built-in source or merge array`);
  }
  if (card.source != null && typeof card.source !== 'string' && (typeof card.source !== 'object' || Array.isArray(card.source))) {
    throw new Error(`${path}.source must be a string or object`);
  }
  if (card.base != null) {
    if (typeof card.base !== 'string' && (typeof card.base !== 'object' || Array.isArray(card.base))) {
      throw new Error(`${path}.base must be a string or object`);
    }
    if (typeof card.base === 'object') {
      if (card.base.file != null && !String(card.base.file).trim()) {
        throw new Error(`${path}.base.file must be a non-empty string when provided`);
      }
      if (card.base.view != null && !String(card.base.view).trim()) {
        throw new Error(`${path}.base.view must be a non-empty string when provided`);
      }
      if (card.base.entity != null && !String(card.base.entity).trim()) {
        throw new Error(`${path}.base.entity must be a non-empty string when provided`);
      }
    }
  }
  if (card.columns != null && !Array.isArray(card.columns)) {
    throw new Error(`${path}.columns must be an array`);
  }
  if (card.groups != null && !Array.isArray(card.groups)) {
    throw new Error(`${path}.groups must be an array`);
  }
  if (card.titleFields != null && !Array.isArray(card.titleFields)) {
    throw new Error(`${path}.titleFields must be an array`);
  }
  if (card.metaFields != null && !Array.isArray(card.metaFields)) {
    throw new Error(`${path}.metaFields must be an array`);
  }
  if (card.dateFields != null && !Array.isArray(card.dateFields)) {
    throw new Error(`${path}.dateFields must be an array`);
  }
  if (card.limit != null && !(typeof card.limit === 'number' || /^\d+$/.test(String(card.limit)))) {
    throw new Error(`${path}.limit must be a number`);
  }
  if (card.merge != null) {
    if (!Array.isArray(card.merge)) throw new Error(`${path}.merge must be an array`);
    card.merge.forEach((source, idx) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`${path}.merge[${idx}] must be an object`);
      }
      if (!String(source.entity || '').trim()) {
        throw new Error(`${path}.merge[${idx}].entity is required`);
      }
      if (source.source != null && typeof source.source !== 'string' && (typeof source.source !== 'object' || Array.isArray(source.source))) {
        throw new Error(`${path}.merge[${idx}].source must be a string or object`);
      }
    });
  }
}

export const WORKSPACE_OWNED_SETTING_KEYS = [
  'currency',
  'modules',
  'disabledSurfaces',
  'teamPersonCategories',
  'taskMode',
  'taskNotesFolder',
  'taskNotesArchiveFolder',
  'workbookExportFolder',
  'baseFiles',
  'baseViews',
  'basesFolder',
  'schemasFolder',
  'useSchemas',
  'folderContacts',
  'folderCompanies',
  'folderClients',
  'folderSuppliers',
  'folderPipeline',
  'folderPartners',
  'folderRegistrations',
  'folderCommissions',
  'folderLeads',
  'folderCertifications',
  'folderActivities',
  'folderSequences',
  'folderCampaigns',
  'folderProjects',
  'folderPlaybooks',
  'folderSkills',
  'projectFolders',
  'dailyNoteFolder',
  'journalHeading',
  'tasksHeading',
  'defaultTab',
  'dashboardState',
  'pinnedSurfaces',
  'reminders',
  'taskProjectLinks',
];

export function workspaceOwnedSettings(settings: any = {}) {
  const owned = {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
    owned[key] = key === 'pinnedSurfaces'
      ? normalizePinnedSurfaces(settings[key])
      : cloneConfig(settings[key]);
  });
  return owned;
}

export function applyWorkspaceOwnedSettings(settings: any = {}) {
  const merged = Object.assign({}, settings);
  const workspaceSettings = WORKSPACE_CONFIG.settings || {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(workspaceSettings, key) && workspaceSettings[key] != null) {
      merged[key] = key === 'pinnedSurfaces'
        ? normalizePinnedSurfaces(workspaceSettings[key])
        : cloneConfig(workspaceSettings[key]);
    }
  });
  return merged;
}

export function persistedWorkspaceOwnedSettings(settings: any = {}) {
  const existing = WORKSPACE_CONFIG.settings || {};
  const persisted = {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
    const current = settings[key];
    const defaultValue = DEFAULT_SETTINGS[key];
    const shouldPersist = Object.prototype.hasOwnProperty.call(existing, key)
      || JSON.stringify(current) !== JSON.stringify(defaultValue);
    if (shouldPersist) {
      persisted[key] = key === 'pinnedSurfaces'
        ? normalizePinnedSurfaces(current)
        : cloneConfig(current);
    }
  });
  return persisted;
}

export async function saveWorkspaceConfig(app, jsonText) {
  const parsed = validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(jsonText)));
  const adapter = app.vault.adapter;
  if (await adapter.exists(WORKSPACE_CONFIG_PATH)) {
    await adapter.write(WORKSPACE_BACKUP_PATH, await adapter.read(WORKSPACE_CONFIG_PATH));
  }
  await adapter.write(WORKSPACE_CONFIG_PATH, JSON.stringify(parsed, null, 2));
  WORKSPACE_CONFIG = parsed;
  WORKSPACE_HAS_NAVIGATION = Array.isArray(parsed.navigation?.groups);
  return parsed;
}

export async function loadWorkspaceConfig(app) {
  WORKSPACE_CONFIG = {};
  WORKSPACE_HAS_NAVIGATION = false;
  if (!(await app.vault.adapter.exists(WORKSPACE_CONFIG_PATH))) return WORKSPACE_CONFIG;
  try {
    WORKSPACE_CONFIG = validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(await app.vault.adapter.read(WORKSPACE_CONFIG_PATH))));
    WORKSPACE_HAS_NAVIGATION = Array.isArray(WORKSPACE_CONFIG.navigation?.groups);
  } catch (e) {
    new obsidian.Notice(`BOB Workspace: workspace.json error - ${e.message}`);
    WORKSPACE_CONFIG = {};
  }
  return WORKSPACE_CONFIG;
}


export function effectiveSchemaSettings(settings: any = {}) {
  const schemaConfig = WORKSPACE_CONFIG.schemas || {};
  return Object.assign({}, settings, {
    useSchemas: schemaConfig.enabled == null ? settings.useSchemas : !!schemaConfig.enabled,
    schemasFolder: schemaConfig.folder || settings.schemasFolder,
  });
}

export function addConfiguredEntityKey(keys, key) {
  const normalized = String(key || '').trim();
  if (normalized && ENTITIES[normalized]) keys.add(normalized);
}

export function collectEntityKeysFromConfigValue(value, keys) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEntityKeysFromConfigValue(item, keys));
    return;
  }
  if (!value || typeof value !== 'object') return;
  addConfiguredEntityKey(keys, value.entityKey);
  addConfiguredEntityKey(keys, value.entity);
  Object.values<any>(value).forEach((item) => collectEntityKeysFromConfigValue(item, keys));
}

export function workspaceConfiguredEntityKeys(config = WORKSPACE_CONFIG, opts: any = {}) {
  const keys = new Set<any>();
  SCHEMA_ENTITY_KEYS.forEach((key) => addConfiguredEntityKey(keys, key));
  Object.keys(config?.bases || {}).forEach((key) => addConfiguredEntityKey(keys, key));
  (config?.workbookGroups || []).forEach((group) =>
    (group.entityKeys || []).forEach((key) => addConfiguredEntityKey(keys, key))
  );
  collectEntityKeysFromConfigValue(config?.navigation, keys);
  collectEntityKeysFromConfigValue(config?.dashboards, keys);

  const hasExplicitConfig = !!(
	    SCHEMA_ENTITY_KEYS.size ||
	    config?.schemas ||
	    config?.bases ||
	    Array.isArray(config?.navigation?.groups) ||
    config?.navigation?.secondaryTabs ||
    config?.navigation?.actions ||
    Array.isArray(config?.workbookGroups) ||
    config?.dashboards
  );
  if (!keys.size && !hasExplicitConfig && opts.includeFallback !== false) {
    Object.keys(ENTITIES).forEach((key) => addConfiguredEntityKey(keys, key));
  }
  return keys;
}

export function workspaceConfiguredEntityEntries(config = WORKSPACE_CONFIG, opts: any = {}) {
  return [...workspaceConfiguredEntityKeys(config, opts)]
    .map((key) => [key, ENTITIES[key]])
    .filter(([, def]) => def?.label)
    .sort(([, a], [, b]) =>
      String(a.plural || a.label).localeCompare(String(b.plural || b.label))
    );
}

export function workspaceHasEntity(entityKey, config = WORKSPACE_CONFIG) {
  return workspaceConfiguredEntityKeys(config).has(entityKey);
}

export function configuredSurfaceActions(surfaceId, config = WORKSPACE_CONFIG) {
  const actions = config?.navigation?.actions?.[surfaceId];
  return Array.isArray(actions) ? actions : [];
}

export function configuredBaseDefinition(entityKey) {
  return WORKSPACE_CONFIG.bases?.[entityKey] || null;
}

export function configuredDashboardDefinition(surfaceId) {
  return WORKSPACE_CONFIG.dashboards?.[surfaceId] || null;
}

export function resolveDashboardConfig(surfaceId, dashboards = WORKSPACE_CONFIG.dashboards) {
  const config = (dashboards || {})[surfaceId] || null;
  return normalizeDashboardConfigShape(config);
}

export function resolvePlannerConfig(surfaceId, planner = WORKSPACE_CONFIG.planner) {
  const config = (planner || {})[surfaceId] || null;
  return normalizeDashboardConfigShape(config);
}

export function resolveSurfaceConfig(surfaceId, config = WORKSPACE_CONFIG) {
  if (String(surfaceId || '').startsWith('planner.')) {
    return resolvePlannerConfig(surfaceId, config.planner);
  }
  return resolveDashboardConfig(surfaceId, config.dashboards);
}

export function normalizeDashboardConfigShape(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDashboardConfigShape(item));
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.entries<any>(value).forEach(([key, child]) => {
    out[key] = normalizeDashboardConfigShape(child);
  });
  return out;
}

