"""Board service configuration: $XDG_CONFIG_HOME/hyper/config.toml."""

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


def _xdg(var: str, default: str) -> Path:
    return Path(os.environ.get(var) or Path.home() / default)


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 7780
    daemon_url: str = "http://127.0.0.1:7777/mcp"
    token_path: Path = field(
        default_factory=lambda: _xdg("XDG_CONFIG_HOME", ".config") / "claude-control" / "token"
    )
    state_dir: Path = field(
        default_factory=lambda: _xdg("XDG_STATE_HOME", ".local/state") / "hyper"
    )
    # Extra origins allowed to POST, such as the Vite dev server.
    dev_origins: list[str] = field(default_factory=list)

    @property
    def board_path(self) -> Path:
        return self.state_dir / "board.json"

    @property
    def origins(self) -> set[str]:
        own = {f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}"}
        return own | set(self.dev_origins)

    def token(self) -> str:
        return self.token_path.read_text().strip()


def config_path() -> Path:
    return _xdg("XDG_CONFIG_HOME", ".config") / "hyper" / "config.toml"


def load(path: Path | None = None) -> Config:
    path = path or config_path()
    if not path.exists():
        return Config()
    raw = tomllib.loads(path.read_text())
    cfg = Config()
    for key in ("host", "port", "daemon_url", "dev_origins"):
        if key in raw:
            setattr(cfg, key, raw[key])
    for key in ("token_path", "state_dir"):
        if key in raw:
            setattr(cfg, key, Path(raw[key]).expanduser())
    return cfg
