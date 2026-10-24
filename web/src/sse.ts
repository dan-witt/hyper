import type { BoardEvent } from './api/types'
import type { Connection } from './store'

export interface EventsOptions {
  url?: string
  onEvent: (event: BoardEvent) => void
  onConnection: (connection: Connection) => void
  /** No message (the service sends a heartbeat every 10s) for this long means a dead stream. */
  staleMs?: number
  retryMs?: number
  EventSourceImpl?: typeof EventSource
}

/** Follows the board's event stream, reconnecting as needed. Returns a function that stops it. */
export function followEvents({
  url = '/api/events',
  onEvent,
  onConnection,
  staleMs = 25_000,
  retryMs = 2_000,
  EventSourceImpl = EventSource,
}: EventsOptions): () => void {
  let source: EventSource | null = null
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const reconnectLater = () => {
    source?.close()
    source = null
    onConnection('lost')
    clearTimeout(watchdog)
    clearTimeout(retry)
    if (!stopped) retry = setTimeout(open, retryMs)
  }

  const feedWatchdog = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(reconnectLater, staleMs)
  }

  function open() {
    source = new EventSourceImpl(url)
    feedWatchdog()
    source.onopen = () => onConnection('open')
    source.onmessage = (message: MessageEvent<string>) => {
      feedWatchdog()
      onEvent(JSON.parse(message.data) as BoardEvent)
    }
    source.onerror = () => {
      // EventSource retries by itself while CONNECTING; once CLOSED it gives up.
      if (source?.readyState === EventSourceImpl.CLOSED) reconnectLater()
      else onConnection('lost')
    }
  }

  open()
  return () => {
    stopped = true
    clearTimeout(watchdog)
    clearTimeout(retry)
    source?.close()
  }
}
