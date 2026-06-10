# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Sync note:** `CLAUDE.md` and `AGENTS.md` are kept **identical except for this title/intro line**. Apply every change to both files.

**Repo:** `cbruyndoncx/obsidian-bob-workspace` · **Local:** `/home/cb/projects/github/obsidian-bob-workspace`

---

## Project Overview

**BOB Workspace** is an Obsidian plugin (forked from the Cadence plugin) providing a unified, vault-native workspace for CRM, PRM, Client Work, Finance/Tax, Suppliers & Procurement, project management, daily planning, reminders, dashboards, reports, and AI playbooks/skills — all backed by plain markdown.

Current plugin identity (`manifest.json`):

- ID: `bob-workspace` (not `cadence-planner` — the upstream Cadence ID)
- Name: `BOB Workspace`
- Version: see `manifest.json` (authoritative)
- Minimum Obsidian version: `1.4.0`
- Author: `cbruyndoncx`

The plugin has **no build step** for editing logic, but `main.js` carries two **generated bundles** (workspace templates and the SheetJS XLSX library) — see "Generated bundles". The only artifacts Obsidian loads:

- `main.js` — all plugin behavior, including the bundled templates and XLSX library
- `manifest.json`
- `styles.css`

`vendor/` and `templates/` remain in the repo as the **editable sources** for the bundles; Obsidian's installer does not deliver them and they are not required at runtime. Manual test installs need only copy `main.js`/`manifest.json`/`styles.css` into `<vault>/.obsidian/plugins/bob-workspace/`. Do not use the upstream `cadence-planner` plugin folder for this fork unless testing an explicit migration/compatibility scenario.

---

## Product Direction

Preserve the current BOB Workspace direction unless the user explicitly asks to change product identity or remove functionality.

- User-facing branding is BOB Workspace, while internal compatibility names such as `CadencePlugin`, `CadenceAppView`, `cad-` CSS classes, command IDs, and `VIEW_TYPE_CADENCE_APP` intentionally remain.
- Markdown files and frontmatter remain the source of truth. The plugin is a workspace UI over vault data, not a parallel database.
- Built-in entity definitions are fallbacks. For BOB vaults, canonical schema YAML describes record types and `.base` files describe display behavior.
- Prefer extending schemas, Bases, or plugin-folder `workspace.json` when a requested change is data-model/navigation configuration rather than application logic.
- Target direction: a new empty vault should be generated into a complete, immediately usable workspace. The setup path should create or install every required config/schema/Base/template artifact in the proper vault shape, rather than leaving implicit prerequisites.
- Target direction: avoid hardcoded workspace composition. `workspace.json` should be the explicit single starting source for BOB Workspace composition, with schema YAML, Base files, and optional imported vault JSON/YAML providing the data model and view behavior. Embedded defaults in `main.js` are legacy fallback/bootstrap behavior, not the desired long-term source of truth.

Some supporting documents can lag the implementation. Verify navigation and release behavior in `main.js`, `manifest.json`, and `versions.json` before relying on generated inventories or upstream-oriented publishing text.

---

## Repository Layout

- `main.js` — monolithic, directly loaded plugin source (all behavior).
- `styles.css` — theme-agnostic UI styles, dark mode, responsive/mobile rules, entity table editing, dashboards, modals, and Playbook Runner styles.
- `manifest.json` and `versions.json` — current BOB Workspace release metadata (`versions.json` maps version → min app version).
- `vendor/xlsx.mini.min.js` and `vendor/xlsx.LICENSE` — SheetJS (mini) source + license; the library is inlined into `main.js` via `scripts/bundle-xlsx.js` (not loaded at runtime).
- `templates/workspace-*.json` — human-readable starter workspace templates; the canonical sources, inlined into `main.js` via `scripts/bundle-templates.js`. Do not mirror them as hardcoded workspace definitions in `main.js`.
- `scripts/bundle-templates.js`, `scripts/bundle-xlsx.js` — bundle generators (see "Generated bundles").
- `tests/` — lightweight regression suite (`node tests/run-tests.js`).
- `docs/extending-bob-workspace.md` — schema/Base/entities extension model.
- `docs/navigation-inventory.md`, `docs/entity-setup-audit.md` — useful generated snapshots, but confirm against current code before editing.
- `CLAUDE.md` / `AGENTS.md` — kept in sync (this file); broader implementation notes.
- `SUBMISSION.md` — release checklist.
- A repo-root `workspace.json`, when present, is **not** loaded by Obsidian; treat it as a scratch/template artifact unless copied into the installed plugin directory.

---

## Architecture

