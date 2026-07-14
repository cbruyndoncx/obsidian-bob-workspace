const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Coverage for XLSX sheet composition: safeSheetName sanitization/dedup and the
// workbook group → entity-key selection (previously untested — TODO test gap).

const WORKBOOK_EXPORT_GROUPS = [
  { id: 'crm', label: 'CRM', entityKeys: ['contact', 'deal', 'ghost'] }, // ghost absent → filtered
  { id: 'empty', label: 'Empty', entityKeys: ['ghost'] },               // all filtered → group dropped
  { id: 'fin', label: 'Finance', entityKeys: ['invoice', 'deal'] },     // deal repeats across groups
];
const ENTITIES = { contact: {}, deal: {}, invoice: {} };

const wb = loadMainFunctions(
  ['safeSheetName', 'workbookExportGroups', 'entityKeysForWorkbookGroups', 'selectedWorkbookEntityKeys'],
  { WORKBOOK_EXPORT_GROUPS, ENTITIES },
);

// ── safeSheetName ────────────────────────────────────────────────────────────
(() => {
  assert.strictEqual(wb.safeSheetName('Deals'), 'Deals', 'plain name kept');
  assert.strictEqual(wb.safeSheetName('a/b:c*?[d]'), 'a b c d', 'illegal Excel chars → space, collapsed');
  assert.strictEqual(wb.safeSheetName(''), 'Sheet', 'empty → Sheet');
  assert.strictEqual(wb.safeSheetName(null), 'Sheet', 'null → Sheet');
  assert.strictEqual(wb.safeSheetName('x'.repeat(40)).length, 31, 'truncated to Excel 31-char limit');

  const used = new Set();
  assert.strictEqual(wb.safeSheetName('Tasks', used), 'Tasks', 'first occurrence unchanged');
  assert.strictEqual(wb.safeSheetName('Tasks', used), 'Tasks 2', 'duplicate gets a numeric suffix');
  assert.ok(used.has('Tasks') && used.has('Tasks 2'), 'used-set records both');
  const longName = 'y'.repeat(31);
  wb.safeSheetName(longName, used);
  const dup = wb.safeSheetName(longName, used);
  assert.ok(dup.length <= 31 && /2$/.test(dup), 'deduped long name stays within 31 chars');
})();

// ── group → entity keys ──────────────────────────────────────────────────────
(() => {
  const groups = wb.workbookExportGroups();
  assert.strictEqual(groups.map((g) => g.id).join(','), 'crm,fin', 'empty group dropped (no valid entities)');
  assert.strictEqual(groups[0].entityKeys.join(','), 'contact,deal', 'ghost entity filtered out');

  assert.strictEqual(wb.entityKeysForWorkbookGroups(['crm', 'fin']).join(','), 'contact,deal,invoice', 'selected keys deduped across groups');
  assert.strictEqual(wb.entityKeysForWorkbookGroups(['crm']).join(','), 'contact,deal', 'single group');
  assert.strictEqual(wb.entityKeysForWorkbookGroups(['nope']).length, 0, 'unknown group → none');
  assert.strictEqual(wb.selectedWorkbookEntityKeys([]).length, 0, 'no groups → empty');
  assert.strictEqual(wb.selectedWorkbookEntityKeys(null).length, 0, 'null groups → empty');
})();

// ── field-alias import mapping ───────────────────────────────────────────────
const imp = loadMainFunctions(['normalizedImportHeader', 'rowValue', 'configuredFieldAliases', 'rowValueForField']);

(() => {
  // header normalization: lowercase + strip non-alphanumerics
  assert.strictEqual(imp.normalizedImportHeader('Deal Value'), 'dealvalue');
  assert.strictEqual(imp.normalizedImportHeader('E-mail'), 'email');
  assert.strictEqual(imp.normalizedImportHeader(null), '');

  // rowValue: match a row column by normalized header, regardless of case/spacing
  const row = { 'Deal Value': 100, 'E-mail Address': 'a@b.com' };
  assert.strictEqual(imp.rowValue(row, 'deal_value'), 100, 'matches "Deal Value" ⇄ deal_value');
  assert.strictEqual(imp.rowValue(row, 'missing'), '', 'no column → empty string');

  // configuredFieldAliases: normalized-alias → fieldKey, only for existing fields
  const def = {
    fields: [{ key: 'email', label: 'Email' }],
    fieldAliases: { email: ['e-mail', 'Email Address'], ghost: ['x'], bad: 'notarray' },
  };
  const aliases = imp.configuredFieldAliases(def);
  assert.strictEqual(aliases['email'], 'email');
  assert.strictEqual(aliases['emailaddress'], 'email', 'multi-word alias normalized');
  assert.ok(!('x' in aliases), 'alias for a non-existent field is skipped');

  // rowValueForField: resolve via key, then label, then alias
  assert.strictEqual(imp.rowValueForField(row, { key: 'email', label: 'Email' }, def), 'a@b.com', 'resolves the value through an alias column');
  assert.strictEqual(imp.rowValueForField({ Email: 'z@z.com' }, { key: 'email', label: 'Email' }, def), 'z@z.com', 'resolves via the field label');
  assert.strictEqual(imp.rowValueForField({}, { key: 'email', label: 'Email' }, def), '', 'no candidate column → empty');
})();

console.log('workbook.test.js: ok');
