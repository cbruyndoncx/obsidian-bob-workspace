const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadMainFunctions } = require('./load-main-functions');

// Found in the 2026-10-31 demo-vault screenshots of the Partners and Client Work
// overviews: every `submitted` partner registration counted as closed (the shared
// terminal list closes `submitted` for filings), and Decisions read 0 because the
// built-in definition filtered on `type: decision-log` while the canonical schema
// and every vault decision note use `type: decision`.

const f = loadMainFunctions([
  'isOpenEntityRecord', 'entityStatusField', 'normalizeStatusValue', 'entityValue',
  'entityTerminalStatuses', 'buildEntityTerminalStatuses', 'terminalStatusInputsKey',
], { _terminalStatusesMemo: new WeakMap(), humanizeProjectName: (s) => s });

const rec = (status) => ({ frontmatter: { status }, basename: 'x', file: { path: 'x.md' } });
const registration = { statusField: 'status', openStatuses: ['submitted'] };
const vatReturn = { statusField: 'status' };
const reg = { registration, 'vat-return': vatReturn };

assert.strictEqual(f.isOpenEntityRecord(rec('submitted'), 'registration', reg), true, 'a submitted registration is pending');
assert.strictEqual(f.isOpenEntityRecord(rec('approved'), 'registration', reg), false);
assert.strictEqual(f.isOpenEntityRecord(rec('expired'), 'registration', reg), false);
assert.strictEqual(f.isOpenEntityRecord(rec('submitted'), 'vat-return', reg), false, 'a submitted filing stays closed');
assert.strictEqual(f.isOpenEntityRecord(rec('Submitted'), 'registration', reg), true, 'status case does not matter');

// The built-in definitions carry these settings.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'entities.ts'), 'utf8');
const block = (key) => {
  const start = src.indexOf(`\n  ${key}: {`);
  assert.ok(start >= 0, `${key} definition not found`);
  return src.slice(start, src.indexOf('\n  },', start));
};
assert.ok(/openStatuses: \['submitted'\]/.test(block('registration')), 'registration must keep submitted open');
assert.ok(/typeFilter: 'decision',/.test(block('decision')), 'decision must filter on type: decision');

console.log('entity-open-status.test.js: ok');
