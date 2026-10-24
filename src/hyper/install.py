"""Install the board service as a systemd user unit and the window as a desktop entry."""

import subprocess
import sys
from pathlib import Path

UNIT_NAME = "hyper.service"
DESKTOP_NAME = "hyper.desktop"


def executable() -> str:
    # Not resolved: ~/.local/bin/hyper is a symlink that survives `uv tool install` upgrades.
    return str(Path(sys.argv[0]).absolute())


def unit_path() -> Path:
    return Path.home() / ".config" / "systemd" / "user" / UNIT_NAME


def unit_text(exe: str) -> str:
    return f"""[Unit]
Description=hyper: status board for claude-control sessions
Wants=claude-control.service
After=claude-control.service

[Service]
ExecStart={exe} serve
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
"""


def install_service(exe: str, start: bool = True) -> Path:
    path = unit_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(unit_text(exe))
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    if start:
        subprocess.run(["systemctl", "--user", "enable", "--now", UNIT_NAME], check=True)
        subprocess.run(["systemctl", "--user", "restart", UNIT_NAME], check=True)
    return path


def desktop_text(exe: str) -> str:
    return f"""[Desktop Entry]
Type=Application
Name=hyper
Comment=Status board for Claude Code sessions
Exec={exe} window
Icon=utilities-system-monitor
Terminal=false
Categories=Utility;
"""


def desktop_paths() -> tuple[Path, Path]:
    """The application launcher entry and the login autostart entry."""
    return (
        Path.home() / ".local" / "share" / "applications" / DESKTOP_NAME,
        Path.home() / ".config" / "autostart" / DESKTOP_NAME,
    )


def install_window(exe: str, autostart: bool = True) -> list[Path]:
    paths = desktop_paths()[: 2 if autostart else 1]
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(desktop_text(exe))
    return list(paths)
