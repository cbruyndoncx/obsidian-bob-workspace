---
name: bob-workspace-bootstrap
description: "Bootstraps the BOB Workspace plugin datamodel by scanning vault templates and frontmatter and writing canonical YAML schema source files to 00-CORE/Schemas/source/. The plugin's own 'Regenerate' settings button then produces fileClasses, JSON Schemas, and DATAMODEL.md / DATAMODEL-FULL.md sections. Use when the owner says 'set up BOB Workspace datamodel on my vault', 'generate schema source from my frontmatter', 'I have an Obsidian vault — make BOB work on it', 'audit my workspace coverage', or 'diagnose what BOB is missing'."
requires: [none]
version: 2.3.0
category: obsidian
disable-model-invocation: false
user-invocable: true
---

# BOB Workspace Bootstrap

Writes canonical YAML schema source files to `00-CORE/Schemas/source/` based on what the vault already contains (templates + frontmatter census). The BOB Workspace plugin's settings UI then takes those YAML files and regenerates fileClasses, JSON Schemas, and DATAMODEL sections via its built-in `regenerateSchemaOutputs` pipeline. This skill is the upstream half — the plugin owns the downstream half.

## Target Audience

Existing Obsidian users who already have a vault with templates and/or `type:` frontmatter values declared, and who want the BOB Workspace plugin UI to show their data without manually authoring fileClasses or `workspace.json` from scratch. Typical user: a small-business owner or consultant adopting BOB who refuses to migrate into an empty vault.

## Capabilities

```yaml
routes:
  - id: minimum
    label: "Minimum bootstrap"
    description: "Census the vault, propose YAML source files for each detected entity (≥3 notes), and on confirmation write them to 00-CORE/Schemas/source/. User then opens BOB Workspace plugin settings and clicks 'Regenerate' to produce fileClasses + JSON Schemas + DATAMODEL sections. First-pass default."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
      - name: templates_path
        type: string
        required: false
        description: "Path to existing templates folder; auto-detected if omitted"
    outputs:
      - name: yaml-source
        type: directory
        location: "{vault}/00-CORE/Schemas/source/"
      - name: proposal-report
        type: file
        format: markdown
        location: "{vault}/99-TMP/OUTPUT/bob-workspace-bootstrap-proposal.md"

  - id: guided-optimize
    label: "Guided optimization"
    description: "Conversational second pass after the user has clicked 'Regenerate' once. Walks per-domain-then-per-entity, proposing field expansions and enum tightening based on observed values. Writes updates to YAML source only; user clicks 'Regenerate' again to apply."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root (minimum route must have run first)"
    outputs:
      - name: updated-yaml-source
        type: directory
        location: "{vault}/00-CORE/Schemas/source/"

  - id: extend
    label: "Extend partial setup"
    description: "Vault already has YAML source files for some entities. Detect what exists, preserve verbatim, and add new YAML sources only for uncovered entity types. User clicks 'Regenerate' to apply."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
    outputs:
      - name: merge-report
        type: file
        format: markdown
        location: "{vault}/99-TMP/OUTPUT/bob-workspace-bootstrap-merge.md"
      - name: added-yaml-source
        type: directory
        location: "{vault}/00-CORE/Schemas/source/"

  - id: dry-run
    label: "Dry-run proposal"
    description: "Run all detection passes and produce the full proposal report without writing any config files to the vault. Orthogonal flag; combinable with any other route."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
      - name: base_route
        type: string
        required: false
        description: "Which route's proposal to render (minimum | extend); defaults to minimum"
    outputs:
      - name: proposal-report
        type: file
        format: markdown
        location: "{vault}/99-TMP/OUTPUT/bob-workspace-bootstrap-dryrun.md"

  - id: bases
    label: "Generate Bases for entities"
    description: "Read existing YAML source files and generate one .base file per entity under 00-CORE/Bases/. Follows the obsidian-bases skill conventions (filters by type, primary field as title, formulas for open-link, single table view). Use after `minimum` or `extend` route to materialize table/grid views for the new entities."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
      - name: entities
        type: array
        required: false
        description: "Explicit list of entity slugs to generate Bases for; if omitted, generates for all YAML source files lacking a matching .base"
    outputs:
      - name: bases
        type: directory
        location: "{vault}/00-CORE/Bases/"

  - id: diagnose
    label: "UI coverage diagnostic"
    description: "Read-only audit comparing vault reality to current BOB Workspace UI state. Surfaces entities present in the vault but missing from workspace.json, UI entries with no underlying data, field-level fileClass drift, domain orphans, and out-of-range status values. Priority-tiered report (P1/P2/P3). No writes."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
    outputs:
      - name: diagnostic-report
        type: file
        format: markdown
        location: "{vault}/99-TMP/OUTPUT/bob-workspace-diagnose-{date}.md"
```

