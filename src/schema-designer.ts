import { ENTITIES } from './entities';
import { listEntityFiles, resolveEntityFieldDefault } from './entity-files';
import { cloneConfig } from './nav';
import { SCHEMA_FOLDER_DEFAULT, SCHEMA_TO_ENTITY_KEY, pluralizeEntityLabel, schemaFieldLabel } from './schemas';
import { entityFolder } from './settings';
import { ensureFolderSync } from './utils';
import { WORKSPACE_CONFIG, addConfiguredEntityKey, workspaceConfiguredEntityKeys } from './workspace-config';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import type { BobEntityDef, BobEntityField } from './entities';
import type { JsonValue, PartialSettings, WorkspaceConfig } from './types';

/** Canonical source-schema YAML shape edited by the Data model designer. */
export interface SourceSchemaField {
  name: string;
  type?: string;
  format?: string;
  label?: string;
  description?: string;
  required?: boolean;
  enum?: JsonValue[];
  default?: JsonValue;
  bob_type?: string;
  /** Explicit item schema for array fields; absent means "any item shape". */
  items?: Record<string, JsonValue>;
}

export interface SourceSchema {
  entity: string;
  label?: string;
  plural?: string;
  icon?: string;
  type_value?: string;
  location_pattern?: string;
  key_fields?: string[];
  fields?: SourceSchemaField[];
  field_aliases?: Record<string, string[]>;
  co_required?: string[][];
  discriminator?: Record<string, JsonValue>;
  status_lifecycle?: string[];
  description?: string;
  scope?: string;
  /**
   * Free prose rendered inside the entity's DATAMODEL-FULL block, after the field table.
   * Some statements are about the entity as a whole and no field row can carry them --
   * `payment-card` documents that PAN/CVV/PIN are never stored, which is a security
   * boundary, not a property of any one field.
   *
   * Must stay in step with the vault-side generator (`00-CORE/Schemas/regenerate.py`,
   * `Entity.notes`). Both write the same ENTITY DEFINITIONS block, so a key one renders
   * and the other does not means whichever ran last silently deletes the other's output.
   */
  notes?: string;
  bob?: Record<string, JsonValue>;
}

export interface LoadedSchemaSource {
  path: string;
  schema: SourceSchema;
}

interface BootstrapOpts {
  includeFallback?: boolean;
  includeVaultEntities?: boolean;
}

export function schemaFieldFromEntityField(field: BobEntityField & { description?: string }): SourceSchemaField {
  const type = String(field?.type || 'string').toLowerCase();
  const result: SourceSchemaField = {
    name: field.key,
    type: type === 'number' || type === 'currency' ? 'number'
      : type === 'integer' ? 'integer'
      : type === 'boolean' ? 'boolean'
      : type === 'array' || type === 'tags' ? 'array'
      : 'string',
    required: !!field.primary,
  };
  if (type === 'date') result.format = 'date';
  else if (type === 'datetime' || type === 'date-time') result.format = 'date-time';
  else if (type === 'email') result.format = 'email';
  if (type === 'enum' && Array.isArray(field.options)) result.enum = field.options;
  if (Object.prototype.hasOwnProperty.call(field || {}, 'defaultValue')) {
    const defaultValue = resolveEntityFieldDefault(field);
    if (defaultValue !== undefined) result.default = defaultValue;
  }
  if (field.description) result.description = field.description;
  return result;
}

export function entityLocationPattern(def: BobEntityDef, entityKey: string): string {
  const patterns: string[] = [];
  if (Array.isArray(def?.folders) && def.folders.length) patterns.push(...def.folders);
  else if (String(def?.folder || '').trim()) patterns.push(def.folder);
  if (!patterns.length && entityKey) {
    const folder = entityFolder(entityKey);
    if (folder) patterns.push(folder);
  }
  return [...new Set(patterns.map((pattern) => String(pattern || '').trim().replace(/\/$/, '')).filter(Boolean))].join(' or ');
}

