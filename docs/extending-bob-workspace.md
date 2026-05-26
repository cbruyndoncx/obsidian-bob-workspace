# Extending BOB Workspace Without Code Changes

BOB Workspace is still structurally based on the Cadence plugin, but the goal is not to make every vault adopt Cadence's original field names. The plugin should act as a workspace shell over markdown entities, while each vault defines its own data model through canonical schemas and Bases.

This guide explains the intended extension model.

## Design Principle

The plugin has several layers. Later layers should refine or override earlier layers:

1. **Built-in fallback model**
   - Lives in `main.js`.
   - Keeps the plugin usable in an empty vault.
   - Should stay small and generic.
   - May still contain some legacy Cadence field names for compatibility.

2. **Schema layer**
   - YAML files in `00-CORE/Schemas/source/`.
   - Canonical source for BOB Workspace entity definitions when schema support is enabled.
   - Defines entity identity, location, field keys, types, enums, required flags, and lifecycles.
   - Edited visually from Settings -> BOB Workspace -> Schemas -> Data model designer.

3. **Base layer**
   - `.base` files in `00-CORE/Bases/`.
   - Defines view behavior: visible columns, filters, sort, groupBy, and special Base views.
   - The workspace should reuse these views where practical instead of duplicating view logic.

4. **Custom entity layer**
   - `entities.json` in the plugin folder next to Obsidian's `data.json`.
   - Compatibility input for pre-schema configurations.
   - Existing overrides can be migrated into schema YAML from Settings.

5. **Workspace definition layer**
   - `workspace.json` in the plugin folder next to `data.json`.
   - Owns schema enablement, Base/view associations, navigation groups,
     surfaces, secondary tabs, and workbook export groups.
   - Managed from Settings -> BOB Workspace -> Workspace definition, or
     reloaded with the `Reload workspace.json` command.

6. **Import alias layer**
   - Maps spreadsheet/frontmatter aliases to canonical field keys.
   - Useful when importing from Cadence, another CRM, or another vault.
   - Defined per schema as `field_aliases` and edited in the Data model designer.
   - Legacy built-in synonyms remain as compatibility fallback only.

The most important rule: **the vault data model should live in the vault, not in plugin code.**

## Workspace Definition

`workspace.json` is the no-code composition layer. When `navigation.groups`
is present, it replaces the built-in left-navigation definition. Its
`secondaryTabs` object replaces built-in inner tab definitions, and
`workbookGroups` replaces export group choices.

Entity-backed configured surfaces use the generic record table/detail UI.
Existing built-in surface IDs such as `home` and `crm.pipeline` retain their
specialized renderer when they are included in configured navigation. A new
specialized dashboard still requires plugin code.

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
    "secondaryTabs": {}
  },
  "workbookGroups": [
    { "id": "operations", "label": "Operations", "entityKeys": ["order"] }
  ]
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

Settings also provides a **Navigation designer** over the same JSON draft:

- Add groups without editing JSON.
- The record type and secondary tab panels show only unassigned items; drag an
  item into a group to expose it in navigation.
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

## Template Folders

BOB Workspace ignores entity files located inside folder segments named `Templates` or `templates`.

This lets starter vaults ship valid example/template notes with normal frontmatter, such as `type: meeting`, without those files appearing in dashboards, entity lists, workbook exports, or counts. Prefer putting reusable templates under paths such as `00-CORE/Templates/...` instead of relying on filename filters like `!file.name.contains("Template")`.

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
- `typesFilter`: match one of several `type` values

These filters are combined carefully:

- `folders` and `typesFilter` are OR lists internally.
- Different filter categories are AND-combined.
- For type-only entities such as People, avoid adding folder restrictions unless the model really requires them.

## Schemas

Schema files are the canonical way to define BOB Workspace record types. With
schema support enabled, author `00-CORE/Schemas/source/*.yaml` through the
Settings **Data model designer** or carefully as YAML source. Treat generated
FileClasses, JSON Schemas and data-model documentation as downstream outputs.

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
- company
- role
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
field_aliases:
  name:
  - full name
  - displayName
