# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Project

This repository is `cbruyndoncx/obsidian-bob-workspace`, a BOB Workspace fork
of the Cadence Obsidian plugin. It provides a vault-native workspace for
planning, CRM, client delivery, partner management, suppliers/procurement,
finance/tax, AI playbooks and skills, reports, and reminders.

Current plugin identity in `manifest.json`:

- ID: `bob-workspace`
- Name: `BOB Workspace`
- Version: see `manifest.json` (authoritative — currently `0.14.4-bob.14`)
- Minimum Obsidian version: `1.4.0`
- Author: `cbruyndoncx`

The plugin has no build step. Obsidian loads/reads shipping artifacts directly:

- `main.js` - all plugin behavior
- `styles.css` - fallback/plugin styles
- `manifest.json` - plugin metadata
- `versions.json` - release compatibility map
- `vendor/xlsx.full.min.js` - bundled SheetJS dependency for XLSX workflows
- `templates/workspace-*.json` - file-backed starter workspace templates

Manual test installs copy `main.js`, `styles.css`, `manifest.json`, and
`vendor/xlsx.full.min.js` plus `templates/` into
`<vault>/.obsidian/plugins/bob-workspace/`.
Do not use the upstream `cadence-planner` plugin folder for this fork unless
testing an explicit migration or compatibility scenario.

## Product Direction

Preserve the current BOB Workspace direction unless the user explicitly asks
to change product identity or remove functionality.

- User-facing branding is BOB Workspace, while internal compatibility names
  such as `CadencePlugin`, `CadenceAppView`, `cad-` CSS classes, command IDs,
  and `VIEW_TYPE_CADENCE_APP` intentionally remain.
- Markdown files and frontmatter remain the source of truth. The plugin is a
  workspace UI over vault data, not a parallel database.
- Built-in entity definitions are fallbacks. For BOB vaults, canonical schema
  YAML describes record types and `.base` files describe display behavior.
- Prefer extending schemas, Bases, or plugin-folder `workspace.json` when a
  requested change is data-model/navigation configuration rather than
  application logic.
- Target direction: a new empty vault should be generated into a complete,
  immediately usable workspace. The setup path should create or install every
  required config/schema/Base/template artifact in the proper vault shape,
  rather than leaving implicit prerequisites.
- Target direction: avoid hardcoded workspace composition. `workspace.json`
  should be the explicit single starting source for BOB Workspace composition,
  with schema YAML, Base files, and optional imported vault JSON/YAML providing
  the data model and view behavior. Embedded defaults in `main.js` are legacy
  fallback/bootstrap behavior, not the desired long-term source of truth.

Some supporting documents can lag the implementation. In particular, verify
navigation and release behavior in `main.js`, `manifest.json`, and
`versions.json` before relying on generated inventories or upstream-oriented
publishing text.

## Repository Layout

- `main.js` - monolithic, directly loaded plugin source.
- `styles.css` - theme-agnostic UI styles, dark mode, responsive/mobile rules,
  entity table editing, dashboards, modals, and Playbook Runner styles.
- `manifest.json` and `versions.json` - current BOB Workspace release metadata.
- `vendor/xlsx.full.min.js` and `vendor/xlsx.LICENSE` - bundled XLSX support.
- `templates/workspace-*.json` - human-readable starter workspace templates.
  These are the canonical starter templates; do not mirror them as hardcoded
  workspace definitions in `main.js`.
- `docs/extending-bob-workspace.md` - schema/Base/entities extension model.
- `docs/navigation-inventory.md` and `docs/entity-setup-audit.md` - useful
  generated snapshots, but confirm against current code before editing.
- `CLAUDE.md` - broader implementation notes; keep it aligned when changes
  materially alter shared architecture.
- `SUBMISSION.md` - inherited/upstream-oriented release notes in places; do
  not blindly reuse its old plugin IDs, repository URLs, or asset list.
- A repo-root `workspace.json`, when present, is not loaded by Obsidian. Treat
  it as a scratch/template artifact unless it is copied to the installed plugin
  directory for a vault.

## Main Architecture

`main.js` is organized around:

- Navigation and grouping: `NAV_GROUPS`, `ALL_SURFACES`, `SURFACE_BY_ID`,
  `SURFACES_BY_ENTITY_KEY`, `SECONDARY_TABS`, `WORKBOOK_EXPORT_GROUPS`
