import { basePropKey, parseBaseFile } from './bases-parse';
import { ENTITIES } from './entities';
import { compareEntitiesByBaseSort, entityValue, evaluateBaseFilterNode, listEntities } from './entity-files';
import { buildHomeSnapshot, buildPlannerSnapshot, buildProductivitySnapshot } from './snapshots';
import { WORKSPACE_CONFIG } from './workspace-config';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import type { ParsedBaseConfig, ParsedBaseFilters, ParsedBaseSort, RawBaseFilter } from './bases-parse';
import type { BaseFilterNode, EntityDef, EntityField, EntityRecord, JsonValue, PartialSettings } from './types';

/* ── Authored widget source spec (workspace.json dashboard cards) ─────────
   Looser than the shared WidgetSourceConfig: `base` may be an object ref,
   `filters` is a raw .base YAML filter tree (not BaseFilterNode[]) and
   `sort` may be a single item — gaps in types.ts noted for follow-up. */
interface RawWidgetBaseRef {
  file?: string;
  base?: string;
  path?: string;
  basePath?: string;
  view?: string;
  baseView?: string;
  base_view?: string;
}
type RawWidgetSortItem = string | { property?: string; field?: string; key?: string; sort?: string; direction?: string; order?: string };
interface RawWidgetSource {
  mode?: string;
  builtIn?: string;
  entityKey?: string;
  entity?: string;
  base?: string | RawWidgetBaseRef | null;
  file?: string;
  basePath?: string;
  view?: string;
  baseView?: string;
  base_view?: string;
  section?: string;
  field?: string;
  valueField?: string;
  labels?: JsonValue[];
  filters?: RawBaseFilter;
  groupBy?: string;
  sort?: RawWidgetSortItem | RawWidgetSortItem[];
  limit?: number;
}

/* Result of normalizeWidgetSourceConfig(). A type alias (so it gets an
   implicit index signature and stays assignable to the WidgetSourceConfig &
   Frontmatter shape dashboard renderers expect). base/filters/sort stay `any`
   because the shared WidgetSourceConfig declares narrower shapes (string /
   BaseFilterNode[] / BaseSortSpec[]) than the runtime values carry. */
type NormalizedWidgetSource = {
  entityKey: string | null;
  mode: string;
  builtIn: string | null;
  base?: any;
  view?: string;
  section?: string | null;
  field?: string | null;
  labels?: JsonValue[] | null;
  filters?: any;
  groupBy?: string | null;
  sort?: any;
  limit?: number | null;
};

/* parseBaseFile() result plus the widget-level overrides written onto it. */
type WidgetParsedBaseConfig = ParsedBaseConfig & { filters?: RawBaseFilter | null; groupBy?: string | null };

/* Filter spec accepted by filterEntitiesByBaseConfig(): a (widget-extended)
   parseBaseFile() result, the shared BaseConfig, or an ad-hoc { filters }. */
interface WidgetFilterConfig {
  folders?: unknown[];
  typeFilter?: unknown;
  typeFilters?: Record<string, unknown>;
  baseFilters?: ParsedBaseFilters | BaseFilterNode[];
  filters?: RawBaseFilter | null;
  limit?: number;
  baseSort?: { property?: string; direction?: string; key?: string }[];
  unsupportedBaseFilters?: string[];
  unsupportedBaseFeatures?: string[];
}

interface WidgetSourceMetadata {
  base: string | null;
  view: string;
  mode: string;
  builtIn: string | null;
  baseConfig?: WidgetParsedBaseConfig;
}

type BuiltInSnapshot =
  | Awaited<ReturnType<typeof buildHomeSnapshot>>
  | Awaited<ReturnType<typeof buildPlannerSnapshot>>
  | Awaited<ReturnType<typeof buildProductivitySnapshot>>;

/* Result of resolveWidgetSource(). */
interface ResolvedWidgetSource {
  entityKey: string | null;
  def: EntityDef | null;
  entities: EntityRecord[];
  warnings: string[];
  source: NormalizedWidgetSource;
  metadata: WidgetSourceMetadata & { builtInData?: BuiltInSnapshot };
  displayFields: EntityField[];
}

