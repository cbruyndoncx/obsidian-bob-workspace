# Extend Route Workflow

Vault already has some YAML source files. Detect, preserve verbatim, add new YAML only for uncovered entity types.

## Executable

`scripts/extend.py` drives both passes:

```bash
# Propose — writes 99-TMP/OUTPUT/bob-workspace-bootstrap-merge.md, no other writes
uv run scripts/extend.py --vault <path> --propose

# Execute — writes YAML for the selected entities via generate_yaml.py (no overwrite)
uv run scripts/extend.py --vault <path> --execute --entities entityA,entityB
```

## Steps

### 1. Inventory existing YAML source

Read every `*.yaml` / `*.yml` in the configured schemas folder. Capture entity names and field lists.

### 2. Run detection passes

Same as `minimum` route steps 2-3 (template scan + frontmatter census + domain mapping).

### 3. Diff

Build two sets:
- **Covered**: entity exists in YAML source — leave untouched, list in merge report.
- **Uncovered**: entity has ≥ 3 notes, no YAML source — propose new YAML.

### 4. Field drift check (advisory)

For Covered entities, list fields observed in census but not in existing YAML. Surface as "drift candidates" in the merge report. Do NOT modify the YAML; defer to `guided-optimize`.

### 5. Write merge report

`99-TMP/OUTPUT/bob-workspace-bootstrap-merge.md`:
- Covered entities (preserved)
- Uncovered entities (will write)
- Drift candidates per Covered entity (optimize later)

### 6. User confirmation gate

Stop. Present report. Wait for "proceed."

### 7. Write YAML for uncovered entities

One file per uncovered entity via:

```bash
uv run scripts/generate_yaml.py --vault <vault> --entity <slug> \
  --location-pattern "<folder>" --domain <domain>
```

Script refuses to overwrite existing YAML. Field-name dedup is built in — required after the dup-`status` bug in v2.x where baseline fields collided with observed enum fields and broke plugin Regenerate.

### 8. Tell user

> Wrote N new YAML source files. Click Settings → BOB Workspace → Regenerate to apply. {M} existing entities have field drift; run `guided-optimize` to walk through them.

### 9. Done When

- Merge report shows Covered, Uncovered, and Drift lists
- New YAML written only for Uncovered entities
- No existing YAML touched
- User offered `guided-optimize` follow-up
- Zero writes outside `00-CORE/Schemas/source/` and `99-TMP/OUTPUT/`
