# YAML Source Schema — Canonical Shape

The BOB Workspace plugin's `loadCanonicalSchemaSources` parses every `*.yaml` (or `*.yml`) file under the configured schemas folder (default `00-CORE/Schemas/source/`). Each file defines one entity. The plugin validates via `validateSourceSchemaDefinition` and rejects malformed files at regen time.

## Canonical example

```yaml
entity: client                # required — file slug, no extension
label: Client                 # required — display label for sorting
type_value: client            # required — frontmatter `type:` value (often same as entity)
location_pattern: 30-CLIENTS/{client-id}/00-PROFILE/   # required — canonical folder pattern
description: Client entity from DATAMODEL.md           # required — short prose
domain: clients-delivery      # optional — annotation only (used by compose skills)
fields:
  - name: client_id
    type: string
    required: true
    description: Stable client identifier; kebab-case
  - name: client_name
    type: string
    required: true
  - name: status
    type: string
    enum: [prospect, active, inactive, completed, archived]
    default: prospect
  - name: tags
    type: array
  - name: created
    type: string
    format: date
    required: true
  - name: regions
    type: array
    enum: [UAE, EU, APAC, AMER]
```

## Field reference

| Key | Required | Notes |
|-----|----------|-------|
| `entity` | yes | filename slug; lowercase, kebab-case |
| `label` | yes | sort/display label |
| `type_value` | yes | the frontmatter `type:` value (use same as `entity` if there's no alias) |
| `location_pattern` | yes | canonical folder pattern; supports `{var}` placeholders (e.g. `{client-id}`); validation will fail without it |
| `description` | yes | short prose describing the entity |
| `domain` | no | annotation for downstream `workspace.json` composition; ignored by plugin parser |
| `fields[]` | yes | list of field definitions |
| `fields[].name` | yes | field name as it appears in frontmatter |
| `fields[].type` | yes | one of `string`, `number`, `integer`, `boolean`, `array` |
| `fields[].format` | no | `date` (the only format the plugin currently maps) |
| `fields[].enum` | no | list of allowed values — promotes to a Select / Multi field downstream |
| `fields[].required` | no | boolean; appears in generated JSON Schema's `required[]` |
| `fields[].default` | no | scalar default emitted to JSON Schema |
| `fields[].description` | no | passes through to fileClass + JSON Schema |

## What the plugin produces downstream

For every valid YAML the plugin's `regenerateSchemaOutputs` writes:

- **Metadata Menu fileClass** at `{root}/fileClasses/{entity}.md` via `sourceSchemaToFileClass(schema)`. Field-type mapping:
  - `enum: [...]` → `Select`
  - `type: array` → `Multi`
  - `type: boolean` → `Boolean`
  - `type: number` / `integer` → `Number`
  - `format: date` → `Date`
  - everything else → `Input`
- **JSON Schema** at `{root}/json-schema/{type_value or entity}.schema.json` via `sourceSchemaToJsonSchema(schema)`. Used by frontmatter validator hooks.
- **DATAMODEL.md** — entity types table re-injected between `<!-- BEGIN GENERATED: ENTITY TYPES -->` / `<!-- END GENERATED: ENTITY TYPES -->` markers.
- **DATAMODEL-FULL.md** — per-entity sections re-injected between `<!-- BEGIN GENERATED: ENTITY DEFINITIONS -->` / `<!-- END GENERATED: ENTITY DEFINITIONS -->` markers.
- **Cleanup**: any file in `fileClasses/` or `json-schema/` not present in source gets deleted.

## Validation rules (inferred from plugin source)

The plugin (`validateSourceSchemaDefinition`) will throw `Schema validation
failed: ...` if:
- `entity`, `label`, or `location_pattern` is missing (or `type_value` is
  missing on a non-filename-backed entity)
- `fields` is missing / not a list / empty
- a field's `type` is outside `[string, number, integer, boolean, array]`
- two fields share the same name
- a `key_fields` entry is not one of the defined fields
- a field's `default` is not one of its `enum` values, or its type doesn't match
- `enum` is set but not a list

It does **NOT** validate `format` — an unrecognized `format` is ignored, not
rejected (only `date` / `date-time` / `email` are read, to pick the UI field
type). This skill should pre-validate the above before writing to avoid
round-trip failures.

## How this skill writes YAML

Use `yaml.dump(data, sort_keys=False, default_flow_style=False)` to preserve field order and produce block-style output. The plugin parses via Obsidian's `parseYaml` (js-yaml under the hood) which is permissive but the round-trip is cleaner with block style.