export function normalizeWidgetSourceConfig(source: unknown, fallbackEntityKey?: string | null): NormalizedWidgetSource;
export function normalizeWidgetSourceConfig(source: RawWidgetSource | string | null | undefined, fallbackEntityKey: string | null = null): NormalizedWidgetSource {
  if (!source) {
    return { entityKey: fallbackEntityKey, mode: 'entity', builtIn: null };
  }
  if (typeof source === 'string') {
    return { entityKey: fallbackEntityKey, mode: source, builtIn: null };
  }
  if (typeof source !== 'object' || Array.isArray(source)) {
    return { entityKey: fallbackEntityKey, mode: 'entity', builtIn: null };
  }
  const baseConfig = source.base && typeof source.base === 'object' && !Array.isArray(source.base)
    ? {
        file: source.base.file || source.base.base || source.base.path || source.base.basePath || '',
        view: source.base.view || source.base.baseView || source.base.base_view || '',
      }
    : null;
  const base = baseConfig || source.base || source.file || source.basePath || null;
  const view = source.view || source.baseView || source.base_view || baseConfig?.view || '';
  const entityKey = source.entityKey || source.entity || fallbackEntityKey;
  const builtIn = String(source.builtIn || '').trim() || null;
  const rawMode = String(source.mode || '').trim().toLowerCase();
  const mode = rawMode || (builtIn ? 'built-in' : 'entity');
  const isBuiltIn = mode === 'built-in';
  return {
    entityKey,
    base,
    view,
    mode,
    builtIn: isBuiltIn ? builtIn : null,
    section: isBuiltIn ? (source.section || null) : null,
    field: source.field || source.valueField || null,
    labels: Array.isArray(source.labels) ? source.labels : null,
    filters: source.filters || null,
    groupBy: source.groupBy || null,
    sort: source.sort || null,
    limit: source.limit || null,
  };
}

