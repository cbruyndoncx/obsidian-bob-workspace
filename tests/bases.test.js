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

// 2. basesFolder is authoritative — changing it relocates every base (basename preserved),
//    even when the saved baseFiles value still carries an old directory.
(() => {
  const moved = { basesFolder: 'My/Bases', baseFiles: { contact: '00-CORE/Bases/People.base' } };
  assert.strictEqual(entityBasePath(moved, 'contact'), 'My/Bases/People.base');
  const trailingSlash = { basesFolder: 'My/Bases/', baseFiles: { contact: 'People.base' } };
  assert.strictEqual(entityBasePath(trailingSlash, 'contact'), 'My/Bases/People.base');
  assert.strictEqual(resolveBasesFolder({ basesFolder: 'X/' }), 'X');
})();

// 3. A bare filename in baseFiles composes; a missing entry falls back to DEFAULT_SETTINGS.
(() => {
  assert.strictEqual(entityBasePath({ basesFolder: 'B', baseFiles: { contact: 'C.base' } }, 'contact'), 'B/C.base');
  assert.strictEqual(entityBasePath({ basesFolder: 'B' }, 'invoice'), 'B/AR.base'); // from DEFAULT_SETTINGS
  assert.strictEqual(entityBasePath({ basesFolder: 'B' }, 'unknownEntity'), '');
})();

// 4. workspace.json bases is the full-path escape hatch (wins over folder composition).
(() => {
  WORKSPACE_CONFIG.bases = { contact: { file: 'Custom/Anywhere/People.base' } };
  assert.strictEqual(entityBasePath(DEFAULT_SETTINGS, 'contact'), 'Custom/Anywhere/People.base');
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

console.log('bases.test.js: ok');
