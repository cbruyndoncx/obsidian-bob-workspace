const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

// Pull the inlined loadBundledXLSX() out of main.js by its markers.
const BEGIN = '/* ===BEGIN BUNDLED_XLSX';
const END = '/* ===END BUNDLED_XLSX=== */';
const begin = main.indexOf(BEGIN);
const end = main.indexOf(END);
assert.ok(begin >= 0 && end > begin, 'BUNDLED_XLSX markers present in main.js');
let fnText = main.slice(main.indexOf('function loadBundledXLSX', begin), end).trim();
assert.ok(fnText.startsWith('function loadBundledXLSX'), 'loadBundledXLSX inlined (run: node scripts/bundle-xlsx.js)');
assert.ok(fnText.length > 100000, 'XLSX library appears inlined, not a stub');

// Evaluate in this context so the lib sees node's real globals (typed arrays, etc.).
const loadBundledXLSX = vm.runInThisContext(`(${fnText})`);
const XLSX = loadBundledXLSX();

assert.ok(XLSX && XLSX.utils, 'bundled XLSX exposes utils');
for (const fn of ['book_new', 'json_to_sheet', 'book_append_sheet', 'sheet_to_json', 'sheet_to_csv']) {
  assert.strictEqual(typeof XLSX.utils[fn], 'function', `utils.${fn} present`);
}
assert.strictEqual(typeof XLSX.write, 'function', 'XLSX.write present');
assert.strictEqual(typeof XLSX.read, 'function', 'XLSX.read present');

// Round-trip the exact path main.js uses for export → import.
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet([{ name: 'Acme', value: 42 }, { name: 'Beta', value: 7 }]);
XLSX.utils.book_append_sheet(wb, ws, 'Deals');
const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
const wb2 = XLSX.read(buf, { type: 'array', cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb2.Sheets['Deals'], { defval: '', raw: false });
assert.strictEqual(rows.length, 2, 'round-trip preserves rows');
assert.strictEqual(rows[0].name, 'Acme', 'round-trip preserves values');

console.log('xlsx-bundle.test.js: ok');