### File Organization

- **`main.js`** — All plugin logic. Organized top-to-bottom as:
  - Generated bundles near the top: `BUNDLED_WORKSPACE_TEMPLATES`, `loadBundledXLSX()` (between markers)
  - Nav structure: `NAV_GROUPS`, `ALL_SURFACES`, `SURFACE_BY_ID`, `SURFACES_BY_ENTITY_KEY`, `SECONDARY_TABS`, `WORKBOOK_EXPORT_GROUPS`
  - Entity registry: `ENTITIES`, `BUILTIN_ENTITY_DEFAULTS`, `DEAL_STAGES`, deal/activity field accessor functions
  - Settings & folders: `DEFAULT_SETTINGS`, `CURRENT_CURRENCY`, `ENTITY_FOLDERS`, `syncEntityFolders()`, `entityFolder()`, `WORKSPACE_OWNED_SETTING_KEYS`
  - Runtime configuration layers: `loadWorkspaceConfig()`, `applyWorkspaceRegistries()`, `applySchemas()`, `applyConfiguredBaseOverrides()`, `applyBaseOverrides()`, `workspaceConfigTemplate()`, `reloadEntityConfiguration()`
  - Base parsing/evaluation: `parseBaseFile()`, Base filter helpers, grouping/sorting helpers
  - Dashboard/report config: `resolveDashboardConfig()`/`resolveSurfaceConfig()`, `renderConfigDashboard()`, widget catalog helpers, runtime-backed widget sources
  - XLSX export: `getXLSX()`, `exportEntitiesXLSX()` via the inlined `loadBundledXLSX()` (SheetJS mini)
  - Utility functions: date/time, file I/O, parsing, formatting
  - Modal classes: `CadenceCaptureModal`, `CadenceReminderEditModal`, `CadenceImportModal`, `CadenceEntityCreateModal`, `CadencePromptModal`, `CadenceConfirmModal`, `CadenceWorkspaceSetupModal`
  - Main view: `CadenceAppView`
  - Settings UI: `CadenceSettingTab`
  - Optional Bases custom view: `CadencePlaybookRunnerView`
  - Plugin entry: `CadencePlugin`

- **`styles.css`** — Fallback styles for any theme. Organized by component: app shell, dark mode, nav, cards, modals, inputs, tables, kanban.
- **`manifest.json`** — Plugin metadata (id `bob-workspace`, version, min app version).
- **`versions.json`** — Version → min-app-version mapping for the Obsidian store.
- **`vendor/xlsx.mini.min.js`** — Source for the SheetJS (mini) library that `scripts/bundle-xlsx.js` inlines into `main.js`. Not loaded directly at runtime.

### Key Classes

| Class | Responsibility |
|-------|----------------|
| `CadencePlugin` | Plugin entry point; registers views, commands, hotkeys, settings, reminders, reload behavior, workbook commands, and the optional Bases custom view |
| `CadenceAppView` | Main view rendering the app shell, responsive nav, all internal surfaces, generic tables, detail forms, dashboards, reports, and kanban |
| `CadenceSettingTab` | Settings UI: modules, surfaces, folders, Bases, schemas (Data model), tasks, reminders, export/import, currency, and `workspace.json` |
| `CadenceCaptureModal` | Quick-capture modal (text + optional reminder, datetime, repeat) |
| `CadenceReminderEditModal` | Reminder editor for inbox items |
| `CadenceImportModal` | CSV import with column mapping |
| `CadenceEntityCreateModal` | Generic create modal for any entity type |
| `CadencePromptModal` / `CadenceConfirmModal` | Prompt / yes-no confirmation modals (use instead of `window.confirm()`) |
| `CadenceWorkspaceSetupModal` | First-run / "Apply workspace template…" picker |
| `CadencePlaybookRunnerView` | Registers `agent-client-playbook-runner` as an Obsidian Bases custom view when that API exists |

### Nav Structure

`NAV_GROUPS` defines the left-nav hierarchy. Each nav item has:
- `id` — surface ID used for routing (e.g. `crm.pipeline`)
- `label`, `icon`, `desc`
- `module` — which module toggle gates this item (`crm`, `prm`, `planner`, `client-work`, `finance`, `procurement`)
- `entityKey` — links to `ENTITIES` key for generic list/kanban rendering
- `folderKey` — links to `DEFAULT_SETTINGS` key for folder configuration
- `navLevel` — `'secondary'` (shown only when parent is active) or `'setup'` (shown only when Setup nav is enabled)
- `parent` — surface ID of the parent when `navLevel` is set

