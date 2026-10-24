"""The board service: page API and SSE stream over the daemon link."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterable, AsyncIterator, Callable
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.sse import EventSourceResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from . import dirs
from .board import Board, BoardError, BoardStore, NoSuchTile
from .config import Config
from .daemon import POLL_S, Connect, DaemonError, DaemonLink, DaemonUnavailable
from .hub import Hub
from .models import (
    BoardEvent,
    BoardView,
    Change,
    DaemonEvent,
    DaemonSession,
    DaemonStatus,
    DirCompletions,
    FocusResult,
    Grid,
    GridRequest,
    HeartbeatEvent,
    LaunchDefaults,
    LaunchRequest,
    LaunchResult,
    MoveRequest,
    ShowRequest,
    SnapshotEvent,
    TileEdit,
)

log = logging.getLogger(__name__)

HEARTBEAT_S = 10.0
# The built page, in an editable install of this repo.
WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
LOCAL_HOSTS = ["127.0.0.1", "localhost"]
SAFE_METHODS = {"GET", "HEAD"}


class RequestChecks:
    """Unsafe requests must come from an allowed origin with a JSON body.

    `Content-Type: application/json` makes a cross-origin request need a CORS preflight, which
    this app never grants; the Origin check covers browsers that skip it. Together they stop
    other web pages from triggering actions such as launch.
    """

    def __init__(self, app: ASGIApp, origins: set[str]):
        self.app = app
        self.origins = origins

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            headers = Headers(scope=scope)
            if headers.get("origin") not in self.origins:
                await PlainTextResponse("origin not allowed", 403)(scope, receive, send)
                return
            media_type = headers.get("content-type", "").split(";")[0].strip().lower()
            if media_type != "application/json":
                await PlainTextResponse("expected application/json", 415)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def create_app(
    cfg: Config,
    connect: Connect,
    store: BoardStore | None = None,
    poll_s: float = POLL_S,
    heartbeat_s: float = HEARTBEAT_S,
    web_dist: Path | None = WEB_DIST,
    extra_routes: APIRouter | None = None,
    dry_run_launch: bool = False,
) -> FastAPI:
    """`dry_run_launch` answers launch requests without calling the daemon, so a dev
    service reading the live daemon does not start real sessions."""
    store = store or BoardStore(cfg.board_path)
    board = Board(store.load(), store.save)
    hub = Hub()

    def on_sessions(sessions: list[DaemonSession], unparsed: list[str]) -> None:
        changes = board.update(sessions, unparsed)
        if changes:
            hub.publish(*changes)

    def on_status(status: DaemonStatus) -> None:
        hub.publish(DaemonEvent(daemon=status))

    link = DaemonLink(connect, on_sessions, on_status, poll_s=poll_s)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(link.run())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="hyper", version="0.1.0", lifespan=lifespan)
    app.add_middleware(RequestChecks, origins=cfg.origins)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=LOCAL_HOSTS)
    app.state.board, app.state.link, app.state.hub = board, link, hub

    def view() -> BoardView:
        return BoardView(grid=board.data.grid, tiles=board.tiles(), daemon=link.status)

    @app.get("/api/board")
    def get_board() -> BoardView:
        return view()

    @app.get("/api/events", response_class=EventSourceResponse)
    async def events() -> AsyncIterable[BoardEvent]:
        """A snapshot, then changes as they happen, and a heartbeat when quiet."""
        with hub.subscribe() as queue:
            yield SnapshotEvent(board=view())
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), heartbeat_s)
                except TimeoutError:
                    yield HeartbeatEvent()
                    continue
                if event is None:
                    return
                yield event  # type: ignore[misc]

    @app.post("/api/sessions/{session_id}/focus")
    async def focus(session_id: str) -> FocusResult:
        """Switch tmux to the session's pane."""
        try:
            result = await link.call("focus_session", session_id=session_id)
        except DaemonUnavailable as e:
            raise HTTPException(503, str(e)) from e
        except DaemonError as e:
            raise HTTPException(409, str(e)) from e
        return FocusResult(session_id=result["session_id"], pane=result["pane"])

    def tile_action(session_id: str, action: Callable[[], list[Change]]) -> None:
        try:
            hub.publish(*action())
        except NoSuchTile as e:
            raise HTTPException(404, f"no tile for session {session_id}") from e
        except BoardError as e:
            raise HTTPException(409, str(e)) from e

    @app.post("/api/tiles/{session_id}/move", status_code=204)
    def move(session_id: str, body: MoveRequest) -> None:
        """Put the tile in a cell, swapping with the tile already there."""
        tile_action(session_id, lambda: board.move(session_id, body.cell))

    @app.patch("/api/tiles/{session_id}", status_code=204)
    def edit(session_id: str, body: TileEdit) -> None:
        """Set the board label or description. They never change the session."""
        fields = body.model_dump(include=body.model_fields_set)
        tile_action(session_id, lambda: board.edit(session_id, fields))

    @app.post("/api/tiles/{session_id}/acknowledge", status_code=204)
    def acknowledge(session_id: str) -> None:
        """Mute a waiting or errored tile until its state changes."""
        tile_action(session_id, lambda: board.acknowledge(session_id))

    @app.post("/api/tiles/{session_id}/hide", status_code=204)
    def hide(session_id: str) -> None:
        """Take the tile off the grid, freeing its cell."""
        tile_action(session_id, lambda: board.hide(session_id))

    @app.post("/api/tiles/{session_id}/show", status_code=204)
    def show(session_id: str, body: ShowRequest) -> None:
        """Put a hidden tile in the given empty cell, or the first free one."""
        tile_action(session_id, lambda: board.show(session_id, body.cell))

    @app.delete("/api/tiles/{session_id}", status_code=204)
    def remove(session_id: str) -> None:
        """Remove an ended session's tile."""
        tile_action(session_id, lambda: board.remove(session_id))

    @app.get("/api/launch")
    def launch_defaults() -> LaunchDefaults:
        """Defaults for the launch dialog: the directory last launched in."""
        return LaunchDefaults(cwd=board.data.last_launch_dir or "~/")

    @app.get("/api/dirs")
    def complete_dirs(path: str = "") -> DirCompletions:
        """Directories completing the last component of `path`."""
        return DirCompletions(dirs=dirs.complete(path))

    @app.post("/api/launch")
    async def launch(body: LaunchRequest) -> LaunchResult:
        """Start a Claude Code session in tmux; its tile goes in `cell`. The board does not
        focus it."""
        if body.cell is not None:
            try:
                board.check_free(body.cell)
            except BoardError as e:
                raise HTTPException(409, str(e)) from e
        if dry_run_launch:
            log.info("dry run, not launched: %s", body.model_dump_json(exclude={"prompt"}))
            result = LaunchResult(session_id=None, name=body.name, dry_run=True)
        else:
            args = body.model_dump(include={"cwd", "name", "prompt"}, exclude_none=True)
            try:
                started = await link.call("launch_session", **args)
            except DaemonUnavailable as e:
                raise HTTPException(503, str(e)) from e
            except DaemonError as e:
                raise HTTPException(409, str(e)) from e
            result = LaunchResult(
                session_id=started["session_id"], name=started.get("name"), dry_run=False
            )
        hub.publish(*board.launched(result.session_id, body.cell, body.cwd))
        link.wake()
        return result

    @app.post("/api/grid")
    def set_grid(body: GridRequest) -> Grid:
        """Resize the grid; returns the size applied (rows grow to fit occupied cells)."""
        hub.publish(*board.set_grid(body.columns, body.rows))
        return board.data.grid

    if extra_routes is not None:
        app.include_router(extra_routes)
    if web_dist is not None:
        if web_dist.is_dir():
            app.mount("/", StaticFiles(directory=web_dist, html=True), name="page")
        else:
            log.warning("no built page at %s; run `pnpm build` in web/", web_dist)
    return app
