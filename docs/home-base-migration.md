# Design: Base-first Home (retire `built-in` snapshot sources)

Status: Phase 1 implemented (config-only); Phases 2–4 planned.

## Goal & non-goals

**Goal:** Home's data comes from `metadataCache` (frontmatter), so it renders as
fast as CRM, with no full-note-body disk reads on render.

**Non-goals:** Don't change what Home *shows*; don't touch CRM/Reports; keep
markdown the source of truth (computed fields are clearly namespaced and
re-derivable).

## Why bodies are the problem

`buildHomeSnapshot` (`src/snapshots.ts`) produces 9 row-sets. The slow ones parse
note **bodies**: `## Today` checkboxes in daily notes, `## Milestones` in project
notes, and `buildProductivitySnapshot` which reads ~30 daily notes + 12 weeks on
every render. CRM never does this — its widgets are `mode:'entity'` over
frontmatter, resolved through `metadataCache` + the per-render scan cache.

Both surfaces share `renderConfigDashboard`, which paints cards sequentially, so
Home's body reads surface as a visible "section by section" reveal.

## Categorize the Home widgets by data source

| Widget | Current source | Real data origin | Class |
|---|---|---|---|
| Actions | — | static | none |
| PIPELINE | `built-in:home/pipeline` | deal **frontmatter** | **A — config only** |
| PARTNERS | `built-in:home/partners` | partner **frontmatter** | **A — config only** |
| RECENT ACTIVITY | `built-in:home/activities` | activity **frontmatter** | **A — config only** |
| UPCOMING (project due, reg/cert expires) | `built-in:home/upcoming` | **frontmatter** dates | **A — config only** |
| UPCOMING (next milestone) | same | project **body** | **B — materialize** |
| TODAY | `built-in:home/today` | daily note **body** | **B — materialize** |
| THIS WEEK | `built-in:home/week` | productivity (30 **bodies**) | **B — materialize** |
| PROJECTS | `built-in:home/projects` | milestone **body** | **B — materialize** |
| TOP OF THE DAY (briefing) | `built-in:home/briefing` | counts of A+B+reminders | **B — recompose** |
| INBOX | `built-in:home/inbox` | `settings.reminders` (no files) | **C — stays runtime** |

Class **A** is the cheap part and needs **zero new code** — just config. Class
**B** is where the cost lives and needs a materializer. Class **C** is already
free (reads an in-memory array, not files).

## Phase 1 — Class A: convert to entity widgets (DONE, no code)

In each shipped template's `dashboards.home`, swap the source from
`built-in` to `mode:'entity'`. Example — PIPELINE:

```jsonc
// before
{ "kind": "list", "title": "PIPELINE",
  "source": { "mode": "built-in", "builtIn": "home", "section": "pipeline" }, "limit": 5 }
// after
{ "kind": "list", "title": "PIPELINE",
  "source": { "mode": "entity", "entityKey": "deal",
              "filters": "stage != 'won' && stage != 'lost'",
              "sort": [{ "property": "deal_value", "direction": "DESC" }] },
  "limit": 5 }
```

Applied to PIPELINE, PARTNERS, RECENT ACTIVITY in `workspace-bob`,
`workspace-cadence`, `workspace-crm` (the templates that ship these sections).
These resolve through `listEntities` → `metadataCache` → scan cache. The
UPCOMING frontmatter half is deferred to Phase 2 because it merges with the
milestone (body) half and is cleaner to convert together.

## Phase 2 — Class B: materialize body-derived state into frontmatter

Principle: **parse the body once, when the note changes, and write the derived
numbers back onto that note's own frontmatter.** Reads then become
frontmatter-only.

### 2a. Project milestones -> project frontmatter
On project-note change, `parseH2Sections` + `parseMilestones` (existing in
`project-notes.ts`), then write namespaced derived fields:

```yaml
bob_milestones_total: 6
bob_milestones_done: 4
bob_milestones_pct: 67
bob_next_milestone: "2026-06-30 — Beta cutover"
bob_next_milestone_date: 2026-06-30
```

PROJECTS + UPCOMING-milestone widgets become `mode:'entity'` over `project`.

### 2b. Daily-note task tallies -> daily-note frontmatter
On daily-note change, parse `## Today` and write `bob_tasks_open`,
`bob_tasks_done`, `bob_journal_chars`. THIS WEEK / productivity then aggregate
these from `metadataCache` instead of 30 body reads.

### The materializer (`src/materialize.ts`, registered in `plugin.ts`)

- **Trigger:** debounced `vault.modify` / `metadataCache.changed`, gated to the
  daily-note folder and project folders.
- **Incremental:** only the changed note is re-parsed — off the render path.
- **Write:** via `processFrontMatter()` only.
- **Write-loop guard (critical):** `processFrontMatter` re-fires `changed`.
  **Compare-before-write** — if computed values equal current frontmatter,
  return without writing, so the second pass no-ops and the loop terminates.
- **Backfill:** a command "Rebuild Home metrics" walks daily/project notes once.
- **Namespacing:** all computed keys prefixed `bob_`; documented as derived.
  Plugin writes bypass the validation hook, so the materializer must emit
  schema-valid values itself.

## Phase 3 — productivity rewrite + briefing recompose

Replace `buildProductivitySnapshot`'s body reads with a frontmatter aggregation
over the daily-note folder. Recompose TOP OF THE DAY from the now-cheap sources
(`count`/`metric` over deal/project + `bob_tasks_open` + reminder count).

## Phase 4 — cleanup

Retire `builtIn:'home'` from `widgets.ts`/`snapshots.ts` (keep `productivity`/
`planner` builders if Reports/Planner still use them, or migrate those too).
Update CLAUDE.md/AGENTS.md.

## Class C — reminders stay runtime

INBOX and the overdue-reminder briefing line read `settings.reminders` (in-memory
array, no file I/O). Materializing buys nothing; keep a thin runtime widget.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Infinite write loop from `processFrontMatter` | Compare-before-write; bail when unchanged (mandatory) |
| Computed fields pollute user notes | `bob_` namespace; documented; backfill can strip |
| Stale metrics if a note changes without an event | Debounced listeners + "Rebuild Home metrics" command |
| Write storms during bulk edits/sync | Debounce + per-path coalescing; skip during own writes |

## Testing

- Unit: milestone/task parse -> expected `bob_*` values (`project-note.test.js`).
- Loop guard: `changed` after a write asserts no second write when unchanged.
- Config: Home template validates; new `mode:'entity'` widgets resolve
  (`widget-source.test.js`).
- Manual: large vault renders Home in one paint, no body reads (devtools).

## Effort

- Phase 1: ~30 min (done). Phase 2: ~half day. Phase 3: ~half day.
  Phase 4: ~1–2 hrs.
