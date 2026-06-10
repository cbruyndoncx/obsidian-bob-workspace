import { entityBaseViewName } from './bases-config';
import { ENTITIES } from './entities';
import { addDays, startOfDay } from './utils';
import { CONFIGURED_BASE_ENTITY_KEYS, WORKSPACE_CONFIG } from './workspace-config';
import * as obsidian from 'obsidian';
export async function parseBaseFile(app, basePath, viewName) {
  if (!await app.vault.adapter.exists(basePath)) return null;
  let yaml;
  try {
    const raw = await app.vault.adapter.read(basePath);
    yaml = obsidian.parseYaml(raw);
  } catch (e) {
    new obsidian.Notice(`BOB Workspace: failed to parse ${basePath} — ${e.message}`);
    return null;
  }
  if (!yaml || typeof yaml !== 'object') return null;

  const result: any = {};
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
  const noteFilters: any = {};   // key → value for note.* == "..." conditions
  const folders = [];

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

export function collectBaseFilterConditions(node) {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectBaseFilterConditions);
  if (typeof node === 'object') {
    return Object.values<any>(node).flatMap(collectBaseFilterConditions);
  }
  return [];
}

export function collectBaseFilterConditionsForDerivation(node) {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectBaseFilterConditionsForDerivation);
  if (typeof node !== 'object') return [];
  if (Object.prototype.hasOwnProperty.call(node, 'or')) return [];
  if (Object.prototype.hasOwnProperty.call(node, 'not')) return [];
  if (Object.prototype.hasOwnProperty.call(node, 'and')) {
    return collectBaseFilterConditionsForDerivation(node.and);
  }
  return Object.values<any>(node).flatMap(collectBaseFilterConditionsForDerivation);
}

export function stripOuterParens(value) {
  let s = String(value || '').trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let quote = null;
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

export function splitBaseExpression(expr, operator) {
  const parts = [];
  const op = ` ${operator} `;
  let quote = null;
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

export function basePropKey(raw) {
  const s = String(raw || '').trim();
  if (s === 'file.path' || s === 'file.folder' || s === 'file.name' || s === 'file.basename' || s === 'file.ctime' || s === 'file.mtime' || s === 'file.tags') return s;
  const bracket = s.match(/^note\[['"](.+?)['"]\]$/);
  if (bracket) return bracket[1];
  return s.replace(/^note\./, '');
}

export function basePropValue(app, file, fm, rawKey) {
  const key = basePropKey(rawKey);
  if (key === 'file.path') return file.path;
  if (key === 'file.folder') return file.parent?.path || file.path.split('/').slice(0, -1).join('/');
  if (key === 'file.name' || key === 'file.basename') return file.basename;
  if (key === 'file.ctime') return file.stat?.ctime ? new Date(file.stat.ctime) : null;
  if (key === 'file.mtime') return file.stat?.mtime ? new Date(file.stat.mtime) : null;
  if (key === 'file.tags') return fm.tags || [];
  return fm[key];
}

export function hasBaseValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  if (value instanceof Date) return !isNaN(value.getTime());
  return true;
}

export function parseTodayExpression(raw) {
  const expr = String(raw || '').trim();
  const match = expr.match(/^(?:today\(\)|now\(\))(?:\s*([+-])\s*["']?(\d+)\s*(?:d|day|days)["']?)?$/);
  if (!match) return null;
  const base = expr.startsWith('now()') ? new Date() : startOfDay(new Date());
  const sign = match[1] === '-' ? -1 : 1;
  const offset = match[2] ? Number(match[2]) * sign : 0;
  return startOfDay(addDays(base, offset));
}

export function isSupportedBaseFilterCondition(raw) {
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

export function collectUnsupportedBaseFilterConditions(node) {
  return collectBaseFilterConditions(node).filter((cond) => !isSupportedBaseFilterCondition(cond));
}

export function collectUnsupportedBaseFeatureWarnings(properties: any = {}) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const warnings = [];
  for (const [key, prop] of Object.entries<any>(properties)) {
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

export function normBaseName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function readBaseSummary(app, file) {
  try {
    const raw = await app.vault.read(file);
    const yaml = obsidian.parseYaml(raw);
    if (!yaml || typeof yaml !== 'object') return null;
    const conditions = collectBaseFilterConditionsForDerivation(yaml.filters);
    const typeFilters = [];
    const folders = [];
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

export function baseSummaryCompatibleWithEntity(summary, entityKey) {
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

export function mergeBaseConfigIntoEntity(entityKey, baseConfig) {
  const entity = ENTITIES[entityKey];
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

export async function applyBaseOverrides(app, settings: any = {}) {
  const baseFiles = settings.baseFiles || {};
  const baseViews = settings.baseViews || {};
  for (const [entityKey, basePath] of Object.entries<any>(baseFiles)) {
    if (!basePath || !ENTITIES[entityKey] || CONFIGURED_BASE_ENTITY_KEYS.has(entityKey)) continue;
    const baseConfig = await parseBaseFile(app, basePath, baseViews[entityKey]);
    mergeBaseConfigIntoEntity(entityKey, baseConfig);
  }
}

export async function applyConfiguredBaseOverrides(app, settings: any = {}) {
  for (const [entityKey, def] of Object.entries<any>(WORKSPACE_CONFIG.bases || {})) {
    const basePath = def?.file || def?.base;
    if (!basePath || !ENTITIES[entityKey]) continue;
    CONFIGURED_BASE_ENTITY_KEYS.add(entityKey);
    // User selection (settings.baseViews) overrides workspace.json default view.
    const viewName = entityBaseViewName(settings, entityKey);
    const baseConfig = await parseBaseFile(app, basePath, viewName);
    mergeBaseConfigIntoEntity(entityKey, baseConfig);
  }
}

