import { isReadOnlyField, isStructuredValue, scalarFieldValue } from './field-values';
import { loadBundledXLSX } from './bundled/xlsx';
import { ENTITIES, primaryField } from './entities';
import { entityValue, listEntities, listEntityFiles } from './entity-files';
import { WORKBOOK_EXPORT_GROUPS } from './nav';
import { createEntity } from './notes';
import { DEFAULT_SETTINGS } from './settings';
import { ensureFolderSync, ymd } from './utils';
import { WORKSPACE_CONFIG, workspaceConfiguredEntityEntries, workspaceConfiguredEntityKeys } from './workspace-config';
import * as obsidian from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { XlsxLib, XlsxWorkbook } from './bundled/xlsx';
import type { BobEntityDef } from './entities';
import type { EntityDef, EntityField, PartialSettings, JsonValue } from './types';

/** Counters returned by the workbook import paths. */
interface WorkbookImportResult {
  created: number;
  updated: number;
  failed: number;
  sheets: number;
  skippedSheets: string[];
  errors: string[];
}

export let XLSX_LIB: XlsxLib | null = null;
export function getXLSX(app: App): XlsxLib {
  if (XLSX_LIB) return XLSX_LIB;
  // The SheetJS (mini) library is bundled into main.js via loadBundledXLSX so it
  // ships with every update — the vendor/ folder is not delivered by the Obsidian
  // installer, and fs/require against plugin paths is unreliable in the runtime.
  XLSX_LIB = loadBundledXLSX();
  if (!XLSX_LIB || !XLSX_LIB.utils) {
    throw new Error('Bundled XLSX library failed to initialize. Reinstall the plugin or rebuild it (npm run build).');
  }
  return XLSX_LIB;
}

export function safeSheetName(raw: unknown, used = new Set<string>()) {
  const base = String(raw || 'Sheet')
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n++;
  }
  used.add(name);
  return name;
}

export function workbookEntityKeyFromSheet(sheetName: string) {
  const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(sheetName);
  for (const [key, def] of workspaceConfiguredEntityEntries(WORKSPACE_CONFIG)) {
    if (n === norm(key) || n === norm(def.label) || n === norm(def.plural)) return key;
  }
  return null;
}

/** Tagged cells distinguish serialized values from ordinary JSON-looking text. */
export const WORKBOOK_VALUE_PREFIX = 'BOB:JSON:v1:';
export function xlsxCellValue(value: unknown) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' || (typeof value === 'string' && value.startsWith(WORKBOOK_VALUE_PREFIX))) {
    return WORKBOOK_VALUE_PREFIX + JSON.stringify(value);
  }
  return value;
}

function matchesImportedType(value: JsonValue, type: JsonValue): boolean {
  if (Array.isArray(type)) return type.some((itemType) => matchesImportedType(value, itemType));
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

export function validateImportedShape(value: JsonValue, field: EntityField, current?: unknown): void {
  const type = field.schemaType;
  const object = value != null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'object' && !object) throw new Error(`${field.key} requires an object`);
  if (type === 'array' && !Array.isArray(value)) throw new Error(`${field.key} requires an array`);
  if ((Array.isArray(current) && !Array.isArray(value))
      || (isStructuredValue(current) && !Array.isArray(current) && !object)) {
    throw new Error(`${field.key}: refusing to replace a structured value with a scalar`);
  }
  if (Array.isArray(value) && field.items?.type) {
    if (value.some((v) => !matchesImportedType(v, field.items.type))) {
      throw new Error(`${field.key}: invalid array item type`);
    }
  }
}

export function entityRowsForWorkbook(app: App, entityKey: string) {
  const def = ENTITIES[entityKey];
  if (!def) return [];
  // Exports include the full dataset: apply global/type/folder/filename
  // membership but ignore the selected Base *view*'s filter, so a narrow
  // display-view selection (e.g. a "Ready" view) never truncates the export.
  return listEntities(app, entityKey, { ignoreViewFilter: true }).map((entity) => {
    const row: Record<string, unknown> = {};
    row.file_path = entity.file.path;
    row.created = new Date(entity.file.stat.ctime).toISOString();
    row.modified = new Date(entity.file.stat.mtime).toISOString();
    def.fields.forEach((f) => {
      row[f.key] = xlsxCellValue(entityValue(entity, f.key, def));
    });
    return row;
  });
}

export function worksheetRowsForEntity(app: App, entityKey: string) {
  const def = ENTITIES[entityKey];
  const headers = ['file_path', 'created', 'modified', ...(def?.fields || []).map((f) => f.key)];
  const rows = entityRowsForWorkbook(app, entityKey);
  return rows.length ? rows : [Object.fromEntries(headers.map((h) => [h, '']))];
}

export async function writeWorkbookToVault(app: App, workbook: XlsxWorkbook, path: string) {
  const XLSX = getXLSX(app);
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  await ensureFolderSync(app, path.split('/').slice(0, -1).join('/'));
  await app.vault.adapter.writeBinary(path, data);
}