export function schemaFieldArrayFromEntityFields(fields: BobEntityField[] = []): SourceSchemaField[] {
  return fields
    .filter((field) => field && field.key && field.key !== 'type')
    .map((field) => schemaFieldFromEntityField(field))
    .filter((field) => field && field.name);
}

export function schemaBobBlockFromEntityDefinition(def: BobEntityDef = {}): Record<string, JsonValue> {
  const bob: Record<string, JsonValue> = {};
  [
    'stageField',
    'valueField',
    'closeByField',
    'wonStages',
    'lostStages',
    'detailMetaFields',
    'detailSections',
    'terminalStatuses',
    'stageConfidence',
    'template',
    'folders',
    'dateField',
    'titleField',
    'baseFilters',
    'baseSort',
    'baseGroupBy',
    'baseView',
    'externalBaseView',
    'unsupportedBaseFilters',
    'unsupportedBaseFeatures',
    'desc',
    'description',
    'scope',
  ].forEach((key) => {
    if ((def as Record<string, JsonValue | undefined>)[key] != null) bob[key] = cloneConfig((def as Record<string, JsonValue | undefined>)[key]);
  });
  if (def.fieldAliases) bob.field_aliases = cloneConfig(def.fieldAliases);
  return bob;
}

export function schemaSourceFromEntityDefinition(entityKey: string, def: BobEntityDef = ENTITIES[entityKey] || {}): SourceSchema {
  const fields = schemaFieldArrayFromEntityFields(def.fields || []);
  const primaryField = fields.find((field) => field.required)?.name || def.titleField || fields[0]?.name || '';
  const schema: SourceSchema = {
    entity: entityKey,
    label: def.label || schemaFieldLabel(entityKey),
    plural: def.plural || pluralizeEntityLabel(def.label || schemaFieldLabel(entityKey)),
    icon: def.icon || 'file-text',
    location_pattern: entityLocationPattern(def, entityKey),
    fields,
  };
  const typeValue = def.filenameFilter ? '' : String(def.typeFilter || entityKey || '').trim();
  if (typeValue) schema.type_value = typeValue;
  if (primaryField) schema.key_fields = [primaryField];
  if (def.desc || def.description) schema.description = def.desc || def.description;
  if (def.fieldAliases && Object.keys(def.fieldAliases).length) schema.field_aliases = cloneConfig(def.fieldAliases);
  const bob = schemaBobBlockFromEntityDefinition(def);
  if (Object.keys(bob).length) schema.bob = bob;
  return schema;
}

export function bootstrapSchemaEntityKeys(app: App | null, config: WorkspaceConfig = WORKSPACE_CONFIG, opts: BootstrapOpts = {}): string[] {
  const keys = new Set(workspaceConfiguredEntityKeys(config, Object.assign({ includeFallback: false }, opts)));
  if (!keys.size) {
    Object.keys(ENTITIES).forEach((key) => addConfiguredEntityKey(keys, key));
  }
  if (app && opts.includeVaultEntities !== false) {
    Object.keys(ENTITIES).forEach((key) => {
      try {
        if (listEntityFiles(app, key).length) addConfiguredEntityKey(keys, key);
      } catch (_) { /* a misconfigured entity is skipped so the rest still enumerate */ }
    });
  }
  return [...keys]
    .filter((key) => !!ENTITIES[key])
    .sort((a, b) => String(ENTITIES[a]?.plural || ENTITIES[a]?.label || a).localeCompare(String(ENTITIES[b]?.plural || ENTITIES[b]?.label || b)));
}

