import { ContextMenu } from 'radix-ui'
import type { ReactElement } from 'react'
import { acknowledgeTile, hideTile, removeTile, showTile } from '../api/client'
import type { Grid, Tile } from '../api/types'
import { applyGrid, copyPath, type DialogRequest, GRID_PRESETS, gridKey, run } from '../lib/actions'
import { canAcknowledge, displayName } from '../lib/tile'

function TileItems({ tile, onDialog }: { tile: Tile; onDialog: (d: DialogRequest) => void }) {
  const id = tile.session_id
  const cwd = tile.session.cwd
  return (
    <>
      <ContextMenu.Label className="menu-label truncate">{displayName(tile)}</ContextMenu.Label>
      {canAcknowledge(tile) && (
        <ContextMenu.Item className="menu-item" onSelect={() => void run(acknowledgeTile(id), 'acknowledge')}>
          Acknowledge
        </ContextMenu.Item>
      )}
      <ContextMenu.Item className="menu-item" onSelect={() => onDialog({ kind: 'label', tile })}>
        Rename…
      </ContextMenu.Item>
      <ContextMenu.Item className="menu-item" onSelect={() => onDialog({ kind: 'description', tile })}>
        Edit description…
      </ContextMenu.Item>
      <ContextMenu.Item className="menu-item" disabled={!cwd} onSelect={() => cwd && void copyPath(cwd)}>
        Copy project path
      </ContextMenu.Item>
      <ContextMenu.Separator className="menu-separator" />
      <ContextMenu.Item className="menu-item" onSelect={() => void run(hideTile(id), 'hide the tile')}>
        Hide
      </ContextMenu.Item>
      {tile.session.state === 'ended' && (
        <ContextMenu.Item className="menu-item danger" onSelect={() => void run(removeTile(id), 'remove the tile')}>
          Remove
        </ContextMenu.Item>
      )}
    </>
  )
}

interface EmptyProps {
  cell: number
  grid: Grid
  hidden: Tile[]
  onDialog: (d: DialogRequest) => void
}

function EmptyItems({ cell, grid, hidden, onDialog }: EmptyProps) {
  return (
    <>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="menu-item" disabled={hidden.length === 0}>
          Show hidden ({hidden.length})<span className="menu-hint">›</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="menu" sideOffset={4}>
            {hidden.map((tile) => (
              <ContextMenu.Item
                key={tile.session_id}
                className="menu-item"
                onSelect={() => void run(showTile(tile.session_id, cell), 'show the tile')}
              >
                {displayName(tile)}
                <span className="menu-hint">{tile.session.state === 'ended' ? 'offline' : tile.session.state}</span>
              </ContextMenu.Item>
            ))}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="menu-item">
          Grid size
          <span className="menu-hint">
            {grid.columns}×{grid.rows} ›
          </span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="menu" sideOffset={4}>
            <ContextMenu.RadioGroup
              value={gridKey(grid.columns, grid.rows)}
              onValueChange={(value) => {
                const preset = GRID_PRESETS.find(([c, r]) => gridKey(c, r) === value)
                if (preset) void run(applyGrid(...preset), 'resize the grid')
              }}
            >
              {GRID_PRESETS.map(([c, r]) => (
                <ContextMenu.RadioItem key={gridKey(c, r)} value={gridKey(c, r)} className="menu-item">
                  <span className="menu-check">
                    <ContextMenu.ItemIndicator>✓</ContextMenu.ItemIndicator>
                  </span>
                  {c} × {r}
                </ContextMenu.RadioItem>
              ))}
            </ContextMenu.RadioGroup>
            <ContextMenu.Separator className="menu-separator" />
            <ContextMenu.Item className="menu-item" onSelect={() => onDialog({ kind: 'grid' })}>
              <span className="menu-check" />
              Custom…
            </ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
    </>
  )
}

interface Props extends EmptyProps {
  tile: Tile | undefined
  /** The cell element; it becomes the menu's trigger. */
  children: ReactElement
}

/** Right-click menu for one grid cell: tile actions, or board actions on an empty cell. */
export function CellMenu({ tile, children, ...empty }: Props) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu" data-testid="cell-menu">
          {tile ? <TileItems tile={tile} onDialog={empty.onDialog} /> : <EmptyItems {...empty} />}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
