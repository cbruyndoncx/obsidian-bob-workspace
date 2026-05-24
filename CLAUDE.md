# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Repo:** `cbruyndoncx/obsidian-bob-workspace` · **Local:** `/home/cb/projects/github/obsidian-bob-workspace`

---

## Project Overview

**BOB Workspace** is an Obsidian plugin (forked from Cadence) providing a unified workspace for CRM, PRM, Client Work, Finance, Procurement, project management, daily planning, and reminders—all backed by plain markdown.

The plugin has **no build step**. It's pure JavaScript loaded directly by Obsidian's plugin system. The three files (`main.js`, `manifest.json`, `styles.css`) are copied directly to `<vault>/.obsidian/plugins/bob-workspace/` and used as-is.

Plugin ID: `bob-workspace` (not `cadence-planner` — the upstream Cadence ID).

---

## Architecture

### File Organization

- **`main.js`** — All plugin logic. Organized top-to-bottom as:
  - Nav structure: `NAV_GROUPS`, `ALL_SURFACES`, `SURFACE_BY_ID`, `SURFACES_BY_ENTITY_KEY`, `SECONDARY_TABS`, `WORKBOOK_EXPORT_GROUPS`
  - Entity registry: `ENTITIES`, `BUILTIN_ENTITY_DEFAULTS`, `DEAL_STAGES`, deal/activity field accessor functions
  - Settings: `DEFAULT_SETTINGS`, `CURRENT_CURRENCY`, `ENTITY_FOLDERS`, `syncEntityFolders()`, `entityFolder()`
  - Schema loader: `applySchemas()` — reads Metadata Menu YAML schema files into `ENTITIES` at runtime
  - Custom entity loader: `CUSTOM_ENTITY_KEYS`, `applyCustomEntities()`, `clearCustomEntities()`
  - XLSX export: `getXLSX()`, `exportEntitiesXLSX()` via bundled `vendor/xlsx.full.min.js`
  - Utility functions: date/time, file I/O, parsing, formatting
  - Modal classes: `CadenceCaptureModal`, `CadenceReminderEditModal`, `CadenceImportModal`, `CadenceEntityCreateModal`, `CadencePromptModal`
  - Main view: `CadenceAppView`
  - Settings UI: `CadenceSettingTab`
  - Plugin entry: `CadencePlugin`

- **`styles.css`** — Fallback styles for any theme. Organized by component: app shell, dark mode, nav, cards, modals, inputs, tables, kanban.

- **`manifest.json`** — Plugin metadata (id: `bob-workspace`, version, min app version).

- **`versions.json`** — Version → min-app-version mapping for Obsidian store.

- **`vendor/xlsx.full.min.js`** — Bundled SheetJS library for XLSX workbook export.

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

**`BUILTIN_ENTITY_DEFAULTS`** — deep-clone of `ENTITIES` taken at startup; used to reset to defaults when custom entities or schemas are cleared.

**Built-in entity keys (40+):** `contact`, `company`, `client`, `supplier`, `partner`, `registration`, `commission`, `lead`, `certification`, `activity`, `meeting`, `comms-thread`, `deliverable`, `feedback`, `survey`, `testimonial`, `decision`, `campaign`, `sequence`, `project`, `task`, `accounting-period`, `bank-account`, `bank-reconciliation`, `chart-of-accounts`, `financial-statement`, `fs-notes`, `fx-rates-table`, `inventory`, `invoice`, `journal-entry`, `purchase-order`, `purchase-requisition`, `supplier-invoice`, `trial-balance`, `vat-return`, `corporate-tax-return`, `deferred-tax`, `transfer-pricing`, `free-zone-status`, `legal-rule`, `document-retention`, `deal`

**Deal entity extras:** `valueField`, `closeByField`, `wonStages`, `lostStages` on the entity def. Access via `dealValueField(def)`, `dealCloseByField(def)`, `dealWonStages(def)`, `dealLostStages(def)`, `dealTerminalStages(def)`.

### Entity file resolution

`listEntityFiles(app, entityKey)` resolves which vault files belong to an entity. It checks these strategies in order — first match wins:

