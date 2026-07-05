import { entityBasePath, entityBaseViewName } from './bases-config';
import { ENTITIES } from './entities';
import { addDays, startOfDay } from './utils';
import { CONFIGURED_BASE_ENTITY_KEYS, WORKSPACE_CONFIG } from './workspace-config';
import * as obsidian from 'obsidian';
import type { ConfiguredBaseRef } from './bases-config';
import type { BaseFilterNode, BaseSortSpec, EntityField, Frontmatter, PartialSettings } from './types';

/*
 * Raw filter node as authored in .base YAML: a condition string, an array of
 * nodes, or an and/or/not group object keyed by operator. The shared
 * BaseFilterNode ({ op, children }) is a normalized shape this parser never
 * builds, so the raw YAML form is typed locally.
 */
export type RawBaseFilter = string | RawBaseFilter[] | { [key: string]: RawBaseFilter };

interface BaseSortItemYaml { property?: string; direction?: string; }
interface BaseGroupByYaml { property?: string; direction?: string; }
interface BasePropertyYaml {
  displayName?: string;
  type?: string;
  formula?: unknown;
  summary?: unknown;
  aggregate?: unknown;
  aggregation?: unknown;
  rollup?: unknown;
}
interface BaseViewYaml {
  type?: string;
  name?: string;
  filters?: RawBaseFilter;
  order?: string[];
  sort?: BaseSortItemYaml[];
  groupBy?: BaseGroupByYaml;
  limit?: number;
}
interface BaseFileYaml {
  filters?: RawBaseFilter;
  views?: BaseViewYaml[];
  properties?: Record<string, BasePropertyYaml>;
  limit?: number;
}

export interface ParsedBaseViewRef { type: string; name: string; basePath: string; }
export interface ParsedBaseFilters { global: RawBaseFilter | null; view: RawBaseFilter | null; }
export interface ParsedBaseSort { property: string; direction: string; }
export interface ParsedBaseGroupBy { property: string; direction: string; }
export interface ParsedBaseField { key: string; label: string; }

/*
 * What parseBaseFile() actually builds. NOTE: the shared BaseConfig in
 * types.ts models baseView/externalBaseView as strings, baseFilters as a
 * BaseFilterNode[] and baseGroupBy as a string — none of which match these
 * runtime shapes, so the faithful result type lives here.
 */
export interface ParsedBaseConfig {
  baseView?: ParsedBaseViewRef;
  externalBaseView?: ParsedBaseViewRef;
  folders?: string[];
  typeFilters?: Record<string, string>;
  typeFilter?: string;
  baseFilters?: ParsedBaseFilters;
  baseSort?: ParsedBaseSort[];
  baseGroupBy?: ParsedBaseGroupBy;
  limit?: number;
  unsupportedBaseFilters?: string[];
  unsupportedBaseFeatures?: string[];
  fields?: ParsedBaseField[];
  columns?: string[];
  _baseViews?: string[];
}

