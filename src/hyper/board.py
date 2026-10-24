"""Tiles for sessions: cell assignment, handoff on /clear and /resume, board.json. No network."""

import json
import logging
import os
from collections.abc import Callable, Iterable
from pathlib import Path

from pydantic import ValidationError

from .models import (
    BoardFile,
    Change,
    DaemonSession,
    GridEvent,
    StoredTile,
    Tile,
    TileEvent,
    TileRemovedEvent,
)

log = logging.getLogger(__name__)


class Board:
    """The board's own state over the daemon's sessions.

    A tile exists for every session in `data.tiles`; it is shown once the daemon has listed
    that session. Every mutation returns the changes to push to pages.
    """

    def __init__(self, data: BoardFile, save: Callable[[BoardFile], None] = lambda _: None):
        self.data = data
        self.sessions: dict[str, DaemonSession] = {}
        self._save = save

    def tiles(self) -> list[Tile]:
        return [t for t in (self._tile(sid) for sid in self.data.tiles) if t is not None]

    def _tile(self, session_id: str) -> Tile | None:
        session = self.sessions.get(session_id)
        stored = self.data.tiles.get(session_id)
        if session is None or stored is None:
            return None
        return Tile(
            session_id=session_id,
            cell=stored.cell,
            label=stored.label,
            description=stored.description,
            hidden=stored.hidden,
            acknowledged=stored.acked_state_since == session.state_since,
            session=session,
        )

    def _mutate(self, fn: Callable[[], None]) -> list[Change]:
        before_tiles = {t.session_id: t for t in self.tiles()}
        before_data = self.data.model_dump_json()
        before_grid = self.data.grid.model_copy()
        fn()
        changes: list[Change] = []
        if self.data.grid != before_grid:
            changes.append(GridEvent(grid=self.data.grid.model_copy()))
        after_tiles = {t.session_id: t for t in self.tiles()}
        for sid, tile in after_tiles.items():
            if before_tiles.get(sid) != tile:
                changes.append(TileEvent(tile=tile))
        changes.extend(
            TileRemovedEvent(session_id=sid) for sid in before_tiles.keys() - after_tiles.keys()
        )
        if self.data.model_dump_json() != before_data:
            self._save(self.data)
        return changes

    def update(
        self, sessions: Iterable[DaemonSession], unparsed: Iterable[str] = ()
    ) -> list[Change]:
        """Apply a full daemon listing, ended sessions included.

        `unparsed` names listed sessions whose rows could not be read; their tiles are kept
        (not shown) rather than forgotten.
        """
        listed = {s.session_id: s for s in sessions}
        return self._mutate(lambda: self._update(listed, set(unparsed)))

    def _update(self, listed: dict[str, DaemonSession], unparsed: set[str]) -> None:
        tiles = self.data.tiles
        ordered = sorted(
            listed.values(), key=lambda s: s.started_at.timestamp() if s.started_at else 0.0
        )
        for s in ordered:
            old = s.replaces
            if not old or old == s.session_id or old not in tiles:
                continue
            if s.session_id not in tiles:
                # /clear or /resume on the same process: the new session keeps the tile.
                moved = tiles.pop(old)
                moved.acked_state_since = None
                tiles[s.session_id] = moved
            elif old not in listed or listed[old].state == "ended":
                # Resumed into a session that already has its own tile.
                del tiles[old]
        for s in ordered:
            if s.session_id not in tiles and s.state != "ended":
                tiles[s.session_id] = StoredTile(cell=self._free_cell())
        for sid in [sid for sid in tiles if sid not in listed and sid not in unparsed]:
            del tiles[sid]  # the daemon forgot it
        for sid, t in tiles.items():
            s = listed.get(sid)
            if s is not None and t.acked_state_since not in (None, s.state_since):
                t.acked_state_since = None
        self.sessions = listed

    def _free_cell(self) -> int:
        grid = self.data.grid
        taken = {t.cell for t in self.data.tiles.values() if t.cell is not None}
        for cell in range(grid.columns * grid.rows):
            if cell not in taken:
                return cell
        grid.rows += 1
        return grid.columns * (grid.rows - 1)


class BoardStore:
    """board.json, written atomically."""

    def __init__(self, path: Path):
        self.path = path

    def load(self) -> BoardFile:
        try:
            return BoardFile.model_validate_json(self.path.read_bytes())
        except FileNotFoundError:
            return BoardFile()
        except (ValidationError, json.JSONDecodeError, OSError) as e:
            backup = self.path.with_suffix(".json.bad")
            log.error("unreadable %s (%s); moved to %s, starting empty", self.path, e, backup)
            os.replace(self.path, backup)
            return BoardFile()

    def save(self, data: BoardFile) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(data.model_dump_json(indent=2))
        os.replace(tmp, self.path)
