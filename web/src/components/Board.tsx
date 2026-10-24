import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useEffect, useState } from 'react'
import { fetchBoard, moveTile } from '../api/client'
import type { Grid, Tile } from '../api/types'
import { markDragEnd } from '../lib/dragGuard'
import { useBoard } from '../store'
import { BoardDialog } from './BoardDialog'
import type { DialogRequest } from '../lib/actions'
import { CellMenu } from './CellMenu'
import { StatusBanner } from './StatusBanner'
import { TileCard } from './TileCard'

const NOTICE_MS = 5_000

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

interface TileProps {
  tile: Tile
  now: number
  stale: boolean
}

function DraggableTile({ tile, now, stale }: TileProps) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({ id: tile.session_id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={`drag-handle${isDragging ? ' dragging' : ''}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
    >
      <TileCard tile={tile} now={now} stale={stale} />
    </div>
  )
}

interface CellProps {
  cell: number
  tile: Tile | undefined
  now: number
  stale: boolean
  grid: Grid
  hidden: Tile[]
  onDialog: (d: DialogRequest) => void
}

function Cell({ cell, tile, now, stale, grid, hidden, onDialog }: CellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${cell}`, data: { cell } })
  return (
    <CellMenu cell={cell} tile={tile} grid={grid} hidden={hidden} onDialog={onDialog}>
      <div ref={setNodeRef} className={`cell${isOver ? ' cell-over' : ''}`} data-cell={cell} data-testid="cell">
        {tile ? (
          <DraggableTile tile={tile} now={now} stale={stale} />
        ) : (
          <div className="cell-empty" data-testid="empty-cell" />
        )}
      </div>
    </CellMenu>
  )
}

export function Board() {
  const grid = useBoard((s) => s.grid)
  const tiles = useBoard((s) => s.tiles)
  const daemon = useBoard((s) => s.daemon)
  const connection = useBoard((s) => s.connection)
  const loaded = useBoard((s) => s.loaded)
  const notice = useBoard((s) => s.notice)
  const now = useNow(1_000)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => useBoard.getState().notify(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    markDragEnd()
    const cell = over?.data.current?.cell
    const sessionId = String(active.id)
    const { tiles: current, moveLocal, apply, notify } = useBoard.getState()
    if (typeof cell !== 'number' || current[sessionId]?.cell === cell) return
    moveLocal(sessionId, cell)
    const result = await moveTile(sessionId, cell)
    if (!result.ok) {
      notify({ kind: 'error', message: `Could not move the tile: ${result.message}` })
      const board = await fetchBoard()
      if (board) apply({ type: 'snapshot', board })
    }
  }

  const stale = connection !== 'open' || !daemon.connected
  const byCell = new Map<number, Tile>()
  const hidden: Tile[] = []
  for (const tile of Object.values(tiles)) {
    if (tile.hidden) hidden.push(tile)
    else if (tile.cell !== null) byCell.set(tile.cell, tile)
  }

  return (
    <main className="flex h-full flex-col gap-4 p-4">
      <StatusBanner connection={connection} daemon={daemon} loaded={loaded} />
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`banner${notice.kind === 'info' ? ' banner-info' : ''}`}
          data-testid="notice"
        >
          {notice.message}
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd} onDragCancel={markDragEnd}>
        <div
          className="grid min-h-0 flex-1 gap-4"
          style={{
            gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: grid.columns * grid.rows }, (_, cell) => (
            <Cell
              key={cell}
              cell={cell}
              tile={byCell.get(cell)}
              now={now}
              stale={stale}
              grid={grid}
              hidden={hidden}
              onDialog={setDialog}
            />
          ))}
        </div>
      </DndContext>
      {dialog && <BoardDialog request={dialog} grid={grid} onClose={() => setDialog(null)} />}
    </main>
  )
}
