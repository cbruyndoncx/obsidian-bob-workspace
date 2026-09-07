const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Regression: object / array-of-object frontmatter rendered as "[object Object]"
// in every plugin table, while Obsidian's native Bases rendered the same data
// fine. Shapes below are taken from a real process-definition note.
const { fmtValue, formatStructuredValue, isStructuredValue } = loadMainFunctions([
  'fmtValue',
  'formatStructuredValue',
  'objectIdentity',
  'isStructuredValue',
  'dateFormatter',
  'currencyFormatter',
]);

// --- the bug ---------------------------------------------------------------
const completionCondition = { entity: 'invoice', field: 'payment_status', equals: 'paid' };
assert.strictEqual(
  fmtValue(completionCondition),
  'entity: invoice, field: payment_status, equals: paid',
);
assert.ok(!fmtValue(completionCondition).includes('[object Object]'));

// A list of records reads as WHAT the records are, not every field of each —
// expanding all fields of 8 real activities produced a 2296-char cell.
const activities = [{ id: 'order-entry', lane: 'sales' }, { id: 'invoice', lane: 'finance' }];
assert.strictEqual(fmtValue(activities), 'order-entry, invoice');
assert.ok(!fmtValue(activities).includes('[object Object]'));

// identity key fallback order, and records with no identity still render
assert.strictEqual(fmtValue([{ name: 'Alpha' }, { title: 'Beta' }, { activity_label: 'Gamma' }]), 'Alpha, Beta, Gamma');
assert.strictEqual(fmtValue([{ lane: 'sales' }]), 'lane: sales');

// long lists are capped with a "+N more" suffix rather than flooding the row
const many = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}` }));
assert.strictEqual(fmtValue(many), 'a0, a1, a2, a3, a4, a5, +3 more');

// --- depth cap: a deeply nested value stays one scannable line --------------
const financialContract = {
  base_currency: 'EUR',
  fx_rates: { EUR: { rate_to_base: 1.0, as_of: 'identity' } },
  tax_policy: { pricing_basis: 'exclusive', default_vat_rate: 21 },
};
const rendered = fmtValue(financialContract);
assert.ok(rendered.startsWith('base_currency: EUR'), rendered);
assert.ok(rendered.includes('{…}'), 'nested-past-depth object should collapse: ' + rendered);
assert.ok(!rendered.includes('[object Object]'));
assert.ok(!rendered.includes('\n'), 'must stay a single line');

// --- unchanged behaviour ---------------------------------------------------
assert.strictEqual(fmtValue(['a', 'b']), 'a, b');           // scalar array: untouched
assert.strictEqual(fmtValue(['x'], 'tags'), '#x');
assert.strictEqual(fmtValue('plain'), 'plain');
assert.strictEqual(fmtValue(42, 'number'), '42');
assert.strictEqual(fmtValue(null), '');
assert.strictEqual(fmtValue(''), '');
assert.strictEqual(fmtValue([]), '');
assert.strictEqual(fmtValue({}), '');
// empty/null members are dropped rather than rendered as "key: "
assert.strictEqual(formatStructuredValue({ a: 1, b: null, c: '' }), 'a: 1');

// --- structured-value predicate: guards the detail form's read-only branch ---
// A text input would render these as "[object Object]" AND persist that string
// back over the real structure on blur.
assert.strictEqual(isStructuredValue({ a: 1 }), true);
assert.strictEqual(isStructuredValue([{ id: 'x' }]), true);
assert.strictEqual(isStructuredValue(['a', 'b']), false);
assert.strictEqual(isStructuredValue('plain'), false);
assert.strictEqual(isStructuredValue(42), false);
assert.strictEqual(isStructuredValue(null), false);
assert.strictEqual(isStructuredValue(new Date()), false);
assert.strictEqual(isStructuredValue([]), false);

console.log('fmt-value tests passed');
