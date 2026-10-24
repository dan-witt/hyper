"""`hyper serve --fake`: the board over an in-process fake daemon, for page work and e2e tests.

The /api/fake routes let a test change sessions; they exist only in this mode.
"""

import contextlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from mcp import Client
from pydantic import BaseModel

from .daemon import Connect
from .fake_daemon import FakeDaemon


def seeded_fake() -> FakeDaemon:
    fake = FakeDaemon()
    t0 = datetime.now(UTC) - timedelta(hours=1)

    def at(minutes: int) -> str:
        return (t0 + timedelta(minutes=minutes)).isoformat(timespec="milliseconds")

    fake.add(
        "billing", cwd="/work/billing", state="running", state_since=at(50),
        last_event="PreToolUse Bash", last_event_text="running Bash", last_event_at=at(59),
        current_tool="Bash", started_at=at(0),
    )  # fmt: skip
    fake.add(
        "auth", cwd="/work/auth", state="waiting", reason="permission", state_since=at(55),
        last_event="PermissionRequest Edit", last_event_text="asking to use Edit",
        last_event_at=at(55), started_at=at(1),
    )  # fmt: skip
    fake.add(
        "docs", cwd="/work/docs", state="waiting", reason="done", state_since=at(40),
        last_event="Stop", last_event_text="finished its turn", last_event_at=at(40),
        started_at=at(2),
    )  # fmt: skip
    fake.add(
        "infra", cwd="/work/infra", state="idle", state_since=at(20),
        last_event="Stop", last_event_text="finished its turn", last_event_at=at(10),
        started_at=at(3),
    )  # fmt: skip
    return fake


def connect(fake: FakeDaemon) -> Connect:
    @contextlib.asynccontextmanager
    async def _connect() -> AsyncIterator[Client]:
        async with Client(fake.server) as client:
            yield client

    return _connect


class FakeSession(BaseModel):
    fields: dict[str, Any] = {}


class FocusError(BaseModel):
    message: str | None


def fake_routes(fake: FakeDaemon) -> APIRouter:
    router = APIRouter(prefix="/api/fake", include_in_schema=False)

    @router.post("/sessions/{session_id}")
    async def upsert(session_id: str, body: FakeSession) -> dict[str, Any]:
        if session_id in fake.sessions:
            fake.update(session_id, **body.fields)
        else:
            fake.add(session_id, **body.fields)
        await fake.notify()
        return fake.sessions[session_id]

    @router.post("/sessions/{session_id}/remove")
    async def remove(session_id: str) -> None:
        if fake.sessions.pop(session_id, None) is None:
            raise HTTPException(404)
        await fake.notify()

    @router.post("/focus-error")
    def focus_error(body: FocusError) -> None:
        fake.focus_error = body.message

    @router.get("/focused")
    def focused() -> list[str]:
        return fake.focused

    return router
