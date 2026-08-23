/* Partner-programme automation that must run whether or not the BOB app view is
 * open: commission creation on a won deal, and one-time expiry reminders for
 * certifications and registrations.
 *
 * These live outside the view because the events that trigger them (a deal's
 * stage edited in the frontmatter editor, a certification crossing its warning
 * window overnight) do not require anybody to be looking at a BOB surface. */
import { ENTITIES, dealStageField, dealValueField, dealWonStages } from './entities';
import { entityValue, listEntities, readEntity } from './entity-files';
import { reminderId } from './reminders';
import * as obsidian from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { EntityDef, EntityRecord, PartialSettings, Reminder } from './types';

/** Warning window before expiry, in days. Certifications get a long runway
 * because renewal usually means sitting an exam; registrations get a shorter
 * one because the response is to close, extend or decline a live deal. */
export const CERT_WARN_DAYS = 60;
export const REG_WARN_DAYS = 30;
/** How far ahead of expiry the reminder is scheduled to surface. */
const CERT_REMIND_LEAD_DAYS = 30;
const REG_REMIND_LEAD_DAYS = 7;

export function daysUntil(raw: unknown, from: Date = new Date()): number | null {
  const v = String(raw || '').slice(0, 10);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** Strip `[[ ]]` and any `|alias` from a reference value. */
export function nakedRef(raw: unknown): string {
  return String(raw || '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
}

/** The partner a deal is attributed to, or '' if none.
 *
 * `partner_ref` is the field the data model declares and the one every writer
 * (the registration converter, the entity form, hand edits) actually uses.
 * `partner` is read as a fallback only because some older notes carry it. PRM
 * analytics read `partner` alone until 2026-08-23, which made every deal written
 * with the declared field invisible to partner attribution — hence one shared
 * resolver rather than a filter expression repeated per call site.
 */
export function dealPartnerName(deal: EntityRecord, dealDef: EntityDef): string {
  return nakedRef(entityValue(deal, 'partner_ref', dealDef) || entityValue(deal, 'partner', dealDef));
}

/** Days a deal has been stalled, and why — or null when nothing flags it.
 *
 * Two signals, both actionable in a partner conversation: an expected close date
 * that has already passed (the plan is out of date and nobody has said so), and
 * no contact for over 30 days (nothing is moving it). `probability` is
 * deliberately not used — a low probability is an opinion, and it is the opinion
 * the review is supposed to produce.
 */
export const DEAL_STALE_DAYS = 30;
export function dealAtRisk(deal: EntityRecord, dealDef: EntityDef): string | null {
  const due = daysUntil(entityValue(deal, dealDef.closeByField || 'expected_close', dealDef));
  if (due !== null && due < 0) return `close date ${Math.abs(due)}d overdue`;
  const touched = daysUntil(entityValue(deal, 'last_contact', dealDef));
  if (touched !== null && touched < -DEAL_STALE_DAYS) return `no contact for ${Math.abs(touched)}d`;
  return null;
}

/* ── Commission on won deal ────────────────────────────────────── */

/** Create a commission record when a partner-sourced deal reaches a won stage.
 *
 * Commissions were previously created by hand after every won deal, which is
 * exactly the kind of step that gets skipped in a busy week — and an unrecorded
 * commission is a partner-trust problem, not a bookkeeping one.
 *
 * Deliberately conservative:
 *  - only for a won stage, and only when the deal names a partner
 *  - never creates a second commission for the same deal (idempotent)
 *  - status is `earned`, not `paid` — this records the liability, it does not settle it
 *  - a rate is only applied when the partner declares one; no invented default,
 *    because a wrong rate is worse than a blank one somebody has to fill in
 *
 * Returns true when a commission file was created.
 */
export async function maybeCreateCommissionForWonDeal(app: App, file: TFile, newStage: string): Promise<boolean> {
  const dealDef = ENTITIES.deal;
  const commDef = ENTITIES.commission;
  if (!dealDef || !commDef) return false;
  if (!dealWonStages(dealDef).includes(newStage)) return false;

  const deal = readEntity(app, file);
  const partnerName = dealPartnerName(deal, dealDef);
  if (!partnerName) return false;

  // Idempotency: if any commission already references this deal, stop.
  const dealKey = file.basename;
  const existing = listEntities(app, 'commission')
    .some((c) => String(entityValue(c, 'deal_ref', commDef) || '').includes(dealKey));
  if (existing) return false;

  const value = Number(entityValue(deal, dealValueField(dealDef), dealDef)) || 0;
  // Partner's primary field is `partner_name`; `name` falls back to basename
  // in entityValue, so match on either rather than only one.
  const partner = listEntities(app, 'partner').find((pt) => {
    const pn = String(entityValue(pt, 'partner_name', ENTITIES.partner) || '').trim();
    return pn === partnerName || pt.basename === partnerName;
  });
  // `commission_rate` is a declared partner field. When a given partner leaves it
  // blank the amount stays 0 and the note says so, which is the safe direction:
  // a wrong commission figure is worse than a blank one somebody has to fill in.
  const rate = partner ? Number(entityValue(partner, 'commission_rate', ENTITIES.partner)) : NaN;
  const amount = Number.isFinite(rate) && rate > 0 ? Math.round(value * (rate / 100)) : 0;

  const today = new Date().toISOString().slice(0, 10);
  const period = today.slice(0, 7);
  const folder = `${commDef.folder}/COMMISSIONS`;
  if (!app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder).catch(() => {});
  }
  const safe = `${partnerName}-${dealKey}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  const path = `${folder}/commission-${safe}.md`;
  if (app.vault.getAbstractFileByPath(path)) return false;

  const body = [
    '---',
    'type: commission',
    `reference: commission-${safe}`,
    `partner_ref: "[[${partnerName}]]"`,
    `deal_ref: "[[${dealKey}]]"`,
    ...(Number.isFinite(rate) && rate > 0 ? [`rate_pct: ${rate}`] : []),
    `amount: ${amount}`,
    'status: earned',
    `period: ${period}`,
    `earned_date: ${today}`,
    '---',
    '',
    `# Commission — ${partnerName}`,
    '',
    `Auto-created when [[${dealKey}]] reached stage \`${newStage}\`.`,
    '',
    amount > 0
      ? `Amount computed from deal value ${value} at the partner's declared rate of ${rate}%.`
      : `**Amount not computed** — the partner record leaves \`commission_rate\` blank. Set the amount by hand, or add a rate to the partner and delete this note to have it regenerate.`,
    '',
  ].join('\n');

  await app.vault.create(path, body);
  new obsidian.Notice(`Commission recorded for ${partnerName}`);
  return true;
}

