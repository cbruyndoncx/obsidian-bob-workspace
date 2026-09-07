# Code and documentation review — 2026-09-07

The original review below covers commit `4cfe0a7` (version `1.3.0`). **R1–R7 are now fixed in the working tree**, following the user's approval. The finding descriptions are retained as historical evidence, not current warnings. Both agent guides and user docs now describe the repaired behavior.

## Resolution

| Finding | Implementation and regression coverage |
|---|---|
| R1 | Shared scalar conversion and live-value guards in `field-values.ts`; table/detail/create guard structured fields; schema item shapes retained; actual editor event tests include an external writer changing the value. |
| R2 | Canonical identity/discriminators flow through runtime loading and new-note defaults, including typed values, person alias, template defaults, and explicit `bob` overrides. Tests cover shared types and runtime file membership. |
| R3 | Marked JSON workbook cells preserve objects/arrays and escape literal prefix strings. A real SheetJS write/read followed by note import verifies round-trip types. Invalid paths and scalar replacements fail without changing notes; errors identify rows. Blank cells leave properties unchanged; primary edits update frontmatter, not filenames. |
| R4 | `canvas-storage.ts` validates before writing, serializes saves, snapshots old bytes, restores on failure, and blocks unresolved recovery. Tests inject read/parse/manifest/write/restore failures and verify manual nodes survive success. Context filenames include the full source-path hash. |
| R5 | Planned archives and recovery records precede moves; failed moves roll back and abort configuration replacement. External Bases remain in place and are snapshotted. Tests cover partial rename failure and a later apply failure with recoverable bytes. |
| R6 | Empty input clears numeric properties; zero and false stay typed. Per-field debounce timers cancel duplicate blur saves and flush pending edits on navigation. |
| R7 | No filter and an empty selected set are distinct; tests cover all → some → none → clear. |

The shared field layer and canvas persistence module address the immediate refactoring opportunities. Full view-controller decomposition, broader strict TypeScript migration, complete runtime schema validation, and body-edit concurrency remain maintenance follow-ups; they are not claimed complete.

## Scope and evidence

Inspected generic table/detail editing, value formatting, schema loading and generation, workspace settings and template application, Base resolution, workbook conversion/import, canvas persistence, and the test harness. This is a targeted source review, not an exhaustive audit of every renderer or the vendored SheetJS implementation. No external research or live vault writes were used.

Run the saved source-level reproductions from the repository root:

```bash
node docs/archive/2026-09-07-code-review-repro.cjs
```

The command now runs `tests/review-fixes.test.js`, using the real bundled module graph with mocked Obsidian/DOM APIs and an in-memory filesystem. The old defect assertions were replaced with desired-behavior regressions and included in the normal test runner. No live Obsidian, theme, mobile, or visual validation was performed.

## Findings

### R1 — High: nested values remain vulnerable to destructive editing

