import { ENTITIES } from './entities';
import { listEntityFiles, resolveEntityFieldDefault } from './entity-files';
import { cloneConfig } from './nav';
import { SCHEMA_FOLDER_DEFAULT, SCHEMA_TO_ENTITY_KEY, pluralizeEntityLabel, schemaFieldLabel } from './schemas';
import { entityFolder } from './settings';
import { ensureFolderSync } from './utils';
import { WORKSPACE_CONFIG, addConfiguredEntityKey, workspaceConfiguredEntityKeys } from './workspace-config';
import * as obsidian from 'obsidian';
export function schemaFieldFromEntityField(field) {
  const type = String(field?.type || 'string').toLowerCase();
  const result: any = {
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

export function entityLocationPattern(def, entityKey) {
  const patterns = [];
  if (Array.isArray(def?.folders) && def.folders.length) patterns.push(...def.folders);
  else if (String(def?.folder || '').trim()) patterns.push(def.folder);
  if (!patterns.length && entityKey) {
    const folder = entityFolder(entityKey);
    if (folder) patterns.push(folder);
  }
  return [...new Set(patterns.map((pattern) => String(pattern || '').trim().replace(/\/$/, '')).filter(Boolean))].join(' or ');
}

export function schemaFieldArrayFromEntityFields(fields: any[] = []) {
  return fields
    .filter((field) => field && field.key && field.key !== 'type')
    .map((field) => schemaFieldFromEntityField(field))
    .filter((field) => field && field.name);
}

export function schemaBobBlockFromEntityDefinition(def: any = {}) {
  const bob: any = {};
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
    if (def[key] != null) bob[key] = cloneConfig(def[key]);
  });
  if (def.fieldAliases) bob.field_aliases = cloneConfig(def.fieldAliases);
  return bob;
}

