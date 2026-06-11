import type { TAbstractFile } from 'obsidian';
import { ENTITIES, activityDate, activityTitle, dealStageField, dealTerminalStages, dealValueField } from './entities';
import { entityValue, fmtValue, listEntities, listEntityFiles } from './entity-files';
import { ensureDailyNote, parseSections } from './notes';
import { readProjectMeta } from './project-notes';
import { projectNameFromPath, reminderTimeStr } from './reminders';
import { listTaskNotesForProductivity } from './task-notes';
import { addDays, dailyNotePath, startOfDay, startOfWeek, weekDates, ymd } from './utils';
import { WORKSPACE_CONFIG, workspaceConfiguredEntityKeys } from './workspace-config';
import * as obsidian from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { ProductivityTaskNote } from './task-notes';
import type { PartialSettings } from './types';

/** Open/done tally bucket for the Productivity report (per project/context). */
interface ProductivityBucket {
  title: string;
  value: number;
  values: { open: number; done: number; total: number };
  meta: string;
}

export async function buildProductivitySnapshot(app: App, settings: PartialSettings = {}) {
  const taskMode = settings.taskMode || 'checkbox';
  const includeCheckboxTasks = taskMode === 'checkbox' || taskMode === 'hybrid';
  const includeTaskNotes = taskMode === 'tasknotes' || taskMode === 'hybrid';
  const today = startOfDay(new Date());
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
  const oldestDay = days[days.length - 1];
  const weekStart = startOfWeek(today, settings.weekStartsOn);
  const oldestWeekStart = addDays(weekStart, -11 * 7);
  const taskNoteStart = oldestWeekStart.getTime() < oldestDay.getTime() ? oldestWeekStart : oldestDay;
  const taskNotes = includeTaskNotes ? listTaskNotesForProductivity(app, settings, taskNoteStart, today) : [];
  const taskNotesByDate = new Map<string, ProductivityTaskNote[]>();
  taskNotes.forEach((task) => {
    if (!taskNotesByDate.has(task.date)) taskNotesByDate.set(task.date, []);
    taskNotesByDate.get(task.date).push(task);
  });
  const projectBuckets = new Map<string, ProductivityBucket>();
  const contextBuckets = new Map<string, ProductivityBucket>();
  const overdueTasks: ProductivityTaskNote[] = [];
  const highPriorityTasks: ProductivityTaskNote[] = [];
  const todayIso = ymd(today);
  const upsertBucket = (bucketMap: Map<string, ProductivityBucket>, title: string) => {
    const key = String(title || '').trim();
    if (!key) return null;
    const current = bucketMap.get(key) || { title: key, value: 0, values: { open: 0, done: 0, total: 0 }, meta: '' };
    bucketMap.set(key, current);
    return current;
  };
  let totalOpen = 0, totalDone = 0, totalJournalChars = 0;
  let activeDays = 0;
  let streak = 0, streakBroken = false;
  const perDay = [];
  for (const d of days) {
    const f = app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
    let open = 0, done = 0, jChars = 0, hasNote = false;
    if (includeCheckboxTasks && f && f instanceof obsidian.TFile) {
      hasNote = true;
      const c = await app.vault.read(f);
      const p = parseSections(c, settings);
      open = p.tasks.filter((l) => / \[ \] /.test(l)).length;
      done = p.tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
      jChars = (p.journal || '').length;
    } else if (f && f instanceof obsidian.TFile) {
      hasNote = true;
      const c = await app.vault.read(f);
      const p = parseSections(c, settings);
      jChars = (p.journal || '').length;
    }
    const dayTaskNotes = taskNotesByDate.get(ymd(d)) || [];
    if (includeTaskNotes) {
      done += dayTaskNotes.filter((task) => task.done).length;
      open += dayTaskNotes.filter((task) => !task.done).length;
    }
    const hasTaskNote = dayTaskNotes.length > 0;
    perDay.push({ date: d, open, done, jChars, hasNote, hasTaskNote });
    totalOpen += open; totalDone += done; totalJournalChars += jChars;
    if (hasNote || hasTaskNote) activeDays++;
    if (!streakBroken) {
      if ((hasNote || hasTaskNote) && (done > 0 || jChars > 0)) streak++;
      else streakBroken = true;
    }
  }

  taskNotes.forEach((task) => {
    const dueTime = task.due ? new Date(`${task.due}T00:00:00`).getTime() : NaN;
    const scheduledTime = task.scheduled ? new Date(`${task.scheduled}T00:00:00`).getTime() : NaN;
    const isOverdue = !task.done && ((Number.isFinite(dueTime) && dueTime < new Date(`${todayIso}T00:00:00`).getTime()) || (Number.isFinite(scheduledTime) && scheduledTime < new Date(`${todayIso}T00:00:00`).getTime()));
    const isHighPriority = !task.done && ['high', 'urgent', 'critical'].includes(String(task.priority || '').toLowerCase());
    if (isOverdue) overdueTasks.push(task);
    if (isHighPriority) highPriorityTasks.push(task);
    (Array.isArray(task.projects) ? task.projects : []).forEach((project) => {
      const bucket = upsertBucket(projectBuckets, project);
      if (!bucket) return;
      bucket.value += 1;
      bucket.values.total += 1;
      if (task.done) bucket.values.done += 1; else bucket.values.open += 1;
      bucket.meta = `${bucket.values.open} open · ${bucket.values.done} done`;
    });
    (Array.isArray(task.contexts) ? task.contexts : []).forEach((context) => {
      const bucket = upsertBucket(contextBuckets, context);
      if (!bucket) return;
      bucket.value += 1;
      bucket.values.total += 1;
      if (task.done) bucket.values.done += 1; else bucket.values.open += 1;
      bucket.meta = `${bucket.values.open} open · ${bucket.values.done} done`;
    });
  });

  const completion = totalOpen + totalDone === 0 ? 0 : Math.round((totalDone / (totalOpen + totalDone)) * 100);
  const weeks = [];
  for (let w = 11; w >= 0; w--) {
    const ws = addDays(weekStart, -w * 7);
    const we = addDays(ws, 7);
    let wd = 0, wo = 0, anyNote = false;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d.getTime() > today.getTime()) break;
      const f = app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
      if (includeCheckboxTasks && f && f instanceof obsidian.TFile) {
        anyNote = true;
        const c = await app.vault.read(f);
        const p = parseSections(c, settings);
        p.tasks.forEach((l) => { if (/ \[(x|X)\] /.test(l)) wd++; else if (/ \[ \] /.test(l)) wo++; });
      }
      if (includeTaskNotes) {
        const dayTaskNotes = taskNotesByDate.get(ymd(d)) || [];
        wd += dayTaskNotes.filter((task) => task.done).length;
        wo += dayTaskNotes.filter((task) => !task.done).length;
        if (dayTaskNotes.length) anyNote = true;
      }
    }
    weeks.push({ start: ws, done: wd, open: wo, any: anyNote, label: ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }
  const wsOn = settings.weekStartsOn;
  const dayBuckets = Array.from({ length: 7 }, () => ({ done: 0, open: 0 }));
  perDay.forEach((p) => {
    const idx = (p.date.getDay() - wsOn + 7) % 7;
    dayBuckets[idx].done += p.done;
    dayBuckets[idx].open += p.open;
  });

  return {
    settings,
    taskMode,
    includeCheckboxTasks,
    includeTaskNotes,
    today,
    days,
    perDay,
    weeks,
    dayBuckets,
    totalOpen,
    totalDone,
    totalJournalChars,
    activeDays,
    streak,
    completion,
    taskNotes,
    projectBuckets: [...projectBuckets.values()].sort((a, b) => b.value - a.value),
    contextBuckets: [...contextBuckets.values()].sort((a, b) => b.value - a.value),
    overdueTasks: overdueTasks.sort((a, b) => String(a.due || a.scheduled || '9999-12-31').localeCompare(String(b.due || b.scheduled || '9999-12-31'))),
    highPriorityTasks: highPriorityTasks.sort((a, b) => {
      const rank: Record<string, number> = { critical: 0, urgent: 1, high: 2 };
      return (rank[String(a.priority || '').toLowerCase()] ?? 9) - (rank[String(b.priority || '').toLowerCase()] ?? 9);
    }),
  };
}

