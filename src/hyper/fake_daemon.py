"""A stand-in for claude-control's MCP server, for tests and development.

It serves the same tools and `sessions://` resource over sessions held in a dict.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.subscriptions import InMemorySubscriptionBus, ResourceUpdated

from .daemon import SESSIONS_URI
from .models import STATES


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


class FakeDaemon:
    def __init__(self) -> None:
        self.sessions: dict[str, dict[str, Any]] = {}
        self.focused: list[str] = []
        self.focus_error: str | None = None
        self.bus = InMemorySubscriptionBus()
        self.server = self._build()

    def add(self, session_id: str, **fields: Any) -> dict[str, Any]:
        now = _now()
        row: dict[str, Any] = {
            "session_id": session_id,
            "name": session_id,
            "state": "idle",
            "reason": None,
            "state_since": now,
            "cwd": f"/work/{session_id}",
            "last_event": "SessionStart startup",
            "last_event_text": "started",
            "last_event_at": now,
            "last_event_age_s": 0,
            "started_at": now,
            "pane": f"%{len(self.sessions)}",
            "current_tool": None,
            "tool_count": 0,
            "background_tasks": 0,
            "replaces": None,
        }
        row.update(fields)
        self.sessions[session_id] = row
        return row

    def update(self, session_id: str, **fields: Any) -> None:
        row = self.sessions[session_id]
        if ("state" in fields or "reason" in fields) and "state_since" not in fields:
            fields["state_since"] = _now()
        row.update(fields)

    async def notify(self) -> None:
        await self.bus.publish(ResourceUpdated(uri=SESSIONS_URI))

    def _build(self) -> MCPServer:
        mcp = MCPServer(name="fake-claude-control", subscriptions=self.bus)

        def find(session_id: str) -> dict[str, Any]:
            row = self.sessions.get(session_id)
            if row is None:
                raise ToolError(f"no session {session_id!r}")
            return row

        @mcp.tool()
        def list_sessions(states: list[str] | None = None) -> list[dict[str, Any]]:
            unknown = set(states or ()) - set(STATES)
            if unknown:
                raise ToolError(f"unknown state(s) {sorted(unknown)}")
            rows = self.sessions.values()
            if states:
                return [r for r in rows if r["state"] in states]
            return [r for r in rows if r["state"] != "ended"]

        @mcp.tool()
        def get_session(session_id: str) -> dict[str, Any]:
            return {**find(session_id), "message": None, "processes": [], "tasks": []}

        @mcp.tool()
        def focus_session(session_id: str) -> dict[str, Any]:
            row = find(session_id)
            if row["state"] == "ended":
                raise ToolError(f"session {session_id} has ended")
            if self.focus_error:
                raise ToolError(self.focus_error)
            self.focused.append(session_id)
            return {"session_id": session_id, "pane": row["pane"], "client": "/dev/pts/0"}

        @mcp.tool()
        def launch_session(
            cwd: str, prompt: str | None = None, name: str | None = None
        ) -> dict[str, Any]:
            session_id = str(uuid.uuid4())
            row = self.add(
                session_id,
                name=name or session_id[:8],
                cwd=cwd,
                state="starting",
                last_event="launched",
                last_event_text="launching",
            )
            return {
                "session_id": session_id,
                "name": row["name"],
                "pane": row["pane"],
                "state": "starting",
            }

        @mcp.resource(SESSIONS_URI, name="sessions", mime_type="application/json")
        def sessions_resource() -> str:
            return json.dumps(list_sessions())

        return mcp