- Entity model: `ENTITIES`, `BUILTIN_ENTITY_DEFAULTS`, deal/activity accessors
- Settings and folders: `DEFAULT_SETTINGS`, `CURRENT_CURRENCY`,
  `ENTITY_FOLDERS`, `syncEntityFolders()`, `entityFolder()`
- Runtime configuration layers: `loadWorkspaceConfig()`,
  `applyWorkspaceRegistries()`, `applySchemas()`,
  `applyConfiguredBaseOverrides()`, `applyBaseOverrides()`,
  `workspaceConfigTemplate()`, and `reloadEntityConfiguration()`
- Base parsing/evaluation: `parseBaseFile()`, Base filter helpers, grouping and
  sorting helpers
- Data and import/export helpers, including XLSX workbook functions
- Modal classes
- Main view: `CadenceAppView`
- Settings tab: `CadenceSettingTab`
- Optional Bases custom view: `CadencePlaybookRunnerView`
- Plugin entry: `CadencePlugin`

Key classes:

- `CadencePlugin` registers views, commands, settings, reminders, reload
  behavior, workbook commands, and the optional Bases custom view.
- `CadenceAppView` renders the application shell, responsive nav, all internal
  surfaces, generic tables, detail forms, dashboards, reports, and kanban.
- `CadenceSettingTab` configures modules, surfaces, folders, Bases, schemas,
  tasks, reminders, export/import, and `workspace.json`.
- `CadenceCaptureModal`, `CadenceReminderEditModal`, `CadenceImportModal`,
  `CadenceEntityCreateModal`, and `CadencePromptModal` handle modal workflows.
- `CadencePlaybookRunnerView` registers `agent-client-playbook-runner` as an
  Obsidian Bases custom view when that API exists.

## Current Surfaces And Modules

Navigation is module-driven and supports hidden secondary/setup items plus
inner tab bars defined by `SECONDARY_TABS`.

- Planner: Inbox, Today, Calendar, TaskNotes, Projects
- CRM: Dashboard, Pipeline, Contacts, Clients, My Companies, Leads,
  Campaigns/Sequences, Activities
- Client Work: overview plus Meetings, Comms, Deliverables, Feedback, Surveys,
  Testimonials, and Decisions; overview selectors filter by client and project
- PRM: Partners, Registrations, Commissions, Certifications, Analytics
- Finance: Customer Invoices, General Ledger, Finance Setup, Tax, and their
  accounting/compliance child entity lists
- Suppliers & Procurement: Suppliers, Supplier Invoices, Purchase
  Requisitions, Purchase Orders
- Reports: Pipeline, Sales, Partners, Activity, Productivity
- Team: a filtered People/contact view using configurable
  `person_category` values, not a separate entity
- AI Workspace: Playbooks and Skills

`showSecondaryNav` and `showSetupNav` control whether lower-frequency children
appear in the left nav; those screens remain accessible through parent tabs.

Important specialized behavior:

- Pipeline is a deal kanban. Drag-to-change-stage is desktop-only; mobile
  opens cards for editing rather than relying on HTML drag events.
- Generic entity tables support sorting, enum column filters, inline editing,
  multi-select, and bulk trashing.
- Entity detail forms use frontmatter writes; project detail also edits note
  body sections and task/milestone markdown.
- External/non-table Base views delegate display to Obsidian Bases and expose
  an `Open Base` action instead of duplicating the view.
- Client Work child lists force the internal table so configured non-table
  Base views do not make those embedded lists disappear.
- Mobile layout includes a navigation drawer, compact briefing behavior, and
  safe-area/responsive CSS.

## Entity And Vault Model

Entities are markdown notes with YAML frontmatter. `ENTITIES` defines fallback
labels, fields, columns, folder/type matching, and specialized metadata.
Built-in entities now cover planner, CRM, client-work, PRM, supplier and
procurement, finance/tax, plus `playbook` and `skill`.

Supported field UI types include `text`, `email`, `number`, `currency`,
`date`, `enum`, and `tags`.

Always use Obsidian frontmatter APIs for frontmatter mutation:

```javascript
await app.fileManager.processFrontMatter(file, (fm) => {
  fm.stage = 'won';
});
```

Do not manually replace YAML frontmatter text.

Body markdown is edited separately where the feature is genuinely body-based,
for example project sections or daily-note task lists:

```javascript
const content = await app.vault.read(file);
const updated = replaceSection(content, '## Brief', newText);
await app.vault.modify(file, updated);
```

### Workspace Source Of Truth

The active workspace definition is always read from the installed plugin
folder:

```text
<vault>/.obsidian/plugins/bob-workspace/workspace.json
```

`initPluginPaths(plugin)` derives this from `plugin.manifest.dir`; the fallback
path before initialization is legacy `Cadence/workspace.json` and should not be
used for current BOB installs. A `workspace.json` in the repository root is not
read by the running plugin.

For an empty vault, first-run setup should produce a complete usable workspace:
the active `workspace.json`, required schema YAML, required `.base` files, and
record/task templates should all be generated or installed into their expected
locations. The current implementation loads starter templates only from
`<plugin-dir>/templates/*.json`; there is intentionally no embedded fallback in
`main.js`. Applying a template writes the chosen template, minus `_template`,
to the active plugin-folder `workspace.json`.

`data.json` is no longer the source for portable workspace-owned settings.
`CadencePlugin.loadSettings()` first reads plugin data, then loads
`workspace.json`, then overlays `workspace.json.settings` for keys listed in
`WORKSPACE_OWNED_SETTING_KEYS`. `saveSettings()` removes those owned keys from
plugin data and writes them back to `workspace.json` whenever a workspace file
exists or any owned setting needs persistence. Personal/non-workspace settings
remain in Obsidian plugin data.

When hand-authoring `workspace.json`, prefer these top-level blocks:

- `schemas` for schema enablement and schema source folder.
- `bases` for portable Base file and default view associations.
- `navigation.groups` and `navigation.secondaryTabs` for workspace layout.
- `workbookGroups` for XLSX export bundles.
- `dashboards` for configurable dashboard layouts keyed by route/surface id.
- `templates` for record templates such as `templates.taskNote`.
- `settings` only for portable settings such as modules, folders, task mode,
  reminders, currency, and other keys explicitly listed in
  `WORKSPACE_OWNED_SETTING_KEYS`.

Avoid treating duplicated `settings.useSchemas`, `settings.schemasFolder`,
`settings.baseFiles`, or `settings.baseViews` as the canonical composition
source when top-level `schemas` or `bases` are present. In runtime code,
top-level `schemas` controls schema loading, top-level `bases` controls Base
file paths, and `settings.baseViews` can still override a workspace Base's
default view as a user selection.

### Runtime Configuration Order

`reloadEntityConfiguration(app, settings)` applies configuration in this order:

1. Reset runtime navigation/export registries and load the active
   plugin-folder `workspace.json` if present.
2. Reset `ENTITIES` to `BUILTIN_ENTITY_DEFAULTS` and sync folders from the
   already-effective settings object.
3. Apply configured `navigation.groups`, `navigation.secondaryTabs`, and
   `workbookGroups`. These replace the built-in registries when present; they
   are not deep-merged.
4. Apply deprecated `workspace.json.entities` once before schema loading for
   migration compatibility, injecting navigation only when no configured
   navigation exists.
5. Resolve schema settings, where top-level `workspace.json.schemas` overrides
   settings, then load canonical schema YAML with `applySchemas()` if enabled.
   A schema can introduce a generic record type without plugin code.
6. Apply deprecated `workspace.json.entities` again as post-schema overrides,
   without injecting navigation. New entity definitions should not be added
   here for current BOB vaults.
7. Merge top-level `workspace.json.bases` with
   `applyConfiguredBaseOverrides()`. These Base file paths win over
   `settings.baseFiles` for the same entity.
8. Merge remaining settings-selected `.base` behavior with
   `applyBaseOverrides()` for entities not controlled by top-level
   `workspace.json.bases`. `settings.baseViews` can override the default view
   for either source.
9. Rebuild surface lookups after all runtime registries are settled.

Do not assume edits to `ENTITIES` alone control a BOB vault when schemas,
custom overrides, or Bases are active.

### File Resolution

`listEntityFiles(app, entityKey)` currently applies:

- `folders` as an optional OR list of permitted folder roots.
- `folder`/`entityFolder()` as the default path restriction only when neither
  `typeFilter` nor `folders` is configured.
- `filenameFilter`, used for skills so only `SKILL.md` files match.
- `typeFilter` for single `frontmatter.type` matching.
- `typeFilters` for additional multi-field frontmatter matching.
- Parsed Base filters when a selected Base/view contributes supported filters.

