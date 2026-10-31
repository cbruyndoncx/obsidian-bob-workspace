const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// A schema field `type` may be a JSON Schema list. The canonical vault schema
// ai-session-log.yaml declares `estimated_cost_usd` as `type: [number, 'null']`;
// `_schemaTypeToFieldType` called `.toLowerCase()` on that list and the plugin
// failed to load in every vault carrying the schema.

const {
  schemaBaseType, _schemaTypeToFieldType, fieldsFromSchema, validateSourceSchemaDefinition,
  metadataMenuFieldType, editableSchemaFieldType, applyEditableSchemaFieldType,
  applyEditableSchemaFieldDefault, schemaFieldDocType, sourceSchemaToJsonSchema,
  scalarFieldValue, validateImportedShape,
} = loadMainFunctions(
  ['schemaBaseType', '_schemaTypeToFieldType', 'fieldsFromSchema', 'schemaFieldLabel', 'cloneConfig',
   'validateSourceSchemaDefinition', 'metadataMenuFieldType', 'editableSchemaFieldType',
   'schemaTypeIsNullable', 'applyEditableSchemaFieldType', 'applyEditableSchemaFieldDefault',
   'schemaFieldDocType', 'sourceSchemaToJsonSchema', 'stableSchemaId', 'scalarFieldValue',
   'isReadOnlyField', 'isStructuredValue', 'validateImportedShape', 'matchesImportedType'],
  { obsidian: { stringifyYaml: (o) => `${JSON.stringify(o)}\n` }, SCHEMA_TO_ENTITY_KEY: {}, ENTITIES: {} },
);

// Same shape as 00-CORE/Schemas/source/ai-session-log.yaml.
const costField = () => ({
  name: 'estimated_cost_usd',
  type: ['number', 'null'],
  required: true,
  description: 'Estimated cost in USD based on model pricing at session time.',
});

// --- schemaBaseType: first non-null name, lowercased; junk yields ''.
assert.strictEqual(schemaBaseType('Number'), 'number');
assert.strictEqual(schemaBaseType(['number', 'null']), 'number');
assert.strictEqual(schemaBaseType(['null', 'integer']), 'integer');
assert.strictEqual(schemaBaseType('null'), '');
assert.strictEqual(schemaBaseType(['null']), '');
assert.strictEqual(schemaBaseType(42), '');
assert.strictEqual(schemaBaseType(undefined), '');
assert.strictEqual(schemaBaseType({ type: 'string' }), '');

// --- The load path that crashed.
assert.strictEqual(_schemaTypeToFieldType(['number', 'null']), 'number');
assert.strictEqual(_schemaTypeToFieldType(['array', 'null'], { items: { type: ['string', 'null'] } }), 'tags');
assert.strictEqual(_schemaTypeToFieldType(['string', 'null']), null, 'nullable string stays text');
assert.strictEqual(_schemaTypeToFieldType(7), null, 'a non-string type must not throw');

const fields = fieldsFromSchema({
  entity: 'ai-session-log',
  fields: [{ name: 'date', type: 'string', format: 'date', required: true }, costField()],
});
const cost = fields.find((f) => f.key === 'estimated_cost_usd');
assert.strictEqual(cost.type, 'number');
assert.strictEqual(JSON.stringify(cost.schemaType), '["number","null"]', 'schemaType keeps the list for round-trips');

// --- The designer validator accepts a nullable type and still rejects bad ones.
const schemaWith = (field) => ({ entity: 'ai-session-log', label: 'AI Session Log', type_value: 'ai-session-log', location_pattern: 'x/', fields: [field] });
validateSourceSchemaDefinition(schemaWith(costField()));
validateSourceSchemaDefinition(schemaWith({ ...costField(), default: 0 }));
assert.throws(() => validateSourceSchemaDefinition(schemaWith({ ...costField(), default: 'free' })), /must be a number/);
assert.throws(() => validateSourceSchemaDefinition(schemaWith({ name: 'x', type: ['null'] })), /unsupported type/);
assert.throws(() => validateSourceSchemaDefinition(schemaWith({ name: 'x', type: ['blob', 'null'] })), /unsupported type/);

// --- Generated outputs read the base type; JSON Schema keeps the list.
assert.strictEqual(metadataMenuFieldType(costField()), 'Number');
assert.strictEqual(schemaFieldDocType(costField()), 'number (nullable)');
const jsonSchema = sourceSchemaToJsonSchema(schemaWith(costField()));
assert.strictEqual(JSON.stringify(jsonSchema.properties.estimated_cost_usd.type), '["number","null"]');

// --- Designer edits keep a nullable field nullable.
assert.strictEqual(editableSchemaFieldType(costField()), 'number');
const edited = costField();
applyEditableSchemaFieldType(edited, 'integer');
assert.strictEqual(JSON.stringify(edited.type), '["integer","null"]');
const dated = costField();
applyEditableSchemaFieldType(dated, 'date');
assert.strictEqual(JSON.stringify(dated.type), '["string","null"]');
assert.strictEqual(dated.format, 'date');
const withDefault = costField();
applyEditableSchemaFieldDefault(withDefault, '1.5');
assert.strictEqual(withDefault.default, 1.5, 'nullable number default parses as a number');

// --- Value editing and workbook import compare the base type.
assert.throws(() => scalarFieldValue('1.5', { key: 'n', schemaType: ['integer', 'null'] }), /valid integer/);
assert.strictEqual(scalarFieldValue('', { key: 'n', schemaType: ['integer', 'null'] }), null);
assert.throws(() => validateImportedShape('x', { key: 'o', schemaType: ['object', 'null'] }), /requires an object/);

console.log('schema-nullable-type.test.js: ok');