**Built-in vs configured nav.** The hardcoded `BUILTIN_NAV_GROUPS` ships only two groups — **`home_group`** (Home) and **`misc`** (Team, Settings, Surface Designer, Export, Import) — and both have an **empty `label`**. The renderer draws a group header only when `group.label` is truthy (`if (group.label)` in `CadenceAppView.render()`), so a label-less group's items render directly with no section heading — which is why `misc` shows no label. The rich groups (CRM, PRM, Planner, Client Work, Finance, Procurement, Reports, AI Workspace) are **not hardcoded**; they come from the active `workspace.json` `navigation.groups`, applied at runtime by `applyWorkspaceRegistries()`. `BUILTIN_SECONDARY_TABS` and `BUILTIN_WORKBOOK_EXPORT_GROUPS` are likewise empty and populated from `workspace.json`. Navigation is module-driven; `showSecondaryNav` and `showSetupNav` control whether lower-frequency children appear in the left rail (still reachable via parent tabs).

**`SECONDARY_TABS`** — runtime object (built from `workspace.json` `navigation.secondaryTabs`) mapping parent surface IDs to arrays of sub-tab definitions, used by workspace surfaces (e.g. `client-work.overview`, `finance.gl`, `prm.partners`) to render an inner tab bar. A surface with `SECONDARY_TABS` entries renders its first sub-tab automatically (see `CadenceAppView.render()`), which is how custom parent surfaces work without a hardcoded renderer.

**`WORKBOOK_EXPORT_GROUPS`** — runtime object (from `workspace.json` `workbookGroups`) grouping entities into sheets for XLSX export. The shipped templates define groups such as Planner, CRM, Client Work, PRM, Finance, Suppliers & Procurement, and AI Workspace.

### Current Surfaces and Modules

- **Planner**: Inbox, Today, Calendar, TaskNotes, Projects
- **CRM**: Dashboard, Pipeline, Contacts, Clients, My Companies, Leads, Campaigns/Sequences, Activities
- **Client Work**: overview plus Meetings, Comms, Deliverables, Feedback, Surveys, Testimonials, Decisions; overview selectors filter by client and project
- **PRM**: Partners, Registrations, Commissions, Certifications, Analytics
- **Finance**: Customer Invoices, General Ledger, Finance Setup, Tax, and their accounting/compliance child entity lists
- **Suppliers & Procurement**: Suppliers, Supplier Invoices, Purchase Requisitions, Purchase Orders
- **Reports**: Pipeline, Sales, Partners, Activity, Productivity
- **Team**: a filtered People/contact view using configurable `person_category` values, not a separate entity
- **AI Workspace**: Playbooks and Skills

Important specialized behavior:
- Pipeline is a deal kanban. Drag-to-change-stage is desktop-only; mobile opens cards for editing rather than relying on HTML drag events.
- Generic entity tables support sorting, enum column filters, inline editing, multi-select, and bulk trashing.
- Entity detail forms use frontmatter writes; project detail also edits note body sections and task/milestone markdown.
- External/non-table Base views delegate display to Obsidian Bases and expose an `Open Base` action instead of duplicating the view.
- Client Work child lists force the internal table so configured non-table Base views do not make those embedded lists disappear.
- Mobile layout includes a navigation drawer, compact briefing behavior, and safe-area/responsive CSS.

### Data Model

**Entities** are plain markdown files with YAML frontmatter. The `ENTITIES` constant defines fallback labels, fields, columns, folder/type matching, and specialized metadata:

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

**Field UI types:** `text` (default), `email`, `number`, `currency`, `date`, `enum` (requires `options`), `tags`.

**Frontmatter is always written via Obsidian's `processFrontMatter()`** — never manual string manipulation:

```javascript
await app.fileManager.processFrontMatter(file, (fm) => { fm.stage = 'won'; });
```

Body markdown is edited separately only where the feature is genuinely body-based (project sections, daily-note task lists):

```javascript
const content = await app.vault.read(file);
const updated = replaceSection(content, '## Brief', newText);
await app.vault.modify(file, updated);
```

**`BUILTIN_ENTITY_DEFAULTS`** — deep clone of `ENTITIES` taken at startup; used to reset to defaults when schemas reload. Built-in entities cover planner, CRM, client-work, PRM, supplier/procurement, finance/tax, plus `playbook` and `skill`.