Filter categories that exist together are AND-combined. Template paths are
excluded: any note under a directory segment named `template` or `templates`
must not appear in entity lists, counts, dashboards, or workbook exports.

Do not document or add logic around a `typesFilter` option without
implementing it first; it is not part of current `listEntityFiles()` behavior.

### Schemas, Bases, And Custom Entities

- `workspace.json` is the preferred no-code composition file. It defines
  `schemas`, `bases`, `templates`, `dashboards`, `navigation.groups`,
  `navigation.secondaryTabs`, `navigation.actions`, and `workbookGroups`;
  entity definitions belong in canonical schema YAML.
  Deprecated `entities` content remains readable for migration compatibility.
- Entity-backed navigation surfaces render the generic record list/detail UI
  when their `entityKey` exists in `ENTITIES` after schema loading. A Base
  mapping is optional for simple lists, but required when the workspace needs
  Base-specific filters, column order, grouping, sorting, or an external
  non-table Base view.
- Configured dashboards can be rendered from `workspace.json.dashboards` when
  the dashboard key matches a surface id or secondary-tab route. Arbitrary
  non-entity tools still require code.
- The Settings navigation designer edits the same draft and supports adding
  groups, moving unassigned record types or secondary tabs into groups,
  choosing whether secondary children render as tabs or navigation-tree
  entries, creating parent tab areas for newly configured children, editing
  group/item icons through a searchable picker backed by Obsidian's registered
  icon IDs, removing individual tabs or tree items back to their unassigned
  pool, normalizing orphaned legacy secondary/setup children to primary
  navigation in configured workspaces, and reordering groups/items.
- Settings includes a workbook export group designer over
  `workspace.json.workbookGroups`; it can assign schema-derived entity types
  to overlapping XLSX export bundles without code changes.
- In file-managed workspaces, Settings authoring controls must not expose
  fallback built-in entities as available/unassigned record types. The
  available record-type set is limited to canonical schema YAML plus entity
  keys explicitly referenced by the active `workspace.json` composition.
- Specialized built-in screens such as Home must follow the same boundary:
  do not show fallback entity actions/cards/briefing items unless that entity
  is part of the active workspace-owned record-type set.
- Header buttons belong in `workspace.json.navigation.actions`, keyed by
  surface id. Entity actions must render from the configured schema/form and
  non-entity actions must be explicit supported action ids such as
  `quick-capture` or `today-task`. When a surface has configured header
  actions, those actions are the explicit top-button list for that surface;
  do not add legacy hardcoded create buttons beside them.
- Schema YAML defaults to `00-CORE/Schemas/source` when `useSchemas` is enabled.
- Settings includes a Data model designer for canonical schema YAML. It creates
  entity source files and edits identity/location, icons, discriminators,
  co-required relationships, import `field_aliases`, create `default` values,
  display hints and ordered fields, writing
  `<schema>.backup` before save and reloading runtime configuration immediately.
- Schema `field_aliases` are keyed by canonical field name and list accepted
  CSV/XLSX header names; both import paths consume them.
- Schema field `default` values initialize new records; `{{today}}` is
  resolved at creation time for date-like fields.
- **Save and regenerate** produces derived Metadata Menu FileClasses and JSON
  Schemas from canonical YAML, using `type_value` for JSON Schema filenames
  where present and pruning stale derived output files.
- Base/view mappings are composition and belong in `workspace.json.bases`.
  Settings can import older `data.json` Base selections into that mapping.
- A selected Base/view can order visible columns, but must not remove
  schema-defined fields from entity creation or import behavior.
- Unsupported Base filters are surfaced in UI warnings; preserve that
  transparency when extending Base support.

## Task, Import, And Export Behavior

- Task modes are `checkbox`, `tasknotes`, and `hybrid`.
- TaskNotes list views use the active TaskNotes folder; Productivity history
  may read both active and archive folders.
- Quick capture writes reminder state into plugin settings and attempts to add
  a checkbox item to the relevant daily note.
- CSV import maps columns into entity frontmatter through entity definitions.
- XLSX export/import uses `vendor/xlsx.full.min.js`; exports default under
  `BOB Workspace/Exports`.
- `WORKBOOK_EXPORT_GROUPS` includes Planner, CRM, Client Work, PRM, Finance,
  Suppliers & Procurement, and AI Workspace entity sets.

