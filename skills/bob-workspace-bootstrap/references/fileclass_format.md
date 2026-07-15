# Metadata Menu fileClass — Plugin-Generated, Not by This Skill

This skill does **not** write Metadata Menu fileClass files (`{root}/fileClasses/{entity}.md`). The BOB Workspace plugin's `regenerateSchemaOutputs` produces them from the YAML source files this skill writes.

## Generation chain

```
This skill writes      Plugin reads YAML        Plugin writes fileClass
00-CORE/Schemas/  →    via loadCanonical    →   00-CORE/Schemas/
  source/{X}.yaml      SchemaSources()           fileClasses/{X}.md
                                                 (via sourceSchemaToFileClass)
```

The `sourceSchemaToFileClass(schema)` function in the plugin's `main.js` is the single source of truth for fileClass content. Implementing a parallel generator in this skill would create competing artifacts and drift the moment the plugin's template changes.

## What this means in practice

- If the user reports "my fileClass is wrong" → fix the YAML source, click Regenerate. Never edit the fileClass directly (it gets overwritten next regen).
- If the user reports "Metadata Menu shows the wrong field type" → check the YAML's `type` / `enum` / `format` against `references/yaml_source_schema.md`. The plugin's mapping:

| YAML | fileClass type |
|------|---------------|
| `enum: [...]` | `Select` |
| `type: array` | `Multi` |
| `type: boolean` | `Boolean` |
| `type: number` / `integer` | `Number` |
| `format: date` | `Date` |
| (else) | `Input` |

- If the user wants Metadata Menu to do something the YAML schema can't express (currency, email, primary flag), the plugin reads narrow overrides from `entities.json`. That file is intentionally minimal — see the comment in the active `entities.json`.

## Related

- `references/yaml_source_schema.md` — what this skill actually writes
- `references/workspace_json_schema.md` — explicitly out of scope
