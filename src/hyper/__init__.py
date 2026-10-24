"""hyper: status board for claude-control sessions."""

import argparse
import json
import logging
from pathlib import Path

VITE_ORIGIN = "http://localhost:5173"


def main() -> None:
    parser = argparse.ArgumentParser(prog="hyper")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="run the board service")
    serve.add_argument("--config", type=Path, help="config file (default: XDG config)")
    serve.add_argument("--port", type=int, help="override the configured port")
    serve.add_argument("--state-dir", type=Path, help="override where board.json is kept")
    serve.add_argument(
        "--dev-origin",
        action="append",
        default=[],
        help="another origin allowed to POST, such as the Vite dev server (repeatable)",
    )
    serve.add_argument(
        "--dev",
        action="store_true",
        help=f"page development: allow the Vite dev server ({VITE_ORIGIN}) and answer launch "
        "requests without starting a session (see --live-launch)",
    )
    serve.add_argument(
        "--live-launch",
        action="store_true",
        help="with --dev, send launch requests to claude-control",
    )
    serve.add_argument(
        "--fake",
        action="store_true",
        help="use an in-process fake daemon with demo sessions instead of claude-control",
    )
    window = sub.add_parser("window", help="show the board as a full-screen app window")
    window.add_argument("--config", type=Path, help="config file (default: XDG config)")
    window.add_argument("--monitor", help="RandR monitor name (default: window_monitor, DP-2)")
    window.add_argument(
        "--layout",
        choices=["full", "left", "right"],
        help="the whole monitor or one half (default: window_layout, full)",
    )
    service = sub.add_parser(
        "install-service", help="install, enable and (re)start the systemd user unit"
    )
    service.add_argument("--no-start", action="store_true", help="write the unit only")
    win_entry = sub.add_parser(
        "install-window",
        help="add `hyper window` to the application launcher and to login autostart",
    )
    win_entry.add_argument("--no-autostart", action="store_true", help="launcher entry only")
    sub.add_parser("openapi", help="print the API's OpenAPI schema")
    args = parser.parse_args()

    from . import config
    from .app import create_app
    from .daemon import http_connect

    if args.command == "openapi":
        app = create_app(config.Config(), http_connect("", lambda: ""), web_dist=None)
        print(json.dumps(app.openapi(), indent=2))
        return
    if args.command == "install-service":
        from . import install
        from .app import WEB_DIST

        if not (WEB_DIST / "index.html").exists():
            raise SystemExit(f"no built page at {WEB_DIST}; run `pnpm build` in web/ first")
        exe = install.executable()
        path = install.install_service(exe, start=not args.no_start)
        print(f"wrote {path} (ExecStart={exe} serve)")
        return
    if args.command == "install-window":
        from . import install

        exe = install.executable()
        for path in install.install_window(exe, autostart=not args.no_autostart):
            print(f"wrote {path} (Exec={exe} window)")
        return
    if args.command == "window":
        from . import window as win

        cfg = config.load(args.config)
        layout = args.layout or cfg.window_layout
        if layout not in win.LAYOUTS:
            raise SystemExit(f"window_layout must be one of {', '.join(win.LAYOUTS)}")
        try:
            print(win.open_window(cfg, args.monitor or cfg.window_monitor, layout))
        except win.WindowError as e:
            raise SystemExit(str(e)) from e
        return

    cfg = config.load(args.config)
    if args.port:
        cfg.port = args.port
    if args.state_dir:
        cfg.state_dir = args.state_dir
    cfg.dev_origins += args.dev_origin
    if args.dev:
        cfg.dev_origins.append(VITE_ORIGIN)
    if args.fake:
        from . import dev

        fake = dev.seeded_fake()
        app = create_app(cfg, dev.connect(fake), extra_routes=dev.fake_routes(fake))
    else:
        dry_run = args.dev and not args.live_launch
        app = create_app(cfg, http_connect(cfg.daemon_url, cfg.token), dry_run_launch=dry_run)

    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)  # logs every poll at INFO
    uvicorn.run(app, host=cfg.host, port=cfg.port)
