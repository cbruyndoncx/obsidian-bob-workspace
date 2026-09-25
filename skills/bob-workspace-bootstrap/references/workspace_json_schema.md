# Workspace composition

The bootstrap skill writes canonical schema YAML. Its sibling `bob-workspace-compose` skill owns `workspace.json`, navigation, dashboards, and Base wiring. See [the compose workspace schema](../../bob-workspace-compose/references/workspace_schema.md) for the current shape and [its validator](../../bob-workspace-compose/scripts/validate_workspace.py) for a local check.

The active file is `<vault>/.obsidian/plugins/bob-workspace/workspace.json`. Built-in starter templates are bundled in the plugin's `main.js`; custom template files can be placed in the installed plugin's `templates/` folder.