| Strategy | When used | How configured |
|---|---|---|
| `typeFilters` object | Multi-field frontmatter match (e.g. `{type:'profile', profile_type:'partner'}`) | `"typeFilters": {"type": "profile", "profile_type": "partner"}` |
| `typeFilter` string | Single frontmatter `type:` value (e.g. `type: person`) | `"typeFilter": "person"` |
| `folders` array | Files under any of the listed root paths (OR within array) | `"folders": ["10-ME", "20-COMPANY", "30-CLIENTS"]` |
| `typesFilter` array | Files whose `type:` matches any listed value (OR within array) | `"typesFilter": ["meeting", "research", "deliverable"]` |
| `folder` (default) | Single folder prefix — the standard case | Configured via Settings → BOB Workspace → Folders |

All filter conditions are **independent and AND-combined** — any subset can be used together. Within each array (`folders`, `typesFilter`) the logic is OR. Between different filter types the logic is AND.

New entities created via BOB Workspace get their `type:` frontmatter set from `typeFilter` / `typeFilters.type` (not the entity key). For `typeFilters` entities, extra discriminator fields (e.g. `profile_type`) are also written.

**`entityKeyFromFile(app, file)`** — reverse lookup: given any vault file, returns the entity key by matching frontmatter `type:` first, then path prefix fallback.

### Folder Resolution

Entity folders are resolved at runtime via `ENTITY_FOLDERS` (a module-level object). The full chain:

1. `ENTITIES[key].folders[0]` — wins if a `folders` array is set (schema/entities.json override)
2. `ENTITY_FOLDERS[key]` — set by `syncEntityFolders(settings)` on every load/save
3. `ENTITIES[key].folder` — hardcoded default in source

`syncEntityFolders(settings)` is called on every `loadSettings()`/`saveSettings()`. It also handles `project.folders` (multi-folder array when `projectFolders` setting has entries) and `task.folders` (combines active + archive folders for TaskNotes mode).

`entityFolder(key)` — the single lookup used everywhere.

### Schema Loading (`applySchemas`)

When `settings.useSchemas = true`, `applySchemas(app, settings)` reads YAML schema files from `settings.schemasFolder` (default `00-CORE/Schemas/source`) and merges field/column definitions into `ENTITIES` at runtime. This lets Metadata Menu schema files drive the entity model without editing source.

### Custom Entity Types (`entities.json`)

Users can add new entity types (or override fields on existing ones) by editing `entities.json` in the plugin folder (`.obsidian/plugins/bob-workspace/entities.json`, next to `data.json`). Edit via **Settings → BOB Workspace → Custom entities** (JSON-validated textarea, with backup), or use the command palette → **"Cadence: Create entities.json template"** to scaffold it. A legacy copy at `Cadence/entities.json` in the vault is auto-migrated on first load and retained as a safety copy.

```json
{
  "order": {
    "label": "Order",
    "plural": "Orders",
    "folder": "Cadence/Orders",
    "icon": "shopping-cart",
    "module": "crm",
    "fields": [
      { "key": "title",    "label": "Title",    "primary": true },
      { "key": "customer", "label": "Customer" },
      { "key": "status",   "label": "Status",   "type": "enum", "options": ["Draft", "Pending", "Fulfilled"] }
    ],
    "columns": ["title", "customer", "status"]
  }
}
```

- **New key** → entity added to `ENTITIES`, nav item injected into the `module` group (or a "Custom" group), generic list view auto-wired
- **Existing key** (e.g. `"contact"`) → overrides `fields`, `columns`, `label`, `plural`, `folder` on the built-in entity
- **Reload** — saving via the settings UI re-applies immediately; if you edit the file directly on disk, run **"Cadence: Reload entities.json"** from the command palette
- **`module`** — optional; slots nav item into `crm`, `prm`, `planner`, `client-work`, `finance`, or `procurement`; defaults to a "Custom" group

Internally: `applyCustomEntities(app)` reads the file, calls `clearCustomEntities()` first (removes previous custom keys from `ENTITIES`, `ENTITY_FOLDERS`, `BUILT_SURFACES`, and nav group items), then injects new ones. Custom surface IDs follow the `custom.{key}` pattern and are handled by a fallback branch in the route dispatch inside `CadenceAppView.render()`.

### Surfaces (Views)

Tab-based internal nav. Surfaces are dispatched in `CadenceAppView.render()` via a route map:

