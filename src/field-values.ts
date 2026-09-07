import type { EntityField, Frontmatter, JsonValue } from './types';

/** Structured values never pass through a scalar text editor. */
export function isStructuredValue(val: unknown): boolean {
  if (val == null || val instanceof Date) return false;
  if (Array.isArray(val)) return val.some((item) => item != null && typeof item === 'object' && !(item instanceof Date));
  return typeof val === 'object';
}

export function isReadOnlyField(field: EntityField, current?: unknown): boolean {
  return field.type === 'structured' || field.schemaType === 'object'
    || (field.schemaType === 'array' && (field.type !== 'tags' || field.items?.type !== 'string'))
    || isStructuredValue(current) || (Array.isArray(current) && field.type !== 'tags');
}

/** Empty means clear; zero/false remain real values; invalid input must not write. */
export function scalarFieldValue(raw: string, field: EntityField, current?: unknown): JsonValue {
  if (isReadOnlyField(field, current)) throw new Error('Structured field — edit this in the note frontmatter');
  if (raw.trim() === '') return null;
  if (field.type === 'boolean' || field.schemaType === 'boolean' || typeof current === 'boolean') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`${field.label || field.key} must be true or false`);
  }
  if (field.type === 'number' || field.type === 'currency' || field.schemaType === 'integer') {
    const value = Number(raw);
    if (!Number.isFinite(value) || (field.schemaType === 'integer' && !Number.isInteger(value))) {
      throw new Error(`${field.label || field.key} must be a valid ${field.schemaType === 'integer' ? 'integer' : 'number'}`);
    }
    return value;
  }
  if (field.type === 'tags') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
}

/** Recheck live frontmatter inside processFrontMatter, not just the render snapshot. */
export function writeScalarField(fm: Frontmatter, field: EntityField, raw: string): void {
  const value = scalarFieldValue(raw, field, fm[field.key]);
  if (value == null || (Array.isArray(value) && !value.length)) delete fm[field.key];
  else fm[field.key] = value;
}

export function matchesEnumSelection(value: unknown, selected?: Set<string>): boolean {
  return selected === undefined || selected.has(String(value ?? ''));
}
