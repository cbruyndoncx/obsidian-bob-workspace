---
name: bob-workspace-compose
description: "Composes the BOB Workspace plugin UI by authoring its workspace.json — dashboards, widgets, navigation, workbook groups, Base wiring, and settings. Use when the owner says 'add a dashboard to my workspace', 'add a widget to the CRM dashboard', 'set up my BOB Workspace UI from a template', 'create a workspace from the crm template', 'change this widget's source', 'reorder my dashboards', or 'validate my workspace.json'. Sibling to bob-workspace-bootstrap, which owns the datamodel/YAML-source half; this skill owns the UI-composition half."
requires: [none]
version: 0.3.0
category: obsidian
disable-model-invocation: false
user-invocable: true
---

# BOB Workspace Compose

Authors the BOB Workspace plugin's `workspace.json` — the single file that composes the entire visible UI (dashboards, widgets, left-navigation, workbook groups, Base wiring, settings). This skill owns **UI composition**; its sibling [[bob-workspace-bootstrap]] owns the **datamodel** (YAML schema source → fileClasses → JSON Schemas) and writes no `workspace.json` at all — it defers all UI composition to this skill (and the plugin's native `Apply workspace template…` command for whole-template swaps).

## Target Audience

Existing BOB Workspace users (small-business owners, consultants) who have the plugin installed and a datamodel in place, and want to shape what the workspace shows — add a dashboard, drop a widget onto an existing one, author a new selectable layout as a template they can try from the switcher, or tighten an existing layout — without hand-editing an 80 KB+ JSON file and risking a broken panel.

## Capabilities

