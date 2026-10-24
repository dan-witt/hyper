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

POSTs need an `Origin` of the board itself (or a configured dev origin) and `Content-Type: application/json`.

## Development

```sh
uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run pyright
```

## License

GPL-3.0; see [`LICENSE`](LICENSE).
