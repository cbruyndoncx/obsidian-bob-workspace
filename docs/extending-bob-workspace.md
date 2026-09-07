# Extending BOB Workspace Without Code Changes

BOB Workspace is still structurally based on the original Cadence plugin, but the goal is not to make every vault adopt the upstream field names. The plugin should act as a workspace shell over markdown entities, while each vault defines its own data model through canonical schemas and Bases.

This guide explains the intended extension model.

## Design Principle

The plugin has several layers. Later layers should refine or override earlier layers:

1. **Built-in fallback model**
   - Defined in `src/entities.ts` and bundled into generated `main.js`.
   - Keeps the plugin usable in an empty vault.
   - Should stay small and generic.
   - May still contain some legacy field names for older saved workspace shapes.

2. **Schema layer**
   - YAML files in `00-CORE/Schemas/source/`.
   - Canonical source for BOB Workspace entity definitions when schema support is enabled.
   - Defines entity identity, location, field keys, types, enums, required flags,
     create defaults, and lifecycles.
   - Edited visually from Settings -> BOB Workspace -> Schemas -> Data model designer.

3. **Base layer**
   - `.base` files anywhere in the vault; bare filenames resolve under `settings.basesFolder` (default `00-CORE/Bases`).
   - Defines view behavior: visible columns, filters, sort, groupBy, and special Base views.
   - The workspace should reuse these views where practical instead of duplicating view logic.

4. **Workspace definition layer**
   - `workspace.json` in the plugin folder next to `data.json`.
   - Owns schema enablement, Base/view associations, navigation groups,
     dashboard compositions, secondary tabs, and workbook export groups.
   - Managed from Settings -> BOB Workspace -> Workspace definition, or
     reloaded with the `Reload workspace.json` command.

5. **Import alias layer**
   - Maps spreadsheet/frontmatter aliases to canonical field keys.
   - Useful when importing from older Cadence exports, another CRM, or another vault.
   - Defined per schema as `field_aliases` and edited in the Data model designer.
   - Older built-in synonyms remain only for shape normalization.

The most important rule: **the vault data model should live in the vault, not in plugin code.**

## Workspace Definition

`workspace.json` is the no-code composition layer. When `navigation.groups`
is present, it replaces the built-in left-navigation definition. Its
`secondaryTabs` object replaces built-in inner tab definitions, its
`workbookGroups` array replaces export group choices, and its `dashboards`
object replaces hardcoded dashboard/report compositions when the route id
matches.

When `schemas.enabled` is true and the configured source folder is empty,
BOB Workspace can bootstrap canonical schema YAML from the current workspace
entity definitions before applying schemas. The derived FileClasses and JSON
Schema outputs are then written from that source folder.

Entity-backed configured surfaces use the generic record table/detail UI.
Dashboard and report routes such as `home`, `crm.pipeline`, and
`crm.dashboard`, and `reports.*` render from `workspace.json.dashboards`.
If a dashboard route has no matching dashboard definition, there is no
hardcoded dashboard composition to fill it.

Dashboard widget coverage currently includes metrics, lists, card lists,
score gauges, progress bars, streak heatmaps, bar charts, kanban, merged
cards, markdown, actions, `base-link`, `base-embed`, selector controls,
and date-range controls. Runtime-backed
sources such as `home` and `productivity` can feed those generic widgets, but
they are data sources rather than separate dashboard compositions. Selector
widgets expose both `{{key}}` and `{{key}}Filter` placeholders so downstream
widgets can use either the raw choice or a ready-to-apply filter expression.
The dashboard editor exposes explicit source details for widgets, including
entity key, Base file, Base view, filters, sort, groupBy, and limit. Base
views themselves remain the canonical tabular layer, so a separate dashboard
table widget is not required for the current direction.

Dashboard UI state that should survive restart, such as selector choices and
date-range selections, is persisted under `workspace.json.settings.dashboardState`.
That covers user intent only. Computed dashboard rows, metrics, and runtime
snapshots remain transient and are recomputed when the surface renders.

