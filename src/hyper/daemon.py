"""The board's MCP connection to claude-control: listing, change notifications, focus."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager
from typing import Any

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent
from pydantic import ValidationError

from .models import STATES, DaemonSession, DaemonStatus

log = logging.getLogger(__name__)

SESSIONS_URI = "sessions://"
POLL_S = 2.0
RETRY_S = 3.0
CALL_TIMEOUT_S = 10.0

Connect = Callable[[], AbstractAsyncContextManager[Client]]


class DaemonError(Exception):
    """A tool call failed; the message is the daemon's, fit to show the user."""


class DaemonUnavailable(Exception):
    """No working connection to the daemon."""


def http_connect(url: str, token: Callable[[], str]) -> Connect:
    @contextlib.asynccontextmanager
    async def connect() -> AsyncIterator[Client]:
        headers = {"authorization": f"Bearer {token()}"}
        # No read timeout: the subscription stream is silent while nothing changes. Tool calls
        # carry their own timeout (CALL_TIMEOUT_S).
        timeout = httpx2.Timeout(30.0, read=None)
        async with (
            httpx2.AsyncClient(headers=headers, timeout=timeout) as http,
            Client(streamable_http_client(url, http_client=http)) as client,  # type: ignore[arg-type]
        ):
            yield client

    return connect


def _text(result: CallToolResult) -> str:
    return " ".join(c.text for c in result.content if isinstance(c, TextContent))


def _structured(tool: str, result: CallToolResult) -> Any:
    if result.is_error:
        message = _text(result).removeprefix(f"Error executing tool {tool}: ")
        raise DaemonError(message or "tool call failed")
    data = result.structured_content
    return data["result"] if isinstance(data, dict) and set(data) == {"result"} else data


def parse_sessions(rows: list[dict[str, Any]]) -> tuple[list[DaemonSession], list[str]]:
    """The rows that parse, and the ids of those that do not."""
    sessions, unparsed = [], []
    for row in rows:
        try:
            sessions.append(DaemonSession.model_validate(row))
        except ValidationError as e:
            log.warning("skipping session %s: %s", row.get("session_id"), e)
            if isinstance(row.get("session_id"), str):
                unparsed.append(row["session_id"])
    return sessions, unparsed


class DaemonLink:
    """Keeps a connection to the daemon and reports every listing and connection change.

    A listing is fetched on each `sessions://` notification and every `poll_s`, because tool
    activity and the last event change without a notification.
    """

    def __init__(
        self,
        connect: Connect,
        on_sessions: Callable[[list[DaemonSession], list[str]], None],
        on_status: Callable[[DaemonStatus], None],
        poll_s: float = POLL_S,
        retry_s: float = RETRY_S,
    ):
        self.connect = connect
        self.on_sessions = on_sessions
        self.on_status = on_status
        self.poll_s = poll_s
        self.retry_s = retry_s
        self.client: Client | None = None
        self.status = DaemonStatus(connected=False, error="connecting")
        self._wake = asyncio.Event()

    def wake(self) -> None:
        """Fetch a listing now rather than at the next poll."""
        self._wake.set()

    def _set_status(self, status: DaemonStatus) -> None:
        if status != self.status:
            self.status = status
            self.on_status(status)

    async def run(self) -> None:
        while True:
            try:
                async with (
                    self.connect() as client,
                    client.listen(resource_subscriptions=[SESSIONS_URI]) as sub,
                ):
                    self.client = client
                    await self._serve(client, sub)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - any failure means reconnect
                log.info("daemon connection failed: %r", e)
                self.client = None
                self._set_status(DaemonStatus(connected=False, error=f"{type(e).__name__}: {e}"))
                await asyncio.sleep(self.retry_s)

    async def _serve(self, client: Client, sub: Any) -> None:
        wake = self._wake

        async def forward() -> None:
            async for _ in sub:
                wake.set()

        listener = asyncio.create_task(forward())
        try:
            while True:
                self.on_sessions(*await self.list_sessions(client))
                self._set_status(DaemonStatus(connected=True))
                woken = asyncio.create_task(wake.wait())
                done, _ = await asyncio.wait(
                    {woken, listener}, timeout=self.poll_s, return_when=asyncio.FIRST_COMPLETED
                )
                woken.cancel()
                wake.clear()
                if listener in done:
                    listener.result()  # raises SubscriptionLost after an abrupt drop
                    raise ConnectionError("subscription stream closed")
        finally:
            listener.cancel()

    async def list_sessions(self, client: Client) -> tuple[list[DaemonSession], list[str]]:
        async with asyncio.timeout(CALL_TIMEOUT_S):
            result = await client.call_tool("list_sessions", {"states": list(STATES)})
        return parse_sessions(_structured("list_sessions", result))

    async def call(self, tool: str, **args: Any) -> Any:
        client = self.client
        if client is None:
            raise DaemonUnavailable("not connected to claude-control")
        try:
            async with asyncio.timeout(CALL_TIMEOUT_S):
                result = await client.call_tool(tool, args)
        except Exception as e:  # the connection failed mid-call
            raise DaemonUnavailable(f"{type(e).__name__}: {e}") from e
        return _structured(tool, result)
