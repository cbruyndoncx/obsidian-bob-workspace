# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Repo:** `cbruyndoncx/obsidian-bob-workspace` · **Local:** `/home/cb/projects/github/obsidian-bob-workspace`

---

## Project Overview

**BOB Workspace** is an Obsidian plugin (forked from Cadence) providing a unified workspace for CRM, PRM, Client Work, Finance, Procurement, project management, daily planning, reminders, dashboards, and reports - all backed by plain markdown.

The plugin has **no build step** for editing logic, but it has two **generated bundles** inside `main.js` (workspace templates and the SheetJS XLSX library) — see "Generated bundles" below. The only artifacts Obsidian loads are:

- `main.js` — includes the bundled templates and XLSX library
- `manifest.json`
- `styles.css`

`vendor/` and `templates/` remain in the repo as the **editable sources** for the bundles, but Obsidian's installer does not deliver them and they are not required at runtime.

Plugin ID: `bob-workspace` (not `cadence-planner` — the upstream Cadence ID).

---

## Architecture

### File Organization

- **`main.js`** — All plugin logic. Organized top-to-bottom as:
  - Nav structure: `NAV_GROUPS`, `ALL_SURFACES`, `SURFACE_BY_ID`, `SURFACES_BY_ENTITY_KEY`, `SECONDARY_TABS`, `WORKBOOK_EXPORT_GROUPS`
  - Entity registry: `ENTITIES`, `BUILTIN_ENTITY_DEFAULTS`, `DEAL_STAGES`, deal/activity field accessor functions
  - Settings: `DEFAULT_SETTINGS`, `CURRENT_CURRENCY`, `ENTITY_FOLDERS`, `syncEntityFolders()`, `entityFolder()`
  - Schema loader: `applySchemas()` — reads Metadata Menu YAML schema files into `ENTITIES` at runtime
  - Dashboard/report config: `resolveDashboardConfig()`, `renderConfigDashboard()`, widget catalog helpers, runtime-backed widget sources
  - XLSX export: `getXLSX()`, `exportEntitiesXLSX()` via the inlined `loadBundledXLSX()` (SheetJS mini)
  - Utility functions: date/time, file I/O, parsing, formatting
  - Modal classes: `CadenceCaptureModal`, `CadenceReminderEditModal`, `CadenceImportModal`, `CadenceEntityCreateModal`, `CadencePromptModal`
  - Main view: `CadenceAppView`
  - Settings UI: `CadenceSettingTab`
  - Plugin entry: `CadencePlugin`

- **`styles.css`** — Fallback styles for any theme. Organized by component: app shell, dark mode, nav, cards, modals, inputs, tables, kanban.

- **`manifest.json`** — Plugin metadata (id: `bob-workspace`, version, min app version).

- **`versions.json`** — Version → min-app-version mapping for Obsidian store.

- **`vendor/xlsx.mini.min.js`** — Source for the SheetJS (mini) library that `scripts/bundle-xlsx.js` inlines into `main.js`. Not loaded directly at runtime.

### Key Classes

| Class | Responsibility |
|-------|----------------|
| `CadencePlugin` | Plugin entry point; registers commands, hotkeys, settings, event handlers |
| `CadenceAppView` | Main view rendering all surfaces via internal tab nav |
| `CadenceSettingTab` | Settings UI (modules, folders, currency, dark mode, schemas, etc.) |
| `CadenceCaptureModal` | Quick-capture modal (text + optional reminder, datetime, repeat) |
| `CadenceReminderEditModal` | Reminder editor for inbox items |
| `CadenceImportModal` | CSV import with column mapping |
| `CadenceEntityCreateModal` | Generic create modal for any entity type |
| `CadencePromptModal` | Confirmation/prompt modals |

### Nav Structure

`NAV_GROUPS` defines the left-nav hierarchy. Each nav item has:
- `id` — surface ID used for routing (e.g. `crm.pipeline`)
- `label`, `icon`, `desc`
- `module` — which module toggle gates this item (`crm`, `prm`, `planner`, `client-work`, `finance`, `procurement`)
- `entityKey` — links to `ENTITIES` key for generic list/kanban rendering
- `folderKey` — links to `DEFAULT_SETTINGS` key for folder configuration
- `navLevel` — `'secondary'` (shown only when parent is active) or `'setup'` (shown only when Setup nav is enabled)
- `parent` — surface ID of the parent when `navLevel` is set

