# Route: add

Insert a NEW element into an existing `workspace.json` — a dashboard, a widget into a dashboard's layout, a nav item, a workbook group, or a stat card. **Merge-preserving**: never rewrite or reorder existing composition.

## Steps

1. **Read the current file** into memory as a Python dict (`json.load`).
2. **Identify the insertion target** with the user: which section, and where.
   - New widget / stat card on an EXISTING built dashboard (e.g. `home`) → append to `dashboards[<built-id>].layout` / `.stats[]`.
   - New navigable section for your entities → idiomatically add a nav item that is **`entityKey`** (single entity list, with a `+ New` button) or a **`secondaryTabs` parent** (tabbed entity views). A free-form `dashboards["foo.overview"]` + a nav item with that exact id DOES render (branch 1 of the dispatch) but only shows a custom widget layout with no built-in create button and a cosmetic `soon` badge — so use it only for a custom dashboard, not to surface raw entity records. The render bug to avoid is a nav id that matches **no** `dashboards`/`secondaryTabs`/`entityKey`/built surface at all — that renders a dead "coming soon" screen and `safe_write.py` will reject it (render-safety guard). See [`../references/workspace_schema.md` § Navigation render model](../references/workspace_schema.md) and [`../examples/example_add_dashboard.md`](../examples/example_add_dashboard.md).
   - New nav item → append to `navigation.groups[].items[]`, and if it's a `secondaryTabs` parent also add its tabs under `navigation.secondaryTabs[<id>]`.
   - New workbook group → append to `workbookGroups[]`.
3. **Author the element** by copying the matching shape from [`../references/widget_catalog.md`](../references/widget_catalog.md). Confirm the `entity` matches an existing schema source / fileClass — an `entity` with no backing records renders an empty widget (not an error, but usually a mistake).
4. **Insert additively.** Add ONLY the new key/array element. Do not touch sibling keys, reorder arrays, or rewrite untouched dashboards. Existing composition the user hand-tuned is sacred.
5. **Write the full merged dict** to a temp file and **safe-write** it (`scripts/safe_write.py`). The validator runs automatically; if it errors, the target is untouched — fix and retry.
6. **Reload** the panel to confirm the element renders.

## Notes

- Adding a nav item bound to a `module` that is off in `settings.modules` means it won't show — enable the module (an `update` on `settings`) or pick an always-on group.
- To add a `base-link`/`base-embed` widget for an entity, ensure `bases[<entity>]` points at a real `.base` file first. Authoring the `.base` is [[obsidian-bases]]' job.
