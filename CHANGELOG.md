# Changelog

All notable changes to BOB Workspace are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions match `manifest.json`
(no `v` prefix). Min Obsidian version is 1.4.0 unless noted.

## [1.2.0] — 2026-08-20

### Added
- **Nav sections take an Expanded / Collapsed / Hidden setting** (Settings →
  Modules) in place of the on/off toggle. It composes the existing `modules`
  and `collapsedGroups` settings, so the pill and the sidebar's own group
  headers stay in sync rather than fighting over a separate "default".
- Every labelled nav group can now be hidden. Groups authored in a vault's
  `workspace.json` previously could not be — see Changed.

### Fixed
- **Bar charts saturated near the top of the scale.** A bar's percentage height
  resolved against the whole column, label and value rows included, so tall
  bars overflowed and were flex-shrunk into the leftover space. Values
  96/128/96 rendered 120px/123px/120px; they now render 96px/128px/96px.
  Affects every bar chart, not just the productivity report.
- **"Created per week" and "closed per week" drew identical bars.** The weeks
  row mapper never exposed the created/closed/net counts the snapshot already
  computed, and an unknown field silently fell back to the `done` tally. A card
  naming a field its section doesn't provide now resolves to 0 instead of
  quietly plotting a different series.
- **The content cadence heatmap was blank by construction.** It counted
  characters in each daily note's `## Journal` section, which is empty in any
  vault that doesn't write journal prose. The BOB template now charts
  marketing-content activity; the CRM template, which ships no bases, charts
  task flow.

### Changed
- **Group-level `module` removed from `navigation.groups`.** It never held
  anything but the group's own id, and groups authored later omitted it — which
  left them with no entry in `modules` and therefore no way to be hidden.
  Groups are keyed by id. A legacy `module` key is migrated onto the id at
  load, so a hidden group stays hidden; no action needed on existing vaults.
  **Item-level `module` is unchanged** and still names the module a surface's
  data depends on (`reports.pipeline` → `crm`).
- Entity `typeFilter` derives from the entity name; `type_value` is dropped
  from schema YAML.

## [1.0.0] — 2026-07-16

### Added
- Initial public release, submitted to the Obsidian community plugin store.

The `0.14.4-bob.*` entries below are the pre-release development history of
this fork (from the original Cadence plugin's `0.14.4` through the BOB
rebrand); `1.0.0` is the first version intended for general use.

## [0.14.4-bob.51] — 2026-07-15

### Changed
- **Internal identifiers rebranded Cadence → BOB.** `Cadence*` classes →
  `Bob*` (e.g. `CadencePlugin` → `BobPlugin`), `cad-`/`cadence-` CSS classes →
  `bob-`, `VIEW_TYPE_CADENCE_APP` → `VIEW_TYPE_BOB_APP`, and the settings key
  `cadenceAppDark` → `bobAppDark`. Purely internal; the view-type *value* was
  already `bob-workspace-app` (no orphaned views).
  - **Command IDs renamed** `open-cadence*`/`cadence-import-csv` → `open-bob*`/
    `bob-import-csv`. **Any hotkeys bound to those commands reset** and need
    re-binding.
  - The scoped dark-mode preference resets once (key rename), re-toggle if used.
  - **Deliberately kept** (compatibility/attribution, not internal naming): the
    legacy `Cadence/…` fallback paths, the **Cadence Classic** template, and the
    upstream **Cadence Planner** credit.

## [0.14.4-bob.50] — 2026-07-15

### Added
- **Inline canvases & Base views toggle** (Settings → App → **Rendering**,
  default **off**). Inline canvas hosting and inline Base views use Obsidian
  internal APIs; they are now gated behind an opt-in so the default experience
  relies only on documented APIs (canvases open in a tab, Base views show
  "Open Base"). Enable for the richer in-app rendering. Prep for community-store
  review.

## [0.14.4-bob.49] — 2026-07-15

### Added
- **Configurable canvas folder** — Settings → App → Data: **Canvas folder**
  (default `BOB Workspace/Canvases`, workspace-owned/portable) sets where
  generated canvases are written (was hardcoded).