Nav groups: `home_group`, `planner`, `crm`, `prm`, `client-work`, `finance`, `procurement`, `reports`, `misc`.

**`SECONDARY_TABS`** — object mapping parent surface IDs to arrays of sub-tab definitions. Used by workspace surfaces (e.g. `client-work.overview`, `finance.gl`, `prm.partners`) to render an inner tab bar with entity sub-views.

**`WORKBOOK_EXPORT_GROUPS`** — defines how entities are grouped into sheets when exporting an XLSX workbook. Groups: Planner, CRM, Client Work, PRM, Finance, Suppliers & Procurement.

### Data Model

**Entities** are plain markdown files with YAML frontmatter. The `ENTITIES` constant defines the schema for each type:

```javascript
const ENTITIES = {
  contact: {
    folder: '10-ME/10-PEOPLE',
    typeFilter: 'person',        // frontmatter type: value to match
    label: 'Contact', plural: 'Contacts',
    fields: [
      { key: 'name', label: 'Name', primary: true },  // primary = display name / file basename
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'stage', label: 'Stage', type: 'enum', options: ['Lead', 'Won'] },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
    columns: ['name', 'company', 'email'],  // list-view columns
  },
  // ...
};
```

**Field types:** `text` (default), `email`, `number`, `currency`, `date`, `enum` (requires `options`), `tags`

**Frontmatter** is always written via Obsidian's `processFrontMatter()` — never manual string manipulation.

**`BUILTIN_ENTITY_DEFAULTS`** — deep-clone of `ENTITIES` taken at startup; used to reset to defaults when schemas are reloaded.

**Built-in entity keys (40+):** `contact`, `company`, `client`, `supplier`, `partner`, `registration`, `commission`, `lead`, `certification`, `activity`, `meeting`, `comms-thread`, `deliverable`, `feedback`, `survey`, `testimonial`, `decision`, `campaign`, `sequence`, `project`, `task`, `accounting-period`, `bank-account`, `bank-reconciliation`, `chart-of-accounts`, `financial-statement`, `fs-notes`, `fx-rates-table`, `inventory`, `invoice`, `journal-entry`, `purchase-order`, `purchase-requisition`, `supplier-invoice`, `trial-balance`, `vat-return`, `corporate-tax-return`, `deferred-tax`, `transfer-pricing`, `free-zone-status`, `legal-rule`, `document-retention`, `deal`

**Deal entity extras:** `valueField`, `closeByField`, `wonStages`, `lostStages` on the entity def. Access via `dealValueField(def)`, `dealCloseByField(def)`, `dealWonStages(def)`, `dealLostStages(def)`, `dealTerminalStages(def)`.

### Entity file resolution

`listEntityFiles(app, entityKey)` resolves which vault files belong to an entity. It checks these strategies in order — first match wins:

| Strategy | When used | How configured |
|---|---|---|
| `typeFilters` object | Multi-field frontmatter match (e.g. `{type:'profile', profile_type:'partner'}`) | `"typeFilters": {"type": "profile", "profile_type": "partner"}` |
| `typeFilter` string | Single frontmatter `type:` value (e.g. `type: person`) | `"typeFilter": "person"` |
| `folders` array | Files under any of the listed root paths (OR within array) | `"folders": ["10-ME", "20-COMPANY", "30-CLIENTS"]` |
| `folder` (default) | Single folder prefix — the standard case | Configured via Settings → BOB Workspace → Folders |

All filter conditions are **independent and AND-combined** — any subset can be used together. Within the `folders` array the logic is OR. Between different filter types the logic is AND.

New entities created via BOB Workspace get their `type:` frontmatter set from `typeFilter` / `typeFilters.type` (not the entity key). For `typeFilters` entities, extra discriminator fields (e.g. `profile_type`) are also written.

**`entityKeyFromFile(app, file)`** — reverse lookup: given any vault file, returns the entity key by matching frontmatter `type:` first, then path prefix fallback.

### Folder Resolution

Entity folders are resolved at runtime via `ENTITY_FOLDERS` (a module-level object). The full chain:

1. `ENTITIES[key].folders[0]` — wins if a `folders` array is set (schema override)
2. `ENTITY_FOLDERS[key]` — set by `syncEntityFolders(settings)` on every load/save
3. `ENTITIES[key].folder` — hardcoded default in source