**Built-in entity keys (40+):** `contact`, `company`, `client`, `supplier`, `partner`, `registration`, `commission`, `lead`, `certification`, `activity`, `meeting`, `comms-thread`, `deliverable`, `feedback`, `survey`, `testimonial`, `decision`, `campaign`, `sequence`, `project`, `task`, `accounting-period`, `bank-account`, `bank-reconciliation`, `chart-of-accounts`, `financial-statement`, `fs-notes`, `fx-rates-table`, `inventory`, `invoice`, `journal-entry`, `purchase-order`, `purchase-requisition`, `supplier-invoice`, `trial-balance`, `vat-return`, `corporate-tax-return`, `deferred-tax`, `transfer-pricing`, `free-zone-status`, `legal-rule`, `document-retention`, `deal`

**Deal entity extras:** `valueField`, `closeByField`, `wonStages`, `lostStages`. Access via `dealValueField(def)`, `dealCloseByField(def)`, `dealWonStages(def)`, `dealLostStages(def)`, `dealTerminalStages(def)`.

### Entity file resolution

`listEntityFiles(app, entityKey)` resolves which vault files belong to an entity. Filter categories that exist together are **AND-combined**:

| Strategy | When used | How configured |
|---|---|---|
| `typeFilters` object | Multi-field frontmatter match (e.g. `{type:'profile', profile_type:'partner'}`) | `"typeFilters": {"type": "profile", "profile_type": "partner"}` |
| `typeFilter` string | Single frontmatter `type:` value (e.g. `type: person`) | `"typeFilter": "person"` |
| `filenameFilter` | Match by filename (e.g. skills match only `SKILL.md`) | entity-specific |
| `folders` array | Files under any of the listed root paths (OR within the array) | `"folders": ["10-ME", "20-COMPANY", "30-CLIENTS"]` |
| `folder` (default) | Single folder prefix; applies only when neither `typeFilter` nor `folders` is set | Settings → BOB Workspace → Folders |
| Parsed Base filters | When a selected Base/view contributes supported filters | from `.base` |

Within the `folders` array the logic is OR; between different filter types the logic is AND. **Template paths are excluded:** any note under a directory segment named `template`/`templates` must not appear in entity lists, counts, dashboards, or workbook exports.

New entities created via BOB Workspace get their `type:` frontmatter from `typeFilter`/`typeFilters.type` (not the entity key); `typeFilters` entities also write extra discriminator fields. **`entityKeyFromFile(app, file)`** is the reverse lookup (matches frontmatter `type:` first, then path prefix). Do not add a `typesFilter` option without implementing it first — it is not part of current `listEntityFiles()` behavior.

### Folder Resolution

Entity folders resolve at runtime via `ENTITY_FOLDERS` (module-level). Chain:

1. `ENTITIES[key].folders[0]` — wins if a `folders` array is set (schema override)
2. `ENTITY_FOLDERS[key]` — set by `syncEntityFolders(settings)` on every load/save
3. `ENTITIES[key].folder` — hardcoded default in source

`syncEntityFolders(settings)` runs on every `loadSettings()`/`saveSettings()`. It also handles `project.folders` (multi-folder array when `projectFolders` has entries) and `task.folders` (active + archive for TaskNotes mode). `entityFolder(key)` is the single lookup used everywhere.

### Workspace source of truth

The active workspace definition is always read from the installed plugin folder:

```text
<vault>/.obsidian/plugins/bob-workspace/workspace.json
```

`initPluginPaths(plugin)` derives this from `plugin.manifest.dir`; the pre-init fallback is legacy `Cadence/workspace.json` and should not be used for current installs. A repo-root `workspace.json` is not read by the running plugin.

`data.json` is no longer the source for portable workspace-owned settings. `CadencePlugin.loadSettings()` reads plugin data, then loads `workspace.json`, then overlays `workspace.json.settings` for keys in `WORKSPACE_OWNED_SETTING_KEYS`. `saveSettings()` removes owned keys from plugin data and writes them back to `workspace.json` whenever a workspace file exists (a `workspace.backup.json` is written first). Personal/non-workspace settings stay in plugin data.

When hand-authoring `workspace.json`, prefer these top-level blocks:
- `schemas` — schema enablement and schema source folder
- `bases` — portable Base file + default view associations
- `navigation.groups`, `navigation.secondaryTabs`, `navigation.actions` — layout and header buttons
- `workbookGroups` — XLSX export bundles
- `dashboards` — configurable dashboard layouts keyed by route/surface id
- `templates` — record templates such as `templates.taskNote`
- `settings` — only portable settings listed in `WORKSPACE_OWNED_SETTING_KEYS`

Top-level `schemas` controls schema loading, top-level `bases` controls Base file paths, and `settings.baseViews` can override a workspace Base's default view as a user selection. Don't treat duplicated `settings.useSchemas`/`settings.schemasFolder`/`settings.baseFiles`/`settings.baseViews` as canonical when top-level `schemas`/`bases` are present.

