# hyper

A full-screen status board for the Claude Code sessions tracked by [claude-control](https://github.com/dan-witt/claude-control): one tile per session, state at a glance, click to jump to the session's tmux pane.

Work in progress ([ECH-18](https://linear.app/echowire/issue/ECH-18)); design and decisions are in [`DESIGN.md`](DESIGN.md).

## Run

Needs claude-control running with its MCP token in `~/.config/claude-control/token`.

```sh
uv run hyper serve      # http://127.0.0.1:7780
```

Optional `~/.config/hyper/config.toml`:

```toml
port = 7780
daemon_url = "http://127.0.0.1:7777/mcp"
token_path = "~/.config/claude-control/token"
dev_origins = ["http://localhost:5173"]   # origins allowed to POST besides the board itself
```

Board layout and labels are kept in `~/.local/state/hyper/board.json`.

## API

| Endpoint | Does |
| --- | --- |
| `GET /api/board` | Grid, tiles (each with its session) and daemon connection status |
| `GET /api/events` | SSE: a `snapshot`, then `tile`, `tile_removed`, `grid` and `daemon` changes, and a `heartbeat` every 10s |
| `POST /api/sessions/{id}/focus` | Switch tmux to the session's pane; 409 with the daemon's message on failure |
| `POST /api/tiles/{id}/move` `{"cell": n}` | Put the tile in a cell, swapping with the tile there |
| `PATCH /api/tiles/{id}` `{"label": s, "description": s}` | Set the board label or description; a field left out is unchanged, null or blank clears it |
| `POST /api/tiles/{id}/acknowledge` | Mute a waiting or errored tile until its state changes |
| `POST /api/tiles/{id}/hide` | Take the tile off the grid |
| `POST /api/tiles/{id}/show` `{"cell": n \| null}` | Put a hidden tile in an empty cell, or the first free one |
| `DELETE /api/tiles/{id}` | Remove an ended session's tile |
| `GET /api/launch` | Launch dialog defaults: `{"cwd": <last directory launched in, or "~/">}` |
| `GET /api/dirs?path=p` | Directories completing the last component of `p` (absolute or `~`), each ending in `/` |
| `POST /api/launch` `{"cwd", "name"?, "prompt"?, "cell"?}` | Start a session through claude-control; its tile goes in `cell`. 409 with the daemon's message on failure |
| `POST /api/grid` `{"columns": c, "rows": r}` | Resize the grid; returns the size applied (rows grow to fit occupied cells) |

POST, PATCH and DELETE requests need an `Origin` of the board itself (or a configured dev origin) and `Content-Type: application/json`.

The page is built into `web/dist` and served by the service:

```sh
cd web && pnpm install && pnpm build
```

## Development

```sh
uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run pyright
cd web && pnpm lint && pnpm test && pnpm e2e && pnpm check:api
```

`uv run hyper serve --fake` runs the board over demo sessions instead of claude-control. `uv run hyper serve --dev` reads claude-control, allows the Vite dev server (`pnpm dev` in `web/`) and turns launches into a dry run; add `--live-launch` to start real sessions.

## License

GPL-3.0; see [`LICENSE`](LICENSE).