export function workbookExportFolder(settings: PartialSettings = {}) {
  return (settings.workbookExportFolder || DEFAULT_SETTINGS.workbookExportFolder || 'BOB Workspace/Exports')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function workbookExportGroups() {
  return WORKBOOK_EXPORT_GROUPS
    .map((group) => ({
      id: group.id,
      label: group.label,
      entityKeys: group.entityKeys.filter((key) => ENTITIES[key]),
    }))
    .filter((group) => group.entityKeys.length);
}

export function entityKeysForWorkbookGroups(groupIds: string[] | null | undefined) {
  const selected = new Set(groupIds || []);
  const keys: string[] = [];
  workbookExportGroups().forEach((group) => {
    if (!selected.has(group.id)) return;
    group.entityKeys.forEach((key) => {
      if (ENTITIES[key] && !keys.includes(key)) keys.push(key);
    });
  });
  return keys;
}

export function selectedWorkbookEntityKeys(groupIds: string[] | null | undefined) {
  if (!groupIds || !groupIds.length) return [];
  return entityKeysForWorkbookGroups(groupIds);
}

export async function exportEntitiesXLSX(app: App, entityKeys: string[] | null | undefined, suffix = '', settings: PartialSettings = {}) {
  const XLSX = getXLSX(app);
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const included = entityKeys?.length
    ? new Set(entityKeys)
    : workspaceConfiguredEntityKeys(WORKSPACE_CONFIG);
  const sortedEntities = [...included]
    .map((key) => [key, ENTITIES[key]] as [string, BobEntityDef])
    .filter(([, def]) => def)
    .sort(([, a], [, b]) => String(a.plural || a.label || '').localeCompare(String(b.plural || b.label || '')));
  if (!sortedEntities.length) throw new Error('No entities selected for export.');
  for (const [entityKey, def] of sortedEntities) {
    const rows = worksheetRowsForEntity(app, entityKey);
    const headers = ['file_path', 'created', 'modified', ...def.fields.map((f) => f.key)];
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(def.plural || entityKey, used));
  }
  const nameSuffix = suffix ? `-${suffix}` : '';
  const path = `${workbookExportFolder(settings)}/bob-workspace-export${nameSuffix}-${ymd()}.xlsx`;
  await writeWorkbookToVault(app, wb, path);
  return path;
}

export async function exportAllEntitiesXLSX(app: App, settings: PartialSettings = {}) {
  return exportEntitiesXLSX(app, null, '', settings);
}

/* Normalized-header lookup, built once per row object (WeakMap — rows are
   short-lived import data). The naive scan re-ran the normalizing regex over
   every column for every field lookup: a 5,000-row × 20-field × 20-column
   import approached millions of regex executions. */
const _rowHeaderMaps = new WeakMap<object, Map<string, string>>();
function rowHeaderMap(row: Record<string, unknown>): Map<string, string> {
  let map = _rowHeaderMaps.get(row);
  if (!map) {
    map = new Map();
    for (const k of Object.keys(row)) {
      const normalized = normalizedImportHeader(k);
      if (!map.has(normalized)) map.set(normalized, k);
    }
    _rowHeaderMaps.set(row, map);
  }
  return map;
}

export function rowValue(row: Record<string, unknown>, key: unknown) {
  const target = normalizedImportHeader(key);
  const original = rowHeaderMap(row).get(target);
  return original === undefined ? '' : row[original];
}

export function normalizedImportHeader(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function configuredFieldAliases(def: EntityDef | null | undefined) {
  const aliases: Record<string, string> = {};
  Object.entries(def?.fieldAliases || {}).forEach(([fieldKey, values]) => {
    if (!Array.isArray(values) || !def.fields?.some((field) => field.key === fieldKey)) return;
    values.forEach((value) => {
      const normalized = normalizedImportHeader(value);
      if (normalized) aliases[normalized] = fieldKey;
    });
  });
  return aliases;
}

export function rowValueForField(row: Record<string, unknown>, field: EntityField, def: EntityDef) {
  const candidates = [field.key, field.label, ...(def?.fieldAliases?.[field.key] || [])];
  for (const candidate of candidates) {
    const value = rowValue(row, candidate);
    if (value !== '') return value;
  }
  return '';
}

export function normalizeImportValue(value: unknown, field: EntityField): JsonValue {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.startsWith(WORKBOOK_VALUE_PREFIX)) {
    const decoded: JsonValue = JSON.parse(value.slice(WORKBOOK_VALUE_PREFIX.length));
    validateImportedShape(decoded, field);
    if (decoded != null && typeof decoded === 'object') {
      if (field.schemaType && !['object', 'array'].includes(field.schemaType)) throw new Error(`${field.key} is a scalar field`);
      return decoded;
    }
    if (typeof decoded === 'string' && !isReadOnlyField(field) && (!field.schemaType || field.schemaType === 'string')) return decoded;
    return decoded == null ? null : scalarFieldValue(String(decoded), field);
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    const decoded = value as JsonValue;
    validateImportedShape(decoded, field);
    return decoded;
  }
  let raw = String(value).trim();
  if (raw === '') return null;
  if (isReadOnlyField(field)) throw new Error(`${field.key}: structured imports require a BOB encoded cell`);
  if (field.type === 'date') {
    const d = value instanceof Date ? value : new Date(raw);
    if (isNaN(d.getTime())) throw new Error(`${field.key}: invalid date`);
    return d.toISOString().slice(0, 10);
  }
  if (field.type === 'tags') raw = raw.replace(/;/g, ',');
  return scalarFieldValue(raw, field);
}

