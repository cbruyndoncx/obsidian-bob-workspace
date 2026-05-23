# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Project

This repository is `cbruyndoncx/obsidian-bob-workspace`, a customized BOB Workspace fork of the Cadence Obsidian plugin. It is a vault-native workspace for CRM, PRM, SRM, project management, daily planning, reports, and reminders.

The plugin has no build step. Obsidian loads these files directly:

- `main.js` - all plugin logic
- `styles.css` - plugin styles
- `manifest.json` - plugin metadata
- `versions.json` - Obsidian release compatibility map

Manual test installs copy `main.js`, `styles.css`, and `manifest.json` into `<vault>/.obsidian/plugins/cadence-planner/` or the configured plugin folder.

## Current Customization Context

Claude has already customized this fork. Preserve that direction unless the user explicitly asks to revert it.

Important customized behavior:

- Plugin identity is BOB Workspace flavored: `manifest.json` has id `bob-workspace`, name `BOB Workspace`, version `0.13.8-bob.1`, and author `cbruyndoncx`.
- UI labels, notices, commands, ribbon tooltips, settings copy, and desktop notifications have been renamed from plain Cadence to BOB Workspace / BOB Workspace Cadence in many places.
- The plugin remains structurally based on Cadence, and some internal names still use `Cadence`, `cad-`, or `cadence` for compatibility.
- Custom entities now live in the plugin folder as `entities.json`, next to Obsidian plugin `data.json`, with `entities.backup.json` written on save.
- A legacy vault copy at `Cadence/entities.json` is migrated into the plugin folder on first load when no plugin-folder config exists. The legacy file is retained as a safety copy.
- Direct edits to plugin-folder `entities.json` are not watched by Obsidian vault events. Use Settings -> BOB Workspace Cadence -> Custom entities, or run the command `Reload entities.json`.
- The settings UI includes an in-settings JSON editor for custom entities with validation, formatting, save, and restore backup.
- Schema support can derive entity definitions from Metadata Menu schema YAML in `00-CORE/Schemas/source` when `useSchemas` is enabled.

## Architecture

`main.js` is organized roughly as:

- Nav structure: `NAV_GROUPS`, `ALL_SURFACES`, `SURFACE_BY_ID`
- Entity registry: `ENTITIES`
- Settings: `DEFAULT_SETTINGS`, `CURRENT_CURRENCY`, `ENTITY_FOLDERS`, `syncEntityFolders()`, `entityFolder()`
- Custom entity loader: `initEntitiesPaths()`, `migrateLegacyEntitiesConfig()`, `saveEntitiesConfig()`, `applyCustomEntities()`, `clearCustomEntities()`
- Schema loader: `applySchemas()`
- Utility functions: date/time, file I/O, parsing, formatting
- Modal classes
- Main app view: `CadenceAppView`
- Settings UI: `CadenceSettingTab`
- Plugin entry: `CadencePlugin`

Key classes:

- `CadencePlugin` registers commands, settings, views, hotkeys, reminders, and startup behavior.
- `CadenceAppView` renders all internal surfaces.
- `CadenceSettingTab` renders settings, including modules, folders, schema settings, and custom entities.
- `CadenceCaptureModal`, `CadenceReminderEditModal`, `CadenceImportModal`, `CadenceEntityCreateModal`, and `CadencePromptModal` handle modal workflows.

## Data Model

Entities are markdown files with YAML frontmatter. `ENTITIES` defines fields, columns, folders, type filters, and special field names.

Supported field types include `text`, `email`, `number`, `currency`, `date`, `enum`, and `tags`.

Always use Obsidian frontmatter APIs for frontmatter writes:

```javascript
await app.fileManager.processFrontMatter(file, (fm) => {
  fm.stage = 'Won';
});
```

Do not manually string-replace YAML frontmatter.

Entity file resolution in `listEntityFiles(app, entityKey)` supports:

- `typeFilters` object: all frontmatter key-value pairs must match
- `typeFilter` string: frontmatter `type` must match
- `folders` array: file path must be under any listed folder
- `typesFilter` array: frontmatter `type` must be one of the listed values
- `folder`: default single folder path

Filter categories are AND-combined. Values inside `folders` and `typesFilter` are OR-combined.

## Development Rules

- Prefer small, scoped edits in `main.js` and `styles.css`.
- Keep the no-build-step constraint. Do not introduce bundling unless the user asks for it.
- Use `rg` for searching.
- Use `processFrontMatter()` for frontmatter mutation.
- Avoid `console.log` in shipping code.
- Preserve existing BOB Workspace branding and compatibility comments unless intentionally changing product identity.
- Internal compatibility names such as `CadencePlugin`, `CadenceAppView`, `cad-` CSS classes, and command ids may remain unless there is a clear reason to migrate them.
- When changing entity behavior, check built-in entities, custom `entities.json`, schema-derived entities, and `.base` file behavior together.
- When changing UI, check both light and dark modes and keep styles scoped under `cad-` classes.

## Common Tasks

Adding a built-in entity:

1. Add it to `ENTITIES`.
2. Add folder defaults to `DEFAULT_SETTINGS` and `ENTITY_FOLDERS`.
3. Update `syncEntityFolders()`.
4. Add a nav item in `NAV_GROUPS`.
5. Add settings UI if the folder is configurable.
6. Add a route or rely on generic entity-list rendering where appropriate.

Adding a custom-rendered surface:

1. Add a nav item to `NAV_GROUPS`.
2. Add its id to `BUILT_SURFACES`.
3. Add route dispatch in `CadenceAppView.render()`.
4. Implement the renderer on `CadenceAppView`.

Editing project body sections:

```javascript
const content = await app.vault.read(file);
const sections = parseH2Sections(content);
const updated = replaceSection(content, '## Brief', newText);
await app.vault.modify(file, updated);
```

## Testing

There is no automated build in this repo. Basic validation is:

1. Review syntax carefully in `main.js`.
2. Copy plugin files into a test vault plugin folder.
3. Reload Obsidian or disable/enable the plugin.
4. Check Obsidian developer console.
5. Verify relevant surfaces and settings manually.

Changes to `main.js` may require a full Obsidian restart, not only disable/enable.

## Publishing

See `SUBMISSION.md`.

Release reminders:

- `manifest.json` version must match the git tag exactly, without a leading `v`.
- `versions.json` must map the version to the minimum Obsidian app version.
- Release assets must include `main.js`, `manifest.json`, and `styles.css`.
- Keep shipping code free of debug logs, unsafe raw `innerHTML` for untrusted content, and raw YAML string mutation.