`syncEntityFolders(settings)` is called on every `loadSettings()`/`saveSettings()`. It also handles `project.folders` (multi-folder array when `projectFolders` setting has entries) and `task.folders` (combines active + archive folders for TaskNotes mode).

`entityFolder(key)` — the single lookup used everywhere.

### Schema Loading (`applySchemas`)

When `settings.useSchemas = true`, `applySchemas(app, settings)` reads YAML schema files from `settings.schemasFolder` (default `00-CORE/Schemas/source`) and merges field/column definitions into `ENTITIES` at runtime. This lets Metadata Menu schema files drive the entity model without editing source.
If the configured schema source folder is empty, the plugin bootstrap path seeds canonical YAML from the current workspace entity definitions before schema application, then regenerates the derived FileClasses and JSON Schema outputs.

### Surfaces (Views)

Tab-based internal nav. Surfaces are dispatched in `CadenceAppView.render()` via a route map:

| Surface ID | Renderer |
|---|---|
| `home` | config dashboard via `renderHome()` |
| `planner.inbox` | `renderInbox()` |
| `planner.today` | `renderTodayPane()` |
| `planner.calendar` | `renderPlannerPane()` |
| `planner.tasknotes` | `renderEntityList()` (task entity) |
| `planner.projects` | `renderProjectsView()` |
| `crm.dashboard` | config dashboard |
| `crm.pipeline` | config dashboard with kanban widget |
| `crm.contacts` / `clients` / `companies` / `leads` / `activities` | `renderEntityList()` |
| `crm.campaigns` | secondary tabs + `renderEntityList()` |
| `client-work.overview` | `renderClientWorkDashboard()` + secondary tabs |
| `client-work.*` | `renderEntityList()` |
| `prm.partners` | secondary tabs + `renderEntityList()` |
| `prm.analytics` | `renderPRMAnalytics()` |
| `finance.*` / `tax.*` / `procurement.*` | secondary tabs + `renderEntityList()` |
| `reports.*` | config-driven dashboards with widget catalog renderers |

**Specialised views** (Pipeline kanban, CRM Dashboard, Reports) now primarily route through the dashboard/widget system. The shipped home, CRM, pipeline, and reports surfaces are config-driven.

Nuance: `home` and `reports.productivity` are config-driven, but some of their source data is still produced by runtime snapshot helpers. That is intentional for now. If a future change wants those surfaces to become Base-first, the right path is to materialize the underlying runtime state into notes/frontmatter and point the widgets at those artifacts through `source.base`/`source.view`, leaving the runtime helper as a short-term fallback only.

Small dashboard UI choices that should survive restart, such as selector picks and date ranges, are persisted in `workspace.json.settings.dashboardState`. Keep that state limited to user intent only; recompute dashboard metrics and snapshot rows on render.

### XLSX Workbook Export

`exportEntitiesXLSX(app, entityKeys, suffix, settings)` exports one sheet per entity type into an `.xlsx` file. The library is loaded lazily via `getXLSX(app)`, which calls the inlined `loadBundledXLSX()` (SheetJS mini, bundled into `main.js`). Output path: `settings.workbookExportFolder` (default `BOB Workspace/Exports`). Commands: `bob-workspace-export-xlsx`, `bob-workspace-import-xlsx`.

### Key Patterns

**Frontmatter I/O:**
```javascript
await app.fileManager.processFrontMatter(file, (fm) => {
  fm.stage = 'Won';
});
```

**Parsing/replacing H2 sections (project notes):**
```javascript
const sections = parseH2Sections(content);   // { Brief: '...', Scope: '...', ... }
const updated = replaceSection(content, '## Brief', newText);
await app.vault.modify(file, updated);
```

**Reading entities:**
```javascript
const entities = listEntities(app, 'deal');   // all deals as { file, frontmatter, basename }[]
const folder   = entityFolder('deal');        // resolved folder path
```

**Date helpers:**
```javascript
ymd()                          // "2026-05-13"
dailyNotePath(settings)        // path to today's daily note
weekDates(anchor, weekStartsOn) // [Mon, Tue, ..., Sun] as Date[]
```

---

## Development

### Testing/Development Cycle

