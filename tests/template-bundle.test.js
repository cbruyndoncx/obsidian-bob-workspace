const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

// Extract the bundled templates object inlined into main.js.
const BEGIN = '/* ===BEGIN BUNDLED_WORKSPACE_TEMPLATES';
const END = '/* ===END BUNDLED_WORKSPACE_TEMPLATES=== */';
const begin = main.indexOf(BEGIN);
const end = main.indexOf(END);
assert.ok(begin >= 0 && end > begin, 'bundle markers present in main.js');
const slice = main.slice(begin, end);
const objStart = slice.indexOf('{', slice.indexOf('BUNDLED_WORKSPACE_TEMPLATES ='));
const objEnd = slice.lastIndexOf('}');
const bundle = JSON.parse(slice.slice(objStart, objEnd + 1));

// 1. The bundle must match the on-disk templates (run scripts/bundle-templates.js after edits).
const templatesDir = path.join(root, 'templates');
const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.json')).sort();
assert.deepStrictEqual(Object.keys(bundle).sort(), files, 'bundle covers every template file');
for (const f of files) {
  const onDisk = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8'));
  assert.deepStrictEqual(bundle[f], onDisk, `bundle for ${f} is stale — run: node scripts/bundle-templates.js`);
}

// 2. The bob template must define a dashboard for every surface that the code
//    routes through renderConfigDashboard, so applying it never leaves a
//    surface showing "Add dashboards.xxx to workspace.json".
const CONFIG_DASHBOARD_SURFACES = [
  'home',
  'crm.dashboard', 'crm.pipeline', 'crm.campaigns.overview',
  'client-work.dashboard',
  'prm.partners.overview',
  'finance.gl.overview', 'finance.setup.overview',
  'procurement.overview',
  'tax.dashboard',
  'reports.pipeline', 'reports.sales', 'reports.partners', 'reports.activity', 'reports.productivity',
];
const bobDashboards = bundle['workspace-bob.json'].dashboards || {};
const missing = CONFIG_DASHBOARD_SURFACES.filter((id) => !(id in bobDashboards));
assert.deepStrictEqual(missing, [], `workspace-bob.json missing dashboards: ${missing.join(', ')}`);

// Guard: if a new renderConfigDashboard target is added in main.js, flag that the
// list above (and the template) likely needs updating.
const invoked = new Set();
const re = /renderConfigDashboard\(\s*['"]([^'"]+)['"]/g;
let m;
while ((m = re.exec(main))) invoked.add(m[1]);
const uncovered = [...invoked].filter((id) => !CONFIG_DASHBOARD_SURFACES.includes(id));
assert.deepStrictEqual(
  uncovered, [],
  `main.js invokes renderConfigDashboard for surfaces not in the completeness list: ${uncovered.join(', ')}`
);

// The EMAI template must carry its own entity definitions as embedded assets,
// since its entities aren't built-in — otherwise applying it bootstraps the full
// built-in set instead of the EMAI entities.
(() => {
  const emai = bundle['workspace-emai.json'];
  assert.ok(emai && emai._template && emai._template.id === 'emai', 'EMAI template present with _template');
  assert.ok(emai._assets && emai._assets.schemas && emai._assets.bases, 'EMAI template has _assets.schemas + _assets.bases');
  const schemaCount = Object.keys(emai._assets.schemas).length;
  assert.ok(schemaCount >= 20, `EMAI embeds its schemas (got ${schemaCount})`);
  // every embedded schema string declares an entity + type_value
  for (const [key, body] of Object.entries(emai._assets.schemas)) {
    assert.ok(/(^|\n)entity:/.test(body), `schema ${key} declares entity`);
  }
  // _assets must NOT leak into the validated config (apply strips _template/_assets)
  assert.ok(!('_assets' in (emai.navigation || {})), 'assets are top-level, not inside config');
})();

console.log('template-bundle.test.js: ok');