One nuance matters for the current implementation: `home` and
`reports.productivity` are still backed by runtime snapshot helpers under the
hood. They are rendered from config, but the underlying data still comes from
live vault state such as reminders, daily notes, TaskNotes, and project
metadata rather than directly from a `.base` file.

If you want to push that last slice closer to pure Base-backed data, the
design would be:

- Materialize the runtime snapshot into notes or frontmatter fields on a
  schedule or in response to edits.
- Point the widget source at those notes through `base`/`view` instead of the
  runtime snapshot helper.
- Remove the runtime helper once the materialized data is stable.

Minimal example:

```json
{
  "schemas": {
    "enabled": true,
    "folder": "00-CORE/Schemas/source"
  },
  "bases": {
    "order": {
      "file": "00-CORE/Bases/Orders.base",
      "view": "Active Orders"
    }
  },
  "navigation": {
    "groups": [
      {
        "id": "operations",
        "label": "Operations",
        "icon": "blocks",
        "module": "operations",
        "items": [
          { "id": "operations.orders", "label": "Orders", "icon": "package", "module": "operations", "entityKey": "order" }
        ]
      }
    ],
    "secondaryTabs": {},
    "actions": {
      "home": [
        { "entityKey": "order", "label": "+ Order", "primary": true }
      ]
    }
  },
  "workbookGroups": [
    { "id": "operations", "label": "Operations", "entityKeys": ["order"] }
  ],
  "dashboards": {
    "home": {
      "title": "Home",
      "layout": [
        [
          { "kind": "briefing" }
        ]
      ]
    }
  }
}
```

Use `bases.<entity>.file` and optional `view` to make each Base selection part
of the portable workspace definition. The surface Base selectors write this
mapping directly, and **Import Bases from settings** migrates older choices.

Navigation icons are presentation configuration and therefore live in
`workspace.json`, except an entity's default icon can be set in canonical
schema YAML. Set `navigation.groups[].icon` and each item's `icon` for the
actual rendered group and menu-item icons. The Navigation designer provides a
searchable preview picker sourced from the icon IDs registered by the running
Obsidian application.

Secondary tabs are a deeper navigation level. A tab defined under
`navigation.secondaryTabs` stays in its parent's tab bar until it is dragged
into a navigation group. The designer then adds its surface with
`"placement": "navigation"` and renders it only in the tree. Choosing
**As tabs** removes that tree placement and returns it to its parent tab bar.
For a new parent surface, use **+ Tabs** on its navigation row, then drop a
record type or an existing entity-backed navigation item into that parent's
tab area.

Header buttons are configured with `navigation.actions`, keyed by surface id.
Entity actions use the configured schema/form for that record type and are
ignored unless the entity is part of the active workspace-owned record-type
set. Supported non-entity actions are explicit, for example
`{ "action": "quick-capture" }` and `{ "action": "today-task" }`. When a
surface has configured header actions, that list replaces the surface's
default create buttons.

Settings also provides a **Navigation designer** over the same JSON draft:

- Add groups without editing JSON.
- The record type and secondary tab panels show only unassigned items. In a
  file-managed workspace, the record type panel is limited to canonical schema
  YAML plus entity keys explicitly referenced by `workspace.json`; fallback
  built-in entities are not offered as available configuration.
- Use **+ Tabs** on a navigation parent and drop children into its tab area to
  create deeper navigation without editing JSON.
- Drag items between groups and drag group headers to reorder navigation.
- Choose registered Obsidian icons for groups and menu items with searchable
  previews.
- Move secondary child items back to their parent tab bar with **As tabs**.
- Remove an individual tab with the `x` on its tab chip. If that child already
  exists in navigation, it becomes a primary item; otherwise an entity-backed
  tab returns to the unassigned record type pool.