1. Edit `main.js`, `styles.css`, or file-backed templates/docs as needed
2. **If you edited any `templates/workspace-*.json`, run `node scripts/bundle-templates.js`** — this inlines them into `main.js` (see Workspace templates below). The regression suite fails if the bundle is stale.
3. Copy to test vault: `cp main.js styles.css manifest.json <vault>/.obsidian/plugins/bob-workspace/` (templates and XLSX are bundled into `main.js`)
4. Reload in Obsidian: Settings → Community plugins → BOB Workspace → Disable/Enable
5. Check console: Command palette → "Toggle developer tools"
6. Run `node tests/run-tests.js` for the lightweight regression suite

### Generated bundles

Obsidian's installer delivers only `main.js`/`manifest.json`/`styles.css` — it does **not** ship the `templates/` or `vendor/` folders, and `fs`/`__dirname`/`require()` against plugin paths don't work in the plugin runtime. So two things are **bundled into `main.js`** (between generated markers near the top):

| Bundle | Marker | Source | Regenerate with |
|--------|--------|--------|-----------------|
| Workspace templates | `BUNDLED_WORKSPACE_TEMPLATES` | `templates/workspace-*.json` | `node scripts/bundle-templates.js` |
| XLSX library (SheetJS mini) | `loadBundledXLSX()` | `vendor/xlsx.mini.min.js` | `node scripts/bundle-xlsx.js` |

**Always re-run the matching generator after editing a source, and copy the regenerated `main.js`.** The regression suite fails if either bundle is stale.

- `templates/workspace-*.json` and `vendor/xlsx.mini.min.js` remain the editable **sources of truth**; they are not loaded at runtime.
- `loadWorkspaceTemplates()` serves the bundled templates (authoritative for shipped names); on-disk templates can only **add** custom ones.
- The XLSX lib is embedded as a **function body** (not a string + `eval`), so V8 compiles it lazily on first `getXLSX()` use and there is no `eval` for the store reviewer to flag.
- Applying a template writes the full config — including all dashboards — into `workspace.json`, so it is visible and editable in Settings. There is no hidden builtin-dashboard fallback: a surface with no entry in `workspace.json` shows the "Add dashboards.xxx" prompt by design.
- **Template `_assets`** — a template may carry an `_assets: { schemas: {<entity>: <yaml>}, bases: {<file>: <yaml>} }` block. `applyWorkspaceTemplate()` strips `_assets` (and `_template`) before validating the config, then `writeTemplateAssets()` writes those files (missing-only) into the schema folder / Bases folder **before** the bootstrap. This is how a template whose entities are NOT built-in (e.g. `workspace-emai`, a PARA workspace with `tasks`/`people`/`video`/…) seeds exactly its own entities: the schemas exist first, so `bootstrapCanonicalSchemaSourcesIfMissing` stays gated and the full built-in entity set is never written.
- **Clean template switching** — when `applyWorkspaceTemplate()` is called with a template whose id differs from `settings.activeWorkspaceTemplate`, `archiveTemplateAssets()` first moves the OUTGOING template's full schema state — source YAML, the derived `fileClasses/` + `json-schema/` outputs (same `/source$`→root derivation as `regenerateSchemaOutputs`), `.base` files, and a labelled `workspace-<prevKey>-<stamp>.json` — into sibling `<folder>-archive-<prevKey>-<timestamp>` folders. Reversible (moves, never deletes). This prevents switches from compounding files on disk; `regenerateSchemaOutputs` only prunes the *active* schema folder, so without this the old derived outputs would orphan when templates use different schema roots. Re-applying the same template skips archiving (idempotent, missing-only).

### Code Style

- No build step — ES6, compatible with Obsidian's Chromium runtime
- Frontmatter I/O via `processFrontMatter()` only
- DOM: `createDiv()`, `createEl()`, and `appendChild()`/`setText()` as appropriate; keep BEM-style class names prefixed `cad-`
- Events: `registerEvent()` for vault/metadata; standard `addEventListener` for DOM
- No `console.log` in shipping code (SUBMISSION.md requirement)

### Adding a new built-in entity type

