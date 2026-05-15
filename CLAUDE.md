# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**Cadence** is an Obsidian plugin providing a unified workspace for CRM, PRM, project management, daily planning, and reminders—all backed by plain markdown.

The plugin has **no build step**. It's pure JavaScript loaded directly by Obsidian's plugin system. The three files (`main.js`, `manifest.json`, `styles.css`) are copied directly to `<vault>/.obsidian/plugins/cadence-planner/` and used as-is.

---

## Architecture

### File Organization

- **`main.js`** — All plugin logic. Organized top-to-bottom as:
  - Nav structure: `NAV_GROUPS`, `ALL_SURFACES`, `SURFACE_BY_ID`
  - Entity registry: `ENTITIES`
  - Settings: `DEFAULT_SETTINGS`, `CURRENT_CURRENCY`, `ENTITY_FOLDERS`, `syncEntityFolders()`, `entityFolder()`
  - Custom entity loader: `CUSTOM_ENTITY_KEYS`, `applyCustomEntities()`, `clearCustomEntities()`
  - Utility functions: date/time, file I/O, parsing, formatting
  - Modal classes: `CadenceCaptureModal`, `CadenceReminderEditModal`, `CadenceImportModal`, `CadenceEntityCreateModal`, `CadencePromptModal`
  - Main view: `CadenceAppView`
  - Settings UI: `CadenceSettingTab`
  - Plugin entry: `CadencePlugin`

- **`styles.css`** — Fallback styles for any theme. Organized by component: app shell, dark mode, nav, cards, modals, inputs, tables, kanban.

- **`manifest.json`** — Plugin metadata (id, version, min app version).

- **`versions.json`** — Version → min-app-version mapping for Obsidian store.

### Key Classes

| Class | Responsibility |
|-------|----------------|
| `CadencePlugin` | Plugin entry point; registers commands, hotkeys, settings, event handlers |
| `CadenceAppView` | Main view rendering all surfaces via internal tab nav |
| `CadenceSettingTab` | Settings UI (modules, folders, currency, dark mode, etc.) |
| `CadenceCaptureModal` | Quick-capture modal (text + optional reminder, datetime, repeat) |
| `CadenceReminderEditModal` | Reminder editor for inbox items |
| `CadenceImportModal` | CSV import with column mapping |
| `CadenceEntityCreateModal` | Generic create modal for any entity type |
| `CadencePromptModal` | Confirmation/prompt modals |

### Data Model

**Entities** are plain markdown files with YAML frontmatter. The `ENTITIES` constant defines the schema for each type:

```javascript
const ENTITIES = {
  contact: {
    folder: 'Cadence/Contacts',   // default; overridden by ENTITY_FOLDERS at runtime
    label: 'Contact', plural: 'Contacts',
    fields: [
      { key: 'name',  label: 'Name',  primary: true },   // primary = file basename
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'stage', label: 'Stage', type: 'enum', options: ['Lead', 'Won'] },
      { key: 'value', label: 'Value', type: 'currency' },
      { key: 'due',   label: 'Due',   type: 'date' },
      { key: 'tags',  label: 'Tags',  type: 'tags' },
    ],
    columns: ['name', 'company', 'email'],  // list-view columns
  },
  // ...
};
```

**Field types:** `text` (default), `email`, `number`, `currency`, `date`, `enum` (requires `options`), `tags`

**Frontmatter** is always written via Obsidian's `processFrontMatter()` — never manual string manipulation.

### Entity file resolution

`listEntityFiles(app, entityKey)` resolves which vault files belong to an entity. It checks these strategies in order — first match wins:

| Strategy | When used | How configured |
|---|---|---|
| `typeFilters` object | Multi-field frontmatter match (e.g. `{type:'profile', profile_type:'partner'}`) | `"typeFilters": {"type": "profile", "profile_type": "partner"}` |
| `typeFilter` string | Single frontmatter `type:` value (e.g. `type: person`) | `"typeFilter": "person"` |
| `folders` array | Files under any of the listed root paths (OR within array) | `"folders": ["10-ME", "20-COMPANY", "30-CLIENTS"]` |
| `typesFilter` array | Files whose `type:` matches any listed value (OR within array) | `"typesFilter": ["meeting", "research", "deliverable"]` |
| `folder` (default) | Single folder prefix — the standard case | Configured via Settings → Cadence → Folders |

All filter conditions are **independent and AND-combined** — any subset can be used together. Within each array (`folders`, `typesFilter`) the logic is OR. Between different filter types the logic is AND.

| Combination | Result |
|---|---|
| `typeFilter` alone | Type scan, whole vault |
| `folders` alone | Path scan, no type restriction |
| `typeFilter` + `folders` | Must match type AND be under a listed path |
| `typesFilter` + `folders` | Must match any listed type AND be under any listed path |
| `typeFilters` + `folders` | Must match all key-value pairs AND be under a listed path |
| Nothing set | Default `folder` path (from Settings → Folders) |

The **activity** entity uses `folders` + `typesFilter`: files must be under one of the vault root directories AND have a recognised `type:` value.

