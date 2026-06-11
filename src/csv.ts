import { ENTITIES } from './entities';
import { ymd } from './utils';
import type { EntityDef, EntityField } from './types';
export function parseCSV(text: string): string[][] {
  if (!text) return [];
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuote = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuote = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      row.push(field); rows.push(row); row = []; field = '';
      i += (text[i + 1] === '\n') ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Drop trailing empty row(s)
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sampleValueForField(field: EntityField, def: EntityDef, idx: number): string {
  const type = field.type || 'text';
  if (idx === 0 || field.primary) return `Example ${def.label}`;
  if (type === 'email') return 'name@example.com';
  if (type === 'number') return '10';
  if (type === 'currency') return '1000';
  if (type === 'date') return ymd();
  if (type === 'enum') return (field.options || [])[0] || '';
  if (type === 'tags') return 'tag1; tag2';
  return `Example ${field.label || field.key}`;
}

export function csvTemplateForEntity(entityKey: string): string {
  const def: EntityDef = ENTITIES[entityKey];
  const fields: EntityField[] = def?.fields || [];
  const headers = fields.map((f) => f.key);
  const example = fields.map((f, i) => sampleValueForField(f, def, i));
  return `${headers.map(csvEscape).join(',')}\n${example.map(csvEscape).join(',')}\n`;
}