### Runtime configuration order

`reloadEntityConfiguration(app, settings)` applies configuration in order:

1. Reset runtime navigation/export registries; load the active plugin-folder `workspace.json` if present.
2. Reset `ENTITIES` to `BUILTIN_ENTITY_DEFAULTS`; sync folders from the effective settings.
3. Apply configured `navigation.groups`, `navigation.secondaryTabs`, and `workbookGroups` (these **replace** built-in registries when present — not deep-merged).
4. Apply deprecated `workspace.json.entities` once before schema loading (migration), injecting navigation only when no configured navigation exists.
5. Resolve schema settings (top-level `workspace.json.schemas` overrides settings), then `applySchemas()` if enabled. A schema can introduce a generic record type without plugin code.
6. Apply deprecated `workspace.json.entities` again as post-schema overrides (no nav injection). New entities should not be added here for current vaults.
7. Merge top-level `workspace.json.bases` with `applyConfiguredBaseOverrides()` (these paths win over `settings.baseFiles`).
8. Merge remaining settings-selected `.base` behavior with `applyBaseOverrides()`; `settings.baseViews` can override the default view for either source.
9. Rebuild surface lookups.

Do not assume edits to `ENTITIES` alone control a BOB vault when schemas, custom overrides, or Bases are active.

### Schema loading (`applySchemas`) and the Data model designer

When schema support is enabled (top-level `workspace.json.schemas.enabled`, else `settings.useSchemas`), `applySchemas(app, settings)` reads YAML from the schema folder (default `00-CORE/Schemas/source`) and merges field/column/type/folder definitions into `ENTITIES` at runtime. Schema fields map: `type_value` → `typeFilter`, `location_pattern` → folder(s), `fields` → fields, `key_fields[0]` → primary; columns default to the first ~5 fields.

If the schema source folder is empty, the bootstrap path (`bootstrapCanonicalSchemaSourcesIfMissing` → `bootstrapCanonicalSchemaSources`) seeds canonical YAML from current entity definitions, then `regenerateSchemaOutputs()` writes derived Metadata Menu FileClasses (`<root>/fileClasses`) and JSON Schemas (`<root>/json-schema`, named by `type_value`), pruning stale outputs in the active folder.

- Settings includes a **Data model designer** for canonical schema YAML: creates entity source files, edits identity/location, icons, discriminators, co-required relationships, import `field_aliases`, create `default` values (`{{today}}` resolved for date fields), display hints and ordered fields; writes `<schema>.backup` before save and reloads runtime config immediately.
- In file-managed workspaces, Settings authoring must **not** expose fallback built-in entities as available/unassigned record types — the available set is limited to canonical schema YAML plus entity keys referenced by the active `workspace.json`. Home and other specialized screens follow the same boundary.
- Header buttons live in `workspace.json.navigation.actions` keyed by surface id; entity actions render from the configured schema/form; non-entity actions must be explicit supported ids (e.g. `quick-capture`, `today-task`). When a surface has configured header actions, don't add legacy hardcoded create buttons beside them.
- A selected Base/view can order visible columns but must not remove schema-defined fields from create/import. Unsupported Base filters are surfaced as UI warnings — preserve that transparency.

### Surfaces (Views)

Tab-based internal nav, dispatched in `CadenceAppView.render()` via a route map (then `SECONDARY_TABS` parents, then entity lists, then "coming soon"):

| Surface ID | Renderer |
|---|---|
| `home` | config dashboard via `renderHome()` |
| `planner.inbox` / `today` / `calendar` | `renderInbox()` / `renderTodayPane()` / `renderPlannerPane()` |
| `planner.tasknotes` / `projects` | `renderEntityList()` (task) / `renderProjectsView()` |
| `crm.dashboard` / `pipeline` | config dashboard (pipeline uses a kanban widget) |
| `crm.contacts` / `clients` / `companies` / `leads` / `activities` | `renderEntityList()` |
| `crm.campaigns` | secondary tabs + `renderEntityList()` |
| `client-work.overview` | `renderClientWorkDashboard()` + secondary tabs |
| `prm.partners` / `prm.analytics` | secondary tabs + list / `renderPRMAnalytics()` |
| `finance.*` / `tax.*` / `procurement.*` | secondary tabs + `renderEntityList()` |
| `reports.*` | config-driven dashboards with widget catalog renderers |