- Legacy secondary or setup items copied into configured navigation are
  normalized to primary items when they are not owned by an active tab area.
- Remove other navigation items with their **Remove** button or the
  drop-to-remove area; they return to the applicable unassigned panel.

The designer updates the `workspace.json` editor draft. Click **Save and
apply** to persist and activate its arrangement.

Settings also provides a **Workbook export groups** designer over
`workspace.json.workbookGroups`:

- Add, rename, remove and reorder reusable XLSX export bundles.
- Assign any runtime record type, including schema-derived types not placed in
  navigation.
- Include one record type in multiple bundles when exports overlap.

As with navigation, these edits update the JSON draft until **Save and apply**
persists them.

## Dashboards And Widgets

`workspace.json.dashboards` is the dashboard/report composition layer. Each
surface id maps to a dashboard object with optional `title`, `subtitle`,
`contextFilter`, `stats`, `layout`, `conditionalRows`, and `legend`.

Current widget shapes:

- `metric` stats for top-line KPIs and report aggregates.
- `list`, card-list, and `merge` widgets for note-backed sections.
- `bar-chart` and `kanban` widgets for grouped source data.
- `markdown`, `actions`, `base-link`, and `base-embed` widgets for
  narrative, commands, and Base-backed navigation/preview.
- `selector` and `date-range` controls for dashboard-local state and filters.
- Card-list widgets using `source: "recent"`, `recent-open`, `due`, or
  `due-open`.

The Settings tab now includes:

- A dashboard editor for the stored configurations.
- A widget catalog describing which widget shapes are implemented and which
  ones are still planned.
- A built-in dashboard inventory that shows which widget types each shipped
  dashboard uses.

## Template Folders

BOB Workspace ignores entity files located inside folder segments named `Templates` or `templates`.

This lets starter vaults ship valid example/template notes with normal frontmatter, such as `type: meeting`, without those files appearing in dashboards, entity lists, workbook exports, or counts. Prefer putting reusable templates under paths such as `00-CORE/Templates/...` instead of relying on filename filters like `!file.name.contains("Template")`.

### Workspace templates that bring their own entities

A workspace template (`templates/workspace-*.json`, bundled into `main.js`) may include an `_assets` block:

```jsonc
{
  "_template": { "id": "emai", "label": "EMAI Starter", "order": 5 },
  // …schemas / navigation / dashboards / bases / settings…
  "_assets": {
    "schemas": { "tasks": "<schema yaml string>", "people": "<…>" },
    "bases":   { "Tasks.base": "<base yaml string>" }
  }
}
```

On apply, `applyWorkspaceTemplate()` strips `_template`/`_assets`, validates the config, then `writeTemplateAssets()` writes the embedded schema YAML (to the schema folder) and `.base` files (to the Bases folder) **missing-only, before** the bootstrap. Because the template's own schemas now exist, the built-in schema bootstrap stays gated — so a template whose entities are **not** built-in (like EMAI) seeds exactly its own entities instead of the full built-in set.

