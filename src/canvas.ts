import type { App, TFile } from 'obsidian';
import { ENTITIES, dealStageField, getDealStages, entityKeyFromFile } from './entities';
import { listEntities } from './entity-files';

/* ── JSON Canvas (jsoncanvas.org) render layer ─────────────────────────────
 * JSON Canvas is an open MIT spec: nodes (text/file/link/group) + edges with
 * coordinates. BOB treats it as a *render target for context surfaces* —
 * deterministic canvases generated from vault state — not a manual drawing
 * tool. Everything here is pure/structured writes: no unstable API. */

export interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number; y: number; width: number; height: number;
  color?: string;
  text?: string;   // type: text
  file?: string;   // type: file
  url?: string;    // type: link
  label?: string;  // type: group
}
export interface CanvasEdge {
  id: string; fromNode: string; toNode: string;
  fromSide?: string; toSide?: string; label?: string; color?: string;
}
export interface CanvasData { nodes: CanvasNode[]; edges: CanvasEdge[]; }

/** BOB render manifest — stored beside a generated .canvas so the file itself
 *  stays 100% standard while BOB keeps higher-level render logic. */
export interface CanvasManifest {
  source_path: string;
  source_type: string;
  template: string;
  generated_at: string;
  query_hash: string;
  bob_owned_node_ids: string[];
}

/* ── Semantic palette — JSON Canvas preset colors 1..6 map 1:1 to BOB's
 * meanings, so color is a fast scanning aid while layout does the real work. */
export const BOB_COLOR = {
  risk: '1',       // red — blocked / at risk
  attention: '2',  // orange — needs attention
  pending: '3',    // yellow — waiting
  healthy: '4',    // green — healthy / complete
  info: '5',       // cyan — informational / linked context
  ai: '6',         // purple — AI / generated insight
} as const;

/* ── Stable IDs — derived from intent+source+role(+target) so a regenerated
 * canvas keeps the same node/edge ids and edge references never break. */
