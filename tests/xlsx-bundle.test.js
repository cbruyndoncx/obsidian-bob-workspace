const assert = require('assert');
const path = require('path');

/*
 * The SheetJS (mini) library ships inside main.js: src/bundled/xlsx.ts
 * require()s vendor/xlsx.mini.min.js and esbuild inlines it as a lazy
 * CommonJS module (build-freshness.test.js guarantees main.js reflects the
 * vendored source). Here we require the vendored lib the same way and
 * round-trip the exact export → import path the plugin uses.
 */

const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx.mini.min.js'));

assert.ok(XLSX && XLSX.utils, 'vendored XLSX exposes utils');
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

// And the built artifact must actually carry the inlined library.
const fs = require('fs');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.ok(main.includes('vendor/xlsx.mini.min.js'), 'main.js carries the inlined vendored XLSX module');

console.log('xlsx-bundle.test.js: ok');