export async function bootstrapCanonicalSchemaSources(app: App, settings: PartialSettings = {}, opts: BootstrapOpts = {}) {
  const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  await ensureFolderSync(app, folder);
  const keys = bootstrapSchemaEntityKeys(app, WORKSPACE_CONFIG, opts);
  const written: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const entityKey of keys) {
    const def = ENTITIES[entityKey];
    if (!def) continue;
    const schemaPath = `${folder}/${entityKey}.yaml`;
    // A single entity whose generated schema is incomplete (e.g. a schema/workspace
    // derived record type with no resolvable folder -> empty location_pattern) must
    // not abort the whole bootstrap, which would block "Save and apply" entirely.
    let schema: SourceSchema;
    try {
      schema = validateSourceSchemaDefinition(schemaSourceFromEntityDefinition(entityKey, def));
    } catch (e) {
      failed.push(`${entityKey}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (await app.vault.adapter.exists(schemaPath)) {
      skipped.push(schemaPath);
      continue;
    }
    await app.vault.adapter.write(schemaPath, `${obsidian.stringifyYaml(schema)}\n`);
    written.push(schemaPath);
  }
  return {
    folder,
    count: written.length,
    skipped: skipped.length,
    written,
    skippedPaths: skipped,
    entityKeys: keys,
    failed,
  };
}

export async function bootstrapCanonicalSchemaSourcesIfMissing(app: App, settings: PartialSettings = {}, opts: BootstrapOpts = {}) {
  // The gate only needs to know whether ANY schema YAML exists — the old
  // probe read + parsed + validated every schema file, and the reload path
  // then re-read them all again in applySchemas (double folder scan on every
  // configuration reload). A cheap filename listing answers the same
  // question; any .yaml present (even an invalid one) keeps the bootstrap
  // gated so it never writes the built-in set next to a user's own schemas.
  // No caller consumes entityKeys from the already-present result.
  const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  let hasSchemaFiles = false;
  if (await app.vault.adapter.exists(folder)) {
    const listed = await app.vault.adapter.list(folder);
    hasSchemaFiles = (listed.files || []).some((file) => /\.ya?ml$/i.test(file));
  }
  if (hasSchemaFiles) return {
    folder,
    count: 0,
    skipped: 0,
    written: [],
    skippedPaths: [],
    entityKeys: [] as string[],
    failed: [] as string[],
    alreadyPresent: true,
  };
  const result = await bootstrapCanonicalSchemaSources(app, settings, opts);
  return Object.assign({ alreadyPresent: false }, result);
}

export function validateSourceSchemaDefinition(schema: SourceSchema): SourceSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Schema must be an object');
  }
  (['entity', 'label', 'location_pattern'] as const).forEach((key) => {
    if (!String(schema[key] || '').trim()) throw new Error(`Schema needs ${key}`);
  });
  const entityKey = SCHEMA_TO_ENTITY_KEY[schema.entity] || schema.entity;
  if (!String(schema.type_value || '').trim() && !ENTITIES[entityKey]?.filenameFilter) {
    throw new Error('Schema needs type_value unless the record type is filename-backed');
  }
  if (!Array.isArray(schema.fields) || !schema.fields.length) {
    throw new Error('Schema needs at least one field');
  }
  const fieldNames = new Set<string>();
  schema.fields.forEach((field, index) => {
    const name = String(field?.name || '').trim();
    if (!name) throw new Error(`Field ${index + 1} needs a name`);
    if (fieldNames.has(name)) throw new Error(`Duplicate field "${name}"`);
    fieldNames.add(name);
    // `object` is legal in the canonical vault datamodel (kpi.thresholds,
    // model-card.certification_evidence, …) — rejecting it made regeneration
    // fail against a healthy vault. Metadata Menu edits it as raw Input.
    if (!['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(field.type)) {
      throw new Error(`Field "${name}" has unsupported type "${field.type}"`);
    }
    if (field.enum != null && !Array.isArray(field.enum)) {
      throw new Error(`Field "${name}" enum must be a list`);
    }
    if (field.default != null && Array.isArray(field.enum) && !field.enum.includes(field.default)) {
      throw new Error(`Field "${name}" default must be one of its enum values`);
    }
    if (field.default != null && field.type === 'array' && !Array.isArray(field.default)) {
      throw new Error(`Field "${name}" default must be a list`);
    }
    if (field.default != null && (field.type === 'number' || field.type === 'integer') &&
        typeof field.default !== 'number') {
      throw new Error(`Field "${name}" default must be a number`);
    }
    if (field.default != null && field.type === 'boolean' && typeof field.default !== 'boolean') {
      throw new Error(`Field "${name}" default must be true or false`);
    }
  });
  (schema.key_fields || []).forEach((name) => {
    if (!fieldNames.has(name)) throw new Error(`Key field "${name}" is not defined in fields`);
  });
  (schema.co_required || []).forEach((pair) => {
    if (!Array.isArray(pair) || pair.length < 2 || pair.some((name) => !fieldNames.has(name))) {
      throw new Error('Every co-required relationship must name two or more defined fields');
    }
  });
  if (schema.discriminator != null &&
      (!schema.discriminator || typeof schema.discriminator !== 'object' || Array.isArray(schema.discriminator))) {
    throw new Error('discriminator must be an object');
  }
  if (schema.field_aliases != null) {
    if (!schema.field_aliases || typeof schema.field_aliases !== 'object' || Array.isArray(schema.field_aliases)) {
      throw new Error('field_aliases must be an object keyed by field name');
    }
    const normalizedAliases = new Map<string, string>();
    schema.fields.forEach((field) => {
      [field.name, field.label].filter(Boolean).forEach((name) => {
        const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalized && !normalizedAliases.has(normalized)) normalizedAliases.set(normalized, field.name);
      });
    });
    Object.entries(schema.field_aliases).forEach(([name, aliases]) => {
      if (!fieldNames.has(name)) throw new Error(`Field aliases reference undefined field "${name}"`);
      if (!Array.isArray(aliases) || aliases.some((alias) => !String(alias || '').trim())) {
        throw new Error(`Field aliases for "${name}" must be a list of non-empty names`);
      }
      aliases.forEach((alias) => {
        const normalized = String(alias).toLowerCase().replace(/[^a-z0-9]/g, '');
        const existing = normalizedAliases.get(normalized);
        if (existing && existing !== name) {
          throw new Error(`Field alias "${alias}" conflicts with field "${existing}"`);
        }
        normalizedAliases.set(normalized, name);
      });
    });
  }
  if (schema.bob != null && (!schema.bob || typeof schema.bob !== 'object' || Array.isArray(schema.bob))) {
    throw new Error('BOB behavior JSON must be a JSON object');
  }
  return schema;
}

export function editableSchemaFieldType(field: SourceSchemaField): string {
  if (Array.isArray(field.enum)) return 'enum';
  if (field.type === 'string' && field.format === 'date') return 'date';
  if (field.type === 'string' && field.format === 'date-time') return 'datetime';
  return field.type || 'string';
}

export function applyEditableSchemaFieldType(field: SourceSchemaField, value: string): void {
  delete field.format;
  if (value !== 'enum') delete field.enum;
  if (value === 'enum') {
    field.type = 'string';
    if (!Array.isArray(field.enum)) field.enum = [];
  } else if (value === 'date' || value === 'datetime') {
    field.type = 'string';
    field.format = value === 'date' ? 'date' : 'date-time';
  } else {
    field.type = value;
  }
}

export function editableSchemaFieldDefault(field: SourceSchemaField): string {
  if (!Object.prototype.hasOwnProperty.call(field || {}, 'default')) return '';
  return Array.isArray(field.default) ? field.default.join(', ') : String(field.default);
}

export function applyEditableSchemaFieldDefault(field: SourceSchemaField, value: string): void {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    delete field.default;
    return;
  }
  if (field.type === 'array') {
    field.default = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    return;
  }
  if (field.type === 'number' || field.type === 'integer') {
    const number = Number(trimmed);
    field.default = Number.isFinite(number) ? number : trimmed;
    return;
  }
  if (field.type === 'boolean') {
    field.default = trimmed.toLowerCase() === 'true' ? true
      : trimmed.toLowerCase() === 'false' ? false
      : trimmed;
    return;
  }
  field.default = trimmed;
}

export async function loadCanonicalSchemaSources(app: App, settings: PartialSettings = {}) {
  const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  if (!await app.vault.adapter.exists(folder)) return { folder, schemas: [], errors: [] };
  const listed = await app.vault.adapter.list(folder);
  const schemas: LoadedSchemaSource[] = [];
  const errors: string[] = [];
  for (const path of (listed.files || []).filter((file) => /\.ya?ml$/i.test(file))) {
    try {
      const schema = validateSourceSchemaDefinition(obsidian.parseYaml(await app.vault.adapter.read(path)));
      schemas.push({ path, schema });
    } catch (e) {
      errors.push(`${path}: ${e.message}`);
    }
  }
  return { folder, schemas, errors };
}

export function stableSchemaId(value: unknown): string {
  let hash = 5381;
  for (const character of String(value || '')) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function metadataMenuFieldType(field: SourceSchemaField): string {
  if (Array.isArray(field.enum)) return 'Select';
  if (field.type === 'array') return 'Multi';
  if (field.type === 'boolean') return 'Boolean';
  if (field.type === 'number' || field.type === 'integer') return 'Number';
  if (field.format === 'date') return 'Date';
  return 'Input';
}

export function sourceSchemaToJsonSchema(schema: SourceSchema) {
  const schemaId = schema.type_value || schema.entity;
  const properties: Record<string, Record<string, JsonValue>> = {};
  const required: string[] = [];
  (schema.fields || []).forEach((field) => {
    const property: Record<string, JsonValue> = { type: field.type || 'string' };
    if (field.format) property.format = field.format;
    if (Array.isArray(field.enum) && field.enum.length) property.enum = field.enum;
    if (field.description) property.description = field.description;
    if (Object.prototype.hasOwnProperty.call(field, 'default')) property.default = field.default;
    // Only constrain array items when the SOURCE says so. Defaulting to
    // {type:'string'} silently narrowed every array in the vault: steps, flows,
    // blockedBy, authors and line_items all hold objects, so a regeneration
    // turned 33 healthy notes invalid at once. An array with no declared item
    // schema accepts any item shape — same as regenerate.py.
    if (field.type === 'array' && field.items) property.items = field.items;
    properties[field.name] = property;
    if (field.required) required.push(field.name);
  });
  if (schema.type_value && properties.type) properties.type = { const: schema.type_value };
  if (schema.discriminator) Object.entries(schema.discriminator).forEach(([key, value]) => {
    properties[key] = Object.assign({}, properties[key] || { type: 'string' }, { const: value });
    if (!required.includes(key)) required.push(key);
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://brn.cx/schemas/${schemaId}.schema.json`,
    title: `${schemaId} frontmatter schema`,
    type: 'object',
    properties,
    required,
    additionalProperties: true,
    ...(Array.isArray(schema.co_required) && schema.co_required.length
      ? {
          dependentRequired: Object.assign({}, ...schema.co_required.flatMap((pair) =>
            pair.map((field) => ({ [field]: pair.filter((other) => other !== field) }))
          )),
        }
      : {}),
  };
}

export function sourceSchemaToFileClass(schema: SourceSchema): string {
  const fields = (schema.fields || []).map((field) => {
    const config: { name: string; type: string; id: string; path: string; options?: Array<Record<string, JsonValue>>; required?: boolean } = {
      name: field.name,
      type: metadataMenuFieldType(field),
      // Keyed by type_value to match the vault generator's field ids — do not
      // fall back to entity here or merged/divergent types get different ids.
      id: stableSchemaId(`${schema.type_value || schema.entity}:${field.name}`),
      path: '',
    };
    if (Array.isArray(field.enum) && field.enum.length) {
      config.options = field.enum.map((value, index) => ({ [index]: value }));
    }
    if (field.required) config.required = true;
    return config;
  });
  const yaml = {
    fileClass: schema.type_value || schema.entity,
    version: '1.0',
    mapWithTag: false,
    // Deliberately empty — Metadata Menu binds via fileClassAlias "type", not by
    // path. location_pattern holds placeholders and "A or B" alternatives meant
    // for routing validation, not literal path matching, and a broad prefix like
    // `20-COMPANY/` would attach a fallback FileClass to every child note.
    filesPaths: [] as string[],
    fields,
    ...(schema.description ? { description: schema.description } : {}),
  };
  return `---\n${obsidian.stringifyYaml(yaml)}---\n\n# ${schema.label}\n\nGenerated from canonical schema source. Edit the source YAML in BOB Workspace settings.\n`;
}

/**
 * Merge the schemas that share one note-facing `type:` value into a single
 * synthetic SourceSchema, keyed by that value.
 *
 * Generated outputs (fileClass + JSON Schema) must be named by `type_value`:
 * that is how every consumer resolves them — frontmatter validators load
 * `{type}.schema.json`, and Metadata Menu with `fileClassAlias: "type"` binds a
 * note to `fileClasses/{type}.md`. Keying by entity left divergent entities'
 * fileClasses unreachable, and entities sharing a type (research +
 * regional-context) silently clobbered each other's outputs last-wins.
 *
 * Merge semantics mirror the vault's regenerate.py: first schema wins per
 * field, `required` only where required in every schema of the group,
 * locations unioned. Discriminator constants are dropped for merged groups —
 * a shared-type schema must accept every subtype.
 */
export function mergedSchemaForKey(key: string, schemas: SourceSchema[]): SourceSchema {
  if (schemas.length === 1 && schemas[0].entity === key) return schemas[0];
  const requiredInAll = (name: string) =>
    schemas.every((s) => (s.fields || []).some((f) => f.name === name && f.required));
  const fields: SourceSchemaField[] = [];
  const seen = new Set<string>();
  for (const s of schemas) {
    for (const f of s.fields || []) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      fields.push({ ...f, required: requiredInAll(f.name) });
    }
  }
  const locations = [...new Set(schemas.map((s) => String(s.location_pattern || '').trim()).filter(Boolean))];
  return {
    ...schemas[0],
    entity: key,
    type_value: key,
    label: [...new Set(schemas.map((s) => s.label || s.entity))].sort().join(' / '),
    description: schemas.find((s) => s.description)?.description,
    location_pattern: locations.join(' or '),
    fields,
    discriminator: schemas.length > 1 ? undefined : schemas[0].discriminator,
    co_required: schemas.flatMap((s) => (Array.isArray(s.co_required) ? s.co_required : [])),
  };
}

