import { type ActionResult, setGrid } from '../api/client'
import type { Grid, Tile } from '../api/types'
import { useBoard } from '../store'

export type DialogRequest = { kind: 'label' | 'description'; tile: Tile } | { kind: 'grid' }

export const GRID_PRESETS: readonly (readonly [number, number])[] = [
  [2, 2],
  [3, 2],
  [2, 3],
  [4, 2],
  [3, 3],
  [4, 3],
]

export const gridKey = (columns: number, rows: number) => `${columns}x${rows}`

export async function run(action: Promise<ActionResult<unknown>>, what: string): Promise<void> {
  const result = await action
  if (!result.ok) useBoard.getState().notify({ kind: 'error', message: `Could not ${what}: ${result.message}` })
}

export async function applyGrid(columns: number, rows: number): Promise<ActionResult<Grid>> {
  const result = await setGrid(columns, rows)
  if (result.ok && result.data.rows !== rows) {
    useBoard.getState().notify({
      kind: 'info',
      message: `Kept ${result.data.rows} rows: tiles occupy cells beyond ${columns}×${rows}`,
    })
  }
  return result
}

export async function copyPath(path: string): Promise<void> {
  const { notify } = useBoard.getState()
  try {
    await navigator.clipboard.writeText(path)
    notify({ kind: 'info', message: `Copied ${path}` })
  } catch {
    notify({ kind: 'error', message: 'Could not copy the path: clipboard unavailable' })
  }
}
