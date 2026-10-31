const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Dates and numbers followed the system locale only, so on a Dutch Windows every
// screenshot read "19 okt" / "US$ 967.000" in an English UI. The workspace
// `locale` setting now decides; empty keeps the system locale.

const f = loadMainFunctions([
  'setDisplayLocale', 'displayLocale', 'dateInfo', 'fmtValue', 'formatStatValue',
  'formatStructuredValue', 'objectIdentity', 'isStructuredValue', 'dateFormatter',
  'currencyFormatter', 'wikilinkDisplayText', 'reminderTimeStr', 'startOfDay',
], { DISPLAY_LOCALE: undefined, _dateFormatter: null, _currencyFormatter: null, CURRENT_CURRENCY: 'USD' });

const may22 = new Date(2026, 4, 22, 12, 0, 0);

// --- An unset or unsupported locale leaves the system default in place.
f.setDisplayLocale('');
assert.strictEqual(f.displayLocale(), undefined);
f.setDisplayLocale('not a locale');
assert.strictEqual(f.displayLocale(), undefined, 'an invalid tag must be ignored, not thrown');
f.setDisplayLocale(42);
assert.strictEqual(f.displayLocale(), undefined);

// --- English.
f.setDisplayLocale(' en-GB ');
assert.strictEqual(f.displayLocale(), 'en-GB');
assert.strictEqual(f.dateInfo(may22).month, 'May');
assert.strictEqual(f.dateInfo(may22).weekday, 'Friday');
assert.strictEqual(f.fmtValue('2026-05-22', 'date'), '22 May 2026');
assert.strictEqual(f.fmtValue(967000, 'currency'), 'US$967,000');
assert.strictEqual(f.formatStatValue(1234.5), '1,234.5');

// --- Switching locale takes effect without a reload (formatters are cached per locale).
f.setDisplayLocale('nl-BE');
assert.strictEqual(f.dateInfo(may22).month, 'mei');
assert.strictEqual(f.fmtValue('2026-05-22', 'date'), '22 mei 2026');
assert.ok(/967\.000/.test(f.fmtValue(967000, 'currency')), f.fmtValue(967000, 'currency'));
assert.strictEqual(f.formatStatValue(1234.5), '1.234,5');

f.setDisplayLocale('en-US');
assert.strictEqual(f.fmtValue('2026-05-22', 'date'), 'May 22, 2026');
assert.strictEqual(f.fmtValue(967000, 'currency'), '$967,000');

f.setDisplayLocale('');
console.log('display-locale.test.js: ok');
