import { humanizeProjectName } from './settings';
import { startOfDay } from './utils';
import type { App, TFile } from 'obsidian';
import type { PartialSettings, Reminder } from './types';
export function reminderId(): string { return 'rem_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

export function nextRepeat(when: string | Date | null | undefined, repeat: string, after: number = Date.now()): Date | null {
  if (!when) return null;
  const d = when instanceof Date ? when : new Date(when);
  const period = repeat === 'daily' ? 86400000 : repeat === 'weekly' ? 7 * 86400000 : 0;
  if (!period || isNaN(d.getTime())) return null;
  // Advance past `after` in ONE step. Advancing a single period at a time made
  // a daily reminder missed for N days replay N times — one Notice + settings
  // save + full view refresh per 30s tick — a "catch-up storm" after any
  // absence. The next occurrence is always strictly in the future.
  const base = d.getTime();
  const periodsBehind = base > after ? 1 : Math.floor((after - base) / period) + 1;
  return new Date(base + periodsBehind * period);
}

export function reminderBucket(when: string | null | undefined): string {
  if (!when) return 'later';
  const now = Date.now();
  const w = new Date(when).getTime();
  if (w <= now + 60 * 60 * 1000) return 'now';            // due now or within next hour
  const today = startOfDay(new Date()).getTime();
  const tomorrow = today + 86400000;
  if (w < tomorrow) return 'today';
  const weekEnd = today + 7 * 86400000;
  if (w < weekEnd) return 'week';
  return 'later';
}

/* Resolve a project's display name from its file path. */
export function projectNameFromPath(app: App, path: string | null | undefined): string | null {
  if (!path) return null;
  // Reminder project links always point at markdown notes; assert past TAbstractFile.
  const file = app.vault.getAbstractFileByPath(path) as TFile | null;
  if (!file) return humanizeProjectName(path.split('/').pop().replace(/\.md$/, ''));
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache && cache.frontmatter) || {};
  return fm.project_name || fm.name || fm.project || humanizeProjectName(fm.project_id || file.basename);
}

/* Find an existing reminder linked to a specific (project, task-text) pair. */
export function findProjectTaskReminder(plugin: { settings: PartialSettings }, projectPath: string | null | undefined, taskText: string | null | undefined): Reminder | null {
  if (!projectPath || !taskText) return null;
  const all = plugin.settings.reminders || [];
  return all.find((r) => !r.done && r.project === projectPath && r.text === taskText) || null;
}

export function reminderTimeStr(when: string | Date | null | undefined): string {
  if (!when) return '';
  const d = new Date(when);
  if (isNaN(d.getTime())) return '';
  const today = startOfDay(new Date()).getTime();
  const dDay = startOfDay(d).getTime();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (dDay === today) return time;
  if (dDay === today + 86400000) return `Tomorrow ${time}`;
  if (dDay - today < 7 * 86400000 && dDay > today) {
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + time;
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time;
}

/* ─── Generic required-field validation helper ───────────────────────────
   Disables the submit button until every required input has a non-empty value.
   Wires `input` and `change` listeners so the state updates live as the user types.
*/
