# scanruler-mcp

Drive [ScanRuler](https://scanruler.com/), the browser tool for measuring 3D
scans, from an AI agent. This is a [Model Context Protocol](https://modelcontextprotocol.io)
server: the agent starts it and calls its tools; the ScanRuler tab open in
your browser connects to it over `127.0.0.1` and runs each call there, in
front of you. Every step the agent takes is one step of the tab's undo
history, so you can take any of it back.

Nothing goes anywhere but your own computer: the scan travels from your disk
to your browser through this server, as it does when you open it yourself.
What the agent reads — the figures, the report — goes to the agent's model
provider, like everything else it reads.

## Setting up

You need [Node.js](https://nodejs.org/) 22 or newer, and Chrome, Edge or
Firefox.

### 1. Add the server to your agent

**Claude Code**

```bash
claude mcp add --scope user scanruler -- npx -y scanruler-mcp
```

`--scope user` has it in every project; leave it out for this one only.
Exports the agent makes land in the folder Claude Code was started in,
unless the agent names a path.

**Codex** — the CLI, the IDE extension and the app share one setting:

```bash
codex mcp add scanruler -- npx -y scanruler-mcp
```

or, in `~/.codex/config.toml`, with room for the first start (npx fetches the
package) and for long calls — Codex gives a server 10 seconds to start and a
call 60 unless told otherwise:

```toml
[mcp_servers.scanruler]
command = "npx"
args = ["-y", "scanruler-mcp"]
startup_timeout_sec = 60
tool_timeout_sec = 300
```

**Claude Desktop** — Settings → Developer → Edit Config, then in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scanruler": {
      "command": "npx",
      "args": ["-y", "scanruler-mcp", "--out", "/Users/you/Documents/ScanRuler"]
    }
  }
}
```

Claude Desktop starts servers in a folder of its own, so give `--out` a folder
for the exports, and name files to the agent by their full path. Quit Claude
Desktop after saving — File → Exit; closing the window leaves it running —
and start it again. It starts the server twice, for its chats and for its
Cowork and Code sessions; the copy that starts first holds the port and the
tab connects to it, and the other sends its calls through that one — see
*Several agents* below.

**Cursor** — `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for all:

```json
{
  "mcpServers": {
    "scanruler": {
      "command": "npx",
      "args": ["-y", "scanruler-mcp"]
    }
  }
}
```

**From a clone of the ScanRuler repository**, to try a change: run
`npm --prefix mcp ci` once, then use
`node /path/to/scanruler/mcp/bin/scanruler-mcp.js` where the examples say
`npx -y scanruler-mcp` — in Claude Code,
`claude mcp add scanruler -- node /path/to/scanruler/mcp/bin/scanruler-mcp.js`.

### 2. Let the agent open ScanRuler

Ask the agent for something in ScanRuler — or just *"Connect to ScanRuler"*.
With no tab connected, it calls `scanruler_open`, which opens ScanRuler in
your default browser with the pairing in its address: the tab switches the
connection on with this server's port and token, and connects. The first
time, **Chrome and Edge** ask whether scanruler.com may access "apps and
services on this device" — allow it, that is this server. **Firefox** asks
the same. The tab keeps the pairing, so this is done once per browser.

When the default browser is not the one you use ScanRuler in, or the agent
runs somewhere it cannot open one, pair by hand:

```bash
npx -y scanruler-mcp --pair
```

prints the port, the pairing token and a link. Open the link once in the
browser you use ScanRuler in, or in ScanRuler go to ⚙ **Settings → Agents**,
switch on **Local agent connection**, and enter the port and the token. The
token is made on the first run and kept in your config folder
(`%APPDATA%\scanruler-mcp` on Windows,
`~/Library/Application Support/scanruler-mcp` on macOS,
`$XDG_CONFIG_HOME/scanruler-mcp` elsewhere, `~/.config/scanruler-mcp`
without it). `scanruler_status` hands out the same
link.

A chip in ScanRuler's top bar says where the connection stands: **listening**
while the agent's server is not running, **connected**, or **turned away**
(a wrong token, or another tab connected already — the server takes one tab
at a time). If you denied the browser's question, allow *Local network
access* for the site in the site settings (the icon left of the address) and
reload. **Safari** does not let a page from the web reach the computer it
runs on at all; use `--serve` below.

### Several agents

