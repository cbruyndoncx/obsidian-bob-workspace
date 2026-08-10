const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Generated schema outputs are keyed by the note-facing `type:` value, with
// entities sharing a type MERGED — not clobbered last-wins, and never keyed by
// entity slug (Metadata Menu with fileClassAlias "type" resolves the fileClass
// file named after the note's type; entity-named files bind to nothing).

const { mergedSchemaForKey, sourceSchemaToFileClass, sourceSchemaToJsonSchema, validateSourceSchemaDefinition } = loadMainFunctions(
  ['mergedSchemaForKey', 'sourceSchemaToFileClass', 'sourceSchemaToJsonSchema',
   'metadataMenuFieldType', 'stableSchemaId', 'validateSourceSchemaDefinition'],
  { obsidian: { stringifyYaml: (o) => `${JSON.stringify(o)}\n` }, SCHEMA_TO_ENTITY_KEY: {}, ENTITIES: {} },
);

// --- `object` fields are legal (canonical vault datamodel uses them: kpi.thresholds).
validateSourceSchemaDefinition({
  entity: 'kpi', label: 'KPI', type_value: 'kpi', location_pattern: 'x/',
  fields: [{ name: 'thresholds', type: 'object', required: false }],
});
assert.throws(() => validateSourceSchemaDefinition({
  entity: 'kpi', label: 'KPI', type_value: 'kpi', location_pattern: 'x/',
  fields: [{ name: 'bad', type: 'blob' }],
}), /unsupported type/, 'unknown types must still be rejected');

// --- Singleton whose entity slug equals the type: passthrough, zero churn.
const plain = { entity: 'task', type_value: 'task', fields: [{ name: 'type', type: 'string', required: true }] };
assert.strictEqual(mergedSchemaForKey('task', [plain]), plain, 'same-key singleton must pass through untouched');

// --- Divergent singleton (entity chart-of-accounts, type coa-account): re-keyed.
const coa = {
  entity: 'chart-of-accounts',
  label: 'Chart of Accounts',
  type_value: 'coa-account',
  discriminator: { ledger: 'general' },
  fields: [{ name: 'account_id', type: 'string', required: true }],
};
const rekeyed = mergedSchemaForKey('coa-account', [coa]);
assert.strictEqual(rekeyed.entity, 'coa-account', 'output key must be the type value');
// Loose compares below: vm-sandbox objects fail deepStrictEqual's prototype check.
assert.strictEqual(JSON.stringify(rekeyed.discriminator), '{"ledger":"general"}', 'singleton keeps its discriminator');
assert.match(sourceSchemaToFileClass(rekeyed), /"fileClass":"coa-account"/, 'fileClass id must be the type value');

// --- Shared type (research + regional-context): union fields, required-intersection.
const research = {
  entity: 'research',
  label: 'Research',
  type_value: 'research',
  location_pattern: '40-RESOURCES/RESEARCH/',
  description: 'Research note',
  fields: [
    { name: 'type', type: 'string', required: true },
    { name: 'research_type', type: 'string', required: true },
    { name: 'provider', type: 'string', required: true },
  ],
};
const regional = {
  entity: 'regional-context',
  label: 'Regional Context',
  type_value: 'research',
  location_pattern: '40-RESOURCES/REGIONS/',
  discriminator: { research_type: 'regional-context' },
  fields: [
    { name: 'type', type: 'string', required: true },
    { name: 'research_type', type: 'string', required: true },
    { name: 'region', type: 'string', required: true },
  ],
};
const merged = mergedSchemaForKey('research', [regional, research]);
const names = merged.fields.map((f) => f.name);
assert.ok(names.includes('region') && names.includes('provider'), 'merged fields must union both entities');
assert.strictEqual(merged.fields.find((f) => f.name === 'research_type').required, true,
  'field required in every entity stays required');
assert.strictEqual(merged.fields.find((f) => f.name === 'region').required, false,
  'field unique to one entity must not be required for the whole type');
assert.strictEqual(merged.discriminator, undefined, 'merged group must drop discriminator constants');
assert.strictEqual(merged.label, 'Regional Context / Research');
assert.strictEqual(merged.location_pattern, '40-RESOURCES/REGIONS/ or 40-RESOURCES/RESEARCH/',
  'locations union via the "or" syntax the fileClass serializer splits on');

// --- Array item schemas: only what the source declares. A bare array must stay
// unconstrained (steps/flows/blockedBy/authors hold objects); an enum-array keeps
// its declared items. Defaulting to {type:'string'} invalidated 33 healthy notes.
const arrays = sourceSchemaToJsonSchema({
  entity: 'task', type_value: 'task', label: 'Task', location_pattern: 'x/',
  fields: [
    { name: 'blockedBy', type: 'array' },
    { name: 'assignee', type: 'array', items: { type: 'string', enum: ['agent', 'owner'] } },
  ],
});
assert.ok(!('items' in arrays.properties.blockedBy),
  'bare array must not be narrowed to array-of-string');
assert.strictEqual(arrays.properties.assignee.items.enum.length, 2,
  'declared item schema must survive');

const json = sourceSchemaToJsonSchema(merged);
assert.strictEqual(json.$id, 'https://brn.cx/schemas/research.schema.json');
assert.strictEqual(json.properties.type.const, 'research');
assert.ok(json.properties.region && json.properties.provider, 'JSON schema carries the unioned fields');
assert.ok(!json.required.includes('region'), 'JSON schema required mirrors the intersection rule');

console.log('schema-type-key.test.js passed');
