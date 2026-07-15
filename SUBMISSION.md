# Submission walkthrough

Step-by-step to get BOB Workspace into the Obsidian community plugin store.
Follow in order. Commands are copy-paste runnable from the repo root
(`/home/cb/projects/github/obsidian-bob-workspace`).

> **Version-agnostic:** the commands below read the version from `manifest.json`
> so this doc never goes stale. Set it once per session:
>
> ```bash
> VERSION=$(node -p "require('./manifest.json').version")
> echo "$VERSION"   # sanity-check — must have no leading 'v'
> ```

## Pre-flight

Confirm these:

- [ ] `manifest.json` `id` is `bob-workspace` (locked — already used by your local vault; changing it orphans your data)
- [ ] `manifest.json` `name` is `BOB Workspace`
- [ ] `manifest.json` `version` matches the tag you're about to create (`$VERSION`, no `v` prefix)
- [ ] `versions.json` lists that version → its min-app version (`1.4.0`)
- [ ] `package.json` `version` matches `manifest.json` (cosmetic, but keep it in sync)
- [ ] `LICENSE` is in place
- [ ] `npm run check` is green (typecheck + production build + `node --check main.js` + regression suite; the build-freshness test fails if the committed `main.js` is stale)
- [ ] Code audit clean: no `console.log`, no unsafe `innerHTML`, frontmatter via `processFrontMatter`, vault/metadata events via `registerEvent`, intervals via `registerInterval`, destructive prompts via `confirmModal()` not `window.confirm()`
- [ ] `manifest.json` `author` + `authorUrl` correct (`cbruyndoncx` + `https://github.com/cbruyndoncx`)

## Step 1 — Screenshots

The current store set already lives in `docs/screenshots/` (referenced by the
README gallery). They were captured from a **fictional demo vault** (Acme /
Contoso / Fabrikam — no real client data) with only BOB Workspace enabled (clean
chrome), at Full-HD width:

1. `01-home.png` — Home command centre
2. `02-pipeline.png` — CRM Pipeline kanban across stages
3. `03-crm-dashboard.png` — CRM Dashboard (metrics + recent leads/activity)
4. `04-clients.png` — Clients entity list
5. `05-projects.png` — Projects with milestone progress
6. `06-invoices.png` — Customer Invoices (finance surfaces)
7. `07-playbooks.png` — AI Playbooks

**To regenerate** (e.g. after a UI change): build the demo vault and drive the
capture from WSL with the `bob-workspace-screenshots` skill —
`create_demo_vault.py` (copies the starter vault + installs the plugin + coherent
demo data), then `bob_screenshot_walker.py --vault-name bob-demo` (eval-driven
walk; needs the target vault **front-most/visible** so Chromium keeps painting it).
Curate the best few into `docs/screenshots/` with the names above. Otherwise just
capture each surface with your OS tool (`Win+Shift+S`, `screencapture -W -x`, etc.).

## Step 2 — Install GitHub CLI (one-time)

```bash
gh auth login   # GitHub.com → HTTPS → browser
```

## Step 3 — Push the repo

The repo already exists at `cbruyndoncx/obsidian-bob-workspace`. Commit and push:

```bash
git add .
git commit -m "Release $VERSION"
git push
```

Verify it's live: `gh repo view --web`.

## Step 4 — Create the release with the required assets

```bash
gh release create "$VERSION" \
  main.js manifest.json styles.css versions.json \
  --title "$VERSION" \
  --notes "See CHANGELOG.md for this release."
```

- **The tag must match `manifest.json.version` exactly** — no `v` prefix. The bot rejects mismatches.
- **Required** assets are `main.js`, `manifest.json`, `styles.css`. We also attach `versions.json` (harmless, keeps the mapping alongside the release). The workspace templates and the SheetJS XLSX library are **bundled into `main.js`** (see CLAUDE.md → Bundled assets), so they are never uploaded separately — Obsidian's installer wouldn't deliver them anyway.

## Step 5 — Submit the PR to obsidian-releases

```bash
cd /tmp
gh repo clone obsidianmd/obsidian-releases
cd obsidian-releases
git checkout -b add-bob-workspace
```

Open `community-plugins.json`, find a sensible alphabetical spot for
`bob-workspace`, and add:

```json
{
  "id": "bob-workspace",
  "name": "BOB Workspace",
  "author": "cbruyndoncx",
  "description": "A configurable, vault-native workspace: CRM, PRM, client work, finance, procurement, planner, reports and canvas context surfaces — all on plain markdown.",
  "repo": "cbruyndoncx/obsidian-bob-workspace"
},
```

Then:

```bash
git add community-plugins.json
git commit -m "Add BOB Workspace plugin"
git push -u origin add-bob-workspace
gh pr create --repo obsidianmd/obsidian-releases \
  --title "Add plugin: BOB Workspace" \
  --body "$(cat <<EOF
## I am submitting a new Community Plugin

### Repo URL
https://github.com/cbruyndoncx/obsidian-bob-workspace

### Release
https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/$VERSION

### Description
A configurable vault-native workspace: CRM, PRM, client work, finance,
procurement, planner with reminders, projects, reports, and canvas-based context
surfaces. Schema/Base-driven and self-seeding; markdown is the source of truth —
no server, no sync service.

### Confirmation
- [x] I have read the developer policies and submission requirements.
- [x] My plugin's \`manifest.json\` is in the root of the repo.
- [x] My GitHub release is tagged to match \`manifest.json\` version exactly, no \`v\` prefix.
- [x] \`main.js\`, \`manifest.json\`, and \`styles.css\` are uploaded as release assets.
- [x] I have tested the plugin on the latest Obsidian version.
- [x] My plugin does not include "obsidian" in its name or id.
EOF
)"
```

## Step 6 — Wait for the bot, then humans

- The **`obsidian-bot`** runs automated checks within minutes. Fix anything it flags in your repo (push a new tag if needed) and comment on the PR.
- A **human reviewer** picks it up over the next 1–4 weeks. Common asks:
  - Description rewording (no "obsidian" mentions, no marketing-y copy).
  - Use Obsidian's `Modal` instead of `confirm()` for destructive actions — **already done** (`confirmModal()`).
  - Use `requestUrl` for any HTTP — **not applicable** (the plugin makes no network requests).
  - Detaching leaves / idle timers on unload — most timers are short-debounced auto-saves. Note: the canvas host creates an ephemeral `WorkspaceLeaf` and **detaches it on teardown/`onClose`**, which a reviewer may ask about; it's cleaned up deterministically.

## After approval

- The plugin appears in Settings → Community plugins → Browse.
- **Future updates** (no PR needed — the store auto-detects new releases): bump `version` in `manifest.json`, add `"<new-version>": "<min-app-version>"` to `versions.json`, update `CHANGELOG.md`, commit, then:

  ```bash
  VERSION=$(node -p "require('./manifest.json').version")
  git tag -a "$VERSION" -m "BOB Workspace $VERSION"
  git push origin main --follow-tags
  gh release create "$VERSION" main.js manifest.json styles.css versions.json --title "$VERSION" --notes-file <(awk "/^## \\[$VERSION\\]/{f=1;next} /^## \\[/{f=0} f" CHANGELOG.md)
  ```

  This is the exact flow already used for the `0.14.4-bob.*` iteration releases.