Any number of copies of the server can share the tab. The first to start
holds the port and the tab's connection; one that finds the port taken
connects to that one, with the same token, and sends its calls through it.
When the copy holding the port stops, another takes the port over, and the
tab — which keeps trying — connects to it within ten seconds.
`scanruler_status` says which this copy is (`server.role`: `holder`,
`relay`, or `none` with `server.error` saying why). Copies with different
tokens cannot share a port: give them the same `SCANRULER_MCP_TOKEN`, or
each its own `--port`. Changes from several agents run one after another in
the tab, each one step of the same undo history.

### Serving the app yourself

```bash
npx scanruler-mcp --serve /path/to/scanruler/dist
```

serves a built ScanRuler (`npm run build` in a clone) at
`http://127.0.0.1:7317/` from the same port the tab connects to — for Safari,
for working offline, and for the open-source build. A page from there needs
no browser permission, and `--pair` then gives a link to it.

### Without a browser (headless)

```bash
npm run build:engine                       # in a clone of ScanRuler
npx scanruler-mcp --engine /path/to/scanruler/dist-engine/engine.mjs
```

runs ScanRuler itself inside the server, with no browser and no tab: the
engine is a build of the app for Node, `dist-engine/engine.mjs`, which the
server loads from where it is and names nothing in. `--headless` takes the
engine built in the checkout the server is part of; `SCANRULER_ENGINE` gives
a path as `--engine` does. There is no scan, no viewport and nobody
watching, so only the commands that run without a page are tools —
`session_state` and `history_undo`/`history_redo` in the app itself, and
whatever a build of ScanRuler marks to run so; a tool that needs the page
(`view_render`, `scan_open` …) answers `unavailable`, naming the page mode.
Files still go by `path`. The server's instructions say it runs headless,
`scanruler_status` says `backend: "headless"` and where the engine is, and
`scanruler_open` has nothing to open. Each server is a session of its own —
an agent's subagents can each start one and work side by side, sharing
nothing — and what the app logs goes to stderr with the server's own lines.
`--tools compact` works headless too: the server's five tools are listed, and
the engine's are read through `scanruler_tools` and run through
`scanruler_batch` (see *Small local models*).
### Small local models

Listed in full, every command the tab offers is a tool of its own: some sixty
tools and 25k tokens of schema in the open-source build, over a hundred and
50k tokens at scanruler.com, all read before the conversation starts. A
frontier model takes that in its stride. A local model with a 128k window
runs out of room within a few tool rounds, and picks less reliably among so
many. For such a model, start the server with `--tools compact` (or set
`SCANRULER_MCP_TOOLS=compact`). It then lists eight tools, about 3k tokens:
the server's five, `scanruler_tools`, and the tab's tools that return a
picture — `view_render` and `flat_render`.

- `scanruler_tools` with no arguments lists the tab's tools, a name and a
  line each, about 1.5k tokens for a hundred. With `names` it gives those
  tools' full definitions, as the full list has them, up to 20 at a time.
  Names it does not know come back in `unknown`.
- The model runs the tools through `scanruler_batch`, one call as a batch of
  one. A refused call comes back with the tab's error code and what was
  wrong, so the model can try again with corrected arguments. A client that
  lets the model call a tool it was not given can call them directly too.
- The tools that return a picture are listed so the model calls them
  directly and sees the picture. In a batch a picture is not shown: it is
  written to a file, the call's `path` or a new file in the output folder
  (`--out`), and the call's result names it. A tab that connects with
  another picture tool has the client list the tools again.

**LM Studio**: add `--tools` and `compact` to the server's arguments as two
separate entries. In `mcp.json`:

```json
{
  "mcpServers": {
    "scanruler": {
      "command": "npx",
      "args": ["-y", "scanruler-mcp", "--tools", "compact"]
    }
  }
}
```

**Codex** with a local model:

```bash
codex mcp add scanruler -- npx -y scanruler-mcp --tools compact
```

or `args = ["-y", "scanruler-mcp", "--tools", "compact"]` in
`~/.codex/config.toml`.

## Options

