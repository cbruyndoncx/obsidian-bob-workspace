const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

const sandbox = loadMainFunctions([
  'hasBaseValue',
  'basePropKey',
  'basePropValue',
  'stripOuterParens',
  'splitBaseExpression',
  'parseTodayExpression',
  'parseBaseDate',
  'compareBaseDates',
  'isSupportedBaseFilterCondition',
  'collectBaseFilterConditions',
  'collectBaseFilterConditionsForDerivation',
  'evaluateBaseFilterGroup',
  'evaluateBaseFilterCondition',
  'evaluateBaseFilterNode',
  'normalizeStatusValue',
  'entityStatusField',
  'entityTerminalStatuses',
  'isOpenEntityRecord',
], {
  startOfDay: (d) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date;
  },
  addDays: (d, offset) => {
    const date = new Date(d);
    date.setDate(date.getDate() + offset);
    return date;
  },
  compareBaseDates: (a, op, b) => {
    const av = new Date(a).getTime();
    const bv = new Date(b).getTime();
    if (op === '==') return av === bv;
    if (op === '<') return av < bv;
    if (op === '<=') return av <= bv;
    if (op === '>') return av > bv;
    if (op === '>=') return av >= bv;
    return false;
  },
  entityValue: (entity, key) => entity?.frontmatter?.[key],
});

const {
  hasBaseValue,
  evaluateBaseFilterNode,
  collectBaseFilterConditionsForDerivation,
  entityStatusField,
  entityTerminalStatuses,
  isOpenEntityRecord,
} = sandbox;

function makeFile(frontmatter = {}, path = 'test.md') {
  return {
    path,
    basename: path.split('/').pop().replace(/\.md$/i, ''),
    parent: { path: path.split('/').slice(0, -1).join('/') },
    stat: { ctime: Date.now(), mtime: Date.now() },
    frontmatter,
  };
}

const app = {
  metadataCache: {
    getFileCache(file) {
      return { frontmatter: file.frontmatter || {} };
    },
  },
};

(() => {
  assert.strictEqual(hasBaseValue(0), true);
  assert.strictEqual(hasBaseValue(false), true);
  assert.strictEqual(hasBaseValue(new Date()), true);
  assert.strictEqual(hasBaseValue([]), false);
  assert.strictEqual(hasBaseValue('   '), false);
})();

(() => {
  const file = makeFile({ date: '2026-06-15' });
  assert.strictEqual(
    evaluateBaseFilterNode(app, file, 'date >= "2026-06-01" && date <= "2026-06-30"'),
    true
  );
  assert.strictEqual(
    evaluateBaseFilterNode(app, file, 'date >= "2026-07-01" && date <= "2026-07-31"'),
    false
  );
})();

(() => {
  const node = {
    and: [
      'file.path.startsWith("30-CLIENTS/")',
      { or: ['status == "open"', 'status == "pending"'] },
    ],
  };
  const derived = collectBaseFilterConditionsForDerivation(node);
  assert.deepStrictEqual(derived, ['file.path.startsWith("30-CLIENTS/")']);
})();

(() => {
  const file = makeFile({ status: 'closed' });
  assert.strictEqual(
    evaluateBaseFilterNode(app, file, { not: 'status == "open"' }),
    true
  );
  assert.strictEqual(
    evaluateBaseFilterNode(app, file, { not: 'status == "closed"' }),
    false
  );
})();

(() => {
  const requestDef = {
    fields: [{ key: 'approval_status' }],
    terminalStatuses: ['approved', 'rejected'],
  };
  const dealDef = {
    stageField: 'stage',
    terminalStatuses: ['Won', 'Lost'],
  };
  assert.strictEqual(entityStatusField(requestDef), 'approval_status');
  assert.ok(entityTerminalStatuses(requestDef).has('approved'));
  assert.strictEqual(isOpenEntityRecord(makeFile({ approval_status: 'pending' }), 'request', { request: requestDef }), true);
  assert.strictEqual(isOpenEntityRecord(makeFile({ approval_status: 'approved' }), 'request', { request: requestDef }), false);
  assert.strictEqual(isOpenEntityRecord(makeFile({ stage: 'Won' }), 'deal', { deal: dealDef }), false);
})();

console.log('base-filter.test.js: ok');
