const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Helpers run in a vm realm, so returned arrays/objects have different prototypes
// than this file's — compare by structure, not reference identity.
const eqJSON = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// resolveBasesFolder / entityBasePath depend on DEFAULT_SETTINGS + configuredBaseDefinition.
// Provide a DEFAULT_SETTINGS stub (folder + the basename source) and a WORKSPACE_CONFIG stub.
const DEFAULT_SETTINGS = {
  basesFolder: '00-CORE/Bases',
  baseFiles: {
    contact: '00-CORE/Bases/People.base',
    invoice: '00-CORE/Bases/AR.base',
    deal: '00-CORE/Bases/Pipeline.base',
  },
};
let WORKSPACE_CONFIG = { bases: {} };

const sandbox = loadMainFunctions(
  ['resolveBasesFolder', 'configuredBaseDefinition', 'entityBasePath', 'baseFileFromEntityDefinition'],
  { DEFAULT_SETTINGS, WORKSPACE_CONFIG }
);
const { resolveBasesFolder, entityBasePath, baseFileFromEntityDefinition } = sandbox;

// 1. Regression: with the default folder, composition reproduces today's exact paths.
(() => {
  assert.strictEqual(entityBasePath(DEFAULT_SETTINGS, 'contact'), '00-CORE/Bases/People.base');
  assert.strictEqual(entityBasePath(DEFAULT_SETTINGS, 'invoice'), '00-CORE/Bases/AR.base');
  assert.strictEqual(entityBasePath(DEFAULT_SETTINGS, 'deal'), '00-CORE/Bases/Pipeline.base');
})();

// 2. A bare filename composes with basesFolder (and relocates with it); a value
//    that carries a directory is an explicit location, honored verbatim.
(() => {
  const explicit = { basesFolder: 'My/Bases', baseFiles: { contact: '00-CORE/Bases/People.base' } };
  assert.strictEqual(entityBasePath(explicit, 'contact'), '00-CORE/Bases/People.base'); // honored, not relocated
  const bare = { basesFolder: 'My/Bases/', baseFiles: { contact: 'People.base' } };
  assert.strictEqual(entityBasePath(bare, 'contact'), 'My/Bases/People.base');           // composed
  assert.strictEqual(resolveBasesFolder({ basesFolder: 'X/' }), 'X');
})();

// 3. A bare filename in baseFiles composes; a missing entry falls back to
//    DEFAULT_SETTINGS (whose full-path entries are honored verbatim).
(() => {
  assert.strictEqual(entityBasePath({ basesFolder: 'B', baseFiles: { contact: 'C.base' } }, 'contact'), 'B/C.base');
  assert.strictEqual(entityBasePath({ basesFolder: 'B' }, 'invoice'), '00-CORE/Bases/AR.base'); // DEFAULT full path honored
  assert.strictEqual(entityBasePath({ basesFolder: 'B' }, 'unknownEntity'), '');
})();

// 4. A workspace.json bases[key].file with a directory is honored verbatim, so a
//    base can live anywhere in the vault (outside basesFolder). A filename-only
//    entry composes with basesFolder (critical #5).
(() => {
  WORKSPACE_CONFIG.bases = { contact: { file: '20-COMPANY/skills.base' } };
  assert.strictEqual(entityBasePath({ basesFolder: 'New/Bases' }, 'contact'), '20-COMPANY/skills.base'); // honored, ignores basesFolder
  WORKSPACE_CONFIG.bases = { contact: { file: 'People.base' } };
  assert.strictEqual(entityBasePath({ basesFolder: '00-CORE/Bases' }, 'contact'), '00-CORE/Bases/People.base'); // composed
  WORKSPACE_CONFIG.bases = {};
})();

// 5. baseFileFromEntityDefinition builds a valid Bases config: type filter + table view + order.
(() => {
  const def = {
    label: 'Contact', plural: 'Contacts', typeFilter: 'person',
    fields: [
      { key: 'name', label: 'Name', primary: true },
      { key: 'person_category', label: 'Category' },
      { key: 'email', label: 'Email' },
    ],
    columns: ['name', 'person_category', 'email'],
  };
  const base = baseFileFromEntityDefinition('contact', def);
  assert.strictEqual(base.filters, 'note.type == "person"');
  assert.strictEqual(base.views.length, 1);
  assert.strictEqual(base.views[0].type, 'table');
  assert.strictEqual(base.views[0].name, 'Contacts');
  // order uses BARE property names (primary → file.name); matches hand-authored .base files
  eqJSON(base.views[0].order, ['file.name', 'person_category', 'email']);
  // properties keys use note.<key> / file.name; labels that differ become displayName
  assert.strictEqual(base.properties['note.person_category'].displayName, 'Category');
  assert.strictEqual(base.properties['file.name'].displayName, 'Name');
})();

// 6. typeFilters (multi-field) → AND group; no discriminator → folder filter.
(() => {
  const multi = baseFileFromEntityDefinition('partner', {
    typeFilters: { type: 'profile', profile_type: 'partner' },
    fields: [{ key: 'partner_name', primary: true }], columns: ['partner_name'],
  });
  eqJSON(multi.filters, { and: ['note.type == "profile"', 'note.profile_type == "partner"'] });

  const folderOnly = baseFileFromEntityDefinition('note', {
    folder: '40-RESOURCES', fields: [{ key: 'title', primary: true }], columns: ['title'],
  });
  assert.strictEqual(folderOnly.filters, 'file.inFolder("40-RESOURCES")');
  assert.ok(folderOnly.views[0].order.includes('file.name'));
})();

// 7. Schema-registered entities with no explicit base mapping get a derived
//    filename and are included in baseEntityKeys (so the generator covers them).
(() => {
  const s = loadMainFunctions(
    ['resolveBasesFolder', 'configuredBaseDefinition', 'defaultBaseFileName', 'entityBasePath', 'baseEntityKeys'],
    {
      DEFAULT_SETTINGS: { basesFolder: '00-CORE/Bases', baseFiles: { contact: 'People.base' } },
      WORKSPACE_CONFIG: { bases: {} },
      ENTITIES: { area: { label: 'Area', plural: 'Areas', typeFilter: 'area' }, video: { label: 'Video', plural: 'Videos' } },
      SCHEMA_ENTITY_KEYS: ['area', 'video'],
    }
  );
  // derived filename from plural, composed with basesFolder
  assert.strictEqual(s.defaultBaseFileName({ plural: 'Areas' }, 'area'), 'Areas.base');
  assert.strictEqual(s.entityBasePath({ basesFolder: 'Machine/Bases' }, 'area'), 'Machine/Bases/Areas.base');
  // an entity with neither a mapping nor an ENTITIES def still resolves to nothing
  assert.strictEqual(s.entityBasePath({ basesFolder: 'Machine/Bases' }, 'ghost'), '');
  // baseEntityKeys now includes schema-registered entities
  const keys = s.baseEntityKeys({ baseFiles: {} });
  assert.ok(keys.includes('area') && keys.includes('video'), 'schema entities included');
})();

console.log('bases.test.js: ok');
