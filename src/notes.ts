import { ENTITIES } from './entities';
import { entityTemplate } from './entity-files';
import { humanizeProjectName, normalizeProjectId, resolveEntityCreateFolder } from './settings';
import { dailyNotePath, ensureFolderSync, ymd } from './utils';
import type { App, TAbstractFile, TFile } from 'obsidian';
import type { EntityDef, Frontmatter, PartialSettings } from './types';

/** Extra context for entity creation (initial values, folder hints, …). */
export interface EntityCreateContext {
  values?: Frontmatter;
  [key: string]: unknown;
}

/** Shape of the community Templater plugin instance (optional integration). */
interface TemplaterPlugin {
  settings?: { folder_templates?: { folder: string; template: string }[] };
  templater?: {
    create_new_note_from_template(
      template: TAbstractFile,
      folder: TAbstractFile | undefined,
      filename: string,
      openNewNote: boolean,
    ): Promise<TFile>;
  };
}

type AppWithPlugins = App & { plugins?: { plugins?: Record<string, TemplaterPlugin | undefined> } };

export async function createEntity(app: App, entityKey: string, rawName: string, context: EntityCreateContext = {}): Promise<TFile> {
  const def: EntityDef = ENTITIES[entityKey];
  const createContext = Object.assign({}, context);
  let effectiveRawName = rawName;
  if (entityKey === 'project') {
    const values = Object.assign({}, context.values || {});
    const providedId = String(values.project_id || values.projectId || values.id || '').trim();
    const providedName = String(values.project_name || values.name || values.project || rawName || '').trim();
    const projectId = normalizeProjectId(providedId || providedName || rawName);
    const projectName = humanizeProjectName(providedName || rawName || projectId) || projectId;
    values.project_id = projectId;
    values.project_name = projectName;
    delete values.name;
    delete values.project;
    delete values.projectId;
    delete values.id;
    createContext.values = values;
    effectiveRawName = projectId || rawName;
  }
  const folder = resolveEntityCreateFolder(entityKey, effectiveRawName, createContext);
  await ensureFolderSync(app, folder);
  const safeName = (effectiveRawName || `Untitled ${def.label}`).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
  let path = `${folder}/${safeName}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${folder}/${safeName} ${n}.md`;
    n++;
  }
  return await app.vault.create(path, entityTemplate(entityKey, safeName));
}

/* ─────────── Daily-note read/write ─────────── */
export async function ensureDailyNote(app: App, settings: PartialSettings, date = new Date()): Promise<TAbstractFile> {
  const path = dailyNotePath(settings, date);
  let file: TAbstractFile | null = app.vault.getAbstractFileByPath(path);
  if (file) return file;
  const folder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (_) {}
  }
  const templater = (app as AppWithPlugins).plugins?.plugins?.['templater-obsidian'];
  const folderTemplates = templater?.settings?.folder_templates || [];
  const dailyFolder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  const match = folderTemplates.find(ft => ft.folder.replace(/\/$/, '') === dailyFolder || ft.folder === '/');
  const templateFile = match ? app.vault.getAbstractFileByPath(match.template) : null;

  if (templater?.templater && templateFile) {
    const filename = path.split('/').pop().replace('.md', '');
    const folderObj = app.vault.getAbstractFileByPath(dailyFolder) || undefined;
    file = await templater.templater.create_new_note_from_template(templateFile, folderObj, filename, false);
  } else {
    const template = [
      `# ${ymd(date)}`, '',
      settings.tasksHeading, '- [ ] ', '',
      settings.journalHeading, '', '',
    ].join('\n');
    file = await app.vault.create(path, template);
  }
  return file;
}

export function parseSections(content: string, settings: PartialSettings): { tasks: string[]; journal: string; raw: string } {
  const lines = content.split('\n');
  const tasks: string[] = [];
  let journal = '';
  let mode: 'tasks' | 'journal' | null = null;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      const stripped = line.trim();
      if (stripped === settings.tasksHeading) { mode = 'tasks'; continue; }
      if (stripped === settings.journalHeading) { mode = 'journal'; continue; }
      mode = null;
      continue;
    }
    if (mode === 'tasks') {
      if (/^\s*-\s\[(x|X| )\]\s/.test(line)) tasks.push(line);
    } else if (mode === 'journal') {
      journal += (journal ? '\n' : '') + line;
    }
  }
  return { tasks, journal: journal.replace(/\s+$/, ''), raw: content };
}

export function replaceSection(content: string, heading: string, newBody: string): string {
  const lines = content.split('\n');
  const headIdx = lines.findIndex((l) => l.trim() === heading);
  if (headIdx === -1) {
    return content.replace(/\s*$/, '') + `\n\n${heading}\n${newBody}\n`;
  }
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  const before = lines.slice(0, headIdx + 1);
  const after = lines.slice(endIdx);
  const bodyLines = newBody.split('\n');
  return [...before, ...bodyLines, '', ...after].join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ─────────── Reminders ─────────── */
