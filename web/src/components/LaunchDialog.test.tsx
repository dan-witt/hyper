import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialBoard, useBoard } from '../store'
import { LaunchDialog } from './LaunchDialog'

const DIRS: Record<string, string[]> = {
  '~/me': ['~/media/', '~/memos/'],
  '~/med': ['~/media/'],
  '~/media/': ['~/media/personal/', '~/media/photos/'],
  '~/media/p': ['~/media/personal/', '~/media/photos/'],
}

type Launch = (body: Record<string, unknown>) => { status: number; body: unknown }

function mockService(launch: Launch = () => ({ status: 200, body: { session_id: 's1', name: null, dry_run: false } })) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/launch' && !init) return json(200, { cwd: '~/work/' })
    if (url.startsWith('/api/dirs?')) {
      const path = new URLSearchParams(url.split('?')[1]).get('path') ?? ''
      return json(200, { dirs: DIRS[path] ?? [] })
    }
    if (url === '/api/launch' && init?.method === 'POST') {
      const r = launch(JSON.parse(String(init.body)))
      return json(r.status, r.body)
    }
    return json(404, { detail: 'not found' })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const launchCalls = (fn: ReturnType<typeof mockService>) =>
  fn.mock.calls.filter(([url, init]) => url === '/api/launch' && init?.method === 'POST')

describe('LaunchDialog', () => {
  beforeEach(() => useBoard.setState({ ...initialBoard, notice: null }))
  afterEach(() => vi.unstubAllGlobals())

  it('starts in the last directory and launches into its cell with Ctrl+Enter', async () => {
    const fetch = mockService()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<LaunchDialog cell={4} onClose={onClose} />)
    const dir = screen.getByRole('combobox', { name: 'Directory' })
    await waitFor(() => expect(dir).toHaveValue('~/work/'))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'billing{Enter}')
    expect(launchCalls(fetch)).toHaveLength(0) // Enter in a field does not launch
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'first line{Enter}second line')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(JSON.parse(String(launchCalls(fetch)[0][1]!.body))).toEqual({
      cwd: '~/work/',
      name: 'billing',
      prompt: 'first line\nsecond line',
      cell: 4,
    })
  })

  it('completes directories: arrows pick, Enter takes, Tab takes the common prefix', async () => {
    mockService()
    const user = userEvent.setup()
    render(<LaunchDialog cell={0} onClose={() => {}} />)
    const dir = screen.getByRole('combobox', { name: 'Directory' })
    await waitFor(() => expect(dir).toHaveValue('~/work/'))
    await user.clear(dir)
    await user.type(dir, '~/me')
    expect(await screen.findByRole('option', { name: '~/memos/' })).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(dir).toHaveValue('~/media/')
    expect(await screen.findByRole('option', { name: '~/media/photos/' })).toBeInTheDocument()
    await user.keyboard('{Tab}')
    expect(dir).toHaveValue('~/media/p')
    expect(dir).toHaveFocus()
    await screen.findByRole('option', { name: '~/media/personal/' })
    await user.keyboard('{Tab}') // nothing longer to complete: Tab moves on
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
  })

  it('keeps a launch error in the dialog', async () => {
    mockService(() => ({ status: 409, body: { detail: 'not a directory: ~/nope' } }))
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<LaunchDialog cell={0} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Launch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not a directory: ~/nope')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a dry run', async () => {
    mockService(() => ({ status: 200, body: { session_id: null, name: null, dry_run: true } }))
    const user = userEvent.setup()
    render(<LaunchDialog cell={0} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Directory' })).toHaveValue('~/work/'))
    await user.click(screen.getByRole('button', { name: 'Launch' }))
    await waitFor(() => expect(useBoard.getState().notice?.message).toMatch(/^Dry run/))
  })
})
