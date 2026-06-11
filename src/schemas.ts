import { applyEntityDefinitions } from './bases-config';
import { ENTITIES, type BobEntityDef, type BobEntityField } from './entities';
import { cloneConfig } from './nav';
import { SCHEMA_ENTITY_KEYS } from './workspace-config';
import * as obsidian from 'obsidian';
import type { JsonValue, PartialSettings } from './types';

/** A canonical schema YAML document as authored in the schema source folder. */
interface SchemaYamlField {
  name: string;
  type?: string;
  format?: string;
  label?: string;
  required?: boolean;
  primary?: boolean;
  enum?: string[];
  bob_type?: string;
  default?: JsonValue;
}

interface SchemaYaml {
  entity?: string;
  label?: string;
  plural?: string;
  icon?: string;
  type_value?: string;
  location_pattern?: string;
  key_fields?: string[];
  fields?: SchemaYamlField[];
  field_aliases?: Record<string, string[]>;
  status_lifecycle?: string[];
  bob?: BobEntityDef;
}

export const SCHEMA_FOLDER_DEFAULT = '00-CORE/Schemas/source';
export const SCHEMA_TO_ENTITY_KEY: Record<string, string> = {
  person: 'contact',
};

export function _schemaTypeToFieldType(schemaType: string | undefined, schemaField: Partial<SchemaYamlField> = {}): 'date' | 'number' | 'tags' | null {
  if ((schemaField.format || '').toLowerCase() === 'date') return 'date';
  switch ((schemaType || '').toLowerCase()) {
    case 'number':  return 'number';
    case 'date':    return 'date';
    case 'boolean': return null;
    case 'array':   return 'tags';
    default:        return null;   // string → text (default)
  }
}

export function schemaFieldLabel(name: unknown): string {
  return String(name || '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function pluralizeEntityLabel(label: unknown): string {
  const value = String(label || '').trim();
  if (!value) return '';
  const irregular: Record<string, string> = {
    analysis: 'Analyses',
    person: 'People',
  };
  const irregularPlural = irregular[value.toLowerCase()];
  if (irregularPlural) return irregularPlural;
  if (/analysis$/i.test(value)) return value.replace(/analysis$/i, 'Analyses');
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(value)) return `${value}es`;
  return `${value}s`;
}

export function fieldsFromSchema(schema: SchemaYaml, existingFields: BobEntityField[] = []): BobEntityField[] | null {
  if (!Array.isArray(schema.fields)) return null;
  const existingByKey = new Map<string, Partial<BobEntityField>>((existingFields || []).map((f) => [f.key, f]));
  const schemaFields = schema.fields.filter((sf) => sf && sf.name && sf.name !== 'type');
  if (!schemaFields.length) return null;
  const primaryKey = schemaFields.find((field) => field.primary)?.name ||
    (schema.key_fields || []).find((key) => key && key !== 'type') || schemaFields[0].name;
  const fields: BobEntityField[] = schemaFields.map((sf) => {
    const existing = existingByKey.get(sf.name) || {};
    const field = Object.assign({}, existing, {
      key: sf.name,
      label: sf.label || existing.label || schemaFieldLabel(sf.name),
    });
    if (sf.required === true) field.required = true;
    if (sf.name === primaryKey) field.primary = true;
    else delete field.primary;
    if (Array.isArray(sf.enum) && sf.enum.length) {
      field.type = 'enum';
      field.options = sf.enum;
    } else {
      const fieldType = _schemaTypeToFieldType(sf.type, sf);
      if (fieldType) field.type = fieldType;
      else if (field.type && !existing.type) delete field.type;
    }
    if (sf.bob_type) field.type = sf.bob_type;
    if (Object.prototype.hasOwnProperty.call(sf, 'default')) field.defaultValue = cloneConfig(sf.default);
    else delete field.defaultValue;
    return field;
  });
  (existingFields || []).forEach((field) => {
    if (field?.key && field.key !== 'type' && !fields.some((f) => f.key === field.key)) {
      fields.push(Object.assign({}, field));
    }
  });
  fields.sort((a, b) => (a.primary ? -1 : 0) + (b.primary ? 1 : 0));
  return fields;
}