/* ── Expiry reminders ──────────────────────────────────────────── */

interface ReminderHost {
  settings: PartialSettings;
  saveSettings: () => Promise<void>;
  refreshOpenViews?: () => void;
}

/** Push a one-time inbox reminder for each certification or registration that has
 * entered its warning window.
 *
 * The status sweep already recolours these on a surface, but a surface only warns
 * somebody who opens it. The reminder is what reaches a person who does not.
 *
 * Seen-tracking is keyed by `path::expires_date`, not by path alone: renewing a
 * certification to a new date is a new expiry and deserves a new reminder, while
 * re-saving the same note does not.
 */
export async function pushPartnerExpiryReminders(app: App, host: ReminderHost, candidates: TFile[]): Promise<number> {
  if (host.settings.partnerExpiryReminders === false) return 0;
  const seen: Record<string, string> = host.settings.expiryReminderSeen || {};
  const reminders: Reminder[] = Array.isArray(host.settings.reminders) ? host.settings.reminders : [];
  const added: Reminder[] = [];

  for (const file of candidates) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) continue;
    const type = String(fm.type || '');
    if (type !== 'certification' && type !== 'registration') continue;

    const status = String(fm.status || '');
    // Terminal states are settled decisions — nothing left to chase.
    if (['renewed', 'revoked', 'rejected', 'expired'].includes(status)) continue;
    // A registration already converted to a won deal no longer needs protecting.
    if (type === 'registration' && status !== 'approved') continue;

    const expires = String(fm.expires_date || '').slice(0, 10);
    const d = daysUntil(expires);
    if (d === null) continue;
    const window = type === 'certification' ? CERT_WARN_DAYS : REG_WARN_DAYS;
    if (d > window) continue;

    const key = `${file.path}::${expires}`;
    if (seen[key]) continue;

    const partner = String(fm.partner_ref || '').replace(/^\[\[|\]\]$/g, '');
    const name = String(fm.name || fm.title || file.basename);
    const text = type === 'certification'
      ? `Renew ${name}${partner ? ` at ${partner}` : ''} — expires ${expires}`
      : `Registration ${name}${partner ? ` from ${partner}` : ''} expires ${expires} — close or extend`;

    const lead = type === 'certification' ? CERT_REMIND_LEAD_DAYS : REG_REMIND_LEAD_DAYS;
    const when = new Date(expires);
    when.setDate(when.getDate() - lead);
    when.setHours(9, 0, 0, 0);
    // A record already inside the lead window (or past expiry) must surface now,
    // not at a date in the past where no bucket would ever show it.
    if (when.getTime() < Date.now()) {
      const now = new Date();
      now.setHours(9, 0, 0, 0);
      when.setTime(Math.max(now.getTime(), Date.now()));
    }

    added.push({
      id: reminderId(),
      text,
      when: when.toISOString(),
      repeat: 'none',
      notes: `Auto-raised from ${file.path}`,
      project: null,
      notified: false,
      done: false,
      createdAt: new Date().toISOString(),
    });
    seen[key] = new Date().toISOString().slice(0, 10);
  }

  if (!added.length) return 0;
  host.settings.reminders = reminders.concat(added);
  host.settings.expiryReminderSeen = seen;
  await host.saveSettings();
  host.refreshOpenViews?.();
  return added.length;
}
