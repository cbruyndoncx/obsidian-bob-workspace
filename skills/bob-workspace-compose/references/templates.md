# Plugin Templates — Reference

The plugin ships four starter workspaces in its install directory. The `create` route can **base** a new template on one of these (read live from the plugin dir, never inlined into this skill, because the plugin regenerates them and any copy would drift) — or build from the vault datamodel. Either way, `create` writes a NEW selectable template file; it does not overwrite the live workspace.

**Location:** `<vault>/.obsidian/plugins/bob-workspace/templates/`

**File stem vs `_template.id`** — these differ. The file name carries a short stem; the `_template.id` *inside* the file (what the switcher keys on) is longer. Always read the real `_template` block; never assume the stem is the id.

| File | `_template.id` (real) | `_template.label` | When to pick it |
|------|-----------------------|-------------------|-----------------|
| `workspace-minimal.json` | `minimal` | Minimal | Blank slate — just Home + Settings + Team. Build navigation/dashboards from scratch with the `add` route. Best for a custom vault that doesn't match BOB's domains. |
| `workspace-crm.json` | `crm-only` | CRM Only | CRM-focused: contacts, companies, deals, activities, pipeline. ~13 dashboards. Best for a sales/relationship vault. |
| `workspace-bob.json` | `bob-workspace` | BOB Workspace | Full BOB: Planner (incl. Ideas) + CRM (incl. Products) + Marketing + PRM + Client Work + Finance (incl. Assets & Close) + Suppliers & Procurement + HR & People + Reports (incl. KPI Scoreboard) + AI Workspace + Research & Knowledge + Operational Audit. 14 nav groups, 22 dashboards. Ships its `_assets` **fully self-seeding**: the canonical schema YAML for every referenced entity (built-ins included — the code defaults are only a lean seed) plus every mapped `.base`, so a fresh vault gets the complete data model + display layer without a manual bootstrap. The canonical full-business workspace. |
| `workspace-cadence.json` | `cadence-classic` | Cadence Classic | BOB + the Cadence operating-rhythm app. ~14 dashboards. Best when the user runs the Cadence weekly/quarterly cadence. (No `entities` block — the plugin now rejects top-level `entities`; record types come from schema YAML.) |
| `workspace-emai.json` | `emai` | EMAI Starter | PARA-style personal workspace (tasks/projects/areas/people/daily, content, workflows). Brings its **own** entity definitions via template `_assets.schemas`, so it does NOT seed the built-in business entities. Best for a personal/PARA vault rather than a business CRM. |

**Maintaining `workspace-bob.json` `_assets` (source-of-truth is the shipped copy).** Because the BOB template now carries the full schema + `.base` asset set, those inlined assets — not the vault — are what a fresh install seeds. When you improve a schema or Base **in a vault** (e.g. the KPI scoreboard), the change only reaches new installs after it is **re-promoted** into the template: copy the updated `00-CORE/Schemas/source/<entity>.yaml` into `_assets.schemas[<entity>]` and the updated `<name>.base` into `_assets.bases[<file>]` in the plugin repo's `templates/workspace-bob.json`, then rebuild `main.js`. `contact` is shipped as `person.yaml` (`SCHEMA_TO_ENTITY_KEY: person → contact`). This is a plugin-repo edit, not a vault compose action — this skill never inlines template bytes (see Gotchas).

**Not workspace templates:** the `templates/client/` subfolder (`project-template/`, `project-template-website/`) holds **note templates** (`.md` project briefs the plugin stamps when creating a project) — NOT `workspace.json` templates. The acceptance set is the five `workspace-*.json` files only; `create` globs `templates/*.json` (one level), so the `client/` subfolder's `.md` files are not picked up as workspace templates.

## How `create` authors a new template

1. Pick a base: read an existing `templates/workspace-<id>.json` from the plugin dir to tailor, or build the config from the vault datamodel (one dashboard per `domain` annotation in `00-CORE/Schemas/source/*.yaml`).
2. Tailor the config — trim/keep `settings.modules`, dashboards, navigation for the user's vault.
3. Wrap the config in a **fresh** `_template` block: a unique `id`, human `label`, one-line `description`, and `order` = max(existing)+1.
4. Hand the result to `safe_write.py` targeting `templates/workspace-<new-id>.json` (validates, backs up any same-named file, writes). The live `workspace.json` is NOT touched.
5. The user then runs Settings → BOB Workspace → "Apply workspace template…" and selects the new label. The *plugin* strips `_template` and writes the live workspace (backing the old one up to a single rolling `workspace.backup.json`).

## Discovering templates at runtime

Templates may be added/renamed by plugin updates. Enumerate them live rather than hardcoding the four names:

```bash
ls "<vault>/.obsidian/plugins/bob-workspace/templates/"*.json
```

Read each file's `_template` block for `id` / `label` / `description` / `order` to present the choice to the user, sorted by `order`.

## Why templates are referenced, not copied

The templates were regenerated by the plugin as recently as the install's own update cycle. Inlining their ~50 KB bodies into this skill would recreate exactly the drift this skill exists to prevent (the same trap as copying `RELEASE-CONFIG.md` include lists). The skill documents each template's **purpose**; the bytes stay in the plugin dir, read fresh on each `create`.