export async function buildPlannerSnapshot(app: App, settings: PartialSettings = {}) {
  const today = startOfDay(new Date());
  const nowMs = Date.now();
  const reminders = (settings.reminders || []).filter((r) => !r.done);

  const inbox = reminders
    .slice()
    .sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      return wa - wb;
    })
    .slice(0, 10)
    .map((r) => ({
      title: r.text || 'Reminder',
      meta: [r.when ? reminderTimeStr(r.when) : 'unscheduled', r.project ? projectNameFromPath(app, r.project) || 'project' : '']
        .filter(Boolean)
        .join(' · '),
      value: r.when ? new Date(r.when).getTime() : nowMs,
      action: { surface: 'planner.inbox' },
    }));

  const dailyFile = await ensureDailyNote(app, settings).catch((): TAbstractFile | null => null);
  const todayTasks = dailyFile instanceof obsidian.TFile ? parseSections(await app.vault.read(dailyFile), settings) : { tasks: [] as string[] };
  const todayRows = (todayTasks.tasks || [])
    .slice(0, 12)
    .map((line) => {
      const done = / \[(x|X)\] /.test(line);
      return {
        title: String(line).replace(/^\s*-\s\[(x|X| )\]\s/, ''),
        meta: done ? 'done' : 'open',
        value: done ? 1 : 0,
        values: { done: done ? 1 : 0, open: done ? 0 : 1, total: 1 },
        action: { surface: 'planner.today' },
      };
    });

  const weekDays = weekDates(today, settings.weekStartsOn || 1);
  const calendarRows = await Promise.all(weekDays.map(async (date) => {
    const path = dailyNotePath(settings, date);
    const file = app.vault.getAbstractFileByPath(path);
    let tasks: string[] = [];
    let journal = '';
    if (file instanceof obsidian.TFile) {
      const parsed = parseSections(await app.vault.read(file), settings);
      tasks = parsed.tasks || [];
      journal = parsed.journal || '';
    }
    const open = tasks.filter((l) => / \[ \] /.test(l)).length;
    const done = tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
    return {
      title: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      meta: file instanceof obsidian.TFile ? `${open} open · ${done} done${journal ? ` · journal ${journal.length} chars` : ''}` : 'no note',
      value: done,
      values: { done, open, total: open + done, journal: journal.length },
      file: file instanceof obsidian.TFile ? file : null,
      action: { surface: 'planner.calendar' },
    };
  }));

  const projectFiles = listEntityFiles(app, 'project');
  const projectsRows = await Promise.all(projectFiles.slice(0, 8).map(async (file) => {
    const title = projectNameFromPath(app, file.path) || file.basename;
    try {
      const meta = await readProjectMeta(app, file);
      return {
        title,
        meta: meta.total ? `${meta.done}/${meta.total} milestones · ${meta.percent}%` : 'project',
        value: meta.percent,
        values: { done: meta.done, total: meta.total, pct: meta.percent },
        progress: {
          value: meta.percent,
          label: meta.total ? `${meta.done}/${meta.total} milestones` : 'No milestones',
          pct: `${meta.percent}%`,
        },
        file,
        action: { surface: 'planner.projects' },
      };
    } catch (_) {
      return { title, meta: 'project', file, action: { surface: 'planner.projects' } };
    }
  }));

  const openTaskCount = todayRows.filter((row) => Number(row.values?.open) > 0).length;
  const doneTaskCount = todayRows.filter((row) => Number(row.values?.done) > 0).length;
  const calendarOpenCount = calendarRows.reduce((sum, row) => sum + (Number(row.values?.open) || 0), 0);
  const calendarDoneCount = calendarRows.reduce((sum, row) => sum + (Number(row.values?.done) || 0), 0);
  const overdueCount = reminders.filter((r) => r.when && new Date(r.when).getTime() <= nowMs).length;
  const briefing = [];
  if (openTaskCount) briefing.push({ title: `${openTaskCount} open ${openTaskCount === 1 ? 'task' : 'tasks'} today`, meta: 'planner.today', tone: 'emerald', action: { surface: 'planner.today' } });
  if (overdueCount) briefing.push({ title: `${overdueCount} overdue reminder${overdueCount === 1 ? '' : 's'}`, meta: 'planner.inbox', tone: 'rose', action: { surface: 'planner.inbox' } });
  if (projectsRows.length) briefing.push({ title: `${projectsRows.length} active project${projectsRows.length === 1 ? '' : 's'}`, meta: 'planner.projects', tone: 'mint', action: { surface: 'planner.projects' } });

  return {
    inbox,
    todayRows,
    calendarRows,
    projectsRows,
    briefing,
    overviewRows: briefing,
    inboxCount: inbox.length,
    todayCount: todayRows.length,
    calendarCount: calendarRows.length,
    projectCount: projectsRows.length,
    overdueCount,
    todayOpenCount: openTaskCount,
    todayDoneCount: doneTaskCount,
    calendarOpenCount,
    calendarDoneCount,
    totalOpenTasks: openTaskCount + calendarOpenCount,
    totalDoneTasks: doneTaskCount + calendarDoneCount,
  };
}

