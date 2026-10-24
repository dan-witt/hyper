# hyper

Status board for claude-control sessions: a Python board service (MCP client of the daemon) and a React page. Design and decisions: `DESIGN.md`.

## Tickets

Tracked in Linear, team Echowire (key `ECH`). Iteration 1 is [ECH-18](https://linear.app/echowire/issue/ECH-18). Reference the ticket key in branch names and commits.

## Development

- Checks: `uv run pytest`, `uv run ruff check . && uv run ruff format --check .`, `uv run pyright`.
- The `mcp` SDK is 2.x (`MCPServer`, `Client`, `client.listen`); read its installed source rather than v1 examples.
- `hyper.fake_daemon.FakeDaemon` serves claude-control's tools and `sessions://` over a dict. Tests pass `Client(fake.server)` as the connection; nothing in the tests talks to the live daemon.
- To try the service against the live daemon without touching the real board layout, run `XDG_STATE_HOME=<scratch dir> uv run hyper serve`. Do not POST focus there unless switching your tmux client is intended.
- `uv run hyper openapi` prints the schema the page's types are generated from.

Page (`web/`, pnpm via corepack):

- Checks: `pnpm lint`, `pnpm test` (Vitest), `pnpm build` (type-checks tests too), `pnpm e2e` (Playwright, system Chrome via `channel: 'chrome'`; it builds the page and starts `hyper serve --fake` on port 7791 itself), `pnpm check:api` (fails when `src/api/schema.ts` is stale against the service's models; regenerate with `pnpm gen:api`).
- `hyper serve --fake` runs the board over an in-process fake daemon with demo sessions; `/api/fake/*` (only in that mode) changes them.
- Page work with hot reload: `uv run hyper serve --fake --dev-origin http://localhost:5173` and `pnpm dev`; Vite proxies `/api` to port 7780.
- Tile sizes come from CSS container queries on each grid cell (`cqi`/`cqh` in `index.css`), so check a change at 1920x1080 and 3840x2160.

## Constraints that are easy to break

- The daemon's MCP tool names, state names and session fields are a contract owned by claude-control's `DESIGN.md`; change them there first.
- The bearer token stays in the board service; nothing sent to the page may contain it.
- Every POST, PATCH and DELETE keeps the Host, Origin and JSON content-type checks: they are what stops another web page from launching sessions.
