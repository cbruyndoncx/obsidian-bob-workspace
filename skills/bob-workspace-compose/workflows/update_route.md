# Route: update

Modify an EXISTING element in `workspace.json` — retitle a dashboard, change a widget's `source`/`limit`/`metaFields`, reorder a layout, tweak a stat card, toggle a `settings.modules` flag.

## Steps

1. **Read the current file** into a Python dict.
2. **Locate the exact element** by its path (e.g. `dashboards["crm.deals.overview"].layout[0][1]`). Echo the current value back to the user so the change target is unambiguous before editing.
3. **Apply the minimal change.** Edit only the specific keys requested. Preserve every other key on the element verbatim — an update must never silently drop fields the user didn't mention.
4. **Validate the shape** of the changed element against [`../references/widget_catalog.md`](../references/widget_catalog.md) (e.g. a `kanban` needs `groupBy`; a `selector` needs `key`+`field`).
5. **Write the full dict** to a temp file and **safe-write** it. The validator gate protects against a malformed edit reaching disk.
6. **Reload** and confirm.

## Notes

- Reordering: to move a dashboard earlier/later in the panel, reorder its key position (Python dicts preserve insertion order) — but prefer this only when the user explicitly asks for ordering changes, to keep diffs small.
- Renaming a dashboard **id** (the key) is a structural change — any nav item or pinned surface referencing the old id must be updated in the same write, or it dangles. Prefer changing `title` (display) over the id (identity) unless an id rename is the actual goal.
- Changing `source` from a string to an object (e.g. to add `filters`) is a valid, common update — see the source-forms table in the widget catalog.
