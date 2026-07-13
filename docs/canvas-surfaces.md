# Canvas surfaces

BOB treats Obsidian **Canvas** (`.canvas`) as a way to *see the operational
context around your work* — not a manual drawing tool. Canvas is the open
[JSON Canvas](https://jsoncanvas.org) format, so everything here writes plain,
standard `.canvas` files.

## Reach every canvas

**Canvases** (left rail, near Team/Settings — or the command **"Open BOB
Workspace — Canvases"**) lists every `.canvas` in your vault, with search and:

- **Open** — full-page, **interactive** inside BOB (pan / zoom / edit; edits save
  straight to the file).
- **Open in tab** — the native Obsidian canvas tab.

The full-page view hosts the real canvas editor, so it's fully editable in place;
use **Pop out to edit** if you'd rather work in a separate tab.

## Generate a canvas from your data

Generated canvases open inline and land in `BOB Workspace/Canvases/`.

| Canvas | Where | What you get |
|--------|-------|--------------|
| **Entity Context** | any entity's detail view → **Context canvas** (or command **"BOB: Context canvas for active note"**) | The focal note at centre, surrounded by its **evidence** (left), **people & systems** (top, incl. linked URLs), **outputs** (right) and **risks / next actions** (bottom) — drawn from links + backlinks — with a summary and labelled arrows. |
| **Agent Audit** | a **Context canvas** on an agent-run note (`ai-session-log`, or any note with agent/session fields) | The run at centre: context & inputs, agents & skills used, **outputs/deliverables produced** (clickable file nodes), and cost & exceptions (minutes, tokens, $, flags). |
| **Process runway** | any entity list whose type has a stage/status lifecycle → **Process canvas** | Left-to-right lanes (one per stage) with the records currently in each, flow arrows between stages, blockers flagged red, and a summary. |
| **Pipeline board** | Canvases → **+ Generate** → *Pipeline board* | Deals in columns by stage; each card links to the deal note. |

Colours are consistent everywhere: **red** = blocked/at-risk, **orange** =
attention, **yellow** = pending, **green** = healthy/complete, **cyan** =
linked context, **purple** = generated summary.

## Regenerate without losing your notes

Generated canvases are **regenerate-fresh**: click the same action again and
BOB's cards refresh from current data. **Anything you add by hand is kept** — add
your own text/file nodes and arrows, regenerate, and they stay. BOB owns the
layout and content of the nodes *it* generates (moving one resets on regenerate);
you own anything you add.

A small sidecar, `<name>.canvas.bobmeta.json`, records which nodes BOB owns so it
knows what to refresh vs. preserve. The `.canvas` file itself stays 100% standard
JSON Canvas — portable to any tool that reads the format.
