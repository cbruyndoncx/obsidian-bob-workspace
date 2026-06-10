# Submission walkthrough

Step-by-step to get BOB Workspace into the Obsidian community plugin store. Follow in order. Every command is copy-paste runnable from the repo root (`/home/cb/projects/github/obsidian-bob-workspace`).

## Pre-flight

Confirm these:

- [ ] `manifest.json` `id` is `bob-workspace` (locked — already in use by your local vault; changing it would orphan your data)
- [ ] `manifest.json` `name` is `BOB Workspace`
- [ ] `manifest.json` `version` matches the tag you're about to create (currently `0.14.4-bob.14`)
- [ ] `versions.json` lists that version → `1.4.0`
- [ ] `LICENSE` is in place
- [ ] Code audit clean (no `console.log`, no `innerHTML`, frontmatter via `processFrontMatter`, vault events via `registerEvent`, intervals via `registerInterval`, destructive prompts via `CadenceConfirmModal` not `window.confirm()`) ✓
- [ ] Author + authorUrl in `manifest.json` are correct (`cbruyndoncx` + `https://github.com/cbruyndoncx` — change if your handle differs)

## Step 1 — Take screenshots

Run from the repo root. For each, navigate Obsidian to the surface, then run the command. macOS shows a window-picker cursor — click your Obsidian window once.

```bash
# 1. Home / Command Centre — both columns visible
screencapture -W -x docs/screenshots/01-home.png

# 2. Inbox — with a few captured items, ideally one in NOW
screencapture -W -x docs/screenshots/02-inbox.png

# 3. Pipeline kanban — with deals across stages
screencapture -W -x docs/screenshots/03-pipeline.png

# 4. Project detail — with milestones, progress bar, Brief filled in
screencapture -W -x docs/screenshots/04-project.png

# 5. Quick capture modal open — text + Remind me toggled
screencapture -W -x docs/screenshots/05-capture.png

# 6. New Deal modal — fields visible
screencapture -W -x docs/screenshots/06-new-deal.png

# 7. CSV Import modal with column mapping table visible
screencapture -W -x docs/screenshots/07-import.png
```

Tip: maximize the Obsidian window first (or resize to ~1440×900) for clean framing. After each shot, check the file isn't tiny: `ls -lh docs/screenshots/`.

## Step 2 — Install GitHub CLI (one-time)

```bash
brew install gh   # or your platform's package manager
gh auth login
```

Choose GitHub.com → HTTPS → Login with a web browser.

## Step 3 — Push the repo

The repo already exists at `cbruyndoncx/obsidian-bob-workspace`. Commit and push your changes:

```bash
git add .
git commit -m "Release v0.14.4-bob.14"
git push
```

Verify it's live: `gh repo view --web`.

## Step 4 — Create the release with the required assets

```bash
gh release create 0.14.4-bob.14 \
  main.js manifest.json styles.css \
  --title "0.14.4-bob.14" \
  --notes "CRM, PRM, Client Work, Finance, Procurement, Planner, Reports, Inbox + reminders, rich Project detail. Markdown source-of-truth."
```

**The tag must match `manifest.json.version` exactly** — no `v` prefix. The bot rejects mismatches.

Required release assets: `main.js`, `manifest.json`, `styles.css`. The workspace templates and the SheetJS XLSX library are **bundled into `main.js`** (see CLAUDE.md → Bundled assets), so they don't need to be uploaded — Obsidian's installer wouldn't deliver them anyway. Before tagging, rebuild and verify: `npm run check` (the build-freshness test fails if the committed `main.js` is stale).

## Step 5 — Submit the PR to obsidian-releases

```bash
cd /tmp
gh repo clone obsidianmd/obsidian-releases
cd obsidian-releases
git checkout -b add-bob-workspace
```

Open `community-plugins.json`. Find a sensible alphabetical spot for `bob-workspace` and add:

```json
{
  "id": "bob-workspace",
  "name": "BOB Workspace",
  "author": "cbruyndoncx",
  "description": "A unified workspace: Home command centre, CRM, PRM, Client Work, Finance, Procurement, Planner with reminders and rich projects, Reports. Markdown source-of-truth, no server required.",
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
  --body "$(cat <<'EOF'
## I am submitting a new Community Plugin

### Repo URL
https://github.com/cbruyndoncx/obsidian-bob-workspace

### Release
https://github.com/cbruyndoncx/obsidian-bob-workspace/releases/tag/0.14.4-bob.14

### Description
A unified workspace plugin: Home command centre, CRM, PRM, Client Work, Finance, Procurement, Planner with reminders, rich Project Management, Reports. All on top of plain markdown — no server, no sync service.

### Confirmation
- [x] I have read the [developer policies](https://docs.obsidian.md/Developer+policies) and the [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).
- [x] My plugin's `manifest.json` is in the root of the repo.
- [x] My GitHub release is tagged to match `manifest.json` version exactly, no `v` prefix.
- [x] `main.js`, `manifest.json`, and `styles.css` are uploaded as release assets.
- [x] I have tested the plugin on the latest Obsidian version.
- [x] My plugin does not include "obsidian" in its name or id.
EOF
)"
```

## Step 6 — Wait for the bot, then humans

- The **`obsidian-bot`** runs automated checks within minutes. If it flags anything, fix in your repo (push a new tag if needed) and comment on the PR.
- A **human reviewer** picks it up over the next 1–4 weeks. They may request changes — common asks:
  - Description rewording (no "obsidian" mentions, no marketing-y language for a separate product)
  - Use Obsidian's `Modal` instead of `confirm()` for destructive actions — **already done** (`CadenceConfirmModal` / `confirmModal()`)
  - Use `requestUrl` for any HTTP (we don't make any yet)
- Push fixes by editing your repo, creating a new release tag, and comment on the PR with the new release link.

## After approval

- Your plugin appears in Settings → Community plugins → Browse.
- For future updates: bump `version` in `manifest.json`, add `"<new-version>": "<min-app-version>"` to `versions.json`, commit, push, then `gh release create <new-version> main.js manifest.json styles.css --title "<new-version>"`. The store auto-detects new releases — no PR needed for updates.

## If a reviewer asks for changes

Common ones:

1. **Idle timers on unload** — wrap `setTimeout`s in the views with cleanup. Most are short-debounced auto-saves; safe in practice but might get flagged.
2. **Settings descriptions** — they may want shorter / less marketing-y copy in the manifest description.

Iterate on whatever the reviewers raise.
