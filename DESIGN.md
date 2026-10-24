# hyper design

Ticket: [ECH-18](https://linear.app/echowire/issue/ECH-18). Decided 2026-10-24.

hyper is the status board for the Claude Code sessions that [claude-control](https://github.com/dan-witt/claude-control) tracks: a full-screen web page with one tile per session in fixed grid cells. Click a tile to focus the session's tmux pane; right-click an empty cell to launch a session. It is the Dashboard component of the [Agent Status Board design](https://claude.ai/artifact/95onJgMf4EDciR5mD3wUjn), section "Board UI, iteration 1".

## Scope

In (iteration 1): live tiles, focus, grid layout with drag, acknowledge, labels, hide, launch.
Out: calendar, tasks, voice, "why" summaries, a detail panel, renaming the Claude Code session itself.

## Components

- **claude-control** (the daemon) stays pure MCP. hyper never reads its `/sessions` endpoint or its database.
- **Board service** (`src/hyper/`): a Python process that is an MCP client of the daemon and serves the page and its API. It holds the daemon's bearer token; the browser never speaks MCP and never sees the token.
- **Page** (`web/`): a React app that receives session diffs over SSE and sends actions to the board service.

## Daemon fields

Added to claude-control for the board (`DESIGN.md` there is the contract):

| Field | Meaning |
| --- | --- |
| `state_since` | When the session entered its current state; resets when the state or the reason changes |
| `last_event_at` | Timestamp of the last event |
| `last_event_text` | The last event in words (previously the TUI's `describe()`) |
| `replaces` | The session id this session replaced through `/clear` or `/resume` on the same process |

## Board service

- Python 3.12 with uv; FastAPI + uvicorn; the `mcp` 2.x client.
- Listens on `127.0.0.1:7780`; runs as a systemd user unit.
- Subscribes to `sessions://` and also polls `list_sessions` every 2s, because tool activity and last-event text change without a notification. It diffs each result against the previous one and pushes per-session changes to the page over SSE, with a heartbeat so the page can tell a dead service from a dead daemon.
- The MCP HTTP client has no read timeout, because the `subscriptions/listen` stream is silent while nothing changes (httpx2's default 5s read timeout dropped it every few seconds). Each tool call has its own 10s timeout instead, so a hung daemon still counts as disconnected.
- The listing asks for every state, ended included, so ended sessions keep their Offline tiles.
- API types: pydantic models produce the OpenAPI schema, SSE payloads included; `openapi-typescript` generates the page's types from it. A check fails when the generated types are stale.
- Request checks on every POST, PATCH and DELETE: a localhost `Host`, an `Origin` equal to the board's own, and `Content-Type: application/json`. The JSON requirement forces a CORS preflight, which the service never grants, so another web page cannot trigger an action such as launch.
- Config: `$XDG_CONFIG_HOME/hyper/config.toml` (port, daemon URL, token path). UI state: `$XDG_STATE_HOME/hyper/board.json`, written only by the service.

## Tiles

- One tile per `session_id`. A session whose `replaces` names a session with a tile takes over that tile's cell and labels.
- A tile shows the name, an optional description, the state decorator, `last_event_text`, the age (ticked by the page from `last_event_at`), and an activity indicator while a main-agent tool call is open.
- Grid of fixed cells, columns × rows in `board.json`, default 3×2. A tile is dragged between cells and swaps with a tile already in the target cell. A new session takes the first free cell; when every cell is full the grid adds a row. The board never reorders tiles.
- Resizing the grid keeps each tile's reading-order index, so tiles reflow when the column count changes; rows never drop below what the occupied cells need. The grid never shrinks by itself.
- Drag uses `@dnd-kit/core` with an 8px activation distance, so a click still focuses; the click that ends a drag is ignored. The page moves the tile at once and resyncs from `/api/board` if the service refuses the move.
- Pulse: about 3s when a tile enters `waiting` (any reason) or `error`, only when `state_since` is under 5s old, so reloading the page does not pulse every tile.
- Acknowledge applies to `waiting` and `error` tiles. It stores the tile's `state_since`; the tile is muted until `state_since` changes.
- A hidden tile gives up its cell. "Show hidden" on an empty cell puts the chosen tile in that cell; the API without a cell uses the first free one.
- An ended session that was not replaced keeps a hollow Offline tile until it is removed, or until the daemon forgets the session (24h). Only an ended session's tile can be removed; a live one can only be hidden, since the board would otherwise make it a new tile on the next listing.
- `--bg` sessions and sessions outside tmux get tiles; a failed focus shows the daemon's error as a toast.
- Daemon unreachable: a banner, tiles greyed with their last state, automatic reconnect.

## Interaction

| Gesture | Action |
| --- | --- |
| Click a tile | `focus_session` |
| Right-click a tile | Acknowledge, rename (board label), edit description, hide, copy project path, remove (ended tiles) |
| Right-click an empty cell | Launch a session into that cell; "Show hidden (n)"; grid size (presets and a custom columns × rows dialog) |

The launch dialog has a directory field with completion served by the board service (default: the last directory launched in, kept in `board.json`), an optional name and a multi-line prompt; `Ctrl+Enter` launches, and Enter in a field never does. Tab completes the common prefix of the suggestions, or moves on when there is nothing longer; arrows and Enter pick one. A launch error stays in the dialog. The board does not focus the new session.

The launched session's tile goes in the cell that was right-clicked. The service holds that cell for the returned `session_id` for 60s, since a listing fetched before the launch returned can arrive after it; other new sessions skip a held cell. If the daemon lists the session before the launch call returns, its tile is moved to the cell. A held cell that has since been taken yields the first free cell.

Rename, description, acknowledge and hide are board state; they never change the session. A blank label or description clears it, and the tile falls back to the session name or project path.

## Page

- React 19, TypeScript, Vite, pnpm. dnd-kit for drag, Radix primitives for the context menu and dialog, Tailwind v4, a Zustand store fed by SSE.
- Dark only. Readable from the side of the desk: large type, state shown as a thick coloured left edge plus a tinted background. Each grid cell is a CSS size container and a tile's type, edges and padding are in container units, so a tile reads the same at any screen size or grid shape.
- The page keeps no state beyond the latest snapshot plus changes; it reconnects the SSE stream when `EventSource` gives up or when no message (heartbeats included) arrives for 25s.
- Shown as a full-screen app window on DP-2; 2 columns when it gets half a monitor. `hyper window` starts Chrome with `--app` and its own profile at the monitor's RandR geometry, then asks the window manager for `_NET_WM_STATE_FULLSCREEN`: Chrome ignores `--start-fullscreen` and `--kiosk` for an app window. The open window is found through the profile's `SingletonLock` (`<host>-<pid>`) and `_NET_WM_PID`, so running it again moves that window instead of opening another. A login autostart entry runs it; it waits up to 60s for the service.
- Dev: the Vite dev server proxies `/api` to the service. Production: the service serves the built `web/dist`.

## Testing and dev

- Service: pytest against a fake MCP daemon that serves the same tools and resource.
- Page: Vitest + Testing Library for components and store logic.
- End to end: Playwright against the service wired to the fake daemon.
- `hyper serve --dev` reads the live daemon, allows the Vite dev server's origin, and answers launch requests as a dry run without calling the daemon; `--live-launch` sends them. `hyper serve --fake` launches into the fake daemon, so the tile appears.

## Steps

1. claude-control: the four daemon fields; the TUI uses `last_event_text`.
2. Board service: MCP client, diffing, SSE, `board.json`, fake daemon, tests.
3. Page: live tiles, state colours, pulse, click to focus.
4. Grid: cells, drag, persistence, columns × rows.
5. Context menu: acknowledge, description, rename, hide and show hidden, copy path, remove.
6. Launch: empty-cell menu, dialog with directory completion, request checks.
7. systemd unit and the full-screen app window on DP-2.
