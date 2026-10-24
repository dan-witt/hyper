"""hyper: status board for claude-control sessions."""

import argparse
import json
import logging


def main() -> None:
    parser = argparse.ArgumentParser(prog="hyper")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve", help="run the board service")
    sub.add_parser("openapi", help="print the API's OpenAPI schema")
    args = parser.parse_args()

    from . import config
    from .app import create_app
    from .daemon import http_connect

    cfg = config.load()
    app = create_app(cfg, http_connect(cfg.daemon_url, cfg.token))
    if args.command == "openapi":
        print(json.dumps(app.openapi(), indent=2))
        return

    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)  # logs every poll at INFO
    uvicorn.run(app, host=cfg.host, port=cfg.port)
