import type { App } from 'obsidian';
import { mergeGeneratedCanvas, serializeCanvas } from './canvas';
import type { CanvasData, CanvasManifest } from './canvas';

export function validateCanvasData(value: unknown): asserts value is CanvasData {
  const data = value as CanvasData;
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('Invalid canvas: nodes and edges must be arrays');
  const ids = new Set<string>();
  for (const entry of [...data.nodes, ...data.edges]) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) throw new Error('Invalid canvas: missing or duplicate ID');
    ids.add(entry.id);
  }
  const nodes = new Set(data.nodes.map((n) => n.id));
  for (const edge of data.edges) {
    if (!nodes.has(edge.fromNode) || !nodes.has(edge.toNode)) throw new Error('Invalid canvas: dangling edge');
  }
}

const canvasWrites = new WeakMap<App, Map<string, Promise<void>>>();

/** Serialize regeneration and retain exact old bytes until both files are saved. */
export async function saveGeneratedCanvas(app: App, path: string, data: CanvasData, manifest: CanvasManifest): Promise<void> {
  let writes = canvasWrites.get(app);
  if (!writes) { writes = new Map(); canvasWrites.set(app, writes); }
  const previous = writes.get(path) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => persistGeneratedCanvas(app, path, data, manifest));
  writes.set(path, pending);
  try { await pending; }
  finally { if (writes.get(path) === pending) writes.delete(path); }
}

async function persistGeneratedCanvas(app: App, path: string, data: CanvasData, manifest: CanvasManifest): Promise<void> {
  const adapter = app.vault.adapter;
  const metaPath = `${path}.bobmeta.json`;
  const recoveryPath = `${path}.bob-recovery.json`;
  if (await adapter.exists(recoveryPath)) throw new Error(`Unresolved canvas recovery: ${recoveryPath}`);
  validateCanvasData(data);
  // Read and validate BEFORE writing anything; an unreadable file is never replaced.
  const oldCanvas = await adapter.exists(path) ? await adapter.read(path) : null;
  const oldMeta = await adapter.exists(metaPath) ? await adapter.read(metaPath) : null;
  let out = data;
  let owned: string[] = [];
  if (oldMeta !== null) {
    const parsed = JSON.parse(oldMeta) as CanvasManifest;
    if (!parsed || !Array.isArray(parsed.bob_owned_node_ids) || parsed.bob_owned_node_ids.some((id) => typeof id !== 'string')) {
      throw new Error(`Invalid canvas manifest: ${metaPath}`);
    }
    if (parsed.source_path !== manifest.source_path) throw new Error(`Canvas belongs to another source: ${path}`);
    owned = parsed.bob_owned_node_ids;
  }
  if (oldCanvas !== null) {
    const parsed: unknown = JSON.parse(oldCanvas);
    validateCanvasData(parsed);
    out = mergeGeneratedCanvas(parsed, owned, data);
    validateCanvasData(out);
  }
  await adapter.write(recoveryPath, JSON.stringify({ path, metaPath, canvas: oldCanvas, manifest: oldMeta }, null, 2));
  try {
    await adapter.write(path, serializeCanvas(out));
    await adapter.write(metaPath, JSON.stringify(manifest, null, 2));
  } catch (error) {
    const failures: string[] = [];
    for (const [target, before] of [[path, oldCanvas], [metaPath, oldMeta]]) {
      try {
        if (before !== null) await adapter.write(target, before);
        else if (await adapter.exists(target)) await adapter.remove(target);
      } catch { failures.push(target); }
    }
    throw new Error(`Canvas save failed: ${String(error)}. Recovery: ${recoveryPath}${failures.length ? `; restore failed for ${failures.join(', ')}` : '; previous files restored'}`);
  }
  await adapter.remove(recoveryPath);
}
