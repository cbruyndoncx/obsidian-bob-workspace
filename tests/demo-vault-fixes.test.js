const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadMainFunctions } = require('./load-main-functions');

// Regressions found building the BOB demo vault (2026-10-21):
//  1. Pipeline "WEIGHTED" stat rendered the raw float sum ("502450").
//  2. The TaskNotes nav item showed "couldn't be embedded here" for its
//     `tasknotesTaskList` Base view.
//  3. Home "Today" said "No tasks yet" while TaskNotes were in progress.

// ── 1. stat card formatting ───────────────────────────────────────────────
(() => {
  const { formatStatValue } = loadMainFunctions([
    'formatStatValue', 'fmtValue', 'formatStructuredValue', 'objectIdentity',
    'isStructuredValue', 'dateFormatter', 'currencyFormatter', 'displayLocale', 'wikilinkDisplayText',
  ], { CURRENT_CURRENCY: 'EUR', _currencyFormatter: null, _dateFormatter: null, DISPLAY_LOCALE: undefined });
  const eur = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  // the bug: weighted forecast is money, whatever the field type
  assert.strictEqual(formatStatValue(502450, { metric: 'weightedForecast' }), eur(502450));
  assert.notStrictEqual(formatStatValue(502450, { metric: 'weightedForecast' }), '502450');
  // float noise from stage-confidence multiplication is rounded away
  assert.strictEqual(formatStatValue(502450.00000000006, { metric: 'weightedForecast' }), eur(502450));
  // sums of a currency field are money; sums of a plain number field are grouped numbers
  assert.strictEqual(formatStatValue(125000, { metric: 'sum', fieldType: 'currency' }), eur(125000));
  assert.strictEqual(formatStatValue(1234, { metric: 'sum', fieldType: 'number' }), (1234).toLocaleString(undefined, { maximumFractionDigits: 1 }));
  // rates are percentages
  assert.strictEqual(formatStatValue(40, { metric: 'winRate' }), '40%');
  assert.strictEqual(formatStatValue(62.5, { metric: 'captureRate' }), '62.5%');
  // counts stay bare
  assert.strictEqual(formatStatValue(7, {}), '7');
  // an explicit format wins over the metric
  assert.strictEqual(formatStatValue(3, { metric: 'sum', format: 'percent' }), '3%');
  assert.strictEqual(formatStatValue(900, { format: 'currency' }), eur(900));
  // non-numbers pass through, missing renders a dash
  assert.strictEqual(formatStatValue('n/a', {}), 'n/a');
  assert.strictEqual(formatStatValue(null, {}), '—');
})();

