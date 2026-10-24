from pathlib import Path

from hyper import install
from hyper.config import load
from hyper.window import Geometry, chrome_args, placement

DP2 = Geometry(3840, 0, 3840, 2160)


def test_placement_full_and_halves():
    assert placement(DP2, "full") == DP2
    assert placement(DP2, "left") == Geometry(3840, 0, 1920, 2160)
    assert placement(DP2, "right") == Geometry(5760, 0, 1920, 2160)
    assert placement(Geometry(0, 0, 1921, 1080), "right") == Geometry(961, 0, 960, 1080)


def test_chrome_args_use_their_own_profile_and_position():
    args = chrome_args("google-chrome", Path("/s/chrome"), "http://127.0.0.1:7780/", DP2)
    assert args[:5] == [
        "google-chrome",
        "--user-data-dir=/s/chrome",
        "--app=http://127.0.0.1:7780/",
        "--window-position=3840,0",
        "--window-size=3840,2160",
    ]


def test_window_settings_from_config(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('window_monitor = "DP-4"\nwindow_layout = "left"\nbrowser = "chromium"\n')
    cfg = load(path)
    assert (cfg.window_monitor, cfg.window_layout, cfg.browser) == ("DP-4", "left", "chromium")
    assert (load(tmp_path / "missing.toml").window_monitor) == "DP-2"


def test_unit_runs_after_the_daemon():
    text = install.unit_text("/home/u/.local/bin/hyper")
    assert "ExecStart=/home/u/.local/bin/hyper serve" in text
    assert "After=claude-control.service" in text
    assert "WantedBy=default.target" in text


def test_install_window_writes_launcher_and_autostart(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    paths = install.install_window("/x/hyper")
    assert paths == [
        tmp_path / ".local/share/applications/hyper.desktop",
        tmp_path / ".config/autostart/hyper.desktop",
    ]
    assert "Exec=/x/hyper window" in paths[1].read_text()
    assert install.install_window("/x/hyper", autostart=False) == paths[:1]


def test_browser_pid_from_the_profile_lock(tmp_path):
    import os

    from hyper.window import browser_pid

    assert browser_pid(tmp_path) is None
    (tmp_path / "SingletonLock").symlink_to(f"my-host-{os.getpid()}")
    assert browser_pid(tmp_path) == os.getpid()
    (tmp_path / "SingletonLock").unlink()
    (tmp_path / "SingletonLock").symlink_to("my-host-999999999")
    assert browser_pid(tmp_path) is None