export function schemaSourceFromEntityDefinition(entityKey, def = ENTITIES[entityKey] || {}) {
  const fields = schemaFieldArrayFromEntityFields(def.fields || []);
  const primaryField = fields.find((field) => field.required)?.name || def.titleField || fields[0]?.name || '';
  const schema: any = {
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

export function bootstrapSchemaEntityKeys(app, config = WORKSPACE_CONFIG, opts: any = {}) {
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

export async function bootstrapCanonicalSchemaSources(app, settings: any = {}, opts: any = {}) {
  const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  await ensureFolderSync(app, folder);
  const keys = bootstrapSchemaEntityKeys(app, WORKSPACE_CONFIG, opts);
  const written = [];
  const skipped = [];
  for (const entityKey of keys) {
    const def = ENTITIES[entityKey];
    if (!def) continue;
    const schemaPath = `${folder}/${entityKey}.yaml`;
    const schema = validateSourceSchemaDefinition(schemaSourceFromEntityDefinition(entityKey, def));
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
  };
}

export async function bootstrapCanonicalSchemaSourcesIfMissing(app, settings: any = {}, opts: any = {}) {
  const loaded = await loadCanonicalSchemaSources(app, settings);
  if (loaded.schemas.length) return {
    folder: loaded.folder,
    count: 0,
    skipped: 0,
    written: [],
    skippedPaths: [],
    entityKeys: loaded.schemas.map((item) => item.schema.entity).sort(),
    alreadyPresent: true,
  };
  const result = await bootstrapCanonicalSchemaSources(app, settings, opts);
  return Object.assign({ alreadyPresent: false }, result);
}

export function validateSourceSchemaDefinition(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Schema must be an object');
  }
  ['entity', 'label', 'location_pattern'].forEach((key) => {
    if (!String(schema[key] || '').trim()) throw new Error(`Schema needs ${key}`);
  });
  const entityKey = SCHEMA_TO_ENTITY_KEY[schema.entity] || schema.entity;
  if (!String(schema.type_value || '').trim() && !ENTITIES[entityKey]?.filenameFilter) {
    throw new Error('Schema needs type_value unless the record type is filename-backed');
  }
  if (!Array.isArray(schema.fields) || !schema.fields.length) {
    throw new Error('Schema needs at least one field');
  }
  const fieldNames = new Set<any>();
  schema.fields.forEach((field, index) => {
    const name = String(field?.name || '').trim();
    if (!name) throw new Error(`Field ${index + 1} needs a name`);
    if (fieldNames.has(name)) throw new Error(`Duplicate field "${name}"`);
    fieldNames.add(name);
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(field.type)) {
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
    const normalizedAliases = new Map();
    schema.fields.forEach((field) => {
      [field.name, field.label].filter(Boolean).forEach((name) => {
        const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalized && !normalizedAliases.has(normalized)) normalizedAliases.set(normalized, field.name);
      });
    });
    Object.entries<any>(schema.field_aliases).forEach(([name, aliases]) => {
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

export function editableSchemaFieldType(field) {
  if (Array.isArray(field.enum)) return 'enum';
  if (field.type === 'string' && field.format === 'date') return 'date';
  if (field.type === 'string' && field.format === 'date-time') return 'datetime';
  return field.type || 'string';
}

export function applyEditableSchemaFieldType(field, value) {
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

export function editableSchemaFieldDefault(field) {
  if (!Object.prototype.hasOwnProperty.call(field || {}, 'default')) return '';
  return Array.isArray(field.default) ? field.default.join(', ') : String(field.default);
}

export function applyEditableSchemaFieldDefault(field, value) {
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

export async function loadCanonicalSchemaSources(app, settings: any = {}) {
  const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  if (!await app.vault.adapter.exists(folder)) return { folder, schemas: [], errors: [] };
  const listed = await app.vault.adapter.list(folder);
  const schemas = [];
  const errors = [];
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

export function stableSchemaId(value) {
  let hash = 5381;
  for (const character of String(value || '')) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function metadataMenuFieldType(field) {
  if (Array.isArray(field.enum)) return 'Select';
  if (field.type === 'array') return 'Multi';
  if (field.type === 'boolean') return 'Boolean';
  if (field.type === 'number' || field.type === 'integer') return 'Number';
  if (field.format === 'date') return 'Date';
  return 'Input';
}

export function sourceSchemaToJsonSchema(schema) {
  const schemaId = schema.type_value || schema.entity;
  const properties: any = {};
  const required = [];
  (schema.fields || []).forEach((field) => {
    const property: any = { type: field.type || 'string' };
    if (field.format) property.format = field.format;
    if (Array.isArray(field.enum) && field.enum.length) property.enum = field.enum;
    if (field.description) property.description = field.description;
    if (Object.prototype.hasOwnProperty.call(field, 'default')) property.default = field.default;
    if (field.type === 'array') property.items = { type: 'string' };
    properties[field.name] = property;
    if (field.required) required.push(field.name);
  });
  if (schema.type_value && properties.type) properties.type = { const: schema.type_value };
  if (schema.discriminator) Object.entries<any>(schema.discriminator).forEach(([key, value]) => {
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

export function sourceSchemaToFileClass(schema) {
  const filesPaths = String(schema.location_pattern || '')
    .split(/\s+or\s+/i)
    .map((item) => String(item || '').trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const fields = (schema.fields || []).map((field) => {
    const config: any = {
      name: field.name,
      type: metadataMenuFieldType(field),
      id: stableSchemaId(`${schema.entity}:${field.name}`),
      path: '',
    };
    if (Array.isArray(field.enum) && field.enum.length) {
      config.options = field.enum.map((value, index) => ({ [index]: value }));
    }
    if (field.required) config.required = true;
    return config;
  });
  const yaml = {
    fileClass: schema.entity,
    version: '1.0',
    mapWithTag: false,
    filesPaths: filesPaths.length ? filesPaths : [schema.location_pattern],
    fields,
    ...(schema.description ? { description: schema.description } : {}),
  };
  return `---\n${obsidian.stringifyYaml(yaml)}---\n\n# ${schema.label}\n\nGenerated from canonical schema source. Edit the source YAML in BOB Workspace settings.\n`;
}

export async function regenerateSchemaOutputs(app, settings: any = {}) {
  const loaded = await loadCanonicalSchemaSources(app, settings);
  if (loaded.errors.length) throw new Error(`Schema validation failed: ${loaded.errors.join('; ')}`);
  const root = loaded.folder.replace(/\/source$/, '');
  const fileClassFolder = `${root}/fileClasses`;
  const jsonFolder = `${root}/json-schema`;
  await ensureFolderSync(app, fileClassFolder);
  await ensureFolderSync(app, jsonFolder);
  const expectedFileClasses = new Set<any>();
  const expectedJsonSchemas = new Set<any>();
  for (const { schema } of loaded.schemas) {
    const fileClassPath = `${fileClassFolder}/${schema.entity}.md`;
    const jsonSchemaPath = `${jsonFolder}/${schema.type_value || schema.entity}.schema.json`;
    expectedFileClasses.add(fileClassPath);
    expectedJsonSchemas.add(jsonSchemaPath);
    await app.vault.adapter.write(fileClassPath, sourceSchemaToFileClass(schema));
    await app.vault.adapter.write(
      jsonSchemaPath,
      `${JSON.stringify(sourceSchemaToJsonSchema(schema), null, 2)}\n`
    );
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
  if (await injectGeneratedSection(app, 'DATAMODEL-FULL.md',
    '<!-- BEGIN GENERATED: ENTITY DEFINITIONS -->', '<!-- END GENERATED: ENTITY DEFINITIONS -->',
    generateEntityDefinitionsSection(sortedSchemas))) datamodelUpdated++;
  return {
    count: loaded.schemas.length,
    removed,
    fileClassFolder,
    jsonFolder,
    datamodelUpdated,
  };
}

export async function injectGeneratedSection(app, filePath, beginMarker, endMarker, content) {
  if (!await app.vault.adapter.exists(filePath)) return false;
  const text = await app.vault.adapter.read(filePath);
  const beginIdx = text.indexOf(beginMarker);
  const endIdx = text.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return false;
  const updated = text.slice(0, beginIdx + beginMarker.length) + '\n' + content + '\n' + text.slice(endIdx);
  await app.vault.adapter.write(filePath, updated);
  return true;
}

export function schemaFieldDocType(field) {
  if (Array.isArray(field.enum)) return 'enum';
  if (field.format === 'date' || field.bob_type === 'date') return 'date';
  if (field.bob_type === 'currency') return 'currency';
  if (field.bob_type === 'tags' || field.type === 'array') return 'array';
  return field.type || 'string';
}

export function generateEntityTypesTable(schemas) {
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

export function generateEntityDefinitionsSection(schemas) {
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

    return `### ${label}\n\n${attrTable}${fieldTable}${extra}\n\n---`;
  }).join('\n\n');
}