// ── 2. TaskNotes task-list views render natively ──────────────────────────
(async () => {
  const base = {
    filters: { and: ['type == "task"'] },
    views: [
      { type: 'tasknotesTaskList', name: 'This Week', filters: { and: ['status != "done"', 'date(due) <= today() + "7 days"'] },
        sort: [{ property: 'priority', direction: 'DESC' }], groupBy: { property: 'status', direction: 'ASC' }, order: ['status', 'priority', 'due', 'file.name'] },
      { type: 'tasknotesKanban', name: 'Board' },
      { type: 'table', name: 'All' },
    ],
  };
  const sandbox = loadMainFunctions([
    'parseBaseFile', 'baseViewRendersInline', 'collectBaseFilterConditionsForDerivation',
    'collectUnsupportedBaseFilterConditions', 'collectUnsupportedBaseFeatureWarnings',
    'collectBaseFilterConditions', 'isSupportedBaseFilterCondition', 'parseBaseFilterCondition',
    'buildParsedBaseCondition', 'stripOuterParens', 'splitBaseExpression', 'parseTodayExpression',
    'basePropKey', 'readBaseFileYaml',
  ], {
    obsidian: { TFile: class {}, Notice: class {}, parseYaml: (text) => JSON.parse(text) },
    _baseConditionParseMemo: new Map(),
  });
  const { baseViewRendersInline, parseBaseFile } = sandbox;
  assert.strictEqual(baseViewRendersInline('tasknotesTaskList'), true);
  assert.strictEqual(baseViewRendersInline('table'), true);
  assert.strictEqual(baseViewRendersInline(''), true);
  assert.strictEqual(baseViewRendersInline('tasknotesKanban'), false);
  assert.strictEqual(baseViewRendersInline('board'), false);

  const app = { vault: { getAbstractFileByPath: () => null, adapter: { exists: async () => true, read: async () => JSON.stringify(base) } } };
  const list = await parseBaseFile(app, '00-CORE/Bases/Tasks.base', 'This Week');
  assert.strictEqual(list.externalBaseView, undefined, 'a TaskNotes task list must not be treated as an opaque embed-only view');
  assert.strictEqual(list.baseView.type, 'tasknotesTaskList');
  assert.ok(list.baseFilters.view, 'the view filters are kept for the native table');
  assert.strictEqual(JSON.stringify(list.baseSort), JSON.stringify([{ property: 'priority', direction: 'DESC' }]));
  assert.strictEqual(list.baseGroupBy.property, 'status');
  assert.strictEqual(JSON.stringify(list.columns), JSON.stringify(['status', 'priority', 'due', 'name']));

  const kanban = await parseBaseFile(app, '00-CORE/Bases/Tasks.base', 'Board');
  assert.strictEqual(kanban.externalBaseView.type, 'tasknotesKanban', 'board-shaped TaskNotes views still open in Bases');
})().catch((err) => { console.error(err); process.exit(1); });

// ── 3. Home "Today" lists TaskNotes ───────────────────────────────────────
(() => {
  const { selectHomeTodayTaskNotes } = loadMainFunctions(['selectHomeTodayTaskNotes', 'taskNoteStatus', 'taskNoteIgnored']);
  const today = '2026-10-31';
  const t = (basename, fm) => ({ file: { basename, path: `00-CORE/TaskNotes/Tasks/${basename}.md` }, fm });
  const rows = selectHomeTodayTaskNotes([
    t('wip-normal', { status: 'in-progress', priority: 'normal', title: 'Draft proposal' }),
    t('wip-high', { status: 'in-progress', priority: 'high', title: 'Fix invoice run' }),
    t('due-today', { status: 'open', due: today, priority: 'low', title: 'Call Acme' }),
    t('sched-today', { status: 'next', scheduled: `${today}T09:00`, title: 'Review pipeline' }),
    t('done-today', { status: 'done', due: today }),
    t('cancelled-wip', { status: 'cancelled' }),
    t('open-later', { status: 'open', due: '2026-11-20' }),
    t('awaiting', { status: 'awaiting-input' }),
  ], today);
  // dated-today first (by priority: low before none), then in-progress (high before normal)
  assert.deepStrictEqual(rows.map((r) => r.file.basename), ['due-today', 'sched-today', 'wip-high', 'wip-normal']);
  assert.deepStrictEqual(rows.map((r) => r.reason), ['due today', 'scheduled today', 'in progress', 'in progress']);
  assert.strictEqual(selectHomeTodayTaskNotes([], today).length, 0);
})();

// The shipped BOB workspace tracks work as TaskNotes, so Home and Today need the
// hybrid task mode; without it the default `checkbox` hid every TaskNote.
(() => {
  const tmpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'workspace-bob.json'), 'utf8'));
  assert.strictEqual(tmpl.settings.taskMode, 'hybrid');
  // Daily notes live where the BOB data model files them (periodic-note location_pattern),
  // not the plugin default `daily/`; with the default, Today and Calendar read nothing.
  assert.strictEqual(tmpl.settings.dailyNoteFolder, '00-CORE/PeriodicNotes/Daily');
})();

console.log('demo-vault-fixes.test.js: ok');
