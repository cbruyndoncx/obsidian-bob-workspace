# Diagnose Route Workflow

Compare typed Markdown notes with the active BOB Workspace UI. This route changes no notes, schemas, Bases, or plugin configuration. It writes one Markdown report under `BOB Workspace/Reports/` by default.

## Run

```bash
uv run scripts/diagnose.py --vault <absolute-vault-path>
```

`--output <vault-relative-path>` selects a different report file inside the same vault.

The script reads:

- The installed plugin's `workspace.json` navigation groups, secondary tabs, and dashboard entity references.
- Canonical YAML in the folder selected by `schemas.folder` or `settings.schemasFolder`.
- Generated FileClasses beside the schema source folder, plus Metadata Menu's FileClasses when present.
- Markdown notes with a `type:` frontmatter value.

It maps a schema's runtime `entity` key to its note-facing `type_value`; `person` maps to BOB's `contact` runtime key.

## Findings

| Tier | Finding | Meaning |
|------|---------|---------|
| P1 | Typed notes missing from configured UI | No matching `entityKey` navigation/tab or dashboard entity reference was found. Add one with `bob-workspace-compose`. |
| P2 | Observed field missing from FileClass | At least 30% of this type's notes use a field absent from the generated FileClass. Review the YAML source and regenerate. |
| P3 | Configured entity has no notes | The UI references a record type with no matching notes. This may be a valid empty workspace. |
| P3 | FileClass field unused | The generated FileClass declares a field absent from observed notes. Check whether it is reserved for future use. |

Review the report before acting. An entity can intentionally have zero records, and a schema may define fields that new notes will use later.