export async function regenerateSchemaOutputs(app: App, settings: PartialSettings = {}, opts: { allowLossy?: boolean } = {}) {
  const allowLossy = opts.allowLossy === true;
  const loaded = await loadCanonicalSchemaSources(app, settings);
  if (loaded.errors.length) throw new Error(`Schema validation failed: ${loaded.errors.join('; ')}`);
  const root = loaded.folder.replace(/\/source$/, '');
  const fileClassFolder = `${root}/fileClasses`;
  const jsonFolder = `${root}/json-schema`;
  await ensureFolderSync(app, fileClassFolder);
  await ensureFolderSync(app, jsonFolder);
  const expectedFileClasses = new Set<string>();
  const expectedJsonSchemas = new Set<string>();
  // The generated outputs are deterministic, so most regenerations are no-ops.
  // Skip byte-identical writes: every adapter.write fires a vault event that
  // re-indexes the file in metadataCache and invalidates the plugin's scan
  // cache — rewriting ~2 files per schema unconditionally churned the whole
  // vault indexer on every regeneration.
  const writeIfChanged = async (path: string, content: string) => {
    try {
      if (await app.vault.adapter.exists(path) && await app.vault.adapter.read(path) === content) return;
    } catch (_) { /* unreadable — fall through and rewrite */ }
    await app.vault.adapter.write(path, content);
  };
  // Group by the note-facing `type:` value — all generated outputs are keyed by
  // it (see mergedSchemaForKey). Entities sharing a type merge into one output.
  const byType = new Map<string, SourceSchema[]>();
  for (const { schema } of loaded.schemas) {
    const key = schema.type_value || schema.entity;
    byType.set(key, [...(byType.get(key) || []), schema]);
  }
  for (const [key, group] of byType) {
    const merged = mergedSchemaForKey(key, group);
    const fileClassPath = `${fileClassFolder}/${key}.md`;
    const jsonSchemaPath = `${jsonFolder}/${key}.schema.json`;
    expectedFileClasses.add(fileClassPath);
    expectedJsonSchemas.add(jsonSchemaPath);
    await writeIfChanged(fileClassPath, sourceSchemaToFileClass(merged));
    await writeIfChanged(jsonSchemaPath, `${JSON.stringify(sourceSchemaToJsonSchema(merged), null, 2)}\n`);
  }
  let removed = 0;
  for (const folder of [
    { path: fileClassFolder, expected: expectedFileClasses, suffix: '.md' },
    { path: jsonFolder, expected: expectedJsonSchemas, suffix: '.schema.json' },
  ]) {
    const listed = await app.vault.adapter.list(folder.path);
    for (const path of listed.files || []) {
      if (!path.endsWith(folder.suffix) || folder.expected.has(path)) continue;
      await app.vault.adapter.remove(path);
      removed++;
    }
  }
  const sortedSchemas = [...loaded.schemas].sort((a, b) =>
    (a.schema.label || a.schema.entity).localeCompare(b.schema.label || b.schema.entity));
  let datamodelUpdated = 0;
  if (await injectGeneratedSection(app, 'DATAMODEL.md',
    '<!-- BEGIN GENERATED: ENTITY TYPES -->', '<!-- END GENERATED: ENTITY TYPES -->',
    generateEntityTypesTable(sortedSchemas))) datamodelUpdated++;

  // DATAMODEL-FULL.md is guarded: refuse to write when the existing block holds an
  // authored line the source cannot reproduce. Mirrors `datamodel_full_losses()` in
  // 00-CORE/Schemas/regenerate.py -- see the note on that function for why the block
  // is not purely generated despite its markers. Without this, Regenerate silently
  // deletes documentation (including the payment-card "never stored" security note).
  const fullDefinitions = generateEntityDefinitionsSection(sortedSchemas);
  const datamodelFullLosses = allowLossy ? [] : await generatedSectionLosses(
    app, 'DATAMODEL-FULL.md',
    '<!-- BEGIN GENERATED: ENTITY DEFINITIONS -->', '<!-- END GENERATED: ENTITY DEFINITIONS -->',
    fullDefinitions);
  if (!datamodelFullLosses.length
    && await injectGeneratedSection(app, 'DATAMODEL-FULL.md',
      '<!-- BEGIN GENERATED: ENTITY DEFINITIONS -->', '<!-- END GENERATED: ENTITY DEFINITIONS -->',
      fullDefinitions)) datamodelUpdated++;
  return {
    count: loaded.schemas.length,
    removed,
    fileClassFolder,
    jsonFolder,
    datamodelUpdated,
    datamodelFullLosses,
  };
}

