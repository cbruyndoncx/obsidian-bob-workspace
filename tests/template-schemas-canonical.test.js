const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * templates/workspace-bob.json embeds the BOB data model as schema YAML
 * (`_assets.schemas`). Applying the template writes any missing schema file from
 * that copy, so a stale copy silently seeds an outdated data model into a vault —
 * which is what happened on 2026-09-17, when a sync that carried only markdown left
 * the schema folder empty and 74 stale entity files were written in its place.
 *
 * Guards:
 *   1. always: every embedded body is YAML text declaring the entity it is keyed by;
 *   2. when a canonical schema folder is reachable ($BOB_CANONICAL_SCHEMAS, else the
 *      BRNCX vault default used by scripts/sync-template-schemas.mjs): every embedded
 *      body is byte-identical to <source>/<entity>.yaml. CI machines without the vault
 *      skip this half and say so; run `npm run sync-schemas` after changing the
 *      canonical data model.
 */

const root = path.join(__dirname, '..');
const template = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'workspace-bob.json'), 'utf8'));
const schemas = (template._assets && template._assets.schemas) || {};
const entities = Object.keys(schemas);

assert.ok(entities.length >= 70, `bob template embeds its schemas (got ${entities.length})`);
for (const [entity, body] of Object.entries(schemas)) {
  assert.strictEqual(typeof body, 'string', `schema ${entity} is embedded as YAML text, verbatim from its canonical file`);
  const declared = (body.match(/^entity:\s*(\S+)\s*$/m) || [])[1];
  assert.strictEqual(declared, entity, `schema ${entity} declares entity: ${declared}`);
}

const DEFAULT_CANONICAL_SOURCE = '/mnt/c/users/bruyn/documents/brncx-skills/00-CORE/Schemas/source';
const source = process.env.BOB_CANONICAL_SCHEMAS || DEFAULT_CANONICAL_SOURCE;
if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
  const drift = [];
  for (const [entity, body] of Object.entries(schemas)) {
    const file = path.join(source, `${entity}.yaml`);
    if (!fs.existsSync(file)) drift.push(`${entity} (no canonical file)`);
    else if (fs.readFileSync(file, 'utf8') !== body) drift.push(entity);
  }
  assert.deepStrictEqual(drift, [], `bob template schemas drifted from ${source}: ${drift.join(', ')} — run npm run sync-schemas`);
  console.log(`template-schemas-canonical.test.js: ok (${entities.length} schemas match ${source})`);
} else {
  console.log(`template-schemas-canonical.test.js: ok (structure only; canonical folder not found: ${source})`);
}