Specialized views (Pipeline kanban, CRM Dashboard, Reports) primarily route through the dashboard/widget system. `home` and `reports.productivity` are config-driven, but some source data is still produced by runtime snapshot helpers (intentional for now; the Base-first path is to materialize that runtime state into notes/frontmatter and point widgets at `source.base`/`source.view`). Small dashboard UI choices that should survive restart (selector picks, date ranges) persist in `workspace.json.settings.dashboardState` — keep that to user intent only; recompute metrics/rows on render.

### XLSX, tasks, import/export

- `exportEntitiesXLSX(app, entityKeys, suffix, settings)` exports one sheet per entity type. The library loads lazily via `getXLSX(app)` → inlined `loadBundledXLSX()` (SheetJS mini). Output: `settings.workbookExportFolder` (default `BOB Workspace/Exports`). Commands: `bob-workspace-export-xlsx`, `bob-workspace-import-xlsx`.
- Task modes: `checkbox`, `tasknotes`, `hybrid`. TaskNotes lists use the active TaskNotes folder; Productivity history may read active + archive.
- Quick capture writes reminder state into settings and attempts to add a checkbox item to the relevant daily note.
- CSV import maps columns into entity frontmatter via entity definitions (with `field_aliases` synonyms).
- When changing entity fields, verify create/edit UI, generic list behavior, CSV import, XLSX import/export, configured Bases, and schema-derived entities.

### Key Patterns

```javascript
// Frontmatter I/O
await app.fileManager.processFrontMatter(file, (fm) => { fm.stage = 'Won'; });

// Parse/replace H2 sections (project notes)
const sections = parseH2Sections(content);   // { Brief, Scope, ... }
const updated  = replaceSection(content, '## Brief', newText);

// Read entities
const entities = listEntities(app, 'deal');   // { file, frontmatter, basename }[]
const folder   = entityFolder('deal');

// Date helpers
ymd();                            // "2026-05-13"
dailyNotePath(settings);          // today's daily note path
weekDates(anchor, weekStartsOn);  // [Mon..Sun] as Date[]
```

---

## Development

### Testing / development cycle

1. Edit `main.js`, `styles.css`, or file-backed templates/docs as needed.
2. **If you edited any `templates/workspace-*.json`, run `node scripts/bundle-templates.js`**; if you edited `vendor/xlsx.mini.min.js`, run `node scripts/bundle-xlsx.js`. These inline the sources into `main.js`. The regression suite fails if a bundle is stale.
3. Copy to test vault: `cp main.js styles.css manifest.json <vault>/.obsidian/plugins/bob-workspace/` (templates and XLSX are bundled into `main.js`).
4. Reload in Obsidian: Settings → Community plugins → BOB Workspace → Disable/Enable (a full restart may be required for `main.js` changes).
5. Check console: Command palette → "Toggle developer tools".
6. Run `node tests/run-tests.js` for the lightweight regression suite, and `node --check main.js` for a syntax check.

### Generated bundles

Obsidian's installer delivers only `main.js`/`manifest.json`/`styles.css` — it does **not** ship `templates/` or `vendor/`, and `fs`/`__dirname`/`require()` against plugin paths don't work in the runtime. So two things are **bundled into `main.js`** (between generated markers near the top):

| Bundle | Marker | Source | Regenerate with |
|--------|--------|--------|-----------------|
| Workspace templates | `BUNDLED_WORKSPACE_TEMPLATES` | `templates/workspace-*.json` | `node scripts/bundle-templates.js` |
| XLSX library (SheetJS mini) | `loadBundledXLSX()` | `vendor/xlsx.mini.min.js` | `node scripts/bundle-xlsx.js` |

**Always re-run the matching generator after editing a source, and copy the regenerated `main.js`.** The regression suite fails if either bundle is stale.

