# Spec — `kind: base-view` widget (live inline Base on a dashboard)

**Plugin:** BOB Workspace (`bob-workspace`, author `cbruyndoncx`) · studied against build `0.14.4-bob.14`  
**Status:** ✅ **Implemented and shipped in `0.14.4-bob.32`.** This document is the original proposal, kept for context; the sections below are the design as drafted, not all of which matches the final code.

> **As built (differs from the proposal below):** the **markdown route in §4.4 does not work** — `MarkdownRenderer.renderMarkdown('![[X.base#view]]', …)` only leaves a placeholder and never loads a Base embed. The shipped implementation uses the **embed-registry route only** (`app.embedRegistry.embedByExtension.base`), passing the view name as the constructor **`#View` subpath** (with the `#`); a bare view name without `#` falls back to the Base's default view. The plugin then waits for the embed **wrapper** to mount (`_baseEmbedMounted`) rather than racing the async row-load, which removes the false "did not render" fallback. Non-table Base views (board/calendar/cards) on **entity surfaces** now use the same live embed, not just dashboard `base-view` widgets. The companion vault-skill/validator changes in §6 are done. See `CHANGELOG.md` `0.14.4-bob.32`.

---

## 1. Problem

Dashboards can reference Bases but cannot render a **live, interactive** one inline. Verified in the current bundle:

| Path | Behaviour | Why |
|------|-----------|-----|
| `kind: base-embed` → `_renderBaseEmbedWidget` | preview card only (header + ≤N rows + Open Base) | renders `entities.slice(0, limit)` as a static list; never mounts a Base view |
| `kind: markdown` body `![[X.base#view]]` → `_renderMarkdownWidget` | shows raw `![[…]]` text | inline markdown currently carries an empty `sourcePath`, so the embed link may not resolve and the Base embed creator is not invoked |
| entity tab → `renderEntityList` | internal table (`_renderEntityTable`) + Open Base button | deliberately an internal table, not the `.base` |

So the only way to see a real `.base` board, calendar, or grouped view is **Open Base** in a separate tab. Goal: a widget that mounts the live Base **inline** in the dashboard grid.

## 2. Goal

A new dashboard widget `kind: base-view` that renders the actual interactive Obsidian Base view, scoped to a named Base view when configured, inside a dashboard cell without requiring the user to open the Base file separately.

## 3. Config contract (`workspace.json`)

```json
{
  "kind": "base-view",
  "title": "TASK BOARD",
  "entity": "task",
  "view": "Board",
  "base": { "file": "Machine/Bases/Tasks.base", "view": "Board" },
  "height": 420,
  "fallback": "preview"
}
```

Fields:

| Field | Meaning |
|-------|---------|
| `kind` | Must be `base-view`. |
| `title` | Optional card title. If omitted, use the Base/widget label resolved by `_resolveBaseWidgetTarget(card)`. |
| `entity` | Preferred portable mapping. Resolves the Base file through `workspace.json.bases`, schema/entity settings, or current Base mapping. In the BOB default model the task entity key is `task`, not `tasks`. |
| `view` | Optional named view inside the `.base` file. If omitted, render the Base default view. |
| `base.file` | Explicit Base path override. Use when no entity mapping exists. |
| `base.view` | Explicit view override. Equivalent to top-level `view`. |
| `height` | Optional pixel height. Default should be around `360`. `0`, `"0"`, `"auto"`, `null`, or omitted means fit content / no forced height. |
| `fallback` | Optional failure behavior: `preview`, `link`, or `error`. Default: `preview`. |

Path/view resolution **must reuse** `_resolveBaseWidgetTarget(card)` so the widget follows existing `entity` → `bases{}` → `settings.baseFiles` behavior and existing `view` / `base.view` resolution. Do not introduce a parallel resolver.

## 4. Required plugin edits (`main.js`)

### 4.1 Register the widget kind everywhere widget types are enumerated

Add `base-view` to the pure dashboard widget types and the dashboard widget catalog near the existing `base-link` / `base-embed` entries:

```js
'base-view': {
  label: 'Base view (live)',
  allowSourceOnly: true,
  requiresBaseOrEntity: true,
  supports: ['base', 'view', 'entity', 'height', 'fallback', 'title'],
},
```

Also add `base-view` to Settings UI type pickers/editors and any workspace review/config inventory tables that enumerate widget kinds. Catalog registration alone is not sufficient; users must be able to select and inspect the widget visually.

### 4.2 Add a render-dispatch branch

In `_renderWidgetByKind(col, card, getWidgetEntities)`, add the branch before the generic markdown/actions/date-range branches:

```js
if (kind === 'base-view') {
  await this._renderBaseViewWidget(col, card, getWidgetEntities);
  return true;
}
```

`getWidgetEntities` must be passed through so fallback preview rendering can reuse the same source/data context. Do not reference a nonexistent `this._getWidgetEntities` helper.

### 4.3 Add `_renderBaseViewWidget(root, card, getWidgetEntities)`