1. Add to `ENTITIES` in `main.js` with `folder`, `typeFilter`, `label`, `plural`, `fields`, `columns`
2. Add a folder setting key to `DEFAULT_SETTINGS` (e.g. `folderOrders: 'Cadence/Orders'`)
3. Add it to `syncEntityFolders()` and the Folders settings UI in `CadenceSettingTab`
4. Add a nav item to the appropriate group in `NAV_GROUPS` (include `entityKey`, `folderKey`, `module`)
5. Add to `BUILT_SURFACES` set
6. Add a route entry in the `route` map inside `CadenceAppView.render()` pointing to `renderEntityList()`
7. Add a `baseFiles` entry in `DEFAULT_SETTINGS` — just the **filename** matters (e.g. `'People.base'`); see Bases below
8. Add to `WORKBOOK_EXPORT_GROUPS` in the appropriate group's `entityKeys` array

For vault-configured entity types without touching source, use a schema YAML file instead.

### Bases (.base files)

`entityBasePath(settings, key)` resolves an entity's `.base` file as `${basesFolder}/${basename(filename)}`, where `settings.basesFolder` (default `00-CORE/Bases`) is **authoritative for the directory** and the filename comes (in order) from `WORKSPACE_CONFIG.bases[key].file`, `settings.baseFiles[key]`, or the built-in default. The directory portion of any of those is stripped to its basename, so changing the Bases folder relocates **every** base — including ones the starter template wrote into `workspace.json` `bases` as full paths. (With the default folder, composition reproduces the historical `00-CORE/Bases/*.base` paths.) `bases[key].view` still selects which view to use.

`generateMissingBases(app, settings)` (command **"Generate missing bases"** / Settings → Data model → Bases) writes a `.base` for each known entity lacking one — a `filters` clause from the entity's `typeFilter`/`typeFilters` (`note.x == "y"`) or folder, and a `table` view whose `order` lists the entity columns (`file.name` for the primary field, `note.<key>` otherwise), with `properties.<id>.displayName` for readable headers. Missing-only: existing files are never overwritten.

### Adding a new surface with custom rendering

1. Add nav item to `NAV_GROUPS`: `{ id: 'group.surface', label: '...', icon: '...', module: '...' }`
2. Add to `BUILT_SURFACES` set (prevents "soon" badge)
3. Add route in `CadenceAppView.render()`: `'group.surface': () => this.renderMySurface(content)`
4. Implement `renderMySurface(root)` on `CadenceAppView`

For surfaces with secondary tabs (inner tab bar), add an entry to `SECONDARY_TABS` mapping the parent surface ID to an array of `{ label, entityKey? | route? }` tab definitions.

### Editing project sections

Projects store multi-section content (Brief, Scope, Risks, Stakeholders, Notes) as H2 sections in the note body:

```javascript
const content = await app.vault.read(file);
const sections = parseH2Sections(content);  // sections.Brief, sections.Scope, ...
const updated = replaceSection(content, '## Brief', newText);
await app.vault.modify(file, updated);
```

### Milestone / task list parsing

```javascript
const tasks = parseTasksList(content);
// → [{ id, title, done, date?, time? }, ...]
const updated = tasks.map(t => t.id === id ? { ...t, done: true } : t);
await app.vault.modify(file, replaceSection(content, settings.tasksHeading, stringifyTasks(updated)));
```

---

## Common Issues

**Changes to `main.js` don't take effect.** Full restart of Obsidian required, not just disable/enable.

**Frontmatter corrupted.** Always use `processFrontMatter()`. Never string-replace YAML.

**New entity type lists nothing.** Check `entityFolder(key)` returns the correct path and the `primary` field is set.

**Moving entity folders.** Rename the folder in the vault first, then update the path in Settings → BOB Workspace → Folders. Files are not moved automatically.

**XLSX export fails.** The library is inlined into `main.js` via `loadBundledXLSX()`. If it errors, the bundle is likely stale or missing — run `node scripts/bundle-xlsx.js` and recopy `main.js`.

---

## Publishing

See `SUBMISSION.md` for the full release checklist.

Key reminders:
- `manifest.json` version must match the git tag exactly (no `v` prefix)
- `versions.json` must map the new version → min-app-version
- Release assets only need `main.js`, `manifest.json`, `styles.css` (and `versions.json`) — templates and the XLSX library are bundled into `main.js`. Verify both bundles are current (`node scripts/bundle-templates.js && node scripts/bundle-xlsx.js`) before tagging.
- No `console.log`, unsanitized `innerHTML`, or raw frontmatter string manipulation in shipping code
