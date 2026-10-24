import { create } from 'zustand'
import type { BoardEvent, DaemonStatus, Grid, Tile } from './api/types'

/** The page's connection to the board service, as opposed to the service's to the daemon. */
export type Connection = 'connecting' | 'open' | 'lost'

export interface BoardData {
  grid: Grid
  tiles: Record<string, Tile>
  daemon: DaemonStatus
  /** A snapshot has arrived since the page loaded. */
  loaded: boolean
}

export const initialBoard: BoardData = {
  grid: { columns: 3, rows: 2 },
  tiles: {},
  daemon: { connected: false, error: 'connecting' },
  loaded: false,
}

export function applyEvent(board: BoardData, event: BoardEvent): BoardData {
  switch (event.type) {
    case 'snapshot':
      return {
        grid: event.board.grid,
        tiles: Object.fromEntries(event.board.tiles.map((t) => [t.session_id, t])),
        daemon: event.board.daemon,
        loaded: true,
      }
    case 'tile':
      return { ...board, tiles: { ...board.tiles, [event.tile.session_id]: event.tile } }
    case 'tile_removed': {
      const { [event.session_id]: _removed, ...tiles } = board.tiles
      return { ...board, tiles }
    }
    case 'grid':
      return { ...board, grid: event.grid }
    case 'daemon':
      return { ...board, daemon: event.daemon }
    case 'heartbeat':
      return board
  }
}

/** Puts a tile in `cell` ahead of the service, swapping as the service does. */
export function moveTile(board: BoardData, sessionId: string, cell: number): BoardData {
  const tile = board.tiles[sessionId]
  if (!tile || tile.cell === null || tile.cell === cell) return board
  const tiles = { ...board.tiles }
  for (const [id, other] of Object.entries(tiles)) {
    if (id !== sessionId && other.cell === cell) tiles[id] = { ...other, cell: tile.cell }
  }
  tiles[sessionId] = { ...tile, cell }
  return { ...board, tiles }
}

/** A short message over the board: a failed action, or confirmation of one. */
export interface Notice {
  message: string
  kind: 'error' | 'info'
}

interface BoardStore extends BoardData {
  connection: Connection
  notice: Notice | null
  apply: (event: BoardEvent) => void
  moveLocal: (sessionId: string, cell: number) => void
  setConnection: (connection: Connection) => void
  notify: (notice: Notice | null) => void
}

export const useBoard = create<BoardStore>()((set) => ({
  ...initialBoard,
  connection: 'connecting',
  notice: null,
  apply: (event) => set((state) => applyEvent(state, event)),
  moveLocal: (sessionId, cell) => set((state) => moveTile(state, sessionId, cell)),
  setConnection: (connection) => set({ connection }),
  notify: (notice) => set({ notice }),
}))
