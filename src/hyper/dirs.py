"""Directory completion for the launch dialog."""

import os

LIMIT = 50


def complete(value: str, limit: int = LIMIT) -> list[str]:
    """Directories that complete the last component of `value`, in the form typed.

    `value` is an absolute or `~` path; each result ends in `/`. Hidden directories are
    offered only once the component typed starts with a dot.
    """
    if value in ("", "~"):
        value = "~/"
    if "/" not in value or not value.startswith(("/", "~")):
        return []
    head, _, partial = value.rpartition("/")
    head += "/"
    try:
        with os.scandir(os.path.expanduser(head)) as entries:
            names = sorted(
                e.name
                for e in entries
                if e.name.startswith(partial)
                and (partial.startswith(".") or not e.name.startswith("."))
                and _is_dir(e)
            )
    except OSError:
        return []
    return [f"{head}{name}/" for name in names[:limit]]


def _is_dir(entry: os.DirEntry[str]) -> bool:
    try:
        return entry.is_dir()  # follows symlinks
    except OSError:
        return False
