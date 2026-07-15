# Widget Catalog

Every dashboard `layout` cell is a **widget** (or a list of stacked widgets). The widget's `kind` selects the renderer. When `kind` is absent, the renderer treats it as the default **record-list** widget. All examples below are verbatim from the live config or the plugin templates — copy and adapt them; do not invent new field names.

`layout` is a 2D array: outer = rows, inner = columns. A cell is one widget object, or an array of widget objects stacked vertically in that column.

---

## Default record-list (no `kind`)

The workhorse. Lists records of one entity, recency-sorted. First non-empty field in `titleFields` becomes the row title; `metaFields` render as a compact line beneath.

```json
{
  "title": "ACTIVE CAMPAIGNS",
  "empty": "No active campaigns.",
  "entity": "campaign",
  "source": "recent-open",
  "titleFields": ["campaign_name", "title"],
  "metaFields": ["status", "campaign_type", "launch_date"]
}
```

- `entity` — the `type_value` of the record type (must match a YAML schema source / fileClass).
- `source` — see [source forms](#source-forms) below.
- `merge` — alternative to `entity`: an array of sub-source objects rendered as one combined list (e.g. show `deferred-tax` + `free-zone-status` records under one "TAX REVIEWS" widget). Each merge entry has its own `entity`/`source`/`titleFields`/`metaFields`.
- `dateFields`, `limit` — optional row-count cap and date columns.

## `kind: list`

Reads from a built-in computed surface rather than an entity table.

```json
{ "kind": "list", "title": "TOP OF THE DAY",
  "source": { "mode": "built-in", "builtIn": "home", "section": "briefing" },
  "limit": 4 }
```

## `kind: actions`

A row of quick-create / quick-action buttons.

```json
{ "kind": "actions", "actions": [
  { "label": "Quick capture", "action": "quick-capture", "icon": "plus-circle" },
  { "label": "New Deal", "entityKey": "deal", "icon": "trending-up" }
] }
```

- Each action uses either `action` (a built-in command id) **or** `entityKey` (open the new-record form for that entity). `icon` is a Lucide icon name.

## `kind: base-link`

A card that opens the entity's configured Obsidian Base view in a tab.

```json
{ "kind": "base-link", "title": "Deal Base", "entity": "deal",
  "description": "Opens the configured Base view for deals." }
```

## `kind: base-embed`

Renders a card for a Base view (header + record preview + Open Base). `view` is a **top-level string**; the `.base` file path is resolved from the `bases{}` map for the widget's `entity`.

```json
{ "kind": "base-embed", "entity": "deal", "view": "Pipeline",
  "limit": 5, "titleFields": ["title", "deal_name"],
  "metaFields": ["stage", "value", "closeBy"] }
```

⚠️ **Do NOT write `"base": { "view": "Pipeline" }`.** The resolver computes the path as `baseDef.file || baseDef.base || card.base || mappedBase`. An object in `base` with no `file` key is **stringified to `"[object Object]"`** and used as the path → garbled widget text and "base not found". Either pass `view` as a string (path comes from `bases{}[entity]`), or pass the full object `"base": { "file": "…/X.base", "view": "Pipeline" }`. The widget's `entity` MUST also have an entry in the top-level `bases{}` map (see workspace_schema.md §5), or the path is empty.

## `kind: base-view`

Embeds the **live, fully-rendered Obsidian Base view** (the real table/board/cards UI) inside the card via an `![[file#view]]` embed. Configurable `height`; falls back to a `base-embed`-style list if the base file is missing or the Bases API is unavailable.

```json
{ "kind": "base-view", "title": "Pipeline",
  "base": { "file": "00-CORE/Bases/Pipeline.base", "view": "Board" },
  "height": 420, "fallback": "link" }
```

### Which base widget? (decision guide)

All three point at a `.base` file, but differ in what they render:

| Kind | Renders | Reads data? | Use when |
|------|---------|-------------|----------|
| `base-link` | Title + **Open Base button** + file path. A pointer. | No | You want a jump-off shortcut to open the full Base; never looks empty; cheapest. |
| `base-embed` | A **compact list** (top N rows, plugin's own list UI, base-filter-aware). | Yes (list projection) | You want a lightweight read-only preview that matches your other list widgets; you don't need the Base's own columns/board. |
| `base-view` | The **actual Obsidian Base view** (real table/board/calendar), embedded live. | Yes (the real Base UI) | The Base's own view *is* the point — a proper table or board on the dashboard. Heaviest; needs the base file + Bases API (else it falls back to a list). |

**Rule of thumb:** *link* = a door to the base · *embed* = a lightweight peek · *view* = the base itself, live.

## `kind: markdown`

Static prose / instructions. `body` is Markdown.

```json
{ "kind": "markdown", "title": "Today at a glance",
  "body": "## Focus\n- Review planner items before opening new work." }
```

## `kind: selector`

A dropdown filter control bound to an entity field. Its `key` is referenced by `{{key}}` placeholders in sibling widgets' `source.filters`.

```json
{ "kind": "selector", "key": "stage", "label": "Stage",
  "entity": "deal", "field": "stage", "allLabel": "All stages" }
```

## `kind: kanban`

Board grouped by a field, fed by a filtered source. `{{stageFilter}}`-style tokens are substituted from sibling `selector` widgets.

```json
{ "kind": "kanban", "entity": "deal",
  "source": { "source": "recent-open",
              "filters": "stage != \"Won\" && stage != \"Lost\" && {{stageFilter}}" },
  "groupBy": "stage" }
```

## `kind: bar-chart`

A small bar chart over a built-in time-series surface.

```json
{ "kind": "bar-chart", "title": "TASK FLOW — LAST 14 DAYS",
  "source": { "mode": "built-in", "builtIn": "productivity", "section": "per-day" },
  "field": "done", "limit": 14 }
```

## `kind: metric`

A single big number (count or aggregate) as a layout widget — the stat-card idea placed inside the grid.

```json
{ "kind": "metric", "title": "OPEN DEALS", "entity": "deal", "metric": "count", "field": "stage", "accent": "sky" }
```

## `kind: gauge` / `kind: progress`

A dial (`gauge`) or horizontal bar (`progress`) showing a value against a `max`.

```json
{ "kind": "gauge", "title": "SCORE", "field": "completion",
  "source": { "mode": "built-in", "builtIn": "productivity" }, "max": 100, "suffix": "%" }
{ "kind": "progress", "title": "DAYS ACTIVE", "field": "activeDays",
  "source": { "mode": "built-in", "builtIn": "productivity" }, "max": 30, "suffix": "/30" }
```

## `kind: heatmap`

A calendar grid coloured by per-day activity.

```json
{ "kind": "heatmap", "title": "CADENCE", "dateField": "date",
  "source": { "mode": "built-in", "builtIn": "productivity", "section": "per-day" },
  "field": "journal", "days": 35, "columns": 7 }
```

## `kind: date-range`

A date-range picker that filters the other widgets on the dashboard (a control, like `selector`). Needs a `key`.

```json
{ "kind": "date-range", "key": "range", "label": "Period", "default": "this-month" }
```

## `kind: merge`

One list combining rows from several sources (each entry is its own source spec).

```json
{ "kind": "merge", "title": "ALL TASKS", "empty": "Nothing due.",
  "merge": [ { "entity": "task", "source": "due-open" },
             { "mode": "built-in", "builtIn": "planner", "section": "today" } ] }
```

---

## Interactive widgets (write back to notes)

NOT read-only — added in plugin `0.14.4-bob.31`. Use these to build a no-code, interactive Today / Planner surface. Their fields are gated by kind in the Surface Designer.

### `kind: task-list`

A checklist whose checkboxes toggle a task and write it back. The `source` chooses where tasks come from — a built-in daily section, a task entity, or a Base + view:

```json
{ "kind": "task-list", "title": "TODAY TASKS", "limit": 12, "empty": "No tasks.",
  "source": { "mode": "built-in", "builtIn": "planner", "section": "today" } }
{ "kind": "task-list", "title": "MY TASKS", "entity": "task",
  "source": { "base": { "file": "00-CORE/Bases/Tasks.base", "view": "Today" } } }
```

Built-in-`today` rows toggle the daily-note checkbox; entity/Base rows toggle the TaskNote's `status` frontmatter.

### `kind: quick-add`

A text box that appends a checkbox task to today's daily note on Enter. No data source.

```json
{ "kind": "quick-add", "title": "ADD TASK", "placeholder": "Add a task and press Enter…" }
```

### `kind: date-hero`

A read-only header showing today's weekday / day / month / year. No data source.

```json
{ "kind": "date-hero", "eyebrow": "TODAY" }
```

### `kind: note-section`

An editable text area bound to a heading in today's daily note (default: the journal heading); saves on blur.

```json
{ "kind": "note-section", "title": "TODAY’S ENTRY", "section": "## Journal" }
```

---

## Stat cards (`dashboard.stats[]`)

The top-row number tiles above the layout grid. NOT widgets — they live in the dashboard's `stats` array, not `layout`.

```json
{ "label": "ACTIVE CAMPAIGNS", "entity": "campaign", "count": "open",
  "sub": { "entity": "campaign", "count": "all", "suffix": "total" },
  "accent": "sky" }
```

- `count` — `open` / `all` / a status value, OR use `metric`+`field`+`source` for a computed metric.
- `accent` — colour hint (observed: `sky`, `mint`, `warn`, `pink`). Open vocabulary — not validated.
- `sub` — optional sub-count line (string or its own count object).

---

## Source forms

`source` (on a widget or stat card) is **either a string or an object**.

⚠️ **A record-list widget's `source` string is NOT open vocabulary — it is a closed switch.** The list renderer matches exactly these strings and **returns an empty list for anything else** (the widget silently shows its `empty` text even when records exist):

| List-widget `source` | Renders |
|------|---------|
| `"recent"` | all records of the entity, recency-sorted ← **the default "show everything" value** |
| `"recent-open"` | only non-closed records, recency-sorted |
| `"due"` | date-driven, all records |
| `"due-open"` | date-driven, non-closed records |
| `"base"` / `"table"` / `"list"` / `"entity"` | all records (recency-sorted, base-aware) |
| `{ "mode": "built-in", "builtIn": "home", "section": "briefing" }` | computed plugin surface (use with `kind: list`) |
| `{ "source": "recent-open", "filters": "stage != \"Won\" && {{stageFilter}}" }` | entity query + filter expression + selector tokens |

**`"all"`, `"recent-all"`, `"due-soon"`, `"overdue"` are NOT handled by list widgets → they render empty.** In particular **`"all"` is a STAT-CARD value only** (`stats[].count`), not a list source — using it on a list widget is the single most common way to get a dashboard of empty panels. For "show all records of this entity" on a list widget, use **`"recent"`**.

The validator's `KNOWN_SOURCE_STRINGS` warns-only (open vocabulary) because the *stat-card* and *object* forms accept more — but for a **record-list widget**, treat the table above as authoritative and default to `recent` / `recent-open`.

---

## Create affordance — a dashboard of only list widgets cannot add data

List/base widgets are read-only. If a dashboard surfaces entities but has no `kind: actions` widget, the user has **no way to create records from it** — a common "everything's empty and I can't add anything" failure. Always either:

- add a `kind: actions` widget with `quick-capture` + per-entity `{ "entityKey": "<e>" }` buttons (see [`kind: actions`](#kind-actions)), **or**
- route the user to the entity through an `entityKey` nav item / `secondaryTabs` tab — those entity-list surfaces carry their own built-in `+ New <entity>` button (see [workspace_schema.md → Navigation render model](workspace_schema.md)).