New entities created via Cadence get their `type:` frontmatter set from `typeFilter` / `typeFilters.type` (not the entity key). For `typeFilters` entities, extra discriminator fields (e.g. `profile_type`) are also written.

### Folder Resolution

Entity folders are resolved at runtime via `ENTITY_FOLDERS` (a module-level object, same pattern as `CURRENT_CURRENCY`). The full chain:

1. `ENTITIES[key].folder` — hardcoded defaults in source
2. `syncEntityFolders(settings)` — called on every `loadSettings()`/`saveSettings()`, copies `settings.folderContacts` etc. into `ENTITY_FOLDERS`
3. `entityFolder(key)` — the single lookup used everywhere; returns `ENTITY_FOLDERS[key]` with fallback to `ENTITIES[key].folder`

All 11 entity folders are configurable in **Settings → Cadence → Folders**. Moving folders: rename in vault first, then update the setting.

### Custom Entity Types (`Cadence/entities.json`)

Users can add new entity types (or override fields on existing ones) by creating `Cadence/entities.json` in their vault. Use the command palette → **"Cadence: Create entities.json template"** to scaffold it.

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
- **Hot-reload** — any save to `entities.json` re-applies immediately without restarting Obsidian
- **`module`** — optional; slots nav item into `crm`, `prm`, or `planner`; defaults to a "Custom" group

Internally: `applyCustomEntities(app)` reads the file, calls `clearCustomEntities()` first (removes previous custom keys from `ENTITIES`, `ENTITY_FOLDERS`, `BUILT_SURFACES`, and nav group items), then injects new ones. Custom surface IDs follow the `custom.{key}` pattern and are handled by a fallback branch in the route dispatch inside `CadenceAppView.render()`.

### Surfaces (Views)

Tab-based internal nav. Surfaces are dispatched in `CadenceAppView.render()` via a route map:

| Surface ID | Renderer |
|---|---|
| `home` | `renderHome()` |
| `planner.today` | `renderTodayPane()` |
| `planner.calendar` | `renderPlannerPane()` |
| `planner.projects` | `renderProjectsView()` |
| `planner.inbox` | `renderInbox()` |
| `crm.pipeline` | `renderEntityKanban()` (deal/stage) |
| `crm.contacts` / `companies` / `activities` | `renderEntityList()` |
| `prm.*` | `renderEntityList()` or `renderPRMAnalytics()` |
| `reports.*` | dedicated report renderers |
| `custom.{key}` | `renderEntityList()` (fallback for custom entities) |

**Specialised views** (Pipeline kanban, CRM Dashboard, Reports) hardcode field names like `stage`, `value`, `closeBy` — they don't auto-adapt to schema changes in `ENTITIES`.

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
2. Copy to test vault: `cp main.js styles.css manifest.json <vault>/.obsidian/plugins/cadence-planner/`
3. Reload in Obsidian: Settings → Community plugins → Cadence → Disable/Enable
4. Check console: Command palette → "Toggle developer tools"

### Code Style

- No build step — ES6, compatible with Obsidian's Chromium runtime
- Frontmatter I/O via `processFrontMatter()` only
- DOM: `innerHTML` / `appendChild()`, BEM-style class names prefixed `cad-`
- Events: `registerEvent()` for vault/metadata; standard `addEventListener` for DOM
- No `console.log` in shipping code (SUBMISSION.md requirement)

### Adding a new built-in entity type

1. Add to `ENTITIES` in `main.js` with `folder`, `label`, `plural`, `fields`, `columns`
2. Add a folder setting key to `DEFAULT_SETTINGS` (e.g. `folderOrders: 'Cadence/Orders'`)
3. Add it to `syncEntityFolders()` and the Folders settings UI in `CadenceSettingTab`
4. Add a nav item to the appropriate group in `NAV_GROUPS`
5. Add a route entry in the `route` map inside `CadenceAppView.render()` pointing to `renderEntityList()`

For user-defined entity types without touching source, use `Cadence/entities.json` instead.

### Adding a new surface with custom rendering

1. Add nav item to `NAV_GROUPS`: `{ id: 'group.surface', label: '...', icon: '...' }`
2. Add to `BUILT_SURFACES` set (prevents "soon" badge)
3. Add route in `CadenceAppView.render()`: `'group.surface': () => this.renderMySurface(content)`
4. Implement `renderMySurface(root)` on `CadenceAppView`

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

**Moving entity folders.** Rename the folder in the vault first, then update the path in Settings → Cadence → Folders. Files are not moved automatically.

**`entities.json` changes not picked up.** The watcher fires on `vault.modify` events. If you created the file externally (outside Obsidian), trigger a reload via disable/enable.

---

## Publishing

See `SUBMISSION.md` for the full release checklist.

Key reminders:
- `manifest.json` version must match the git tag exactly (no `v` prefix)
- `versions.json` must map the new version → min-app-version
- Release assets must include all three files: `main.js`, `manifest.json`, `styles.css`
- No `console.log`, unsanitized `innerHTML`, or raw frontmatter string manipulation in shipping code
