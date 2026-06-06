---
title: Dashboard and Report Configurability Review
date: 2026-06-03
status: draft
tags:
  - bob-workspace
  - code-review
  - dashboards
  - reports
  - bases
---

# Dashboard and Report Configurability Review

## Context

BOB Workspace has moved from the initial mostly hardcoded upstream workspace toward a schema, Base, and `workspace.json` driven product. Entity lists, navigation, workbook groups, schemas, Base mappings, and several dashboards are already configurable. The remaining work is mostly about widening the widget catalog and closing the Base-driven composition gap:

- Home, CRM Pipeline, and the report surfaces now route through `workspace.json.dashboards`.
- The dashboard editor exposes a widget catalog and a built-in dashboard inventory.
- Base files influence entity lists and most dashboard widgets, but `home` and `reports.productivity` still use runtime snapshot helpers for some of their source data.
- The catalog now covers the important generic widgets; the remaining gap is mostly whether some runtime snapshot data should be materialized into notes/frontmatter before it is consumed by widgets.

This document is now both a review and a backlog for the remaining configurability gap.

Target direction: dashboards and reports should be fully configurable through widgets, using Obsidian Bases and Base-derived plugin functionality wherever possible. Developers or power users provide schema and Base definitions. Business users configure dashboard/report components against those definitions.

## Code Review Findings

### High Severity

1. Configured dashboards could not override key built-in surfaces.

   This has now been fixed for the migrated routes. `home`, `crm.dashboard`, `crm.pipeline`, and the `reports.*` surfaces are routed through `renderConfigDashboard()`.

   Source: `main.js` around `CadenceAppView.render()` and `renderHome()`.

2. Report and dashboard open counts are unreliable.

   `_isOpenEntity()` assumes a `status` field and a hardcoded closed-value blacklist. Entities using `approval_status`, `payment_status`, lifecycle-specific statuses, or Base filters are misclassified.

   Source: `main.js` `_isOpenEntity()`.

3. Home and reports still hardcode legacy fields.

   Home briefing and cards use field names such as `stage`, `closeBy`, `value`, `contact`, and `lastContact` directly. BOB schemas commonly use fields such as `expected_close`, `deal_value`, `contact_ref`, and `last_contact`.

   Source: `main.js` `renderHome()` and `_computeBriefing()`.

4. Reports use file modification time as business dates.

   Pipeline aging and sales revenue charts use `file.stat.mtime` as a proxy for stage age and close month. Editing a historical note changes reported business timing.

   Source: `main.js` report renderers.

5. Base filter support has correctness gaps.

   Current Base evaluation handles some string conditions plus `and` and `or`, but not object-form `not`. `parseBaseFile()` also flattens filters when deriving folders and `typeFilters`, which can overrestrict `or` filters.

   Source: `parseBaseFile()`, `evaluateBaseFilterNode()`, and related helpers.

### Medium Severity

6. `hasBaseValue()` treats valid non-string values as empty.

   Numbers, booleans, and Date objects return `null`, so Base `isEmpty()`, null comparisons, and empty sort handling can be wrong.

7. Dashboard config is under-validated.

   `validateWorkspaceConfig()` only checks that `dashboards` is an object. Malformed layouts, missing date fields, unknown widget shapes, and invalid stat configs are accepted and may fail at render time.

8. Dashboard widgets are not Base/view-scoped.

   `renderConfigDashboard()` calls `listEntities(entityKey)`, so widgets use the globally selected entity Base/view rather than an explicit widget source.

9. Private or experimental Bases integration should not be productized.

   Fixed: the unstable `_getBaseResults()` path was removed. Base-backed widgets now use the internal Base parser/preview path and expose Open Base for native Base detail.

10. Unsafe `innerHTML` remains.

    Fixed: export path rendering now uses DOM construction instead of raw `innerHTML`.

11. Starter templates do not ship dashboard/report configuration examples.

    Fixed: shipped templates now include dashboard/report compositions, including a minimal `home` dashboard for `workspace-minimal.json`.

## Configurability Gap Analysis

