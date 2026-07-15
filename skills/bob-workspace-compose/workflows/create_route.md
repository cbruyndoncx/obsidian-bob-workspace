# Route: create

Author a **new, selectable workspace template file** that the user applies from the plugin admin. This route is **non-destructive** — it writes a file into the plugin's `templates/` folder and never touches the live `workspace.json`. The user switches to it via Settings → BOB Workspace → **Apply workspace template…**, which is what actually replaces the live workspace (the plugin backs up the current one first).

This is the "try before you commit" path: the user can author several candidate layouts, eyeball each in the switcher, and only the one they apply becomes live.

## Why a template file, not a direct write

The plugin's switcher (`loadWorkspaceTemplates`) globs `<plugin>/templates/*.json` and lists every file that carries a `_template` metadata block, sorted by `_template.order`. So dropping a well-formed template file into that folder makes it appear in the admin automatically — no live overwrite, fully reversible (the user just deletes the file or picks a different one). Live, in-place edits are the job of the `add`/`update` routes instead.

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

1. **Locate the plugin templates dir.** `<vault>/.obsidian/plugins/bob-workspace/templates/`. If the plugin (or the folder) is absent, STOP — the plugin must be installed for the switcher to find the file. Tell the user to install/enable BOB Workspace first.
2. **Decide the base.** Two ways to build the config:
   - **From an existing template** — read one live (`templates/workspace-crm.json` etc.), strip its `_template`, and tailor (e.g. trim modules the vault doesn't use). Good for a focused variant.
   - **From the vault datamodel** — build dashboards from the entities the vault actually has (one dashboard per `domain` annotation in `00-CORE/Schemas/source/*.yaml`, list widgets per entity). Good for a vault-specific layout. If a needed `entity` has no schema, route the user to [[bob-workspace-bootstrap]] first.
3. **Name it.** Choose a unique `id` (kebab-case, not colliding with `bob-workspace`/`cadence-classic`/`crm-only`/`minimal` or any existing custom template), a human `label`, a one-line `description`, and `order` = (max existing `_template.order`) + 1. The file name is `templates/workspace-<id>.json`.
4. **Build the file.** Assemble `{ "_template": {…}, …config }` and write it to a temp file in `99-TMP/OUTPUT/`.
5. **Safe-write into templates/.** `uv run scripts/safe_write.py --target <plugin>/templates/workspace-<id>.json --source <temp>` — validates the content, backs up any same-named template already there, atomic-writes, re-validates. A failing validation leaves nothing written.
6. **Tell the user how to apply it.** Settings → BOB Workspace → command **"Apply workspace template…"** → select **"\<label\>"**. Warn them: *applying* replaces the live `workspace.json` and the plugin keeps only a single rolling `workspace.backup.json` — so if they want to keep their current layout, they should first save it as its own template (run this route on the live file) before applying a different one.

## Notes

- **Never overwrite the live `workspace.json` from this route.** Whole-file replacement is the plugin switcher's job (on user selection); surgical edits are `add`/`update`. This route only authors a candidate file.
- **Do not overwrite the four built-in templates** (`workspace-bob/cadence/crm/minimal.json`) — they are plugin-owned and regenerated on plugin update; a custom layout gets its own new file name. (`safe_write.py` would back one up rather than lose it, but don't target them.)
- **`order` collisions are cosmetic, not fatal** — two templates with the same order still both list; pick the next free integer to keep the switcher tidy.
- Do NOT regenerate fileClasses/schemas here — that's [[bob-workspace-bootstrap]]'s job. This route only composes a UI candidate on top of whatever schema sources already exist.
