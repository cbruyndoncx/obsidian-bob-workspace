const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadMainFunctions } = require('./load-main-functions');

// Found in the 2026-10-21 demo-vault screenshots of the Client Work overview:
// Recent Feedback titled a row "[[chris_brennan]]" (a link-valued `respondent`
// shown raw), and Recent Meetings titled rows "discovery" / "qbr" because the
// template listed `context` before `title` in the card's titleFields.

const { wikilinkDisplayText, fmtValue } = loadMainFunctions([
  'wikilinkDisplayText', 'fmtValue', 'formatStructuredValue', 'objectIdentity',
  'isStructuredValue', 'dateFormatter', 'currencyFormatter', 'displayLocale',
], { DISPLAY_LOCALE: undefined });

// --- wikilinkDisplayText: one whole wikilink becomes its display text.
assert.strictEqual(wikilinkDisplayText('[[chris_brennan]]'), 'chris_brennan');
assert.strictEqual(wikilinkDisplayText('[[chris_brennan|Chris Brennan]]'), 'Chris Brennan');
assert.strictEqual(wikilinkDisplayText('[[30-CLIENTS/acme/Acme Corp.md]]'), 'Acme Corp');
assert.strictEqual(wikilinkDisplayText('[[Acme Corp#Contacts]]'), 'Acme Corp');
assert.strictEqual(wikilinkDisplayText('[[Acme Corp#^block|Acme]]'), 'Acme');
assert.strictEqual(wikilinkDisplayText('  [[Acme Corp]] '), 'Acme Corp');
assert.strictEqual(wikilinkDisplayText('![[diagram.png]]'), 'diagram.png');
// Anything else passes through untouched.
assert.strictEqual(wikilinkDisplayText('northwind-traders'), 'northwind-traders');
assert.strictEqual(wikilinkDisplayText('see [[Acme]] and [[Contoso]]'), 'see [[Acme]] and [[Contoso]]');
assert.strictEqual(wikilinkDisplayText('[[Acme]] [[Contoso]]'), '[[Acme]] [[Contoso]]');
assert.strictEqual(wikilinkDisplayText(''), '');

// --- fmtValue (meta lines, table cells) shows link text, alone or in a list.
assert.strictEqual(fmtValue('[[chris_brennan]]'), 'chris_brennan');
assert.strictEqual(fmtValue(['[[Acme Corp]]', '[[contoso|Contoso Ltd]]']), 'Acme Corp, Contoso Ltd');
assert.strictEqual(fmtValue('reviewed'), 'reviewed');

// --- Every bundled template titles meeting cards by `title` first.
const templatesDir = path.join(__dirname, '..', 'templates');
let meetingCards = 0;
const walk = (node, file) => {
  if (Array.isArray(node)) return node.forEach((item) => walk(item, file));
  if (!node || typeof node !== 'object') return;
  if (node.entity === 'meeting' && Array.isArray(node.titleFields)) {
    meetingCards++;
    assert.strictEqual(node.titleFields[0], 'title', `${file}: meeting card "${node.title}" must title rows by \`title\` first`);
  }
  Object.values(node).forEach((value) => walk(value, file));
};
for (const file of fs.readdirSync(templatesDir).filter((f) => f.endsWith('.json'))) {
  walk(JSON.parse(fs.readFileSync(path.join(templatesDir, file), 'utf8')), file);
}
assert.ok(meetingCards >= 2, `expected the bob and cadence meeting cards, found ${meetingCards}`);

// --- No literal backslash before an apostrophe in UI text. `today\\'s` inside a
// template literal printed "today\'s note" on Home (2026-07 and 2026-10 screenshots).
const srcDir = path.join(__dirname, '..', 'src');
const offenders = [];
const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(p); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (/\\\\'[a-z]/.test(line)) offenders.push(`${path.relative(srcDir, p)}:${i + 1}`);
    });
  }
};
scan(srcDir);
assert.deepStrictEqual(offenders, [], `escaped apostrophe prints a backslash: ${offenders.join(', ')}`);

console.log('display-titles.test.js: ok');