## When to Use This Skill

- "Set up BOB Workspace on my existing vault"
- "I have an Obsidian vault with templates already — make BOB work on it"
- "Generate fileClasses from my current frontmatter"
- "Audit my workspace coverage" / "diagnose what BOB is missing"

(For "configure the workspace UI", "add a dashboard", or "bootstrap workspace.json" → that is [[bob-workspace-compose]], not this skill.)

## Operating Principle

**Write YAML source only — the datamodel half.** This skill writes one thing: canonical YAML schema source at `00-CORE/Schemas/source/*.yaml`, consumed by the plugin's `regenerateSchemaOutputs` (which produces fileClasses, JSON Schemas, and DATAMODEL.md / DATAMODEL-FULL.md sections — this skill must NEVER write those directly).

**It does NOT write `workspace.json`.** UI composition is owned by the sibling [[bob-workspace-compose]] skill and the plugin's native `Apply workspace template…` command. Both back up and replace the single live `workspace.json`; a second writer here (with no shared backup) would race them and risk clobbering a hand-tuned layout. Each YAML source carries a `domain` annotation so compose can group entities into dashboards downstream.

Sequence for a visible UI: YAML written here → user clicks **Regenerate** in plugin settings → fileClasses + schemas + DATAMODEL appear → user gets a UI via `Apply workspace template…` or [[bob-workspace-compose]].

## Workflow Routing

- `minimum` → [workflows/minimum_route.md](workflows/minimum_route.md)
- `guided-optimize` → [workflows/guided_optimize_route.md](workflows/guided_optimize_route.md)
- `extend` → [workflows/extend_route.md](workflows/extend_route.md)
- `dry-run` → [workflows/dry_run_route.md](workflows/dry_run_route.md)
- `diagnose` → [workflows/diagnose_route.md](workflows/diagnose_route.md)
- `bases` → [workflows/bases_route.md](workflows/bases_route.md)

## Output Format

### Minimum route — YAML source file per entity

The canonical shape the plugin's `loadCanonicalSchemaSources` accepts:

```yaml
entity: client                 # REQUIRED — filename slug, no extension
label: Client                  # REQUIRED — display label
location_pattern: 30-CLIENTS   # REQUIRED — folder the entity's notes live in
type_value: client             # REQUIRED unless the entity is filename-backed —
                               #   the frontmatter `type:` value the notes carry
key_fields: [client_id]        # first entry becomes the primary (display/title/basename) field
fields:
  - name: client_id
    type: string
    required: true
  - name: status
    type: string
    enum: [prospect, active, inactive, completed]
  - name: created
    type: string
    format: date               # maps the field to the plugin's `date` UI type
  - name: tags
    type: array
```

`validateSourceSchemaDefinition` **requires** `entity`, `label`, `location_pattern`,
≥1 field, and `type_value` (unless the entity is filename-backed). Field `type`
accepts `string | number | integer | boolean | array` (there is **no `date`
type** — use `type: string` + `format: date`, which the plugin's field-type
mapper reads to render a date field). Use `enum: [...]` for Select fields. Always
set `key_fields` (or mark a field `primary: true`) to a real name/title field —
otherwise the first field becomes the display/basename, which can make `status`
the title by accident.

The validator also checks (beyond the field-type set): no duplicate field names;
every `key_fields` entry is a defined field; a field `default` is one of its
`enum` options and matches its type; `co_required` and `field_aliases` conflicts.
It does **not** validate `format` values — an unrecognized `format` is ignored,
not rejected (only `date`/`date-time`/`email` are mapped to UI types).

### Minimum route — proposal report

```markdown
---
type: research
research_type: bootstrap-proposal
research_date: 2026-05-29
status: draft
---

# BOB Workspace Bootstrap — Proposal

## Detected entity types (8 above ≥3-note threshold)
| type | count | dominant folder | enum candidates |
|------|-------|-----------------|-----------------|
| client | 23 | 30-CLIENTS/{id}/ | status (4 values) |
| deal | 47 | 30-CLIENTS/{id}/01-DEALS/ | stage (6 values) |
...

## Files to be written
- 00-CORE/Schemas/source/client.yaml (new)
- 00-CORE/Schemas/source/deal.yaml (new)
...

## Next step after confirmation
Open Obsidian → Settings → BOB Workspace → click "Regenerate". The plugin produces fileClasses, JSON Schemas, and DATAMODEL sections.
```

