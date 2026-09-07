import { cloneConfig } from './nav';
import { setWorkspaceConfig } from './workspace-config';
import { entityBasePath, resolveBasesFolder } from './bases-config';
import { BUNDLED_WORKSPACE_TEMPLATES } from './bundled/templates';
import { reloadEntityConfiguration } from './runtime-config';
import { bootstrapCanonicalSchemaSourcesIfMissing, regenerateSchemaOutputs } from './schema-designer';
import { SCHEMA_FOLDER_DEFAULT } from './schemas';
import { ensureFolderSync } from './utils';
import { PLUGIN_DIR, WORKSPACE_CONFIG, WORKSPACE_CONFIG_PATH, applyWorkspaceOwnedSettings, resetWorkspaceOwnedSettings, saveWorkspaceConfig, validateWorkspaceConfig } from './workspace-config';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import type { BobPlugin } from './plugin';
import type { BobSettings, PartialSettings, WorkspaceConfig } from './types';

/** A loaded workspace template: full config plus its non-enumerable source path. */
export type WorkspaceTemplate = WorkspaceConfig & { _templatePath?: string };

export async function seedWorkspaceTemplates(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  const dir = `${PLUGIN_DIR}/templates`;
  try { await adapter.mkdir(dir); } catch (_) {}
}

/* Serialized bundled templates, cached at first use (see the bundled loop
   below). */
const _bundledTemplateJson = new Map<string, string>();

export async function loadWorkspaceTemplates(app: App): Promise<WorkspaceTemplate[]> {
  const dir = `${PLUGIN_DIR}/templates`;
  const byName = new Map<string, WorkspaceTemplate>();
  // Bundled templates ship inside main.js, so a main.js-only update always
  // carries the current config (the templates/ folder is not delivered by the
  // Obsidian store installer). Bundled names are authoritative.
  for (const [fileName, tpl] of Object.entries(BUNDLED_WORKSPACE_TEMPLATES)) {
    if (!tpl || !tpl._template) continue;
    // Bundled templates are immutable inputs; cache their serialized form so
    // repeated loads (the settings tab calls this on every display()) pay one
    // JSON.parse instead of a full stringify+parse of ~415 KB of templates.
    let json = _bundledTemplateJson.get(fileName);
    if (!json) {
      json = JSON.stringify(tpl);
      _bundledTemplateJson.set(fileName, json);
    }
    const clone = JSON.parse(json) as WorkspaceTemplate;
    Object.defineProperty(clone, '_templatePath', { value: `${dir}/${fileName}`, enumerable: false });
    byName.set(fileName, clone);
  }
  // On-disk templates can ADD custom ones; they do not override bundled names.
  try {
    const adapter = app.vault.adapter;
    const listed = await adapter.list(dir);
    const files = (listed.files || []).filter((f) => f.endsWith('.json')).sort();
    for (const filePath of files) {
      const fileName = filePath.split('/').pop();
      if (byName.has(fileName)) continue;
      try {
        const tpl = JSON.parse(await adapter.read(filePath));
        if (tpl._template) {
          Object.defineProperty(tpl, '_templatePath', { value: filePath, enumerable: false });
          byName.set(fileName, tpl);
        }
      } catch (_) {}
    }
  } catch (_) {}
  return [...byName.values()].sort((a, b) => (a._template.order || 99) - (b._template.order || 99));
}

export function workspaceTemplateKey(template: WorkspaceTemplate | null | undefined): string {
  return String(template?._template?.id || template?._templatePath || template?._template?.label || '').trim();
}

// Write a template's embedded assets (schema YAML + .base files) into the vault.
// Missing-only. Schemas go to the configured schema folder (keyed by entity →
// <entity>.yaml); bases go to the Bases folder (keyed by filename). Done BEFORE
// the built-in bootstrap so a template that defines its OWN entities seeds only
// those — the built-in bootstrap then stays gated (schemas already present).
export async function writeTemplateAssets(app: App, assets: WorkspaceConfig['_assets'], settings: PartialSettings = {}): Promise<{ schemas: number; bases: number }> {
  const result = { schemas: 0, bases: 0 };
  if (!assets || typeof assets !== 'object') return result;
  if (assets.schemas && typeof assets.schemas === 'object') {
    const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
    await ensureFolderSync(app, folder);
    for (const [entity, body] of Object.entries(assets.schemas)) {
      const path = `${folder}/${entity}.yaml`;
      if (await app.vault.adapter.exists(path)) continue;
      await app.vault.adapter.write(path, typeof body === 'string' ? body : `${obsidian.stringifyYaml(body)}\n`);
      result.schemas++;
    }
  }
  if (assets.bases && typeof assets.bases === 'object') {
    const folder = resolveBasesFolder(settings);
    await ensureFolderSync(app, folder);
    for (const [fileName, body] of Object.entries(assets.bases)) {
      const path = `${folder}/${String(fileName).split('/').pop()}`;
      if (await app.vault.adapter.exists(path)) continue;
      await app.vault.adapter.write(path, typeof body === 'string' ? body : `${obsidian.stringifyYaml(body)}\n`);
      result.bases++;
    }
  }
  return result;
}

