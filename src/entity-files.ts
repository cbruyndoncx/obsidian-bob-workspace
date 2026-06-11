import { basePropValue, hasBaseValue, parseTodayExpression, splitBaseExpression, stripOuterParens } from './bases-parse';
import { ENTITIES, primaryFieldKey } from './entities';
import { cloneConfig } from './nav';
import { pluralizeEntityLabel } from './schemas';
import { CURRENT_CURRENCY, entityFolder, humanizeProjectName, normalizeProjectId, renderTemplateDocument } from './settings';
import { isTemplatePath, startOfDay, ymd } from './utils';
import { WORKSPACE_CONFIG } from './workspace-config';
import * as obsidian from 'obsidian';
import type { App, CachedMetadata, TFile } from 'obsidian';
import type { BobEntityDef, BobEntityField } from './entities';
import type { EntityDef, EntityRecord, Frontmatter, JsonValue } from './types';

/* What a selected .base actually stores on the entity definition (see
   parseBaseFile/mergeBaseConfigIntoEntity in bases-parse.ts), as opposed to
   the shared types: `baseFilters` is a pair of raw YAML filter trees (file
   level + selected view), not the `BaseFilterNode[]` declared on EntityDef,
   and `baseSort` entries carry `property` (not `key`). Typed locally until
   types.ts models the parsed shapes. */
type RawBaseFilter = string | RawBaseFilter[] | { [key: string]: RawBaseFilter } | null | undefined;
interface ParsedBaseFilters {
  global: RawBaseFilter;
  view: RawBaseFilter;
}
interface ParsedBaseSortSpec {
  property?: string;
  direction?: string;
}

export function listEntityFiles(app: App, entityKey: string): TFile[] {
  const def = ENTITIES[entityKey] as BobEntityDef & { baseFilters?: ParsedBaseFilters };
  if (!def) return [];

  const hasPathFilter = Array.isArray(def.folders);
  const useDefaultPath = !def.typeFilter && !hasPathFilter;

  return app.vault.getMarkdownFiles().filter((f) => {
    if (isTemplatePath(f.path)) return false;

    // Path filter (OR within folders array; AND with type)
    if (hasPathFilter) {
      if (!def.folders.some((d) => f.path.startsWith(d.replace(/\/$/, '') + '/'))) return false;
    } else if (useDefaultPath) {
      if (!f.path.startsWith(entityFolder(entityKey) + '/')) return false;
    }
    // Filename filter (e.g. SKILL.md — one canonical file per subfolder)
    if (def.filenameFilter && f.name !== def.filenameFilter) return false;
    // Single type filter
    if (def.typeFilter) {
      const fm: Frontmatter = (app.metadataCache.getFileCache(f) || {} as CachedMetadata).frontmatter || {};
      if (fm.type !== def.typeFilter) return false;
    }
    // Multi-frontmatter filter, used by selected Base views.
    if (def.typeFilters && typeof def.typeFilters === 'object') {
      const fm: Frontmatter = (app.metadataCache.getFileCache(f) || {} as CachedMetadata).frontmatter || {};
      for (const [key, value] of Object.entries(def.typeFilters)) {
        if (String(fm[key] ?? '') !== String(value)) return false;
      }
    }
    if (def.baseFilters) {
      const globalMatch = evaluateBaseFilterNode(app, f, def.baseFilters.global);
      if (globalMatch === false) return false;
      const viewMatch = evaluateBaseFilterNode(app, f, def.baseFilters.view);
      if (viewMatch === false) return false;
    }
    return true;
  });
}

export function readEntity(app: App, file: TFile): EntityRecord {
  const cache = app.metadataCache.getFileCache(file) || {} as CachedMetadata;
  const fm: Frontmatter = cache.frontmatter || {};
  return { file, frontmatter: fm, basename: file.basename };
}

export function evaluateBaseFilterNode(app: App, file: TFile, node: RawBaseFilter): boolean | null {
  if (!node) return true;
  if (typeof node === 'string') return evaluateBaseFilterCondition(app, file, node);
  if (Array.isArray(node)) return evaluateBaseFilterGroup(app, file, 'and', node);
  if (typeof node !== 'object') return true;
  if (node.not != null) {
    const result = evaluateBaseFilterNode(app, file, node.not);
    return result == null ? true : !result;
  }
  if (Array.isArray(node.and)) return evaluateBaseFilterGroup(app, file, 'and', node.and);
  if (Array.isArray(node.or)) return evaluateBaseFilterGroup(app, file, 'or', node.or);
  const results = Object.values(node).map((child) => evaluateBaseFilterNode(app, file, child));
  return results.includes(false) ? false : true;
}