| Option | |
|---|---|
| `--port <n>` | The port the tab connects to; 7317 unless given. Also `SCANRULER_MCP_PORT`. |
| `--out <dir>` | Where exports go when a tool call names no path; the folder the server was started in otherwise. |
| `--serve <dir>` | Also serve a built ScanRuler from `<dir>`. |
| `--allow-origin <url>` | Let a ScanRuler tab from another address connect — a self-hosted copy. Repeatable. scanruler.com and any page on this computer are always allowed. |
| `--app <url>` | The ScanRuler address the pairing link opens. |
| `--engine <file>` | Run ScanRuler headless in the server, from an engine built with `npm run build:engine` — no tab. Also `SCANRULER_ENGINE`. |
| `--headless` | The same, with the engine built in the checkout the server is part of. |
| `--tools <mode>` | `full`, the default: every command the tab offers is a tool. `compact`: the server's own and the tab's tools that return a picture; the rest are read through `scanruler_tools` and run through `scanruler_batch` — see *Small local models*. Also `SCANRULER_MCP_TOOLS`. |
| `--trace <dir>` | Write a line per tool call — tool, ms, bytes each way, error, whether the tab was hidden — into a new file in `<dir>`, for measuring a run; off unless given. `scripts/trace-summary.mjs` in the ScanRuler repository sums a run up. Also `SCANRULER_MCP_TRACE`. |
| `--trace-args` | With `--trace`, each call's arguments too; otherwise only their size. |
| `--pair` | Print the port, the token and the pairing link, and exit. |
| `--help` | The options. |

`SCANRULER_MCP_TOKEN` overrides the stored token; `SCANRULER_MCP_CONFIG_DIR`
moves the config folder.

## Tools

Every command the ScanRuler tab offers is a tool, its name with dots turned
into underscores — `scan_open`, `element_fit`, `dimension_add`,
`report_get`, `history_undo` and the rest; their descriptions say what each
needs and returns. The list is the tab's while one is connected — a build
with more commands lists more. Before a tab is there it is the list of the
last tab that connected, which the server keeps in its config folder
(`tools.json`), or, the first time, the app's own; a client that lists the
tools once, when it starts, sees them all that way, and one that listens is
told when the list changes. Five more are the server's: `scanruler_status`
(is a tab connected, which version, how to pair one, and what the tab's
session holds — its scan, project, unsaved changes and work counted),
`scanruler_open` (open ScanRuler in the default browser, paired, and wait
for it), `scanruler_wait` (until a tab is connected, or also idle),
`scanruler_batch` (several of the tab's tools in one call, in order — a run
of `scan_nearest` or `element_fit` calls — each answer in its place, stopped
at the first refused unless told to go on) and `scanruler_write` (a text
file — `.md`, `.txt`, `.csv` or `.json`, a report say — written in the folder
the server last opened a scan or a project from, and nowhere else). With
`--tools compact` only the tab's tools that return a picture are listed; the
rest are read through a sixth of the server's own, `scanruler_tools` — see
*Small local models*.

- **Places on the scan** are `{ "point": [x, y, z] }` in millimetres — the
  scan vertex nearest it is taken — or `{ "vertex": n }`. `scan_query` reads
  the scan's own points: the vertices in a box or about a point, with their
  normals, facing a way if asked; `section_get` a section's cut as
  polylines, on the sheet and in the world.
- **Files are paths.** `scan_open`, `deviation_open_reference`,
  `flat_open_image` and `project_load` take `path`, a file on this computer;
  the server reads it and streams it to the tab. The exports and
  `project_save` take an optional `path` — a file, or a folder for the name
  ScanRuler gives it — and the server writes the file there and returns where.
  A tool that replaces the session (`scan_open`, `project_load`,
  `session_reset`) takes `saveTo`: the session is saved as a project file
  there first, then replaced — one call to keep what a tab someone left
  holds.
- **Pictures.** `view_render` comes back as an image the agent sees — the
  3D view as the tab shows it, after `view_set` has turned it if asked — and
  is written to a file only when the call gives `path`. `show` puts the
  scan, the reference, the sections, the elements or the labels away for
  the picture (`{ "scan": false }` shows what was built on the scan on its
  own; a workspace adds keys of its own, which `view_set` lists), and
  `frame` looks at a box or a place closely. `flat_render` is the 2D sheet's:
  drawn as the sheet lies, with a grid ruled in millimetres and its values
  at the margins, and a `map` from picture pixels to sheet places, so a
  place read off the picture goes straight back as a place to click.
  `section_render` pictures a section — or any plane, cut for the picture
  alone — on its own sheet in millimetres: the scan's cut as points, what
  the workspaces draw over it (a model's cut, a sketch's pieces with their
  ids), and every point further than the tolerance from the model in red,
  counted in the answer with the box round them.
