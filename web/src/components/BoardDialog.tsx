import { Dialog } from 'radix-ui'
import { type FormEvent, type ReactNode, useState } from 'react'
import { editTile } from '../api/client'
import type { Grid, Tile } from '../api/types'
import { applyGrid, type DialogRequest } from '../lib/actions'

interface FrameProps {
  title: string
  hint: string
  error: string | null
  busy: boolean
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}

function Frame({ title, hint, error, busy, onSubmit, onClose, children }: FrameProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" data-testid="dialog">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Dialog.Title className="dialog-title">{title}</Dialog.Title>
            <Dialog.Description className="dialog-hint">{hint}</Dialog.Description>
            {children}
            {error && (
              <p role="alert" className="dialog-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <button type="button" className="button">
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="button button-primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const TEXT_FIELDS = {
  label: { title: 'Rename tile', hint: 'Shown on the board only. Leave empty to use the session name.', max: 60 },
  description: {
    title: 'Tile description',
    hint: 'Shown under the name. Leave empty to show the project path.',
    max: 200,
  },
} as const

function TextDialog({ field, tile, onClose }: { field: 'label' | 'description'; tile: Tile; onClose: () => void }) {
  const spec = TEXT_FIELDS[field]
  const [value, setValue] = useState(tile[field] ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const result = await editTile(tile.session_id, { [field]: value })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  return (
    <Frame title={spec.title} hint={spec.hint} error={error} busy={busy} onSubmit={() => void save()} onClose={onClose}>
      <input
        className="field"
        aria-label={spec.title}
        value={value}
        maxLength={spec.max}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
    </Frame>
  )
}

const GRID_MAX = 12

function GridDialog({ grid, onClose }: { grid: Grid; onClose: () => void }) {
  const [columns, setColumns] = useState(String(grid.columns))
  const [rows, setRows] = useState(String(grid.rows))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const c = Number(columns)
    const r = Number(rows)
    if (![c, r].every((n) => Number.isInteger(n) && n >= 1 && n <= GRID_MAX)) {
      setError(`Columns and rows are whole numbers from 1 to ${GRID_MAX}.`)
      return
    }
    setBusy(true)
    const result = await applyGrid(c, r)
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.message)
  }
  const number = (label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <label className="flex flex-1 flex-col gap-1">
      <span className="dialog-hint">{label}</span>
      <input
        className="field"
        type="number"
        min={1}
        max={GRID_MAX}
        value={value}
        onChange={(e) => set(e.target.value)}
        autoFocus={autoFocus}
      />
    </label>
  )
  return (
    <Frame
      title="Grid size"
      hint="Tiles keep their reading order; rows never drop below what the tiles need."
      error={error}
      busy={busy}
      onSubmit={() => void save()}
      onClose={onClose}
    >
      <div className="flex gap-4">
        {number('Columns', columns, setColumns, true)}
        {number('Rows', rows, setRows)}
      </div>
    </Frame>
  )
}

export function BoardDialog({ request, grid, onClose }: { request: DialogRequest; grid: Grid; onClose: () => void }) {
  if (request.kind === 'grid') return <GridDialog grid={grid} onClose={onClose} />
  return <TextDialog key={request.tile.session_id} field={request.kind} tile={request.tile} onClose={onClose} />
}
