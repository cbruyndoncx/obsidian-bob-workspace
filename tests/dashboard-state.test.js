const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

const sandbox = loadMainFunctions([
  'workspaceOwnedSettings',
  'applyWorkspaceOwnedSettings',
  'persistedWorkspaceOwnedSettings',
], {
  cloneConfig: (value) => JSON.parse(JSON.stringify(value)),
  DEFAULT_SETTINGS: {
    dashboardState: {},
  },
  WORKSPACE_CONFIG: {
    settings: {
      dashboardState: {
        home: { stage: 'open', dateRangePreset: 'this-week' },
      },
    },
  },
  WORKSPACE_OWNED_SETTING_KEYS: [
    'dashboardState',
  ],
});

const { workspaceOwnedSettings, applyWorkspaceOwnedSettings, persistedWorkspaceOwnedSettings } = sandbox;

(() => {
  const settings = {
    dashboardState: {
      home: { stage: 'open', dateRangePreset: 'this-week' },
      'reports.pipeline': { groupBy: 'owner' },
    },
    currency: 'USD',
  };

  const owned = workspaceOwnedSettings(settings);
  assert.deepStrictEqual(owned.dashboardState.home.stage, 'open');
  assert.strictEqual(owned.currency, undefined);

  const applied = applyWorkspaceOwnedSettings({});
  assert.deepStrictEqual(applied.dashboardState.home.dateRangePreset, 'this-week');

  const persisted = persistedWorkspaceOwnedSettings(settings);
  assert.deepStrictEqual(persisted.dashboardState['reports.pipeline'].groupBy, 'owner');
})();

console.log('dashboard-state.test.js: ok');
