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

The plugin is written in **TypeScript** under `src/` and bundled by **esbuild** into a single committed `main.js` (`npm run build`). The workspace templates (`templates/workspace-*.json`) and the SheetJS XLSX library (`vendor/xlsx.mini.min.js`) are inlined into `main.js` at build time — see "Bundled assets". The only artifacts Obsidian loads:

- `main.js` — **generated** by esbuild from `src/` (never edit by hand); includes the bundled templates and XLSX library
- `manifest.json`
- `styles.css`

`vendor/` and `templates/` are **editable sources** consumed by the build; Obsidian's installer does not deliver them and they are not required at runtime. Manual test installs need only copy `main.js`/`manifest.json`/`styles.css` into `<vault>/.obsidian/plugins/bob-workspace/`. Do not use the upstream `cadence-planner` plugin folder for this fork unless testing an explicit migration/compatibility scenario.

---

## Product Direction

Preserve the current BOB Workspace direction unless the user explicitly asks to change product identity or remove functionality.

- Internal identifiers are now BOB-branded: `BobPlugin`, `BobAppView`, `Bob*` classes, `bob-`/`bob-workspace-*` CSS classes and command IDs, and `VIEW_TYPE_BOB_APP` (value `bob-workspace-app`). The only retained "Cadence" references are deliberate compatibility/attribution: the **legacy `Cadence/…` fallback paths** (`WORKSPACE_CONFIG_PATH`, the schema-entity default-folder fallback), the shipped **Cadence Classic** template (`workspace-cadence.json`), and the **upstream credit** link to the original Cadence Planner plugin — do not rename these.
- Markdown files and frontmatter remain the source of truth. The plugin is a workspace UI over vault data, not a parallel database.
- Built-in entity definitions are fallbacks. For BOB vaults, canonical schema YAML describes record types and `.base` files describe display behavior.
- Prefer extending schemas, Bases, or plugin-folder `workspace.json` when a requested change is data-model/navigation configuration rather than application logic.
- Target direction: a new empty vault should be generated into a complete, immediately usable workspace. The setup path should create or install every required config/schema/Base/template artifact in the proper vault shape, rather than leaving implicit prerequisites.
- Target direction: avoid hardcoded workspace composition. `workspace.json` should be the explicit single starting source for BOB Workspace composition, with schema YAML, Base files, and optional imported vault JSON/YAML providing the data model and view behavior. Embedded defaults in `main.js` are legacy fallback/bootstrap behavior, not the desired long-term source of truth.

Some supporting documents can lag the implementation. Verify navigation and release behavior in `main.js`, `manifest.json`, and `versions.json` before relying on generated inventories or upstream-oriented publishing text.

---

## Repository Layout