```

When schemas are enabled, BOB Workspace uses these fields to enrich built-in entities. That means workbook export/import, create forms, and entity tables can use the vault's field names instead of Cadence's original names.

The Data model designer supports creating entity schema sources and editing
identity, icon, type value, location pattern, key fields, lifecycle values,
co-required relationships, discriminators, import field aliases, ordered
fields, field types, required flags, enum options, display hints and advanced
BOB behavior. A save
writes a sibling `.backup` file before updating source YAML and reloads BOB
Workspace immediately. **Save and regenerate** validates all source schemas
and writes Metadata Menu FileClasses and JSON Schemas as derived outputs.
JSON Schema filenames follow `type_value` where present, matching frontmatter
identity; regeneration removes stale derived outputs after source rename or
archive.

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

## Derived Workspace Views

Some workspace screens are derived views over existing entities rather than separate entity types.

- `Team` is a People view over `type: person`. By default it includes `person_category` values `employee`, `freelancer`, and `contractor`; the category set is configurable in plugin settings.
- `Client Work > Workspace` combines meetings, communication threads, deliverables, feedback, surveys, testimonials, and decisions. Its client selector matches both `client_id` and `end_client_id`; its project selector matches `project_id`.
- `Productivity` reads tasks according to the configured task mode. Checkbox tasks come from daily note task sections. TaskNotes come from both the active TaskNotes folder and the TaskNotes archive folder so historical completion remains visible.

This keeps the vault model DRY: derived views should compose existing entity schemas instead of introducing duplicate entity types.

## Custom Entities

`entities.json` is a compatibility layer for vaults that have not migrated to
canonical schemas. For schema-enabled vaults, use **Migrate into schemas** in
Settings; unmatched legacy records are retained rather than discarded.

Example:

```json
{
  "deal": {
    "folder": "30-CLIENTS",
    "typeFilter": "deal",
    "label": "Deal",
    "plural": "Deals",
    "fields": [
      { "key": "title", "label": "Title", "primary": true },
      { "key": "stage", "label": "Stage", "type": "enum", "options": ["lead", "qualified", "proposal", "won", "lost"] },
      { "key": "deal_value", "label": "Deal Value", "type": "currency" },
      { "key": "expected_close", "label": "Expected Close", "type": "date" }
    ],
    "columns": ["title", "stage", "deal_value", "expected_close"]
  }
}
```

Do not add new model definitions here in a schema-enabled vault. Canonical
field definitions, labels, display hints and BOB behavior belong in schema
YAML.

## Field Aliases

Field aliases are the bridge between old Cadence names, spreadsheet headers, and canonical BOB field names.

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
legacy built-in importer synonyms remain as compatibility fallbacks.

## Adding A New Entity

For a BOB vault:

1. Create a schema in `00-CORE/Schemas/source/{entity}.yaml`.
2. Create a Base in `00-CORE/Bases/{Entity}.base` if the entity needs custom views.
3. Arrange the entity in navigation or a secondary tab using the Navigation designer.
4. Associate a Base/view in Settings; it is stored in `workspace.json.bases`.
5. Test create, list, workbook export, workbook import, and Base view switching.

For a non-BOB vault:

1. Define the entity in `entities.json`.
2. Point it to the vault's folder/type fields.
3. Add fields and columns.
4. Add `field_aliases` for old spreadsheet column names when required.

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

The plugin still contains some legacy Cadence fallback fields. This is acceptable as compatibility fallback, but BOB vaults should rely on schemas/Bases for canonical behavior.

Known cleanup direction:

- Reduce built-in entity definitions to minimal fallbacks.
- Prefer schema-derived field definitions for import/export.
- Keep Base view support DRY rather than duplicating special views in plugin code.
- Document unsupported Base features clearly in the UI.
