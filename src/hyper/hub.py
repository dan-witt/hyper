"""Fan-out of board events to connected pages."""

import asyncio
import contextlib
from collections.abc import Iterator

from pydantic import BaseModel

# A page this far behind is cut off; EventSource reconnects and gets a fresh snapshot.
QUEUE_LIMIT = 1000

Queue = asyncio.Queue[BaseModel | None]  # None ends the stream


class Hub:
    def __init__(self) -> None:
        self._queues: set[Queue] = set()

    def publish(self, *events: BaseModel) -> None:
        for q in list(self._queues):
            for e in events:
                try:
                    q.put_nowait(e)
                except asyncio.QueueFull:
                    self._queues.discard(q)
                    while not q.empty():
                        q.get_nowait()
                    q.put_nowait(None)
                    break

    @contextlib.contextmanager
    def subscribe(self) -> Iterator[Queue]:
        q: Queue = asyncio.Queue(QUEUE_LIMIT)
        self._queues.add(q)
        try:
            yield q
        finally:
            self._queues.discard(q)
