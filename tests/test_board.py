from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from hyper.board import Board, BoardError, BoardStore, NoSuchTile
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


def test_move_to_an_empty_cell_and_swap():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    changes = board.move("a", 4)
    assert cells(board) == {"a": 4, "b": 1}
    assert [c.tile.session_id for c in changes if isinstance(c, TileEvent)] == ["a"]
    changes = board.move("b", 4)
    assert cells(board) == {"a": 1, "b": 4}
    assert {c.tile.session_id for c in changes if isinstance(c, TileEvent)} == {"a", "b"}
    assert board.move("b", 4) == []


def test_move_refuses_unknown_hidden_and_out_of_range():
    board = Board(BoardFile(tiles={"gone": StoredTile(cell=3)}))
    board.update([session("a", 1), session("h", 2), session("gone", 3)])
    board.data.tiles["h"].hidden, board.data.tiles["h"].cell = True, None
    with pytest.raises(NoSuchTile):
        board.move("nobody", 0)
    with pytest.raises(BoardError, match="hidden"):
        board.move("h", 0)
    with pytest.raises(BoardError, match="outside the 3x2 grid"):
        board.move("a", 6)


def test_set_grid_reflows_and_keeps_occupied_rows():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2), session("c", 3)])
    board.move("c", 5)
    changes = board.set_grid(2, 2)
    assert board.data.grid == Grid(columns=2, rows=3)  # cell 5 needs a third row
    assert changes == [GridEvent(grid=Grid(columns=2, rows=3))]
    board.move("c", 2)
    board.set_grid(2, 2)
    assert board.data.grid == Grid(columns=2, rows=2)
    board.set_grid(4, 1)
    assert board.data.grid == Grid(columns=4, rows=1)


def test_moves_are_saved():
    saved: list[BoardFile] = []
    board = Board(BoardFile(), lambda d: saved.append(d.model_copy(deep=True)))
    board.update([session("a", 1)])
    board.move("a", 2)
    assert saved[-1].tiles["a"].cell == 2


def test_edit_sets_and_clears_label_and_description():
    board = Board(BoardFile())
    board.update([session("a", 1)])
    [change] = board.edit("a", {"label": "billing", "description": "invoice export"})
    assert isinstance(change, TileEvent)
    assert (change.tile.label, change.tile.description) == ("billing", "invoice export")
    board.edit("a", {"label": None})
    assert (board.data.tiles["a"].label, board.data.tiles["a"].description) == (
        None,
        "invoice export",
    )
    with pytest.raises(NoSuchTile):
        board.edit("nobody", {"label": "x"})


@pytest.mark.parametrize("state", ["waiting", "error"])
def test_acknowledge_mutes_until_the_state_changes(state):
    board = Board(BoardFile())
    board.update([session("a", 1, state=state, reason="done")])
    [change] = board.acknowledge("a")
    assert isinstance(change, TileEvent) and change.tile.acknowledged
    board.update([session("a", 1, state="running", state_since=T0 + timedelta(minutes=2))])
    assert not board.tiles()[0].acknowledged


def test_acknowledge_refuses_a_session_that_needs_nothing():
    board = Board(BoardFile())
    board.update([session("a", 1, state="running")])
    with pytest.raises(BoardError, match="nothing to acknowledge while running"):
        board.acknowledge("a")


def test_hide_frees_the_cell_and_show_puts_the_tile_back():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    board.hide("a")
    assert cells(board) == {"a": None, "b": 1}
    assert board.tiles()[0].hidden
    board.update([session("a", 1), session("b", 2), session("c", 3)])
    assert cells(board)["c"] == 0  # the hidden tile's cell was free
    board.show("a")
    assert cells(board)["a"] == 2
    board.hide("a")
    board.show("a", 5)
    assert cells(board)["a"] == 5
    assert not board.data.tiles["a"].hidden


def test_show_refuses_a_taken_cell_a_cell_outside_and_a_shown_tile():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    board.hide("a")
    with pytest.raises(BoardError, match="cell 1 is taken"):
        board.show("a", 1)
    with pytest.raises(BoardError, match="outside"):
        board.show("a", 6)
    with pytest.raises(BoardError, match="not hidden"):
        board.show("b")


def test_show_with_a_full_grid_adds_a_row():
    board = Board(BoardFile(grid=Grid(columns=1, rows=1)))
    board.update([session("a", 1)])
    board.hide("a")
    board.update([session("a", 1), session("b", 2)])
    board.show("a")
    assert (board.data.grid, cells(board)) == (Grid(columns=1, rows=2), {"a": 1, "b": 0})


def test_remove_only_drops_ended_tiles_and_they_stay_gone():
    board = Board(BoardFile())
    board.update([session("a", 1), session("b", 2)])
    with pytest.raises(BoardError, match="only an offline tile"):
        board.remove("a")
    board.update([session("a", 1, state="ended"), session("b", 2)])
    assert board.remove("a") == [TileRemovedEvent(session_id="a")]
    board.update([session("a", 1, state="ended"), session("b", 2)])
    assert list(board.data.tiles) == ["b"]


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_launched_session_takes_the_reserved_cell_and_others_skip_it():
    clock = Clock()
    board = Board(BoardFile(), clock=clock)
    board.update([session("a", 1)])
    board.launched("new", 4, "~/work")
    assert board.data.last_launch_dir == "~/work"
    board.update([session("a", 1), session("other", 2)])
    assert cells(board)["other"] == 1
    board.update([session("a", 1), session("other", 2), session("new", 3)])
    assert cells(board)["new"] == 4
    with pytest.raises(BoardError, match="cell 4 is taken"):
        board.check_free(4)


def test_reservation_expires_and_yields_to_a_taken_cell():
    clock = Clock()
    board = Board(BoardFile(), clock=clock)
    board.launched("late", 3, "/w")
    clock.now = 61
    board.update([session("x", 1), session("late", 2)])
    assert cells(board) == {"x": 0, "late": 1}

    board.launched("blocked", 2, "/w")
    board.update([session("x", 1), session("late", 2)])
    board.move("x", 2)  # the user drags a tile into the held cell
    board.update([session("x", 1), session("late", 2), session("blocked", 3)])
    assert cells(board)["blocked"] == 0


def test_launched_after_the_session_was_listed_moves_its_tile():
    board = Board(BoardFile())
    board.update([session("new", 1)])
    assert cells(board) == {"new": 0}
    [change] = board.launched("new", 5, "/w")
    assert isinstance(change, TileEvent) and change.tile.cell == 5


def test_check_free_rejects_cells_outside_the_grid():
    board = Board(BoardFile())
    with pytest.raises(BoardError, match="outside the 3x2 grid"):
        board.check_free(6)
