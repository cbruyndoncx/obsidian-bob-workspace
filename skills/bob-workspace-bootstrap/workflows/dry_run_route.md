# Dry-Run Route Workflow

Orthogonal flag combinable with any other route. Runs all detection and proposal logic but writes nothing outside `99-TMP/OUTPUT/`.

## Steps

### 1. Identify base route

Read `base_route` input (default `minimum`). Load the corresponding workflow.

### 2. Run detection passes

Execute steps 1-3 of the base route (vault discovery, detection passes, inference rules).

### 3. Build full proposal

Generate the full proposal report the base route would produce, including the exact list of files that WOULD be written, with absolute paths.

### 4. Write to dry-run output only

Write to `99-TMP/OUTPUT/bob-workspace-bootstrap-dryrun.md`. Prefix every "Files to be written" path with `[DRY-RUN]`. Do NOT execute any file writes outside this path.

### 5. Report

Summary to user:
- N entities detected across M domains
- K files would be written under `00-CORE/Schemas/` and `.obsidian/plugins/bob-workspace/`
- L existing fileClasses would be preserved
- Path to dry-run report

## Done When

- Detection passes complete
- Dry-run proposal written under `99-TMP/OUTPUT/`
- Zero files created outside `99-TMP/OUTPUT/`
- User can review proposal and re-invoke without `--dry-run` to execute