/** Structural table scaffolding carries no authored content, so its churn is not a loss. */
const GENERATED_SECTION_STRUCTURAL_LINES = new Set([
  '', '---', '| Attribute | Value |', '|-----------|-------|',
  '| Field | Required | Type | Allowed Values / Notes |',
  '|-------|----------|------|------------------------|',
]);

export function generatedSectionLossLines(oldBlock: string, newBlock: string): string[] {
  const contentLines = (block: string) => new Set(
    block.split('\n').map((line) => line.trim())
      .filter((line) => !GENERATED_SECTION_STRUCTURAL_LINES.has(line)));
  const fresh = contentLines(newBlock);
  return [...contentLines(oldBlock)].filter((line) => !fresh.has(line)).sort();
}

/**
 * Lines the file's current generated block has that regenerating would drop.
 * Empty when the file or its markers are missing -- nothing to lose in that case.
 */
export async function generatedSectionLosses(app: App, filePath: string, beginMarker: string, endMarker: string, content: string): Promise<string[]> {
  if (!await app.vault.adapter.exists(filePath)) return [];
  const text = await app.vault.adapter.read(filePath);
  const beginIdx = text.indexOf(beginMarker);
  const endIdx = text.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return [];
  return generatedSectionLossLines(text.slice(beginIdx + beginMarker.length, endIdx), content);
}

