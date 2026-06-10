const assert = require('assert');
const fs = require('fs');
const path = require('path');

/*
 * Workspace templates ship inside main.js via explicit JSON imports in
 * src/bundled/templates.ts (build-freshness.test.js guarantees main.js
 * reflects these sources). This test guards:
 *   1. every templates/workspace-*.json is wired into the bundle module
 *   2. the bob template defines a dashboard for every renderConfigDashboard
 *      surface, so applying it never leaves "Add dashboards.xxx" prompts
 *   3. the EMAI template embeds its own schema/base assets
 */

const root = path.join(__dirname, '..');

// 1. Explicit-import coverage: src/bundled/templates.ts must reference every
// on-disk template file (imports are explicit, so a new file is easy to miss).
const templatesDir = path.join(root, 'templates');
const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.json')).sort();
const bundleSrc = fs.readFileSync(path.join(root, 'src', 'bundled', 'templates.ts'), 'utf8');
for (const f of files) {
  assert.ok(
    bundleSrc.includes(`templates/${f}`) && bundleSrc.includes(`'${f}'`),
    `templates/${f} is not wired into src/bundled/templates.ts — add its import + key`
  );
}

// Bundle keys must be exactly the on-disk file names.
const keyMatches = [...bundleSrc.matchAll(/^\s*'([^']+\.json)':/gm)].map((m) => m[1]).sort();
assert.deepStrictEqual(keyMatches, files, 'bundle keys match templates/*.json file names');

const readTemplate = (f) => JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8'));

// 2. The bob template must define a dashboard for every surface that the code
//    routes through renderConfigDashboard.
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
const bobDashboards = readTemplate('workspace-bob.json').dashboards || {};
const missing = CONFIG_DASHBOARD_SURFACES.filter((id) => !(id in bobDashboards));
assert.deepStrictEqual(missing, [], `workspace-bob.json missing dashboards: ${missing.join(', ')}`);

// Guard: if a new renderConfigDashboard target is added in src/, flag that the
// list above (and the template) likely needs updating.
const invoked = new Set();
const re = /renderConfigDashboard\(\s*['"]([^'"]+)['"]/g;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(p); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const src = fs.readFileSync(p, 'utf8');
    let m;
    while ((m = re.exec(src))) invoked.add(m[1]);
  }
};
walk(path.join(root, 'src'));
const uncovered = [...invoked].filter((id) => !CONFIG_DASHBOARD_SURFACES.includes(id));
assert.deepStrictEqual(
  uncovered, [],
  `src/ invokes renderConfigDashboard for surfaces not in the completeness list: ${uncovered.join(', ')}`
);

// 3. The EMAI template must carry its own entity definitions as embedded
//    assets, since its entities aren't built-in — otherwise applying it
//    bootstraps the full built-in set instead of the EMAI entities.
(() => {
  const emai = readTemplate('workspace-emai.json');
  assert.ok(emai && emai._template && emai._template.id === 'emai', 'EMAI template present with _template');
  assert.ok(emai._assets && emai._assets.schemas && emai._assets.bases, 'EMAI template has _assets.schemas + _assets.bases');
  const schemaCount = Object.keys(emai._assets.schemas).length;
  assert.ok(schemaCount >= 20, `EMAI embeds its schemas (got ${schemaCount})`);
  for (const [key, body] of Object.entries(emai._assets.schemas)) {
    assert.ok(/(^|\n)entity:/.test(body), `schema ${key} declares entity`);
  }
  assert.ok(!('_assets' in (emai.navigation || {})), 'assets are top-level, not inside config');
})();

console.log('template-bundle.test.js: ok');
