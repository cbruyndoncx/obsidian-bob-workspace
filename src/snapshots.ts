import type { TAbstractFile } from 'obsidian';
import { ENTITIES, activityDate, activityTitle, dealStageField, dealTerminalStages, dealValueField } from './entities';
import { entityValue, fmtValue, listEntities, listEntityFiles } from './entity-files';
import { parseSections } from './notes';
import { readProjectMeta } from './project-notes';
import { projectNameFromPath, reminderTimeStr } from './reminders';
import { listAllTaskNotes } from './task-notes';
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

/* ── Daily-note history memo ──────────────────────────────────────────────
   The productivity history covers ~30 days + 12 weeks of daily notes, but
   past notes are effectively immutable — re-reading and re-parsing all of
   them on every snapshot build wasted ~114 serialized reads (with the last
   ~30 days parsed twice, once per loop). Entries are keyed by path and
   reused while the file's mtime and the two headings parseSections()
   depends on are unchanged, so a typical rebuild parses only today's note.
   Entries that slide out of the history window are pruned each build. */
interface DailyNoteStats { open: number; done: number; jChars: number }
const _dailyStatsMemo = new Map<string, { mtime: number; headingsKey: string; stats: DailyNoteStats }>();

async function dailyNoteStatsByDate(app: App, settings: PartialSettings, dates: Date[]): Promise<Map<string, DailyNoteStats | null>> {
  const headingsKey = `${settings.tasksHeading || ''}\u0000${settings.journalHeading || ''}`;
  const statsByDate = new Map<string, DailyNoteStats | null>();
  const livePaths = new Set<string>();
  await Promise.all(dates.map(async (d) => {
    const dateKey = ymd(d);
    // Dedup runs in the synchronous prefix of each callback, so overlapping
    // dates (the 30-day window sits inside the 12-week one) parse once.
    if (statsByDate.has(dateKey)) return;
    statsByDate.set(dateKey, null);
    const path = dailyNotePath(settings, d);
    livePaths.add(path);
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof obsidian.TFile)) return;
    const memo = _dailyStatsMemo.get(path);
    if (memo && memo.mtime === f.stat.mtime && memo.headingsKey === headingsKey) {
      statsByDate.set(dateKey, memo.stats);
      return;
    }
    const p = parseSections(await app.vault.cachedRead(f), settings);
    const stats: DailyNoteStats = {
      open: p.tasks.filter((l) => / \[ \] /.test(l)).length,
      done: p.tasks.filter((l) => / \[(x|X)\] /.test(l)).length,
      jChars: (p.journal || '').length,
    };
    _dailyStatsMemo.set(path, { mtime: f.stat.mtime, headingsKey, stats });
    statsByDate.set(dateKey, stats);
  }));
  for (const path of [..._dailyStatsMemo.keys()]) {
    if (!livePaths.has(path)) _dailyStatsMemo.delete(path);
  }
  return statsByDate;
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
  // Two distinct readings of the same corpus:
  //  - allTaskNotes: the standing backlog, no date window at all.
  //  - taskNotes:    the activity window, used by the timeline/heatmap/buckets.
  const allTaskNotes = includeTaskNotes ? listAllTaskNotes(app, settings) : [];
  const windowStartMs = startOfDay(taskNoteStart).getTime();
  const windowEndMs = startOfDay(today).getTime();
  const inWindow = (iso: string) => {
    if (!iso) return false;
    const t = new Date(iso + 'T00:00:00').getTime();
    return Number.isFinite(t) && t >= windowStartMs && t <= windowEndMs;
  };
  const taskNotes = allTaskNotes.filter((task) => inWindow(task.date));
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
  // Resolve every daily note both history loops need (30-day + 12-week
  // windows) in one parallel, memoized pass; the loops below are then
  // synchronous map lookups.
  const weekWindowDates: Date[] = [];
  for (let w = 11; w >= 0; w--) {
    const ws = addDays(weekStart, -w * 7);
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d.getTime() > today.getTime()) break;
      weekWindowDates.push(d);
    }
  }
  const statsByDate = await dailyNoteStatsByDate(app, settings, [...days, ...weekWindowDates]);
  const perDay = [];
  for (const d of days) {
    const dayStats = statsByDate.get(ymd(d));
    let open = 0, done = 0, jChars = 0, hasNote = false;
    if (dayStats) {
      hasNote = true;
      jChars = dayStats.jChars;
      if (includeCheckboxTasks) {
        open = dayStats.open;
        done = dayStats.done;
      }
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

  const todayStartMs = new Date(`${todayIso}T00:00:00`).getTime();
  taskNotes.forEach((task) => {
    const dueTime = task.due ? new Date(`${task.due}T00:00:00`).getTime() : NaN;
    const scheduledTime = task.scheduled ? new Date(`${task.scheduled}T00:00:00`).getTime() : NaN;
    const isOverdue = !task.done && ((Number.isFinite(dueTime) && dueTime < todayStartMs) || (Number.isFinite(scheduledTime) && scheduledTime < todayStartMs));
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

  // Backlog + flow. The stats above answer "how much activity happened in the
  // window"; these answer "is the backlog growing or shrinking", which is the
  // question a 30-day activity count structurally cannot answer.
  const flowStartMs = startOfDay(oldestDay).getTime();
  const inFlowWindow = (iso: string) => {
    if (!iso) return false;
    const t = new Date(iso + 'T00:00:00').getTime();
    return Number.isFinite(t) && t >= flowStartMs && t <= windowEndMs;
  };
  const backlogTasks = allTaskNotes.filter((task) => !task.done);
  const backlogOpen = backlogTasks.length;
  const backlogOverdue = backlogTasks.filter((task) => {
    const ref = task.due || task.scheduled;
    if (!ref) return false;
    const t = new Date(ref + 'T00:00:00').getTime();
    return Number.isFinite(t) && t < todayStartMs;
  }).length;
  const backlogStale = backlogTasks.filter((task) => task.created && !inFlowWindow(task.created)).length;
  const createdInWindow = allTaskNotes.filter((task) => inFlowWindow(task.created)).length;
  const closedInWindow = allTaskNotes.filter((task) => inFlowWindow(task.closed)).length;
  // Positive = backlog grew over the window, negative = it shrank.
  const netBacklogChange = createdInWindow - closedInWindow;
  // >100 means more was closed than created, i.e. the backlog is burning down.
  const burnRate = createdInWindow === 0
    ? (closedInWindow > 0 ? 200 : 0)
    : Math.min(200, Math.round((closedInWindow / createdInWindow) * 100));

  // Per-week created/closed counts, so the trend chart can show flow rather
  // than a raw activity count. Keyed by ISO date for O(1) lookup per week.
  const createdByDate = new Map<string, number>();
  const closedByDate = new Map<string, number>();
  allTaskNotes.forEach((task) => {
    if (task.created) createdByDate.set(task.created, (createdByDate.get(task.created) || 0) + 1);
    if (task.closed) closedByDate.set(task.closed, (closedByDate.get(task.closed) || 0) + 1);
  });

  const weeks = [];
  for (let w = 11; w >= 0; w--) {
    const ws = addDays(weekStart, -w * 7);
    let wd = 0, wo = 0, anyNote = false;
    let wCreated = 0, wClosed = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d.getTime() > today.getTime()) break;
      const dayStats = statsByDate.get(ymd(d));
      if (includeCheckboxTasks && dayStats) {
        anyNote = true;
        wd += dayStats.done;
        wo += dayStats.open;
      }
      if (includeTaskNotes) {
        const dayTaskNotes = taskNotesByDate.get(ymd(d)) || [];
        wd += dayTaskNotes.filter((task) => task.done).length;
        wo += dayTaskNotes.filter((task) => !task.done).length;
        if (dayTaskNotes.length) anyNote = true;
      }
      const iso = ymd(d);
      wCreated += createdByDate.get(iso) || 0;
      wClosed += closedByDate.get(iso) || 0;
    }
    weeks.push({
      start: ws,
      done: wd,
      open: wo,
      created: wCreated,
      closed: wClosed,
      net: wCreated - wClosed,
      any: anyNote,
      label: ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
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
    backlogOpen,
    backlogOverdue,
    backlogStale,
    createdInWindow,
    closedInWindow,
    netBacklogChange,
    burnRate,
    taskNotes,
    allTaskNotes,
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

  // Read-only: snapshots render dashboards and must never mutate the vault.
  // Creating the daily note here fired a vault `create` event mid-render,
  // which invalidated the scan cache and re-triggered rendering (and the
  // concurrent snapshot builds raced to create the same file). If today's
  // note doesn't exist yet, the task list is simply empty.
  const dailyFile: TAbstractFile | null = app.vault.getAbstractFileByPath(dailyNotePath(settings));
  const todayTasks = dailyFile instanceof obsidian.TFile ? parseSections(await app.vault.cachedRead(dailyFile), settings) : { tasks: [] as string[] };
  const todayRows = (todayTasks.tasks || [])
    .slice(0, 12)
    .map((line, taskIndex) => {
      const done = / \[(x|X)\] /.test(line);
      return {
        title: String(line).replace(/^\s*-\s\[(x|X| )\]\s/, ''),
        meta: done ? 'done' : 'open',
        value: done ? 1 : 0,
        values: { done: done ? 1 : 0, open: done ? 0 : 1, total: 1 },
        action: { surface: 'planner.today' },
        // Index in today's daily-note tasks section — lets the interactive
        // task-list widget toggle the checkbox back to the note.
        taskIndex,
        done,
      };
    });

  const weekDays = weekDates(today, settings.weekStartsOn || 1);
  const calendarRows = await Promise.all(weekDays.map(async (date) => {
    const path = dailyNotePath(settings, date);
    const file = app.vault.getAbstractFileByPath(path);
    let tasks: string[] = [];
    let journal = '';
    if (file instanceof obsidian.TFile) {
      const parsed = parseSections(await app.vault.cachedRead(file), settings);
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

  // Read-only: snapshots render dashboards and must never mutate the vault.
  // Creating the daily note here fired a vault `create` event mid-render,
  // which invalidated the scan cache and re-triggered rendering (and the
  // concurrent snapshot builds raced to create the same file). If today's
  // note doesn't exist yet, the task list is simply empty.
  const dailyFile: TAbstractFile | null = app.vault.getAbstractFileByPath(dailyNotePath(settings));
  const todayTasks = dailyFile instanceof obsidian.TFile ? parseSections(await app.vault.cachedRead(dailyFile), settings) : { tasks: [] as string[] };
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
  // Milestone discovery needs every project's note body; read them in one
  // parallel pass (they were serialized before) and keep the results so the
  // projects card below reuses them instead of re-reading its first three.
  const projectMetaByPath = new Map<string, Awaited<ReturnType<typeof readProjectMeta>> | null>();
  if (configuredEntities.has('project')) {
    const projectEntities = listEntities(app, 'project');
    await Promise.all(projectEntities.map(async (e) => {
      try {
        projectMetaByPath.set(e.file.path, await readProjectMeta(app, e.file));
      } catch (_) {
        // A project whose milestone metadata won't parse is skipped; the
        // widgets still render the rest.
        projectMetaByPath.set(e.file.path, null);
      }
    }));
    for (const e of projectEntities) {
      const due = entityValue(e, 'due', projectDef) || entityValue(e, 'deadline', projectDef);
      if (due) {
        const d = new Date(due);
        if (!isNaN(d.getTime()) && d >= today && d <= addDays(today, 7)) {
          upcoming.push({ date: d, title: entityValue(e, 'project_name', projectDef) || entityValue(e, 'name', projectDef) || e.basename, type: 'Project due', file: e.file });
        }
      }
      const meta = projectMetaByPath.get(e.file.path);
      if (meta && meta.next?.date && meta.next.date >= today && meta.next.date <= addDays(today, 7)) {
        upcoming.push({ date: meta.next.date, title: `${entityValue(e, 'project_name', projectDef) || entityValue(e, 'name', projectDef) || e.basename} — ${meta.next.title || 'milestone'}`, type: 'Milestone', file: e.file });
      }
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
  const projects = configuredEntities.has('project') ? listEntityFiles(app, 'project').slice(0, 3).map((f) => {
    const title = projectNameFromPath(app, f.path) || f.basename;
    const meta = projectMetaByPath.get(f.path);
    if (!meta) return { title, meta: 'project', file: f };
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
  }) : [];
  const deals = configuredEntities.has('deal') ? listEntities(app, 'deal') : [];
  const terminalStages = new Set(dealTerminalStages(dealDef));
  const openDeals = deals.filter((e) => !terminalStages.has(String(entityValue(e, 'stage', dealDef))));
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
        const content = await app.vault.cachedRead(dailyFile);
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