| Area | Current state | Gap to target |
| --- | --- | --- |
| Routing | Config dashboards own `home`, `crm.dashboard`, `crm.pipeline`, and `reports.*`. | Keep new dashboard/report surfaces in `workspace.json.dashboards`; do not add hardcoded compositions. |
| Widget model | Supports metric stats, card lists, merges, kanban, Base link widgets, Base embed previews, markdown/note widgets, actions widgets, selector widgets, and runtime-backed sections for surfaces that still derive data from app state. | Need richer report exports and more granular kanban controls. |
| Base usage | Entity lists partially parse `.base` files. Non-table views delegate to Open Base. | Widgets need explicit `{ base, view }` sources and should reuse Base filters, order, grouping, summaries, and view metadata where possible. |
| Reports | Pipeline, Sales, Partners, Activity, and Productivity are config-driven and report-typed; Productivity uses runtime-backed source data through generic widgets. | Materialize productivity rollups into notes/frontmatter only if those results need to become Base-queryable. |
| Home | Now config-driven, but still derives some sections from runtime helpers. | Materialize the underlying data into notes/frontmatter if you want those sections to become Base-backed. |
| Runtime snapshots | `home` and `reports.productivity` are config-driven, but their live data still comes from app/runtime helpers. | Materialize the underlying reminder/daily-note/productivity snapshots into notes or frontmatter when you want them to become Base-backed. |
| Dashboard UI state | Selector choices, date ranges, and similar small control values persist in `workspace.json.settings.dashboardState`. | Keep that state small and intentional; do not persist derived metrics or snapshot rows there. |
| Pipeline | Now config-driven through `kanban`, with configurable grouping, card fields, WIP limits and drag/drop stage changes. | Continue refining kanban only where users need more workflow behavior. |
| Designer | Visual editor now has a widget catalog and built-in dashboard inventory, but it still edits a narrow JSON shape. | Extend the editor to create more widget kinds and emit clearer JSON structures for Base-backed widgets. |
| Validation | Minimal dashboard validation. | Add schema-level validation and per-widget render errors so one bad widget does not break the full surface. |
| Templates | Templates carry the shipped dashboard/report compositions and runtime composition comes from the active `workspace.json`. | Keep every shipped template self-contained, including `workspace-minimal.json`. |

## Built-In Dashboard Inventory

The current built-ins are already close to a widget-catalog model. This is the
inventory we should aim to preserve or rebuild from config:

| Surface | Current composition | Catalog coverage | Notes |
| --- | --- | --- | --- |
| `home` | runtime-backed briefing/inbox/today/week/upcoming/partners/projects/pipeline/activity sections rendered through config | Runtime-backed | Works today, but still depends on app-state snapshots for some sections rather than a pure Base-backed catalog. |
| `crm.dashboard` | Metric stats + recent lead/contact/campaign/activity cards | Covered | This is now a clean example of the catalog-driven dashboard shape. |
| `client-work.dashboard` | Metric stats + recent/open card lists + conditional surveys/testimonials | Mostly covered | This is close to the existing generic catalog already. |
| `finance.gl.overview` | Metric stats + recent journal/reconciliation/statement cards + finance legend | Mostly covered | The legend is still a bespoke block, but the rest is catalog-friendly. |
| `finance.setup.overview` | Metric stats + a merged setup card | Covered | Merge cards are already a useful catalog primitive here. |
| `procurement.overview` | Metric stats + due/open supplier invoice/order cards + recent suppliers | Mostly covered | Good candidate for future Base-backed embed or view widgets. |
| `tax.dashboard` | Metric stats + due/open tax return cards + merged review cards | Mostly covered | Needs richer table/list widgets for deeper compliance views. |
| `prm.partners.overview` | Metric stats + due/open certification/registration/commission cards | Mostly covered | Another good candidate for a table/list widget later. |
| `crm.campaigns.overview` | Metric stats + recent campaign/sequence/lead cards | Covered | This should be easy to rebuild from metric + list cards. |
| `crm.pipeline` | Metric stats + kanban widget | Covered | Further kanban improvements are incremental workflow controls, not a configurability blocker. |
| `reports.pipeline` | Metric stats + open pipeline and aging cards | Covered | Report layout is already close to generic dashboard composition. |
| `reports.sales` | Metric stats + winning-deal and owner leaderboard cards | Covered | Mostly list and metric primitives. |
| `reports.partners` | Metric stats + partner deal and certification cards | Covered | Mostly list and metric primitives. |
| `reports.activity` | Metric stats + recent activity cards | Covered | This is the simplest report surface. |

