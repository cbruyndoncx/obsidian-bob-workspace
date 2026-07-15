import { setWorkspaceConfig } from './workspace-config';
import { resolveBasesFolder } from './bases-config';
import { BUNDLED_WORKSPACE_TEMPLATES } from './bundled/templates';
import { cloneConfig } from './nav';
import { reloadEntityConfiguration } from './runtime-config';
import { bootstrapCanonicalSchemaSourcesIfMissing, regenerateSchemaOutputs } from './schema-designer';
import { SCHEMA_FOLDER_DEFAULT } from './schemas';
import { ensureFolderSync, ymd } from './utils';
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

export async function loadWorkspaceTemplates(app: App): Promise<WorkspaceTemplate[]> {
  const dir = `${PLUGIN_DIR}/templates`;
  const byName = new Map<string, WorkspaceTemplate>();
  // Bundled templates ship inside main.js, so a main.js-only update always
  // carries the current config (the templates/ folder is not delivered by the
  // Obsidian store installer). Bundled names are authoritative.
  for (const [fileName, tpl] of Object.entries(BUNDLED_WORKSPACE_TEMPLATES)) {
    if (!tpl || !tpl._template) continue;
    const clone = cloneConfig(tpl);
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

// Move files with the given extensions out of `folder` into a sibling
// "<name>-archive-<stamp>" folder. Returns the count moved. Reversible.
export async function archiveFolderContents(app: App, folder: string, stamp: string, exts: string[]): Promise<{ dest: string; count: number }> {
  const dir = String(folder || '').replace(/\/+$/, '');
  if (!dir || !await app.vault.adapter.exists(dir)) return { dest: '', count: 0 };
  const listed = await app.vault.adapter.list(dir);
  const files = (listed.files || []).filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
  if (!files.length) return { dest: '', count: 0 };
  const parent = dir.split('/').slice(0, -1).join('/');
  const base = dir.split('/').pop();
  const dest = `${parent ? parent + '/' : ''}${base}-archive-${stamp}`;
  await ensureFolderSync(app, dest);
  let count = 0;
  for (const f of files) {
    const name = f.split('/').pop();
    try { await app.vault.adapter.rename(f, `${dest}/${name}`); count++; } catch (_) {}
  }
  return { dest, count };
}

// Before switching to a different template, archive the outgoing template's
// schema YAML, base files, and workspace.json (labelled with the template key
// and a timestamp) so applying a new template never compounds onto the old one.
export async function archiveTemplateAssets(app: App, schemaFolder: string, basesFolder: string, prevKey: string) {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${prevKey || 'previous'}-${ymd()}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const schemas = await archiveFolderContents(app, schemaFolder, stamp, ['.yaml', '.yml']);
  // Derived schema outputs live as siblings of the source folder (same
  // derivation regenerateSchemaOutputs uses). Archive them too, otherwise a
  // switch between templates with different schema folders leaves the old
  // template's FileClasses / JSON Schema orphaned (prune only touches the new
  // folder).
  const root = String(schemaFolder || '').replace(/\/source$/, '');
  const fileClasses = await archiveFolderContents(app, `${root}/fileClasses`, stamp, ['.md']);
  const jsonSchemas = await archiveFolderContents(app, `${root}/json-schema`, stamp, ['.json']);
  const bases = await archiveFolderContents(app, basesFolder, stamp, ['.base']);
  // Keep a labelled copy of the outgoing workspace.json (the shared backup is
  // overwritten on every save and carries no template identity).
  try {
    if (await app.vault.adapter.exists(WORKSPACE_CONFIG_PATH)) {
      const dest = `${schemas.dest || basesFolder}/workspace-${stamp}.json`;
      await ensureFolderSync(app, dest.split('/').slice(0, -1).join('/'));
      await app.vault.adapter.write(dest, await app.vault.adapter.read(WORKSPACE_CONFIG_PATH));
    }
  } catch (_) {}
  return { schemas: schemas.count, fileClasses: fileClasses.count, jsonSchemas: jsonSchemas.count, bases: bases.count, stamp };
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
  if (switching) {
    const archived = await archiveTemplateAssets(app, oldSchemaFolder, oldBasesFolder, prevKey);
    const total = archived.schemas + archived.fileClasses + archived.jsonSchemas + archived.bases;
    if (total) {
      new obsidian.Notice(`BOB Workspace: archived ${archived.schemas} schema, ${archived.fileClasses} FileClass, ${archived.jsonSchemas} JSON Schema, and ${archived.bases} base file(s) from "${prevKey}" before applying "${newKey}".`);
    }
  }
  await saveWorkspaceConfig(app, JSON.stringify(parsed, null, 2));
  setWorkspaceConfig(parsed);
  plugin.settings.activeWorkspaceTemplate = newKey;
  plugin.settings.setupDismissed = true;
  // Clean starting point when switching templates: reset workspace-owned settings
  // to defaults first, so unlisted owned settings from the previous template don't
  // leak in. The outgoing settings were archived above (workspace-<stamp>.json).
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
  return _template;
}

