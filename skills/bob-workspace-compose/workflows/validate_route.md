# Route: validate

Check a `workspace.json` against the full composition schema without mutating anything. The read-only diagnostic; also runs automatically inside every mutating route via `safe_write.py`.

## Steps

1. **Run the validator:**
   ```bash
   uv run scripts/validate_workspace.py <vault>/.obsidian/plugins/bob-workspace/workspace.json
   ```
   The **render-safety guard is ON by default**. Add `--strict` to treat warnings as failures; add `--json` for a machine-readable report; add `--no-render-check` for a schema-only pass (the render guard off — useful only to prove a config is schema-valid but non-rendering).
2. **Read the output.**
   - `errors` = genuine breakage. Two classes:
     - **Structural** — wrong JSON type, missing load-bearing key, malformed layout. The file won't parse into a renderable shape.
     - **Render-safety (the guard)** — an **unreachable nav item**: a nav `id` that matches none of the renderer's dispatch branches (a `dashboards`/`planner` key, a built surface id, a `secondaryTabs` parent, an `entityKey`, or `custom.<entityKey>`). Schema-valid but renders a dead "coming soon" screen with no fallback. The error message names the fix.
   - `warnings` = advisory — unknown widget `kind`/`source` string, a default-list widget with no data origin, a dashboard with no layout, a nav item bound to an OFF module (hidden), a base widget whose `entity` is unmapped in `bases`/`settings.baseFiles` (renderer falls back to the built-in entity baseView, so empty-not-broken). The plugin still renders; review each.
3. **Report** errors first with their JSON paths, then warnings. For each error, name the fix (the path + what shape the catalog expects, or how to make the nav id reachable).
4. **Never write.** This route is read-only. To fix a finding, switch to the `update` or `add` route.

## Acceptance contract

The validator (render guard ON) must report **0 errors** on the live `workspace.json` and all four plugin templates (`workspace-minimal/crm/bob/cadence.json`). If it errors on a known-good file, the validator is wrong, not the file — a checker that false-rejects a config the plugin renders is worse than none. Regression-test after any validator change:

```bash
d=<vault>/.obsidian/plugins/bob-workspace
for f in "$d/workspace.json" "$d"/templates/*.json; do
  uv run scripts/validate_workspace.py "$f" | tail -1
done
```

## Render-safety regression

After any change to the render guard, confirm it still distinguishes a non-rendering config from a schema-valid one:

```bash
# Guard ON (default): must report exactly 1 error (unreachable nav) and exit 1
uv run scripts/validate_workspace.py examples/regression_unreachable_nav.json; echo "exit=$?"
# Schema-only: must be VALID and exit 0 — proves schema validity alone is insufficient
uv run scripts/validate_workspace.py examples/regression_unreachable_nav.json --no-render-check; echo "exit=$?"
```
