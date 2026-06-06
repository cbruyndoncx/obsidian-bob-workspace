const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

const sandbox = loadMainFunctions([
  'loadWorkspaceConfig',
], {
  validateWorkspaceConfig: (config) => config,
  WORKSPACE_CONFIG_PATH: 'workspace.json',
  WORKSPACE_CONFIG: {},
  WORKSPACE_HAS_NAVIGATION: false,
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
          return JSON.stringify({});
        },
      },
    },
  };

  const loaded = await loadWorkspaceConfig(app);
  assert.deepStrictEqual(loaded, {});
  console.log('workspace-config.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
