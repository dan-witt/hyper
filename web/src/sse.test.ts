import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardEvent } from './api/types'
import { followEvents } from './sse'
import type { Connection } from './store'

class FakeSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances: FakeSource[] = []
  readyState = FakeSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((m: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string
  constructor(url: string) {
    this.url = url
    FakeSource.instances.push(this)
  }
  close() {
    this.closed = true
    this.readyState = FakeSource.CLOSED
  }
  open() {
    this.readyState = FakeSource.OPEN
    this.onopen?.()
  }
  send(event: BoardEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>)
  }
}

describe('followEvents', () => {
  let events: BoardEvent[]
  let connections: Connection[]
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    FakeSource.instances = []
    events = []
    connections = []
    stop = followEvents({
      onEvent: (e) => events.push(e),
      onConnection: (c) => connections.push(c),
      staleMs: 1_000,
      retryMs: 100,
      EventSourceImpl: FakeSource as unknown as typeof EventSource,
    })
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('passes events on and reports the connection', () => {
    const [source] = FakeSource.instances
    expect(source.url).toBe('/api/events')
    source.open()
    source.send({ type: 'heartbeat' })
    expect(events).toEqual([{ type: 'heartbeat' }])
    expect(connections).toEqual(['open'])
  })

  it('reconnects when the stream goes quiet', () => {
    const [first] = FakeSource.instances
    first.open()
    vi.advanceTimersByTime(900)
    first.send({ type: 'heartbeat' })
    vi.advanceTimersByTime(900)
    expect(first.closed).toBe(false)
    vi.advanceTimersByTime(200)
    expect(first.closed).toBe(true)
    expect(connections.at(-1)).toBe('lost')
    vi.advanceTimersByTime(100)
    expect(FakeSource.instances).toHaveLength(2)
  })

  it('leaves retrying to EventSource while it is connecting, and takes over once closed', () => {
    const [first] = FakeSource.instances
    first.open()
    first.readyState = FakeSource.CONNECTING
    first.onerror?.()
    expect(connections.at(-1)).toBe('lost')
    vi.advanceTimersByTime(150)
    expect(FakeSource.instances).toHaveLength(1)
    first.readyState = FakeSource.CLOSED
    first.onerror?.()
    vi.advanceTimersByTime(150)
    expect(FakeSource.instances).toHaveLength(2)
  })

  it('stops', () => {
    stop()
    expect(FakeSource.instances[0].closed).toBe(true)
    vi.advanceTimersByTime(5_000)
    expect(FakeSource.instances).toHaveLength(1)
  })
})
