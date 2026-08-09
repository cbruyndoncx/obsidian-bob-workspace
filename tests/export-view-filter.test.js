const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Regression: an "Export to Excel" must include the full dataset and must NOT
// be truncated by the currently-selected Base *view* filter. listEntityFiles
// honours the view filter for on-screen lists, but exports pass
// { ignoreViewFilter: true } so a narrow display view (e.g. a "Ready" view)
// never silently cuts the export.
//
// (This mirrors the real bug where settings.baseViews.skill = "Free Ready"
//  reduced a 359-skill export to ~100.)

const files = [
  makeFile('skills/a/SKILL.md', { ok: true }),
  makeFile('skills/b/SKILL.md', { ok: false }),
  makeFile('skills/c/SKILL.md', { ok: false }),
  makeFile('skills/d/SKILL.md', { ok: true }),
];

function makeFile(path, frontmatter) {
  return {
    path,
    name: path.split('/').pop(),
    basename: path.split('/').pop().replace(/\.md$/i, ''),
    parent: { path: path.split('/').slice(0, -1).join('/') },
    stat: { ctime: Date.now(), mtime: Date.now() },
    frontmatter,
  };
}

const ENTITIES = {
  skill: {
    filenameFilter: 'SKILL.md',
    folders: ['skills'],
    // global membership matches every SKILL.md; the view filter keeps only ok:true
    baseFilters: { global: 'GLOBAL', view: 'VIEW' },
  },
};

const sandbox = loadMainFunctions(['listEntityFiles'], {
  ENTITIES,
  // Collaborators of the per-entity list memo (module-level in src).
  _entityListMemo: new Map(),
  _scanVersion: 0,
  scannableMarkdownFiles: () => files,
  entityFolder: () => 'skills',
  readEntity: (app, f) => ({ file: f, frontmatter: f.frontmatter, basename: f.basename }),
  evaluateBaseFilterNode: (app, f, node) => {
    if (node === 'VIEW') return f.frontmatter.ok === true; // view filter: ok only
    return true; // global filter: everything
  },
});

const { listEntityFiles } = sandbox;
const app = { metadataCache: { getFileCache: (f) => ({ frontmatter: f.frontmatter || {} }) } };

(() => {
  // Default (on-screen list): the selected view filter applies -> only ok:true.
  const listed = listEntityFiles(app, 'skill');
  assert.strictEqual(listed.length, 2, 'default list should honour the view filter');

  // Export path: ignoreViewFilter -> full dataset (view filter skipped).
  const exported = listEntityFiles(app, 'skill', { ignoreViewFilter: true });
  assert.strictEqual(exported.length, 4, 'export must ignore the view filter and include all records');

  // Global membership still applies even when the view filter is ignored.
  ENTITIES.skill.baseFilters.global = 'DENY';
  const denied = loadMainFunctions(['listEntityFiles'], {
    ENTITIES,
    _entityListMemo: new Map(),
    _scanVersion: 0,
    scannableMarkdownFiles: () => files,
    entityFolder: () => 'skills',
    readEntity: (app, f) => ({ file: f }),
    evaluateBaseFilterNode: (a, f, node) => (node === 'DENY' ? false : true),
  }).listEntityFiles(app, 'skill', { ignoreViewFilter: true });
  assert.strictEqual(denied.length, 0, 'global membership filter still applies to exports');
  ENTITIES.skill.baseFilters.global = 'GLOBAL';
})();

console.log('export-view-filter.test.js: ok');
