const assert = require('assert');
const { loadReviewModules } = require('./load-review-modules');
class TFile {
  constructor(path, fm = {}) { this.path = path; this.fm = fm; this.stat = { ctime: 1, mtime: 1 }; }
  get name() { return this.path.split('/').pop(); }
  get basename() { return this.name.replace(/\.[^.]+$/, ''); }
  get extension() { return this.name.split('.').pop(); }
}
const notices = [];
class Host { register() {} }
const obsidian = { ItemView: Host, Plugin: Host, Modal: Host, SuggestModal: Host, PluginSettingTab: Host, Component: Host,
  TFile, TFolder: class {}, Notice: class { constructor(text) { notices.push(text); } },
  parseYaml: JSON.parse, stringifyYaml: JSON.stringify, normalizePath: p => p };
class El {
  constructor(tag, opts = {}) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; Object.assign(this, opts); }
  addClass() {} removeClass() {} toggleClass() {} setText(text) { this.text = text; } empty() { this.children = []; }
  createEl(tag, opts) { const el = new El(tag, opts); this.children.push(el); return el; }
  createDiv(opts) { return this.createEl('div', opts); } createSpan(opts) { return this.createEl('span', opts); }
  addEventListener(name, cb) { this.events[name] = cb; } focus() {} select() {}
  all() { return [this, ...this.children.flatMap(c => c.all())]; }
}
const timers = new Map(); let timerId = 0;
const m = loadReviewModules(obsidian, { setTimeout: cb => { timers.set(++timerId, cb); return timerId; }, clearTimeout: id => timers.delete(id) });
function flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(cb => cb()); }
function fixture(initial = {}) {
  const disk = new Map(Object.entries(initial)); const records = []; const calls = [];
  const directories = new Set(['', 'schemas', 'bases', 'plugin']);
  let fail = () => false;
  const adapter = {
    exists: async p => disk.has(p) || directories.has(p),
    read: async p => { if (fail('read', p)) throw Error(`read failed: ${p}`); if (!disk.has(p)) throw Error(`missing: ${p}`); return disk.get(p); },
    write: async (p, text) => { calls.push(['write', p]); if (fail('write', p)) throw Error(`write failed: ${p}`); disk.set(p, text); },
    remove: async p => { if (fail('remove', p)) throw Error(`remove failed: ${p}`); disk.delete(p); },
    mkdir: async p => { directories.add(p); },
    list: async dir => ({ files: [...disk.keys()].filter(p => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')), folders: [] }),
    rename: async (from, to) => { calls.push(['rename', from, to]); if (fail('rename', from)) throw Error(`rename failed: ${from}`); if (!disk.has(from)) throw Error(`missing: ${from}`); disk.set(to, disk.get(from)); disk.delete(from); },
  };
  const app = { vault: { adapter, getMarkdownFiles: () => records.filter(f => f.extension === 'md'),
    getAbstractFileByPath: p => records.find(f => f.path === p) || null,
    createFolder: async p => directories.add(p),
    create: async (p, text) => { const f = new TFile(p); records.push(f); disk.set(p, text); return f; },
  }, metadataCache: { getFileCache: f => ({ frontmatter: f.fm }) },
    fileManager: { processFrontMatter: async (f, cb) => { const next = structuredClone(f.fm); cb(next); f.fm = next; } } };
  return { app, disk, records, calls, fail: fn => { fail = fn; } };
}
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
(async () => {
  // R1/R6: exercise actual detail and inline handlers, plus changes after render.
  const f = fixture(); const note = new TFile('notes/demo.md', { name: 'Demo', object: { paid: true }, records: [{ id: 'x' }], amount: 42, scalar: 'old' }); f.records.push(note);
  const def = { label: 'Demo', plural: 'Demos', typeFilter: 'demo', fields: [
    { key: 'name', label: 'Name', primary: true }, { key: 'object', label: 'Object' },
    { key: 'records', label: 'Records', type: 'tags' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'scalar', label: 'Scalar' },
  ] };
  m.entities.ENTITIES.demo = def;
  const view = Object.create(m.BobAppView.prototype); view.app = f.app; view.plugin = { settings: {} };
  for (const key of ['object', 'records']) {
    const cell = new El('td'); const field = def.fields.find(x => x.key === key);
    view._makeInlineEditable(cell, { file: note, frontmatter: note.fm }, field, def, m.files.fmtValue(note.fm[key], field.type));
    assert.equal(cell.events.click, undefined, 'nested cells cannot activate scalar editing');
    assert.ok(!cell.text.includes('[object Object]'));
  }
  const root = new El('div'); await view.renderEntityDetail(root, 'demo', note);
  const inputs = root.all().filter(e => e.tag === 'input');
  assert.equal(inputs.length, 3, 'nested fields use static summaries even with a tags override');
  const amount = inputs.find(i => i.type === 'number'); amount.value = ''; await amount.events.blur();
  assert.ok(!('amount' in note.fm));
  amount.value = '0'; await amount.events.blur(); assert.equal(note.fm.amount, 0);
  const scalar = inputs.find(i => i.value === 'old'); note.fm.scalar = { external: true };
  scalar.value = 'overwrite'; await scalar.events.blur(); same(note.fm.scalar, { external: true });
  const td = new El('td'); note.fm.scalar = 'old';
  view._makeInlineEditable(td, { file: note, frontmatter: note.fm }, def.fields[4], def, 'old');
  td.events.click(); flushTimers(); const editor = td.children[0]; note.fm.scalar = [{ external: true }];
  await editor.events.blur(); same(note.fm.scalar, [{ external: true }]);
  amount.value = '7'; amount.events.input();
  view._detailSaveCleanup(); await Promise.resolve();
  assert.equal(note.fm.amount, 7, 'navigation flushes pending edits');
  flushTimers(); assert.equal(note.fm.amount, 7);
  assert.throws(() => m.fields.scalarFieldValue('1.5', { key: 'count', type: 'number', schemaType: 'integer' }), /integer/);
  assert.equal(m.fields.scalarFieldValue('false', { key: 'active', type: 'boolean' }), false);

  // R2: load canonical schemas through actual module bindings, then create/match notes.
  const schemas = fixture({
    'schemas/region.yaml': JSON.stringify({ entity: 'regional-context', label: 'Region', type_value: 'research', discriminator: { research_type: 'region', enabled: true }, location_pattern: 'notes/', fields: [{ name: 'name', type: 'string' }, { name: 'steps', type: 'array', items: { type: 'object' } }] }),
    'schemas/research.yaml': JSON.stringify({ entity: 'research', label: 'Research', type_value: 'research', discriminator: { research_type: 'general' }, location_pattern: 'notes/', fields: [{ name: 'name', type: 'string' }] }),
    'schemas/person.yaml': JSON.stringify({ entity: 'person', label: 'Person', type_value: 'person', location_pattern: 'people/', fields: [{ name: 'name', type: 'string' }] }),
  });
  await m.schemas.applySchemas(schemas.app, { schemasFolder: 'schemas' });
  const regional = m.entities.ENTITIES['regional-context'];
  assert.equal(regional.typeFilter, 'research'); same(regional.typeFilters, { research_type: 'region', enabled: true });
  assert.equal(regional.fields.find(x => x.key === 'steps').type, 'structured');
  assert.equal(m.entities.ENTITIES.contact.typeFilter, 'person');
  const templated = m.files.entityTemplate('regional-context', 'Europe');
  assert.ok(templated.includes('"type":"research"')); assert.ok(templated.includes('"research_type":"region"')); assert.ok(templated.includes('"enabled":true'));
  const ownTemplate = { ...regional, template: { frontmatter: { custom: 'kept' }, body: '# {{name}}' } };
  m.entities.ENTITIES['regional-context'] = ownTemplate;
  assert.ok(m.files.entityTemplate('regional-context', 'Europe').includes('"enabled":true'));
  m.entities.ENTITIES['regional-context'] = regional;
  const region = new TFile('notes/Europe.md', { type: 'research', research_type: 'region', enabled: true, name: 'Europe' });
  const general = new TFile('notes/General.md', { type: 'research', research_type: 'general', name: 'General' });
  schemas.records.push(region, general); m.files.invalidateEntityScanCache();
  same(m.files.listEntityFiles(schemas.app, 'regional-context').map(f => f.path), [region.path]);
  same(m.files.listEntityFiles(schemas.app, 'research').map(f => f.path), [general.path]);

  const override = fixture({ 'schemas/override.yaml': JSON.stringify({ entity: 'override', type_value: 'canonical', label: 'Override', location_pattern: 'notes/', fields: [{ name: 'name', type: 'string' }], bob: { typeFilter: 'explicit', typeFilters: { tier: 'gold' } } }) });
  await m.schemas.applySchemas(override.app, { schemasFolder: 'schemas' });
  assert.equal(m.entities.ENTITIES.override.typeFilter, 'explicit'); same(m.entities.ENTITIES.override.typeFilters, { tier: 'gold' });

  // R3: actual SheetJS write/read and import callback preserve types, including punctuation.
  const wbfix = fixture();
  const record = new TFile('notes/Workbook.md', { type: 'demo', name: 'Workbook', active: true, object: { paid: true }, records: [{ id: 'x' }], strings: ['a;b', 'c,d'], text: '{"looks":"json"}', escaped: 'BOB:JSON:v1:literal' }); wbfix.records.push(record);
  m.entities.ENTITIES.demo = { ...def, fields: [...def.fields.filter(x => x.key !== 'scalar'), { key: 'active', type: 'boolean' }, { key: 'strings' }, { key: 'text' }, { key: 'escaped' }] };
  m.files.invalidateEntityScanCache();
  const before = structuredClone(record.fm);
  const rows = m.workbook.entityRowsForWorkbook(wbfix.app, 'demo');
  const XLSX = m.workbook.getXLSX(wbfix.app); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Demos');
  const loaded = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  const imported = XLSX.utils.sheet_to_json(loaded.Sheets.Demos, { defval: '', raw: false });
  const result = await m.workbook.importEntityRows(wbfix.app, 'demo', imported);
  assert.equal(result.updated, 1); same(record.fm, before);
  const bad = await m.workbook.importEntityRows(wbfix.app, 'demo', [{ name: 'Workbook', file_path: record.path, object: 'destroy' }]);
  assert.equal(bad.failed, 1); same(record.fm, before);
  const foreign = new TFile('notes/foreign.md', { type: 'different' }); wbfix.records.push(foreign); m.files.invalidateEntityScanCache();
  assert.equal((await m.workbook.importEntityRows(wbfix.app, 'demo', [{ name: 'Bad', file_path: foreign.path, object: 'bad' }])).failed, 1);
  assert.equal((await m.workbook.importEntityRows(wbfix.app, 'demo', [{ name: 'Bad', file_path: 'missing.md' }])).failed, 1);

  same(m.workbook.normalizeImportValue(m.workbook.xlsxCellValue([[1, 2], []]), { key: 'matrix', schemaType: 'array', items: { type: 'array' } }), [[1, 2], []]);
  same(m.workbook.normalizeImportValue(m.workbook.xlsxCellValue(['ok', null]), { key: 'optional', schemaType: 'array', items: { type: ['string', 'null'] } }), ['ok', null]);

  // R4: read/parse failure means zero writes; second-file failure restores both originals.
  const old = JSON.stringify({ nodes: [{ id: 'user', type: 'text', text: 'keep me' }], edges: [] });
  const meta = JSON.stringify({ source_path: 'note.md', bob_owned_node_ids: [] });
  const data = { nodes: [{ id: 'generated', type: 'text', text: 'new' }], edges: [] };
  const manifest = { source_path: 'note.md', bob_owned_node_ids: ['generated'] };
  for (const failure of ['read', 'parse', 'manifest']) {
    const c = fixture({ 'test.canvas': failure === 'parse' ? '{bad' : old, 'test.canvas.bobmeta.json': failure === 'manifest' ? '{bad' : meta });
    if (failure === 'read') c.fail((op, p) => op === 'read' && p === 'test.canvas');
    await assert.rejects(m.storage.saveGeneratedCanvas(c.app, 'test.canvas', data, manifest));
    assert.equal(c.calls.length, 0);
  }
  const c = fixture({ 'test.canvas': old, 'test.canvas.bobmeta.json': meta }); let once = true;
  c.fail((op, p) => { if (once && op === 'write' && p === 'test.canvas.bobmeta.json') { once = false; return true; } return false; });
  await assert.rejects(m.storage.saveGeneratedCanvas(c.app, 'test.canvas', data, manifest), /previous files restored/);
  assert.equal(c.disk.get('test.canvas'), old); assert.equal(c.disk.get('test.canvas.bobmeta.json'), meta);
  assert.ok(c.disk.has('test.canvas.bob-recovery.json'));
  await assert.rejects(m.storage.saveGeneratedCanvas(c.app, 'test.canvas', data, manifest), /Unresolved canvas recovery/);
  const rollbackFailure = fixture({ 'test.canvas': old, 'test.canvas.bobmeta.json': meta });
  rollbackFailure.fail((op, p) => op === 'write' && p === 'test.canvas.bobmeta.json');
  await assert.rejects(m.storage.saveGeneratedCanvas(rollbackFailure.app, 'test.canvas', data, manifest), /restore failed/);
  const savedRecovery = JSON.parse(rollbackFailure.disk.get('test.canvas.bob-recovery.json'));
  assert.equal(savedRecovery.canvas, old); assert.equal(savedRecovery.manifest, meta);
  const success = fixture({ 'test.canvas': old, 'test.canvas.bobmeta.json': meta });
  await m.storage.saveGeneratedCanvas(success.app, 'test.canvas', data, manifest);
  same(JSON.parse(success.disk.get('test.canvas')).nodes.map(n => n.id).sort(), ['generated', 'user']);
  assert.ok(!success.disk.has('test.canvas.bob-recovery.json'));

  // R5: partial archive restores earlier moves; switch must never write incoming config.
  m.config.initPluginPaths({ manifest: { dir: 'plugin' } });
  m.config.setWorkspaceConfig({ schemas: { folder: 'schemas', enabled: true }, bases: { demo: { file: 'shared/External.base' } } });
  const arch = fixture({ 'schemas/a.yaml': 'A', 'schemas/b.yaml': 'B', 'plugin/workspace.json': '{"old":true}', 'shared/External.base': 'external' });
  arch.fail((op, p) => op === 'rename' && p === 'schemas/b.yaml');
  const plugin = { settings: { activeWorkspaceTemplate: 'old', schemasFolder: 'schemas', basesFolder: 'bases' }, saveSettings: async () => { throw Error('must not be called'); } };
  await assert.rejects(m.templates.applyWorkspaceTemplate(arch.app, plugin, { _template: { id: 'new' }, schemas: { enabled: true, folder: 'schemas' } }), /Archive failed/);
  assert.equal(arch.disk.get('schemas/a.yaml'), 'A'); assert.equal(arch.disk.get('schemas/b.yaml'), 'B');
  assert.equal(arch.disk.get('plugin/workspace.json'), '{"old":true}');
  assert.equal(plugin.settings.activeWorkspaceTemplate, 'old');
  const journal = [...arch.disk.keys()].find(p => p.startsWith('plugin/template-switch-'));
  const recovery = JSON.parse(arch.disk.get(journal)); assert.equal(recovery.phase, 'archive-failed');
  assert.equal(recovery.externalBases['shared/External.base'], 'external');
  assert.equal(arch.disk.get('shared/External.base'), 'external');

  const later = fixture({ 'schemas/a.yaml': 'A', 'plugin/workspace.json': '{"old":true}' });
  const laterPlugin = { settings: { activeWorkspaceTemplate: 'old', schemasFolder: 'schemas', basesFolder: 'bases' }, saveSettings: async () => { throw Error('settings failed'); } };
  await assert.rejects(m.templates.applyWorkspaceTemplate(later.app, laterPlugin, { _template: { id: 'new' }, schemas: { enabled: true, folder: 'schemas' } }), /recovery:/);
  const laterPath = [...later.disk.keys()].find(p => p.startsWith('plugin/template-switch-'));
  const laterRecovery = JSON.parse(later.disk.get(laterPath));
  assert.equal(laterRecovery.settings.activeWorkspaceTemplate, 'old', 'recovery settings must not alias mutated plugin settings');
  assert.equal(laterRecovery.phase, 'apply-failed'); assert.equal(laterRecovery.workspace, '{"old":true}');
  assert.equal(later.disk.get(laterRecovery.moves[0].to), 'A', 'archived bytes remain recoverable after apply failure');

  const applied = fixture({ 'schemas/a.yaml': 'A', 'plugin/workspace.json': '{"old":true}' });
  m.config.setWorkspaceConfig({ schemas: { enabled: false, folder: 'schemas' } });
  const appliedPlugin = { settings: { activeWorkspaceTemplate: 'old', schemasFolder: 'schemas', basesFolder: 'bases' }, saveSettings: async () => {}, refreshOpenViews: () => {} };
  await m.templates.applyWorkspaceTemplate(applied.app, appliedPlugin, { _template: { id: 'new' }, schemas: { enabled: false, folder: 'schemas' } });
  const appliedJournal = JSON.parse(applied.disk.get([...applied.disk.keys()].find(p => p.startsWith('plugin/template-switch-'))));
  assert.equal(appliedJournal.phase, 'applied'); assert.equal(appliedJournal.settings.activeWorkspaceTemplate, 'old');
  assert.equal(appliedPlugin.settings.activeWorkspaceTemplate, 'new');

  // R7: selection transitions are distinct; empty selection never means all.
  const values = ['a', 'b'];
  const filter = selected => values.filter(value => m.fields.matchesEnumSelection(value, selected));
  same(filter(undefined), ['a', 'b']); same(filter(new Set(['a'])), ['a']); same(filter(new Set()), []); same(filter(undefined), ['a', 'b']);
  console.log('review-fixes.test.js: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