### Changed
- The **Canvases library scan now honors `ignoredFolders`** (in addition to the
  template-path exclusion), matching entity scans.
- Docs: the canvas section flags the two unofficial-internals dependencies to
  re-test on Obsidian upgrades; the `_assets` note records the ~1.6 MB bundle
  size as an accepted self-seeding trade-off.

## [0.14.4-bob.48] — 2026-07-15

### Fixed
- **Canvas leaf lifecycle** (from a fresh code review of the new canvas code):
  - *(M1)* Navigating away while a full-page canvas is still loading no longer
    leaves a stray, still-running `CanvasView` — the mount now bails out and
    detaches the in-flight leaf if the open canvas changed during the async load.
  - *(M2)* Canvas teardown now explicitly unloads the view before detaching the
    ephemeral leaf (`detach()` on a never-attached leaf isn't guaranteed to run
    the view's `onunload`), and nulls its handle first so re-entrant teardowns
    are no-ops.
  - *(L2)* Generated context/agent-audit canvases seed node/edge ids with the
    quadrant + index, so two cards sharing a role/target/text can't collide
    (still deterministic across regenerations).

## [0.14.4-bob.47] — 2026-07-15

### Changed
- **Export/import de-duplicated.** The full export/import UI (group export,
  import templates, CSV/XLSX import with column mapping) now lives only on the
  **Export** and **Import** surfaces — the single canonical implementation.
  Settings → Data keeps just the portable **workbook export folder** setting and
  **Open Export / Open Import** buttons that jump to those screens. Removes a
  second, divergent copy that had drifted (different group picker, feedback, and
  behavior).

### Fixed
- The **Export screen honors the configured export folder** again — it read a
  never-assigned view field (`this.settings`) and silently fell back to the
  default folder; it now uses `this.plugin.settings`.

## [0.14.4-bob.46] — 2026-07-14

Cleanup / TODO-tail pass.

### Added
- **Navigation settings** — Settings → App → **Navigation** now has toggles for
  `showSecondaryNav` (show child surfaces in the rail) and `showSetupNav` (show
  setup-level surfaces). These settings were read but previously had no UI.

### Changed
- Built-in dashboard **snapshots always receive default-merged settings**
  (`DEFAULT_SETTINGS` + `WORKSPACE_CONFIG.settings` + caller) — the old dead
  `settings || WORKSPACE_CONFIG.settings` fallback could pass sparse settings.
- Collapsed `_renderSecondaryRoute`'s seven one-line dashboard wrappers (and the
  `renderProductivity` wrapper) into `renderConfigDashboard` via an
  `OVERVIEW_DASHBOARD_ROUTES` set — behavior-preserving.
- Settings nav description no longer references the removed "API connection".

### Tests
- New `tests/entity-files-filter.test.js` (`listEntityFiles` filter categories +
  `isTemplatePath`); `run-tests.js` fails loudly on unhandled rejection and prints
  success on `beforeExit` so async failures can't hide.

## [0.14.4-bob.45] — 2026-07-13

### Added
- **Manual-edit preservation for generated canvases.** Generated surfaces stay
  regenerate-fresh, but anything you add by hand now survives regeneration. Each
  canvas keeps a sidecar manifest of the ids BOB wrote (`bob_owned_node_ids`);
  on regeneration BOB nodes/edges are replaced while user-authored nodes are
  kept, and user edges whose endpoint disappeared are dropped so the file stays
  valid. All generators (Entity Context, Agent Audit, Process runway, Pipeline
  board) now write to a **stable path** and merge over the existing file instead
  of piling up new dated copies.

## [0.14.4-bob.44] — 2026-07-13

### Added
- **Agent Audit Canvas** — agent-run notes (the `ai-session-log` type, or any
  note with agent/session signals) render as an audit surface: the run at
  centre, **context & inputs** (date, bucket, primary agent, client) top,
  **agents & skills used** left, **outputs/deliverables produced** right (live
  `file` nodes linking to the actual deliverables), and **cost & exceptions**
  (minutes, tokens, $ cost, unattributed/no-deliverable flag) bottom. The
  existing **Context canvas** entry (entity detail button / active-note command)
  auto-routes to this surface for agent runs and to the Entity Context surface
  otherwise.