export function shortHash(input: string): string {
  let h = 5381;
  const s = String(input);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export function canvasNodeId(intent: string, source: string, role: string, target = ''): string {
  return `${role}-${shortHash(`${intent}|${source}|${role}|${target}`)}`;
}

/* ── Node taxonomy — thin, spec-compatible helpers so every canvas is uniform.
 * Entity card = file · Insight card = text · External card = link · Zone = group. */
type Box = { id: string; x: number; y: number; width: number; height: number; color?: string };
export function entityCard(box: Box, file: string): CanvasNode { return { ...box, type: 'file', file }; }
export function insightCard(box: Box, text: string): CanvasNode { return { ...box, type: 'text', text }; }
export function externalCard(box: Box, url: string): CanvasNode { return { ...box, type: 'link', url }; }
export function zone(box: Box, label: string): CanvasNode { return { ...box, type: 'group', label }; }
export function signalEdge(id: string, from: string, to: string, label: string, sides?: { from?: string; to?: string }, color?: string): CanvasEdge {
  const e: CanvasEdge = { id, fromNode: from, toNode: to };
  if (label) e.label = label;
  if (sides?.from) e.fromSide = sides.from;
  if (sides?.to) e.toSide = sides.to;
  if (color) e.color = color;
  return e;
}

export function serializeCanvas(data: CanvasData): string {
  return JSON.stringify(data, null, 2);
}

/* ─────────────────────────── Board layout (pipeline) ─────────────────────── */

export interface BoardCard { file?: string; text?: string; }
export interface BoardColumn { label: string; color?: string; cards: BoardCard[]; }

const CARD_W = 260, CARD_H = 80, CARD_GAP = 14, COL_PAD = 20, COL_GAP = 48, HEADER = 52;

export function buildBoardCanvas(columns: BoardColumn[]): CanvasData {
  const nodes: CanvasNode[] = [];
  let seq = 0;
  const nid = () => `n${++seq}`;
  const colOuterW = CARD_W + COL_PAD * 2;
  columns.forEach((col, ci) => {
    const x = ci * (colOuterW + COL_GAP);
    const count = col.cards.length;
    const height = HEADER + COL_PAD + Math.max(count, 1) * (CARD_H + CARD_GAP);
    const group: CanvasNode = { id: nid(), type: 'group', x, y: 0, width: colOuterW, height, label: `${col.label} · ${count}` };
    if (col.color) group.color = col.color;
    nodes.push(group);
    col.cards.forEach((card, i) => {
      const y = HEADER + COL_PAD + i * (CARD_H + CARD_GAP);
      const base = { id: nid(), x: x + COL_PAD, y, width: CARD_W, height: CARD_H };
      nodes.push(card.file ? { ...base, type: 'file', file: card.file } : { ...base, type: 'text', text: card.text || '' });
    });
  });
  return { nodes, edges: [] };
}

export function buildPipelineCanvasData(app: App): CanvasData | null {
  const def = ENTITIES.deal;
  if (!def) return null;
  const stageField = dealStageField(def);
  const stages = getDealStages(def);
  const buckets = new Map<string, BoardCard[]>();
  stages.forEach((s) => buckets.set(s, []));
  const unassigned: BoardCard[] = [];
  for (const deal of listEntities(app, 'deal')) {
    const stage = String(deal.frontmatter?.[stageField] ?? '').trim();
    const card: BoardCard = { file: deal.file.path };
    const arr = buckets.get(stage);
    if (arr) arr.push(card); else unassigned.push(card);
  }
  const columns: BoardColumn[] = stages.map((stage, i) => ({ label: stage, color: String((i % 6) + 1), cards: buckets.get(stage) || [] }));
  if (unassigned.length) columns.push({ label: 'Unassigned', cards: unassigned });
  return buildBoardCanvas(columns);
}

/* ─────────────────────── Context-explosion layout ───────────────────────── */

export interface ContextItem { role: string; target?: string; file?: string; url?: string; text?: string; color?: string; }
export interface ContextQuadrant { label: string; color?: string; items: ContextItem[]; }
export interface ContextSpec {
  intent: string;
  source: string;
  focal: { file: string; color?: string };
  summary: string;
  left: ContextQuadrant;   // evidence
  top: ContextQuadrant;    // people / systems
  right: ContextQuadrant;  // outputs
  bottom: ContextQuadrant; // risks / next actions
  edgeLabels: { left: string; top: string; right: string; bottom: string };
}

const FW = 380, FH = 150, SW = 380, SH = 180, CW = 320, CH = 110, GX = 150, GY = 90, ZP = 30;

// Focal object at center; evidence left, people/systems top, outputs right,
// risks bottom; a generated summary sits top-centre. Deterministic grid so the
// canvas reads as structure before any text.
export function buildContextExplosion(spec: ContextSpec): { data: CanvasData; ownedIds: string[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const groups: CanvasNode[] = [];
  const nid = (role: string, target = '') => canvasNodeId(spec.intent, spec.source, role, target);
  const fcx = FW / 2, fcy = FH / 2;

  const stackV = (items: ContextItem[], x: number) => {
    const total = items.length * CH + Math.max(items.length - 1, 0) * GY;
    const startY = fcy - total / 2;
    return items.map((it, i) => ({ it, x, y: startY + i * (CH + GY) }));
  };
  const stackH = (items: ContextItem[], y: number) => {
    const total = items.length * CW + Math.max(items.length - 1, 0) * GX;
    const startX = fcx - total / 2;
    return items.map((it, i) => ({ it, x: startX + i * (CW + GX), y }));
  };
  const place = (positioned: { it: ContextItem; x: number; y: number }[], sides: { from: string; to: string }, edgeLabel: string) => {
    for (const p of positioned) {
      const id = nid(p.it.role, p.it.target || p.it.url || p.it.text || '');
      const box: Box = { id, x: p.x, y: p.y, width: CW, height: CH };
      if (p.it.color) box.color = p.it.color;
      if (p.it.file) nodes.push(entityCard(box, p.it.file));
      else if (p.it.url) nodes.push(externalCard(box, p.it.url));
      else nodes.push(insightCard(box, p.it.text || ''));
      edges.push(signalEdge(nid('edge', `${p.it.role}:${p.it.target || p.it.url || ''}`), focalId, id, edgeLabel, sides));
    }
    return positioned;
  };
  const wrapZone = (positioned: { x: number; y: number }[], q: ContextQuadrant, key: string) => {
    if (!positioned.length) return;
    const minX = Math.min(...positioned.map((p) => p.x)) - ZP;
    const minY = Math.min(...positioned.map((p) => p.y)) - ZP - 24;
    const maxX = Math.max(...positioned.map((p) => p.x)) + CW + ZP;
    const maxY = Math.max(...positioned.map((p) => p.y)) + CH + ZP;
    const g = zone({ id: nid('zone', key), x: minX, y: minY, width: maxX - minX, height: maxY - minY, ...(q.color ? { color: q.color } : {}) }, q.label);
    groups.push(g);
  };

  // Focal + summary
  const focalId = nid('focal');
  const focalBox: Box = { id: focalId, x: 0, y: 0, width: FW, height: FH };
  if (spec.focal.color) focalBox.color = spec.focal.color;

  const summaryPos = { x: fcx - SW / 2, y: -(GY + SH) };
  const summaryNode = insightCard({ id: nid('summary'), x: summaryPos.x, y: summaryPos.y, width: SW, height: SH, color: BOB_COLOR.ai }, spec.summary);

  // Quadrants
  const leftPos = place(stackV(spec.left.items, -(GX + CW)), { from: 'left', to: 'right' }, spec.edgeLabels.left);
  const rightPos = place(stackV(spec.right.items, FW + GX), { from: 'right', to: 'left' }, spec.edgeLabels.right);
  const topPos = place(stackH(spec.top.items, summaryPos.y - (GY + CH)), { from: 'top', to: 'bottom' }, spec.edgeLabels.top);
  const bottomPos = place(stackH(spec.bottom.items, FH + GY), { from: 'bottom', to: 'top' }, spec.edgeLabels.bottom);

  wrapZone(leftPos, spec.left, 'left');
  wrapZone(rightPos, spec.right, 'right');
  wrapZone(topPos, spec.top, 'top');
  wrapZone(bottomPos, spec.bottom, 'bottom');

  // Groups first (z-behind), then focal + summary + cards already in `nodes`.
  const allNodes = [...groups, entityCard(focalBox, spec.focal.file), summaryNode, ...nodes];
  const ownedIds = [...allNodes.map((n) => n.id), ...edges.map((e) => e.id)];
  return { data: { nodes: allNodes, edges }, ownedIds };
}

/* ─────────────────── Entity Context Canvas generator ────────────────────── */

const PEOPLE_KEYS = new Set(['contact', 'company', 'client', 'supplier', 'partner', 'person', 'profile', 'candidate']);
const OUTPUT_KEYS = new Set(['deliverable', 'invoice', 'supplier-invoice', 'meeting', 'comms-thread', 'testimonial', 'feedback', 'survey', 'purchase-order', 'commission']);
const RISK_KEYS = new Set(['issue', 'audit-finding', 'audit-waste', 'decision', 'legal-rule', 'vat-return', 'corporate-tax-return']);
const URL_FIELDS = ['website', 'url', 'crm_url', 'link', 'homepage', 'dashboard', 'portal'];
const MAX_PER_QUADRANT = 8;

function relatedMarkdownFiles(app: App, file: TFile): TFile[] {
  const out = new Map<string, TFile>();
  const rl: Record<string, Record<string, number>> = (app.metadataCache as unknown as { resolvedLinks?: Record<string, Record<string, number>> }).resolvedLinks || {};
  for (const target of Object.keys(rl[file.path] || {})) {
    const f = app.vault.getAbstractFileByPath(target);
    if (f && (f as TFile).extension === 'md' && f.path !== file.path) out.set(f.path, f as TFile);
  }
  for (const [src, targets] of Object.entries(rl)) {
    if (src === file.path || !targets[file.path]) continue;
    const f = app.vault.getAbstractFileByPath(src);
    if (f && (f as TFile).extension === 'md') out.set(f.path, f as TFile);
  }
  return [...out.values()];
}

/** Entity Context Canvas: the focal note surrounded by its evidence, people/
 *  systems, outputs and risks, drawn from links + backlinks + linked URLs. */
export function buildEntityContextCanvas(app: App, file: TFile): { data: CanvasData; manifest: CanvasManifest } | null {
  if (!file) return null;
  const intent = 'entity-context';
  const focalKey = entityKeyFromFile(app, file);
  const sourceType = focalKey || 'note';

  const related = relatedMarkdownFiles(app, file);
  const evidence: ContextItem[] = [], people: ContextItem[] = [], outputs: ContextItem[] = [], risks: ContextItem[] = [];
  for (const rf of related) {
    const key = entityKeyFromFile(app, rf) || '';
    const item: ContextItem = { role: key || 'note', target: rf.path, file: rf.path };
    if (PEOPLE_KEYS.has(key)) { item.color = BOB_COLOR.info; people.push(item); }
    else if (OUTPUT_KEYS.has(key)) { item.color = BOB_COLOR.healthy; outputs.push(item); }
    else if (RISK_KEYS.has(key)) { item.color = BOB_COLOR.risk; risks.push(item); }
    else if (key === 'task') {
      const done = /done|complete|closed/i.test(String(app.metadataCache.getFileCache(rf)?.frontmatter?.status ?? ''));
      if (done) evidence.push(item); else { item.color = BOB_COLOR.attention; risks.push(item); }
    } else evidence.push(item);
  }

  // External systems from focal frontmatter → link cards (grouped with people/systems).
  const fm = (app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
  for (const key of URL_FIELDS) {
    const v = fm[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) people.push({ role: `url:${key}`, url: v, color: BOB_COLOR.info });
  }

  const cap = (arr: ContextItem[]) => arr.slice(0, MAX_PER_QUADRANT);
  const label = (k: string) => (k && ENTITIES[k]?.label) || 'Note';
  const stageOrStatus = String(fm.stage ?? fm.status ?? '').trim();

  const summary = [
    `# ${file.basename}`,
    `**${label(focalKey || '')}**${stageOrStatus ? ` · ${stageOrStatus}` : ''}`,
    '',
    `- Evidence: ${evidence.length}`,
    `- People & systems: ${people.length}`,
    `- Outputs: ${outputs.length}`,
    `- Risks / next actions: ${risks.length}`,
    '',
    '_Generated context surface_',
  ].join('\n');

  const spec: ContextSpec = {
    intent, source: file.path,
    focal: { file: file.path },
    summary,
    left: { label: `Evidence · ${evidence.length}`, items: cap(evidence) },
    top: { label: `People & Systems · ${people.length}`, color: BOB_COLOR.info, items: cap(people) },
    right: { label: `Outputs · ${outputs.length}`, color: BOB_COLOR.healthy, items: cap(outputs) },
    bottom: { label: `Risks & Next Actions · ${risks.length}`, color: BOB_COLOR.risk, items: cap(risks) },
    edgeLabels: { left: 'evidence', top: 'informs', right: 'produces', bottom: 'at risk' },
  };
  const { data, ownedIds } = buildContextExplosion(spec);

  const manifest: CanvasManifest = {
    source_path: file.path,
    source_type: sourceType,
    template: 'context-explosion',
    generated_at: new Date().toISOString(),
    query_hash: shortHash(related.map((f) => f.path).sort().join(',') + '|' + people.length + outputs.length + risks.length + evidence.length),
    bob_owned_node_ids: ownedIds,
  };
  return { data, manifest };
}

/** Generators available from the Canvases "+ Generate" menu (no note context). */
export const CANVAS_GENERATORS: { id: string; label: string; icon: string; build: (app: App) => CanvasData | null }[] = [
  { id: 'pipeline', label: 'Pipeline board (deals by stage)', icon: 'kanban', build: buildPipelineCanvasData },
];
