import { startOfDay } from './utils';
import type { App, TFile } from 'obsidian';

/**
 * A parsed `## Milestones` line: `date` is a real `Date | null` (not an ISO
 * string) and milestones carry free-form indented `notes`.
 */
export interface ProjectMilestone {
  done: boolean;
  date: Date | null;
  title: string;
  notes: string;
}

/** A plain `- [ ]` task line from the Tasks H2 section (no id/date). */
export interface ProjectTaskItem {
  done: boolean;
  title: string;
}

export interface ProjectMeta {
  content: string;
  sections: Record<string, string>;
  milestones: ProjectMilestone[];
  total: number;
  done: number;
  percent: number;
  next: ProjectMilestone | null;
  today: Date;
}

export function parseH2Sections(content: string): Record<string, string> {
  const lines = content.split('\n');
  const sections: Record<string, string> = {};
  let cur: string | null = null, buf: string[] = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (cur) sections[cur] = buf.join('\n');
      cur = line.replace(/^##\s+/, '').trim();
      buf = [];
    } else if (cur) {
      buf.push(line);
    }
  }
  if (cur) sections[cur] = buf.join('\n');
  return sections;
}

/* Parse milestone lines: `- [x] 2026-05-15 — Title`
   Indented (1-tab or 1-4 spaces) non-empty lines that follow a milestone are
   treated as that milestone's free-form notes.
   Returns array of { done, date (Date|null), title, notes }. */
export function parseMilestones(text: string): ProjectMilestone[] {
  if (!text) return [];
  const lines = text.split('\n');
  const items: ProjectMilestone[] = [];
  let current: ProjectMilestone | null = null;
  for (const line of lines) {
    if (/^\s*-\s\[(x|X| )\]\s/.test(line)) {
      if (current) items.push(current);
      const done = / \[(x|X)\] /.test(line);
      const rest = line.replace(/^\s*-\s\[(x|X| )\]\s/, '');
      const m = rest.match(/^(\d{4}-\d{2}-\d{2})\s*(?:[—–-]\s*)?(.+)?$/);
      const date = m && m[1] ? new Date(m[1]) : null;
      const title = m ? (m[2] || '').trim() : rest.trim();
      current = {
        done,
        date: (date && !isNaN(date.getTime())) ? date : null,
        title,
        notes: '',
      };
    } else if (current && line.trim() && /^[ \t]/.test(line)) {
      // Indented non-empty line → child note for the current milestone.
      // Strip up to 4 leading spaces or one tab; preserve any deeper indent.
      const stripped = line.replace(/^( {1,4}|\t)/, '');
      current.notes = current.notes ? current.notes + '\n' + stripped : stripped;
    }
    // Empty / non-indented non-milestone lines are ignored — they shouldn't
    // appear inside the Milestones section but we won't choke on them.
  }
  if (current) items.push(current);
  return items;
}

/* Format a milestone array back into markdown lines.
   Notes are emitted as 4-space-indented child lines under the milestone. */
export function stringifyMilestones(items: ProjectMilestone[]): string {
  if (!items || !items.length) return '';
  return items.map((m) => {
    const box = m.done ? '- [x] ' : '- [ ] ';
    const date = m.date instanceof Date && !isNaN(m.date.getTime())
      ? `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}-${String(m.date.getDate()).padStart(2, '0')} `
      : '';
    const sep = (date && m.title) ? '— ' : '';
    let line = `${box}${date}${sep}${m.title || ''}`.trimEnd();
    if (m.notes && m.notes.trim()) {
      const noteLines = m.notes.split('\n').map((l) => '    ' + l).join('\n');
      line += '\n' + noteLines;
    }
    return line;
  }).join('\n');
}

/* Plain task lines (no date prefix) — for the Tasks H2 section. */
export function parseTasksList(text: string): ProjectTaskItem[] {
  if (!text) return [];
  return text.split('\n')
    .filter((l) => /^\s*-\s\[(x|X| )\]\s/.test(l))
    .map((l) => ({
      done: / \[(x|X)\] /.test(l),
      title: l.replace(/^\s*-\s\[(x|X| )\]\s/, ''),
    }));
}
export function stringifyTasks(items: ProjectTaskItem[]): string {
  if (!items || !items.length) return '';
  return items.map((t) => `${t.done ? '- [x] ' : '- [ ] '}${t.title || ''}`).join('\n');
}

/* ─── TaskNote helpers (used when taskMode !== 'checkbox') ─── */

export async function readProjectMeta(app: App, file: TFile): Promise<ProjectMeta> {
  const content = await app.vault.cachedRead(file);
  const sections = parseH2Sections(content);
  const milestones = parseMilestones(sections['Milestones'] || '');
  const total = milestones.length;
  const done = milestones.filter((m) => m.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const today = startOfDay(new Date());
  const upcoming = milestones
    .filter((m) => !m.done && m.date)
    .sort((a, b) => (a.date as unknown as number) - (b.date as unknown as number));
  const next = upcoming[0] || null;
  return { content, sections, milestones, total, done, percent, next, today };
}