## [0.14.4-bob.43] — 2026-07-13

### Added
- **Process Execution Canvas** — any entity list whose type has a stage/status
  lifecycle gains a **Process canvas** action that renders a left-to-right
  *runway*: one lane (group) per stage with the records currently in it, flow
  edges between consecutive lanes, blockers flagged red, and a summary node
  (record/stage counts, blocked total). Turns a static list into a live
  operating surface; opens inline in the interactive host. Generalises across
  deals, tasks, audit findings, and any lifecycle entity.

## [0.14.4-bob.42] — 2026-07-13

Canvas as a **context-surface render target** (Entity Context Canvas, v1).

### Added
- **Entity Context Canvas** — from any entity (detail view → **Context canvas**)
  or any note (command **"BOB: Context canvas for active note"**), BOB generates
  a *context-explosion* canvas: the focal note at centre, its **evidence** (left),
  **people & systems** (top, incl. linked URLs as link nodes), **outputs**
  (right) and **risks / next actions** (bottom), drawn from links + backlinks and
  bucketed by entity type, with a generated summary node and labelled signal
  edges. Opens inline in the interactive host.
- **Canvas render foundations** (`src/canvas.ts`): a spec-compatible node taxonomy
  (entity=file · insight=text · external=link · zone=group · signal edge), the
  BOB semantic palette (red/orange/yellow/green/cyan/purple → JSON Canvas 1..6),
  **stable node IDs** (intent+source+role+target hashed → regeneration keeps edge
  refs), a deterministic context-explosion layout engine, and a **render manifest**
  sidecar (`<name>.canvas.bobmeta.json`: source, template, query hash, owned node
  ids) so the `.canvas` stays standard while BOB keeps render logic beside it.
  Regenerate-fresh for v1; manual-edit preservation, AI insight nodes, and the
  Process/Agent-audit templates build on these foundations next.

## [0.14.4-bob.41] — 2026-07-13

### Fixed
- **Hosted canvas no longer refreshes/flickers every 30s.** The reminder tick
  (and vault/metadata events) called `refreshOpenViews`, which re-rendered the
  BOB view and tore down + remounted the hosted CanvasView — a visible periodic
  refresh that also interrupted editing. Incidental refreshes now **skip a view
  that is hosting a canvas** (reminder tick in `refreshOpenViews`, plus the
  modify/create/delete/rename/metadata handlers); explicit navigation still
  re-renders it.

## [0.14.4-bob.40] — 2026-07-13

Canvas Phase 2 (start) — generate canvases from vault data.

### Added
- **Generate canvas** — the Canvases surface gains a **+ Generate** menu that
  writes a JSON Canvas from vault data and opens it inline in the interactive
  host. First generator: **Pipeline board** — deals grouped into columns by
  stage, each card a live `file` node linking to the deal note. New `src/canvas.ts`
  is a JSON Canvas writer (open MIT spec — structured file writes, no unstable
  API); the board layout is pure and unit-tested. Output lands in
  `BOB Workspace/Canvases/` with a unique name. More generators (project/
  value-chain maps) and an AI path follow.

## [0.14.4-bob.39] — 2026-07-12

### Changed
- **Full-page canvas now hosts Obsidian's real interactive CanvasView** instead of
  the static embed preview. The embed registry only yields a click-to-open
  preview (colored node boxes), so the surface now creates an ephemeral leaf,
  loads the canvas into it, and reparents its DOM into the BOB pane — giving a
  fully interactive, editable canvas in-shell. Uses guarded internals (the
  WorkspaceLeaf constructor); on any failure it falls back to the open-in-tab
  affordance. The hosted leaf is detached on every re-render, navigation, and
  view close so it never leaks.

## [0.14.4-bob.38] — 2026-07-12

### Fixed
- **Full-page canvas render no longer wipes a canvas that's still loading.** The
  inline mount polled a ~1s timeout and, on expiry, emptied the stage and showed
  the fallback — but a canvas loads its nodes/images asynchronously well past a
  second, so a canvas that was rendering fine got destroyed. The mount is now
  non-destructive: it gives the embed one frame and falls back only if it
  produced no DOM at all, otherwise it leaves the live (still-loading) canvas in
  place.