export function evaluateBaseFilterGroup(app: App, file: TFile, op: string, children: RawBaseFilter[]): boolean {
  const results = children.map((child) => evaluateBaseFilterNode(app, file, child));
  if (op === 'or') {
    if (results.includes(true)) return true;
    if (results.every((result) => result === false)) return false;
    return true;
  }
  return results.includes(false) ? false : true;
}

export function evaluateBaseFilterCondition(app: App, file: TFile, raw: unknown): boolean | null {
  let cond = stripOuterParens(String(raw || '').trim());
  if (!cond) return true;
  if (cond.startsWith('!')) {
    const inner = evaluateBaseFilterCondition(app, file, cond.slice(1));
    return inner == null ? true : !inner;
  }
  const orParts = splitBaseExpression(cond, '||');
  if (orParts) return orParts.some((part) => evaluateBaseFilterCondition(app, file, part) === true);
  const andParts = splitBaseExpression(cond, '&&');
  if (andParts) return andParts.every((part) => evaluateBaseFilterCondition(app, file, part) !== false);

  const cache = app.metadataCache.getFileCache(file) || {} as CachedMetadata;
  const fm: Frontmatter = cache.frontmatter || {};
  const folder = file.parent?.path || file.path.split('/').slice(0, -1).join('/');
  const frontmatterTags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(/[,\s]+/).filter(Boolean);
  const tags = new Set([...frontmatterTags, ...(cache.tags || []).map((t) => t.tag)]);
  const today = startOfDay(new Date());

  const hasTag = cond.match(/^file\.hasTag\(["']#?(.+?)["']\)$/);
  if (hasTag) {
    const tag = hasTag[1].replace(/^#/, '');
    return tags.has(tag) || tags.has(`#${tag}`);
  }

  const folderNe = cond.match(/^file\.folder\s*!=\s*["'](.+?)["']$/);
  if (folderNe) return folder !== folderNe[1];

  const pathStarts = cond.match(/^file\.path\.startsWith\(["'](.+?)["']\)$/);
  if (pathStarts) return file.path.startsWith(pathStarts[1].replace(/\/$/, '') + '/');

  const pathContains = cond.match(/^file\.path\.contains\(["'](.+?)["']\)$/);
  if (pathContains) return file.path.includes(pathContains[1]);

  const contains = cond.match(/^(.+?)\.contains\(["'](.+?)["']\)$/);
  if (contains) {
    const value = basePropValue(app, file, fm, contains[1]);
    if (Array.isArray(value)) return value.map((item) => String(item)).includes(contains[2]);
    return String(value ?? '').includes(contains[2]);
  }

  const empty = cond.match(/^(?:date\()?(.+?)\)?\.isEmpty\(\)$/);
  if (empty) return !hasBaseValue(basePropValue(app, file, fm, empty[1]));

  const propEq = cond.match(/^(.+?)\s*(==|!=)\s*(?:(["'])(.*?)\3|null)$/);
  if (propEq) {
    const actualValue = basePropValue(app, file, fm, propEq[1]);
    const expectedIsNull = propEq[0].trim().endsWith('null');
    if (expectedIsNull) {
      const present = hasBaseValue(actualValue);
      return propEq[2] === '==' ? !present : present;
    }
    const actual = String(actualValue ?? '');
    const expected = propEq[4] ?? '';
    return propEq[2] === '==' ? actual === expected : actual !== expected;
  }

  const dateCompare = cond.match(/^(?:date\()?(.+?)\)?\s*(==|<|<=|>|>=)\s*((?:today|now)\(\)(?:\s*[+-]\s*["']?\d+\s*(?:d|day|days)["']?)?|["']\d{4}-\d{2}-\d{2}["'])$/);
  if (dateCompare) {
    const actual = parseBaseDate(basePropValue(app, file, fm, dateCompare[1]));
    if (!actual) return false;
    const target = parseTodayExpression(dateCompare[3]) || parseBaseDate(String(dateCompare[3] || '').replace(/^["']|["']$/g, '')) || today;
    return compareBaseDates(actual, dateCompare[2], target);
  }

  return null;
}

export function parseBaseDate(value: string | number | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = startOfDay(new Date(value));
  return isNaN(d.getTime()) ? null : d;
}

export function compareBaseDates(actual: Date, op: string, target: Date): boolean {
  const a = actual.getTime();
  const b = target.getTime();
  if (op === '==') return a === b;
  if (op === '<') return a < b;
  if (op === '<=') return a <= b;
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  return true;
}

export function listEntities(app: App, entityKey: string): EntityRecord[] {
  const def = ENTITIES[entityKey];
  const entities = listEntityFiles(app, entityKey).map((f) => readEntity(app, f));
  if (!def?.baseSort?.length) return entities;
  return entities.sort((a, b) => compareEntitiesByBaseSort(a, b, def));
}

export function compareEntitiesByBaseSort(a: EntityRecord, b: EntityRecord, def: EntityDef): number {
  for (const sort of (def.baseSort || []) as ParsedBaseSortSpec[]) {
    const av = entityValue(a, sort.property, def);
    const bv = entityValue(b, sort.property, def);
    const cmp = compareBaseSortValues(av, bv);
    if (cmp !== 0) return sort.direction === 'DESC' ? -cmp : cmp;
  }
  return 0;
}

export function compareBaseSortValues(a: unknown, b: unknown): number {
  const aEmpty = !hasBaseValue(a);
  const bEmpty = !hasBaseValue(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const an = Number(a);
  const bn = Number(b);
  if (!isNaN(an) && !isNaN(bn)) return an - bn;
  const ad = new Date(a as string | number);
  const bd = new Date(b as string | number);
  if (!isNaN(ad.getTime()) && !isNaN(bd.getTime())) return ad.getTime() - bd.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/* Returns raw frontmatter values — `any` by design at the YAML boundary
   (matches the documented Frontmatter shape; narrow at use sites). */
export function entityValue(entity: EntityRecord, key: string, def: EntityDef): any {
  const fm = entity.frontmatter || {};
  if (fm[key] != null && fm[key] !== '') return fm[key];
  if (def?.typeFilter === 'project') {
    if (key === 'project_name' || key === 'name' || key === 'title') {
      return fm.project_name || fm.name || fm.project || humanizeProjectName(fm.project_id || entity.basename);
    }
  }
  // File-name-backed fields default to the note basename.
  if (['name', 'title', 'subject', 'file.name', 'file.basename'].includes(key)) return entity.basename;
  if (key === 'file.path') return entity.file?.path || '';
  if (key === 'file.folder') return entity.file?.parent?.path || entity.file?.path?.split('/').slice(0, -1).join('/') || '';
  if (key === 'file.ctime') return entity.file?.stat?.ctime ? new Date(entity.file.stat.ctime).toISOString() : '';
  if (key === 'file.mtime') return entity.file?.stat?.mtime ? new Date(entity.file.stat.mtime).toISOString() : '';
  if (key === 'file.tags') return fm.tags || [];
  if (key && key === primaryFieldKey(def)) return entity.basename;
  return '';
}

export function entityPrimaryValue(entity: EntityRecord, def: EntityDef): string {
  const key = primaryFieldKey(def);
  return (key ? entityValue(entity, key, def) : '') || entity.basename || '';
}

export function fmtValue(val: unknown, type?: string): string {
  if (val == null || val === '') return '';
  if (type === 'tags' && Array.isArray(val)) return val.map((t) => `#${t}`).join(' ');
  if (type === 'date') {
    const d = new Date(val as string | number);
    if (!isNaN(d.getTime())) return d.toLocaleDateString(navigator.language || undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return String(val);
  }
  if (type === 'currency') {
    const n = Number(val);
    if (!isNaN(n)) {
      try {
        return n.toLocaleString(undefined, { style: 'currency', currency: CURRENT_CURRENCY, maximumFractionDigits: 0 });
      } catch (_) {
        return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      }
    }
    return String(val);
  }
  if (type === 'number') return String(val);
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

export function resolveEntityFieldDefault(field: BobEntityField): JsonValue | undefined {
  if (!Object.prototype.hasOwnProperty.call(field || {}, 'defaultValue')) return undefined;
  if (field.defaultValue === '{{today}}') return ymd();
  return cloneConfig(field.defaultValue);
}

export function templateFieldValue(field: BobEntityField, isPrimary: boolean, name: string): JsonValue {
  if (isPrimary) return name;
  const configured = resolveEntityFieldDefault(field);
  if (configured !== undefined) return configured;
  if (field.type === 'tags') return [];
  if (field.type === 'number' || field.type === 'currency') return 0;
  return '';
}

export function yamlTemplateLine(key: string, value: JsonValue): string {
  const serialized = obsidian.stringifyYaml({ [key]: value }).trim();
  return serialized || `${key}:`;
}

export function entityTemplate(entityKey: string, name: string): string {
  const def = ENTITIES[entityKey];
  const template = def?.template || WORKSPACE_CONFIG?.templates?.[entityKey];
  if (template) {
    const fields = Array.isArray(def?.fields) ? def.fields : [];
    const context = {
      name,
      title: name,
      today: ymd(),
      entityKey,
      label: def?.label || entityKey,
      plural: def?.plural || pluralizeEntityLabel(def?.label || entityKey),
    };
    return renderTemplateDocument(template, context, {
      frontmatter: (() => {
        const fallback: Frontmatter = {};
        const hasTypeField = fields.some((f) => f.key === 'type');
        if (!hasTypeField) fallback.type = def.typeFilter || entityKey;
        fields.forEach((f) => {
          fallback[f.key] = templateFieldValue(f, f.key === primaryFieldKey(def), name);
        });
        return fallback;
      })(),
      body: `# ${name}\n`,
    });
  }

  if (entityKey === 'project') return projectTemplate(name);

  const lines = ['---'];
  // Only write the meta `type: <entityKey>` tag if the entity doesn't already
  // define a `type` field of its own (e.g. Activity has type=Call/Email/...).
  // Otherwise we'd emit duplicate YAML keys and the file fails to parse.
  const hasTypeField = def.fields.some((f) => f.key === 'type');
  if (!hasTypeField) {
    lines.push(yamlTemplateLine('type', def.typeFilter || entityKey));
  }

  def.fields.forEach((f) => {
    lines.push(yamlTemplateLine(f.key, templateFieldValue(f, f.key === primaryFieldKey(def), name)));
  });
  lines.push('---', '', `# ${name}`, '', '');
  return lines.join('\n');
}

export function projectTemplate(name: string): string {
  const def = ENTITIES.project || {} as BobEntityDef;
  const template = def.template || WORKSPACE_CONFIG?.templates?.project;
  const projectId = normalizeProjectId(name) || 'untitled-project';
  const projectName = humanizeProjectName(name) || projectId;
  if (template) {
    return renderTemplateDocument(template, {
      name: projectName,
      title: projectName,
      project_id: projectId,
      project_name: projectName,
      today: ymd(),
      label: def.label || 'Project',
      plural: def.plural || 'Projects',
    }, {
      frontmatter: {
        type: 'project',
        project_id: projectId,
        project_name: projectName,
        status: 'active',
        priority: 'medium',
        owner: '',
        started: ymd(),
        due: '',
        tags: [],
        related_deals: [],
        related_partners: [],
      },
      body: [
        `# ${projectName}`,
        '',
        '## Brief',
        '_The outcome we want, why now._',
        '',
        '## Scope',
        '**In scope:**',
        '- ',
        '',
        '**Out of scope:**',
        '- ',
        '',
        '## Milestones',
        `- [ ] ${ymd()} — First milestone`,
        '',
        '## Tasks',
        '- [ ] ',
        '',
        '## Risks',
        '- ',
        '',
        '## Stakeholders',
        '- ',
        '',
        '## Notes',
        '',
        '',
      ],
    });
  }
  const today = ymd(new Date());
  return [
    '---',
    'type: project',
    `project_id: ${projectId}`,
    `project_name: ${projectName}`,
    'status: active',
    'priority: medium',
    'owner:',
    `started: ${today}`,
    'due:',
    'tags: []',
    'related_deals: []',
    'related_partners: []',
    '---',
    '',
    `# ${projectName}`,
    '',
    '## Brief',
    '_The outcome we want, why now._',
    '',
    '',
    '## Scope',
    '**In scope:**',
    '- ',
    '',
    '**Out of scope:**',
    '- ',
    '',
    '## Milestones',
    `- [ ] ${today} — First milestone`,
    '',
    '## Tasks',
    '- [ ] ',
    '',
    '## Risks',
    '- ',
    '',
    '## Stakeholders',
    '- ',
    '',
    '## Notes',
    '',
    '',
  ].join('\n');
}

/* Parse the H2 sections of a markdown file into a map. */