```yaml
routes:
  - id: create
    label: "Create a selectable workspace template"
    description: "Author a NEW workspace template FILE into the plugin's templates/ folder so the user can select it from Settings → BOB Workspace → 'Apply workspace template…'. Non-destructive: never touches the live workspace.json. Base it on an existing template or on the vault's datamodel. The user applies it from the admin to test it; applying is what replaces the live workspace (plugin backs it up)."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
      - name: label
        type: string
        required: false
        description: "Human label shown in the switcher (prompt if omitted); also drives the file name workspace-<id>.json"
      - name: base
        type: string
        required: false
        description: "What to build from: an existing template file stem (workspace-minimal|crm|bob|cadence.json — note the in-file `_template.id`s differ: minimal / crm-only / bob-workspace / cadence-classic) to tailor, or 'datamodel' to build dashboards from the vault's entities. Always discover templates live via `ls templates/*.json` — never assume the four names."
    outputs:
      - name: workspace-template
        type: file
        format: json
        location: "{vault}/.obsidian/plugins/bob-workspace/templates/workspace-<id>.json"
  - id: add
    label: "Add an element"
    description: "Insert a NEW dashboard, widget, nav item, workbook group, or stat card into an existing workspace.json. Merge-preserving — existing composition is never rewritten."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
      - name: element
        type: string
        required: true
        description: "What to add (dashboard / widget / nav-item / workbook-group / stat-card) and where"
    outputs:
      - name: workspace-config
        type: file
        format: json
        location: "{vault}/.obsidian/plugins/bob-workspace/workspace.json"
  - id: update
    label: "Update an element"
    description: "Modify an EXISTING element — retitle a dashboard, change a widget's source/limit/fields, reorder a layout, toggle a settings.modules flag. Minimal-diff: preserves every key not being changed."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
      - name: target
        type: string
        required: true
        description: "JSON path of the element to change and the requested change"
    outputs:
      - name: workspace-config
        type: file
        format: json
        location: "{vault}/.obsidian/plugins/bob-workspace/workspace.json"
  - id: validate
    label: "Validate workspace.json"
    description: "Read-only full-schema check of all six top-level sections. Reports structural errors (break rendering) and advisory warnings (open-vocabulary). Also runs automatically inside every mutating route."
    inputs:
      - name: vault_path
        type: string
        required: true
        description: "Absolute path to the user's vault root"
    outputs:
      - name: validation-report
        type: stdout
        format: text
        location: "console"
```

## When to Use This Skill

- "Make me a workspace template I can try out from the switcher"
- "Create a CRM-focused layout as a selectable template"
- "Add an HR dashboard showing open candidates"
- "Add a kanban widget to my deals dashboard"
- "Change the deals widget to show only open deals"
- "Add a Finance item to my left navigation"
- "Is my workspace.json valid?"

## Operating Principle

**Two write targets, one safe mutation path.**

- **`create` writes a TEMPLATE FILE** to `<plugin>/templates/workspace-<id>.json` — non-destructive. The plugin's switcher globs that folder and lists every file carrying a `_template` block, so the user selects it from Settings → BOB Workspace → "Apply workspace template…" to test it. The live `workspace.json` is replaced only when the *user applies* the template (the plugin backs it up first). This is the try-before-commit path.
- **`add` / `update` write the LIVE `workspace.json`** in place — surgical, merge-preserving edits the switcher can't do.

Every write — to a template file or the live file — goes through [`scripts/safe_write.py`](scripts/safe_write.py), which **validates the new content, timestamp-backs-up the target, writes atomically, and re-validates on disk**. If validation fails, the target is never touched — a broken compose cannot clobber a working workspace or a good template. The manual `workspace.json.bak-*` files already in the plugin dir are exactly the fragility this replaces.

**Safer than the native switcher for swaps.** The plugin's `Apply workspace template…` keeps only ONE rolling `workspace.backup.json` — apply twice without restoring and the original is gone. So when a user wants to swap layouts safely, the right move is to first capture their current live layout as its own template via `create`, *then* let them apply a different one. compose's own backups are timestamped and permanent.

**Structurally strict, vocabulary enum-permissive.** The validator fails on genuine structural breakage but only warns on open vocabularies (widget `kind`, `accent`, `source` strings) the renderer accepts beyond what is observable in the minified bundle. A checker that false-rejects a config the plugin renders is worse than none.

**Schema-valid is NOT render-safe — the render-safety guard (v0.2.0).** A structurally-valid `workspace.json` can still produce a dead screen in Obsidian. The decisive, config-determinable, NON-recoverable failure mode is an **unreachable nav item**: the plugin's `render()` routes the active nav id (`this.mode`) through a fixed precedence — `dashboards[id]` (or `planner[id]` for a `planner.*` id) → directly-routed surface → `secondaryTabs` parent → `entityKey` list → else `renderComingSoon()` (a dead "coming soon" screen). A nav id matching none of those branches hits the dead screen with **no fallback**, so `validate_workspace.py` now flags it as an **ERROR** (on by default; `--no-render-check` reverts to schema-only). By contrast, an unmapped base-widget `entity` or a `base:{view}` object with no `file` only WARN — the renderer falls back to the built-in `ENTITIES[entityKey].baseView` (the shipped `crm` template renders `base-link` widgets with **zero** `bases{}` mappings), so flagging those hard would false-reject an owner template. `safe_write.py` blocks on errors but **tolerates warnings by default** (the live config legitimately carries warnings); pass `--strict` to also reject warnings.

## Workflow Routing

- `create` → [workflows/create_route.md](workflows/create_route.md)
- `add` → [workflows/add_route.md](workflows/add_route.md)
- `update` → [workflows/update_route.md](workflows/update_route.md)
- `validate` → [workflows/validate_route.md](workflows/validate_route.md)

## Output Format

**`create`** writes a complete template file to `<plugin>/templates/workspace-<id>.json` — a normal workspace config wrapped with a `_template` metadata block the switcher reads:

```json
{
  "_template": {
    "id": "sales-focus",
    "label": "Sales Focus",
    "description": "Pipeline, leads, and activities — no finance or procurement.",
    "order": 5
  },
  "navigation": { "...": "..." },
  "dashboards": { "...": "..." },
  "settings": { "...": "..." }
}
```

**`add` / `update`** write the full live `workspace.json` via `safe_write.py`; the added/changed fragment follows the catalog shapes in [references/widget_catalog.md](references/widget_catalog.md). Example — a new dashboard added under `dashboards`:

```json
{
  "dashboards": {
    "hr.overview": {
      "title": "HR",
      "subtitle": "Hiring pipeline and team overview",
      "stats": [
        { "label": "OPEN CANDIDATES", "entity": "candidate", "count": "open", "accent": "sky" }
      ],
      "layout": [
        [
          { "title": "OPEN CANDIDATES", "empty": "No open candidates.",
            "entity": "candidate", "source": "recent-open",
            "titleFields": ["candidate_name", "title"],
            "metaFields": ["status", "role", "region"] }
        ]
      ]
    }
  }
}
```

`safe_write.py` prints the backup path and a post-write validation status:

```
Backed up: .../workspace.json.bak-compose-20260607-101530
Wrote .../workspace.json — post-write check: VALID
```

## When to Use Each Route

| Situation | Route |
|-----------|-------|
| Author a new selectable layout to try from the switcher (non-destructive) | `create` |
| Capture the current live layout as a named template before swapping | `create` (base on the live file) |
| Add a new dashboard / widget / nav item / workbook group / stat card to the live workspace | `add` |
| Change an existing element (title, source, fields, order, module flag) in the live workspace | `update` |
| "Is my workspace.json valid?" / pre-edit safety check | `validate` |

## Gotchas

- **`create` makes a template, not a live workspace.** A new template file does nothing visible until the user opens Settings → BOB Workspace → "Apply workspace template…" and selects it. Always end a `create` run by telling the user that exact path — otherwise they author a file and see no change and assume it failed.
- **A template file MUST carry a `_template` block.** The switcher (`loadWorkspaceTemplates`) only lists `templates/*.json` files that have a `_template` key (with `id`/`label`/`description`/`order`). Omit it and the file is invisible in the admin. Pick `order` = max(existing)+1 so it sorts last.
- **Applying a template uses ONE rolling backup.** The plugin copies the live `workspace.json` to a single `workspace.backup.json` on apply, overwritten every switch. Switching twice without restoring loses the original. Before a user applies a new template over a hand-tuned layout, offer to capture the current layout as its own template first (`create` on the live file).
- **⚠️ SWITCHING to a different template archives the outgoing template's schemas + bases; only bases don't auto-regenerate.** Corrected against the plugin source (`workspace-templates.ts` `applyWorkspaceTemplate`/`archiveTemplateAssets`): the archive runs **only when switching** — i.e. `settings.activeWorkspaceTemplate` is set AND differs from the template being applied. It moves the outgoing template's schema source, derived `fileClasses`/`json-schema`, and `.base` files into sibling `…-archive-<prevKey>-<ts>/` folders. **It does NOT fire on a first install** (no previously-active template) and **does NOT fire when re-applying the same template** — those are safe. On a switch, **schemas DO regenerate automatically** (`regenerateSchemaOutputs` runs after apply); the only thing not auto-restored is `.base` files. So the accurate warning is: *before switching templates*, expect to restore/re-generate **bases** afterward — `uv run scripts/recover_after_apply.py --vault .` (restores Bases from the newest archive; also re-generates Schemas defensively) or re-run [[bob-workspace-bootstrap]] + "Generate missing bases". A first-time apply on a fresh vault needs none of this. (Historical note: the "emptied 91 bases + all schemas" incident on 2026-06-17 was a template *switch*; schemas have since been confirmed to regenerate on switch, so the residual gap is bases only.)
- **Don't overwrite the four built-in templates.** `workspace-{bob,cadence,crm,minimal}.json` are plugin-owned and regenerated on plugin update. A custom layout gets a new file name; never target a built-in.
- **Plugin must be installed.** This skill writes a config the BOB Workspace plugin reads. If the plugin isn't installed/enabled, the file sits dormant and the user sees no UI change — check `.obsidian/plugins/bob-workspace/` exists before composing, and tell the user to reload the panel after a live (`add`/`update`) write.
- **`entity` must match a schema source / fileClass.** A widget whose `entity` has no backing datamodel renders empty (or nothing). Composition assumes the datamodel exists — if the entity is missing, route the user to [[bob-workspace-bootstrap]] first; do not invent schema here.
- **`source` is a string OR an object.** The old bootstrap validator hardcoded a flat string set that was both dead code and already wrong (`recent` wasn't in it). 62 of the live config's sources are objects (`{mode:"built-in",...}` or `{source,filters}`). Never assume `source` is a string — handle both forms.
- **The `planner` dashboard is special.** It has no `title` or `layout` — it's a built-in renderer keyed inside `dashboards`. Requiring title/layout on it would false-reject every known-good file. The validator exempts it (and any dashboard with a `kind`). Note the nav surfaces are `planner.today`/`planner.inbox`/`planner.calendar`/`planner.projects` — a nav item with `id: "planner"` renders "coming soon".
- **A nav item only renders real content if its `id` resolves through one of the renderer's dispatch branches — otherwise it shows a dead "coming soon" screen.** Reachable ids: (1) a key in `dashboards{}` (or `planner{}` for a `planner.*` id — a `dashboards["planner.*"]` entry is migrated into `planner` on load); (2) a directly-routed surface id (`home`, `crm.dashboard`, `crm.pipeline`, `reports.*`, `client-work.overview`, … — the narrow list in [references/workspace_schema.md](references/workspace_schema.md); note the entity surfaces like `crm.contacts`/`finance.invoices` are NOT here — they route via their `entityKey`/`secondaryTabs`); (3) a `navigation.secondaryTabs` parent; (4) any item carrying an `entityKey`. A free-form id matching NONE of those is the #1 nav authoring mistake and a genuine non-render bug — the render-safety guard in `validate_workspace.py` now catches it as an ERROR (it does NOT show in schema-only validation). Note: a free-form id that DOES have a matching `dashboards{}` entry IS reachable (that is why the live config's `workspace.base-links` nav id is fine) — though without a `BUILT_SURFACES`/`entityKey` match it still wears a cosmetic `soon` badge. To surface your own entities, prefer `entityKey` nav items or `secondaryTabs` parents.
- **List widgets accept a CLOSED set of `source` strings; anything else renders empty.** A record-list widget handles `recent` / `recent-open` / `due` / `due-open` / `base|table|list|entity` only — `all`, `recent-all`, `due-soon`, `overdue` return `[]`. `all` is a STAT-CARD value, not a list source. For "show all records" on a list, use `recent`. Using `all` is the classic "all my panels are empty" bug.
- **Read-only dashboards can't create records.** A dashboard of only list/base widgets gives the user no way to add data. Include a `kind: actions` widget (`quick-capture` + `entityKey` buttons), or surface entities via `entityKey`/`secondaryTabs` views, which carry their own `+ New <entity>` button.
- **`base-embed`/`base-link` resolve the file from `bases{}`, and `view` is a top-level STRING.** Writing `"base": {"view": "X"}` (object, no `file`) makes the resolver stringify it to `"[object Object]"` as the path → garbled text + "base not found". Pass `"view": "X"` and ensure the widget's `entity` has a `bases{}[entity] = {"file": "…"}` mapping, or pass the full `"base": {"file": "…", "view": "X"}`. The base mapping is read from the top-level `bases{}` (preferred) or `settings.baseFiles{}` — the default `settings.baseFiles` points at brncx `00-CORE/Bases/*` paths, so a non-brncx vault MUST set its own mapping.
- **Templates drift if copied.** The four templates are plugin-owned and regenerated by plugin updates. The `create` route reads them live from the plugin dir — never inline their bytes into this skill, or you rebuild the drift this skill exists to prevent.
- **Renaming a dashboard id dangles references.** The dashboard key is its identity; nav items and pinned surfaces reference it. Changing `title` (display) is safe; changing the key requires updating every reference in the same write. Prefer title changes unless an id rename is the explicit goal.
- **Nav items hide behind disabled modules.** A nav item bound to a `module` that's off in `settings.modules` won't appear. Adding nav for a new module means enabling the module too.
- **Don't touch the regen pipeline.** `workspace.json` is plugin config, not vault-note frontmatter. Never wire it into `00-CORE/Schemas/regenerate.py` (that system is driven by DATAMODEL-FULL for note entities) — the skill-local JSON Schema is the correct and only home.

## Verification

1. **Preflight token before any mutation**: confirm the current `workspace.json` was read and the specific change target was echoed to the user before any call to `safe_write.py`. No blind writes.
2. **New content validates before the target is touched**: `safe_write.py` validates a temp copy first; a failing validation aborts with the target untouched. Confirm the run reported `post-write check: VALID`.
3. **Timestamped backup exists**: after any mutating route, confirm a `workspace.json.bak-compose-<ts>` was written (unless `--no-backup` was explicitly requested).
4. **Acceptance contract holds**: `scripts/validate_workspace.py` (render guard ON) reports 0 errors on the live file AND all bundled templates. Re-run the regression loop in [workflows/validate_route.md](workflows/validate_route.md) after any validator change.
5. **Render-safety regression**: `scripts/validate_workspace.py examples/regression_unreachable_nav.json` must report exactly **1 error** (the unreachable nav item) and exit 1; the same file with `--no-render-check` must be VALID and exit 0 — proving the guard catches a non-rendering config that schema validity alone passes.
6. **Render guard catches dead nav before write**: confirm any composed nav item's `id` resolves through a dispatch branch (directly-routed surface / `dashboards`|`planner` key / `secondaryTabs` parent / `entityKey`). `safe_write.py` aborts on a render error, leaving the target untouched.
7. **Merge-preserving**: for `add`/`update`, diff the new file against the backup — only the intended key changed; no sibling dashboard, nav group, or setting was rewritten or reordered.

## Done When

- The requested template was authored (`create`), element added/updated (`add`/`update`), or the validation report was produced (`validate`)
- The write went through `safe_write.py` (validated → backed up → written → re-validated) — never a raw write
- The written file remains valid (0 errors) after the change
- For `add`/`update`: no existing composition was rewritten, reordered, or dropped except the explicit target; the user was told to reload the BOB Workspace panel
- For `create`: the live `workspace.json` was NOT touched; the user was told to apply the new template via Settings → BOB Workspace → "Apply workspace template…" and warned that applying overwrites the live workspace (single rolling backup)

## Constraints

- MUST NOT write `workspace.json` by any path other than `scripts/safe_write.py` — raw writes skip the validate-and-backup gate, and a malformed 80 KB file reaching disk blanks the user's entire workspace UI
- MUST NOT rewrite, reorder, or drop existing dashboards, nav groups, widgets, or settings when adding or updating one element — users lose trust when a small change churns composition they carefully built, and reordering breaks id references
- MUST NOT lock open vocabularies (widget `kind`, `accent`, `source` strings) as hard validation failures — the renderer accepts values not enumerable from the minified bundle, so a strict enum false-rejects working configs (the exact bug in the old bootstrap validator)
- MUST NOT inline plugin template bodies into this skill — templates are plugin-owned and regenerated on update; copies drift silently and ship stale UI
- MUST NOT invent `entity` names, dashboard ids, or field names the vault datamodel does not define — a widget pointing at a non-existent entity renders empty and looks broken
- **Scope boundary**: this skill composes `workspace.json` only — it does NOT generate YAML schema source, fileClasses, JSON Schemas, or DATAMODEL sections (that is [[bob-workspace-bootstrap]]), does NOT author `.base` files (that is [[obsidian-bases]]), does NOT diagnose UI coverage gaps (that is bootstrap's `diagnose` route), and does NOT migrate notes or install the plugin
- **Safety note**: for `add`/`update`, MUST read the current `workspace.json` and echo the change target back to the user before any mutation. `create` MUST NOT write the live `workspace.json` at all — it writes a template file to `templates/`; if a same-named template already exists, MUST confirm before overwriting it. MUST warn the user that *applying* a template (their action in the admin) replaces the live workspace with only a single rolling backup
- **Technical**: `create` MUST write to `<plugin>/templates/workspace-<id>.json` with a `_template` block (`id`/`label`/`description`/`order`) and MUST NOT target the live `workspace.json` or any of the four built-in templates — a missing `_template` block makes the file invisible to the switcher; targeting a built-in clobbers a plugin-owned file regenerated on update
- **Technical**: every write MUST keep `validate_workspace.py` at 0 errors against the live file and all four plugin templates — that union is the objective acceptance test; an error there means the change (or the validator) is wrong
- **Technical**: `source` MUST be handled as `string | object` everywhere it is read or written — assuming a string form corrupts built-in (`{mode:"built-in"}`) and filtered (`{source,filters}`) widgets
- **Technical**: dashboard ids and nav-item ids are identity keys — renaming one MUST update every referencing nav item / pinned surface in the same write, or the reference dangles
- **Technical**: every nav item's `id` MUST resolve through a render dispatch branch — a key in `dashboards{}` (or `planner{}` for a `planner.*` id), a directly-routed surface id, a `secondaryTabs` parent, or an `entityKey` — or it renders a dead "coming soon" screen with no fallback (the render-safety guard rejects this). Also: every nav item needs BOTH `id` and `label`, or the plugin rejects the whole `workspace.json` at load. A free-form id WITH a matching `dashboards{}` entry is reachable (renders, but wears a cosmetic `soon` badge); to surface your own entities idiomatically prefer `entityKey` items or `secondaryTabs`
- **Technical**: a record-list widget's `source` MUST be one of `recent` / `recent-open` / `due` / `due-open` / `base|table|list|entity` (or an object form) — `all` / `recent-all` / `due-soon` / `overdue` make the list render empty; `all` is a stat-card-only value, so default list widgets to `recent`

## Route Done When

| Route | Acceptance Criteria |
|-------|--------------------|
| `create` | Plugin presence confirmed; base chosen (existing template or vault datamodel); unique `id`/`label`/`description`/`order` set; full config wrapped with a `_template` block; written to `templates/workspace-<id>.json` via `safe_write.py` with `post-write check: VALID`; live `workspace.json` untouched; user told to apply it via Settings → BOB Workspace → "Apply workspace template…" and warned that applying replaces the live workspace (single rolling backup). |
| `add` | Current file read; insertion target confirmed; new element authored from catalog shapes; inserted additively (no sibling touched); full dict written via `safe_write.py`; validator 0 errors; user told to reload. |
| `update` | Current file read; exact element located by path and its current value echoed; only requested keys changed (all others preserved verbatim); shape re-checked against catalog; written via `safe_write.py`; validator 0 errors. |
| `validate` | `validate_workspace.py` run against the target; errors reported first with JSON paths + fixes, then warnings; zero files written; acceptance contract (0 errors on live + all bundled templates) stated. |

## Related Skills

- [[bob-workspace-bootstrap]] — sibling skill that owns the datamodel half (YAML schema source → fileClasses → JSON Schemas → DATAMODEL); run it first if a needed `entity` has no schema. Its older baseline-only schema reference is superseded by this skill's full schema.
- [[obsidian-bases]] — authors the `.base` files that `base-link` / `base-embed` widgets and the `bases` section point at; read before wiring any Base.
- [[bob-workspace-screenshots]] — recaptures plugin UI screenshots after composition changes.
- [[vault-validator]] — validates vault-note frontmatter (a separate concern from this plugin config).
- [[obsidian-plugin-manager]] — install/enable the BOB Workspace plugin if it is missing.

## References

- [references/reference.md](references/reference.md) — reference catalog
- [references/workspace_schema.md](references/workspace_schema.md) — the six top-level sections, annotated (primary reference)
- [references/widget_catalog.md](references/widget_catalog.md) — all widget kinds (19: read-only + interactive) + stat cards + source forms, with verbatim examples
- [references/templates.md](references/templates.md) — the four plugin templates (file stem vs real `_template.id`) and when to pick each
- [references/workspace.schema.json](references/workspace.schema.json) — machine-checkable JSON Schema (the formal contract)
- [examples/regression_unreachable_nav.json](examples/regression_unreachable_nav.json) — render-safety regression fixture: structurally valid but non-rendering (unreachable nav item); the guard rejects it, `--no-render-check` passes it

## Quality Gate

**Rubric:** `utility-skill.md`
**Approval Tier:** 2 (Peer)