export function normalizeWidgetSortSpec(sort: unknown): ParsedBaseSort[];
export function normalizeWidgetSortSpec(sort: RawWidgetSortItem | RawWidgetSortItem[] | null | undefined): ParsedBaseSort[] {
  if (!sort) return [];
  const items = Array.isArray(sort) ? sort : [sort];
  return items.map((item) => {
    if (typeof item === 'string') {
      const match = item.trim().match(/^(.+?)(?:\s+(asc|desc))?$/i);
      if (!match) return null;
      return {
        property: basePropKey(match[1]),
        direction: String(match[2] || 'ASC').toUpperCase(),
      };
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const property = basePropKey(item.property || item.field || item.key || item.sort || '');
    if (!property) return null;
    return {
      property,
      direction: String(item.direction || item.order || 'ASC').toUpperCase(),
    };
  }).filter((item) => item && item.property);
}

export function filterEntitiesByBaseConfig(app: App, entityKey: string | null, entities: EntityRecord[], baseConfig: WidgetFilterConfig | null | undefined, warnings: string[] = []) {
  if (!entityKey || !Array.isArray(entities) || !baseConfig) return Array.isArray(entities) ? entities : [];
  let filtered = [...entities];
  const def = ENTITIES[entityKey];
  if (Array.isArray(baseConfig.folders) && baseConfig.folders.length) {
    const folders = baseConfig.folders.map((folder) => String(folder || '').replace(/\/$/, ''));
    filtered = filtered.filter((entity) => {
      const path = entity.file?.path || '';
      return folders.some((folder) => path === folder || path.startsWith(`${folder}/`));
    });
  }
  if (baseConfig.typeFilter) {
    filtered = filtered.filter((entity) => String(entityValue(entity, 'type', def) || '') === String(baseConfig.typeFilter));
  }
  if (baseConfig.typeFilters && typeof baseConfig.typeFilters === 'object') {
    filtered = filtered.filter((entity) => {
      const fm = entity.frontmatter || {};
      return Object.entries(baseConfig.typeFilters).every(([key, value]) => String(fm[key] ?? '') === String(value));
    });
  }
  if (baseConfig.baseFilters) {
    filtered = filtered.filter((entity) => {
      const file = entity.file;
      if (!file) return false;
      const globalMatch = evaluateBaseFilterNode(app, file, (baseConfig.baseFilters as ParsedBaseFilters).global);
      if (globalMatch === false) return false;
      const viewMatch = evaluateBaseFilterNode(app, file, (baseConfig.baseFilters as ParsedBaseFilters).view);
      if (viewMatch === false) return false;
      return true;
    });
  }
  if (baseConfig.filters) {
    filtered = filtered.filter((entity) => {
      const file = entity.file;
      if (!file) return false;
      const match = evaluateBaseFilterNode(app, file, baseConfig.filters);
      return match !== false;
    });
  }
  if (baseConfig.limit) {
    filtered = filtered.slice(0, baseConfig.limit);
  }
  if (baseConfig.baseSort?.length) {
    filtered = [...filtered].sort((a, b) => compareEntitiesByBaseSort(a, b, Object.assign({}, def || {}, { baseSort: baseConfig.baseSort })));
  }
  if (baseConfig.unsupportedBaseFilters?.length) {
    warnings.push(...baseConfig.unsupportedBaseFilters.map((filter) => `Unsupported Base filter: ${filter}`));
  }
  if (baseConfig.unsupportedBaseFeatures?.length) {
    warnings.push(...baseConfig.unsupportedBaseFeatures.map((feature) => `Unsupported Base feature: ${feature}`));
  }
  return filtered;
}

export async function resolveWidgetSource(app: App, source: unknown, fallbackEntityKey: string | null = null, settings: PartialSettings = {}): Promise<ResolvedWidgetSource> {
  const normalized = normalizeWidgetSourceConfig(source, fallbackEntityKey);
  const warnings: string[] = [];
  const entityKey = normalized.entityKey;
  const normalizedSort = (() => {
    const sort = normalized.sort;
    if (!sort) return [];
    const items = Array.isArray(sort) ? sort : [sort];
    return items.map((item) => {
      if (typeof item === 'string') {
        const match = item.trim().match(/^(.+?)(?:\s+(asc|desc))?$/i);
        if (!match) return null;
        return {
          property: basePropKey(match[1]),
          direction: String(match[2] || 'ASC').toUpperCase(),
        };
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const property = basePropKey(item.property || item.field || item.key || item.sort || '');
      if (!property) return null;
      return {
        property,
        direction: String(item.direction || item.order || 'ASC').toUpperCase(),
      };
    }).filter((item) => item && item.property);
  })();
  const basePath = typeof normalized.base === 'string'
    ? normalized.base
    : normalized.base?.file || normalized.base?.base || normalized.base?.path || normalized.base?.basePath || '';
  const baseView = normalized.view || normalized.base?.view || normalized.base?.baseView || normalized.base?.base_view || '';
  const metadata: WidgetSourceMetadata = {
    base: basePath || null,
    view: baseView || '',
    mode: normalized.mode || '',
    builtIn: normalized.builtIn || null,
  };
  if (normalized.mode === 'built-in') {
    const builtInName = String(normalized.builtIn || '').trim().toLowerCase();
    const builtInData = builtInName === 'productivity'
      ? await buildProductivitySnapshot(app, settings || WORKSPACE_CONFIG.settings || {})
      : builtInName === 'planner'
        ? await buildPlannerSnapshot(app, settings || WORKSPACE_CONFIG.settings || {})
      : builtInName === 'home'
        ? await buildHomeSnapshot(app, settings || WORKSPACE_CONFIG.settings || {})
        : null;
    return {
      entityKey: normalized.entityKey || null,
      def: normalized.entityKey && ENTITIES[normalized.entityKey] ? ENTITIES[normalized.entityKey] : null,
      entities: [],
      warnings,
      source: normalized,
      metadata: Object.assign({}, metadata, builtInData ? { builtInData } : {}),
      displayFields: [],
    };
  }
  if (!entityKey || !ENTITIES[entityKey]) {
    return { entityKey: entityKey || null, def: null, entities: [], warnings, source: normalized, metadata, displayFields: [] };
  }
  let def = ENTITIES[entityKey];
  let entities = listEntities(app, entityKey);
  if (basePath) {
    const baseFile = app.vault.getAbstractFileByPath(basePath);
    if (!(baseFile instanceof obsidian.TFile)) {
      warnings.push(`Base not found: ${basePath}`);
    } else {
      const baseConfig = await parseBaseFile(app, basePath, baseView) as WidgetParsedBaseConfig | null;
      if (baseConfig) {
        metadata.baseConfig = baseConfig;
        if (normalized.filters) baseConfig.filters = normalized.filters;
        if (normalized.groupBy) baseConfig.groupBy = normalized.groupBy;
        if (normalizedSort.length) baseConfig.baseSort = normalizedSort;
        if (normalized.limit) baseConfig.limit = normalized.limit;
        entities = filterEntitiesByBaseConfig(app, entityKey, entities, baseConfig, warnings);
        def = Object.assign({}, def, {
          baseFilters: baseConfig.baseFilters || def.baseFilters,
          baseSort: baseConfig.baseSort || def.baseSort,
          baseGroupBy: baseConfig.baseGroupBy || def.baseGroupBy,
          baseView: baseConfig.baseView || def.baseView,
          externalBaseView: baseConfig.externalBaseView || def.externalBaseView,
          unsupportedBaseFilters: baseConfig.unsupportedBaseFilters || def.unsupportedBaseFilters,
          unsupportedBaseFeatures: baseConfig.unsupportedBaseFeatures || def.unsupportedBaseFeatures,
        });
      }
    }
  }
  if (normalized.filters && !basePath) {
    entities = filterEntitiesByBaseConfig(app, entityKey, entities, { filters: normalized.filters }, warnings);
  }
  if (normalizedSort.length && !basePath) {
    entities = [...entities].sort((a, b) => compareEntitiesByBaseSort(a, b, Object.assign({}, def || {}, { baseSort: normalizedSort })));
  }
  if (normalized.limit) {
    entities = entities.slice(0, normalized.limit);
  }
  return {
    entityKey,
    def,
    entities,
    warnings,
    source: normalized,
    metadata,
    displayFields: Array.isArray(def?.fields) ? def.fields : [],
  };
}