## [0.14.4-bob.37] — 2026-07-12

Canvas support, Phase 1 — reach and view Obsidian canvases inside BOB.

### Added
- **Canvas library** (`misc.canvases`) — a built-in surface listing every
  `.canvas` file in the vault (search + folder/modified metadata), with **Open**
  (full-page inside BOB) and **Open in tab** actions. Canvases were previously
  unreachable from BOB (the entity scanner is markdown-only and Bases can't
  index canvases); this makes every canvas — hand-made or generated —
  reachable. In the built-in nav and the shipped BOB template's misc group, plus
  a command **"Open BOB Workspace — Canvases"** (always reachable regardless of
  nav config).
- **Full-page canvas render** — opening a canvas mounts it live inside the BOB
  content pane via the embed registry (the same mechanism as live Base views),
  with a **Pop out to edit** action (native canvas leaf) and a graceful
  open-in-Obsidian fallback. Viewer-first by design; in-shell editing is out of
  Phase 1 scope. Canvas generation is a planned Phase 2.

## [0.14.4-bob.36] — 2026-07-11

### Fixed
- **XLSX export was truncated by the selected Base view.** Export built its
  rows from `listEntities()`, which AND-combines the currently-selected Base
  *view*'s filter — so a narrow display view silently cut the export (e.g. the
  skills base's "Free Ready" view reduced a 359-skill export to ~100). Exports
  now apply global/type/folder/filename membership but **ignore the view-level
  filter** (`ignoreViewFilter` threaded through `listEntityFiles`/
  `listEntities`). On-screen lists are unchanged — they still honour the
  selected view. Regression test added.

## [0.14.4-bob.35] — 2026-07-10

Makes the **BOB Workspace** template fully self-seeding: applying it to an
empty vault now yields the complete, fully-featured workspace with no manual
schema/Base step.

### Added
- **Template `_assets`** — `workspace-bob.json` now ships the canonical schema
  YAML for **every** entity it references (74 total, built-ins included) plus
  **every mapped `.base`** file. Previously it shipped none, so custom domains
  were undefined and Bases ungenerated on a fresh vault; built-ins fell back to
  the lean code defaults (41/45 are materially richer in the shipped schemas —
  e.g. `invoice` 27 fields vs code's 9, `lead` 38 vs 17). `contact` ships as
  `person.yaml` (`SCHEMA_TO_ENTITY_KEY: person → contact`).

### Changed
- **KPI scoreboard** — the `reports.kpi` dashboard adopts the improved "How
  this works" copy (AP-overdue / procure-to-pay, days-since-last-release, 31
  KPIs) and its base-view now uses the `KPI.base` **Scoreboard** view (RAG +
  latest value). `KPI.base` (formula-driven RAG/freshness) ships as an asset.
- Code `ENTITIES` is now purely a **fallback** for BOB — authoritative only for
  Minimal/CRM-only or when schemas are off — matching the product direction
  that canonical schema YAML is the source of truth. Vault schema/Base
  improvements must be re-promoted into the template's `_assets`.

### Docs
- `CLAUDE.md`/`AGENTS.md` document the full-`_assets` BOB template and the
  fallback role of code `ENTITIES`; the `bob-workspace-compose` skill gains a
  re-promotion maintenance note.

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

[0.14.4-bob.51]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.51
[0.14.4-bob.50]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.50
[0.14.4-bob.49]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.49
[0.14.4-bob.48]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.48
[0.14.4-bob.47]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.47
[0.14.4-bob.46]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.46
[0.14.4-bob.45]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.45
[0.14.4-bob.44]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.44
[0.14.4-bob.43]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.43
[0.14.4-bob.42]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.42
[0.14.4-bob.41]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.41
[0.14.4-bob.40]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.40
[0.14.4-bob.39]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.39
[0.14.4-bob.38]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.38
[0.14.4-bob.37]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.37
[0.14.4-bob.36]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.36
[0.14.4-bob.35]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.35
[0.14.4-bob.34]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.34
[0.14.4-bob.33]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.33
[0.14.4-bob.32]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.32
[0.14.4-bob.31]: https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.31
