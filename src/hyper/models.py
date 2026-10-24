"""API and storage models. The page's TypeScript types are generated from these."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    # Output schemas list defaulted fields as required: the service always sends them.
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


State = Literal["starting", "running", "waiting", "idle", "error", "ended"]
STATES: tuple[State, ...] = ("starting", "running", "waiting", "idle", "error", "ended")


class DaemonSession(Model):
    """One row of claude-control's list_sessions (its DESIGN.md is the contract)."""

    model_config = ConfigDict(extra="ignore", json_schema_serialization_defaults_required=True)

    session_id: str
    name: str | None = None
    state: State
    reason: str | None = None
    state_since: datetime
    cwd: str | None = None
    last_event: str = ""
    last_event_text: str = ""
    last_event_at: datetime
    started_at: datetime | None = None
    pane: str | None = None
    current_tool: str | None = None
    tool_count: int = 0
    background_tasks: int = 0
    replaces: str | None = None


class Grid(Model):
    columns: int = Field(default=3, ge=1)
    rows: int = Field(default=2, ge=1)


# --- board.json


class StoredTile(Model):
    cell: int | None  # reading-order index into the grid; None while hidden
    label: str | None = None
    description: str | None = None
    hidden: bool = False
    acked_state_since: datetime | None = None


class BoardFile(Model):
    version: Literal[1] = 1
    grid: Grid = Field(default_factory=Grid)
    tiles: dict[str, StoredTile] = Field(default_factory=dict)  # by session_id


# --- what the page sees


class Tile(Model):
    session_id: str
    cell: int | None
    label: str | None
    description: str | None
    hidden: bool
    acknowledged: bool
    session: DaemonSession


class DaemonStatus(Model):
    connected: bool
    error: str | None = None


class BoardView(Model):
    grid: Grid
    tiles: list[Tile]
    daemon: DaemonStatus


class SnapshotEvent(Model):
    type: Literal["snapshot"] = "snapshot"
    board: BoardView


class TileEvent(Model):
    type: Literal["tile"] = "tile"
    tile: Tile


class TileRemovedEvent(Model):
    type: Literal["tile_removed"] = "tile_removed"
    session_id: str


class GridEvent(Model):
    type: Literal["grid"] = "grid"
    grid: Grid


class DaemonEvent(Model):
    type: Literal["daemon"] = "daemon"
    daemon: DaemonStatus


class HeartbeatEvent(Model):
    type: Literal["heartbeat"] = "heartbeat"


BoardEvent = Annotated[
    SnapshotEvent | TileEvent | TileRemovedEvent | GridEvent | DaemonEvent | HeartbeatEvent,
    Field(discriminator="type"),
]
Change = TileEvent | TileRemovedEvent | GridEvent


class FocusResult(Model):
    session_id: str
    pane: str
