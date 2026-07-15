# Example: add an HR section (`add` route)

**Request:** "Add an HR section to my workspace showing candidates and employees."

> **Why not just add a `dashboards["hr.overview"]` entry?** Because a free-form dashboard id is **not navigable** — the renderer has no branch that mounts an arbitrary `dashboards[id]` from a nav item, so it would show a "coming soon" screen with a `soon` badge (see [references/workspace_schema.md § Navigation render model](../references/workspace_schema.md)). The supported way to add a navigable section for your own entities is a **`secondaryTabs` parent** (tabbed entity views) or **`entityKey` nav items**. Custom multi-widget overview cards only render on a built surface like `home`.

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

A combined two-widget overview only renders on a built surface, so put it on `home`:

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
  --target .obsidian/plugins/bob-workspace/workspace.json \
  --source 99-TMP/OUTPUT/workspace-merged.json
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
- The same change done as a bare `dashboards["hr.overview"]` + nav item would render "coming soon" — the contrast this example exists to teach.