- **The 2D sheet** takes places as `[x, y]` in its own millimetres (pixels
  before any scale), origin at the image's bottom-left corner, y up. An edge
  is named by its chain number — `flat_edges` lists them, `flat_render`
  writes them beside the edges, `flat_fit` takes them as `chains` — and a
  pick answers where it snapped. `flat_objects` finds the separate parts on
  an image and measures them; `flat_profile` reads an outline round a centre
  or along an axis and counts its peaks — a knurl's teeth, say.
- **Batches stand or fall whole.** `scanruler_batch` stops at the first
  refused call, and with `rollback` (the default) undoes what the calls
  before it changed — the answer names `failed: { index, tool, error }` and
  `undone`, the steps taken back, newest first (`history_checkpoint` and
  `history_restore` do the same by hand across several calls). `timings:
  true` gives each call its `ms`, the batch its `total_ms`, and a change's
  build the steps it played with their milliseconds (`result.steps.played`;
  otherwise only how many it played and took up from a state held).
- **Long changes.** Every tool that changes the session takes `wait`;
  `wait: false` answers at once with `{ queued: true, job }` while the
  change runs on, a batch too, and `scanruler_wait { for: "job", job }`
  gives its answer when it is done. The server keeps every change as a job,
  so a call the client stopped waiting for keeps running and keeps its
  answer: `scanruler_status` lists the latest jobs, running, done or failed.
  `scanruler_wait { for: "idle" }` waits for the changes still running too,
  and answers `finished`: every change done or failed since it last said —
  a failed one with its error, a batch with the call it stopped at — each
  once, so a run of `wait: false` changes is read back in one call. A
  change called on its own takes `timings: true` as well: its answer adds
  the call's `ms` and the steps its build played. The tab answers what only
  reads — `session_state` — while a change runs.
- **A hidden tab.** A tab in the background, a covered or minimised window
  or a locked screen is hidden to the browser, which then draws no frames
  and slows timers to once a minute. Changes still run, and the waits a
  command makes — for the session to settle, for the screen to follow —
  look again on every change the session's stores see and draw their own
  frames, so pictures still come. `scanruler_status` says `page.hidden`,
  with a note: a browser that unloads background tabs (Chrome's Memory
  Saver) may close it — keep the site among those always kept active.
- **Results** are the session as the tab holds it afterwards, as JSON, in
  millimetres and degrees, every number that is not whole kept to six
  significant digits — except in an answer whose numbers are handed back
  as inputs (a plane's frame, say), which keeps every digit. A refusal comes back as an error with a code —
  `no_scan`, `busy`, `invalid_input`, `invalid_state` (something open in a
  panel is in the way), `not_found`, `failed`, `unavailable`.

A session might go: `scanruler_status`, `scanruler_open` if no tab is
connected, `scan_open`, `session_state` (the scan's bounding box says where
the part lies), `element_fit` twice, `dimension_add`, `report_get`,
`view_render`.

## How it works

The tab connects to `ws://127.0.0.1:<port>/`. Before that, a tab from the web
fetches `http://127.0.0.1:<port>/scanruler-mcp`, which is what has Chrome and
Edge ask for the permission a WebSocket alone never asks for. The server lets
in a tab from scanruler.com, from this computer, or from an `--allow-origin`
address, that presents the pairing token — one tab at a time — and, beside
it, other copies of itself that present the token, whose requests it passes
to the tab (`src/relay.js`). Messages are
JSON; a file travels as a binary frame right after the JSON that announces it,
never as base64 (`src/framing.js`, and `src/commands/framing.ts` in the app).
Everything the server logs goes to stderr; stdout is the MCP channel.

## Development

```bash
npm ci
npm test        # node --test: framing, tool generation, the link, an MCP client end to end
```

The app's browser check `node scripts/e2e-agent.mjs` (from the repository
root, against a running dev server) drives the whole path with the SDK's own
MCP client. `src/commands.json` is the app's command list as of this version,
for listing the tools before a tab connects; the app's test
`tests/mcpCommands.test.ts` keeps it current
(`UPDATE_MCP_COMMANDS=1 npx vitest run tests/mcpCommands.test.ts`).

## Licence

AGPL-3.0-only, as ScanRuler — see [LICENSE](LICENSE).
