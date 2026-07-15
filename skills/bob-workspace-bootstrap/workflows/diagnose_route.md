# Diagnose Route Workflow

Read-only coverage audit. Compares vault reality against the current BOB Workspace UI state and surfaces gaps. Never writes outside `99-TMP/OUTPUT/`.

## Inputs

- `vault_path` — absolute path to user's vault root

## Steps

### 1. Snapshot current UI state

1. Read `.obsidian/plugins/bob-workspace/workspace.json` — capture all declared `domains[]` and `entries[].type`.
2. Read `.obsidian/plugins/metadata-menu/fileClasses/*.md` — capture per-entity field declarations.
3. Read `00-CORE/Schemas/source/*.yaml` if present — capture canonical schema definitions.
4. Read templates folder — capture per-template frontmatter shapes.

### 2. Snapshot vault reality

Run the same detection passes as `minimum` route (no inference rules needed beyond what's already in `frontmatter_census.py`):

- Frontmatter census grouped by `type:`
- Per-type folder distribution
- Per-type field inventory with value samples
- Per-type status-field value distribution

### 3. Diff and categorize gaps

Build the seven gap categories:

| Tier | Category | Detection rule |
|------|----------|----------------|
| **P1** | Entity in vault, missing from UI | type has ≥ 3 notes AND no `workspace.json` entry |
| **P1** | Domain orphan | folder with ≥ 5 typed notes is not assigned to any domain in `workspace.json` |
| **P1** | Status out-of-range | `status:` value observed on ≥ 1 note is not in the kanban column list for that entity |
| **P2** | Field in notes, missing from fileClass | field present on ≥ 30% of notes for an entity but absent from its fileClass |
| **P2** | Template drift | template declares N fields, observed notes show > N (3 fields added in practice) |
| **P3** | UI entry, no data | `workspace.json` exposes a type with 0 matching notes |
| **P3** | Unused fileClass field | fileClass declares a field set on 0 notes |

### 4. Compute remediation per finding

For each finding, append a one-line recommendation:

| Finding | Remediation |
|---------|-------------|
| P1 entity missing | `run bob-workspace-bootstrap minimum or extend` |
| P1 domain orphan | `assign folder {X} to a domain in workspace.json` |
| P1 status out-of-range | `add value '{X}' to kanban columns or rename observed value` |
| P2 field missing from fileClass | `run guided-optimize to accept the field` |
| P2 template drift | `update template at {path} to match observed fields` |
| P3 UI entry no data | `remove entry from workspace.json or backfill notes` |
| P3 unused field | `delete from fileClass or document why it's reserved` |

### 5. Write report

Write to `99-TMP/OUTPUT/bob-workspace-diagnose-{YYYY-MM-DD}.md`:

```markdown
---
type: research
research_type: workspace-diagnostic
research_date: {date}
status: final
---

# BOB Workspace — Coverage Diagnostic

## Summary
- P1 findings: 3
- P2 findings: 7
- P3 findings: 2

## P1 — Data invisible to user (3)
### Entity `deal` exists but is missing from UI
- 47 notes, dominant folder `30-CLIENTS/{id}/01-DEALS/`
- Remediation: `run bob-workspace-bootstrap extend`

...

## P2 — Declared but drifted (7)
...

## P3 — Cleanup (2)
...
```

### 6. Report to user

Summary line: "N findings (P1: x, P2: y, P3: z). Report at {path}."

## Done When

- All seven gap categories assessed against current vault + UI state
- Each finding tagged P1 / P2 / P3
- Each finding has a concrete remediation
- Report written to `99-TMP/OUTPUT/` with frontmatter
- Zero files written outside `99-TMP/OUTPUT/`
