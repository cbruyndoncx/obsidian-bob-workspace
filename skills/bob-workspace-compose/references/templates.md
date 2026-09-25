# Workspace templates

BOB Workspace loads its five shipped templates from `main.js`. In the BOB source repository, the editable files are `templates/workspace-*.json` and are imported by `src/bundled/templates.ts` at build time. A normal plugin installation does not contain those five JSON files. The installed plugin's `templates/` directory holds only custom JSON templates added by the vault owner.

| Source file | Template ID | Purpose |
|-------------|-------------|---------|
| `workspace-minimal.json` | `minimal` | Small starting layout. |
| `workspace-crm.json` | `crm-only` | CRM and pipeline workspace. |
| `workspace-bob.json` | `bob-workspace` | Full BOB business workspace. |
| `workspace-cadence.json` | `cadence-classic` | Cadence Classic layout. |
| `workspace-emai.json` | `emai` | Personal/PARA workspace. |

Check `src/bundled/templates.ts` in the source repository when this list needs updating. Template files in the source repository are build inputs; editing them requires rebuilding `main.js`. A custom file added to the installed plugin folder becomes a separate selectable option and cannot override a bundled file with the same name.

## Choose a base for a custom template

1. Use the active `<vault>/.obsidian/plugins/bob-workspace/workspace.json` when adapting the current layout.
2. Use a custom JSON file already in `<vault>/.obsidian/plugins/bob-workspace/templates/` when adapting a user-authored template.
3. Use canonical YAML in the vault's configured schema folder when building a layout from its record types.
4. If the BOB source repository is available, use one of its `templates/workspace-*.json` files as a base. The installed plugin alone does not expose those files as JSON.

Write a new file with a unique `workspace-<id>.json` name and a `_template` block under the installed plugin's `templates/` folder. The plugin's **Apply workspace template…** picker reads custom files there alongside its bundled choices. Applying one replaces the active `workspace.json`; use the create route to preserve a hand-tuned layout before switching.
