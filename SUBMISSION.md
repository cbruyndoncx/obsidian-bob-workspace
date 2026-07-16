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
- [ ] `manifest.json` `description` starts with an action statement (not "A configurable..." / "This is a plugin..."), ≤250 chars, ends with a period, no emoji
- [ ] `versions.json` lists that version → its min-app version (`1.4.0`) — kept for our own history; no longer a hard submission requirement under the current dashboard flow
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
  main.js manifest.json styles.css \
  --title "$VERSION" \
  --notes "See CHANGELOG.md for this release."
```

- **The release's "Tag version" must match `manifest.json.version` exactly** — no `v` prefix.
- **Required** assets are `main.js`, `manifest.json`, and `styles.css` (styles.css is optional if the plugin adds no CSS — ours does, so include it). We also attach `versions.json` for our own history/reference; it's not part of the current submission requirement. The workspace templates and the SheetJS XLSX library are **bundled into `main.js`** (see CLAUDE.md → Bundled assets), so they are never uploaded separately.

## Step 5 — Submit via the Community Directory

> **Process changed 2026-05-13.** Obsidian retired the old `obsidian-releases`
> GitHub-PR submission flow in favor of a web dashboard with automated review.
> There is no `community-plugins.json` PR to open anymore for new plugins.

1. Go to **[community.obsidian.md](https://community.obsidian.md)** and sign in with your Obsidian account.
2. Link your GitHub account to your profile, if not already linked.
3. **Plugins → New plugin.**
4. Enter the repo URL: `https://github.com/cbruyndoncx/obsidian-bob-workspace`.
5. Agree to the developer policies and confirm ongoing support, then **Submit**.

The directory reads `manifest.json` from the repo's default branch (`main`) —
make sure Steps 3–4 above are pushed and the release exists **before** submitting.

## Step 6 — Automated review

The submission is reviewed automatically (code quality + security/malware scan)
— per Obsidian's docs this is typically minutes, not weeks. Fix anything it
flags directly in the repo, cut a new tagged release with the fix, and the
directory re-checks it (check the dashboard for whether it auto-detects the new
release or needs a manual re-submit). Popular/featured plugins or anything the
community flags may still get a manual human review on top of the automated
pass.

## After approval

- Once the automated review passes, the plugin becomes installable — per
  Obsidian's docs, searchable/downloadable in-app within ~24 hours. It then
  appears in Settings → Community plugins → Browse.
- **Future updates:** bump `version` in `manifest.json` (semantic versioning,
  `x.y.z`), update `CHANGELOG.md`, commit, then:

  ```bash
  VERSION=$(node -p "require('./manifest.json').version")
  git tag -a "$VERSION" -m "BOB Workspace $VERSION"
  git push origin main --follow-tags
  gh release create "$VERSION" main.js manifest.json styles.css versions.json --title "$VERSION" --notes-file <(awk "/^## \\[$VERSION\\]/{f=1;next} /^## \\[/{f=0} f" CHANGELOG.md)
  ```

  Confirm on the dashboard whether new releases need a manual re-submit or are
  picked up automatically once the plugin is approved.

## Description style rules (checked by the automated review)

Per current submission requirements, `manifest.json.description`:
- Starts with an action statement (e.g. "Runs...", "Manages...", "Organizes..."), not "This is a plugin that...".
- Max 250 characters, ends with a period, no emoji/special characters.
- `fundingUrl` (if set) must point only to a real donation service (Buy Me a Coffee, GitHub Sponsors, etc.) — omit it if not accepting donations (we don't set it).
- `isDesktopOnly` must be `true` if the plugin uses Node.js/Electron APIs — ours is `false` (mobile-tested; internal-API features like inline canvas hosting are gated behind an opt-in toggle, off by default).
