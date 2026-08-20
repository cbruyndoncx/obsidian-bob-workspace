const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadMainFunctions } = require('./load-main-functions');

// Regression: "CREATED PER WEEK" and "CLOSED PER WEEK" drew identical bars.
// Both cards ask the productivity `weeks` section for a field (created/closed)
// that the row mapper didn't expose, and dashboardProviderRowValue fell back to
// row.value — the `done` tally — for any unknown field. Two different questions,
// one answer, no error anywhere.
const { dashboardProviderRowValue } = loadMainFunctions(['dashboardProviderRowValue'], {});

const week = {
  title: 'Aug 3',
  value: 7,                                     // the `done` default series
  values: { done: 7, open: 4, total: 11, created: 9, closed: 2, net: 7 },
};
assert.strictEqual(dashboardProviderRowValue(week, 'created'), 9);
assert.strictEqual(dashboardProviderRowValue(week, 'closed'), 2);
assert.notStrictEqual(
  dashboardProviderRowValue(week, 'created'),
  dashboardProviderRowValue(week, 'closed'),
  'created and closed must resolve to different series',
);
// neither may collapse onto the default `done` series
assert.notStrictEqual(dashboardProviderRowValue(week, 'created'), week.value);

// An explicitly named but absent field resolves to 0 rather than silently
// borrowing row.value — that substitution is what hid this bug.
assert.strictEqual(dashboardProviderRowValue({ value: 7, values: { done: 7 } }, 'nope'), 0);
// with no field named at all, the default series is still correct
assert.strictEqual(dashboardProviderRowValue({ value: 7, values: { done: 7 } }, ''), 7);
// values wins over a same-named top-level key; top-level used when values lacks it
assert.strictEqual(dashboardProviderRowValue({ open: 3, values: { open: 5 } }, 'open'), 5);
assert.strictEqual(dashboardProviderRowValue({ open: 3, values: { done: 1 } }, 'open'), 3);
assert.strictEqual(dashboardProviderRowValue(null, 'created'), 0);

// The weeks row mapper must keep exposing the flow fields the snapshot computes;
// buildProductivitySnapshot has always emitted created/closed/net per week, and
// dropping them again silently reintroduces the identical-charts bug.
const appView = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'app-view.ts'), 'utf8');
const weeksMapper = appView.split("if (section === 'weeks' || section === 'weekly')")[1];
assert.ok(weeksMapper, 'could not locate the weeks row mapper');
const mapperBody = weeksMapper.slice(0, weeksMapper.indexOf('return (builtInData.dayBuckets'));
['created', 'closed', 'net'].forEach((field) => {
  assert.ok(new RegExp(`\\b${field}:`).test(mapperBody),
    `weeks row mapper no longer exposes '${field}'`);
});

// Every built-in productivity card in the shipped templates must name a field
// the mapper actually provides.
const PROVIDED = {
  'per-day': ['done', 'open', 'journal', 'total'],
  weeks: ['done', 'open', 'total', 'created', 'closed', 'net'],
  weekday: ['pct', 'done', 'open', 'total'],
};
const templateDir = path.join(__dirname, '..', 'templates');
fs.readdirSync(templateDir).filter((f) => /^workspace-.*\.json$/.test(f)).forEach((file) => {
  const config = JSON.parse(fs.readFileSync(path.join(templateDir, file), 'utf8'));
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const source = node.source;
    if (source && typeof source === 'object' && source.builtIn === 'productivity') {
      const section = String(source.section || '');
      const field = String(node.valueField || node.field || '');
      const provided = PROVIDED[section];
      if (field && provided) {
        assert.ok(provided.includes(field),
          `${file}: card "${node.title}" asks section '${section}' for unknown field '${field}'`);
      }
    }
    Object.values(node).forEach(walk);
  };
  walk(config);
});

console.log('productivity-weeks-flow.test.js: ok');