export async function applySchemas(app: obsidian.App, settings: PartialSettings = {}): Promise<void> {
  const folder = (settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  if (!await app.vault.adapter.exists(folder)) return;

  const list = await app.vault.adapter.list(folder);
  const yamlFiles = (list.files || []).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const filePath of yamlFiles) {
    let schema: SchemaYaml | null;
    try {
      const raw = await app.vault.adapter.read(filePath);
      schema = obsidian.parseYaml(raw);
    } catch (e) {
      continue;   // skip invalid schemas silently
    }
    if (!schema || typeof schema !== 'object' || !schema.entity) continue;

    const entityKey = SCHEMA_TO_ENTITY_KEY[schema.entity] || schema.entity;
    SCHEMA_ENTITY_KEYS.add(entityKey);
    if (!ENTITIES[entityKey]) {
      const label = schema.label || schemaFieldLabel(entityKey);
      const schemaFields = fieldsFromSchema(schema, []) || [];
      ENTITIES[entityKey] = {
        folder: '',
        typeFilter: schema.type_value || entityKey,
        label,
        plural: schema.plural || pluralizeEntityLabel(label),
        icon: schema.icon || 'file-text',
        fields: schemaFields,
        columns: schemaFields.slice(0, 5).map((field) => field.key),
      };
    }
    if (schema.label) ENTITIES[entityKey].label = schema.label;
    if (schema.plural) ENTITIES[entityKey].plural = schema.plural;
    if (schema.icon) ENTITIES[entityKey].icon = schema.icon;
    if (schema.field_aliases) ENTITIES[entityKey].fieldAliases = JSON.parse(JSON.stringify(schema.field_aliases));
    if (schema.location_pattern) ENTITIES[entityKey].locationPattern = schema.location_pattern;

    // Derive folders from location_pattern. Handles single, ` or `-joined, and `{placeholder}` patterns.
    //   "30-CLIENTS/{client-id}/00-PROFILE/"          -> ["30-CLIENTS"]
    //   "10-ME/10-PEOPLE/ or 30-CLIENTS/{id}/10-PEOPLE/" -> ["10-ME/10-PEOPLE", "30-CLIENTS"]
    if (schema.location_pattern) {
      const folders = schema.location_pattern
        .split(/\s+or\s+/i)
        .map((p) => {
          const base = String(p || '')
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .split('{')[0]
            .replace(/\/$/, '')
            .trim();
          // We can only express prefix folder matches; ignore wildcard/suffix patterns like "*/20-MEETINGS/".
          if (!base || base.includes('*')) return '';
          return base;
        })
        .filter((p) => p && p.includes('/') && !p.includes(','));
      if (entityKey === 'contact') {
        delete ENTITIES[entityKey].folders;
      } else if (folders.length) {
        ENTITIES[entityKey].folders = folders;
      }
    }

    // typeFilter from type_value — skip if entity uses filenameFilter (matched by filename, not type field)
    if (schema.type_value && !ENTITIES[entityKey].filenameFilter) ENTITIES[entityKey].typeFilter = schema.type_value;

    // Enrich fields from schema.fields (preserve existing labels where present)
    if (Array.isArray(schema.fields) && ENTITIES[entityKey].fields) {
      const schemaFields = fieldsFromSchema(schema, ENTITIES[entityKey].fields);
      if (schemaFields?.length) {
        ENTITIES[entityKey].fields = schemaFields;
        ENTITIES[entityKey].columns = schemaFields.slice(0, 5).map((f) => f.key);
      }
    }

    // status_lifecycle → enum options on status/stage field
    if (Array.isArray(schema.status_lifecycle) && schema.status_lifecycle.length) {
      const targetKey = ENTITIES[entityKey].fields?.find(f => f.key === 'status') ? 'status'
                      : ENTITIES[entityKey].fields?.find(f => f.key === 'stage') ? 'stage' : null;
      if (targetKey && ENTITIES[entityKey].fields) {
        ENTITIES[entityKey].fields = ENTITIES[entityKey].fields.map(f =>
          f.key === targetKey ? Object.assign({}, f, { type: 'enum', options: schema.status_lifecycle }) : f
        );
      }
    }
    if (schema.bob && typeof schema.bob === 'object' && !Array.isArray(schema.bob)) {
      await applyEntityDefinitions(app, settings, { [entityKey]: schema.bob }, false);
    }
  }
}

/* ─── Base file config parser ───────────────────────────────────────────────
   Reads a .base file and translates its filters/properties into an entity
   config fragment compatible with applyEntityDefinitions().

   Supported filter translations:
     note.type == "x"                → typeFilter: "x"
     file.path.startsWith("path/")   → folders: ["path"]
*/
