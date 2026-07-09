# Installing BOB Workspace into an existing vault (that already has notes)

This is the authoritative sequence for turning an Obsidian vault that already
contains notes into a working BOB Workspace, derived from the plugin's actual
startup and configuration code (not aspirational). It complements the
"Preparing an empty-vault workspace" section in `CLAUDE.md`/`AGENTS.md`, which
covers the from-scratch case.

The core idea: **BOB is a UI over your existing markdown.** It never moves or
rewrites your notes. It reads them by *folder* and by `type:` *frontmatter*, and
shows them through navigation + dashboards defined in `workspace.json`, with
record shapes described by schema YAML. Getting an existing vault working is
therefore a matter of **describing what you already have** so the plugin can
find and display it — not restructuring the vault.

---

## What the plugin does on its own (so you don't duplicate it)

When the plugin loads (`onload`, `src/plugin.ts`), in order:

1. `initPluginPaths` — resolves the active config location to
   `<vault>/.obsidian/plugins/bob-workspace/workspace.json`.
2. `seedWorkspaceTemplates` — copies the bundled starter templates into the
   plugin's `templates/` folder (so they appear in the picker). Missing-only.
3. `loadSettings` — reads plugin `data.json`, then `workspace.json` if present,
   then overlays `workspace.json.settings` for the workspace-owned keys.
4. `reloadEntityConfiguration` — the runtime assembly (see below).
5. Registers views/commands, then on layout-ready:
   - **First-run picker:** `CadenceWorkspaceSetupModal` opens **only if
     `workspace.json` does not yet exist AND `settings.setupDismissed` is false.**
     Pick a template (or Skip). Skipping sets `setupDismissed` so it won't nag.

`reloadEntityConfiguration` (`src/runtime-config.ts`) applies config in this
order every load and on the **Reload workspace.json** command:

1. Reset nav/export registries; load `workspace.json`.
2. Reset `ENTITIES` to built-in defaults; sync folders.
3. Apply `navigation.groups` / `secondaryTabs` / `workbookGroups` (these
   **replace** the built-ins when present).
4. If schemas enabled: seed canonical YAML **only if the schema source folder is
   empty** (`bootstrapCanonicalSchemaSourcesIfMissing`), regenerate derived
   outputs if it just seeded, then `applySchemas` (merges schema YAML into
   `ENTITIES`).
5. Merge `workspace.json.bases`, then `settings.baseFiles`.
6. Rebuild surface lookups.

Two consequences that matter for an existing vault:

- **The schema bootstrap is gated.** It writes canonical YAML *only when the
  schema source folder is empty*. If you already have schema YAML (or a template
  seeded some via `_assets`), it writes nothing — so it will not overwrite or
  fight your definitions.
- **A top-level `workspace.json.entities` key is rejected.** Record types must be
  schema YAML — `validateWorkspaceConfig` throws on `entities`. (Legacy vaults
  carrying it will fail to load until it is removed.)

---

## The install sequence

### Step 0 — Install the plugin files

Copy `main.js`, `manifest.json`, `styles.css` into
`<vault>/.obsidian/plugins/bob-workspace/`, then enable the plugin
(Settings → Community plugins). A full restart is the reliable way to load
`main.js` changes.

### Step 1 — Decide: match the built-ins, or describe your own model

BOB's built-in entity defaults expect specific folders and `type:` values
(e.g. `contact` = `type: person`). Your existing notes almost certainly use
*your own* folders and types. You have two routes:

- **Adopt the built-in shape** — only if your notes already match it. Rare for
  an existing vault.
- **Describe your real model with schema YAML** (recommended for existing
  vaults). You write one YAML file per record type that *mirrors what the notes
  already have*: the folder they live in, their `type:` value, and their
  frontmatter fields. This is exactly what the `bob-workspace-bootstrap` skill
  automates — it censuses the vault (templates + frontmatter) and proposes the
  YAML so you don't hand-author it.

