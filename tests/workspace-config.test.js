const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

const sandbox = loadMainFunctions([
  'loadWorkspaceConfig',
  'resolveSurfaceConfig',
  'migrateWorkspacePlannerConfig',
], {
  validateWorkspaceConfig: (config) => config,
  WORKSPACE_CONFIG_PATH: 'workspace.json',
  WORKSPACE_CONFIG: {},
  WORKSPACE_HAS_NAVIGATION: false,
  // Collaborators of the config-epoch memo / skip-identical-writes baseline.
  bumpWorkspaceConfigEpoch: () => {},
  _lastWrittenWorkspaceJson: null,
  obsidian: {
    Notice: class Notice {
      constructor(message) {
        this.message = message;
      }
    },
  },
});

const { loadWorkspaceConfig } = sandbox;

(async () => {
  const app = {
    vault: {
      adapter: {
        async exists(path) {
          return path === 'workspace.json';
        },
        async read() {
          return JSON.stringify({
            dashboards: {
              'planner.calendar': { title: 'Legacy calendar' },
            },
          });
        },
      },
    },
  };

  const loaded = await loadWorkspaceConfig(app);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(loaded)), {
    planner: {
      'planner.calendar': { title: 'Legacy calendar' },
    },
  });
  console.log('workspace-config.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
