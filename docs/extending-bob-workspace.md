# Extending BOB Workspace Without Code Changes

BOB Workspace is still structurally based on the Cadence plugin, but the goal is not to make every vault adopt Cadence's original field names. The plugin should act as a workspace shell over markdown entities, while each vault defines its own data model through schemas, Bases, and optional JSON overrides.

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
   - Primary source for BOB Workspace entity fields when schema support is enabled.
   - Defines field keys, labels, types, enums, required flags, and type values.

3. **Base layer**
   - `.base` files in `00-CORE/Bases/`.
   - Defines view behavior: visible columns, filters, sort, groupBy, and special Base views.
   - The workspace should reuse these views where practical instead of duplicating view logic.

4. **Custom entity layer**
   - `entities.json` in the plugin folder next to Obsidian's `data.json`.
   - Lets a vault add entities or override built-in entity fields without editing plugin code.
   - Managed from Settings -> BOB Workspace -> Custom entities, or reloaded with the `Reload entities.json` command.

5. **Import alias layer**
   - Maps spreadsheet/frontmatter aliases to canonical field keys.
   - Useful when importing from Cadence, another CRM, or another vault.
   - This is currently partly built in; long term it should be first-class configuration.

The most important rule: **the vault data model should live in the vault, not in plugin code.**

## Entity Identity

Each entity type normally needs:

- A frontmatter `type` value, such as `person`, `deal`, `invoice`, or `task`.
- A folder or folder set where records usually live.
- A field list.
- Optional Base views.

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

Schema files are the preferred way to define BOB Workspace fields.

Example:

```yaml
entity: person
label: Person
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
```

When schemas are enabled, BOB Workspace uses these fields to enrich built-in entities. That means workbook export/import, create forms, and entity tables can use the vault's field names instead of Cadence's original names.

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

If the plugin cannot support a Base feature directly, it should show the unsupported filter/view information rather than silently pretending it is applied.

## Derived Workspace Views

Some workspace screens are derived views over existing entities rather than separate entity types.

- `Team` is a People view over `type: person`. By default it includes `person_category` values `employee`, `freelancer`, and `contractor`; the category set is configurable in plugin settings.
- `Client Work > Workspace` combines meetings, communication threads, deliverables, feedback, surveys, testimonials, and decisions. Its client selector matches both `client_id` and `end_client_id`; its project selector matches `project_id`.
- `Productivity` reads tasks according to the configured task mode. Checkbox tasks come from daily note task sections. TaskNotes come from both the active TaskNotes folder and the TaskNotes archive folder so historical completion remains visible.

This keeps the vault model DRY: derived views should compose existing entity schemas instead of introducing duplicate entity types.

## Custom Entities

Use `entities.json` when a vault does not use BOB schemas, or when a specific vault needs local overrides.

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

Recommended uses:

- Add a new entity type.
- Override fields for a built-in entity.
- Change folder/type filters for another vault.
- Add local labels or enum values.

Avoid using `entities.json` for broad BOB model changes that should live in schemas.

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

Today, some aliases are hardcoded in the import mapper. The intended direction is to make aliases configurable per entity, for example:

```json
{
  "deal": {
    "fieldAliases": {
      "value": "deal_value",
      "closeBy": "expected_close",
      "close_date": "expected_close",
      "company": "client_id"
    }
  }
}
```

Until `fieldAliases` is implemented as configuration, prefer using canonical field keys in schemas, Bases, and templates. Add import synonyms only for real migration needs.

## Adding A New Entity

For a BOB vault:

1. Create a schema in `00-CORE/Schemas/source/{entity}.yaml`.
2. Create a Base in `00-CORE/Bases/{Entity}.base` if the entity needs custom views.
3. Add or enable a navigation item if the plugin already supports that nav group.
4. Use `entities.json` only if the schema layer is not enough.
5. Test create, list, workbook export, workbook import, and Base view switching.

For a non-BOB vault:

1. Define the entity in `entities.json`.
2. Point it to the vault's folder/type fields.
3. Add fields and columns.
4. Add aliases for old spreadsheet/frontmatter names once alias config exists.

## What Requires Code

Most entity and field changes should not require code. Code is only needed for:

- new navigation groups or first-class surfaces
- custom non-table UI behavior
- new field widget types
- new import/export formats
- deeper Base feature support
- new commands/settings

If a change is just "this entity has a different field", it should be a schema or `entities.json` change, not a plugin code change.

## Current Maintenance Notes

The plugin still contains some legacy Cadence fallback fields. This is acceptable as compatibility fallback, but BOB vaults should rely on schemas/Bases for canonical behavior.

Known cleanup direction:

- Make `fieldAliases` configurable.
- Reduce built-in entity definitions to minimal fallbacks.
- Prefer schema-derived field definitions for import/export.
- Keep Base view support DRY rather than duplicating special views in plugin code.
- Document unsupported Base features clearly in the UI.
