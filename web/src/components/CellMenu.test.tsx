import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tile } from '../api/types'
import { initialBoard, useBoard } from '../store'
import { makeTile } from '../test/fixtures'
import { Board } from './Board'

function mockFetch(status: number, body: unknown = null) {
  const fn = vi.fn().mockResolvedValue(
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function load(tiles: Tile[]) {
  act(() => {
    useBoard.getState().setConnection('open')
    useBoard.getState().apply({
      type: 'snapshot',
      board: { grid: { columns: 3, rows: 2 }, tiles, daemon: { connected: true, error: null } },
    })
  })
}

const cell = (n: number) => document.querySelector(`[data-cell="${n}"]`)!

function openMenu(n: number) {
  fireEvent.contextMenu(cell(n))
  return screen.getByTestId('cell-menu')
}

const items = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => i.textContent)

describe('cell menu', () => {
  beforeEach(() => useBoard.setState({ ...initialBoard, connection: 'connecting', notice: null }))
  afterEach(() => vi.unstubAllGlobals())

  it('offers acknowledge for a waiting tile and remove only for an ended one', () => {
    render(<Board />)
    load([
      makeTile({ session_id: 'w', cell: 0 }, { name: 'waiter', state: 'waiting', reason: 'permission' }),
      makeTile({ session_id: 'e', cell: 1 }, { name: 'gone', state: 'ended' }),
    ])
    expect(items(openMenu(0))).toEqual(['Acknowledge', 'Rename…', 'Edit description…', 'Copy project path', 'Hide'])
    fireEvent.keyDown(screen.getByTestId('cell-menu'), { key: 'Escape' })
    expect(items(openMenu(1))).toEqual(['Rename…', 'Edit description…', 'Copy project path', 'Hide', 'Remove'])
  })

  it('acknowledges through the service', async () => {
    const fetch = mockFetch(204)
    render(<Board />)
    load([makeTile({ session_id: 'w', cell: 0 }, { state: 'waiting', reason: 'done' })])
    fireEvent.click(within(openMenu(0)).getByText('Acknowledge'))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/tiles/w/acknowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
  })

  it('shows a failed action as a notice', async () => {
    mockFetch(409, { detail: 'only an offline tile can be removed; hide a live one' })
    render(<Board />)
    load([makeTile({ session_id: 'e', cell: 0 }, { state: 'ended' })])
    fireEvent.click(within(openMenu(0)).getByText('Remove'))
    expect(await screen.findByTestId('notice')).toHaveTextContent(
      'Could not remove the tile: only an offline tile can be removed; hide a live one',
    )
  })

  it('renames through a dialog', async () => {
    const fetch = mockFetch(204)
    const user = userEvent.setup()
    render(<Board />)
    load([makeTile({ session_id: 'a', cell: 0, label: 'old' }, { name: 'alpha' })])
    fireEvent.click(within(openMenu(0)).getByText('Rename…'))
    const input = await screen.findByRole('textbox', { name: 'Rename tile' })
    expect(input).toHaveValue('old')
    await user.clear(input)
    await user.type(input, 'billing{Enter}')
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/tiles/a', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{"label":"billing"}',
      }),
    )
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull())
  })

  it('lists hidden tiles on an empty cell and shows one into that cell', async () => {
    const fetch = mockFetch(204)
    render(<Board />)
    load([
      makeTile({ session_id: 'a', cell: 0 }, { name: 'alpha' }),
      makeTile({ session_id: 'h', cell: null, hidden: true }, { name: 'hidden-one' }),
    ])
    const menu = openMenu(4)
    expect(within(menu).getByText(/Show hidden \(1\)/)).toBeInTheDocument()
    expect(within(menu).getByText(/Grid size/)).toHaveTextContent('3×2')
    fireEvent.keyDown(within(menu).getByText(/Show hidden/), { key: 'ArrowRight' })
    fireEvent.click(await screen.findByText('hidden-one'))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/tiles/h/show', expect.objectContaining({ body: '{"cell":4}' })),
    )
  })

  it('disables show hidden when nothing is hidden', () => {
    render(<Board />)
    load([])
    const trigger = within(openMenu(0)).getByText(/Show hidden \(0\)/)
    expect(trigger).toHaveAttribute('data-disabled')
  })
})
