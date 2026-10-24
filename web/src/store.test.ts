import { describe, expect, it } from 'vitest'
import { applyEvent, initialBoard } from './store'
import { makeTile } from './test/fixtures'

describe('applyEvent', () => {
  const a = makeTile({ session_id: 'a', cell: 0 })
  const b = makeTile({ session_id: 'b', cell: 1 })
  const loaded = applyEvent(initialBoard, {
    type: 'snapshot',
    board: { grid: { columns: 2, rows: 1 }, tiles: [a, b], daemon: { connected: true, error: null } },
  })

  it('replaces everything on a snapshot', () => {
    expect(loaded.loaded).toBe(true)
    expect(Object.keys(loaded.tiles)).toEqual(['a', 'b'])
    expect(loaded.grid).toEqual({ columns: 2, rows: 1 })
    const again = applyEvent(loaded, {
      type: 'snapshot',
      board: { grid: { columns: 3, rows: 2 }, tiles: [b], daemon: { connected: true, error: null } },
    })
    expect(Object.keys(again.tiles)).toEqual(['b'])
  })

  it('upserts and removes tiles', () => {
    const moved = makeTile({ session_id: 'a', cell: 3 })
    const next = applyEvent(loaded, { type: 'tile', tile: moved })
    expect(next.tiles.a.cell).toBe(3)
    expect(loaded.tiles.a.cell).toBe(0)
    const removed = applyEvent(next, { type: 'tile_removed', session_id: 'a' })
    expect(Object.keys(removed.tiles)).toEqual(['b'])
  })

  it('takes grid and daemon changes and ignores heartbeats', () => {
    expect(applyEvent(loaded, { type: 'grid', grid: { columns: 2, rows: 2 } }).grid.rows).toBe(2)
    const down = applyEvent(loaded, { type: 'daemon', daemon: { connected: false, error: 'x' } })
    expect(down.daemon).toEqual({ connected: false, error: 'x' })
    expect(applyEvent(loaded, { type: 'heartbeat' })).toBe(loaded)
  })
})