export async function parseBaseFile(app: obsidian.App, basePath: string, viewName?: string): Promise<ParsedBaseConfig | null> {
  if (!await app.vault.adapter.exists(basePath)) return null;
  let yaml: BaseFileYaml;
  try {
    const raw = await app.vault.adapter.read(basePath);
    yaml = obsidian.parseYaml(raw);
  } catch (e) {
    new obsidian.Notice(`BOB Workspace: failed to parse ${basePath} — ${e.message}`);
    return null;
  }
  if (!yaml || typeof yaml !== 'object') return null;

  const result: ParsedBaseConfig = {};
  const views = Array.isArray(yaml.views) ? yaml.views : [];
  const targetView = viewName
    ? views.find(v => v.name === viewName)
    : null;
  const targetViewType = targetView?.type || '';
  const externalBaseView = !!targetViewType && targetViewType !== 'table';
  if (targetView) {
    result.baseView = {
      type: targetViewType || 'table',
      name: targetView.name || viewName || '',
      basePath,
    };
  }
  if (externalBaseView) {
    result.externalBaseView = {
      type: targetViewType,
      name: targetView?.name || viewName || targetViewType,
      basePath,
    };
  }

  // ── Translate filters ──────────────────────────────────────────────────
  const conditions = [
    ...collectBaseFilterConditionsForDerivation(yaml.filters),
    ...collectBaseFilterConditionsForDerivation(externalBaseView ? null : targetView?.filters),
  ];
  const noteFilters: Record<string, string> = {};   // key → value for note.* == "..." conditions
  const folders: string[] = [];

  for (const cond of conditions) {
    if (typeof cond !== 'string') continue;

    // file.path.startsWith("some/path/")
    const pathMatch = cond.match(/^file\.path\.startsWith\(["'](.+?)["']\)/);
    if (pathMatch) {
      folders.push(pathMatch[1].replace(/\/$/, ''));
      continue;
    }

    // note.<key> == "value"
    const noteEq = cond.match(/^note(?:\.(\w+)|\[['"](.+?)['"]\])\s*==\s*["'](.+?)["']/);
    if (noteEq) {
      noteFilters[noteEq[1] || noteEq[2]] = noteEq[3];
      continue;
    }

    // Bare property equality, common in newer Base files: type == "task"
    const bareEq = cond.match(/^(\w+)\s*==\s*["'](.+?)["']/);
    if (bareEq) {
      noteFilters[bareEq[1]] = bareEq[2];
      continue;
    }
  }

  if (folders.length)             result.folders = folders;
  if (Object.keys(noteFilters).length) result.typeFilters = Object.assign({}, noteFilters);
  if (noteFilters.type)           result.typeFilter = noteFilters.type;
  result.baseFilters = { global: yaml.filters || null, view: externalBaseView ? null : targetView?.filters || null };
  if (!externalBaseView && Array.isArray(targetView?.sort)) {
    const sort = targetView.sort
      .map((item) => ({
        property: basePropKey(item?.property || item),
        direction: String(item?.direction || 'ASC').toUpperCase(),
      }))
      .filter((item) => item.property && !String(item.property).startsWith('formula.'));
    if (sort.length) result.baseSort = sort;
  }
  if (!externalBaseView && targetView?.groupBy?.property) {
    const property = basePropKey(targetView.groupBy.property);
    if (property && !String(property).startsWith('formula.')) {
      result.baseGroupBy = {
        property,
        direction: String(targetView.groupBy.direction || 'ASC').toUpperCase(),
      };
    }
  }
  const limit = Number(externalBaseView ? yaml.limit : (targetView?.limit ?? yaml.limit));
  if (Number.isFinite(limit) && limit > 0) result.limit = limit;
  const unsupportedFilters = [
    ...collectUnsupportedBaseFilterConditions(yaml.filters),
    ...collectUnsupportedBaseFilterConditions(externalBaseView ? null : targetView?.filters),
  ];
  if (unsupportedFilters.length) result.unsupportedBaseFilters = [...new Set(unsupportedFilters)];
  const unsupportedFeatures = collectUnsupportedBaseFeatureWarnings(yaml.properties || {});
  if (unsupportedFeatures.length) result.unsupportedBaseFeatures = [...new Set(unsupportedFeatures)];

  // ── Translate properties + view order → fields + columns ──────────────
  const props = yaml.properties || {};
  // Default: use properties order (all fields), not first view (which may be filtered)
  const orderKeys = externalBaseView ? Object.keys(props) : (targetView?.order || Object.keys(props));

  const fields = orderKeys
    .filter(k => k !== 'formula.open')   // skip formula columns
    .map(k => {
      const propKey = k.startsWith('note.') ? k.slice(5) : k === 'file.name' ? 'name' : k;
      const label = props[k]?.displayName || propKey;
      return { key: propKey, label };
    });

  if (fields.length) result.fields = fields;
  result.columns = fields.slice(0, 5).map(f => f.key);

  // ── Named views → pass through for future use ──────────────────────────
  if (yaml.views?.length > 1) result._baseViews = yaml.views.map(v => v.name);

  return result;
}

export function collectBaseFilterConditions(node: RawBaseFilter | null | undefined): string[] {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectBaseFilterConditions);
  if (typeof node === 'object') {
    return Object.values(node).flatMap(collectBaseFilterConditions);
  }
  return [];
}

export function collectBaseFilterConditionsForDerivation(node: RawBaseFilter | null | undefined): string[] {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectBaseFilterConditionsForDerivation);
  if (typeof node !== 'object') return [];
  if (Object.prototype.hasOwnProperty.call(node, 'or')) return [];
  if (Object.prototype.hasOwnProperty.call(node, 'not')) return [];
  if (Object.prototype.hasOwnProperty.call(node, 'and')) {
    return collectBaseFilterConditionsForDerivation(node.and);
  }
  return Object.values(node).flatMap(collectBaseFilterConditionsForDerivation);
}

export function stripOuterParens(value: unknown): string {
  let s = String(value || '').trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let quote: string | null = null;
    let encloses = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote && s[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0 && i < s.length - 1) { encloses = false; break; }
    }
    if (!encloses) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function splitBaseExpression(expr: string, operator: string): string[] | null {
  const parts: string[] = [];
  const op = ` ${operator} `;
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= expr.length - op.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(expr.slice(start, i).trim());
      start = i + op.length;
      i = start - 1;
    }
  }
  if (parts.length) parts.push(expr.slice(start).trim());
  return parts.length ? parts : null;
}

export function basePropKey(raw: unknown): string {
  const s = String(raw || '').trim();
  if (s === 'file.path' || s === 'file.folder' || s === 'file.name' || s === 'file.basename' || s === 'file.ctime' || s === 'file.mtime' || s === 'file.tags') return s;
  const bracket = s.match(/^note\[['"](.+?)['"]\]$/);
  if (bracket) return bracket[1];
  return s.replace(/^note\./, '');
}

export function basePropValue(app: obsidian.App, file: obsidian.TFile, fm: Frontmatter, rawKey: string) {
  const key = basePropKey(rawKey);
  if (key === 'file.path') return file.path;
  if (key === 'file.folder') return file.parent?.path || file.path.split('/').slice(0, -1).join('/');
  if (key === 'file.name' || key === 'file.basename') return file.basename;
  if (key === 'file.ctime') return file.stat?.ctime ? new Date(file.stat.ctime) : null;
  if (key === 'file.mtime') return file.stat?.mtime ? new Date(file.stat.mtime) : null;
  if (key === 'file.tags') return fm.tags || [];
  return fm[key];
}

export function hasBaseValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  if (value instanceof Date) return !isNaN(value.getTime());
  return true;
}

export function parseTodayExpression(raw: unknown): Date | null {
  const expr = String(raw || '').trim();
  const match = expr.match(/^(?:today\(\)|now\(\))(?:\s*([+-])\s*["']?(\d+)\s*(?:d|day|days)["']?)?$/);
  if (!match) return null;
  const base = expr.startsWith('now()') ? new Date() : startOfDay(new Date());
  const sign = match[1] === '-' ? -1 : 1;
  const offset = match[2] ? Number(match[2]) * sign : 0;
  return startOfDay(addDays(base, offset));
}

export function isSupportedBaseFilterCondition(raw: unknown): boolean {
  const cond = stripOuterParens(String(raw || '').trim().replace(/^!/, ''));
  if (!cond) return true;
  const orParts = splitBaseExpression(cond, '||');
  if (orParts) return orParts.every(isSupportedBaseFilterCondition);
  const andParts = splitBaseExpression(cond, '&&');
  if (andParts) return andParts.every(isSupportedBaseFilterCondition);
  return /^file\.hasTag\(["']#?.+?["']\)$/.test(cond)
    || /^file\.folder\s*!=\s*["'].+?["']$/.test(cond)
    || /^file\.path\.startsWith\(["'].+?["']\)$/.test(cond)
    || /^file\.path\.contains\(["'].+?["']\)$/.test(cond)
    || /^.+?\.contains\(["'].+?["']\)$/.test(cond)
    || /^(?:date\()?[\w-]+\)?\.isEmpty\(\)$/.test(cond)
    || /^(?:note\.|note\[['"].+?['"]\])?[\w-]*\s*(==|!=)\s*(?:["'].*?["']|null)$/.test(cond)
    || /^(?:date\()?[\w.-]+(?:\[['"].+?['"]\])?\)?\s*(==|<|<=|>|>=)\s*(?:(?:today\(\)|now\(\))(?:\s*[+-]\s*["']?\d+\s*(?:d|day|days)["']?)?|["']\d{4}-\d{2}-\d{2}["'])$/.test(cond);
}

export function collectUnsupportedBaseFilterConditions(node: RawBaseFilter | null | undefined): string[] {
  return collectBaseFilterConditions(node).filter((cond) => !isSupportedBaseFilterCondition(cond));
}

export function collectUnsupportedBaseFeatureWarnings(properties: Record<string, BasePropertyYaml> = {}): string[] {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const warnings: string[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const lowerKey = String(key || '').toLowerCase();
    const type = String(prop?.type || '').toLowerCase();
    if (lowerKey.startsWith('formula.') || lowerKey.includes('formula') || prop?.formula != null) {
      warnings.push(`Formula column not evaluated: ${key}`);
      continue;
    }
    if (lowerKey.includes('summary') || type.includes('summary') || prop?.summary != null || prop?.aggregate != null || prop?.aggregation != null || prop?.rollup != null) {
      warnings.push(`Summary column not fully evaluated: ${key}`);
    }
  }
  return warnings;
}

export function normBaseName(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface BaseSummary {
  path: string;
  label: string;
  views: string[];
  typeFilters: string[];
  folders: string[];
  unsupportedBaseFeatures: string[];
}

export async function readBaseSummary(app: obsidian.App, file: obsidian.TFile): Promise<BaseSummary | null> {
  try {
    const raw = await app.vault.read(file);
    const yaml = obsidian.parseYaml(raw) as BaseFileYaml | null;
    if (!yaml || typeof yaml !== 'object') return null;
    const conditions = collectBaseFilterConditionsForDerivation(yaml.filters);
    const typeFilters: string[] = [];
    const folders: string[] = [];
    conditions.forEach((cond) => {
      if (typeof cond !== 'string') return;
      const noteEq = cond.match(/^note(?:\.(\w+)|\[['"](.+?)['"]\])\s*==\s*["'](.+?)["']/);
      const bareEq = cond.match(/^(\w+)\s*==\s*["'](.+?)["']/);
      const match = noteEq || bareEq;
      const key = noteEq ? (match[1] || match[2]) : match?.[1];
      const value = noteEq ? match[3] : match?.[2];
      if (match && key === 'type') typeFilters.push(value);
      const pathMatch = cond.match(/^file\.path\.startsWith\(["'](.+?)["']\)/);
      if (pathMatch) folders.push(pathMatch[1].replace(/\/$/, ''));
    });
    return {
      path: file.path,
      label: file.path.split('/').pop().replace(/\.base$/i, ''),
      views: Array.isArray(yaml.views) ? yaml.views.map((v) => v.name).filter(Boolean) : [],
      typeFilters: [...new Set(typeFilters)],
      folders: [...new Set(folders)],
      unsupportedBaseFeatures: [...new Set(collectUnsupportedBaseFeatureWarnings(yaml.properties || {}))],
    };
  } catch (_) {
    return null;
  }
}

export function baseSummaryCompatibleWithEntity(summary: BaseSummary | null, entityKey: string): boolean {
  const def = ENTITIES[entityKey];
  if (!summary || !def) return false;
  const expectedTypes = new Set([entityKey, def.typeFilter].filter(Boolean).map(normBaseName));
  if (summary.typeFilters.length) {
    return summary.typeFilters.some((type) => expectedTypes.has(normBaseName(type)));
  }
  const entityNames = [
    entityKey,
    def.label,
    def.plural,
    ...(entityKey === 'task' ? ['tasks', 'tasknotes'] : []),
  ].map(normBaseName).filter(Boolean);
  const baseName = normBaseName(summary.label);
  return entityNames.some((name) => baseName.includes(name) || name.includes(baseName));
}

/*
 * Entity-def view used when merging a parsed Base into the registry. The
 * shared EntityDef types baseFilters/baseSort/baseGroupBy/baseView/
 * externalBaseView with normalized shapes the runtime never builds, so this
 * local view accepts both the shared shapes and the Parsed* runtime shapes.
 */
interface BaseAwareEntityDef {
  fields?: EntityField[];
  columns?: string[];
  folders?: string[];
  typeFilters?: Record<string, string>;
  typeFilter?: string;
  baseFilters?: BaseFilterNode[] | ParsedBaseFilters;
  baseSort?: BaseSortSpec[] | ParsedBaseSort[];
  baseGroupBy?: string | ParsedBaseGroupBy;
  baseView?: string | ParsedBaseViewRef;
  externalBaseView?: string | ParsedBaseViewRef;
  unsupportedBaseFilters?: string[];
  unsupportedBaseFeatures?: string[];
}

export function mergeBaseConfigIntoEntity(entityKey: string, baseConfig: ParsedBaseConfig | null): void {
  const entity: BaseAwareEntityDef = ENTITIES[entityKey];
  if (!entity || !baseConfig) return;
  if (baseConfig.fields?.length) {
    const existingByKey = new Map((entity.fields || []).map((f) => [f.key, f]));
    const visibleFields = baseConfig.fields.map((field) => (
      existingByKey.has(field.key)
        ? Object.assign({}, existingByKey.get(field.key), field)
        : field
    ));
    visibleFields.forEach((field) => existingByKey.delete(field.key));
    entity.fields = visibleFields;
    for (const field of existingByKey.values()) {
      entity.fields.push(field);
    }
    entity.columns = baseConfig.columns || entity.fields.slice(0, 5).map((f) => f.key);
    const primary = entity.fields.find((field) => field.primary);
    if (primary && !entity.columns.includes(primary.key)) {
      entity.columns = [primary.key, ...entity.columns].slice(0, 5);
    }
  }
  if (baseConfig.folders) entity.folders = baseConfig.folders;
  if (baseConfig.typeFilters) entity.typeFilters = baseConfig.typeFilters;
  if (baseConfig.typeFilter) entity.typeFilter = baseConfig.typeFilter;
  if (baseConfig.baseFilters) entity.baseFilters = baseConfig.baseFilters;
  if (baseConfig.baseSort) entity.baseSort = baseConfig.baseSort;
  if (baseConfig.baseGroupBy) entity.baseGroupBy = baseConfig.baseGroupBy;
  if (baseConfig.baseView) entity.baseView = baseConfig.baseView;
  if (baseConfig.externalBaseView) entity.externalBaseView = baseConfig.externalBaseView;
  if (baseConfig.unsupportedBaseFilters) entity.unsupportedBaseFilters = baseConfig.unsupportedBaseFilters;
  if (baseConfig.unsupportedBaseFeatures) entity.unsupportedBaseFeatures = baseConfig.unsupportedBaseFeatures;
}

export async function applyBaseOverrides(app: obsidian.App, settings: PartialSettings = {}): Promise<void> {
  const baseFiles: Record<string, string> = settings.baseFiles || {};
  const baseViews: Record<string, string> = settings.baseViews || {};
  for (const [entityKey, basePath] of Object.entries(baseFiles)) {
    if (!basePath || !ENTITIES[entityKey] || CONFIGURED_BASE_ENTITY_KEYS.has(entityKey)) continue;
    // Resolve through entityBasePath so a filename-only baseFiles entry composes
    // with settings.basesFolder (not parsed verbatim against the vault root).
    const baseConfig = await parseBaseFile(app, entityBasePath(settings, entityKey), baseViews[entityKey]);
    mergeBaseConfigIntoEntity(entityKey, baseConfig);
  }
}

export async function applyConfiguredBaseOverrides(app: obsidian.App, settings: PartialSettings = {}): Promise<void> {
  for (const [entityKey, def] of Object.entries((WORKSPACE_CONFIG.bases || {}) as Record<string, ConfiguredBaseRef>)) {
    const basePath = def?.file || def?.base;
    if (!basePath || !ENTITIES[entityKey]) continue;
    // User selection (settings.baseViews) overrides workspace.json default view.
    const viewName = entityBaseViewName(settings, entityKey);
    // entityBasePath composes bases[key].file with settings.basesFolder, so a
    // filename-only workspace.json base resolves instead of hitting the vault root.
    const baseConfig = await parseBaseFile(app, entityBasePath(settings, entityKey), viewName);
    // Only mark the entity as workspace-owned if the base actually resolved —
    // otherwise a missing/unparseable file would block the settings.baseFiles
    // fallback in applyBaseOverrides while contributing nothing.
    if (!baseConfig) continue;
    CONFIGURED_BASE_ENTITY_KEYS.add(entityKey);
    mergeBaseConfigIntoEntity(entityKey, baseConfig);
  }
}
