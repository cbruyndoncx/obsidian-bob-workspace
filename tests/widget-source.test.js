const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

class TFile {
  constructor(path) {
    this.path = path;
    this.basename = path.split('/').pop().replace(/\.md$/i, '');
    this.parent = { path: path.split('/').slice(0, -1).join('/') };
    this.stat = { ctime: Date.now(), mtime: Date.now() };
  }
}

const sandbox = loadMainFunctions([
  'normalizeWidgetSourceConfig',
  'filterEntitiesByBaseConfig',
  'resolveWidgetSource',
  'dashboardProviderRowValue',
], {
  obsidian: { TFile },
  ENTITIES: {
    deal: {
      label: 'Deal',
      plural: 'Deals',
      fields: [{ key: 'title' }, { key: 'status' }, { key: 'value' }],
    },
  },
  listEntities: (_app, entityKey) => {
    if (entityKey !== 'deal') return [];
    const openFile = new TFile('30-CLIENTS/A.md');
    openFile.frontmatter = { title: 'A', status: 'open', value: 10 };
    const closedFile = new TFile('30-CLIENTS/B.md');
    closedFile.frontmatter = { title: 'B', status: 'closed', value: 20 };
    return [
      { file: openFile, basename: 'A', frontmatter: openFile.frontmatter },
      { file: closedFile, basename: 'B', frontmatter: closedFile.frontmatter },
    ];
  },
  parseBaseFile: async (_app, basePath, viewName) => {
    if (basePath !== '00-CORE/Bases/Deal.base') return null;
    return {
      baseView: { name: viewName || 'Open' },
      filters: 'status == "open"',
      fields: [{ key: 'title' }, { key: 'status' }, { key: 'value' }],
      columns: ['title', 'status', 'value'],
      baseFilters: { global: 'status == "open"' },
      baseSort: [],
    };
  },
  evaluateBaseFilterNode: (_app, file, node) => {
    if (!node) return true;
    if (node === 'status == "open"') return file.frontmatter.status === 'open';
    return true;
  },
  buildProductivitySnapshot: async (_app, settings) => ({
    totalDone: settings.taskNotesFolder === 'Custom/Tasks' ? 7 : 0,
  }),
  buildHomeSnapshot: async () => ({}),
  WORKSPACE_CONFIG: { settings: {} },
  compareEntitiesByBaseSort: () => 0,
  entityValue: (entity, key) => entity?.frontmatter?.[key],
});

const { normalizeWidgetSourceConfig, resolveWidgetSource, dashboardProviderRowValue } = sandbox;

(() => {
  const normalized = normalizeWidgetSourceConfig({
    entity: 'deal',
    base: { file: '00-CORE/Bases/Deal.base', view: 'Open' },
    filters: 'status == "open"',
    groupBy: 'status',
    sort: 'title ASC',
    limit: 1,
  });
  assert.strictEqual(normalized.entityKey, 'deal');
  assert.strictEqual(normalized.base.file, '00-CORE/Bases/Deal.base');
  assert.strictEqual(normalized.view, 'Open');
  assert.strictEqual(normalized.limit, 1);
})();

(() => {
  const normalized = normalizeWidgetSourceConfig({
    mode: 'built-in',
    builtIn: 'home',
    section: 'pipeline',
    labels: ['A', 'B'],
  });
  assert.strictEqual(normalized.mode, 'built-in');
  assert.strictEqual(normalized.builtIn, 'home');
  assert.strictEqual(normalized.section, 'pipeline');
  assert.deepStrictEqual(normalized.labels, ['A', 'B']);
})();

(() => {
  const row = {
    title: 'Jun 6',
    meta: 'done 2 · open 10',
    value: 2,
    values: { done: 2, open: 10, total: 12 },
  };
  assert.strictEqual(dashboardProviderRowValue(row, 'done'), 2);
  assert.strictEqual(dashboardProviderRowValue(row, 'open'), 10);
  assert.strictEqual(dashboardProviderRowValue(row, 'total'), 12);
  assert.strictEqual(dashboardProviderRowValue({ meta: '99%', values: { pct: 33 } }, ''), 33);
})();

(async () => {
  const app = {
    vault: {
      getAbstractFileByPath(path) {
        if (path === '00-CORE/Bases/Deal.base') return new TFile(path);
        return null;
      },
    },
  };

  const resolved = await resolveWidgetSource(app, {
    entity: 'deal',
    base: '00-CORE/Bases/Deal.base',
    view: 'Open',
    limit: 1,
  });
  assert.strictEqual(resolved.entityKey, 'deal');
  assert.strictEqual(resolved.metadata.base, '00-CORE/Bases/Deal.base');
  assert.strictEqual(resolved.entities.length, 1);
  assert.strictEqual(resolved.entities[0].frontmatter.title, 'A');
  assert.ok(Array.isArray(resolved.displayFields));

  const builtInSource = await resolveWidgetSource(app, {
    mode: 'built-in',
    builtIn: 'custom-built-in',
  });
  assert.strictEqual(builtInSource.metadata.builtIn, 'custom-built-in');
  assert.strictEqual(builtInSource.entities.length, 0);

  const productivity = await resolveWidgetSource(app, {
    mode: 'built-in',
    builtIn: 'productivity',
  }, null, { taskNotesFolder: 'Custom/Tasks' });
  assert.strictEqual(productivity.metadata.builtInData.totalDone, 7);

  console.log('widget-source.test.js: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
