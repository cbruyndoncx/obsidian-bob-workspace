import { loadBundledXLSX } from './bundled/xlsx';
import { ENTITIES, primaryField } from './entities';
import { entityValue, listEntities } from './entity-files';
import { WORKBOOK_EXPORT_GROUPS } from './nav';
import { createEntity } from './notes';
import { DEFAULT_SETTINGS } from './settings';
import { ensureFolderSync, ymd } from './utils';
import { WORKSPACE_CONFIG, workspaceConfiguredEntityEntries, workspaceConfiguredEntityKeys } from './workspace-config';
import * as obsidian from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { XlsxLib, XlsxWorkbook } from './bundled/xlsx';
import type { BobEntityDef } from './entities';
import type { EntityDef, EntityField, PartialSettings } from './types';

/** Counters returned by the workbook import paths. */
interface WorkbookImportResult {
  created: number;
  updated: number;
  failed: number;
  sheets: number;
  skippedSheets: string[];
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

export function xlsxCellValue(value: unknown) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function entityRowsForWorkbook(app: App, entityKey: string) {
  const def = ENTITIES[entityKey];
  if (!def) return [];
  return listEntities(app, entityKey).map((entity) => {
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

export function rowValue(row: Record<string, unknown>, key: unknown) {
  const target = normalizedImportHeader(key);
  for (const [k, v] of Object.entries(row)) {
    if (normalizedImportHeader(k) === target) return v;
  }
  return '';
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

export function normalizeImportValue(value: unknown, field: EntityField) {
  let val = value == null ? '' : value;
  if (typeof val === 'string') val = val.trim();
  if (val === '') return null;
  if (field.type === 'number' || field.type === 'currency') {
    const n = Number(String(val).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  }
  if (field.type === 'tags') {
    if (Array.isArray(val)) return val.filter(Boolean);
    const tags = String(val).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    return tags.length ? tags : null;
  }
  if (field.type === 'date') {
    if (val instanceof Date && !isNaN(val.getTime())) return val.toISOString().slice(0, 10);
    const d = new Date(val as string | number);
    return isNaN(d.getTime()) ? String(val) : d.toISOString().slice(0, 10);
  }
  return val;
}

export async function importEntityRows(app: App, entityKey: string, rows: Record<string, unknown>[]): Promise<{ created: number; updated?: number; failed: number }> {
  const def = ENTITIES[entityKey];
  if (!def) return { created: 0, failed: rows.length };
  const primary = primaryField(def);
  if (!primary) return { created: 0, failed: rows.length };
  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const primaryValue = String(rowValueForField(row, primary, def) || '').trim();
    if (!primaryValue) { failed++; continue; }
    try {
      const explicitPath = String(rowValue(row, 'file_path') || '').trim();
      let file = explicitPath ? app.vault.getAbstractFileByPath(explicitPath) : null;
      let isUpdate = file instanceof obsidian.TFile;
      if (!isUpdate) file = await createEntity(app, entityKey, primaryValue, { values: row });
      await app.fileManager.processFrontMatter(file as TFile, (fm) => {
        def.fields.forEach((field) => {
          if (field.key === primary.key) return;
          const imported = normalizeImportValue(rowValueForField(row, field, def), field);
          if (imported == null || imported === '') return;
          if (Array.isArray(imported) && !imported.length) return;
          fm[field.key] = imported;
        });
      });
      if (isUpdate) updated++;
      else created++;
    } catch (_) {
      failed++;
    }
  }
  return { created, updated, failed };
}

export async function importWorkbookEntities(app: App, file: TFile) {
  const XLSX = getXLSX(app);
  const data = await app.vault.readBinary(file);
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const result: WorkbookImportResult = { created: 0, updated: 0, failed: 0, sheets: 0, skippedSheets: [] };
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
      const skipped = result.skippedSheets.length ? ` · skipped sheets: ${result.skippedSheets.join(', ')}` : '';
      new obsidian.Notice(`BOB Workspace: imported ${result.created} created, ${result.updated || 0} updated from ${result.sheets} sheet${result.sheets === 1 ? '' : 's'}${result.failed ? ` · ${result.failed} skipped` : ''}${skipped}`, 8000);
    } catch (e) {
      new obsidian.Notice(`BOB Workspace: XLSX import failed — ${e.message}`, 8000);
    }
  });
  picker.open();
}

/* ─────────── CSV import modal ─────────── */
