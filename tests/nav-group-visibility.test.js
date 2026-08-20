const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadMainFunctions } = require('./load-main-functions');

// Nav groups are gated by their own id, not by a separate `module` field.
// The old `module` was always a copy of the group id, and groups authored in a
// vault's workspace.json omitted it entirely — which left them with no entry in
// `modules` and therefore no way to be hidden at all.
const { navGroupModuleKey } = loadMainFunctions(['navGroupModuleKey'], {});

assert.strictEqual(navGroupModuleKey({ id: 'crm' }), 'crm');
// a legacy module field must not win over the id
assert.strictEqual(navGroupModuleKey({ id: 'hr', module: 'legacy' }), 'hr');
// every labelled group gets a usable key — this is what makes Hidden reachable
assert.strictEqual(navGroupModuleKey({ id: 'reports' }), 'reports');
assert.strictEqual(navGroupModuleKey({ id: '  research  ' }), 'research');
// junk in, empty out (callers guard on falsy before writing a settings key)
assert.strictEqual(navGroupModuleKey(null), '');
assert.strictEqual(navGroupModuleKey(undefined), '');
assert.strictEqual(navGroupModuleKey({}), '');

// Shipped templates must not reintroduce group-level `module`, and must keep
// item-level `module` — a different, still-live concept: a surface names the
// module whose data it needs, so disabling CRM drops reports.pipeline from the
// Reports group without hiding the group itself.
const templateDir = path.join(__dirname, '..', 'templates');
let crossCutting = 0;
fs.readdirSync(templateDir).filter((f) => /^workspace-.*\.json$/.test(f)).forEach((file) => {
  const config = JSON.parse(fs.readFileSync(path.join(templateDir, file), 'utf8'));
  const groups = (config.navigation || {}).groups || [];
  groups.forEach((group) => {
    assert.ok(!('module' in group),
      `${file}: group '${group.id}' still carries a group-level module`);
    assert.ok(group.id, `${file}: a nav group has no id, so it can never be hidden`);
    (group.items || []).forEach((item) => {
      if (item.module && item.module !== group.id) crossCutting++;
    });
  });
});
// The reports.* → crm/prm tags are the reason item-level module still exists;
// if this hits zero, the strip went too far.
assert.ok(crossCutting >= 4, `expected cross-cutting item modules to survive, found ${crossCutting}`);

console.log('nav-group-visibility.test.js: ok');
