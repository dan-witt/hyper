import asyncio
import contextlib
import json
import socket
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import anyio
import httpx2
import pytest
import uvicorn
from mcp import Client

from hyper.app import create_app
from hyper.config import Config
from hyper.fake_daemon import FakeDaemon


@pytest.fixture
def anyio_backend():
    return "asyncio"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class Service:
    fake: FakeDaemon
    cfg: Config
    url: str
    up: list[bool]

    @property
    def origin(self) -> dict[str, str]:
        return {"origin": f"http://127.0.0.1:{self.cfg.port}"}


@pytest.fixture
async def service(tmp_path) -> AsyncIterator[Service]:
    fake = FakeDaemon()
    cfg = Config(port=free_port(), state_dir=tmp_path)
    up = [True]

    @contextlib.asynccontextmanager
    async def connect() -> AsyncIterator[Client]:
        if not up[0]:
            raise ConnectionError("daemon down")
        async with Client(fake.server) as client:
            yield client

    app = create_app(cfg, connect, poll_s=0.2, heartbeat_s=0.3)
    app.state.link.retry_s = 0.1
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=cfg.port, log_level="warning")
    )
    task = asyncio.create_task(server.serve())
    with anyio.fail_after(5):
        while not server.started:
            await asyncio.sleep(0.01)
    yield Service(fake, cfg, f"http://127.0.0.1:{cfg.port}", up)
    server.should_exit = True
    await task


async def board(svc: Service) -> dict[str, Any]:
    async with httpx2.AsyncClient() as http:
        r = await http.get(f"{svc.url}/api/board")
    assert r.status_code == 200
    return r.json()


async def until(svc: Service, check) -> dict[str, Any]:
    with anyio.fail_after(5):
        while True:
            b = await board(svc)
            if check(b):
                return b
            await asyncio.sleep(0.05)


@contextlib.asynccontextmanager
async def stream(svc: Service) -> AsyncIterator[AsyncIterator[dict[str, Any]]]:
    async with (
        httpx2.AsyncClient(timeout=None) as http,
        http.stream("GET", f"{svc.url}/api/events") as r,
    ):
        assert r.headers["content-type"].startswith("text/event-stream")

        async def events() -> AsyncIterator[dict[str, Any]]:
            async for line in r.aiter_lines():
                if line.startswith("data: "):
                    yield json.loads(line[len("data: ") :])

        yield events()


async def next_event(events: AsyncIterator[dict[str, Any]], *types: str) -> dict[str, Any]:
    with anyio.fail_after(5):
        async for e in events:
            if e["type"] in types:
                return e
    raise AssertionError("stream ended")


def tile_ids(b: dict[str, Any]) -> list[str]:
    return [t["session_id"] for t in b["tiles"]]


@pytest.mark.anyio
async def test_snapshot_then_changes_on_notification(service):
    service.fake.add("a", state="running")
    await until(service, lambda b: tile_ids(b) == ["a"])
    async with stream(service) as events:
        snap = await next_event(events, "snapshot")
        assert snap["board"]["daemon"] == {"connected": True, "error": None}
        assert snap["board"]["grid"] == {"columns": 3, "rows": 2}
        [tile] = snap["board"]["tiles"]
        assert (tile["cell"], tile["session"]["state"]) == (0, "running")

        service.fake.update("a", state="waiting", reason="done")
        await service.fake.notify()
        e = await next_event(events, "tile")
        assert (e["tile"]["session"]["state"], e["tile"]["session"]["reason"]) == (
            "waiting",
            "done",
        )


@pytest.mark.anyio
async def test_polling_picks_up_changes_without_notification(service):
    service.fake.add("a", state="running")
    await until(service, lambda b: tile_ids(b) == ["a"])
    async with stream(service) as events:
        await next_event(events, "snapshot")
        service.fake.update("a", last_event_text="running Bash", current_tool="Bash")
        e = await next_event(events, "tile")
        assert e["tile"]["session"]["current_tool"] == "Bash"


@pytest.mark.anyio
async def test_new_and_forgotten_sessions(service):
    async with stream(service) as events:
        await next_event(events, "snapshot")
        service.fake.add("a")
        await service.fake.notify()
        assert (await next_event(events, "tile"))["tile"]["session_id"] == "a"
        del service.fake.sessions["a"]
        await service.fake.notify()
        assert (await next_event(events, "tile_removed"))["session_id"] == "a"


@pytest.mark.anyio
async def test_row_the_board_cannot_read_is_skipped(service):
    service.fake.add("a")
    service.fake.add("b", state="hibernating")
    b = await until(service, lambda b: tile_ids(b) == ["a"])
    assert b["daemon"]["connected"]