The rule of thumb is now clear: if a surface is not covered by metric,
list/card-list, merge, bar-chart, kanban, markdown, actions, selector,
date-range, or Base-backed widgets, add a widget primitive rather than a
hardcoded dashboard.

## Implementation Plan

### Phase 1 - Correctness Blockers

- [x] Make `WORKSPACE_CONFIG.dashboards[this.mode]` or a new surface config block take precedence over hardcoded route handlers.
- [x] Replace unsafe `innerHTML` rendering in export UI with DOM construction.
- [x] Fix `hasBaseValue()` for numbers, booleans, Date objects, arrays, and strings.
- [x] Replace `_isOpenEntity()` with configurable lifecycle logic:
  - [x] Use entity `terminalStatuses` when present.
  - [x] Use schema `status_lifecycle` and status field hints when available.
  - [x] Support entity-specific status fields such as `approval_status`, `payment_status`, and `match_status`.
  - [x] Allow widgets to define their own open/closed filters.
- [x] Replace hardcoded Home deal fields with existing deal accessors and schema-aware aliases.
- [x] Replace report `mtime` business logic with configured date fields.

### Phase 2 - Base Source Abstraction

- [x] Add `resolveWidgetSource(config, context)` for widget data loading.
- [x] Support source modes:
  - [x] `entity` using `entityKey`.
  - [x] `base` using `{ file, view }`.
  - [x] `built-in` for internal sources such as reminders, daily notes, TaskNotes, and productivity.
- [x] Return rows, metadata, source warnings, unsupported filters, and display fields from the resolver.
- [x] Make widget configs choose their own Base/view rather than relying on global `settings.baseViews`.
- [x] Add cache invalidation on metadata changes and workspace reloads.

### Phase 3 - Base Parser and Evaluator Hardening

- [x] Support object-form `not` filters.
- [x] Preserve `and` and `or` semantics when deriving folders and type filters.
- [x] Support Base `limit`.
- [x] Support sort and groupBy consistently for widgets and entity lists.
- [x] Detect formula and summary dependencies and surface unsupported behavior clearly.
- [x] Add warnings for filters or formulas BOB cannot safely evaluate.
- [x] Remove or quarantine `_getBaseResults()` until a stable Bases API path exists.

### Phase 4 - Generic Widget Renderer

- [x] Introduce a typed widget schema.
- [x] Implement `metric` widgets with count, sum, average, min, max, unique, filled, empty, and ratio.
- [x] Implement `list` widgets.
- [x] Implement `bar-chart` widgets for grouped counts and sums.
- [x] Implement `kanban` widgets using groupBy.
- [x] Implement `base-link` widgets with Open Base and optional view target.
- [x] Implement `base-embed` preview widgets for compact Base-backed result sets.
- [x] Implement `markdown` or `note` widgets for static guidance/report commentary.
- [x] Implement `actions` widgets for configured commands and create-record buttons.
- [x] Implement `selector` widgets for placeholder-driven report filters.
- [x] Add per-widget error cards so one invalid widget does not break the full dashboard.

### Phase 5 - Reports as Config

- [x] Define `kind: "report"` or equivalent surface metadata.
- [x] Add report-level controls:
  - [x] Date range.
  - [x] Grouping.
  - [x] Entity/Base/view source.
  - [x] Export current report as a markdown summary.
  - [x] Context variables.
- [x] Recreate Pipeline report as config.
- [x] Recreate Sales report as config.
- [x] Recreate Partners report as config.
- [x] Recreate Activity report as config.
- [x] Wrap Productivity report as generic widgets over runtime-backed source data.
- [x] Remove old hardcoded report renderers.

### Phase 6 - Home, CRM Dashboard, and Pipeline Migration

- [x] Convert Home to a configurable dashboard surface.
- [x] Convert CRM Dashboard to a configurable dashboard surface.
- [x] Convert Pipeline to a configurable kanban or Base-delegated surface.
- [x] Move current default compositions out of code and into starter template `dashboards`.
- [x] Require dashboard/report compositions to live in `workspace.json.dashboards`.
- [x] Ensure configured header actions suppress hardcoded buttons.