- `src/` — TypeScript plugin source (modular; see "File Organization"). `src/main.ts` is the entry point.
- `main.js` — **generated** esbuild bundle of `src/`, committed because Obsidian installs it directly. Never edit by hand — edit `src/` and run `npm run build`.
- `styles.css` — theme-agnostic UI styles, dark mode, responsive/mobile rules, entity table editing, dashboards, modals, and Playbook Runner styles.
- `manifest.json` and `versions.json` — current BOB Workspace release metadata (`versions.json` maps version → min app version).
- `vendor/xlsx.mini.min.js` and `vendor/xlsx.LICENSE` — SheetJS (mini) source + license; bundled into `main.js` by esbuild as a lazily-initialized CommonJS module (not loaded from disk at runtime).
- `templates/workspace-*.json` — human-readable starter workspace templates; the canonical sources, imported as JSON by `src/bundled/templates.ts` and inlined at build time. Do not mirror them as hardcoded workspace definitions in source.
- `skills/bob-workspace-bootstrap/`, `skills/bob-workspace-compose/` — companion AI-agent skills (Claude Code `SKILL.md` format) for maintaining a BOB vault from outside Obsidian: bootstrap censuses a vault's templates/frontmatter into canonical schema YAML, compose authors `workspace.json` (dashboards, navigation, Base wiring). Reference material only — not loaded by the plugin or the build; ship as a convenience for agent-assisted vault maintenance.
- `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `esbuild.shared.cjs` — build toolchain (`npm run build` / `dev` / `typecheck` / `check`). `esbuild.shared.cjs` is the single source of the bundle options, shared with the build-freshness test.
- `tests/` — lightweight regression suite (`node tests/run-tests.js`).
- `docs/extending-bob-workspace.md` — schema/Base/entities extension model.
- `docs/installing-into-existing-vault.md` — authoritative first-time-install sequence for a vault that already has notes (schema-first, then bases, then UI).
- `docs/empty-vault-quickstart.md` — user-facing happy path for a brand-new empty vault (enable → pick template → create first records → make Today interactive).
- `docs/canvas-surfaces.md` — user guide for the canvas surfaces (library, full-page view, generators).
- `docs/archive/` — historical/dev material, **not user-facing**: completed TODO/review lists, implemented specs (`base-view-widget-spec.md`), design proposals (`home-base-migration.md`), and stale generated snapshots (`navigation-inventory.md`, `entity-setup-audit.md`). `docs/` itself holds only the user install/usage guides.
- `CLAUDE.md` / `AGENTS.md` — kept in sync (this file); broader implementation notes.
- `SUBMISSION.md` — release checklist.
- A repo-root `workspace.json`, when present, is **not** loaded by Obsidian; treat it as a scratch/template artifact unless copied into the installed plugin directory.

---

## Architecture

### File Organization

- **`src/`** — all plugin logic, one concern per module (originally migrated mechanically from the monolithic `main.js`; runtime behavior preserved):
  - `src/main.ts` — entry point; default-exports `BobPlugin`
  - `src/plugin.ts` — `BobPlugin`: registers views, commands, hotkeys, settings, reminders, workbook commands
  - `src/bundled/templates.ts` — `BUNDLED_WORKSPACE_TEMPLATES` via explicit JSON imports of `templates/workspace-*.json` (a new shipped template must be added here; the template-bundle test enforces coverage)
  - `src/bundled/xlsx.ts` — `loadBundledXLSX()`: lazy `require()` of `vendor/xlsx.mini.min.js`, inlined by esbuild (no eval; compiled on first `getXLSX()` use)
  - `src/nav.ts` — `VIEW_TYPE_BOB_APP`, `BUILTIN_NAV_GROUPS`, runtime registries (`NAV_GROUPS`, `ALL_SURFACES`, `SURFACE_BY_ID`, `SECONDARY_TABS`, `WORKBOOK_EXPORT_GROUPS`), `resetWorkspaceRegistries()`, `applyWorkspaceRegistries()`
  - `src/entities.ts` — `ENTITIES`, `BUILTIN_ENTITY_DEFAULTS`, `DEAL_STAGES`, deal/activity field accessors, `BUILT_SURFACES`
  - `src/settings.ts` — `DEFAULT_SETTINGS`, `CURRENT_CURRENCY` (+`setCurrentCurrency()`), `ENTITY_FOLDERS`, `syncEntityFolders()`, `entityFolder()`, create-folder/template helpers
  - `src/workspace-config.ts` — plugin paths, `WORKSPACE_CONFIG` (+`setWorkspaceConfig()`), load/save/validate, `WORKSPACE_OWNED_SETTING_KEYS`, dashboard config validation/resolution
  - `src/widgets.ts`, `src/snapshots.ts`, `src/dashboards.ts` — widget source resolution, home/planner/productivity snapshots, widget catalog
  - `src/help-content.ts` — single source for all on-screen help text (field hovers, per-widget guides, Surface Designer + Settings help panels); the renderers hold no help strings (translation seam)
  - `src/bases-config.ts`, `src/bases-parse.ts` — Base paths, `generateMissingBases()`, `applyEntityDefinitions()`; `parseBaseFile()` + Base overrides
  - `src/schemas.ts`, `src/schema-designer.ts`, `src/runtime-config.ts`, `src/nav-helpers.ts` — schema loading/bootstrap, designer/codegen helpers, `reloadEntityConfiguration()`, nav-surface helpers
  - `src/utils.ts`, `src/entity-files.ts`, `src/csv.ts`, `src/workbook.ts` — date/format utils, entity file resolution + Base filter evaluation, CSV, XLSX export/import
  - `src/project-notes.ts`, `src/task-notes.ts`, `src/notes.ts`, `src/reminders.ts` — H2 sections/milestones, TaskNotes, entity/daily-note creation, reminder helpers
  - `src/canvas.ts` — JSON Canvas render layer: node taxonomy, semantic palette, stable IDs, layout engines (board / context-explosion / runway), generators (pipeline / entity-context / agent-audit / process), and manual-edit merge — see "Canvas surfaces"
  - `src/modals/` — `capture.ts`, `import.ts`, `entity-create.ts`, `common.ts` (prompt/confirm/icon picker), `workspace-setup.ts`
  - `src/views/app-view.ts` — `BobAppView` (largest module; renders all surfaces)
  - `src/settings-tab.ts` — `BobSettingTab`
  - `src/views/playbook-runner.ts` — optional Bases custom view
  - `src/workspace-templates.ts` — template seeding/loading/applying, `_assets`, archive-on-switch

  Module-level mutable registries (`WORKSPACE_CONFIG`, `CURRENT_CURRENCY`) are reassigned across modules only via their exported setters — ES module imports are read-only live bindings.

- **`styles.css`** — Fallback styles for any theme. Organized by component: app shell, dark mode, nav, cards, modals, inputs, tables, kanban.
- **`manifest.json`** — Plugin metadata (id `bob-workspace`, version, min app version).
- **`versions.json`** — Version → min-app-version mapping for the Obsidian store.
- **`vendor/xlsx.mini.min.js`** — Source for the SheetJS (mini) library that the build inlines into `main.js`. Not loaded directly at runtime.

### Key Classes

| Class | Responsibility |
|-------|----------------|
| `BobPlugin` | Plugin entry point; registers views, commands, hotkeys, settings, reminders, reload behavior, workbook commands, and the optional Bases custom view |
| `BobAppView` | Main view rendering the app shell, responsive nav, all internal surfaces, generic tables, detail forms, dashboards, reports, and kanban |
| `BobSettingTab` | Settings UI: modules, surfaces, folders, Bases, schemas (Data model), tasks, reminders, export/import, currency, and `workspace.json` |
| `BobCaptureModal` | Quick-capture modal (text + optional reminder, datetime, repeat) |
| `BobReminderEditModal` | Reminder editor for inbox items |
| `BobImportModal` | CSV import with column mapping |
| `BobEntityCreateModal` | Generic create modal for any entity type |
| `BobPromptModal` / `BobConfirmModal` | Prompt / yes-no confirmation modals (use instead of `window.confirm()`) |
| `BobWorkspaceSetupModal` | First-run / "Apply workspace template…" picker |
| `BobPlaybookRunnerView` | Registers `agent-client-playbook-runner` as an Obsidian Bases custom view when that API exists |

### Nav Structure

`NAV_GROUPS` defines the left-nav hierarchy. Each nav item has:
- `id` — surface ID used for routing (e.g. `crm.pipeline`)
- `label`, `icon`, `desc`
- `module` — which module toggle gates this item (`crm`, `prm`, `planner`, `client-work`, `finance`, `procurement`)
- `entityKey` — links to `ENTITIES` key for generic list/kanban rendering
- `folderKey` — links to `DEFAULT_SETTINGS` key for folder configuration
- `navLevel` — `'secondary'` (shown only when parent is active) or `'setup'` (shown only when Setup nav is enabled)
- `parent` — surface ID of the parent when `navLevel` is set

**Built-in vs configured nav.** The hardcoded `BUILTIN_NAV_GROUPS` ships only two groups — **`home_group`** (Home) and **`misc`** (Team, Settings, Surface Designer, Export, Import) — and both have an **empty `label`**. The renderer draws a group header only when `group.label` is truthy (`if (group.label)` in `BobAppView.render()`), so a label-less group's items render directly with no section heading — which is why `misc` shows no label. The rich groups (Planner, CRM, Marketing, PRM, Client Work, Finance, Procurement, HR & People, Reports, AI Workspace, Research & Knowledge, Audit) are **not hardcoded**; they come from the active `workspace.json` `navigation.groups`, applied at runtime by `applyWorkspaceRegistries()`. `BUILTIN_SECONDARY_TABS` and `BUILTIN_WORKBOOK_EXPORT_GROUPS` are likewise empty and populated from `workspace.json`. Navigation is module-driven; `showSecondaryNav` and `showSetupNav` control whether lower-frequency children appear in the left rail (still reachable via parent tabs).

**`SECONDARY_TABS`** — runtime object (built from `workspace.json` `navigation.secondaryTabs`) mapping parent surface IDs to arrays of sub-tab definitions, used by workspace surfaces (e.g. `client-work.overview`, `finance.gl`, `prm.partners`) to render an inner tab bar. A surface with `SECONDARY_TABS` entries renders its first sub-tab automatically (see `BobAppView.render()`), which is how custom parent surfaces work without a hardcoded renderer.

**`WORKBOOK_EXPORT_GROUPS`** — runtime object (from `workspace.json` `workbookGroups`) grouping entities into sheets for XLSX export. The shipped templates define groups such as Planner, CRM, Client Work, PRM, Finance, Suppliers & Procurement, and AI Workspace.

### Current Surfaces and Modules

- **Planner**: Inbox, Today, Calendar, TaskNotes, Projects, Ideas
- **CRM**: Dashboard, Pipeline, Contacts, Clients, My Companies, Leads, Campaigns/Sequences, Activities, Products
- **Client Work**: overview plus Meetings, Comms, Deliverables, Feedback, Surveys, Testimonials, Decisions; overview selectors filter by client and project
- **PRM**: Partners, Registrations, Commissions, Certifications, Analytics
- **Finance**: Customer Invoices, General Ledger, Finance Setup, Assets & Close, Tax, and their accounting/compliance child entity lists
- **Suppliers & Procurement**: Suppliers, Supplier Invoices, Purchase Requisitions, Purchase Orders
- **Reports**: Pipeline, Sales, Partners, Activity, Productivity, KPI Scoreboard
- **Team**: a filtered People/contact view using configurable `person_category` values, not a separate entity
- **AI Workspace**: Playbooks and Skills

The shipped `templates/workspace-bob.json` also ships four **schema-backed domains** that are not built-in code modules — they come entirely from `workspace.json` nav/tabs/bases plus template `_assets` schemas: **Marketing** (content), **HR & People** (Recruiting, Payroll), **Research & Knowledge** (research hub), and **Audit** (Operational Audit; a tabs-only parent whose Overview tab routes to the `audit.dashboard` dashboard). The `misc` group also carries a **Base Links** surface and a built-in **Canvases** surface (`misc.canvases` — see "Canvas surfaces"). Because these domains are config/schema-driven, they are edited in `workspace.json` and schema YAML, not `src/` — see "Built-in vs configured nav".

Important specialized behavior:
- Pipeline is a deal kanban. Drag-to-change-stage is desktop-only; mobile opens cards for editing rather than relying on HTML drag events.
- Generic entity tables support sorting, enum column filters, inline editing, multi-select, and bulk trashing.
- Entity detail forms use frontmatter writes; project detail also edits note body sections and task/milestone markdown.
- Non-table Base views (board, calendar, cards) **render inline** as a live Obsidian Base embed (`![[file#view]]`, mounted via the embed registry with the view in the `#View` subpath); an `Open Base` action remains for opening the Base in a full tab. Table views keep the plugin's own editable inline table.
- Client Work child lists force the internal table so configured non-table Base views do not make those embedded lists disappear.
- Mobile layout includes a navigation drawer, compact briefing behavior, and safe-area/responsive CSS.

### Data Model

**Entities** are plain markdown files with YAML frontmatter. The `ENTITIES` constant defines fallback labels, fields, columns, folder/type matching, and specialized metadata:

```typescript
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

```typescript
await app.fileManager.processFrontMatter(file, (fm) => { fm.stage = 'won'; });
```

Body markdown is edited separately only where the feature is genuinely body-based (project sections, daily-note task lists):

```typescript
const content = await app.vault.read(file);
const updated = replaceSection(content, '## Brief', newText);
await app.vault.modify(file, updated);
```

**`BUILTIN_ENTITY_DEFAULTS`** — deep clone of `ENTITIES` taken at startup; used to reset to defaults when schemas reload. Built-in entities cover planner, CRM, client-work, PRM, supplier/procurement, finance/tax, plus `playbook` and `skill`.

**Built-in entity keys (40+):** `contact`, `company`, `client`, `supplier`, `partner`, `registration`, `commission`, `lead`, `certification`, `activity`, `meeting`, `comms-thread`, `deliverable`, `feedback`, `survey`, `testimonial`, `decision`, `campaign`, `sequence`, `project`, `task`, `accounting-period`, `bank-account`, `bank-reconciliation`, `chart-of-accounts`, `financial-statement`, `fs-notes`, `fx-rates-table`, `inventory`, `invoice`, `journal-entry`, `purchase-order`, `purchase-requisition`, `supplier-invoice`, `trial-balance`, `vat-return`, `corporate-tax-return`, `deferred-tax`, `transfer-pricing`, `free-zone-status`, `legal-rule`, `document-retention`, `deal`

**Deal entity extras:** `valueField`, `closeByField`, `wonStages`, `lostStages`. Access via `dealValueField(def)`, `dealWonStages(def)`, `dealLostStages(def)`, `dealTerminalStages(def)`. (`closeByField` is preserved in config but has no dedicated accessor.)

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

Within the `folders` array the logic is OR; between different filter types the logic is AND. **Template paths are excluded:** any note under a directory segment named `template`/`templates` must not appear in entity lists, counts, dashboards, or workbook exports. **Ignored folders are excluded too:** the `ignoredFolders` setting (Settings → BOB Workspace → App → "Ignored folders") is a list of top-level (or nested) vault folders dropped from every entity scan — use it for uncurated trees like `99-TMP` that hold no records, to speed up large vaults. It is portable (in `WORKSPACE_OWNED_SETTING_KEYS`, so it lives in `workspace.json`) and synced module-level by `syncEntityFolders()` into `IGNORED_FOLDERS`/`isIgnoredPath()` (`src/settings.ts`) so `listEntityFiles()` can consult it without threading settings. **It only filters the plugin's own scans — Obsidian core search, graph, and quick-switcher are untouched** (use Obsidian's own *Excluded files* setting if you also want those hidden).

**Scan cache (perf):** `scannableMarkdownFiles(app)` (`src/entity-files.ts`) caches the vault-wide pre-filtered file set — every markdown file that is neither a template nor under an ignored folder — so a multi-widget dashboard scans the vault **once per render** instead of once per widget. The cache is invalidated by `invalidateEntityScanCache()` on any vault `create`/`delete`/`rename` and `metadataCache` `changed` event (registered plugin-level in `src/plugin.ts`, so it stays coherent even when no view is open) and in `refreshOpenViews()` (covers settings/schema reloads). Between those events the vault is unchanged, so it is safe for all callers (dashboards, snapshots, exports).

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

`data.json` is no longer the source for portable workspace-owned settings. `BobPlugin.loadSettings()` reads plugin data, then loads `workspace.json`, then overlays `workspace.json.settings` for keys in `WORKSPACE_OWNED_SETTING_KEYS`. `saveSettings()` removes owned keys from plugin data and writes them back to `workspace.json` whenever a workspace file exists or an owned setting is non-default (a `workspace.backup.json` is written first) — **except when the on-disk `workspace.json` failed to load** (`WORKSPACE_LOAD_FAILED`), in which case incidental saves are skipped so the unparseable file is preserved. Personal/non-workspace settings stay in plugin data.

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
4. Resolve schema settings (top-level `workspace.json.schemas` overrides settings), then `applySchemas()` if enabled. A schema can introduce a generic record type without plugin code. (A top-level `workspace.json.entities` key is **no longer applied** — `validateWorkspaceConfig` rejects it; define record types in schema YAML.)
5. Merge top-level `workspace.json.bases` with `applyConfiguredBaseOverrides()` (these paths win over `settings.baseFiles`).
6. Merge remaining settings-selected `.base` behavior with `applyBaseOverrides()`; `settings.baseViews` can override the default view for either source.
7. Rebuild surface lookups.

Do not assume edits to `ENTITIES` alone control a BOB vault when schemas, custom overrides, or Bases are active.

### Schema loading (`applySchemas`) and the Data model designer

When schema support is enabled (top-level `workspace.json.schemas.enabled`, else `settings.useSchemas`), `applySchemas(app, settings)` reads YAML from the schema folder (default `00-CORE/Schemas/source`) and merges field/column/type/folder definitions into `ENTITIES` at runtime. Schema fields map: `type_value` → `typeFilter`, `location_pattern` → folder(s), `fields` → fields, `key_fields[0]` → primary; columns default to the first ~5 fields.

If the schema source folder is empty, the bootstrap path (`bootstrapCanonicalSchemaSourcesIfMissing` → `bootstrapCanonicalSchemaSources`) seeds canonical YAML from current entity definitions, then `regenerateSchemaOutputs()` writes derived Metadata Menu FileClasses (`<root>/fileClasses`) and JSON Schemas (`<root>/json-schema`, named by `type_value`), pruning stale outputs in the active folder.

- Settings includes a **Data model designer** for canonical schema YAML: creates entity source files, edits identity/location, icons, discriminators, co-required relationships, import `field_aliases`, create `default` values (`{{today}}` resolved for date fields), display hints and ordered fields; writes `<schema>.backup` before save and reloads runtime config immediately.
- In file-managed workspaces, Settings authoring must **not** expose fallback built-in entities as available/unassigned record types — the available set is limited to canonical schema YAML plus entity keys referenced by the active `workspace.json`. Home and other specialized screens follow the same boundary.
- Header buttons live in `workspace.json.navigation.actions` keyed by surface id; entity actions render from the configured schema/form; non-entity actions must be explicit supported ids (e.g. `quick-capture`, `today-task`). When a surface has configured header actions, don't add legacy hardcoded create buttons beside them.
- A selected Base/view can order visible columns but must not remove schema-defined fields from create/import. Unsupported Base filters are surfaced as UI warnings — preserve that transparency.

### Surfaces (Views)

Tab-based internal nav, dispatched in `BobAppView.render()` via a route map (then `SECONDARY_TABS` parents, then entity lists, then "coming soon"):

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
| `misc.canvases` | `renderCanvasLibrary()` — the canvas library (see "Canvas surfaces") |

The **full-page canvas host** is not a route: when `this.canvasFile` is set it trumps surface routing (like the detail-view state), rendering `renderCanvasSurface()`.

Specialized views (Pipeline kanban, CRM Dashboard, Reports) primarily route through the dashboard/widget system. The widget catalog (`PURE_DASHBOARD_WIDGET_TYPES` + `dashboardWidgetSchema`, `src/dashboards.ts`/`src/workspace-config.ts`) covers read-only widgets (`list`, `metric`, `gauge`, `progress`, `heatmap`, `bar-chart`, `kanban`, `selector`, `date-range`, `markdown`, `actions`, `base-link`/`-embed`/`-view`, `merge`) plus **interactive** ones that write back to notes: `task-list` (toggles a task's status/daily-note checkbox), `quick-add` (appends a task to today's note), `note-section` (edits a daily-note body heading), and `date-hero`. Each widget's editable fields are gated by its schema `supports` list; the Surface Designer's Base picker points a widget's `source` at any `.base` in the vault. A per-kind guide lives in `src/help-content.ts`. `home` and `reports.productivity` are config-driven, but some source data is still produced by runtime snapshot helpers (intentional for now; the Base-first path is to materialize that runtime state into notes/frontmatter and point widgets at `source.base`/`source.view`). Small dashboard UI choices that should survive restart (selector picks, date ranges) persist in `workspace.json.settings.dashboardState` — keep that to user intent only; recompute metrics/rows on render.

**Why Home is slower than CRM, and what's been done.** Both surfaces share `renderConfigDashboard`, which paints cards **sequentially** (`await` per card, to preserve layout order). CRM widgets use `mode: 'entity'` → data from `metadataCache` (frontmatter, in-memory) so the sequential paint is imperceptible. Home's sections use `mode: 'built-in'` (`builtIn: 'home' | 'productivity' | 'planner'`, `src/widgets.ts`) → `buildHomeSnapshot`/`buildProductivitySnapshot`/`buildPlannerSnapshot` (`src/snapshots.ts`) which read full note **bodies**, so without help Home reveals section by section. Two mitigations are in place: (1) snapshot/project body reads use `app.vault.cachedRead()` (not `read()`) to serve unchanged files from memory; (2) `renderConfigDashboard` pre-resolves **all** layout widget sources in parallel (`prewarmLayout`) before the paint loop, so the slow snapshot resolutions overlap and the paint hits already-resolved promises (reuses the per-render `widgetCache`; idempotent). These reduce the gap but don't close it — Home still reads bodies where CRM reads only frontmatter; the structural fix is the Base-first migration above (#3).

### Canvas surfaces (JSON Canvas render layer)

BOB treats **Obsidian Canvas** (`.canvas`, the open [JSON Canvas](https://jsoncanvas.org) MIT spec — JSON `nodes`/`edges` with coordinates) as a **render target for context surfaces**, not a manual drawing feature. `.canvas` files are JSON, not markdown, so they sit **outside** the entity/schema/Base model (the entity scanner is markdown-only and Bases can't index them); canvas is a display/navigation layer with its own scan path.

**Reaching + viewing (Phase 1).**
- **Canvas library** — the built-in `misc.canvases` surface (`renderCanvasLibrary()`) lists every `.canvas` in the vault via a non-markdown scan (`_scanCanvasFiles()` → `app.vault.getFiles()` filtered to `.canvas`, template folders excluded), with search and Open / Open-in-tab actions. Registered in `BUILT_SURFACES`, `BUILTIN_NAV_GROUPS` (misc), and the shipped BOB template; also the command **"Open BOB Workspace — Canvases"** (always reachable regardless of nav config).
- **Full-page inline host** — `openCanvas(file)` sets `this.canvasFile` (trumps routing); `renderCanvasSurface()` mounts the **real interactive `CanvasView`** by creating an ephemeral `WorkspaceLeaf` (`new (obsidian as any).WorkspaceLeaf(app)`), `setViewState({type:'canvas', state:{file}})`, and **reparenting its DOM** into the pane (`_mountLiveCanvas`). This is unofficial internals — guarded, with an open-in-tab fallback. The embed registry only yields a static preview, so it is not used. The leaf is detached on every re-render/navigation/`onClose` (`_teardownCanvasLeaf()` — nulls its handle first, then explicitly unloads the view before `detach()`, since an ephemeral leaf's `detach()` may not run `onunload`), the mount bails + detaches if `canvasFile` changed during the async load, and incidental refreshes (reminder tick in `refreshOpenViews`, vault/metadata events) **skip a view with `canvasFile` set** so the hosted canvas isn't torn down mid-edit. **Re-test on each Obsidian upgrade:** this `WorkspaceLeaf`-ctor hosting and the `embedRegistry.embedByExtension` base-view embed are the two unofficial-internals dependencies (both guarded with fallbacks). Generated canvases are written to `settings.canvasFolder` (default `BOB Workspace/Canvases`), and the library scan honors `ignoredFolders`/template-path exclusion.

**Generating from data (Phase 2, `src/canvas.ts`).** Deterministic, structured writes — no unstable API. Shared foundations:
- **Node taxonomy** (spec-compatible): `entityCard`=file · `insightCard`=text · `externalCard`=link · `zone`=group · `signalEdge`=labelled edge.
- **Semantic palette** `BOB_COLOR` → JSON Canvas preset colors 1..6 (red=risk, orange=attention, yellow=pending, green=healthy, cyan=info, purple=AI/insight).
- **Stable IDs** — `canvasNodeId(intent, source, role, target)` (djb2 `shortHash`), so regeneration keeps edge references.
- **Layout engines** — `buildBoardCanvas` (columns), `buildContextExplosion` (focal centre; left=evidence, top=people/systems, right=outputs, bottom=risks; summary node), `buildProcessRunway` (left→right lanes + flow edges).
- **Generators** — `buildPipelineCanvasData` (deals by stage), `buildEntityContextCanvas` (links + backlinks + linked URLs, bucketed by entity type), `buildAgentAuditCanvas` (agent-run notes: `ai-session-log`/agent signals → context/agents/skills/outputs/cost), `buildProcessCanvas` (any entity with a stage/status lifecycle via `entityLifecycle`).

**Entry points.** Entity detail → **Context canvas** button (`_generateContextCanvas`, auto-routes agent-runs to the audit surface via `isAgentRunFile`); entity list → **Process canvas** button when `entityLifecycle(def)` exists (`_generateProcessCanvas`); the Canvases library → **+ Generate** menu (`CANVAS_GENERATORS`); and the command **"BOB: Context canvas for active note"**.

**Output + preservation.** All generators route through one writer `_writeGeneratedCanvas(name, data, manifest)` → `BOB Workspace/Canvases/<name>.canvas` at a **stable path** (regenerate-fresh, no dated pile-up), plus a **render-manifest sidecar** `<name>.canvas.bobmeta.json` (`CanvasManifest`: source, template, query hash, `bob_owned_node_ids`). The `.canvas` stays 100% standard. **Manual-edit preservation:** on regeneration `mergeGeneratedCanvas(existing, oldOwnedIds, fresh)` replaces BOB-owned nodes/edges and **keeps user-authored ones** (dropping user edges to now-missing endpoints); `ownedIdsOf(data)` records what BOB owns. BOB owns the *layout + content* of its nodes (moving a BOB node resets on regen); the user owns anything they add.

### XLSX, tasks, import/export

- `exportEntitiesXLSX(app, entityKeys, suffix, settings)` exports one sheet per entity type. The library loads lazily via `getXLSX(app)` → inlined `loadBundledXLSX()` (SheetJS mini). Output: `settings.workbookExportFolder` (default `BOB Workspace/Exports`). Commands: `bob-workspace-export-xlsx`, `bob-workspace-import-xlsx`.
- Task modes: `checkbox`, `tasknotes`, `hybrid`. TaskNotes lists use the active TaskNotes folder; Productivity history may read active + archive.
- Quick capture writes reminder state into settings and attempts to add a checkbox item to the relevant daily note.
- CSV import maps columns into entity frontmatter via entity definitions (with `field_aliases` synonyms).
- When changing entity fields, verify create/edit UI, generic list behavior, CSV import, XLSX import/export, configured Bases, and schema-derived entities.

### Key Patterns

```typescript
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

1. Edit `src/**/*.ts`, `styles.css`, `templates/workspace-*.json`, or `vendor/xlsx.mini.min.js` as needed. **Never edit `main.js` directly — it is generated.**
2. Run `npm run build` (one-shot) or `npm run dev` (watch) to regenerate `main.js`. Templates and the XLSX library are bundled in automatically; the regression suite fails if the committed `main.js` is stale.
3. Copy to test vault: `cp main.js styles.css manifest.json <vault>/.obsidian/plugins/bob-workspace/`.
4. Reload in Obsidian: Settings → Community plugins → BOB Workspace → Disable/Enable (a full restart may be required for `main.js` changes).
5. Check console: Command palette → "Toggle developer tools".
6. Run `npm run check` — typecheck (`tsc --noEmit`), production build, `node --check main.js`, and the regression suite (`node tests/run-tests.js`).

### Bundled assets (templates + XLSX)

Obsidian's installer delivers only `main.js`/`manifest.json`/`styles.css` — it does **not** ship `templates/` or `vendor/`, and `fs`/`__dirname`/`require()` against plugin paths don't work in the runtime. So two asset sets are **bundled into `main.js`** by esbuild:

| Bundle | Module | Source | Mechanism |
|--------|--------|--------|-----------|
| Workspace templates | `src/bundled/templates.ts` | `templates/workspace-*.json` | explicit esbuild JSON imports (add a new shipped template's import + key there) |
| XLSX library (SheetJS mini) | `src/bundled/xlsx.ts` | `vendor/xlsx.mini.min.js` | lazy `require()` inlined as an esbuild CommonJS closure |

**`npm run build` after editing any source, and copy the regenerated `main.js`.** The build-freshness test fails if the committed `main.js` is stale; the template-bundle test fails if a `templates/workspace-*.json` file is not wired into `src/bundled/templates.ts`.

- `templates/workspace-*.json` and `vendor/xlsx.mini.min.js` remain the editable **sources of truth**; they are not loaded at runtime.
- `loadWorkspaceTemplates()` serves the bundled templates (authoritative for shipped names); on-disk templates can only **add** custom ones.
- The XLSX lib is inlined as a lazily-executed CommonJS module (no string + `eval`), so V8 compiles it on first `getXLSX()` use and there is no `eval` for the store reviewer to flag.
- Applying a template writes the full config — including all dashboards — into `workspace.json`, so it is visible/editable in Settings. There is no hidden builtin-dashboard fallback: a surface with no entry in `workspace.json` shows the "Add dashboards.xxx" prompt by design.
- **Template `_assets`** — a template may carry `_assets: { schemas: {<entity>: <yaml>}, bases: {<file>: <yaml>} }`. `applyWorkspaceTemplate()` strips `_assets` (and `_template`) before validating the config, then `writeTemplateAssets()` writes those files (missing-only) into the schema folder / Bases folder **before** the bootstrap. This is how a template whose entities are NOT built-in (e.g. `workspace-emai`, a PARA workspace with `tasks`/`people`/`video`/…) seeds exactly its own entities: the schemas exist first, so `bootstrapCanonicalSchemaSourcesIfMissing` stays gated and the full built-in entity set is never written. **`workspace-bob` ships its `_assets` fully** — the canonical schema YAML for **every** entity it references (built-in included) plus every mapped `.base` — because the code `ENTITIES` defaults are only a lean bootstrap seed (41/45 built-ins are materially richer in the shipped schemas, e.g. `invoice` 27 fields vs code's 9). So a fresh BOB vault gets the full data model + display layer from the assets, and code `ENTITIES` acts purely as a fallback (Minimal/CRM-only, or schemas-off). `contact` is shipped as `person.yaml` (`SCHEMA_TO_ENTITY_KEY: person → contact`). The trade-off: the shipped assets are the source of truth, so vault schema/Base improvements must be **re-promoted** into `workspace-bob.json`'s `_assets` to reach fresh installs — and inlining them makes `main.js` ~1.6 MB (accepted for a self-seeding vault; the alternative is a broken fresh install).
- **Clean template switching** — when `applyWorkspaceTemplate()` is called with a template whose id differs from `settings.activeWorkspaceTemplate`, `archiveTemplateAssets()` first moves the OUTGOING template's full schema state — source YAML, the derived `fileClasses/` + `json-schema/` outputs (same `/source$`→root derivation as `regenerateSchemaOutputs`), `.base` files, and a labelled `workspace-<prevKey>-<stamp>.json` — into sibling `<folder>-archive-<prevKey>-<timestamp>` folders. Reversible (moves, never deletes). This prevents switches from compounding files on disk; `regenerateSchemaOutputs` only prunes the *active* schema folder, so without this the old derived outputs would orphan when templates use different schema roots. Re-applying the same template skips archiving (idempotent, missing-only).

### Code style & development rules

- TypeScript in `src/`, bundled by esbuild (cjs, target es2021) into the committed `main.js`. The codebase is fully annotated: `noImplicitAny`, `noImplicitThis`, and `strictBindCallApply` are enforced; the shared domain model lives in `src/types.ts`. Explicit `any` is reserved for documented dynamic boundaries (frontmatter values, user-authored dashboard JSON, the untyped Bases API) — do not add new ones. `strictNullChecks` is the remaining gap (enable module-by-module). Type-only changes must never alter runtime behavior. Prefer small, scoped edits in `src/`/`styles.css`.
- Frontmatter I/O via `processFrontMatter()` only; vault body writes only for markdown sections/tasks outside frontmatter.
- DOM: `createDiv()`, `createEl()`, `appendChild()`/`setText()`; keep BEM-style class names prefixed `bob-`/`bob-`; verify light and dark.
- Events: `registerEvent()` for vault/metadata; standard `addEventListener` for DOM. Use `BobConfirmModal`/`confirmModal()` instead of `window.confirm()`.
- No `console.log` in shipping code; no unsafe raw `innerHTML` for untrusted vault content.
- Deliver reviews, findings, and reports as chat/terminal output and/or files in this repo. Never upload or publish repo content to external hosting (claude.ai Artifacts, gists, pastebins, etc.) unless the user explicitly asks for a hosted/shareable page.
- Respect responsive/mobile behavior for interactive changes.
- Preserve BOB Workspace branding and compatibility names unless deliberately changing public identity.
- Keep `vendor/xlsx.mini.min.js` in the repo and re-run `npm run build` after updating it.

### Adding a new built-in entity type (in code)

1. Add to `ENTITIES` (`src/entities.ts`) with `folder`, `typeFilter`, `label`, `plural`, `fields`, `columns`.
2. Add a folder setting key to `DEFAULT_SETTINGS` and handle it in `syncEntityFolders()` (`src/settings.ts`) + the Folders settings UI (`src/settings-tab.ts`).
3. Add a nav item to the navigation groups (workspace.json `navigation.groups`, or `BUILTIN_NAV_GROUPS` in `src/nav.ts` for built-ins) — include `entityKey`, `folderKey`, `module`.
4. Add to the `BUILT_SURFACES` set (`src/entities.ts`).
5. Add a route entry in `BobAppView.render()` (`src/views/app-view.ts`) pointing to `renderEntityList()`.
6. Add a `baseFiles` entry in `DEFAULT_SETTINGS` — the **filename** is what matters (e.g. `'People.base'`; see Bases). Both `entityBasePath` and the runtime Base-override merge (`applyBaseOverrides`/`applyConfiguredBaseOverrides`) resolve through `entityBasePath`, so a filename-only path composes with `basesFolder` in every path.
7. Add inner tabs in `SECONDARY_TABS` if it belongs under a workspace.
8. Add to `WORKBOOK_EXPORT_GROUPS` in the appropriate group's `entityKeys`.
9. Verify schemas, custom overrides, Bases, create/edit, and import/export.

For vault-configured entity types **without** touching source, use a schema YAML file instead.

### Bases (.base files)

`entityBasePath(settings, key)` resolves an entity's `.base` reference, taken (in order) from `WORKSPACE_CONFIG.bases[key].file`, `settings.baseFiles[key]`, the built-in default, or — for schema-defined entities with none of those — a name derived from the entity (e.g. `area` → `Areas.base`). Resolution honors the **shape** of the reference: a value that includes a directory (e.g. `20-COMPANY/skills.base`) is an **explicit vault location, honored verbatim**, so a base can live anywhere — not only under `basesFolder`; a **bare filename** (e.g. `People.base`) composes with `settings.basesFolder` (default `00-CORE/Bases`) and therefore relocates when the Bases folder changes. The base picker lists every `.base` in the vault by full path and stores that path, so a picked base is always honored. `bases[key].view` still selects which view to use.

`generateMissingBases(app, settings)` (command **"Generate missing bases"** / Settings → Data model → Bases) writes a `.base` for each known or schema-registered entity lacking one — a `filters` clause from the entity's `type_value`/`typeFilters`/folder, and a `table` view whose `order` lists the columns (`file.name` for the primary field, `note.<key>` otherwise), with `properties.<id>.displayName` for readable headers. Missing-only: existing files are never overwritten. **In a Base, `order`/`sort` use bare property names (`person_category`), while `properties` keys and `filters` use the `note.<prop>` form; `file.name` is the primary field's column** — match this when hand-authoring or generating.

A Base mapping is optional for simple lists (which render from folder/type), but required when the workspace needs Base-specific filters, column order, grouping, sorting, or an external non-table Base view.

### Adding a new surface with custom rendering

1. Add a nav item to the navigation groups (`{ id: 'group.surface', label, icon, module }`).
2. Add to `BUILT_SURFACES` in `src/entities.ts` (prevents the "soon" badge).
3. Add a route in `BobAppView.render()` (`src/views/app-view.ts`): `'group.surface': () => this.renderMySurface(content)`.
4. Implement `renderMySurface(root)` on `BobAppView`, preserving mobile/theme behavior.

For inner tabs, add an entry to `SECONDARY_TABS` mapping the parent surface ID to `{ label, entityKey? | route? }` definitions.

### Editing project sections & milestone/task lists

```typescript
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

When supporting an existing vault that already has notes, follow `docs/installing-into-existing-vault.md`: describe the vault's real record types with schema YAML (matching the notes' existing `type:`/folders/fields — the bootstrap is gated so it won't overwrite them), regenerate derived outputs, wire bases, then compose the `workspace.json` UI. Prefer describing/importing what exists over restructuring the vault or relying on hidden plugin state.

### Validation

For relevant changes:

1. `npm run check` — `tsc --noEmit`, production build, `node --check main.js`, and the regression suite.
2. Review edits for untrusted DOM insertion, frontmatter mutation, and a stale committed `main.js` (rebuild + commit together with `src/`).
3. Copy shipping files to a test vault plugin folder.
4. Reload or restart Obsidian and inspect the developer console.
5. Exercise affected surfaces, settings, light/dark appearance, and mobile layout where UI changed.

---

## Common Issues

**Changes to `src/` don't take effect.** Run `npm run build` and re-copy `main.js` to the vault plugin folder first; then a full restart of Obsidian is required, not just disable/enable.

**Frontmatter corrupted.** Always use `processFrontMatter()`. Never string-replace YAML.

**New entity type lists nothing.** Check `entityFolder(key)` returns the correct path and the `primary` field is set; for schema entities confirm the schema folder and `type_value`.

**Moving entity folders.** Rename the folder in the vault first, then update the path in Settings → BOB Workspace → Folders. Files are not moved automatically.

**XLSX export fails.** The library is inlined into `main.js` from `vendor/xlsx.mini.min.js` at build time. If it errors, the committed bundle is likely stale — run `npm run build` and recopy `main.js`.

**Complete built-in entity set appears in a custom vault.** The schema bootstrap seeds built-in entities when the schema folder is empty. Keep the vault's own schemas present (or use a template with `_assets`) so the bootstrap stays gated.

---

## Publishing

See `SUBMISSION.md` for the full release checklist. Key reminders:

- `manifest.json` version must match the git tag exactly (no `v` prefix); `versions.json` must map the new version → min-app-version. Keep `package.json`'s `version` in sync too (cosmetic only — nothing functional reads it — but a stale value confuses reviewers/contributors).
- Release assets only need `main.js`, `manifest.json`, `styles.css` (and `versions.json`) — templates and the XLSX library are bundled into `main.js`. Rebuild and verify before tagging: `npm run check` (the build-freshness test fails if the committed `main.js` is stale).
- No `console.log`, unsafe/untrusted `innerHTML`, or raw frontmatter string manipulation in shipping code.
- Treat `manifest.json`/`versions.json` as authoritative; confirm any inherited `SUBMISSION.md` instructions before reusing old plugin IDs, repo URLs, or asset lists.
