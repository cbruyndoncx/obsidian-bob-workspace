import type { App } from 'obsidian';
import { ENTITIES, dealStageField, getDealStages } from './entities';
import { listEntities } from './entity-files';

/* ── JSON Canvas (jsoncanvas.org) writer + generators ──────────────────────
 * The format is an open, MIT-licensed spec, so generation is just structured
 * file writes — no unstable API. buildBoardCanvas is pure (unit-tested); the
 * generators read entity data and produce a CanvasData ready to serialize. */

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

export interface BoardCard { file?: string; text?: string; }
export interface BoardColumn { label: string; color?: string; cards: BoardCard[]; }

const CARD_W = 260;
const CARD_H = 80;
const CARD_GAP = 14;
const COL_PAD = 20;
const COL_GAP = 48;
const HEADER = 52;

// Lay out labelled columns of cards as a JSON Canvas board: one `group` node per
// column (a labelled rectangle) with `file`/`text` cards stacked inside it.
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
      if (card.file) nodes.push({ ...base, type: 'file', file: card.file });
      else nodes.push({ ...base, type: 'text', text: card.text || '' });
    });
  });
  return { nodes, edges: [] };
}

export function serializeCanvas(data: CanvasData): string {
  return JSON.stringify(data, null, 2);
}

/** A pipeline board: deals grouped into columns by stage; each card is a live
 *  `file` node linking to the deal note. Returns null if there is no deal type. */
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
  const columns: BoardColumn[] = stages.map((stage, i) => ({
    label: stage,
    color: String((i % 6) + 1),
    cards: buckets.get(stage) || [],
  }));
  if (unassigned.length) columns.push({ label: 'Unassigned', cards: unassigned });
  return buildBoardCanvas(columns);
}

/** Generators available from the Canvases surface. */
export const CANVAS_GENERATORS: { id: string; label: string; icon: string; build: (app: App) => CanvasData | null }[] = [
  { id: 'pipeline', label: 'Pipeline board (deals by stage)', icon: 'kanban', build: buildPipelineCanvasData },
];
