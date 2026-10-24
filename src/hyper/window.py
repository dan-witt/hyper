"""`hyper window`: the board as a Chrome app window on a named monitor (X11).

Chrome ignores `--start-fullscreen` and `--kiosk` for an `--app` window, so the window is
made full screen by asking the window manager (`_NET_WM_STATE_FULLSCREEN`) once it maps.
The window has its own Chrome profile, which is also how an open one is found again.
"""

import os
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from Xlib import X, display
from Xlib.ext import randr
from Xlib.protocol import event

from .config import Config

Layout = Literal["full", "left", "right"]
LAYOUTS: tuple[Layout, ...] = ("full", "left", "right")
SERVICE_WAIT_S = 60.0
WINDOW_WAIT_S = 20.0


class WindowError(Exception):
    pass


@dataclass(frozen=True)
class Geometry:
    x: int
    y: int
    width: int
    height: int


def placement(monitor: Geometry, layout: Layout) -> Geometry:
    if layout == "full":
        return monitor
    half = monitor.width // 2
    x = monitor.x if layout == "left" else monitor.x + monitor.width - half
    return Geometry(x, monitor.y, half, monitor.height)


def chrome_args(browser: str, profile: Path, url: str, at: Geometry) -> list[str]:
    return [
        browser,
        f"--user-data-dir={profile}",
        f"--app={url}",
        f"--window-position={at.x},{at.y}",
        f"--window-size={at.width},{at.height}",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",  # a new profile would otherwise ask to unlock the keyring
    ]


def monitors(d: display.Display) -> dict[str, Geometry]:
    reply: Any = randr.get_monitors(d.screen().root)
    return {
        d.get_atom_name(m.name): Geometry(m.x, m.y, m.width_in_pixels, m.height_in_pixels)
        for m in reply.monitors
    }


def browser_pid(profile: Path) -> int | None:
    """The pid of the Chrome running `profile`, from the `<host>-<pid>` target of the
    profile's SingletonLock symlink. (Chrome rewrites its own command line, so /proc
    cmdline cannot be matched argument by argument.)"""
    try:
        target = os.readlink(profile / "SingletonLock")
    except OSError:
        return None
    _, _, pid = target.rpartition("-")
    if not pid.isdigit() or not Path(f"/proc/{pid}").exists():
        return None  # a lock left by a Chrome that is gone
    return int(pid)


def find_window(d: display.Display, profile: Path) -> Any | None:
    """The board's top-level window: owned by the Chrome running `profile`, with a WM_CLASS
    (Chrome's small popup windows have none)."""
    pid = browser_pid(profile)
    if pid is None:
        return None
    root = d.screen().root
    clients = root.get_full_property(d.intern_atom("_NET_CLIENT_LIST"), X.AnyPropertyType)
    pid_atom = d.intern_atom("_NET_WM_PID")
    for wid in clients.value if clients else ():
        win = d.create_resource_object("window", wid)
        owner = win.get_full_property(pid_atom, X.AnyPropertyType)
        if owner and owner.value[0] == pid and win.get_wm_class():
            return win
    return None


def _send(d: display.Display, win: Any, message: str, data: list[int]) -> None:
    ev = event.ClientMessage(
        window=win, client_type=d.intern_atom(message), data=(32, (data + [0] * 5)[:5])
    )
    mask = X.SubstructureRedirectMask | X.SubstructureNotifyMask
    d.screen().root.send_event(ev, event_mask=mask)


def place(d: display.Display, win: Any, at: Geometry, layout: Layout) -> None:
    """Move the window to `at`, then make it full screen there for the full layout."""
    full = d.intern_atom("_NET_WM_STATE_FULLSCREEN")
    _send(d, win, "_NET_WM_STATE", [0, full, 0, 1])  # leave full screen so it can move
    # x, y, width and height given (bits 8-11), from a pager-like source (bits 12-13).
    _send(d, win, "_NET_MOVERESIZE_WINDOW", [0xF00 | 2 << 12, at.x, at.y, at.width, at.height])
    if layout == "full":
        _send(d, win, "_NET_WM_STATE", [1, full, 0, 1])
    _send(d, win, "_NET_ACTIVE_WINDOW", [2, X.CurrentTime, 0])
    d.flush()


def wait_for_service(url: str, timeout: float = SERVICE_WAIT_S) -> None:
    deadline = time.monotonic() + timeout
    while True:
        try:
            with urllib.request.urlopen(f"{url}api/board", timeout=2):
                return
        except OSError as e:
            if time.monotonic() > deadline:
                raise WindowError(f"board service not reachable at {url}: {e}") from e
            time.sleep(0.5)


def open_window(cfg: Config, monitor: str, layout: Layout) -> str:
    """Show the board on `monitor`, reusing its window if it is open. Returns what it did."""
    url = f"http://127.0.0.1:{cfg.port}/"
    profile = cfg.state_dir / "chrome"
    d = display.Display()
    screens = monitors(d)
    if monitor not in screens:
        raise WindowError(f"no monitor {monitor!r}; connected: {', '.join(sorted(screens))}")
    at = placement(screens[monitor], layout)
    win = find_window(d, profile)
    if win is not None:
        place(d, win, at, layout)
        return f"moved the open board window to {monitor} ({layout})"
    wait_for_service(url)
    profile.mkdir(parents=True, exist_ok=True)
    with (cfg.state_dir / "chrome.log").open("ab") as log:
        subprocess.Popen(
            chrome_args(cfg.browser, profile, url, at),
            stdout=log,
            stderr=log,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    deadline = time.monotonic() + WINDOW_WAIT_S
    while (win := find_window(d, profile)) is None:
        if time.monotonic() > deadline:
            raise WindowError(f"no board window after {WINDOW_WAIT_S:.0f}s; see chrome.log")
        time.sleep(0.25)
    time.sleep(0.5)  # Chrome resizes the window itself right after mapping it
    place(d, win, at, layout)
    return f"opened the board on {monitor} ({layout})"
