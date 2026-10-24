"""The board service: page API and SSE stream over the daemon link."""

import asyncio
import contextlib
from collections.abc import AsyncIterable, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.sse import EventSourceResponse
from starlette.datastructures import Headers
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .board import Board, BoardStore
from .config import Config
from .daemon import POLL_S, Connect, DaemonError, DaemonLink, DaemonUnavailable
from .hub import Hub
from .models import (
    BoardEvent,
    BoardView,
    DaemonEvent,
    DaemonSession,
    DaemonStatus,
    FocusResult,
    HeartbeatEvent,
    SnapshotEvent,
)

HEARTBEAT_S = 10.0
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
) -> FastAPI:
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

    return app