## When to Use Each Route

| Situation | Route |
|-----------|-------|
| Fresh user, vault has no BOB config | `minimum` |
| Minimum already ran, ready to tailor UI | `guided-optimize` |
| Vault has partial BOB config or hand-built fileClasses | `extend` |
| Want to preview without writing | `dry-run` |
| "What's missing from my workspace UI?" / coverage audit | `diagnose` |
| "Generate Bases for the new entities" | `bases` |

## Domain Detection

Folder structure annotates each entity's `domain` field in YAML source for downstream `workspace.json` composition (handled by a separate `bob-workspace-compose` skill, not by this one). See [references/domain_detection.md](references/domain_detection.md) for the folder-to-domain table.

This skill itself does NOT generate `workspace.json` — composition is a separate concern.

## Detection Passes

1. **Template scan** — read templates folder, extract each template's frontmatter shape (fields, defaults, inferred types).
2. **Frontmatter census** — scan all notes, group by `type:`, infer field inventory and per-field value distribution (string / number / date / enum / array / wikilink).
3. **Existing fileClass scan** — read `<vault>/.obsidian/plugins/metadata-menu/fileClasses/` (or configured path); merge as authoritative for declared fields.
4. **Path-pattern mining** — for each `type:`, identify dominant folder pattern → default-path lookup.

## Gotchas

- **Plugin owns the downstream pipeline**: do NOT write fileClasses, JSON Schemas, or DATAMODEL.md sections directly. The plugin's `regenerateSchemaOutputs` reads YAML source and produces all three. Writing them ourselves creates competing artifacts that drift the moment the user clicks "Regenerate."
- **YAML source folder is configurable**: the plugin reads it from **`workspace.json`** — top-level `schemas.folder` (which takes precedence), else `settings.schemasFolder` (default `00-CORE/Schemas/source`). Read `<vault>/.obsidian/plugins/bob-workspace/workspace.json`, NOT `data.json` — `schemasFolder`/`useSchemas` are workspace-owned settings and are stripped out of `data.json`. Assuming the default risks writing to the wrong place.
- **Templates folder location varies**: not every vault uses `00-CORE/Templates/`. Read `<vault>/.obsidian/templates.json` and `<vault>/.obsidian/plugins/templater-obsidian/data.json` to find the real path. Hardcoded paths miss user-relocated templates entirely.
- **Untyped notes inflate the census**: many vaults have hundreds of free-form notes without `type:` frontmatter. Filter the census to notes with a declared `type:` before inferring entities, or the field distribution gets polluted by daily-note prose.
- **Single-occurrence types are noise**: a `type:` value on only 1–2 notes is usually a typo or one-off. Threshold at 3+ before generating YAML; surface lower-count types in the proposal for user resolution. Avoids regenerating 100+ orphan fileClasses for skill-name `type:` drift.
- **Enum inference needs sampling**: distinct/total ratio < 0.15 AND distinct count ≤ 12 → propose `enum: [...]` in YAML. Otherwise free-text. Wrong inference forces dropdowns onto fields like `title:`.
- **Existing YAML source is authoritative**: if a `00-CORE/Schemas/source/{entity}.yaml` already exists, NEVER overwrite. Merge-as-additive: preserve all existing fields and constraints; add only new fields. The plugin will fail-fast on `validateSourceSchemaDefinition` errors; overwriting silently corrupts validation.
- **`type_value` vs `entity`**: when the entity slug (filename) differs from the `type:` frontmatter value (e.g. `entity: corporate-tax` but `type_value: ct-return`), MUST set `type_value` explicitly. Otherwise the generated JSON Schema's `type` constraint won't match observed notes.
- **Plugin must be installed for the chain to complete**: this skill writes YAML; the regen step requires the BOB Workspace plugin loaded in Obsidian. If the plugin isn't installed, the YAML sits dormant and the user sees no UI change — surface a clear post-run instruction telling them to install/enable the plugin first.
- **Don't backfill frontmatter on existing notes**: when YAML adds a new field, do NOT touch existing notes to add the field. Schema definition only; backfill is a separate skill ([[obsidian-ops]]).
- **Alias detection must use `type_value`, not `entity`**: when scanning existing notes to flag "alias" types that need renaming, compare against `type_value` from the YAML source — not the `entity:` field or the filename slug. `entity: chart-of-accounts` with `type_value: coa-account` means notes with `type: coa-account` are already canonical; proposing to rename them to `chart-of-accounts` would break JSON Schema validation on every note touched. The `entity:` slug is the internal key; `type_value` is the frontmatter contract.

