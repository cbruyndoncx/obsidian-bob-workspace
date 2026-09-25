# Route: create

Author a **new, selectable workspace template file** that the user applies from the plugin admin. This route is **non-destructive** — it writes a file into the plugin's `templates/` folder and never touches the live `workspace.json`. The user switches to it via Settings → BOB Workspace → **Apply workspace template…**, which is what actually replaces the live workspace (the plugin backs up the current one first).

This is the "try before you commit" path: the user can author several candidate layouts, eyeball each in the switcher, and only the one they apply becomes live.

## Why a template file, not a direct write

The plugin's switcher combines five templates bundled in `main.js` with custom JSON files under `<plugin>/templates/`. A custom file with a `_template` block appears in the picker. Creating that file does not change the active workspace; applying it in BOB Workspace does.

## Template file shape

```json
{
  "_template": {
    "id": "<unique-kebab-id>",
    "label": "<Human Label shown in the switcher>",
    "description": "<one line describing what this layout contains>",
    "order": <int — sort position; use max(existing orders)+1 so it lands last>
  },
  "schemas": { ... },
  "navigation": { ... },
  "dashboards": { ... },
  "workbookGroups": [ ... ],
  "settings": { ... }
}
```

The keys other than `_template` are an ordinary workspace config — identical in shape to a live `workspace.json`. On apply, the plugin strips `_template` and writes the rest. The skill's validator ignores the `_template` key, so a template file validates exactly like a workspace.json.

## Steps

1. **Locate the plugin templates dir.** `<vault>/.obsidian/plugins/bob-workspace/templates/`. The plugin must be installed; create `templates/` if it does not exist yet.
2. **Decide the base.** Two ways to build the config:
   - **From the live workspace** — read the installed plugin's `workspace.json` and tailor it. This is available with any installed BOB plugin.
   - **From a custom template** — read an on-disk file under the installed plugin's `templates/` folder and tailor it.
   - **From the vault datamodel** — build dashboards from entities in the configured schema source folder. If a needed entity has no schema, run the sibling bootstrap skill first.
   - **From a bundled template** — read `templates/workspace-*.json` in the BOB source checkout if that checkout is available. Bundled templates are inside installed `main.js`, so they cannot be discovered by listing the installed plugin's `templates/` folder.
3. **Name it.** Choose a unique kebab-case `id`, a human `label`, a one-line `description`, and an `order` after existing custom and known bundled choices. Avoid the bundled IDs `bob-workspace`, `cadence-classic`, `crm-only`, `emai`, and `minimal`. The file name is `templates/workspace-<id>.json`.
4. **Build the file.** Assemble `{ "_template": {…}, …config }` and write it to a temporary file.
5. **Safe-write into templates/.** `uv run scripts/safe_write.py --target <plugin>/templates/workspace-<id>.json --source <temp>` — validates the content, backs up any same-named template already there, atomic-writes, re-validates. A failing validation leaves nothing written.
6. **Tell the user how to apply it.** Settings → BOB Workspace → command **"Apply workspace template…"** → select **"\<label\>"**. Warn them: *applying* replaces the live `workspace.json` and the plugin keeps only a single rolling `workspace.backup.json` — so if they want to keep their current layout, they should first save it as its own template (run this route on the live file) before applying a different one.

## Notes

- **Never overwrite the live `workspace.json` from this route.** Whole-file replacement is the plugin switcher's job (on user selection); surgical edits are `add`/`update`. This route only authors a candidate file.
- **Choose a new file name.** On-disk files with bundled names are ignored by the picker because the bundled versions take precedence. Do not overwrite an existing custom file without reviewing it.
- **`order` collisions are cosmetic, not fatal** — two templates with the same order still both list; pick the next free integer to keep the switcher tidy.
- Do NOT regenerate fileClasses/schemas here — that's [[bob-workspace-bootstrap]]'s job. This route only composes a UI candidate on top of whatever schema sources already exist.
