const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Regression: normalizePinnedSurfaces must NOT drop pins for surfaces that
// aren't in SURFACE_BY_ID. It runs during loadSettings, before workspace.json
// navigation surfaces are built; filtering there lost every configured-surface
// pin on restart. It should dedupe + drop blanks only.
const { normalizePinnedSurfaces, reorderPinnedList } = loadMainFunctions(['normalizePinnedSurfaces', 'reorderPinnedList'], {});
// vm-realm arrays aren't reference-comparable across realms — compare by JSON.
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// keeps ids regardless of any surface registry (none provided here)
eq(normalizePinnedSurfaces(['crm.pipeline', 'planner.today', 'finance.gl']),
   ['crm.pipeline', 'planner.today', 'finance.gl']);
// dedupes, preserves first-seen order
eq(normalizePinnedSurfaces(['a', 'b', 'a', 'c', 'b']), ['a', 'b', 'c']);
// drops blanks / non-strings; non-arrays → []
eq(normalizePinnedSurfaces(['', null, 'x', 5, undefined, 'y']), ['x', 'y']);
eq(normalizePinnedSurfaces(null), []);
eq(normalizePinnedSurfaces('crm.pipeline'), []);

// reorderPinnedList: move dragged to target's position
eq(reorderPinnedList(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c']); // drag d before b
eq(reorderPinnedList(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);            // drag a onto c
assert.strictEqual(reorderPinnedList(['a', 'b'], 'a', 'a'), null);            // no-op (same)
assert.strictEqual(reorderPinnedList(['a', 'b'], 'x', 'b'), null);            // dragged absent
assert.strictEqual(reorderPinnedList(['a', 'b'], 'a', 'z'), null);            // target absent
// dedupes before moving
eq(reorderPinnedList(['a', 'b', 'a', 'c'], 'c', 'a'), ['c', 'a', 'b']);

console.log('pinned-surfaces.test.js: ok');