## Verification

1. **Preflight token emitted before any mutation**: confirm the proposal report was generated and presented to the user, and explicit confirmation was logged, before any write to `00-CORE/Schemas/source/`.
2. **YAML source validates against plugin's parser**: each generated `*.yaml` must satisfy `validateSourceSchemaDefinition` — `entity`, `label`, `location_pattern` present; `type_value` present unless filename-backed; ≥1 field; field `type` in [string|number|integer|boolean|array]; no duplicate field names; every `key_fields` entry a defined field; any field `default` in its `enum` and of matching type. (`format` is NOT validated — it's read for date/email UI mapping only.) Open one YAML file and visually confirm against the canonical shape.
3. **Plugin "Regenerate" succeeds**: after the skill runs, user clicks Settings → BOB Workspace → Regenerate. Expected: `count > 0`, `datamodelUpdated >= 1`, no error notice. A failed regen means YAML is malformed — fix and retry, do NOT write the downstream artifacts manually.
4. **No existing YAML source overwritten**: diff each touched file. Existing fields must retain their type, required, enum verbatim. New fields appear only as additions.
5. **Per-domain pacing in guided-optimize**: confirm completion state log shows all entities in domain N closed before any entity in domain N+1 is touched.
6. **Dry-run and diagnose never write**: when those routes run, verify zero files outside `99-TMP/OUTPUT/`.

## Done When

- Minimum route produces YAML source files that pass the plugin's `validateSourceSchemaDefinition`
- After the user clicks "Regenerate" in plugin settings, fileClasses + JSON Schemas + DATAMODEL sections appear with no validation errors
- Guided-optimize walks per-domain-then-per-entity with no cross-domain interleaving
- No file outside `00-CORE/Schemas/source/` (writes) or `99-TMP/OUTPUT/` (reports) touched
- No existing YAML source content overwritten
## Constraints

- MUST NOT write fileClasses, JSON Schemas, DATAMODEL.md sections, or DATAMODEL-FULL.md sections directly — the BOB Workspace plugin's `regenerateSchemaOutputs` owns those files; competing writes create drift and break round-trips through the plugin's settings UI
- MUST NOT write any YAML source file before the proposal report is generated and the user confirms — silent writes break the trust contract; the proposal-then-confirm gate is the safety mechanism that lets a user back out
- MUST NOT overwrite existing `00-CORE/Schemas/source/*.yaml` files; merge-as-additive only — overwriting destroys hand-authored or previously-approved schemas the user may not remember
- MUST NOT cross domains in `guided-optimize` before the current domain's entities are all finalized — the navigation-group payoff only materializes when a domain completes; cross-domain interleaving produces a confusing partial state
- MUST NOT write or merge `workspace.json` in any route — UI composition is owned by [[bob-workspace-compose]] and the plugin's native `Apply workspace template…` command; a second writer here shares no backup with them and can clobber a hand-tuned layout
- MUST NOT bulk-backfill new frontmatter fields onto existing notes — YAML schema additions only; backfill is a separate skill ([[obsidian-ops]])
- **Scope boundary**: this skill writes YAML source files only — it does NOT regenerate fileClasses, write workspace.json, migrate notes, rename folders, change `type:` values, or install plugins; the user invokes the plugin's "Regenerate" button to complete the chain
- **Safety note**: MUST present the proposal report and a one-line "next step: click Regenerate in plugin settings" instruction to the user before writing any YAML — silent writes followed by silent regens are debugging hell when something goes wrong
- **Technical**: every generated YAML MUST satisfy the plugin's `validateSourceSchemaDefinition` — a missing `entity`/`label`/`location_pattern` (or `type_value` on a non-filename entity), zero fields, a field `type` outside `[string, number, integer, boolean, array]`, a duplicate field name, a `key_fields` entry that isn't a defined field, or a `default` not in its `enum` will fail regen with a schema error and abort. (`format` is not validated.)
- **Technical**: YAML generation MUST go through `scripts/generate_yaml.py` (not hand-rolled inline) — the script dedupes field names so baseline fields (`status`, `created`) don't collide with observed enum fields; inline generation hit this bug in v2.x and broke plugin Regenerate
- **Technical**: enum inference MUST use distinct/total ratio (< 0.15) + max-cardinality cap (≤ 12) — naive "every unique value is an enum" forces dropdowns on free-text fields like `title:`