When changing entity fields, verify create/edit UI, generic list behavior,
CSV import, XLSX import/export, configured Bases, and schema-derived entities.

## Development Rules

- Keep the no-build-step constraint unless the user explicitly requests an
  architectural migration.
- Prefer small, scoped edits in `main.js` and `styles.css`.
- Preserve BOB Workspace branding and compatibility names unless deliberately
  changing public identity.
- Use `processFrontMatter()` for YAML changes. Use vault body writes only for
  markdown sections/tasks that live outside frontmatter.
- Do not add `console.log` to shipping code.
- Avoid unsafe raw `innerHTML` for untrusted vault content.
- Keep new styles scoped under existing `cad-` / `cadence-` patterns and
  verify both light and dark presentation.
- Respect current responsive behavior and mobile limitations for interactive
  changes.
- Do not remove `vendor/xlsx.full.min.js` from packaging while XLSX commands
  and settings remain available.

## Common Extension Tasks

For a new entity that can be vault-configured, prefer a schema and/or
`workspace.json` over code. Code changes are justified for bespoke rendering,
new widgets, or new import/export behavior; generic entity lists and tab/nav
composition should be configured.

When preparing a new empty-vault workspace:

1. Create or install canonical schema YAML under the configured schema source
   folder and set top-level `workspace.json.schemas.enabled` to `true`.
2. Create or install required `.base` files under the configured Base folder so
   the workspace is usable immediately after setup.
3. Put portable Base mappings in top-level `workspace.json.bases` only when the
   entity needs Base-defined filters, visible columns, sorting, grouping, or an
   external Base view.
4. Add navigation items with stable ids and `entityKey` values that match the
   schema-derived entity keys.
5. Add secondary tabs and workbook export groups in the same `workspace.json`
   draft.
6. Include task/record templates and any generated starter folders/files needed
   for an immediately usable empty vault.
7. Put the final file at
   `<vault>/.obsidian/plugins/bob-workspace/workspace.json`; do not expect a
   repo-root `workspace.json` to affect the running plugin.
8. Reload with the `Reload workspace.json` command or restart Obsidian.

When supporting an existing vault, prefer an explicit import path that reads
YAML or JSON configuration already present in the vault, normalizes it into the
same `workspace.json`/schema/Base model, and writes the result as visible files
rather than relying on hidden or inferred plugin state.

When adding a built-in entity in code:

1. Add its fallback definition to `ENTITIES`.
2. Add folder settings and `syncEntityFolders()` handling if configurable.
3. Add appropriate nav and route wiring through `NAV_GROUPS`,
   `BUILT_SURFACES`, and `CadenceAppView.render()`.
4. Add inner tabs in `SECONDARY_TABS` when it belongs under a workspace.
5. Add a Base default where applicable.
6. Add it to the appropriate `WORKBOOK_EXPORT_GROUPS` entry.
7. Verify schemas, custom overrides, Bases, create/edit, and import/export.

When adding a custom-rendered surface:

1. Add its nav definition and module gating.
2. Add it to `BUILT_SURFACES`.
3. Add route dispatch in `CadenceAppView.render()`.
4. Implement the renderer, preserving mobile and theme behavior.
5. Add secondary tabs or settings controls if users must configure it.

## Validation

There is no automated application build in this repository. For relevant
changes:

1. Run a JavaScript syntax check on `main.js`, for example
   `node --check main.js`.
2. Review edits for untrusted DOM insertion, frontmatter mutation, and missing
   vendor/release artifacts.
3. Copy shipping files to a test vault plugin folder.
4. Reload or restart Obsidian and inspect the developer console.
5. Exercise affected surfaces, settings, light/dark appearance, and mobile
   layout where UI behavior changed.

Changes to `main.js` may require a full Obsidian restart rather than only
disabling and enabling the plugin.

## Publishing

Before releasing:

- Treat `manifest.json` and `versions.json` as authoritative for this fork;
  confirm inherited instructions in `SUBMISSION.md` before using them.
- The git tag must match `manifest.json.version` exactly, with no leading `v`.
- `versions.json` must map the release to its minimum Obsidian version.
- Release assets must include `main.js`, `manifest.json`, `styles.css`,
  `vendor/xlsx.full.min.js`, and file-backed starter templates under
  `templates/`.
- Recheck shipping code for debug logs, unsafe untrusted HTML insertion, and
  manual YAML frontmatter mutation.
