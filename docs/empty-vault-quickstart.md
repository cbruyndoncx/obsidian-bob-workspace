# Quick start — BOB Workspace in a new (empty) vault

The happy path from "just enabled the plugin" to "a working workspace with your
first records." For a vault that *already has notes*, use
[`installing-into-existing-vault.md`](installing-into-existing-vault.md) instead —
the steps differ (you describe your existing data with schema YAML first).

---

## 1. Enable the plugin

Copy `main.js`, `manifest.json`, `styles.css` into
`<vault>/.obsidian/plugins/bob-workspace/`, then enable **BOB Workspace** under
Settings → Community plugins (restart Obsidian if it doesn't appear).

On first load the plugin seeds the starter templates and opens the **workspace
template picker** automatically (because there's no `workspace.json` yet).

## 2. Pick a starter template

The picker offers these. Pick by what you want to run — you can switch or
customize later.

| Template | Gives you | Pick if… |
|----------|-----------|----------|
| **Minimal** | Just Home + Settings; build your own nav | You want a blank slate and will design navigation yourself |
| **CRM Only** | Pipeline, Contacts, Clients, Leads, Campaigns, Activities, Reports + Planner | You want sales/CRM without Finance/PRM/Procurement |
| **BOB Workspace** | The full suite: Planner, CRM, Marketing, PRM, Client Work, Finance, Suppliers & Procurement, HR & People, Reports (incl. KPI Scoreboard), AI Workspace, Research & Knowledge, and Operational Audit (schema-driven) | You want the complete business workspace |
| **Cadence Classic** | Planner, CRM, PRM, Client Work (uses `Cadence/` folders) | You're coming from the original Cadence layout |
| **EMAI Starter** | PARA-style personal workspace (tasks/projects/areas/people/daily, content, workflows) — brings its own entity definitions | You want a personal/PARA setup rather than a business CRM |

**Recommended first pick:** **CRM Only** (focused, immediately useful) or **BOB
Workspace** (everything). You can Apply a different one anytime from
Settings → BOB Workspace → **Apply workspace template…**.

> Prefer to decide later? Click **Skip** — you stay on the minimal built-in nav
> (Home + Settings) and can apply a template whenever you like.

## 3. What applying a template does (automatically)

On a fresh vault this is non-destructive (nothing is archived). Applying:

- writes your `workspace.json` (navigation, dashboards, export groups, settings);
- seeds the schema model — for schema-driven templates (BOB Workspace, EMAI) it
  writes the record-type YAML and regenerates the derived FileClasses / JSON
  Schemas;
- reloads, so the full left navigation and dashboards appear.

The UI is now live — but **lists are empty**, because a new vault has no notes
yet. That's expected. Next you create records.

## 4. Create your first records

Each entity list has a **`+ New <entity>`** button (and there's global
**Quick capture** — `Ctrl/Cmd+Shift+I`). Creating a record writes a markdown note
with the right `type:` frontmatter into the entity's folder, and it appears in
the list immediately. A good first pass:

1. **A contact or client** — CRM → Contacts / Clients → *+ New*.
2. **A deal** — CRM → Pipeline → *+ New* (drag it across stages on the board).
3. **A task or today entry** — Planner → Today: type in the quick-add box and
   press Enter (it appends to today's daily note), or Planner → TaskNotes → *+ New*.
4. **A project** — Planner → Projects → *+ New*.

As soon as records exist, the dashboards (counts, recent lists, pipeline) fill in.

## 5. Make Today interactive (optional)

Out of the box, **Today** shows the diary pane (your daily note with live
checkboxes). To turn it into a configurable, interactive dashboard:

- Settings → BOB Workspace → **Modules** → find `planner.today` → **Edit
  dashboard** → **Customize**.
- That seeds the built-in interactive layout — a date header, an interactive
  **task-list** (tick to complete), a **quick-add** box, and a **journal**
  editor — all editable widgets. Point the task-list at a Base+view or a task
  entity from the widget's editor if you want.

**Reset to built-in** in the same place reverts to the diary pane.

## 6. Customize the rest (when you're ready)

- **Modules tab** — toggle whole sections on/off; set each entity's folder and
  Base; open the Surface Designer per dashboard.
- **Navigation tab** — drag to reorder nav, add/remove items.
- **Surface Designer** (command palette: *Open BOB Workspace — Surface Designer*)
  — edit any dashboard's widgets with live preview.
- Every tab and widget editor has a **? Help** panel and hover tooltips.

## 7. Data lives in your markdown

BOB never hides your data — every record is a plain markdown note with YAML
frontmatter, in a normal vault folder. The plugin is a UI over those files. Export
to XLSX (Data tab / command) or import CSV/XLSX anytime.

---

### If lists stay empty after creating notes

The note's `type:` frontmatter and/or folder must match the entity definition.
Check Settings → BOB Workspace → **Modules** for the entity's folder, and confirm
the note carries the expected `type:`. For a fully custom data model, define it in
schema YAML (see [`installing-into-existing-vault.md`](installing-into-existing-vault.md)).