## Route Done When

| Route | Acceptance Criteria |
|-------|--------------------|
| `minimum` | Proposal report written; user confirmed; YAML source files written under `00-CORE/Schemas/source/` (domain-annotated); `workspace.json` NOT touched; user told to (1) open Settings → BOB Workspace → Regenerate, then (2) get a UI via the plugin's `Apply workspace template…` command or [[bob-workspace-compose]]. |
| `guided-optimize` | Each domain processed in order; per-entity decisions (field expansion, enum tightening) recorded into existing YAML source files via merge-as-additive; domain marked complete before next domain begins; user reminded to click Regenerate after each domain. |
| `extend` | Existing YAML source detected and preserved verbatim; merge report shows added vs preserved; new YAML files written only for uncovered entity types; user told to click Regenerate. |
| `dry-run` | Full detection passes complete; proposal report written to `99-TMP/OUTPUT/`; zero files written under `00-CORE/Schemas/`. |
| `diagnose` | Gap report written with all seven gap categories assessed; each finding tagged P1/P2/P3; zero files written outside `99-TMP/OUTPUT/`; report ends with concrete remediation per finding (run `extend` / edit fileClass / etc.). |
| `bases` | One `.base` file per requested entity written under `00-CORE/Bases/`; existing `.base` files preserved; follows `obsidian-bases` conventions (filter on note.type, properties keyed on YAML fields, single default table view); user can open and refine in Obsidian. |

## Related Skills

- [[vault-upgrade]] — sibling skill for vaults already on the brncx datamodel; this skill is the on-ramp for vaults that are not
- [[bob-workspace-screenshots]] — generates demo screenshots of the plugin (consumes outputs from this skill)
- [[vault-validator]] — validates frontmatter against generated JSON schemas after bootstrap
- [[obsidian-bases]] — used inside `guided-optimize` route to author `.base` files; read before generating any Base
- [[obsidian-ops]] — for ongoing vault maintenance after bootstrap

## Scripts

All scripts run via `uv run` (PEP 723 inline metadata). Verify each route's output as described in [Verification](#verification) before reporting done.

| Script | Used by | Purpose |
|--------|---------|---------|
| `scripts/template_scan.py` | `minimum`, `dry-run` | Read the templates folder and extract each template's frontmatter shape (fields, defaults, inferred types). |
| `scripts/frontmatter_census.py` | `minimum`, `extend`, `dry-run` | Scan all notes, group by `type:`, infer field inventory and per-field value distribution (enum / date / array detection). |
| `scripts/generate_yaml.py` | `minimum`, `extend` | Write a canonical YAML source file for one entity — baseline-field injection, observed-field merge, field-name dedup. The only sanctioned YAML writer (never hand-roll the field list). |
| `scripts/extend.py` | `extend` | Detect coverage gaps (vault entities vs existing YAML source) and write YAML for uncovered entities only; refuses to overwrite existing YAML. Does NOT touch `workspace.json`. |
| `scripts/guided_optimize.py` | `guided-optimize` | Drive the per-domain-then-per-entity optimization pass (field expansion, enum tightening) as merge-as-additive updates to existing YAML source. |
| `scripts/diagnose.py` | `diagnose` | Read-only audit comparing vault reality to current `workspace.json` UI state; emits a priority-tiered gap report. No writes. |

## References

- [reference.md](references/reference.md) — reference catalog
- [yaml_source_schema.md](references/yaml_source_schema.md) — canonical YAML source shape the plugin parses (primary reference for this skill's output)
- [domain_detection.md](references/domain_detection.md) — folder-to-domain mapping (annotation, not for workspace.json composition)
- [fileclass_format.md](references/fileclass_format.md) — explains why fileClasses are plugin-generated, not written by this skill
- [workspace_json_schema.md](references/workspace_json_schema.md) — legacy/baseline workspace.json notes; superseded by [[bob-workspace-compose]], which owns the authoritative schema. This skill does not write workspace.json — see that skill for UI composition.

## Quality Gate

**Rubric:** `utility-skill.md`
**Approval Tier:** 2 (Peer)