The method should own top-level card creation. Fallbacks must either render inline inside the same card body or delegate before creating a second card. Do **not** call `_renderBaseEmbedWidget(body, ...)` or `_renderBaseLinkWidget(body, ...)` from inside an already-created card body, because those helpers create full cards and would produce nested dashboard cards.

Implementation skeleton:

```js
async _renderBaseViewWidget(root, card, getWidgetEntities) {
  const target = await this._resolveBaseWidgetTarget(card);
  const { basePath, viewName, label } = target;

  if (!basePath) {
    await this._renderBaseViewFallback(root, card, getWidgetEntities, 'No Base file configured');
    return;
  }

  const file = this.app.vault.getAbstractFileByPath(basePath);
  if (!(file instanceof obsidian.TFile)) {
    await this._renderBaseViewFallback(root, card, getWidgetEntities, `Base file not found: ${basePath}`);
    return;
  }

  const cardEl = root.createDiv({ cls: 'cad-dash-card cad-base-view-card' });
  const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
  head.createDiv({ cls: 'cad-dash-card-title', text: label || card.title || 'Base view' });
  if (viewName) head.createSpan({ cls: 'cad-widget-catalog-badge', text: viewName });

  const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-base-view-body' });
  const normalizedHeight = this._normalizeBaseViewHeight(card.height);
  if (normalizedHeight) body.style.height = `${normalizedHeight}px`;

  try {
    await this._mountLiveBaseView(body, file, basePath, viewName);
  } catch (err) {
    body.empty();
    await this._renderBaseViewFallbackContent(body, card, getWidgetEntities, err?.message || String(err || 'Base view unavailable'));
  }
}
```

Suggested height normalization:

```js
_normalizeBaseViewHeight(value) {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null;
  if (String(value).toLowerCase() === 'auto') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 360;
}
```

### 4.4 Mounting strategy

Use a guarded helper so Obsidian internal API differences are isolated.

Preferred order:

1. Try a markdown embed with a non-empty source path using the same Obsidian API shape the plugin already uses: `obsidian.MarkdownRenderer.renderMarkdown(...)`.
2. If markdown rendering does not mount an interactive Base in the target Obsidian version, add an internal `embedRegistry` adapter behind capability detection.
3. If neither route is available, render the configured fallback.

Markdown route:

```js
async _mountLiveBaseView(body, file, basePath, viewName) {
  const md = viewName ? `![[${basePath}#${viewName}]]` : `![[${basePath}]]`;
  await obsidian.MarkdownRenderer.renderMarkdown(md, body, basePath, this);

  // Optional: if Obsidian silently renders plain text instead of an embed,
  // detect that here and throw so fallback behavior is visible.
}
```

Internal embed-registry route, if needed, must be feature-detected:

```js
async _mountLiveBaseViewViaEmbedRegistry(body, file, basePath, viewName) {
  const reg = this.app.embedRegistry;
  const creator = reg?.embedByExtension?.base || reg?.getEmbedCreator?.(file);
  if (!creator) throw new Error('Base embed creator unavailable');

  const linktext = viewName ? `${basePath}#${viewName}` : basePath;
  const embed = creator(
    { app: this.app, containerEl: body, sourcePath: basePath, linktext, showInline: true, depth: 0 },
    file,
    viewName || ''
  );
  if (!embed) throw new Error('Base embed creator returned no embed');

  this.addChild(embed);
  await (embed.loadFile?.() ?? embed.load?.());
}
```

The exact embed-registry signature is an Obsidian internal and must be verified manually against the target Obsidian build before relying on it.

### 4.5 Fallback behavior

Fallback must avoid nested dashboard cards.

Top-level fallback helper:

```js
async _renderBaseViewFallback(root, card, getWidgetEntities, reason) {
  const mode = String(card.fallback || 'preview').toLowerCase();
  if (mode === 'preview') {
    await this._renderBaseEmbedWidget(root, card, getWidgetEntities);
    return;
  }
  if (mode === 'link') {
    await this._renderBaseLinkWidget(root, card);
    return;
  }
  const fallbackCard = root.createDiv({ cls: 'cad-dash-card cad-base-view-card cad-base-view-fallback' });
  fallbackCard.createDiv({ cls: 'cad-dash-card-title', text: card.title || 'Base view' });
  fallbackCard.createDiv({ cls: 'cad-soon-desc', text: `Base view unavailable (${reason})` });
}
```

Inline fallback helper after a live card body already exists:

```js
async _renderBaseViewFallbackContent(body, card, getWidgetEntities, reason) {
  const mode = String(card.fallback || 'preview').toLowerCase();
  if (mode === 'link') {
    const target = await this._resolveBaseWidgetTarget(card);
    body.createDiv({ cls: 'cad-soon-desc', text: reason });
    if (target.basePath) {
      const btn = body.createEl('button', { cls: 'cad-btn cad-btn-small', text: 'Open Base' });
      btn.addEventListener('click', () => this.app.workspace.openLinkText(target.basePath, '', false));
    }
    return;
  }
  if (mode === 'preview' && typeof getWidgetEntities === 'function') {
    // Render a compact inline preview here, not a full nested card.
    const resolved = await this._resolveBaseWidgetTarget(card);
    const entities = await getWidgetEntities(card);
    const rows = Array.isArray(entities) ? entities.slice(0, Number(card.limit) || 5) : [];
    body.createDiv({ cls: 'cad-soon-desc', text: reason });
    const list = body.createDiv({ cls: 'cad-base-embed-list' });
    rows.forEach((item) => list.createDiv({ cls: 'cad-base-embed-row', text: item?.title || item?.name || item?.file?.basename || 'Untitled' }));
    if (resolved.basePath) {
      const btn = body.createEl('button', { cls: 'cad-btn cad-btn-small', text: 'Open Base' });
      btn.addEventListener('click', () => this.app.workspace.openLinkText(resolved.basePath, '', false));
    }
    return;
  }
  body.createDiv({ cls: 'cad-soon-desc', text: `Base view unavailable (${reason})` });
}
```

The exact inline preview can be simpler than `_renderBaseEmbedWidget`; the important requirement is that it does not create another `cad-dash-card` inside the current card.

### 4.6 Styles (`styles.css`)

Add bounded, theme-safe styles for the live Base area:

```css
.cad-base-view-body {
  min-height: 220px;
  overflow: auto;
}

.cad-base-view-fallback .cad-soon-desc {
  margin-top: 0.5rem;
}
```

If live Bases render their own internal scroll container, keep this minimal to avoid fighting Obsidian’s Base layout.

## 5. Optional later enhancement: inline Base in entity tabs

Inline Base rendering inside `renderEntityList` should be treated as a separate feature. Entity screens currently preserve internal table/list behavior for create/edit/import workflows. If added later, it should be behind explicit workspace/settings configuration and must keep the `+ New` and edit workflows available.

## 6. Companion changes outside the plugin runtime

If the workspace/template validation tooling lives in the vault or a separate repo, update it separately:

- `bob-workspace-compose` validator: add `"base-view"` to `KNOWN_WIDGET_KINDS`.
- `references/widget_catalog.md`: add a `kind: base-view` section documenting live inline Base rendering, `view`, `height`, and `fallback`.
- `references/workspace_schema.md`: note that `bases{}` feeds `base-link`, `base-embed`, and `base-view`.

These are companion changes. They should not block the plugin implementation unless the release process requires validator parity before syncing templates.

## 7. Acceptance criteria

1. A dashboard `base-view` widget for `entity: "task"`, `view: "Board"` renders an interactive Tasks Board inline, with no Open Base step.
2. Editing a task note updates the inline view or refreshes correctly after the Base view’s normal Obsidian update cycle.
3. Missing file, missing Bases support, or bad view name produces a visible fallback, never `[object Object]`, a nested card, or a blank cell.
4. Switching dashboards or closing the panel disposes any created embed components with no console errors.
5. Settings UI can create, edit, and inspect `base-view` widgets without showing `[object Object]`.
6. Workspace review/config inventory tables display `base-view` widgets clearly.
7. Existing `base-link`, `base-embed`, `markdown`, `actions`, `selector`, `date-range`, `list`, `metric`, `bar-chart`, `kanban`, and `merge` widgets still render as before.
8. Any external workspace validator used for templates accepts `base-view`.

## 8. Risks / unknowns

- **Obsidian Base embed API:** markdown rendering may be enough, but the internal embed-registry shape varies by Obsidian version. Keep internal API usage behind a small guarded helper.
- **Bases availability:** Bases may be disabled or unavailable in the target Obsidian install. Detect this and fall back with a clear message.
- **Performance:** each live Base is a real view. Avoid rendering many live Base widgets on one dashboard. If needed later, cap live widgets or lazy-load them with `IntersectionObserver`.
- **Height/scroll:** Bases need enough vertical space. Default to a bounded height only when configured/defaulted; allow `auto` for fit-content layouts.
- **Lifecycle:** any manually created embed component must be registered with `this.addChild(embed)` so Obsidian unloads it with the parent view.

## 9. Effort

Estimated plugin work: ~0.5–1 day.

Expected local changes:

- `main.js`: widget type registration, Settings editor enumeration, render dispatch, live Base mount helper, fallback helpers.
- `styles.css`: minimal live Base container styles.
- Optional external docs/validator files if the template validation workflow requires them.

## 10. Test plan

Plugin checks:

- `node --check main.js`
- Existing local test runner, if applicable.

Manual Obsidian checks:

- Dashboard with `base-view` for an entity with records.
- Dashboard with `base-view` for an empty Base.
- Bad Base file path.
- Bad view name.
- Bases disabled/unavailable, if possible to simulate.
- Switching dashboards repeatedly and closing/reopening the workspace view.
- Settings editor: create a new `base-view` card, edit an existing one, save, reload plugin, verify persisted config.
- Existing `base-link` and `base-embed` widgets still render without regression.
