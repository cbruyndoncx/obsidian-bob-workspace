# Example: add an HR section (`add` route)

**Request:** "Add an HR section to my workspace showing candidates and employees."

This example uses a `secondaryTabs` parent to give each entity its own editable list. A custom dashboard route also works when the nav item's `id` matches a key in `dashboards`; choose that for a widget layout.

## 1. Read current file

`json.load(".obsidian/plugins/bob-workspace/workspace.json")` → confirm `candidate` and `person` exist as schema entities; confirm there's no `hr` nav group yet.

## 2. Add a nav group + a `secondaryTabs` parent (additive)

```python
# new nav group with a single parent item whose id is registered in secondaryTabs
data["navigation"]["groups"].append({
    "id": "hr", "label": "HR", "items": [
        {"id": "hr", "label": "HR", "icon": "users", "desc": "Candidates and employees"}
    ]
})
# the parent id -> its entity tabs (each tab carries its own "+ New <entity>" button)
data["navigation"].setdefault("secondaryTabs", {})["hr"] = [
    {"label": "Candidates", "entityKey": "candidate"},
    {"label": "Employees",  "entityKey": "person"},
]
```

Registering `hr` in `secondaryTabs` does two things: it makes the renderer dispatch the `hr` nav item to a tabbed entity view, **and** it clears the `soon` badge (the plugin adds any `secondaryTabs` parent to its built-surface set).

## 3. (Optional) add an at-a-glance HR row to Home

Put a combined two-widget overview on `home`:

```python
data["dashboards"]["home"]["layout"].append([
    {"title": "OPEN CANDIDATES", "empty": "No open candidates.",
     "entity": "candidate", "source": "recent-open",
     "titleFields": ["candidate_name", "title"], "metaFields": ["status", "role"]},
    {"title": "RECENT EMPLOYEES", "empty": "No employee records.",
     "entity": "person", "source": "recent",
     "titleFields": ["name", "title"], "metaFields": ["role", "company"]},
])
```

Note `source: "recent-open"` / `"recent"` — never `"all"` on a list widget (that renders empty; `all` is stat-card-only).

## 4. Safe-write

```bash
uv run scripts/safe_write.py \
  --target '<absolute-vault-path>/.obsidian/plugins/bob-workspace/workspace.json' \
  --source '<absolute-vault-path>/BOB Workspace/Reports/workspace-merged.json'
```

Output:
```
Backed up: .../workspace.json.bak-compose-20260607-101530
Wrote .../workspace.json — post-write check: VALID
```

## 5. Confirm

Reload the BOB Workspace panel → an **HR** item appears in the sidebar (no `soon` badge) and opens a tabbed view: **Candidates** and **Employees**, each a full list with a `+ New` button. The optional Home row shows the two summary lists.

## Edge cases demonstrated

- `entity: "candidate"` must match a schema source / fileClass. If the vault has no `candidate` records yet, the list shows its `empty` message — correct behaviour, not an error.
- A custom dashboard route works when the nav item's `id` matches the `dashboards` key. This example uses tabs because the request needs editable entity lists.
