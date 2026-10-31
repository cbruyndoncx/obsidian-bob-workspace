const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadMainFunctions } = require('./load-main-functions');

// Canonical schemas name their folders through context-pack keys
// (`location_pattern: "{client.profile-root}/"`). The plugin kept only the literal
// text before the first `{`, so every such schema resolved to no folder at all.

const f = loadMainFunctions(
  ['contextPackFromManifest', 'resolveContextKeys', 'foldersFromLocationPattern', 'locationPatternForCreate'],
  { trimSlash: (s) => s.replace(/\/+$/, '') },
);

// A slice of the framework default, same shape as assets/default-context.yaml.
const defaultManifest = {
  pack: 'default',
  roots: { workspace: '.', company: '20-COMPANY', clients: '30-CLIENTS', projects: '50-PROJECTS' },
  keys: {
    'company.decisions': { path: '20-COMPANY/02-DECISIONS/', summary: 'x' },
    'company.projects': { path: '50-PROJECTS/', summary: 'x' },
    'client.profile-root': { path: '30-CLIENTS/{id}/00-PROFILE/', summary: 'x' },
    'client.decisions': { path: '30-CLIENTS/{id}/02-DECISIONS/', summary: 'x' },
    'partner.commissions': { path: '20-COMPANY/35-PARTNERS/{id}/COMMISSIONS/', summary: 'x' },
    'project.root': { path: '50-PROJECTS/{id}/', summary: 'x' },
  },
};
const base = f.contextPackFromManifest(defaultManifest);
assert.strictEqual(base.keys['client.profile-root'], '30-CLIENTS/{id}/00-PROFILE/');
assert.strictEqual(base.roots.clients, '30-CLIENTS');

// --- extends: default — a moved root carries its keys; a declared key is used as written.
const vault = f.contextPackFromManifest({
  extends: 'default',
  roots: { projects: '50-BRNCX-PROJECTS' },
  keys: { 'me.job-search.inbox': { path: '10-ME/40-JOB-SEARCH/Jobs/Inbox/', summary: 'x' }, 'company.decisions': { path: 'Decisions/' } },
}, base);
assert.strictEqual(vault.keys['company.projects'], '50-BRNCX-PROJECTS/', 'moving a root moves the key that is that root');
assert.strictEqual(vault.keys['project.root'], '50-BRNCX-PROJECTS/{id}/', 'and every key under it');
assert.strictEqual(vault.keys['client.profile-root'], '30-CLIENTS/{id}/00-PROFILE/', 'keys under other roots are untouched');
assert.strictEqual(vault.keys['company.decisions'], 'Decisions/', 'a declared key wins, as written');
assert.strictEqual(vault.keys['me.job-search.inbox'], '10-ME/40-JOB-SEARCH/Jobs/Inbox/', 'a new key is added');
// Without `extends`, a manifest stands alone.
assert.strictEqual(f.contextPackFromManifest({ keys: { 'a.b': { path: 'X/' } } }, base).keys['client.profile-root'], undefined);

// --- Key resolution leaves record placeholders alone and refuses unknown keys.
assert.strictEqual(f.resolveContextKeys('{client.profile-root}/', base), '30-CLIENTS/{id}/00-PROFILE/');
assert.strictEqual(f.resolveContextKeys('{~client.decisions}/', base), '30-CLIENTS/{id}/02-DECISIONS/');
assert.strictEqual(f.resolveContextKeys('30-CLIENTS/{client-id}/00-PROFILE/', base), '30-CLIENTS/{client-id}/00-PROFILE/');
assert.strictEqual(f.resolveContextKeys('{nowhere.key}/', base), null);

// --- Folders, as the entity scan matches them.
// Loose compare: vm-sandbox arrays fail deepStrictEqual's prototype check.
const sameList = (actual, expected, msg) => assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), msg);
sameList(f.foldersFromLocationPattern('"{client.profile-root}/"', base), ['30-CLIENTS']);
sameList(f.foldersFromLocationPattern('{company.decisions}/ or {client.decisions}/ or {nowhere.key}/', base), ['20-COMPANY/02-DECISIONS', '30-CLIENTS']);
sameList(f.foldersFromLocationPattern('{partner.commissions}/', base), ['20-COMPANY/35-PARTNERS']);
sameList(f.foldersFromLocationPattern('10-ME/10-PEOPLE/ or 30-CLIENTS/{id}/10-PEOPLE/', base), ['10-ME/10-PEOPLE', '30-CLIENTS'], 'literal patterns keep working');
sameList(f.foldersFromLocationPattern('*/20-MEETINGS/', base), []);
sameList(f.foldersFromLocationPattern('20-COMPANY/06-FINANCE/ENTITY.md', base), ['20-COMPANY/06-FINANCE'], 'a file location matches as its folder');
sameList(f.foldersFromLocationPattern('{company.decisions}/', vault), ['Decisions'], 'the vault pack decides');

// --- Create patterns: the generic {id} becomes the key's scope id.
assert.strictEqual(f.locationPatternForCreate('{partner.commissions}/', base), '20-COMPANY/35-PARTNERS/{partner-id}/COMMISSIONS/');
assert.strictEqual(f.locationPatternForCreate('{company.decisions}/ or {client.decisions}/', base), '20-COMPANY/02-DECISIONS/ or 30-CLIENTS/{client-id}/02-DECISIONS/');
assert.strictEqual(f.locationPatternForCreate('{nowhere.key}/', base), '');

// --- The embedded default is the context-pack default, and carries the keys schemas use.
const embedded = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'context-default.json'), 'utf8')).yaml;
assert.ok(/^pack: default$/m.test(embedded), 'embedded text is the default pack');
for (const [key, p] of [['client.profile-root', '30-CLIENTS/{id}/00-PROFILE/'], ['partner.commissions', '20-COMPANY/35-PARTNERS/{id}/COMMISSIONS/'], ['company.decisions', '20-COMPANY/02-DECISIONS/']]) {
  assert.ok(embedded.includes(`  ${key}:\n    path: ${p}\n`), `embedded default declares ${key}`);
}
// --- Every schema the BOB template embeds resolves to at least one folder through the
// embedded default pack (key/path pairs read straight from its text).
const defaultKeys = {};
for (const m of embedded.matchAll(/^  ([a-z0-9][a-z0-9.~-]*):\n    path: (.+)$/gm)) defaultKeys[m[1]] = m[2].trim();
const embeddedPack = f.contextPackFromManifest({ keys: Object.fromEntries(Object.entries(defaultKeys).map(([k, v]) => [k, { path: v }])) });
const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'workspace-bob.json'), 'utf8'));
const unresolved = [];
for (const [entity, body] of Object.entries(template._assets.schemas)) {
  const loc = (/^location_pattern: (.*)$/m.exec(body) || [])[1];
  if (!loc) continue;
  if (!f.foldersFromLocationPattern(loc.trim(), embeddedPack).length) unresolved.push(`${entity}: ${loc.trim()}`);
}
assert.deepStrictEqual(unresolved, [], `template schemas whose location resolves to no folder:\n  ${unresolved.join('\n  ')}`);

const canonical = process.env.BOB_CONTEXT_DEFAULT;
if (canonical && fs.existsSync(canonical)) {
  assert.strictEqual(embedded, fs.readFileSync(canonical, 'utf8'), `vendor/context-default.json drifted from ${canonical} — run npm run sync-context`);
  console.log('context-pack.test.js: ok');
} else {
  console.log('context-pack.test.js: ok (embedded text only; BOB_CONTEXT_DEFAULT not set)');
}
