const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

const sandbox = loadMainFunctions([
  'dashboardWidgetKind',
  'dashboardWidgetSchema',
  'collectDashboardWidgetKinds',
  'countDashboardCards',
  'summarizeDashboardBlueprint',
  'validateDashboardStat',
  'validateDashboardCard',
  'validateDashboardConfig',
  'validateWorkspaceConfig',
  'normalizeDashboardConfigShape',
  'resolveDashboardConfig',
  'resolvePlannerConfig',
  'resolveSurfaceConfig',
  'migrateWorkspacePlannerConfig',
], {});

const {
  dashboardWidgetKind,
  collectDashboardWidgetKinds,
  countDashboardCards,
  summarizeDashboardBlueprint,
  validateDashboardConfig,
  validateWorkspaceConfig,
  normalizeDashboardConfigShape,
  resolveDashboardConfig,
  resolvePlannerConfig,
  resolveSurfaceConfig,
} = sandbox;

(() => {
  const custom = { home: { title: 'Custom Home' } };
  assert.strictEqual(resolveDashboardConfig('home', custom).title, 'Custom Home');
  assert.strictEqual(resolveDashboardConfig('reports.productivity', {}), null);
})();

(() => {
  const card = { kind: 'selector', title: 'Stage', entity: 'deal' };
  assert.strictEqual(dashboardWidgetKind(card), 'selector');
  const kinds = collectDashboardWidgetKinds({
    kind: 'kanban',
    merge: [{ kind: 'markdown' }, { kind: 'actions' }],
  });
  assert.ok(kinds.has('kanban'));
  assert.ok(kinds.has('merge'));
  assert.ok(kinds.has('markdown'));
  assert.ok(kinds.has('actions'));
})();

(() => {
  const config = {
    kind: 'report',
    title: 'Pipeline',
    controls: [{ kind: 'selector', key: 'groupBy' }],
    stats: [{ label: 'Open', entity: 'deal', count: 'open' }],
    layout: [[
      { kind: 'kanban', entity: 'deal' },
      { kind: 'gauge', title: 'Score', value: 80, max: 100 },
      { kind: 'progress', title: 'Built', value: 66, max: 100 },
      { kind: 'heatmap', title: 'Cadence', items: [{ date: '2026-07-01', value: 1 }], columns: 7 },
    ]],
  };
  validateDashboardConfig(config, 'dashboards.reports.pipeline');
  const summary = summarizeDashboardBlueprint('reports.pipeline', config);
  assert.strictEqual(summary.kind, 'report');
  assert.ok(summary.widgetKinds.includes('kanban'));
  assert.ok(summary.widgetKinds.includes('gauge'));
  assert.ok(summary.widgetKinds.includes('progress'));
  assert.ok(summary.widgetKinds.includes('heatmap'));
  assert.ok(summary.widgetKinds.includes('selector'));
  assert.strictEqual(countDashboardCards(config), 4);
})();

(() => {
  const config = {
    kind: 'planner',
    title: 'Inbox',
    stats: [
      {
        label: 'Reminders',
        source: { mode: 'built-in', builtIn: 'planner', section: 'inbox' },
        field: 'inboxCount',
      },
    ],
  };
  validateDashboardConfig(config, 'dashboards.planner.inbox');
  const summary = summarizeDashboardBlueprint('planner.inbox', config);
  assert.strictEqual(summary.kind, 'planner');
})();

(() => {
  const workspace = {
    planner: {
      'planner.inbox': {
        kind: 'planner',
        title: 'Inbox',
        stats: [
          { label: 'Reminders', source: { mode: 'built-in', builtIn: 'planner', section: 'inbox' }, field: 'inboxCount' },
        ],
      },
    },
  };
  validateWorkspaceConfig(workspace);
})();

(() => {
  const workspace = {
    dashboards: {
      'planner.calendar': { title: 'Legacy calendar' },
    },
    planner: {},
  };
  assert.strictEqual(resolveSurfaceConfig('planner.calendar', workspace), null);
})();

(() => {
  validateDashboardConfig({
    title: 'Planner',
    stats: [
      {
        label: 'Inbox',
        source: { mode: 'built-in', builtIn: 'planner', section: 'inbox' },
        field: 'inboxCount',
      },
    ],
  }, 'dashboards.planner.inbox');
})();

(() => {
  assert.throws(
    () => validateDashboardConfig({ title: 'Bad', stats: [{ entity: 'deal' }] }, 'dashboards.home'),
    /label is required/
  );
  assert.throws(
    () => validateDashboardConfig({ title: 'Bad', layout: [[{ title: 'Missing entity' }]] }, 'dashboards.home'),
    /needs an entity, built-in source or merge array/
  );
  validateDashboardConfig({
    title: 'Typed',
    layout: [[{ kind: 'selector', key: 'stage', label: 'Stage' }]],
  }, 'dashboards.home');
  assert.throws(
    () => validateDashboardConfig({
      title: 'Typed',
      layout: [[{ kind: 'selector', label: 'Stage' }]],
    }, 'dashboards.home'),
    /key is required/
  );
})();

(() => {
  assert.throws(
    () => validateWorkspaceConfig({ entities: { deal: {} } }),
    /entities is no longer supported/
  );
})();

// Surface config is resolved ONLY from the user's workspace.json — no hidden
// builtin fallback. Applying a template must write the config explicitly so it
// is visible and editable (see template-bundle.test.js for completeness).
(() => {
  assert.strictEqual(resolveSurfaceConfig('crm.pipeline', { dashboards: {} }), null);
  assert.strictEqual(resolveSurfaceConfig('home', { dashboards: { home: { title: 'User Home' } } }).title, 'User Home');
})();

console.log('dashboard-config.test.js: ok');
