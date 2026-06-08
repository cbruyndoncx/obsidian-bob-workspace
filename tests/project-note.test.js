const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

const created = [];

const sandbox = loadMainFunctions([
  'createEntity',
  'entityTemplate',
  'projectTemplate',
  'entityValue',
  'projectNameFromPath',
  'normalizeProjectId',
  'humanizeProjectName',
  'resolveEntityCreateFolder',
  'resolveLocationPatternFolder',
  'buildEntityCreateValueMap',
  'lookupCreateValue',
  'normalizedLookupKey',
  'normalizePathSegment',
  'primaryField',
  'primaryFieldKey',
], {
  ENTITIES: {
    project: {
      folder: '30-CLIENTS',
      typeFilter: 'project',
      label: 'Project',
      plural: 'Projects',
      locationPattern: '30-CLIENTS/{project_id}',
      fields: [
        { key: 'project_id', label: 'Project ID', primary: true },
        { key: 'project_name', label: 'Project Name' },
      ],
    },
  },
  WORKSPACE_CONFIG: {},
  ymd: () => '2026-06-07',
  ensureFolderSync: async () => {},
  obsidian: {},
});

const { createEntity, entityValue, normalizeProjectId, humanizeProjectName, projectNameFromPath } = sandbox;

(async () => {
  assert.strictEqual(normalizeProjectId('New Client Onboarding'), 'new-client-onboarding');
  assert.strictEqual(humanizeProjectName('new-client_onboarding'), 'New Client Onboarding');
  assert.strictEqual(
    entityValue(
      { basename: 'new-client-onboarding', frontmatter: { project_id: 'new-client-onboarding' } },
      'project_name',
      sandbox.ENTITIES.project
    ),
    'New Client Onboarding'
  );

  const app = {
    vault: {
      getAbstractFileByPath() {
        return null;
      },
      async create(path, content) {
        const file = { path, content };
        created.push(file);
        return file;
      },
    },
    metadataCache: {
      getFileCache(file) {
        if (file.path !== '30-CLIENTS/new-client-onboarding/new-client-onboarding.md') return null;
        return { frontmatter: { project_name: 'New Client Onboarding', project_id: 'new-client-onboarding' } };
      },
    },
  };

  const file = await createEntity(app, 'project', 'New Client Onboarding');
  assert.strictEqual(file.path, '30-CLIENTS/new-client-onboarding/new-client-onboarding.md');
  assert.ok(file.content.includes('project_id: new-client-onboarding'));
  assert.ok(file.content.includes('project_name: New Client Onboarding'));
  assert.ok(file.content.includes('# New Client Onboarding'));
  assert.strictEqual(projectNameFromPath(app, file.path), 'New Client Onboarding');

  console.log('project-note.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
