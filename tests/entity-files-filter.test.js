const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// Coverage for listEntityFiles' filter categories + the template-path exclusion
// (previously untested — see TODO "Test gaps").

const files = [
  mk('10-ME/10-PEOPLE/alice.md', 'alice.md', { type: 'person' }),
  mk('10-ME/10-PEOPLE/bob.md', 'bob.md', { type: 'person' }),
  mk('20-COMPANY/acme.md', 'acme.md', { type: 'company' }),
  mk('x/p1.md', 'p1.md', { type: 'profile', profile_type: 'partner' }),
  mk('x/p2.md', 'p2.md', { type: 'profile', profile_type: 'reseller' }),
  mk('skills/a/SKILL.md', 'SKILL.md', {}),
  mk('skills/a/README.md', 'README.md', {}),
  mk('A/one.md', 'one.md', {}),
  mk('B/two.md', 'two.md', {}),
  mk('C/three.md', 'three.md', {}),
];

function mk(path, name, frontmatter) {
  return { path, name, basename: name.replace(/\.md$/, ''), stat: { ctime: 0, mtime: 0 }, frontmatter };
}

const ENTITIES = {
  // typeFilter → matches by frontmatter type ANYWHERE (no folder restriction)
  contact: { typeFilter: 'person' },
  // typeFilters → AND across fields (folders keeps the default-path filter off the target)
  partner: { typeFilters: { type: 'profile', profile_type: 'partner' }, folders: ['x'] },
  // filenameFilter + default folder
  skill: { filenameFilter: 'SKILL.md', folder: 'skills' },
  // folders array → OR across roots
  multi: { folders: ['A', 'B'] },
  // single default folder
  single: { folder: 'C' },
};

const { listEntityFiles, isTemplatePath } = loadMainFunctions(['listEntityFiles', 'isTemplatePath'], {
  ENTITIES,
  scannableMarkdownFiles: () => files,
  entityFolder: (k) => ENTITIES[k].folder || '',
  evaluateBaseFilterNode: () => true,
  readEntity: (app, f) => ({ file: f }),
});

const app = { metadataCache: { getFileCache: (f) => ({ frontmatter: f.frontmatter || {} }) } };
// spread into a test-realm array so deepStrictEqual doesn't trip on the
// sandbox realm's Array prototype
const paths = (key) => [...listEntityFiles(app, key)].map((f) => f.path).sort();

(() => {
  assert.deepStrictEqual(paths('contact'), ['10-ME/10-PEOPLE/alice.md', '10-ME/10-PEOPLE/bob.md'], 'typeFilter matches by type, ignores folder');
  assert.deepStrictEqual(paths('partner'), ['x/p1.md'], 'typeFilters AND-combines (partner only, not reseller)');
  assert.deepStrictEqual(paths('skill'), ['skills/a/SKILL.md'], 'filenameFilter + folder (SKILL.md under skills only)');
  assert.deepStrictEqual(paths('multi'), ['A/one.md', 'B/two.md'], 'folders array is OR (A or B, not C)');
  assert.deepStrictEqual(paths('single'), ['C/three.md'], 'default single-folder prefix');
  assert.strictEqual(listEntityFiles(app, 'nope').length, 0, 'unknown entity → empty');
})();

(() => {
  // template-path exclusion is by DIRECTORY segment, case-insensitive, not filename
  assert.strictEqual(isTemplatePath('a/templates/b.md'), true, 'templates/ dir excluded');
  assert.strictEqual(isTemplatePath('a/template/b.md'), true, 'template/ dir excluded');
  assert.strictEqual(isTemplatePath('Templates/x.md'), true, 'case-insensitive');
  assert.strictEqual(isTemplatePath('a/b/template.md'), false, 'template.md filename NOT excluded');
  assert.strictEqual(isTemplatePath('a/b/c.md'), false, 'ordinary path not excluded');
})();

console.log('entity-files-filter.test.js: ok');