export async function buildHomeSnapshot(app: App, settings: PartialSettings = {}) {
  const today = startOfDay(new Date());
  const nowMs = Date.now();
  const configuredEntities = workspaceConfiguredEntityKeys(WORKSPACE_CONFIG);
  const reminders = (settings.reminders || []).filter((r) => !r.done);
  const dealDef = ENTITIES.deal;
  const contactDef = ENTITIES.contact;
  const partnerDef = ENTITIES.partner;
  const projectDef = ENTITIES.project;
  const certificationDef = ENTITIES.certification;
  const activityDef = ENTITIES.activity;
  const inbox = reminders
    .slice()
    .sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      return wa - wb;
    })
    .slice(0, 5)
    .map((r) => ({
      title: r.text || 'Reminder',
      meta: [r.when ? reminderTimeStr(r.when) : 'unscheduled', r.project ? projectNameFromPath(app, r.project) || 'project' : '']
        .filter(Boolean)
        .join(' · '),
      action: { surface: 'planner.inbox' },
    }));

  const dailyFile = await ensureDailyNote(app, settings).catch((): TAbstractFile | null => null);
  const todayTasks = dailyFile instanceof obsidian.TFile ? parseSections(await app.vault.read(dailyFile), settings) : { tasks: [] as string[] };
  const todayRows = (todayTasks.tasks || [])
    .slice(0, 8)
    .map((line) => ({
      title: String(line).replace(/^\s*-\s\[(x|X| )\]\s/, ''),
      meta: / \[(x|X)\] /.test(line) ? 'done' : 'open',
      action: { surface: 'planner.today' },
    }));
  const week = await buildProductivitySnapshot(app, settings).catch((): Awaited<ReturnType<typeof buildProductivitySnapshot>> | null => null);
  const weekRows = week ? [{
    title: 'This week',
    meta: `${week.streak}d streak · ${week.activeDays} active days · ${week.completion}% complete`,
    action: { surface: 'planner.calendar' },
  }] : [];

  const upcoming: { date: Date; title: string; type: string; file: TFile }[] = [];
  if (configuredEntities.has('project')) {
    for (const e of listEntities(app, 'project')) {
      const due = entityValue(e, 'due', projectDef) || entityValue(e, 'deadline', projectDef);
      if (due) {
        const d = new Date(due);
        if (!isNaN(d.getTime()) && d >= today && d <= addDays(today, 7)) {
          upcoming.push({ date: d, title: entityValue(e, 'project_name', projectDef) || entityValue(e, 'name', projectDef) || e.basename, type: 'Project due', file: e.file });
        }
      }
      try {
        const meta = await readProjectMeta(app, e.file);
        if (meta.next?.date && meta.next.date >= today && meta.next.date <= addDays(today, 7)) {
          upcoming.push({ date: meta.next.date, title: `${entityValue(e, 'project_name', projectDef) || entityValue(e, 'name', projectDef) || e.basename} — ${meta.next.title || 'milestone'}`, type: 'Milestone', file: e.file });
        }
      } catch (_) { /* skip a project whose milestone metadata won't parse; widget still renders the rest */ }
    }
  }
  if (configuredEntities.has('registration')) {
    listEntities(app, 'registration').forEach((e) => {
      const exp = entityValue(e, 'expires_date', ENTITIES.registration);
      if (!exp) return;
      const d = new Date(exp);
      if (!isNaN(d.getTime()) && d >= today && d <= addDays(today, 7)) {
        upcoming.push({ date: d, title: entityValue(e, 'title', ENTITIES.registration) || e.basename, type: 'Registration expires', file: e.file });
      }
    });
  }
  if (configuredEntities.has('certification')) {
    listEntities(app, 'certification').forEach((e) => {
      const exp = entityValue(e, 'expires_date', certificationDef);
      if (!exp) return;
      const d = new Date(exp);
      if (!isNaN(d.getTime()) && d >= today && d <= addDays(today, 7)) {
        upcoming.push({ date: d, title: entityValue(e, 'name', certificationDef) || e.basename, type: 'Cert expires', file: e.file });
      }
    });
  }
  upcoming.sort((a, b) => (a.date as unknown as number) - (b.date as unknown as number));
  const upcomingRows = upcoming.slice(0, 6).map((it) => ({
    title: it.title,
    meta: `${fmtValue(it.date, 'date')} · ${it.type}`,
    file: it.file,
  }));

  const partners = configuredEntities.has('partner') ? listEntities(app, 'partner').slice(0, 5).map((e) => ({
    title: entityValue(e, 'name', partnerDef) || e.basename,
    meta: [entityValue(e, 'tier', partnerDef), entityValue(e, 'status', partnerDef)].filter(Boolean).join(' · '),
    file: e.file,
  })) : [];
  const projects = configuredEntities.has('project') ? await Promise.all(listEntityFiles(app, 'project').slice(0, 3).map(async (f) => {
    const title = projectNameFromPath(app, f.path) || f.basename;
    try {
      const meta = await readProjectMeta(app, f);
      return {
        title,
        meta: meta.total ? `${meta.done}/${meta.total} milestones · ${meta.percent}%` : 'project',
        file: f,
        progress: {
          value: meta.percent,
          label: meta.total ? `${meta.done}/${meta.total} milestones` : 'No milestones',
          pct: `${meta.percent}%`,
        },
      };
    } catch (_) {
      return { title, meta: 'project', file: f };
    }
  })) : [];
  const deals = configuredEntities.has('deal') ? listEntities(app, 'deal') : [];
  const openDeals = deals.filter((e) => !dealTerminalStages(dealDef).includes(String(entityValue(e, 'stage', dealDef))));
  const pipelineRows = openDeals.slice(0, 5).map((e) => ({
    title: entityValue(e, 'title', dealDef) || e.basename,
    meta: `${entityValue(e, dealStageField(dealDef), dealDef) || '—'} · ${fmtValue(entityValue(e, dealValueField(dealDef), dealDef), 'currency')}`,
    file: e.file,
  }));
  const activityRows = configuredEntities.has('activity') ? listEntities(app, 'activity').slice()
    .sort((a, b) => new Date(activityDate(b, activityDef) || 0).getTime() - new Date(activityDate(a, activityDef) || 0).getTime())
    .slice(0, 5)
    .map((e) => ({
      title: activityTitle(e, activityDef),
      meta: `${entityValue(e, 'channel', activityDef) || '—'} · ${entityValue(e, 'client_id', activityDef) || '—'} · ${fmtValue(activityDate(e, activityDef), 'date')}`,
      file: e.file,
    })) : [];

  const briefing = await (async () => {
    const items = [];
    try {
      if (dailyFile instanceof obsidian.TFile) {
        const content = await app.vault.read(dailyFile);
        const parsed = parseSections(content, settings);
        const openTasks = parsed.tasks.filter((l) => / \[ \] /.test(l)).length;
        if (openTasks > 0) {
          items.push({ title: `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'} on today\\'s note`, meta: 'planner.today', tone: 'emerald', action: { surface: 'planner.today' } });
        }
      }
    } catch (_) { /* today's note missing or unreadable — the open-tasks hint is skipped */ }
    const overdue = reminders.filter((r) => r.when && new Date(r.when).getTime() <= nowMs);
    if (overdue.length) items.push({ title: `${overdue.length} overdue reminder${overdue.length === 1 ? '' : 's'}`, meta: overdue[0].text, tone: 'rose', action: { surface: 'planner.inbox' } });
    if (openDeals.length) items.push({ title: `${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'}`, meta: `${fmtValue(openDeals.reduce((s, e) => s + (Number(entityValue(e, dealValueField(dealDef), dealDef)) || 0), 0), 'currency')} pipeline`, tone: 'sky', action: { surface: 'crm.pipeline' } });
    if (partners.length) items.push({ title: `${partners.length} partner${partners.length === 1 ? '' : 's'}`, meta: 'prm.partners', tone: 'mint', action: { surface: 'prm.partners' } });
    return items.slice(0, 4);
  })();

  return { briefing, inbox, todayRows, weekRows, upcomingRows, partners, projects, pipelineRows, activityRows };
}

