const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Regression: normalizePinnedSurfaces must NOT drop pins for surfaces that
// aren't in SURFACE_BY_ID. It runs during loadSettings, before workspace.json
// navigation surfaces are built; filtering there lost every configured-surface
// pin on restart. It should dedupe + drop blanks only.
const { normalizePinnedSurfaces } = loadMainFunctions(['normalizePinnedSurfaces'], {});
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

console.log('pinned-surfaces.test.js: ok');
