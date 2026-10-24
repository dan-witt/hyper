from datetime import UTC, datetime, timedelta
from typing import Any

from hyper.board import Board, BoardStore
from hyper.models import (
    BoardFile,
    DaemonSession,
    Grid,
    GridEvent,
    StoredTile,
    TileEvent,
    TileRemovedEvent,
)

T0 = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)


def session(sid: str, minute: int = 0, **fields: Any) -> DaemonSession:
    at = T0 + timedelta(minutes=minute)
    return DaemonSession.model_validate(
        {
            "session_id": sid,
            "name": sid,
            "state": "idle",
            "state_since": at,
            "last_event_at": at,
            "started_at": at,
            **fields,
        }
    )


def cells(board: Board) -> dict[str, int | None]:
    return {sid: t.cell for sid, t in board.data.tiles.items()}


def test_new_sessions_take_free_cells_in_start_order():
    board = Board(BoardFile())
    board.update([session("b", 2), session("a", 1), session("c", 3)])
    assert cells(board) == {"a": 0, "b": 1, "c": 2}


def test_grid_grows_a_row_when_full():
    board = Board(BoardFile(grid=Grid(columns=2, rows=1)))
    changes = board.update([session("a", 1), session("b", 2), session("c", 3)])
    assert cells(board)["c"] == 2
    assert board.data.grid == Grid(columns=2, rows=2)
    assert GridEvent(grid=Grid(columns=2, rows=2)) in changes


def test_ended_session_keeps_its_tile_but_no_tile_is_made_for_one():
    board = Board(BoardFile())
    board.update([session("a", 1)])
    board.update([session("a", 1, state="ended", reason="other"), session("old", 0, state="ended")])
    assert set(board.data.tiles) == {"a"}
    [tile] = board.tiles()
    assert tile.session.state == "ended"


def test_tile_is_dropped_when_the_daemon_forgets_the_session():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    changes = board.update([session("b", 2)])
    assert set(board.data.tiles) == {"b"}
    assert TileRemovedEvent(session_id="a") in changes
    board.update([session("c", 3)])
    assert cells(board) == {"c": 0}  # a's cell was freed


def test_unparsed_session_keeps_its_tile():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    board.data.tiles["a"].label = "billing"
    board.update([session("b", 2)], unparsed=["a"])
    assert board.data.tiles["a"].label == "billing"
    assert [t.session_id for t in board.tiles()] == ["b"]
    board.update([session("a", 1), session("b", 2)])
    assert [t.session_id for t in board.tiles()] == ["a", "b"]


def test_clear_hands_the_tile_to_the_new_session():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    board.data.tiles["a"].label = "billing"
    board.update(
        [
            session("a", 1, state="ended", reason="clear"),
            session("b", 2),
            session("a2", 5, replaces="a"),
        ]
    )
    assert cells(board) == {"b": 1, "a2": 0}
    assert board.data.tiles["a2"].label == "billing"


def test_handoff_waits_for_the_new_session_and_then_takes_the_old_cell():
    board = Board(BoardFile())
    board.update([session("a", 1)])
    board.update([session("a", 1, state="ended", reason="clear")])
    board.update([session("a", 1, state="ended", reason="clear"), session("a2", 5, replaces="a")])
    assert cells(board) == {"a2": 0}


def test_resume_into_a_session_with_its_own_tile_drops_the_old_tile():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    board.update([session("a", 1, state="ended", reason="resume"), session("b", 2, replaces="a")])
    assert cells(board) == {"b": 1}


def test_replaced_session_still_live_keeps_its_tile():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2, replaces="a")])
    assert set(board.data.tiles) == {"a", "b"}


def test_acknowledgement_lasts_until_state_since_changes():
    board = Board(BoardFile())
    waiting = session("a", 1, state="waiting", reason="done")
    board.update([waiting])
    board.data.tiles["a"].acked_state_since = waiting.state_since
    [tile] = board.tiles()
    assert tile.acknowledged
    assert board.update([waiting]) == []
    changes = board.update([session("a", 1, state="waiting", reason="permission", state_since=T0)])
    [tile] = board.tiles()
    assert not tile.acknowledged
    assert board.data.tiles["a"].acked_state_since is None
    assert [type(c) for c in changes] == [TileEvent]


def test_only_changed_tiles_are_reported():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    changes = board.update([session("a", 1), session("b", 2, last_event_text="running Bash")])
    assert [c.tile.session_id for c in changes if isinstance(c, TileEvent)] == ["b"]


def test_tiles_from_board_json_show_once_listed():
    data = BoardFile(tiles={"a": StoredTile(cell=4, description="billing")})
    board = Board(data)
    assert board.tiles() == []
    board.update([session("a", 1)])
    [tile] = board.tiles()
    assert (tile.cell, tile.description) == (4, "billing")


def test_saves_only_when_stored_state_changes(tmp_path):
    saved: list[BoardFile] = []
    board = Board(BoardFile(), lambda d: saved.append(d.model_copy(deep=True)))
    board.update([session("a", 1)])
    board.update([session("a", 1, last_event_text="running Bash")])
    assert len(saved) == 1


def test_store_round_trip_and_bad_file(tmp_path):
    store = BoardStore(tmp_path / "hyper" / "board.json")
    assert store.load() == BoardFile()
    data = BoardFile(tiles={"a": StoredTile(cell=1, label="x")})
    store.save(data)
    assert store.load() == data
    store.path.write_text("{not json")
    assert store.load() == BoardFile()
    assert (tmp_path / "hyper" / "board.json.bad").exists()