export async function injectGeneratedSection(app: App, filePath: string, beginMarker: string, endMarker: string, content: string): Promise<boolean> {
  if (!await app.vault.adapter.exists(filePath)) return false;
  const text = await app.vault.adapter.read(filePath);
  const beginIdx = text.indexOf(beginMarker);
  const endIdx = text.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return false;
  const updated = text.slice(0, beginIdx + beginMarker.length) + '\n' + content + '\n' + text.slice(endIdx);
  if (updated === text) return false;
  await app.vault.adapter.write(filePath, updated);
  return true;
}

export function schemaFieldDocType(field: SourceSchemaField): string {
  if (Array.isArray(field.enum)) return 'enum';
  if (field.format === 'date' || field.bob_type === 'date') return 'date';
  if (field.bob_type === 'currency') return 'currency';
  if (field.bob_type === 'tags' || field.type === 'array') return 'array';
  return field.type || 'string';
}

export function generateEntityTypesTable(schemas: LoadedSchemaSource[]): string {
  const header = '| Entity | `type:` value | Location | Key Fields |\n|--------|--------------|----------|------------|';
  const rows = schemas.map(({ schema }) => {
    const label = schema.label || schema.entity;
    const typeValue = schema.type_value ? `\`${schema.type_value}\`` : '_(filename-backed)_';
    const location = schema.location_pattern || '—';
    const keyFields = (schema.key_fields || []).map((k) => `\`${k}\``).join(', ') || '—';
    return `| ${label} | ${typeValue} | ${location} | ${keyFields} |`;
  });
  return `${header}\n${rows.join('\n')}`;
}