export interface ArchiveMove { from: string; to: string; }

async function planArchiveFolder(app: App, folder: string, stamp: string, exts: string[]) {
  const dir = String(folder || '').replace(/\/+$/, '');
  if (!dir || !await app.vault.adapter.exists(dir)) return { dest: '', moves: [] as ArchiveMove[] };
  const listed = await app.vault.adapter.list(dir);
  const files = listed.files.filter((f) => exts.some((ext) => f.toLowerCase().endsWith(ext)));
  const dest = files.length ? `${dir}-archive-${stamp}` : '';
  return { dest, moves: files.map((from) => ({ from, to: `${dest}/${from.split('/').pop()}` })) };
}

async function moveArchiveFiles(app: App, moves: ArchiveMove[]): Promise<void> {
  const moved: ArchiveMove[] = [];
  try {
    for (const move of moves) {
      if (await app.vault.adapter.exists(move.to)) throw new Error(`Archive destination already exists: ${move.to}`);
      await ensureFolderSync(app, move.to.split('/').slice(0, -1).join('/'));
      await app.vault.adapter.rename(move.from, move.to);
      moved.push(move);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const move of moved.reverse()) {
      try { await app.vault.adapter.rename(move.to, move.from); }
      catch (rollbackError) { failures.push(`${move.to} -> ${move.from}: ${String(rollbackError)}`); }
    }
    throw new Error(`Archive failed: ${String(error)}${failures.length ? `; rollback incomplete: ${failures.join('; ')}` : '; completed moves restored'}`);
  }
}

export async function archiveFolderContents(app: App, folder: string, stamp: string, exts: string[]): Promise<{ dest: string; count: number }> {
  const plan = await planArchiveFolder(app, folder, stamp, exts);
  await moveArchiveFiles(app, plan.moves);
  return { dest: plan.dest, count: plan.moves.length };
}

// Plan all moves and persist recovery information BEFORE changing the active folders.
export async function archiveTemplateAssets(app: App, schemaFolder: string, basesFolder: string, prevKey: string, settings: PartialSettings = {}) {
  const stamp = `${String(prevKey || 'previous').replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`;
  const root = String(schemaFolder || '').replace(/\/source$/, '');
  const schemas = await planArchiveFolder(app, schemaFolder, stamp, ['.yaml', '.yml']);
  const fileClasses = await planArchiveFolder(app, `${root}/fileClasses`, stamp, ['.md']);
  const jsonSchemas = await planArchiveFolder(app, `${root}/json-schema`, stamp, ['.json']);
  const bases = await planArchiveFolder(app, basesFolder, stamp, ['.base']);
  const moves = [...schemas.moves, ...fileClasses.moves, ...jsonSchemas.moves, ...bases.moves];
  const recoveryPath = `${PLUGIN_DIR}/template-switch-${stamp}.json`;
  const adapter = app.vault.adapter;
  const workspace = await adapter.exists(WORKSPACE_CONFIG_PATH) ? await adapter.read(WORKSPACE_CONFIG_PATH) : null;
  // Explicit Bases elsewhere may be shared. Preserve them in place and snapshot their content.
  const externalBases: Record<string, string> = {};
  const keys = new Set([...Object.keys(WORKSPACE_CONFIG.bases || {}), ...Object.keys(settings.baseFiles || {})]);
  for (const key of keys) {
    const path = entityBasePath(settings, key);
    if (path && !moves.some((move) => move.from === path) && await adapter.exists(path)) externalBases[path] = await adapter.read(path);
  }
  const recovery = { phase: 'planned', previousTemplate: prevKey, workspacePath: WORKSPACE_CONFIG_PATH, workspace, settings: cloneConfig(settings), moves, externalBases, error: '' };
  await ensureFolderSync(app, PLUGIN_DIR);
  if (await adapter.exists(recoveryPath)) throw new Error(`Archive recovery already exists: ${recoveryPath}`);
  await adapter.write(recoveryPath, JSON.stringify(recovery, null, 2));
  try {
    await moveArchiveFiles(app, moves);
    recovery.phase = 'archived';
    await adapter.write(recoveryPath, JSON.stringify(recovery, null, 2));
  } catch (error) {
    recovery.phase = 'archive-failed';
    recovery.error = String(error);
    try { await adapter.write(recoveryPath, JSON.stringify(recovery, null, 2)); }
    catch (journalError) { throw new Error(`${String(error)}; recovery update failed: ${String(journalError)}; plan: ${recoveryPath}`); }
    throw new Error(`${String(error)}; recovery: ${recoveryPath}`);
  }
  return { schemas: schemas.moves.length, fileClasses: fileClasses.moves.length, jsonSchemas: jsonSchemas.moves.length, bases: bases.moves.length, stamp, recoveryPath, recovery };
}

