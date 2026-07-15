# Bases Route Workflow

Generates one `.base` file per entity under `00-CORE/Bases/`. Reads YAML source files for the entity field inventory, follows [[obsidian-bases]] conventions for the `.base` shape.

## Pre-condition

- YAML source files for the target entities exist under `00-CORE/Schemas/source/`
- Plugin has run Regenerate at least once (so the entity is materialized in fileClasses + JSON Schemas)

## Inputs

- `vault_path` — vault root
- `entities` — optional list; if omitted, generates Bases for every YAML source file lacking a matching `.base`

## Steps

### 1. Read obsidian-bases conventions

Before writing, read `00-CORE/Agents/skills/obsidian-bases/references/examples.md` and `functions.md` to confirm current `.base` syntax. Do NOT guess — Bases YAML shape evolves with the Obsidian version.

### 2. Inventory existing Bases

List every `.base` file under `00-CORE/Bases/`. For each, peek at the `filters:` line to capture the `note.type` it serves. Build the set of already-covered types.

### 3. Resolve target entities

If `entities` input provided → use that list (after filtering to those with YAML source).
Else → all YAML source entity types NOT already covered by an existing `.base`.

### 4. Derive Base content from YAML

For each target entity, read its YAML source. Extract:
- `entity` / `type_value` → the `filters: note.type == "..."` expression
- `label` → the Base file name (kebab-case → Title Case with `.base`)
- `fields` → properties block
- Required + status + date fields → default `order` for the view

### 5. Render `.base` file

Skeleton:

```yaml
filters: note.type == "<type_value>"
formulas:
  open: link(file.path, "🔍")
properties:
  file.name:
    displayName: <Label>
  note.<field1>:
    displayName: <Field 1 Label>
  ...
views:
  - type: table
    name: All <Label>s
    order:
      - formula.open
      - <field1>
      - <field2>
      - ...
    sort:
      - property: <created_or_date_field>
        direction: DESC
    columnSize:
      formula.open: 52
```

Rules:
- Include `formula.open` as the leftmost column always (consistent with existing vault Bases).
- Order properties by: `file.name` → required fields → status → date fields → remaining.
- Sort default: by `created` desc, fall back to first date field, fall back to file.name.
- Skip system frontmatter (`type`, `tags`, `created`, `modified` go below in order; do not show `tags`).
- Limit default `order` to 8 columns max — more fields go in properties (available in column picker) but not in default view.

### 6. Write `.base` files

`00-CORE/Bases/<Entity-Label>.base`. Skip if file with same path exists.

### 7. Done When

- One `.base` per target entity written
- No existing `.base` overwritten
- All written files follow obsidian-bases conventions read in Step 1
- User can open Bases in Obsidian and see the entity records listed