- `templates/workspace-*.json` and `vendor/xlsx.mini.min.js` remain the editable **sources of truth**; they are not loaded at runtime.
- `loadWorkspaceTemplates()` serves the bundled templates (authoritative for shipped names); on-disk templates can only **add** custom ones.
- The XLSX lib is embedded as a **function body** (not a string + `eval`), so V8 compiles it lazily on first `getXLSX()` use and there is no `eval` for the store reviewer to flag.
- Applying a template writes the full config — including all dashboards — into `workspace.json`, so it is visible/editable in Settings. There is no hidden builtin-dashboard fallback: a surface with no entry in `workspace.json` shows the "Add dashboards.xxx" prompt by design.
- **Template `_assets`** — a template may carry `_assets: { schemas: {<entity>: <yaml>}, bases: {<file>: <yaml>} }`. `applyWorkspaceTemplate()` strips `_assets` (and `_template`) before validating the config, then `writeTemplateAssets()` writes those files (missing-only) into the schema folder / Bases folder **before** the bootstrap. This is how a template whose entities are NOT built-in (e.g. `workspace-emai`, a PARA workspace with `tasks`/`people`/`video`/…) seeds exactly its own entities: the schemas exist first, so `bootstrapCanonicalSchemaSourcesIfMissing` stays gated and the full built-in entity set is never written.
- **Clean template switching** — when `applyWorkspaceTemplate()` is called with a template whose id differs from `settings.activeWorkspaceTemplate`, `archiveTemplateAssets()` first moves the OUTGOING template's full schema state — source YAML, the derived `fileClasses/` + `json-schema/` outputs (same `/source$`→root derivation as `regenerateSchemaOutputs`), `.base` files, and a labelled `workspace-<prevKey>-<stamp>.json` — into sibling `<folder>-archive-<prevKey>-<timestamp>` folders. Reversible (moves, never deletes). This prevents switches from compounding files on disk; `regenerateSchemaOutputs` only prunes the *active* schema folder, so without this the old derived outputs would orphan when templates use different schema roots. Re-applying the same template skips archiving (idempotent, missing-only).

### Code style & development rules

- No build step for logic — ES6, compatible with Obsidian's Chromium runtime. Keep the no-build constraint unless the user explicitly requests a migration. Prefer small, scoped edits in `main.js`/`styles.css`.
- Frontmatter I/O via `processFrontMatter()` only; vault body writes only for markdown sections/tasks outside frontmatter.
- DOM: `createDiv()`, `createEl()`, `appendChild()`/`setText()`; keep BEM-style class names prefixed `cad-`/`cadence-`; verify light and dark.
- Events: `registerEvent()` for vault/metadata; standard `addEventListener` for DOM. Use `CadenceConfirmModal`/`confirmModal()` instead of `window.confirm()`.
- No `console.log` in shipping code; no unsafe raw `innerHTML` for untrusted vault content.
- Respect responsive/mobile behavior for interactive changes.
- Preserve BOB Workspace branding and compatibility names unless deliberately changing public identity.
- Keep `vendor/xlsx.mini.min.js` in the repo and re-run `scripts/bundle-xlsx.js` after updating it.

### Adding a new built-in entity type (in code)

1. Add to `ENTITIES` with `folder`, `typeFilter`, `label`, `plural`, `fields`, `columns`.
2. Add a folder setting key to `DEFAULT_SETTINGS` and handle it in `syncEntityFolders()` + the Folders settings UI.
3. Add a nav item to `NAV_GROUPS` (include `entityKey`, `folderKey`, `module`).
4. Add to the `BUILT_SURFACES` set.
5. Add a route entry in `CadenceAppView.render()` pointing to `renderEntityList()`.
6. Add a `baseFiles` entry in `DEFAULT_SETTINGS` — just the **filename** matters (e.g. `'People.base'`; see Bases).
7. Add inner tabs in `SECONDARY_TABS` if it belongs under a workspace.
8. Add to `WORKBOOK_EXPORT_GROUPS` in the appropriate group's `entityKeys`.
9. Verify schemas, custom overrides, Bases, create/edit, and import/export.

For vault-configured entity types **without** touching source, use a schema YAML file instead.

### Bases (.base files)

`entityBasePath(settings, key)` resolves an entity's `.base` as `${basesFolder}/${basename(filename)}`, where `settings.basesFolder` (default `00-CORE/Bases`) is **authoritative for the directory** and the filename comes (in order) from `WORKSPACE_CONFIG.bases[key].file`, `settings.baseFiles[key]`, the built-in default, or — for schema-defined entities with none of those — a name derived from the entity (e.g. `area` → `Areas.base`). The directory portion of any path is stripped to its basename, so changing the Bases folder relocates **every** base (with the default folder this reproduces the historical `00-CORE/Bases/*.base` paths). `bases[key].view` still selects which view to use.

`generateMissingBases(app, settings)` (command **"Generate missing bases"** / Settings → Data model → Bases) writes a `.base` for each known or schema-registered entity lacking one — a `filters` clause from the entity's `type_value`/`typeFilters`/folder, and a `table` view whose `order` lists the columns (`file.name` for the primary field, `note.<key>` otherwise), with `properties.<id>.displayName` for readable headers. Missing-only: existing files are never overwritten. **In a Base, `order`/`sort` use bare property names (`person_category`), while `properties` keys and `filters` use the `note.<prop>` form; `file.name` is the primary field's column** — match this when hand-authoring or generating.