export function generateEntityDefinitionsSection(schemas: LoadedSchemaSource[]): string {
  return schemas.map(({ schema }) => {
    const label = schema.label || schema.entity;
    const typeValue = schema.type_value || '_(filename-backed)_';
    const location = schema.location_pattern || '—';
    const definition = schema.description || '—';
    const scope = schema.scope || '';

    let attrTable = '| Attribute | Value |\n|-----------|-------|\n';
    attrTable += `| **Definition** | ${definition} |\n`;
    attrTable += `| **\`type:\`** | \`${typeValue}\` |\n`;
    attrTable += `| **Location** | \`${location}\` |`;
    if (scope) attrTable += `\n| **Scope** | ${scope} |`;

    const dataFields = (schema.fields || []).filter((f) => f.name !== 'type');
    let fieldTable = '';
    if (dataFields.length) {
      fieldTable = '\n\n| Field | Required | Type | Allowed Values / Notes |\n|-------|----------|------|------------------------|\n';
      fieldTable += dataFields.map((field) => {
        const req = field.required ? 'yes' : 'no';
        const type = schemaFieldDocType(field);
        let notes = field.description || '';
        if (Array.isArray(field.enum)) {
          const enumList = field.enum.map((v) => `\`${v}\``).join(', ');
          notes = notes ? `${notes} — ${enumList}` : enumList;
        }
        return `| \`${field.name}\` | ${req} | ${type} | ${notes || '—'} |`;
      }).join('\n');
    }

    let extra = '';
    if (Array.isArray(schema.co_required) && schema.co_required.length) {
      extra += '\n\n' + schema.co_required.map((pair) =>
        `**Co-required**: \`${pair.map((n) => `\`${n}\``).join(' and ')}\` must be set together.`
      ).join(' ');
    }
    if (Array.isArray(schema.status_lifecycle) && schema.status_lifecycle.length) {
      extra += `\n\n**Lifecycle**: ${schema.status_lifecycle.map((s) => `\`${s}\``).join(' → ')}`;
    }
    // Entity-level prose. Order matters: regenerate.py appends notes after the lifecycle
    // line, so rendering it anywhere else makes the two generators disagree and each
    // regenerate would rewrite the block the other just wrote.
    if (typeof schema.notes === 'string' && schema.notes.trim()) {
      extra += `\n\n${schema.notes}`;
    }

    return `### ${label}\n\n${attrTable}${fieldTable}${extra}\n\n---`;
  }).join('\n\n');
}


