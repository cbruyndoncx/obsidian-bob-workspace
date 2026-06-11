import type { App } from 'obsidian';
import type { PartialSettings } from './types';

export const CURRENCY_OPTIONS: { code: string; label: string }[] = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'ZAR', label: 'ZAR — South African Rand' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'BRL', label: 'BRL — Brazilian Real' },
  { code: 'AED', label: 'AED — UAE Dirham' },
];

/* ─────────── Helpers ─────────── */
export function pad(n: number | string): string { return String(n).padStart(2, '0'); }
export function ymd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function dailyNotePath(settings: PartialSettings, date: Date = new Date()): string {
  const folder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  const name = ymd(date);
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}
export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
export function dateInfo(d: Date = new Date()): { weekday: string; day: number; month: string; year: number } {
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
    day: d.getDate(),
    month: d.toLocaleDateString(undefined, { month: 'long' }),
    year: d.getFullYear(),
  };
}
export function startOfDay(d: Date | string | number): Date { const x = new Date(d); x.setHours(0,0,0,0); return x; }
export function addDays(d: Date | string | number, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d: Date | string | number, weekStartsOn: number = 1): Date {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStartsOn + 7) % 7;
  return addDays(x, -diff);
}
export function weekDates(anchor: Date | string | number, weekStartsOn: number = 1): Date[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

/* Map a 0-100 % to a colour band — drives progress bar tint. */
export function pctBand(pct: number): string {
  if (pct < 25) return 'rose';
  if (pct < 50) return 'warn';
  if (pct < 75) return 'mint';
  return 'emerald';
}

/* ─────────── Entity helpers ─────────── */
export function ensureFolderSync(app: App, path: string): Promise<unknown[]> {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  const promises: Promise<unknown>[] = [];
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      promises.push(app.vault.createFolder(cur).catch(() => {}));
    }
  }
  return Promise.all(promises);
}

export function isTemplatePath(path: string): boolean {
  return String(path || '')
    .split('/')
    .slice(0, -1)
    .some((segment) => ['template', 'templates'].includes(segment.toLowerCase()));
}