A Base mapping is optional for simple lists (which render from folder/type), but required when the workspace needs Base-specific filters, column order, grouping, sorting, or an external non-table Base view.

### Adding a new surface with custom rendering

1. Add a nav item to `NAV_GROUPS` (`{ id: 'group.surface', label, icon, module }`).
2. Add to `BUILT_SURFACES` (prevents the "soon" badge).
3. Add a route in `CadenceAppView.render()`: `'group.surface': () => this.renderMySurface(content)`.
4. Implement `renderMySurface(root)` on `CadenceAppView`, preserving mobile/theme behavior.

For inner tabs, add an entry to `SECONDARY_TABS` mapping the parent surface ID to `{ label, entityKey? | route? }` definitions.

### Editing project sections & milestone/task lists

```javascript
const content  = await app.vault.read(file);
const sections = parseH2Sections(content);  // sections.Brief, sections.Scope, ...
const updated  = replaceSection(content, '## Brief', newText);
await app.vault.modify(file, updated);

const tasks   = parseTasksList(content);     // [{ id, title, done, date?, time? }, ...]
const updated2 = tasks.map(t => t.id === id ? { ...t, done: true } : t);
await app.vault.modify(file, replaceSection(content, settings.tasksHeading, stringifyTasks(updated2)));
```

### Preparing an empty-vault workspace

Prefer schema/`workspace.json` over code for vault-configurable entities. When preparing a new empty-vault workspace:

1. Create/install canonical schema YAML under the configured schema source folder; set top-level `workspace.json.schemas.enabled: true` (or embed schemas in a template's `_assets`).
2. Create/install required `.base` files under the configured Bases folder.
3. Put portable Base mappings in top-level `workspace.json.bases` only when an entity needs Base-defined filters/columns/sort/group or an external Base view.
4. Add navigation items with stable ids and `entityKey` values matching the schema-derived entity keys.
5. Add secondary tabs and workbook export groups in the same draft.
6. Include task/record templates and any starter folders/files needed for an immediately usable vault.
7. Put the final file at `<vault>/.obsidian/plugins/bob-workspace/workspace.json` (a repo-root file does not affect the running plugin).
8. Reload with the **Reload workspace.json** command or restart Obsidian.

When supporting an existing vault, prefer an explicit import path that reads vault YAML/JSON, normalizes it into the same `workspace.json`/schema/Base model, and writes visible files rather than relying on hidden plugin state.

### Validation

There is no automated application build. For relevant changes:

1. `node --check main.js` (syntax) and `node tests/run-tests.js` (regression suite).
2. Review edits for untrusted DOM insertion, frontmatter mutation, and stale/missing bundle artifacts.
3. Copy shipping files to a test vault plugin folder.
4. Reload or restart Obsidian and inspect the developer console.
5. Exercise affected surfaces, settings, light/dark appearance, and mobile layout where UI changed.

---

## Common Issues

**Changes to `main.js` don't take effect.** Full restart of Obsidian required, not just disable/enable.

**Frontmatter corrupted.** Always use `processFrontMatter()`. Never string-replace YAML.

**New entity type lists nothing.** Check `entityFolder(key)` returns the correct path and the `primary` field is set; for schema entities confirm the schema folder and `type_value`.

**Moving entity folders.** Rename the folder in the vault first, then update the path in Settings → BOB Workspace → Folders. Files are not moved automatically.

**XLSX export fails.** The library is inlined into `main.js` via `loadBundledXLSX()`. If it errors, the bundle is likely stale — run `node scripts/bundle-xlsx.js` and recopy `main.js`.

**Complete built-in entity set appears in a custom vault.** The schema bootstrap seeds built-in entities when the schema folder is empty. Keep the vault's own schemas present (or use a template with `_assets`) so the bootstrap stays gated.

---

## Publishing

See `SUBMISSION.md` for the full release checklist. Key reminders:

- `manifest.json` version must match the git tag exactly (no `v` prefix); `versions.json` must map the new version → min-app-version.
- Release assets only need `main.js`, `manifest.json`, `styles.css` (and `versions.json`) — templates and the XLSX library are bundled into `main.js`. Regenerate both bundles before tagging: `node scripts/bundle-templates.js && node scripts/bundle-xlsx.js`.
- No `console.log`, unsafe/untrusted `innerHTML`, or raw frontmatter string manipulation in shipping code.
- Treat `manifest.json`/`versions.json` as authoritative; confirm any inherited `SUBMISSION.md` instructions before reusing old plugin IDs, repo URLs, or asset lists.
