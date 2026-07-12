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

console.log('canvas.test.js: ok');
