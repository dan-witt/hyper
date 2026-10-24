import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialBoard, useBoard } from '../store'
import { makeTile } from '../test/fixtures'
import { Board } from './Board'

function load(daemonConnected = true) {
  act(() => {
    useBoard.getState().setConnection('open')
    useBoard.getState().apply({
      type: 'snapshot',
      board: {
        grid: { columns: 3, rows: 2 },
        tiles: [
          makeTile({ session_id: 'a', cell: 0 }, { name: 'alpha' }),
          makeTile({ session_id: 'b', cell: 4 }, { name: 'beta' }),
          makeTile({ session_id: 'c', cell: null, hidden: true }, { name: 'gamma' }),
        ],
        daemon: { connected: daemonConnected, error: daemonConnected ? null : 'ConnectError: refused' },
      },
    })
  })
}

describe('Board', () => {
  beforeEach(() => useBoard.setState({ ...initialBoard, connection: 'connecting' }))

  it('places tiles in their cells and leaves the rest empty', () => {
    render(<Board />)
    load()
    const tiles = screen.getAllByTestId('tile')
    expect(tiles.map((t) => t.textContent?.match(/alpha|beta/)?.[0])).toEqual(['alpha', 'beta'])
    expect(screen.getAllByTestId('empty-cell')).toHaveLength(4)
    const cells = screen.getByRole('main').querySelector('.grid')!.children
    expect(cells[0]).toHaveTextContent('alpha')
    expect(cells[4]).toHaveTextContent('beta')
    expect(screen.queryByTestId('status-banner')).toBeNull()
  })

  it('reports an unreachable daemon and greys the tiles', () => {
    render(<Board />)
    load(false)
    expect(screen.getByTestId('status-banner')).toHaveTextContent('claude-control unreachable (ConnectError: refused)')
    for (const tile of screen.getAllByTestId('tile')) expect(tile).toHaveClass('tile-stale')
  })

  it('reports a lost connection to the service', () => {
    render(<Board />)
    load()
    act(() => useBoard.getState().setConnection('lost'))
    expect(screen.getByTestId('status-banner')).toHaveTextContent('Board service unreachable')
  })
})