export async function importEntityRows(app: App, entityKey: string, rows: Record<string, unknown>[]): Promise<{ created: number; updated?: number; failed: number; errors?: string[] }> {
  const def = ENTITIES[entityKey];
  if (!def) return { created: 0, failed: rows.length };
  const primary = primaryField(def);
  if (!primary) return { created: 0, failed: rows.length };
  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      const primaryValue = String(normalizeImportValue(rowValueForField(row, primary, def), primary) ?? '').trim();
      if (!primaryValue) throw new Error('Missing primary value');
      const explicitPath = String(rowValue(row, 'file_path') || '').trim();
      let file = explicitPath ? app.vault.getAbstractFileByPath(explicitPath) : null;
      if (explicitPath && (!(file instanceof obsidian.TFile) || file.extension !== 'md'
          || !listEntityFiles(app, entityKey, { ignoreViewFilter: true }).some((f) => f.path === file.path))) {
        throw new Error(`Import target is not a ${def.label} note: ${explicitPath}`);
      }
      const isUpdate = file instanceof obsidian.TFile;
      const values: Record<string, JsonValue> = {};
      def.fields.forEach((field) => {
        const raw = rowValueForField(row, field, def);
        // Blank and missing columns leave existing values alone; encoded []/{} are explicit values.
        if (raw == null || raw === '') return;
        values[field.key] = normalizeImportValue(raw, field);
      });
      if (!isUpdate) file = await createEntity(app, entityKey, primaryValue, { values });
      await app.fileManager.processFrontMatter(file as TFile, (fm) => {
        // Validate every write before applying any of them; recheck the current note shape.
        def.fields.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(values, field.key)) validateImportedShape(values[field.key], field, fm[field.key]);
        });
        Object.entries(values).forEach(([key, value]) => { if (value != null) fm[key] = value; });
      });
      if (isUpdate) updated++;
      else created++;
    } catch (error) {
      failed++;
      errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { created, updated, failed, errors };
}

export async function importWorkbookEntities(app: App, file: TFile) {
  const XLSX = getXLSX(app);
  const data = await app.vault.readBinary(file);
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const result: WorkbookImportResult = { created: 0, updated: 0, failed: 0, sheets: 0, skippedSheets: [], errors: [] };
  for (const sheetName of wb.SheetNames) {
    const entityKey = workbookEntityKeyFromSheet(sheetName);
    if (!entityKey) {
      result.skippedSheets.push(sheetName);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
    const nonEmptyRows = rows.filter((row) => Object.values(row).some((v) => String(v || '').trim()));
    const imported = await importEntityRows(app, entityKey, nonEmptyRows);
    result.created += imported.created;
    result.updated += imported.updated || 0;
    result.failed += imported.failed;
    result.errors.push(...(imported.errors || []).map((error) => `${sheetName}: ${error}`));
    result.sheets++;
  }
  return result;
}

export async function promptImportWorkbook(app: App, onDone: (result: WorkbookImportResult) => unknown = () => {}) {
  const workbookFiles = app.vault.getFiles().filter((f) => {
    const p = f.path.toLowerCase();
    return p.endsWith('.xlsx') || p.endsWith('.xlsm') || p.endsWith('.xlsb') || p.endsWith('.xls');
  });
  if (!workbookFiles.length) {
    new obsidian.Notice('No Excel workbooks found in vault.');
    return;
  }
  const picker = new (class extends obsidian.SuggestModal<TFile> {
    files: TFile[];
    onPick: (file: TFile) => void;
    constructor(app: App, files: TFile[], onPick: (file: TFile) => void) { super(app); this.files = files; this.onPick = onPick; this.setPlaceholder('Import workbook…'); }
    getSuggestions(q: string) { return this.files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase())); }
    renderSuggestion(file: TFile, el: HTMLElement) { el.setText(file.path); }
    onChooseSuggestion(file: TFile) { this.onPick(file); }
  })(app, workbookFiles, async (file) => {
    try {
      const result = await importWorkbookEntities(app, file);
      await onDone(result);
      if (result.errors.length) new obsidian.Notice(result.errors.slice(0, 3).join('\n'), 10000);
      const skipped = result.skippedSheets.length ? ` · skipped sheets: ${result.skippedSheets.join(', ')}` : '';
      new obsidian.Notice(`BOB Workspace: imported ${result.created} created, ${result.updated || 0} updated from ${result.sheets} sheet${result.sheets === 1 ? '' : 's'}${result.failed ? ` · ${result.failed} skipped` : ''}${skipped}`, 8000);
    } catch (e) {
      new obsidian.Notice(`BOB Workspace: XLSX import failed — ${e.message}`, 8000);
    }
  });
  picker.open();
}

/* ─────────── CSV import modal ─────────── */