### Phase 7 - Designer Upgrade

- [x] Rename or expand Dashboard Editor into a Surface Designer.
- [x] Allow creating dashboards and reports for any route.
- [x] Allow selecting widget type.
- [x] Allow selecting entity, Base file, and Base view.
- [x] Allow choosing fields from schema/Base metadata.
- [x] Allow configuring aggregations, groupBy, sort, limit, and filters.
- [x] Allow configuring context filters such as selected client/project.
- [x] Add pre-save validation with actionable errors.
- [x] Keep raw JSON mode for developers.

### Phase 8 - Templates and Documentation

- [x] Add dashboard/report configs to `templates/workspace-bob.json`.
- [x] Add dashboard/report configs to `templates/workspace-crm.json`.
- [x] Add dashboard/report configs to `templates/workspace-cadence.json`.
- [x] Update `docs/extending-bob-workspace.md` to explain configurable dashboards/reports.
- [x] Update `README.md` so it no longer describes reports as hardcoded.
- [x] Update `CLAUDE.md` if architecture changes materially.

### Phase 9 - Regression Tests

- [x] Add lightweight Node tests for Base filter evaluation.
- [x] Add tests for route override precedence.
- [x] Add tests for dashboard validation.
- [x] Add tests for open/terminal status logic.
- [x] Add tests for widget source resolution.
- [x] Add tests for strict workspace config behavior.
- [x] Keep `node --check main.js` as a baseline validation step.

## Proposed Config Shape

This is a working target shape, not a final API commitment.

```json
{
  "surfaces": {
    "reports.pipeline": {
      "kind": "report",
      "title": "Pipeline report",
      "subtitle": "Coverage, forecast and aging",
      "controls": [
        { "type": "dateRange", "key": "period", "default": "quarter" }
      ],
      "widgets": [
        {
          "type": "metric",
          "title": "Open pipeline",
          "source": { "entityKey": "deal", "base": "00-CORE/Bases/Pipeline.base", "view": "Open" },
          "aggregate": { "op": "sum", "field": "deal_value" },
          "format": "currency"
        },
        {
          "type": "kanban",
          "title": "Pipeline by stage",
          "source": { "entityKey": "deal", "base": "00-CORE/Bases/Pipeline.base", "view": "Open" },
          "groupBy": "stage",
          "cardTitleFields": ["deal_name", "title", "file.basename"],
          "cardMetaFields": ["client_id", "deal_value", "expected_close"]
        }
      ]
    }
  }
}
```

## Decision Points

- [x] Decide whether dashboards remain under `dashboards` or move to a more general `surfaces` block.
  - Decision: keep `dashboards` for now.
- [x] Decide whether Base-backed widgets should evaluate Base files internally, embed native Base views, or support both.
  - Decision: support both, with internal evaluation as the default dashboard/report path and native Base views as the deep-detail path.
- [x] Decide the minimum supported Obsidian version for advanced Base view integration.
  - Decision: `1.13.x`
- [x] Decide which existing hardcoded widgets stay as runtime-backed helpers versus pure config.
  - Policy: keep runtime-backed helpers only where the underlying data is not practical to model directly in notes or Bases.
- [x] Decide how much additional report export should be built into BOB versus delegated to Bases CSV/export behavior.
  - Decision: keep XLSX export as-is, add print/PDF for dashboards and reports, and avoid adding a separate report-export format unless it is clearly needed later.

## Future Base-First Design

If you want to reduce the remaining runtime snapshot plumbing further, the
design should look like this:

1. Materialize live state into notes or frontmatter.
   - Reminders become note records or daily-note sections.
   - Productivity rollups become generated daily/weekly notes or frontmatter summaries.
   - Home widgets then read those artifacts through Bases instead of reading app state directly.
2. Keep the config surface unchanged.
   - `workspace.json.dashboards` still defines the layout.
   - The only difference is that `source.base` points at materialized notes rather than at a runtime helper.
3. Use runtime helpers only as a short-term fallback.
   - If the materialized notes are missing, fall back to the helper.
   - Once the materialized path is stable, the helper can be reduced or removed.