@pytest.mark.anyio
async def test_heartbeat_when_quiet(service):
    async with stream(service) as events:
        await next_event(events, "snapshot")
        await next_event(events, "heartbeat")


@pytest.mark.anyio
async def test_unreachable_daemon_is_reported_then_recovers(tmp_path):
    cfg = Config(port=free_port(), state_dir=tmp_path)
    fake = FakeDaemon()
    up = [False]

    @contextlib.asynccontextmanager
    async def connect() -> AsyncIterator[Client]:
        if not up[0]:
            raise ConnectionError("daemon down")
        async with Client(fake.server) as client:
            yield client

    app = create_app(cfg, connect, poll_s=0.2, heartbeat_s=0.3)
    app.state.link.retry_s = 0.1
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=cfg.port, log_level="warning")
    )
    task = asyncio.create_task(server.serve())
    try:
        with anyio.fail_after(5):
            while not server.started:
                await asyncio.sleep(0.01)
        svc = Service(fake, cfg, f"http://127.0.0.1:{cfg.port}", up)
        b = await until(svc, lambda b: b["daemon"]["error"] != "connecting")
        assert b["daemon"] == {"connected": False, "error": "ConnectionError: daemon down"}
        async with stream(svc) as events:
            await next_event(events, "snapshot")
            up[0] = True
            e = await next_event(events, "daemon")
            assert e["daemon"] == {"connected": True, "error": None}
    finally:
        server.should_exit = True
        await task


@pytest.mark.anyio
async def test_focus(service):
    service.fake.add("a", state="waiting", reason="done", pane="%7")
    await until(service, lambda b: tile_ids(b) == ["a"])
    async with httpx2.AsyncClient() as http:
        r = await http.post(f"{service.url}/api/sessions/a/focus", json={}, headers=service.origin)
        assert r.status_code == 200
        assert r.json() == {"session_id": "a", "pane": "%7"}
        assert service.fake.focused == ["a"]

        service.fake.focus_error = "session a is not running in tmux"
        r = await http.post(f"{service.url}/api/sessions/a/focus", json={}, headers=service.origin)
        assert r.status_code == 409
        assert r.json()["detail"] == "session a is not running in tmux"


@pytest.mark.anyio
async def test_focus_while_disconnected_is_503(tmp_path):
    cfg = Config(port=free_port(), state_dir=tmp_path)

    @contextlib.asynccontextmanager
    async def connect() -> AsyncIterator[Client]:
        raise ConnectionError("daemon down")
        yield  # pragma: no cover

    app = create_app(cfg, connect)
    transport = httpx2.ASGITransport(app=app)
    async with httpx2.AsyncClient(transport=transport, base_url="http://127.0.0.1") as http:
        r = await http.post(
            "/api/sessions/a/focus",
            json={},
            headers={"origin": f"http://127.0.0.1:{cfg.port}"},
        )
    assert r.status_code == 503


@pytest.mark.anyio
@pytest.mark.parametrize(
    "headers,body,status",
    [
        ({}, {"json": {}}, 403),
        ({"origin": "https://evil.example"}, {"json": {}}, 403),
        ({"origin": "null"}, {"json": {}}, 403),
        ("own", {"content": b"{}", "headers": {"content-type": "text/plain"}}, 415),
        ("own", {"data": {"x": "1"}}, 415),
    ],
)
async def test_unsafe_requests_are_checked(service, headers, body, status):
    service.fake.add("a")
    hdrs = service.origin if headers == "own" else headers
    extra = body.pop("headers", {})
    async with httpx2.AsyncClient() as http:
        r = await http.post(
            f"{service.url}/api/sessions/a/focus", headers={**hdrs, **extra}, **body
        )
    assert r.status_code == status
    assert service.fake.focused == []


def test_dev_origin_is_allowed(tmp_path):
    cfg = Config(state_dir=tmp_path, dev_origins=["http://localhost:5173"])
    assert "http://localhost:5173" in cfg.origins


@pytest.mark.anyio
async def test_foreign_host_and_preflight_are_refused(service):
    async with httpx2.AsyncClient() as http:
        r = await http.get(f"{service.url}/api/board", headers={"host": "evil.example"})
        assert r.status_code == 400
        r = await http.options(
            f"{service.url}/api/sessions/a/focus",
            headers={
                "origin": "https://evil.example",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        )
        assert "access-control-allow-origin" not in r.headers
        assert r.status_code >= 400


@pytest.mark.anyio
async def test_board_json_is_written(service):
    service.fake.add("a")
    await until(service, lambda b: tile_ids(b) == ["a"])
    data = json.loads(service.cfg.board_path.read_text())
    assert data["tiles"]["a"]["cell"] == 0
