import { parseBaseFile } from './bases-parse';
import { BUILTIN_ENTITY_DEFAULTS, BUILT_SURFACES, ENTITIES } from './entities';
import { NAV_GROUPS, rebuildSurfaceLookups } from './nav';
import { pluralizeEntityLabel } from './schemas';
import { DEFAULT_SETTINGS, ENTITY_FOLDERS, syncEntityFolders } from './settings';
import { ensureFolderSync } from './utils';
import { CONFIGURED_BASE_ENTITY_KEYS, SCHEMA_ENTITY_KEYS, WORKSPACE_CONFIG, configuredBaseDefinition } from './workspace-config';
import * as obsidian from 'obsidian';
export function resolveBasesFolder(settings: any = {}) {
  return String(settings.basesFolder || DEFAULT_SETTINGS.basesFolder || '00-CORE/Bases').replace(/\/+$/, '');
}

// Default .base filename for an entity that has no explicit baseFiles/bases
// mapping — derived from its label/plural so schema-defined entities still get
// a sensible, stable file (e.g. area → Areas.base).
export function defaultBaseFileName(def, entityKey) {
  const raw = String((def && (def.plural || def.label)) || entityKey).trim();
  const safe = raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || entityKey}.base`;
}

export function entityBasePath(settings: any = {}, entityKey) {
  // basesFolder is authoritative for the directory. The filename comes from
  // (in order) workspace.json bases[key].file, plugin baseFiles[key], the
  // built-in default, or — for schema-defined entities with none of those — a
  // name derived from the entity. We always strip to the basename and compose
  // with basesFolder, so changing the Bases folder relocates EVERY base.
  const base = configuredBaseDefinition(entityKey);
  let raw = base?.file || base?.base
    || (settings.baseFiles || {})[entityKey]
    || (DEFAULT_SETTINGS.baseFiles || {})[entityKey]
    || '';
  if (!raw && typeof ENTITIES !== 'undefined' && ENTITIES[entityKey]) {
    raw = defaultBaseFileName(ENTITIES[entityKey], entityKey);
  }
  const name = String(raw).split('/').pop();
  if (!name) return '';
  return `${resolveBasesFolder(settings)}/${name}`;
}

// Entities the generator should consider — anything with a base mapping plus
// every schema-registered entity (so vault-defined entities get bases too).
export function baseEntityKeys(settings: any = {}) {
  return Array.from(new Set([
    ...Object.keys(WORKSPACE_CONFIG.bases || {}),
    ...Object.keys(DEFAULT_SETTINGS.baseFiles || {}),
    ...Object.keys(settings.baseFiles || {}),
    ...(typeof SCHEMA_ENTITY_KEYS !== 'undefined' ? SCHEMA_ENTITY_KEYS : []),
  ])).sort();
}

// Build an Obsidian Bases (.base) config object from an entity definition:
// a filter that selects the entity's notes, and a table view listing its columns.
export function baseFileFromEntityDefinition(entityKey, def) {
  const conditions = [];
  const typeFilters = def.typeFilters && typeof def.typeFilters === 'object' && !Array.isArray(def.typeFilters)
    ? def.typeFilters
    : null;
  if (typeFilters) {
    for (const [k, v] of Object.entries<any>(typeFilters)) conditions.push(`note.${k} == "${v}"`);
  } else if (def.typeFilter) {
    conditions.push(`note.type == "${def.typeFilter}"`);
  } else {
    // No frontmatter discriminator — scope by folder so the base isn't empty.
    const folder = (Array.isArray(def.folders) && def.folders[0]) || def.folder;
    if (folder) conditions.push(`file.inFolder("${folder}")`);
  }

  const fields = Array.isArray(def.fields) ? def.fields : [];
  const columns = Array.isArray(def.columns) && def.columns.length
    ? def.columns
    : fields.map((f) => f.key);
  // In a Base, `order` (columns) and `sort` use BARE property names, while
  // `properties` keys and `filters` use the note.<prop> form. file.name is the
  // primary field's column. (Matches the vault's hand-authored .base files.)
  const order = [];
  const properties = {};
  for (const key of columns) {
    const field = fields.find((f) => f.key === key);
    const orderId = field?.primary ? 'file.name' : key;
    const propKey = field?.primary ? 'file.name' : `note.${key}`;
    if (order.includes(orderId)) continue;
    order.push(orderId);
    if (field?.label && field.label !== key) properties[propKey] = { displayName: field.label };
  }
  if (!order.includes('file.name')) order.unshift('file.name');

  const out: any = {};
  if (conditions.length === 1) out.filters = conditions[0];
  else if (conditions.length > 1) out.filters = { and: conditions };
  if (Object.keys(properties).length) out.properties = properties;
  out.views = [{ type: 'table', name: def.plural || def.label || entityKey, order }];
  return out;
}

// Create a .base file for every known entity that doesn't already have one.
// Missing-only: existing files are never overwritten.
export async function generateMissingBases(app, settings: any = {}) {
  const folder = resolveBasesFolder(settings);
  await ensureFolderSync(app, folder);
  const written = [];
  const skipped = [];
  const failed = [];
  for (const entityKey of baseEntityKeys(settings)) {
    const def: any = ENTITIES[entityKey];
    if (!def) continue;
    const path = entityBasePath(settings, entityKey);
    if (!path) continue;
    if (await app.vault.adapter.exists(path)) { skipped.push(path); continue; }
    try {
      const dir = path.split('/').slice(0, -1).join('/');
      if (dir) await ensureFolderSync(app, dir);
      const base = baseFileFromEntityDefinition(entityKey, def);
      await app.vault.adapter.write(path, obsidian.stringifyYaml(base));
      written.push(path);
    } catch (e) {
      failed.push(`${path}: ${e.message}`);
    }
  }
  return { folder, count: written.length, skipped: skipped.length, failed, written, skippedPaths: skipped };
}

export function entityBaseViewName(settings: any = {}, entityKey) {
  const base = configuredBaseDefinition(entityKey);
  // User selection in settings.baseViews overrides workspace.json default view.
  return (settings.baseViews || {})[entityKey] || base?.view || base?.baseView || '';
}

export function resetEntityRegistry(settings: any = {}) {
  CONFIGURED_BASE_ENTITY_KEYS.clear();
  SCHEMA_ENTITY_KEYS.clear();
  Object.keys(ENTITIES).forEach((key) => {
    if (!BUILTIN_ENTITY_DEFAULTS[key]) delete ENTITIES[key];
  });
  Object.entries<any>(BUILTIN_ENTITY_DEFAULTS).forEach(([key, def]) => {
    ENTITIES[key] = JSON.parse(JSON.stringify(def));
  });
  syncEntityFolders(settings);
}

export async function applyEntityDefinitions(app, settings: any = {}, config: any = {}, injectNavigation = true, configOwnsBase = false) {
  for (let [key, def] of Object.entries<any>(config)) {
    if (!def || typeof def !== 'object') continue;

    const basePath = configOwnsBase
      ? (def.base || (settings.baseFiles || {})[key])
      : ((settings.baseFiles || {})[key] || def.base);
    const baseView = configOwnsBase
      ? (def.baseView || (settings.baseViews || {})[key])
      : ((settings.baseViews || {})[key] || def.baseView);
    if (configOwnsBase && def.base) CONFIGURED_BASE_ENTITY_KEYS.add(key);
    if (basePath) {
      const baseConfig: any = await parseBaseFile(app, basePath, baseView);
      if (baseConfig) {
        // Field-level merge: base provides structure, def augments with type/options/primary
        let mergedFields = baseConfig.fields;
        if (mergedFields && def.fields) {
          const overrides = new Map(def.fields.map(f => [f.key, f]));
          mergedFields = mergedFields.map(f => overrides.has(f.key) ? Object.assign({}, f, overrides.get(f.key)) : f);
          // Append any def.fields keys not in base (e.g. extra custom fields)
          def.fields.forEach(f => { if (!mergedFields.find(b => b.key === f.key)) mergedFields.push(f); });
        }
        def = Object.assign({}, baseConfig, def);
        if (mergedFields) def.fields = mergedFields;
      }
    }

    // New entities require label + fields; existing entities accept partial overrides
    if (!ENTITIES[key] && (!def.label || !Array.isArray(def.fields))) continue;

    const folder = (def.folder || `Cadence/${def.plural || pluralizeEntityLabel(def.label)}`).trim();
    const isNew = !ENTITIES[key];

    if (isNew) {
      ENTITIES[key] = {
        folder,
        label: def.label,
        plural: def.plural || pluralizeEntityLabel(def.label),
        fields: def.fields,
        columns: def.columns || def.fields.slice(0, 5).map((f) => f.key),
      };
      if (def.typeFilter) ENTITIES[key].typeFilter = def.typeFilter;
      if (def.typeFilters) ENTITIES[key].typeFilters = def.typeFilters;
      ['stageField','valueField','closeByField','wonStages','lostStages',
       'detailMetaFields','detailSections','terminalStatuses','stageConfidence',
       'template',
       'folders','dateField','titleField','fieldAliases','baseFilters','baseSort','baseGroupBy','baseView','externalBaseView','unsupportedBaseFilters','unsupportedBaseFeatures'].forEach((k) => {
        if (def[k] != null) ENTITIES[key][k] = def[k];
      });
      ENTITY_FOLDERS[key] = folder;

      if (injectNavigation) {
        const surfaceId = `custom.${key}`;
        BUILT_SURFACES.add(surfaceId);

        // Inject nav item - into named module group if specified, else "Custom".
        let targetGroup = def.module ? NAV_GROUPS.find((g) => g.id === def.module) : null;
        if (!targetGroup) {
          targetGroup = NAV_GROUPS.find((g) => g.id === 'custom');
          if (!targetGroup) {
            targetGroup = { id: 'custom', label: 'Custom', items: [] };
            const miscIdx = NAV_GROUPS.findIndex((g) => g.id === 'misc');
            NAV_GROUPS.splice(miscIdx >= 0 ? miscIdx : NAV_GROUPS.length, 0, targetGroup);
          }
        }
        targetGroup.items.push({
          id: surfaceId,
          label: def.plural || pluralizeEntityLabel(def.label),
          icon: def.icon || 'file-text',
          module: def.module,
          entityKey: key,
          folderKey: def.folderKey,
          desc: def.desc || `${def.plural || pluralizeEntityLabel(def.label)} - custom entity`,
        });
        rebuildSurfaceLookups();
      }
    } else {
      // Merge fields by key (preserves schema-derived enum/options, adds entities.json type/primary)
      if (def.fields) {
        const existing = ENTITIES[key].fields || [];
        const overrides = new Map(def.fields.map(f => [f.key, f]));
        const merged = existing.map(f => overrides.has(f.key) ? Object.assign({}, f, overrides.get(f.key)) : f);
        // Append any def.fields keys not yet present
        def.fields.forEach(f => { if (!merged.find(b => b.key === f.key)) merged.push(f); });
        ENTITIES[key].fields = merged;
      }
      if (def.columns)      ENTITIES[key].columns      = def.columns;
      if (def.label)        ENTITIES[key].label        = def.label;
      if (def.plural)       ENTITIES[key].plural       = def.plural;
      if (def.folder)       ENTITY_FOLDERS[key]        = folder;
      if (Object.prototype.hasOwnProperty.call(def, 'typeFilter')) {
        if (def.typeFilter) ENTITIES[key].typeFilter = def.typeFilter;
        else delete ENTITIES[key].typeFilter;
      }
      if (Object.prototype.hasOwnProperty.call(def, 'typeFilters')) {
        if (def.typeFilters) ENTITIES[key].typeFilters = def.typeFilters;
        else delete ENTITIES[key].typeFilters;
      }
      // Per-entity config overrides
      ['stageField','valueField','closeByField','wonStages','lostStages',
       'detailMetaFields','detailSections','terminalStatuses','stageConfidence',
       'template',
       'folders','dateField','titleField','fieldAliases','baseFilters','baseSort','baseGroupBy','baseView','externalBaseView','unsupportedBaseFilters','unsupportedBaseFeatures'].forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(def, k)) return;
        if (def[k] != null) ENTITIES[key][k] = def[k];
        else delete ENTITIES[key][k];
      });
    }
  }
}


/* ─── Schema YAML config loader ─────────────────────────────────────────────
   Reads 00-CORE/Schemas/source/*.yaml files (Metadata Menu schema source) and
   derives entity config from them. Each schema YAML has:
     entity, label, type_value, location_pattern, key_fields, fields,
     status_lifecycle (enum values for status/stage)

   Schema entity names don't always match plugin entity keys (person→contact,
   client→company). The mapping below handles the differences.
*/