Locations: [inline editor](../../src/views/app-view.ts#L1652), [detail form](../../src/views/app-view.ts#L5853), [schema array conversion](../../src/schemas.ts#L42), [formatter](../../src/entity-files.ts#L456).

The recent protection applies only to the detail form's fallback branch. `_makeInlineEditable()` still initializes a text input with `String(currentVal)` and writes it on blur even when the user changes nothing. For `{paid: true}`, clicking the cell and leaving it replaces the object with the literal string `[object Object]`.

Schema arrays map unconditionally to `tags`. That branch precedes both the detail form's structured-value guard and `fmtValue()`'s structured formatter. An array `[{id: 'invoice'}]` renders as `#[object Object]`, and the detail tag input writes `['[object Object]']` on blur. The reproduction exercises the actual inline and detail handlers and confirms both mutations. Existing formatter tests call `fmtValue(array)` without the schema-derived `tags` type, so they miss this path.

**Recommended fix:** guard the actual current value before choosing any scalar editor and again inside the frontmatter mutation callback; preserve schema item types instead of equating every array with tags. Test schema → renderer → input/blur → persisted frontmatter, including a nested value introduced by another writer after the form opened. Until then, edit nested fields in the note.

### R2 — High: runtime schema identity differs from generated identity

Locations: [schema loader](../../src/schemas.ts#L113), [runtime type assignment](../../src/schemas.ts#L175), [note template](../../src/entity-files.ts#L506), [generated-schema tests](../../tests/schema-type-key.test.js).

`SchemaYaml`/`applySchemas()` do not consume top-level `type_value` or `discriminator`. The loader assigns `typeFilter = entityKey`, then optionally applies `schema.bob`. The reproduction loads `entity: regional-context`, `type_value: research`, and a discriminator; runtime ends with `typeFilter: regional-context` and no discriminator filter. Existing `type: research` records are excluded unless a later `bob` or Base override supplies the intended match. The `person` → `contact` alias has the same risk without `bob.typeFilter: person`.

Generated JSON Schema/FileClass outputs do consume canonical identity, so generated validation can look correct while the application scans for a different type. Separately, generic `entityTemplate()` initializes `type` from `typeFilter || entityKey`; it does not copy `typeFilters.type` or other discriminators into new notes. The earlier agent guidance promised behavior this code does not implement.

**Recommended fix:** centralize canonical-schema → runtime-entity conversion and new-record discriminator defaults, with explicit override precedence. Test a custom entity without a Base or `bob` override, the person alias, and two entity definitions sharing a type. The docs now describe `bob.typeFilter`/`bob.typeFilters` and explicit template defaults as interim configuration workarounds, not a completed fix.

### R3 — High: XLSX round-trip loses nested frontmatter types

Locations: [cell serialization](../../src/workbook.ts#L67), [import normalization](../../src/workbook.ts#L192), [writeback](../../src/workbook.ts#L231).

`xlsxCellValue()` joins all arrays with `'; '`, turning record arrays into `[object Object]`; plain objects become JSON text. `normalizeImportValue()` does not deserialize structured JSON, and `importEntityRows()` writes nonempty imported values over the existing field. Even an unchanged export/import can therefore replace a nested value with a scalar or a string list. The reproduction confirms both conversion failures; it does not exercise Excel itself.

**Recommended fix:** define a schema-aware, reversible workbook encoding for structured values, or exclude unsupported columns from writeback with a clear import report. Do not deserialize arbitrary text merely because it resembles JSON. Add an export → import test that compares persisted value types, not just cell strings.

Related review concerns: `file_path` can select any `TFile` without checking extension/entity membership; clearing an exported cell is skipped rather than removing the field; edits to the primary field are ignored for updates. These behaviors need explicit import semantics and tests before claiming a general round-trip contract.

### R4 — High: canvas preservation fails open on read/parse errors

Location: [canvas writer](../../src/views/app-view.ts#L1022).

`_writeGeneratedCanvas()` catches any read/parse/merge error for an existing file and sets `out = data`, then overwrites the same path. A temporary read error or malformed existing JSON therefore bypasses manual-node preservation. The reproduction injects a read failure and confirms that the writer still writes the fresh canvas to the existing path.

**Recommended fix:** abort replacement when existing content cannot be read and validated; report the path and cause. Keep the old canvas and manifest recoverable if either subsequent write fails. Also derive entity-context output identity from the full source path: two notes with the same basename currently select the same generated output filename.

### R5 — Medium: template switches can silently retain outgoing assets

Locations: [archive helper](../../src/workspace-templates.ts#L108), [template switch](../../src/workspace-templates.ts#L154).

`archiveFolderContents()` swallows per-file rename failures. `applyWorkspaceTemplate()` proceeds after that result and writes the incoming workspace; asset installation is missing-only, so failed moves can leave outgoing definitions mixed with the new template. The reproduction makes every rename fail and confirms the archive helper resolves normally with `count: 0`. The outgoing workspace backup also suppresses failures. Explicit Base paths outside the configured Bases folder are not included in the archive scan.

**Recommended fix:** return attempted/succeeded/failed paths, stop a switch before replacing active config when archival is incomplete, and provide recoverable phase state for failures after successful moves. Decide and document which explicitly mapped Base files the switch owns. Avoid describing a template re-apply as fully idempotent: it rewrites workspace configuration while preserving existing asset contents.

### R6 — Medium: clearing a number stores zero

Locations: [inline coercion](../../src/views/app-view.ts#L1667), [detail coercion](../../src/views/app-view.ts#L5782).

Both editors call `Number(raw)` before handling an empty string. Clearing an optional amount therefore persists `0`, which changes the meaning of an unknown value. The actual detail handler reproduction confirms `42` → empty input → `0`. The create form and importer already have different empty-value handling.

**Recommended fix:** check empty input first and distinguish clear, unchanged, invalid, and valid zero in a shared conversion result. Verify both edit surfaces and downstream missing-value metrics.

### R7 — Medium: deselecting all enum options shows all rows

Location: [table filters](../../src/views/app-view.ts#L1411).

The dropdown represents no selection with an empty `Set`, but `applyFilters()` treats both an absent set and an empty set as “no filter.” Unchecking every option therefore displays all rows while the filter indicator stays active. This finding is established by reading the producer and consumer in the same method; it was not exercised in the DOM fixture.

**Recommended fix:** reserve an absent map entry for “all”; an empty set should match no rows. Add an all → some → none → clear interaction test.

## Refactoring opportunities and inconsistent practices

| Priority | Area | Bounded next step and reason |
|---|---|---|
| First | Field conversion and editing | Extract one typed field conversion layer shared by table, detail, create, and import. R1/R3/R6 arise from independent conversions with different empty, array, and numeric behavior. Keep display formatting separate from persistence. |
| First | Schema contract | Share canonical field/identity types between `schemas.ts` and `schema-designer.ts`. Runtime silently skips YAML parse failures, does not run the canonical validator, accepts `date` while the designer rejects it, maps arrays to tags, and lacks explicit integer/boolean editors. Report per-file load failures instead of presenting fallback entities as a successful schema load. |
| Next | Main view decomposition | `app-view.ts` is 7,757 lines and `settings-tab.ts` is 2,677 at this commit. Extract the entity table/detail controllers, canvas writer/native-view host, and dashboard designer separately, preserving interfaces and testing each boundary. Splitting by renderer responsibility is more useful than a mechanical file-size cut. |
| Next | Save lifecycle | Detail fields share one local debounce timer, blur writes do not cancel the pending write, and local timers are not owned by view cleanup. Centralize cancellation/flush policy and serialize writes per file; inspect body read/modify sequences for lost updates before broadening autosave. This concurrency concern was not reproduced in a live vault. |
| Next | Error boundaries | Distinguish optional capability fallbacks from persistence failures. Swallowing errors is tolerable for a missing optional embed; it is unsafe for canvas replacement, schema loading, and template archival. Preserve causes and paths in notices/results. |
| Next | Tests | `load-main-functions.js` strips module syntax and extracts functions by textual markers. This bypasses actual imported bindings/module state; UI tests often inspect source strings. Keep useful pure tests, but add real-module tests and input-to-persistence fixtures at high-risk boundaries. `plugin-load.test.js` checks bundle evaluation, not `onload()` behavior. |
| Later | Type strictness | `strictNullChecks` is disabled. It is not the only strictness gap: `strict: false` also leaves other strict checks off unless explicitly enabled. Use a dedicated stricter check for selected modules and a staged migration, rather than claiming all remaining typing work is nullable values. |
| Later | Branding/help seams | `_cadEditing`/`_cadEditTimer`, the “Q3 Cadence launch” placeholder, and incidental comments remain despite the earlier “only deliberate references” claim. The new structured-field tooltip is hardcoded in `app-view.ts`, contrary to the `help-content.ts` seam. Move it when repairing the editor; preserve genuine legacy paths/template names/upstream credit. |

## Documentation changes in this pass

- Corrected Base path resolution in README and extension guidance: bare filenames use `basesFolder`; explicit paths stay verbatim, and settings changes do not move files.
- Corrected bundled template loading and BOB asset seeding; qualified archive/re-apply guarantees.
- Replaced the invalid existing-vault YAML example (`key` instead of `name`, UI types as canonical types); fixed undefined `key_fields` in the Person example and added the current runtime identity workaround.
- Corrected schema saving instructions (explicit **Save schema source**) and generated artifact locations/names (schema root and note-facing type).
- Documented canonical `object` support and the runtime/designer type mismatch, nested edit/XLSX limitations, numeric clearing behavior, and default-off native embedding.
- Removed stale claims that every navigation route requires an entity, that unknown plugin-data keys are stripped on load, and that every incidental settings save creates a backup.
- Updated both agent guides with current behavior, open gaps, and this review reference.

## Validation

`npm run check` validates typechecking, production build, bundle syntax and the regression suite, including `review-fixes.test.js`. That suite exercises actual imported modules, real SheetJS serialization, editor events, and injected persistence failures. Corrected schema examples, local documentation link targets, and agent-guide parity are checked separately. Live Obsidian UI validation remains outstanding.
