import { useEffect, useState } from 'react'
import type { Tile } from '../api/types'
import { useBoard } from '../store'
import { StatusBanner } from './StatusBanner'
import { TileCard } from './TileCard'

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function Board() {
  const grid = useBoard((s) => s.grid)
  const tiles = useBoard((s) => s.tiles)
  const daemon = useBoard((s) => s.daemon)
  const connection = useBoard((s) => s.connection)
  const loaded = useBoard((s) => s.loaded)
  const now = useNow(1_000)

  const stale = connection !== 'open' || !daemon.connected
  const byCell = new Map<number, Tile>()
  for (const tile of Object.values(tiles)) {
    if (!tile.hidden && tile.cell !== null) byCell.set(tile.cell, tile)
  }

  return (
    <main className="flex h-full flex-col gap-4 p-4">
      <StatusBanner connection={connection} daemon={daemon} loaded={loaded} />
      <div
        className="grid min-h-0 flex-1 gap-4"
        style={{
          gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: grid.columns * grid.rows }, (_, cell) => {
          const tile = byCell.get(cell)
          return (
            <div key={tile ? tile.session_id : `empty-${cell}`} className="cell">
              {tile ? (
                <TileCard tile={tile} now={now} stale={stale} />
              ) : (
                <div className="cell-empty" data-testid="empty-cell" />
              )}
            </div>
          )
        })}
      </div>
    </main>
  )
}
