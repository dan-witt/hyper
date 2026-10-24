from pathlib import Path

from hyper.dirs import complete


def make(root: Path, *names: str) -> None:
    for name in names:
        (root / name).mkdir(parents=True)


def test_completes_the_last_component(tmp_path):
    make(tmp_path, "hyper", "HyperPyper", "hypothesis", ".hidden", "other")
    (tmp_path / "hyper-notes.txt").write_text("")
    assert complete(f"{tmp_path}/hyp") == [f"{tmp_path}/hyper/", f"{tmp_path}/hypothesis/"]
    assert complete(f"{tmp_path}/") == [
        f"{tmp_path}/HyperPyper/",
        f"{tmp_path}/hyper/",
        f"{tmp_path}/hypothesis/",
        f"{tmp_path}/other/",
    ]


def test_hidden_directories_once_a_dot_is_typed(tmp_path):
    make(tmp_path, ".hidden", "shown")
    assert complete(f"{tmp_path}/.") == [f"{tmp_path}/.hidden/"]


def test_follows_symlinks_to_directories(tmp_path):
    make(tmp_path, "real")
    (tmp_path / "link").symlink_to(tmp_path / "real")
    (tmp_path / "dangling").symlink_to(tmp_path / "missing")
    assert complete(f"{tmp_path}/") == [f"{tmp_path}/link/", f"{tmp_path}/real/"]


def test_keeps_the_tilde_form(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    make(tmp_path, "media")
    assert complete("~/me") == ["~/media/"]
    assert complete("") == complete("~") == complete("~/") == ["~/media/"]


def test_relative_missing_and_limited(tmp_path):
    make(tmp_path, *(f"d{i:02}" for i in range(60)))
    assert complete("relative/path") == []
    assert complete(f"{tmp_path}/missing/") == []
    assert len(complete(f"{tmp_path}/")) == 50
