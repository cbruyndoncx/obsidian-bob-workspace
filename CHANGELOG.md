# Changelog

All notable changes to BOB Workspace are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions match `manifest.json`
(no `v` prefix). Min Obsidian version is 1.4.0 unless noted.

## [0.14.4-bob.34] — 2026-07-09

The shipped **BOB Workspace** template gains the vault's full extended layout,
and the documentation is reconciled with what actually ships.

### Added
- **BOB template** now ships the complete domain set — **Marketing**,
  **HR & People** (Recruiting, Payroll), **Research & Knowledge**, and
  **Operational Audit**, plus **Products**, **Ideas**, **Assets & Close**,
  **KPI Scoreboard**, and **Base Links** — promoted from the reference vault:
  14 nav groups, 14 secondary-tab parents, 30 Base mappings, 22 dashboards. The
  extra domains are schema-backed (nav/tabs/bases + `_assets` schemas), durable
  across a template re-apply.

### Changed
- **Operational Audit is tabs-only** — the `audit.overview` parent renders its
  tab bar (Overview / Findings / Processes / Hidden Costs / Initiatives /
  Issues); the dashboard moved to `audit.dashboard`, which the Overview tab
  routes to (mirrors `client-work.overview`).

### Docs
- Reconciled `CLAUDE.md`/`AGENTS.md` (surfaces, rich-groups, and the corrected
  live-inline Base-view behavior), the empty-vault and existing-vault guides,
  and stamped `docs/base-view-widget-spec.md` as implemented with its as-built
  note.

## [0.14.4-bob.33] — 2026-07-09

### Fixed
- **Home widgets no longer crash** ("Cannot read properties of undefined
  (reading 'fields')"). List widgets that carry their entity in the source
  (`source: { mode: 'entity', entityKey: 'deal' }`) now resolve that key instead
  of the card's absent top-level `entity`; row builders also guard the entity
  def, so an unknown entity degrades gracefully instead of throwing.

## [0.14.4-bob.32] — 2026-07-09

Base-view widgets, the Surface Designer base/view picker, and the BOB template.

### Added
- **Surface Designer**: the widget "View" field is now a dropdown of the
  selected Base's actual views, each labelled with its type and rendering
  ("Board — board · live embed" / "Pipeline — table · editable table"); changing
  the Base repopulates it.
- Base/view pickers label each option by how it renders (editable table vs live
  read-only embed).
- **BOB template** ships the **Operational Audit** and **KPI Scoreboard** screens
  (nav + dashboards, base-view-backed) so they're durable across a template
  re-apply.

### Changed
- **Non-table Base views render inline** on entity surfaces (board/calendar/cards
  embed live via `![[file#view]]`) instead of showing an "Open Base" placeholder;
  table views keep the plugin's editable inline table.
- **Base widgets accept both config shapes** (`base:{file,view}` and
  `source:{base:{…}}`) through one resolver — no separate/duplicate path.

### Fixed
- **base-view now applies the configured view.** It renders via the embed
  registry with the view in the `#View` subpath (the static markdown renderer
  can't load a Base embed, and a bare view name without `#` fell back to the
  default view). Also stopped a false "did not render" fallback by waiting for
  the embed wrapper rather than racing its async row-load.

### Removed
- Dropped the duplicate/placeholder `table` (never implemented) and `card-list`
  (a `list` duplicate) widget-catalog entries; re-scoped `base-embed` to
  "implemented".

## [0.14.4-bob.31] — 2026-07-05

A large pass over the config-driven ("no-code GUI") layer: fixes the critical
bugs left by the hardcoded→configurable migration, removes the dead code and
stale docs it left behind, then adds an interactive-widget system, a no-code
Today, an on-screen help layer, and onboarding docs.

### Added
- **Interactive widgets** that write back to notes: `task-list` (toggle a task's
  status / a daily-note checkbox; source = built-in section, task entity, or
  Base + view), `quick-add` (append a task to today's note), `note-section`
  (edit a daily-note heading, e.g. the journal), and `date-hero`.
- **No-code Today** — the built-in `planner.today` default is now a full
  interactive dashboard (date-hero + interactive task-list + quick-add + journal)
  seeded by **Customize**; the zero-config fallback remains the diary pane.
- **Surface Designer** improvements: a **Base picker** on the widget editor
  (point any widget at a `.base` + view), and per-kind field gating so an editor
  shows only the fields that widget uses.
- **Help layer** — collapsible, colored help panels across the Surface Designer
  and all 11 settings tabs, plus a guide for each of the 19 widget kinds and
  hover tooltips on every editor field. All help text lives in one module
  (`src/help-content.ts`) as a translation seam.
- **Modules tab** now lists secondary-tab entities (with Base config), shows a
  built-in/custom dashboard chip, and deep-links to the Surface Designer.
- **Docs**: `docs/empty-vault-quickstart.md` (new-vault happy path) and
  `docs/installing-into-existing-vault.md` (authoritative install sequence for a
  vault with existing notes), plus `docs/vault-skill-corrections.md`.
- Command: **Open BOB Workspace — Surface Designer** (the designer had no entry
  point once a workspace nav was active).
- Regression test running every bundled template through the real
  `validateWorkspaceConfig` + planner migration.

### Fixed
- **Planner dashboards were dead config** — nested `dashboards.planner` is now
  migrated to the top-level `planner` block on load, so shipped templates and
  existing vaults render their configured planner surfaces.
- **"Cadence Classic" template couldn't be applied** (rejected `entities` block);
  the setup-modal apply is now guarded with a Notice instead of a silent failure.
- **Unparseable `workspace.json` was destroyed** by the next incidental save — a
  load-failed guard now preserves the file (and its backup).
- **Manual `workspace.json.settings` edits were reverted** — reload/save-and-apply
  now re-overlay workspace-owned settings before rebuilding registries.
- **Base files outside `basesFolder` silently failed** (e.g.
  `20-COMPANY/skills.base`) — a directory-bearing path is now honored verbatim; a
  bare filename composes with `basesFolder`; the runtime override merge uses the
  same resolution.
- Broken Settings "Workspace tab" link; orphaned column-filter dropdown on
  re-render/close; help panels wiped on the Review and Widgets tabs.

### Changed
- **`workspace.json` wins over the hardcoded route map** — configured surfaces,
  entity keys and first tabs are honored where present.
- `planner.today` honors a configured dashboard (falls back to the diary pane).
- **Template switching** resets workspace-owned settings to a clean slate before
  applying the new template (outgoing settings are archived).
- Abandoning an unsaved Surface Designer draft restores config from disk.
- Incidental saves no longer churn `workspace.backup.json` (kept to deliberate
  structural edits).

### Removed
- Dead code: unused exports, ~340 lines of legacy `app-view.ts` renderers, the
  unreachable `applyEntityDefinitions` nav-injection branch, legacy Cadence route
  ids, the `dailyNoteFormat` setting, the dead `srm`/`tax` module toggles, and
  ~37 dead CSS classes.
- Corrected CLAUDE.md/AGENTS.md drift and deprecation-stamped stale generated
  docs.

[0.14.4-bob.34]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.34
[0.14.4-bob.33]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.33
[0.14.4-bob.32]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.32
[0.14.4-bob.31]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.31
