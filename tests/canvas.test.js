const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

// buildBoardCanvas is a pure JSON Canvas layout function — verify it emits a
// valid canvas (one group per column + a node per card) and serializes to
// parseable JSON.
const { buildBoardCanvas, serializeCanvas } = loadMainFunctions(
  ['buildBoardCanvas', 'serializeCanvas'],
  { CARD_W: 260, CARD_H: 80, CARD_GAP: 14, COL_PAD: 20, COL_GAP: 48, HEADER: 52 },
);

(() => {
  const columns = [
    { label: 'Lead', color: '1', cards: [{ file: 'a.md' }, { file: 'b.md' }] },
    { label: 'Won', color: '4', cards: [{ file: 'c.md' }] },
    { label: 'Empty', cards: [] },
  ];
  const data = buildBoardCanvas(columns);

  const groups = data.nodes.filter((n) => n.type === 'group');
  const cards = data.nodes.filter((n) => n.type === 'file');
  assert.strictEqual(groups.length, 3, 'one group per column');
  assert.strictEqual(cards.length, 3, 'one file node per card');
  assert.strictEqual(groups[0].label, 'Lead · 2', 'group label carries the count');
  assert.strictEqual(groups[0].color, '1', 'column color preserved');
  assert.ok(!('color' in groups[2]), 'no color key when column has none');
  assert.ok(Array.isArray(data.edges) && data.edges.length === 0, 'board has no edges');

  // unique ids
  const ids = new Set(data.nodes.map((n) => n.id));
  assert.strictEqual(ids.size, data.nodes.length, 'node ids are unique');

  // columns are laid out left-to-right (strictly increasing x)
  assert.ok(groups[1].x > groups[0].x && groups[2].x > groups[1].x, 'columns advance in x');

  // serialization round-trips
  const parsed = JSON.parse(serializeCanvas(data));
  assert.strictEqual(parsed.nodes.length, data.nodes.length, 'serialized canvas parses back');
})();

// Stable IDs + context-explosion layout foundations.
const ctx = loadMainFunctions(
  ['shortHash', 'canvasNodeId', 'buildContextExplosion', 'entityCard', 'insightCard', 'externalCard', 'zone', 'signalEdge'],
  { CARD_W: 260, CARD_H: 80, CARD_GAP: 14, COL_PAD: 20, COL_GAP: 48, HEADER: 52,
    FW: 380, FH: 150, SW: 380, SH: 180, CW: 320, CH: 110, GX: 150, GY: 90, ZP: 30,
    BOB_COLOR: { risk: '1', attention: '2', pending: '3', healthy: '4', info: '5', ai: '6' } },
);

(() => {
  // stable + deterministic
  assert.strictEqual(ctx.shortHash('a|b|c'), ctx.shortHash('a|b|c'), 'hash is deterministic');
  assert.notStrictEqual(ctx.shortHash('x'), ctx.shortHash('y'), 'hash discriminates');
  const id1 = ctx.canvasNodeId('entity-context', 'A.md', 'focal');
  assert.strictEqual(id1, ctx.canvasNodeId('entity-context', 'A.md', 'focal'), 'node id is stable across calls');
  assert.ok(id1.startsWith('focal-'), 'node id carries its role');

  const spec = {
    intent: 'entity-context', source: 'Focal.md',
    focal: { file: 'Focal.md' }, summary: '# Focal',
    left:  { label: 'Evidence', items: [{ role: 'note', target: 'e1.md', file: 'e1.md' }] },
    top:   { label: 'People', color: '5', items: [{ role: 'contact', target: 'p1.md', file: 'p1.md' }, { role: 'url:website', url: 'https://x.example' }] },
    right: { label: 'Outputs', color: '4', items: [{ role: 'invoice', target: 'i1.md', file: 'i1.md' }] },
    bottom:{ label: 'Risks', color: '1', items: [{ role: 'issue', target: 'r1.md', file: 'r1.md' }] },
    edgeLabels: { left: 'evidence', top: 'informs', right: 'produces', bottom: 'at risk' },
  };
  const { data, ownedIds } = ctx.buildContextExplosion(spec);

  const focal = data.nodes.filter((n) => n.type === 'file' && n.file === 'Focal.md');
  assert.strictEqual(focal.length, 1, 'one focal node');
  assert.ok(data.nodes.some((n) => n.type === 'text' && /Focal/.test(n.text)), 'summary node present');
  assert.ok(data.nodes.some((n) => n.type === 'link' && n.url === 'https://x.example'), 'external URL becomes a link node');
  assert.strictEqual(data.nodes.filter((n) => n.type === 'group').length, 4, 'one zone per non-empty quadrant');
  // 5 related items (1+2+1+1) each get an edge from the focal
  assert.strictEqual(data.edges.length, 5, 'an edge per related card');
  assert.ok(data.edges.every((e) => e.label), 'edges are labelled (signal edges)');

  // ids unique + stable set exported
  const ids = new Set(data.nodes.map((n) => n.id).concat(data.edges.map((e) => e.id)));
  assert.strictEqual(ids.size, data.nodes.length + data.edges.length, 'all ids unique');
  assert.strictEqual(ownedIds.length, data.nodes.length + data.edges.length, 'manifest owns every generated id');

  // regeneration determinism: same spec → same ids
  const again = ctx.buildContextExplosion(spec);
  assert.deepStrictEqual(again.ownedIds.slice().sort(), ownedIds.slice().sort(), 'regeneration yields identical ids');
})();

console.log('canvas.test.js: ok');