Switching to a different template archives schema sources, derived outputs, and Bases from the configured folders. It records the old workspace/settings, move plan, and snapshots of external Base references in a plugin-folder `template-switch-<template>-<timestamp>.json` recovery file before moving anything. Archive failures abort the switch and roll back completed moves; external Bases stay in place because they may be shared. Later apply failures retain the archive and record the failed phase. Re-applying the same template rewrites workspace configuration and fills missing assets, while preserving existing asset contents. See [recovery instructions](installing-into-existing-vault.md#recovering-a-failed-template-switch).

## Entity Identity

Each entity type normally needs:

- A frontmatter `type` value, such as `person`, `deal`, `invoice`, or `task`.
- A folder or folder set where records usually live.
- A field list.
- Optional Base views.

Filename-backed system records are an intentional exception; for example,
`skill` records resolve `SKILL.md` files and do not require `type_value`.

The plugin can find entity files by:

- `typeFilter`: match `type: value`
- `typeFilters`: match several frontmatter key-value pairs
- `folders`: scan one or more folders
- `folder`: scan one fallback folder

These filters are combined carefully:

- `folders` are OR lists internally.
- Different filter categories are AND-combined.
- For type-only entities such as People, avoid adding folder restrictions unless the model really requires them.

## Schemas

Schema files are the canonical way to define BOB Workspace record types. With
schema support enabled, author `00-CORE/Schemas/source/*.yaml` through the
Settings **Data model designer** or carefully as YAML source. Treat generated
FileClasses, JSON Schemas and data-model documentation as downstream outputs.
If the source folder is empty, use the schema bootstrap action or save/apply a
schema-enabled workspace to seed canonical YAML from the current workspace
entity definitions before regenerating outputs.

Example:

```yaml
entity: person
label: Person
plural: People
icon: users
type_value: person
location_pattern: 10-ME/10-PEOPLE/ or 30-CLIENTS/{id}/10-PEOPLE/
key_fields:
- name
- person_category
fields:
- name: type
  type: string
  required: true
- name: name
  type: string
  required: true
- name: person_category
  type: string
  required: false
  enum:
  - employee
  - freelancer
  - contractor
  - business-contact
  - personal-contact
  - prospect
  - other
- name: status
  type: string
  enum:
  - active
  - archived
  default: active
field_aliases:
  name:
  - full name
  - displayName
```

Runtime identity uses canonical `type_value` (falling back to `entity`) and `discriminator`. The `person` schema maps to the `contact` runtime key while still matching notes with `type: person`. Explicit `bob.typeFilter`/`bob.typeFilters` override canonical matching when supplied. New-note defaults include the effective type and discriminators, preserving boolean/number values; explicit `template.frontmatter` keys can override those defaults.

When schemas are enabled, BOB Workspace uses these fields to enrich built-in entities. That means workbook export/import, create forms, and entity tables can use the vault's field names instead of the upstream defaults.

`location_pattern` also participates in creation-time folder resolution. When a new record has enough filled values to satisfy a placeholder path, BOB Workspace creates the note under that resolved folder; otherwise it falls back to the entity's configured default folder prefix.

Entity note bodies can also be configured without code. Put a `template` object inside the schema's `bob` block to override the note frontmatter and body for that entity. Use `frontmatter` for default keys and `body` for the markdown body. Values support simple `{{name}}`, `{{title}}`, `{{today}}`, and similar placeholders.

For the built-in task-note mode, use `workspace.json.templates.taskNote` to define the same `frontmatter` and `body` structure.

Workspace-owned plugin settings also live under `workspace.json.settings`. That block carries the portable knobs that should travel with the vault, including schema enablement, Base mappings, navigation visibility, modules, task-note mode, task-note folders, workbook export folders, icon-driven workspace layout and entity folder configuration.

The Data model designer supports creating entity schema sources and editing
identity, icon, type value, location pattern, key fields, lifecycle values,
co-required relationships, discriminators, import field aliases, ordered
fields, field types, required flags, enum options, create defaults, display
hints and advanced BOB behavior. A save
writes a sibling `.backup` file before updating source YAML and reloads BOB
Workspace immediately. **Save and regenerate** validates all source schemas
and writes Metadata Menu FileClasses and JSON Schemas as derived outputs.
JSON Schema filenames follow `type_value` where present, matching frontmatter
identity; regeneration removes stale derived outputs after source rename or
archive.

Field `default` values populate new-record forms and newly created notes.
Use literal values for text, enum, number, boolean or list fields. Date fields
also accept `{{today}}`, resolved when a note is created. JSON Schema outputs
retain these defaults as derived documentation and validation metadata.

## Bases

Base files should define how an entity is viewed.

Example:

```yaml
filters: note.type == "person"
properties:
  note.person_category:
    displayName: Category
views:
  - type: table
    name: Business Contacts
    filters:
      and:
        - note.person_category == "business-contact"
    order:
      - file.name
      - person_category
      - company
      - role
```

BOB Workspace should treat Bases as the view source of truth where possible:

- selected view
- column order
- filters
- sort
- groupBy
- special Base view types

Base column order controls presentation only; it must not remove canonical
schema fields from create or import workflows.

If the plugin cannot support a Base feature directly, it should show the unsupported filter/view information rather than silently pretending it is applied.

### Bases folder and explicit paths

`entityBasePath()` takes the reference from `workspace.json.bases[key].file`, then `settings.baseFiles`, then built-in/default filenames. A bare filename such as `People.base` resolves under **Bases folder** (default `00-CORE/Bases`). A reference containing a directory, such as `20-COMPANY/skills.base`, is used verbatim. Changing the folder setting changes resolution for bare filenames only; it does not move existing files or rewrite explicit paths. The picker stores full vault paths.

### Generate missing bases

`Settings → BOB Workspace → Data model → Generate missing bases` (command: **Generate missing bases**) writes a starter `.base` for every known entity that lacks one — a `filters` clause from the runtime entity's `typeFilters`/`typeFilter` or folder, a `table` view listing its columns (`file.name` for the primary field, bare field keys otherwise), and `properties.<id>.displayName` for readable headers. It covers entities defined via schema YAML, not just built-ins. Missing-only: existing `.base` files are never overwritten.

In a Base, `order`/`sort` use **bare** property names (`person_category`), while `properties` keys and `filters` use the `note.<prop>` form; `file.name` is the primary field's column. (Match this when hand-authoring.)

## Derived Workspace Views

Some workspace screens are derived views over existing entities rather than separate entity types.

- `Team` is a People view over `type: person`. By default it includes `person_category` values `employee`, `freelancer`, and `contractor`; the category set is configurable in plugin settings.
- `Client Work > Workspace` combines meetings, communication threads, deliverables, feedback, surveys, testimonials, and decisions. Its client selector matches both `client_id` and `end_client_id`; its project selector matches `project_id`.
- `Productivity` reads tasks according to the configured task mode. Checkbox tasks come from daily note task sections. TaskNotes come from both the active TaskNotes folder and the TaskNotes archive folder so historical completion remains visible.

This keeps the vault model DRY: derived views should compose existing entity schemas instead of introducing duplicate entity types.

## Field Aliases

Field aliases are the bridge between older names, spreadsheet headers, and canonical BOB field names.

Examples:

| Incoming name | Canonical field |
| --- | --- |
| `closeBy` | `expected_close` |
| `close date` | `expected_close` |
| `value` | `deal_value` |
| `lastContact` | `last_contact` |
| `phone number` | `phone` |

Define aliases in the canonical schema source. Keys are canonical fields and
values are incoming spreadsheet column names accepted by CSV and workbook
imports:

```yaml
field_aliases:
  deal_value:
  - value
  - amount
  expected_close:
  - closeBy
  - close date
  client_id:
  - company
```

The Settings **Data model designer** edits this as one field per line, for
example `expected_close: closeBy, close date`. Field aliases must point to
defined schema fields and cannot conflict with another canonical field. The
older importer synonyms remain as input normalization only.

## Adding A New Entity

The no-code path uses four Settings designers in sequence. Each step saves
automatically or through **Save and apply**; no JSON editing is required.

### Step 1 — Define the schema

Open **Settings → BOB Workspace → Data model** and click **+ New schema**.

Fill in the identity fields:

| Field | Purpose | Example |
|---|---|---|
| Entity key | Internal identifier, used in code and workspace.json | `order` |
| Label / Plural | Display name in the UI | `Order` / `Orders` |
| Type value | Value written to frontmatter `type:` | `order` |
| Location pattern | Folder where notes are created | `30-CLIENTS/{id}/Orders/` |
| Icon | Lucide icon ID shown in navigation | `package` |
| Definition | Short description of the entity | `A customer purchase order` |
| Key fields | Fields shown in list headings | `name, client_id, status` |
| Lifecycle | Allowed values for a `status` field | `draft, open, fulfilled, cancelled` |

Then add fields with **+ Add field**. For each field:

- Set the field name (snake_case, e.g. `order_date`)
- Choose the data type (`Text`, `Number`, `Date`, `Enum`, etc.)
- For `Enum` fields, add the allowed values in **Options**
- Set a **Default value** for pre-populated forms; date fields accept `{{today}}`
- Mark **Required** for mandatory create-form fields
- Choose a **BOB display** override only when the JSON type differs from how
  the UI should render the field (e.g. a `string` field displayed as `currency`)

Click **Save schema source** to persist the draft. Editing controls updates the
draft; it does not replace the explicit save action.

Click **Save and regenerate** to write downstream artifacts:

- `<schema root>/fileClasses/{type_value}.md` — Metadata Menu FileClass
- `<schema root>/json-schema/{type_value}.schema.json` — JSON Schema for validation
- Injects an entity table and definition block into `DATAMODEL.md` and
  `DATAMODEL-FULL.md` between the `<!-- BEGIN/END GENERATED -->` markers

The schema root is the configured source path with a trailing `/source` removed
(e.g. `00-CORE/Schemas/source` → `00-CORE/Schemas`). Entities sharing a note type
are merged for generated outputs; they do not get separate files under entity
names. If `type_value` is omitted, output naming falls back to the entity key.

If the source folder is empty, the Settings schema section exposes a
**Bootstrap schemas** button. That command seeds canonical YAML from the
current workspace entity definitions without overwriting existing sources,
then regenerates the derived outputs.

### Step 2 — Place the entity in navigation

Open **Settings → BOB Workspace → Workspace** and go to the
**Navigation designer**.

The **Record types** panel lists all schema-defined types that are not yet
placed in navigation. Drag your new type into an existing group, or:

1. Click **+ Group** to create a new navigation group for it
2. Set the group label and icon
3. Drag the record type into the group

To create a secondary (inner) tab instead of a top-level item:

1. Click **+ Tabs** on the parent navigation row
2. Drag the record type into that parent's tab area

Click **Save and apply** to persist the navigation arrangement to
`workspace.json`.

### Step 3 — Create a Base (optional)

Quickest path: run **Generate missing bases** (Settings → Data model, or the command) to scaffold a starter `.base` for the new entity automatically. Then customize it. To hand-author one instead — for filtered subsets, a specific column order, or a non-table layout — create a `.base` file:

```yaml
# 00-CORE/Bases/Orders.base
filters: note.type == "order"
properties:
  note.status:
    displayName: Status
views:
  - type: table
    name: Open Orders
    filters:
      and:
        - note.status == "open"
    order:
      - file.name
      - client_id
      - order_date
      - status
```

### Step 4 — Associate the Base

In **Settings → BOB Workspace → Workspace**, find the entity row and select
the `.base` file and view from the **Base** selector. The mapping is saved to
`workspace.json.bases` and travels with the vault.

### Step 5 — Add to workbook export groups (optional)

Open the **Workbook export groups** designer in the same Workspace settings
panel. Add the entity key to an existing group or create a new bundle.

### Step 6 — Test

| Action | What to verify |
|---|---|
| Create record | Form shows correct fields and defaults; file lands in the right folder |
| List view | Records appear; columns match Base column order |
| Inline edit | Field saves via frontmatter |
| Base view | Filters apply; switching views works |
| CSV import | Column headers map to canonical field names (or aliases) |
| Workbook export | Entity appears in the correct XLSX sheet |
| Workbook import | Imported rows resolve field aliases and write correct frontmatter |

## Gotchas (field-tested)

These cost real debugging time when building a standalone product vault on BOB Workspace:

- **Canonical schema field types are `string | number | integer | boolean | array | object`.** Use `type: string` with `format: date` for a date picker. The designer/regenerator rejects `type: date`, although the runtime loader currently accepts it; use the canonical form for consistent validation.
- **A nav entity must be defined in the schema layer.** Canonical entities live in `Schemas/*.yaml` with `schemas.enabled: true`. The legacy `entities` mechanism is **no longer supported**: a top-level `entities` key in `workspace.json` is now rejected by `validateWorkspaceConfig` (`entities is no longer supported; define record types in schema YAML`), and a stray `entities.json` in the plugin folder is not read at all.
- **An entity nav item with no wired Base still renders — as the generic list.** A Base mapping is optional for simple lists (they render from folder/type); add one under the top-level `bases` block (`bases: { <entity>: { file, view } }`) only when you need Base-defined filters, column order, grouping, sorting, or an external non-table Base view. A surface only shows "coming soon" when its `entityKey` resolves to no registered entity at all.
- **Navigation can target dashboards and tab parents as well as entities.** A habit tracker can be a custom dashboard route with a Base-backed widget; it does not need its own entity definition.
- **Workspace-owned settings live in `workspace.json.settings`.** Personal settings remain in `data.json`. Loading overlays workspace-owned keys from the workspace; saving removes those keys from plugin data. Unknown plugin-data keys are not automatically stripped on load.
- **Inline native views are optional and off by default.** BOB mounts Base views through Obsidian's internal embed registry, selecting the view with `#View`. Enable **Settings → App → Rendering → Inline canvases & Base views** to use that path; otherwise use **Open Base**. Static Markdown rendering is not the plugin's live-mount mechanism.

## Structured fields and editing limits

Objects and arrays of records display as readable summaries in tables and detail
forms. Record arrays prefer an identifying field (`id`, `name`, `title`, `label`,
`key`, `slug`, or `activity_label`), show up to six items, and limit nested
expansion. Use **Open as note** to edit these values. Scalar editors check the
current frontmatter again when saving, so a value changed into an object by
another writer cannot be overwritten with text.

Canonical `object` fields and arrays without explicit string items use note
editing. An array with `items: { type: string }` uses the tag editor. Integer
fields use numeric inputs and reject fractional values; boolean fields use
true/false selectors. Clearing an optional numeric field removes the property;
entering `0` preserves a real zero. Detail autosaves use per-field timers, cancel
pending duplicate saves on blur, and flush pending values on navigation.

### Workbook value encoding

XLSX export encodes arrays and objects as `BOB:JSON:v1:<JSON>`. Strings beginning
with that prefix are escaped through the same encoding. Import decodes only
marked cells; ordinary JSON-looking text stays text. Keep the marker when editing
an encoded cell. Existing legacy exports containing `[object Object]` cannot
recover data that was already lost; export again from intact notes.

Imports validate field shape and reject scalar replacements of existing objects
or arrays. A `file_path` update must target an existing markdown note belonging
to the selected entity; invalid targets are reported as failed rows. Imported
primary-field values update frontmatter, not filenames. Blank/missing cells leave
existing values alone; encoded `[]` and `{}` explicitly write empty collections.
Use the note editor to remove a property. Import errors identify the row; the
workbook notice displays the first few failures.

## What Requires Code

Most entity and field changes should not require code. Code is only needed for:

- specialized non-generic surfaces
- custom non-table UI behavior
- new field widget types
- new import/export formats
- deeper Base feature support
- new commands/settings

If a change is just "this entity has a different field", it should be a schema change, not a plugin code change.

## Current Maintenance Notes

The plugin still contains some legacy fallback fields. This is acceptable as input normalization, but BOB vaults should rely on schemas/Bases for canonical behavior.

Known cleanup direction:

- Reduce built-in entity definitions to minimal fallbacks.
- Prefer schema-derived field definitions for import/export.
- Keep Base view support DRY rather than duplicating special views in plugin code.
- Document unsupported Base features clearly in the UI.
