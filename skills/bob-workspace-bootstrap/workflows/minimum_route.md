# Minimum Route Workflow

First-pass bootstrap. Write canonical YAML source files to `{schema-folder}/` so the plugin can load the entity definitions after regeneration. Add a workspace layout through the companion compose skill or BOB's template picker.

## Pipeline

```
Census vault → propose YAML → user confirms → write YAML → tell user to click Regenerate
                                                              ↓
                                         Plugin's regenerateSchemaOutputs takes over
                                         (writes fileClasses, JSON Schemas, DATAMODEL sections)
```

## Inputs

- `vault_path` — absolute path to vault root (required)
- `templates_path` — optional; auto-detected otherwise

## Steps

### 1. Vault discovery

1. Verify `<vault>/.obsidian/` exists; abort if not.
2. Verify BOB Workspace plugin installed (`<vault>/.obsidian/plugins/bob-workspace/manifest.json`); warn if absent.
3. Resolve `{schema-folder}` from the installed plugin's `workspace.json` using `scripts/workspace_paths.py`: `schemas.folder`, then `settings.schemasFolder`, then `00-CORE/Schemas/source`. Do not use `data.json` for this setting.
4. Locate templates folder via `.obsidian/templates.json` or `.obsidian/plugins/templater-obsidian/data.json`. Fall back to common defaults.
5. Snapshot existing YAML source files (treat all as authoritative).

### 2. Detection passes

1. `scripts/template_scan.py --templates-dir <path>` — extract per-template frontmatter shapes.
2. `scripts/frontmatter_census.py --vault <path> --min-count 3` — group notes by `type:`, infer field shapes, enum candidates.
3. Identify domain per entity from dominant folder (annotation only, not used for `workspace.json` here).

### 3. Build YAML source proposals

For each detected entity above threshold:

```yaml
entity: <type slug>
type_value: <type value>      # if differs from entity
label: <Display>
location_pattern: <concrete vault-relative folder pattern>
domain: <inferred-domain>     # annotation for downstream compose skill
fields:
  - name: <field>
    type: string|number|integer|boolean|array
    format: date              # if applicable
    enum: [...]               # if distinct/total < 0.15 AND distinct ≤ 12
    required: true            # if presence_ratio ≥ 0.90
    description: |
      Inferred from N notes; X% presence
```

Skip entity if a YAML source file already exists (handled by `extend` route).
Resolve the proposed `location_pattern` from observed note paths. The plugin reads it literally; context keys and Markdown formatting do not belong in YAML values.

### 4. Write proposal report

`BOB Workspace/Reports/bob-workspace-bootstrap-proposal.md` with:
- Detected types + counts + dominant folders + enum candidates
- Existing YAML source files preserved (listed verbatim)
- New YAML files to be written (full paths)
- Post-run instructions (Settings → BOB Workspace → Regenerate)

### 5. User confirmation gate

Stop. Present report path. Wait for explicit "proceed."

### 6. Write YAML source

For each proposed entity, call:

```bash
uv run scripts/generate_yaml.py \
  --vault <vault> \
  --entity <slug> \
  --label "<Display Label>" \
  --location-pattern "<canonical folder>" \
  --domain <domain-slug>
```

The script preserves observed field types and enum values, adds the required `type` field if needed, deduplicates field names, and refuses to overwrite an existing schema without `--force`. It rejects output outside the configured schema folder.

### 6b. UI is NOT written here — hand off

This route writes YAML schema source only. It does **NOT** write or merge `workspace.json` — the UI (dashboards, widgets) is owned by [[bob-workspace-compose]] and the plugin's native `Apply workspace template…` command. Writing a baseline here would create a second writer of the same live file with no shared backup, exactly the collision this boundary exists to prevent.

The `domain` annotation written into each YAML source (step 3) is what the compose skill reads to group entities into dashboards downstream. Bootstrap's responsibility ends at producing valid, domain-annotated YAML source.

### 7. Post-run instructions

Tell the user, verbatim:

> Wrote N new YAML source files to `{schema-folder}/`. Open Obsidian → Settings → **BOB Workspace** → click **Regenerate**. The plugin will produce fileClasses, JSON Schemas, and update DATAMODEL.md / DATAMODEL-FULL.md. If regen fails with "Schema validation failed", reply with the error and I will fix the offending YAML.
>
> Your entities now exist but the workspace panel needs a UI. To get one: run the plugin command **"Apply workspace template…"** to drop in a starter layout (CRM / BOB / Cadence / minimal — note this replaces your current `workspace.json`, keeping one rolling `workspace.backup.json`), or use the **[[bob-workspace-compose]]** skill to add/compose dashboards with durable timestamped backups.

### 8. Done When

- Proposal written; user confirmed
- N YAML source files written under the configured schemas folder
- No existing YAML file overwritten
- `workspace.json` NOT touched (UI handed off to [[bob-workspace-compose]] / the plugin's Apply-template command)
- Zero writes outside `{schema-folder}/` and `BOB Workspace/Reports/`
- User clearly told to click Regenerate in plugin settings
