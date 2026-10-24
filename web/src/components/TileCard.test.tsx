import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NOW, iso, makeTile } from '../test/fixtures'
import { TileCard } from './TileCard'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('TileCard', () => {
  it('shows the name, state, last event and age', () => {
    render(<TileCard tile={makeTile({}, { state: 'waiting', reason: 'permission' })} now={NOW} stale={false} />)
    const tile = screen.getByTestId('tile')
    expect(tile).toHaveAttribute('data-tone', 'wait')
    expect(tile).toHaveTextContent('billing')
    expect(tile).toHaveTextContent('permission')
    expect(tile).toHaveTextContent('finished its turn')
    expect(tile).toHaveTextContent('1m')
    expect(tile).toHaveTextContent('…/work/billing')
  })

  it('shows activity only while a tool runs', () => {
    const { rerender } = render(<TileCard tile={makeTile({}, { state: 'running' })} now={NOW} stale={false} />)
    expect(screen.queryByTestId('activity')).toBeNull()
    rerender(<TileCard tile={makeTile({}, { state: 'running', current_tool: 'Bash' })} now={NOW} stale={false} />)
    expect(screen.getByTestId('activity')).toBeInTheDocument()
  })

  it('pulses just after entering waiting', () => {
    const fresh = makeTile({}, { state: 'waiting', reason: 'done', state_since: iso(1_000) })
    const { rerender } = render(<TileCard tile={fresh} now={NOW} stale={false} />)
    expect(screen.getByTestId('pulse')).toBeInTheDocument()
    rerender(<TileCard tile={fresh} now={NOW + 10_000} stale={false} />)
    expect(screen.queryByTestId('pulse')).toBeNull()
  })

  it('marks stale data', () => {
    render(<TileCard tile={makeTile()} now={NOW} stale />)
    expect(screen.getByTestId('tile')).toHaveClass('tile-stale')
  })

  it('focuses the session on click', async () => {
    const fetch = mockFetch(200, { session_id: 'sess-1', pane: '%1' })
    render(<TileCard tile={makeTile()} now={NOW} stale={false} />)
    await userEvent.click(screen.getByTestId('tile'))
    expect(fetch).toHaveBeenCalledWith('/api/sessions/sess-1/focus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a failed focus on the tile', async () => {
    mockFetch(409, { detail: 'session sess-1 is not running in tmux' })
    render(<TileCard tile={makeTile()} now={NOW} stale={false} />)
    await userEvent.click(screen.getByTestId('tile'))
    expect(await screen.findByRole('alert')).toHaveTextContent('session sess-1 is not running in tmux')
  })
})
