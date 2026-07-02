const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadMainFunctions } = require('./load-main-functions');

/*
 * Every bundled workspace template must survive the REAL config pipeline that
 * runs when a user applies it: strip the `_template`/`_assets` metadata (as
 * applyWorkspaceTemplate does), run migrateWorkspacePlannerConfig, then
 * validateWorkspaceConfig. dashboard-config.test.js stubs the validator, so
 * without this test a template that fails the real validator (e.g. a leftover
 * `entities` block) or ships an unread config shape (nested `dashboards.planner`)
 * ships silently.
 */

// validateWorkspaceConfig calls into the dashboard validators; the sandbox
// extracts named functions individually, so its transitive deps must be listed.
const sandbox = loadMainFunctions([
  'validateWorkspaceConfig',
  'migrateWorkspacePlannerConfig',
  'validateDashboardConfig',
  'validateDashboardCard',
  'validateDashboardStat',
  'dashboardWidgetKind',
  'dashboardWidgetSchema',
  'collectDashboardWidgetKinds',
], {});
const { validateWorkspaceConfig, migrateWorkspacePlannerConfig } = sandbox;

const templatesDir = path.join(__dirname, '..', 'templates');
const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.json')).sort();

// applyWorkspaceTemplate strips top-level `_`-prefixed metadata before validating.
const stripMeta = (config) => {
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('_')) continue;
    out[key] = value;
  }
  return out;
};

// Rich templates that ship planner surface configs (nested under dashboards.planner).
const RICH_PLANNER_TEMPLATES = new Set(['workspace-bob.json', 'workspace-cadence.json', 'workspace-crm.json']);

for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8'));
  const config = stripMeta(raw);

  // 1. The real validator must accept every shipped template.
  const migrated = migrateWorkspacePlannerConfig(config);
  assert.doesNotThrow(
    () => validateWorkspaceConfig(migrated),
    `${f} must pass the real validateWorkspaceConfig`
  );

  // 2. Planner surface configs must land where the code reads them: top-level
  //    `planner`, not the nested `dashboards.planner` container that templates author.
  if (RICH_PLANNER_TEMPLATES.has(f)) {
    assert.ok(
      migrated.planner && Object.keys(migrated.planner).length > 0,
      `${f} must expose a non-empty top-level planner block after migration`
    );
    assert.ok(
      !(migrated.dashboards && 'planner' in migrated.dashboards),
      `${f} must not leave a nested dashboards.planner container after migration`
    );
    for (const surfaceId of Object.keys(migrated.planner)) {
      assert.ok(
        surfaceId.startsWith('planner.'),
        `${f} planner block only holds planner.* surfaces (got ${surfaceId})`
      );
    }
  }
}

console.log('template-validate.test.js: ok');