**Do not invent a model the notes don't have.** The schema must match reality
(`type_value` = the `type:` your notes actually carry; `location_pattern` = the
folder they're actually in; `fields` = the frontmatter keys they actually use),
or lists come up empty.

### Step 2 — Write the schema YAML

Put one YAML per record type under the schema source folder (default
`00-CORE/Schemas/source/`). Minimum useful shape:

```yaml
entity: contact              # the BOB entity key
label: Contact               # REQUIRED — display label for the record type
type_value: person           # matches your notes' `type:` frontmatter
location_pattern: 10-ME/10-PEOPLE   # REQUIRED — folder your notes live in
key_fields: [name]           # first becomes the primary (display/title/basename) field
fields:
  - { key: name,  label: Name,  primary: true }
  - { key: email, label: Email, type: email }
  - { key: company, label: Company }
```

`validateSourceSchemaDefinition` (`src/schema-designer.ts`) **requires** `entity`,
`label`, `location_pattern`, at least one field, and `type_value` unless the
entity is filename-backed. It also checks: field `type` ∈
`{string,number,integer,boolean,array}` (there is **no `date` type** — dates are
`string`); no duplicate field keys; every `key_fields` entry is a defined field; a
field `default` must be one of its `enum` options and match its type. Note it does
**not** validate a `format` key. Give each entity a real name/title field as its
primary — if `key_fields` is omitted, the first field wins, which can make a
`status` field the basename by accident.

Because the bootstrap is gated (Step "What the plugin does" above), the presence
of *any* YAML here stops the plugin from seeding the full built-in set — so your
model stays yours.

### Step 3 — Turn schemas on and regenerate

Enable schema loading — top-level `workspace.json.schemas`:

```json
"schemas": { "enabled": true, "folder": "00-CORE/Schemas/source" }
```

Then **Settings → BOB Workspace → Data model → regenerate** (or the bootstrap
command). This writes the derived Metadata Menu FileClasses (`<root>/fileClasses`)
and JSON Schemas (`<root>/json-schema`) and the `DATAMODEL.md` /
`DATAMODEL-FULL.md` sections, pruning stale outputs. Your notes are untouched.

### Step 4 — Give each entity a Base (optional but recommended)

A Base (`.base` file) gives a list its columns, filters, sort and views. Two
options:

- **Generate them:** run **"Generate missing bases"** (Settings → Data model, or
  the command). It writes a `.base` for every known/schema entity that lacks one,
  missing-only — existing `.base` files are never overwritten.
- **Point at existing ones:** map an entity to a `.base` you already have. Path
  resolution honors the *shape* of the reference:
  - a value **with a directory** (e.g. `20-COMPANY/skills.base`) is used
    **verbatim** — the base can live anywhere in the vault;
  - a **bare filename** (e.g. `People.base`) composes with `settings.basesFolder`
    (default `00-CORE/Bases`) and relocates if you change that folder.

A Base is optional for simple lists (they render from folder/type); it is needed
when you want Base-defined columns/filters/sort/grouping, or a non-table Base view
(board, calendar, cards) — those now render **inline** as a live Base embed on the
surface (table views keep the plugin's own editable inline table).

### Step 5 — Compose the UI (navigation + dashboards)

`workspace.json` is the single source for what the workspace *shows*. Either:

- **Apply a shipped template** — the first-run picker, or
  Settings → "Apply workspace template…". On a **first** install (no previously
  active template) this is **non-destructive**: it writes `workspace.json`, seeds
  the template's own `_assets` schemas/bases (missing-only), bootstraps + regen
  if the schema folder is empty, and reloads. It does **not** archive anything on
  first install. (See the switch warning below.)
- **Hand-author / compose** — build `navigation.groups` (items whose `entityKey`
  matches your schema entity keys), `secondaryTabs`, `dashboards`,
  `workbookGroups`. This is what the `bob-workspace-compose` skill automates.
  Nav items must resolve to a real surface/entity or they render "coming soon".

### Step 6 — Reload

Run **Reload workspace.json** or restart Obsidian. Your entities, lists,
dashboards and navigation should now reflect the vault's real content.

---

## ⚠️ The one destructive edge: switching/re-applying templates

`applyWorkspaceTemplate` calls `archiveTemplateAssets` **only when switching to a
different template** (a previously-active template exists and differs). That
archive **moves** the outgoing template's schema source, derived
`fileClasses`/`json-schema`, and **`.base` files** into sibling
`…-archive-…` folders — which can leave Base-backed widgets empty until you
regenerate. It also resets workspace-owned settings to defaults before applying
the new template's settings.

Implications:

- **First install into your existing vault: safe** — no previous template, so no
  archive.
- **Switching templates later, or re-applying a different one:** back up first,
  and be ready to re-generate bases / re-run the datamodel bootstrap afterward.
  Re-applying the *same* template is idempotent (no archive).

---

## Quick reference — order of files

For an existing vault, the dependency order is:

1. Plugin files installed (`main.js` etc.) → plugin loads.
2. **Schema YAML** under `00-CORE/Schemas/source/` that *matches your notes*.
3. `workspace.json.schemas.enabled: true` → regenerate (derived outputs).
4. **`.base` files** (generate or point at existing).
5. **`workspace.json`** navigation + dashboards referencing the schema entity
   keys (via template apply or compose).
6. Reload.

Steps 2 (and 3's census) are what `bob-workspace-bootstrap` owns; step 5 is what
`bob-workspace-compose` (or a template) owns; steps 3-map, 4-generate, and the
regenerate/apply/reload actions are the **plugin's** own buttons/commands.