| Surface ID | Renderer |
|---|---|
| `home` | `renderHome()` |
| `planner.inbox` | `renderInbox()` |
| `planner.today` | `renderTodayPane()` |
| `planner.calendar` | `renderPlannerPane()` |
| `planner.tasknotes` | `renderEntityList()` (task entity) |
| `planner.projects` | `renderProjectsView()` |
| `crm.dashboard` | `renderCRMDashboard()` |
| `crm.pipeline` | `renderEntityKanban()` (deal/stage) |
| `crm.contacts` / `clients` / `companies` / `leads` / `activities` | `renderEntityList()` |
| `crm.campaigns` | secondary tabs + `renderEntityList()` |
| `client-work.overview` | `renderClientWorkDashboard()` + secondary tabs |
| `client-work.*` | `renderEntityList()` |
| `prm.partners` | secondary tabs + `renderEntityList()` |
| `prm.analytics` | `renderPRMAnalytics()` |
| `finance.*` / `tax.*` / `procurement.*` | secondary tabs + `renderEntityList()` |
| `reports.*` | dedicated report renderers |
| `custom.{key}` | `renderEntityList()` (fallback for custom entities) |

**Specialised views** (Pipeline kanban, CRM Dashboard, Reports) hardcode field names like `stage`, `deal_value`, `expected_close` — they use the deal field accessor functions and don't auto-adapt to arbitrary schema changes.

### XLSX Workbook Export

`exportEntitiesXLSX(app, entityKeys, suffix, settings)` exports one sheet per entity type into an `.xlsx` file. The library is loaded lazily via `getXLSX(app)` from `vendor/xlsx.full.min.js` (bundled with the plugin, not in the vault). Output path: `settings.workbookExportFolder` (default `BOB Workspace/Exports`). Commands: `bob-workspace-export-xlsx`, `bob-workspace-import-xlsx`.

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

1. Edit `main.js` or `styles.css`
2. Copy to test vault: `cp main.js styles.css manifest.json vendor/xlsx.full.min.js <vault>/.obsidian/plugins/bob-workspace/`
3. Reload in Obsidian: Settings → Community plugins → BOB Workspace → Disable/Enable
4. Check console: Command palette → "Toggle developer tools"

### Code Style

- No build step — ES6, compatible with Obsidian's Chromium runtime
- Frontmatter I/O via `processFrontMatter()` only
- DOM: `innerHTML` / `appendChild()`, BEM-style class names prefixed `cad-`
- Events: `registerEvent()` for vault/metadata; standard `addEventListener` for DOM
- No `console.log` in shipping code (SUBMISSION.md requirement)

### Adding a new built-in entity type

1. Add to `ENTITIES` in `main.js` with `folder`, `typeFilter`, `label`, `plural`, `fields`, `columns`
2. Add a folder setting key to `DEFAULT_SETTINGS` (e.g. `folderOrders: 'Cadence/Orders'`)
3. Add it to `syncEntityFolders()` and the Folders settings UI in `CadenceSettingTab`
4. Add a nav item to the appropriate group in `NAV_GROUPS` (include `entityKey`, `folderKey`, `module`)
5. Add to `BUILT_SURFACES` set
6. Add a route entry in the `route` map inside `CadenceAppView.render()` pointing to `renderEntityList()`
7. Add a `baseFiles` entry in `DEFAULT_SETTINGS` pointing to the `.base` file path
8. Add to `WORKBOOK_EXPORT_GROUPS` in the appropriate group's `entityKeys` array

For user-defined entity types without touching source, use `entities.json` instead.

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

**`entities.json` changes not picked up.** The active file lives in the plugin folder, not the vault. Save through Settings → BOB Workspace → Custom entities, or run **Cadence: Reload entities.json** after direct disk edits.

**XLSX export fails.** Ensure `vendor/xlsx.full.min.js` was copied alongside `main.js` to the plugin folder.

---

## Publishing

See `SUBMISSION.md` for the full release checklist.

Key reminders:
- `manifest.json` version must match the git tag exactly (no `v` prefix)
- `versions.json` must map the new version → min-app-version
- Release assets must include all four files: `main.js`, `manifest.json`, `styles.css`, `vendor/xlsx.full.min.js`
- No `console.log`, unsanitized `innerHTML`, or raw frontmatter string manipulation in shipping code