export async function applyWorkspaceTemplate(app: App, plugin: BobPlugin, template: WorkspaceTemplate): Promise<WorkspaceConfig['_template']> {
  if (!template?._template) throw new Error('Invalid workspace template');
  const { _template, _assets, ...config } = template;
  const newKey = workspaceTemplateKey(template);
  const prevKey = plugin.settings.activeWorkspaceTemplate;
  const switching = !!(prevKey && newKey && prevKey !== newKey);
  // Capture the OUTGOING template's folders before config/settings are replaced.
  const oldSchemaFolder = (WORKSPACE_CONFIG.schemas?.folder || plugin.settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  const oldBasesFolder = resolveBasesFolder(plugin.settings);

  const parsed = validateWorkspaceConfig(config);
  let archived: Awaited<ReturnType<typeof archiveTemplateAssets>> | undefined;
  if (switching) {
    archived = await archiveTemplateAssets(app, oldSchemaFolder, oldBasesFolder, prevKey, plugin.settings);
    const total = archived.schemas + archived.fileClasses + archived.jsonSchemas + archived.bases;
    if (total) {
      new obsidian.Notice(`BOB Workspace: archived ${archived.schemas} schema, ${archived.fileClasses} FileClass, ${archived.jsonSchemas} JSON Schema, and ${archived.bases} base file(s) from "${prevKey}" before applying "${newKey}".`);
    }
  }
  try {
    await saveWorkspaceConfig(app, JSON.stringify(parsed, null, 2));
    setWorkspaceConfig(parsed);
    plugin.settings.activeWorkspaceTemplate = newKey;
    plugin.settings.setupDismissed = true;
    // Clean starting point when switching templates: reset workspace-owned settings
    // to defaults first, so unlisted owned settings from the previous template don't
    // leak in. The outgoing settings are snapshotted in the template-switch recovery record.
    if (switching) plugin.settings = resetWorkspaceOwnedSettings(plugin.settings) as BobSettings;
    plugin.settings = applyWorkspaceOwnedSettings(plugin.settings) as BobSettings;
    await plugin.saveSettings();
    // Seed the template's own schemas/bases first so its entities exist before
    // any bootstrap — this is what keeps a custom template (e.g. EMAI) from
    // falling back to the full built-in entity set.
    const assetResult = await writeTemplateAssets(app, _assets, plugin.settings);
    if (parsed.schemas?.enabled) {
      const bootstrap = await bootstrapCanonicalSchemaSourcesIfMissing(app, plugin.settings);
      if (bootstrap.count || assetResult.schemas) {
        await regenerateSchemaOutputs(app, plugin.settings);
      }
    }
    await reloadEntityConfiguration(app, plugin.settings);
    plugin.refreshOpenViews();
    if (archived) {
      archived.recovery.phase = 'applied';
      await app.vault.adapter.write(archived.recoveryPath, JSON.stringify(archived.recovery, null, 2));
    }
    return _template;
  } catch (error) {
    if (!archived) throw error;
    archived.recovery.phase = 'apply-failed';
    archived.recovery.error = String(error);
    try { await app.vault.adapter.write(archived.recoveryPath, JSON.stringify(archived.recovery, null, 2)); }
    catch (journalError) { throw new Error(`${String(error)}; recovery update failed: ${String(journalError)}; plan: ${archived.recoveryPath}`); }
    throw new Error(`Template apply failed: ${String(error)}; recovery: ${archived.recoveryPath}`);
  }
}

