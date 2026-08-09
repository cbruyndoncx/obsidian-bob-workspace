import { ENTITIES } from './entities';
import { scannableMarkdownFiles } from './entity-files';
import { normalizeTemplateSpec, renderTemplateDocument } from './settings';
import { ensureFolderSync, startOfDay, ymd } from './utils';
import { WORKSPACE_CONFIG } from './workspace-config';
import type { App, CachedMetadata, TFile } from 'obsidian';
import type { Frontmatter, PartialSettings } from './types';

/** A TaskNote read for the Productivity report (frontmatter + derived fields). */
export interface ProductivityTaskNote {
  file: TFile;
  fm: Frontmatter;
  status: string;
  done: boolean;
  date: string;
  priority: string;
  due: string;
  scheduled: string;
  projects: string[];
  contexts: string[];
}

export function taskNoteTemplate(title: string): string {
  const template = normalizeTemplateSpec(WORKSPACE_CONFIG?.templates?.taskNote || ENTITIES.task?.template);
  if (template) {
    return renderTemplateDocument(template, {
      title,
      name: title,
      today: ymd(),
      entityKey: 'task',
      label: 'Task',
      plural: 'Tasks',
    }, {
      frontmatter: {
        title,
        type: 'task',
        status: 'open',
        priority: 'normal',
        size: 'M',
        due: '',
        scheduled: '',
        dateCreated: ymd(),
        dateModified: ymd(),
        tags: [],
        assignee: [],
        cluster: '',
      },
      body: [
        `# ${title}`,
        '',
        '## Scope',
        '',
        '## Notes',
        '',
      ],
    });
  }
  const now = ymd();
  return [
    '---',
    `title: ${title}`,
    'type: task',
    'status: open',
    'priority: normal',
    'size: M',
    'due:',
    'scheduled:',
    `dateCreated: ${now}`,
    `dateModified: ${now}`,
    'tags: []',
    'assignee: []',
    'cluster:',
    '---',
    '',
    `# ${title}`,
    '',
    '## Scope',
    '',
    '## Notes',
    '',
  ].join('\n');
}

export async function createTaskNote(app: App, settings: PartialSettings, title: string): Promise<TFile> {
  const folder = (settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks').replace(/\/$/, '');
  await ensureFolderSync(app, folder);
  const safe = title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled Task';
  let path = `${folder}/${safe}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) { path = `${folder}/${safe} ${n++}.md`; }
  return app.vault.create(path, taskNoteTemplate(title));
}

export function listTodayTaskNotes(app: App, settings: PartialSettings): { file: TFile; fm: Frontmatter }[] {
  const folder = (settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks').replace(/\/$/, '');
  const todayStr = ymd();
  // Route through the shared scan cache so templates/ignored folders are
  // excluded like every other entity scan and the vault walk is reused.
  return scannableMarkdownFiles(app)
    .filter((f) => f.path.startsWith(folder + '/'))
    .map((f) => {
      const fm: Frontmatter = (app.metadataCache.getFileCache(f) || {} as CachedMetadata).frontmatter || {};
      return { file: f, fm };
    })
    .filter(({ fm }) => {
      if (fm.status === 'done') return false;
      const due   = fm.due       ? String(fm.due).slice(0, 10)       : null;
      const sched = fm.scheduled ? String(fm.scheduled).slice(0, 10) : null;
      return due === todayStr || sched === todayStr;
    });
}

export function taskNoteStatus(fm: Frontmatter): string {
  return String(fm?.status || 'open').toLowerCase().replace(/[\s_]+/g, '-');
}
export function taskNoteIgnored(status: string): boolean {
  return status === 'cancelled' || status === 'canceled';
}
export function taskNoteFolders(settings: PartialSettings): string[] {
  const active = (settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks').replace(/\/$/, '');
  const fallbackArchive = active.replace(/\/Tasks$/, '/Archive');
  const archive = (settings.taskNotesArchiveFolder || fallbackArchive || '00-CORE/TaskNotes/Archive').replace(/\/$/, '');
  return [...new Set([active, archive].filter(Boolean))];
}
export function taskNoteDateValue(file: TFile, fm: Frontmatter, done: boolean): string {
  const raw = done
    ? (fm.dateCompleted || fm.completedDate || fm.completed || fm.dateModified || fm.modified || fm.due || fm.scheduled || fm.dateCreated || fm.created)
    : (fm.due || fm.scheduled || fm.dateCreated || fm.created || fm.dateModified || fm.modified);
  if (raw) return String(raw).slice(0, 10);
  if (file?.stat?.mtime) return ymd(new Date(file.stat.mtime));
  return '';
}
export function listTaskNotesForProductivity(app: App, settings: PartialSettings, start: Date | string | number, end: Date | string | number): ProductivityTaskNote[] {
  const folders = taskNoteFolders(settings);
  const startTime = startOfDay(start).getTime();
  const endTime = startOfDay(end).getTime();
  return scannableMarkdownFiles(app)
    .filter((f) => folders.some((folder) => f.path.startsWith(folder + '/')))
    .map((file) => {
      const fm: Frontmatter = (app.metadataCache.getFileCache(file) || {} as CachedMetadata).frontmatter || {};
      const status = taskNoteStatus(fm);
      const done = status === 'done' || status === 'completed' || status === 'archived';
      const date = taskNoteDateValue(file, fm, done);
      return {
        file,
        fm,
        status,
        done,
        date,
        priority: String(fm.priority || '').trim().toLowerCase(),
        due: fm.due ? String(fm.due).slice(0, 10) : '',
        scheduled: fm.scheduled ? String(fm.scheduled).slice(0, 10) : '',
        projects: Array.isArray(fm.projects)
          ? fm.projects
          : String(fm.projects || '').split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
        contexts: Array.isArray(fm.contexts)
          ? fm.contexts
          : String(fm.contexts || '').split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      };
    })
    .filter((item) => {
      const time = item.date ? new Date(item.date + 'T00:00:00').getTime() : NaN;
      return !taskNoteIgnored(item.status) && Number.isFinite(time) && time >= startTime && time <= endTime;
    });
}

export async function toggleTaskNoteStatus(app: App, file: TFile, done: boolean): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.status = done ? 'done' : 'open';
    fm.dateModified = new Date().toISOString().slice(0, 10);
  });
}

