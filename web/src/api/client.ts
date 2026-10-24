import type { BoardView } from './types'

export type ActionResult = { ok: true } | { ok: false; message: string }

async function post(path: string, body: unknown = {}): Promise<ActionResult> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, message: 'board service unreachable' }
  }
  if (response.ok) return { ok: true }
  let message = response.statusText || `HTTP ${response.status}`
  try {
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string') {
      message = data.detail
    }
  } catch {
    // not JSON; keep the status text
  }
  return { ok: false, message }
}

export function focusSession(sessionId: string): Promise<ActionResult> {
  return post(`/api/sessions/${encodeURIComponent(sessionId)}/focus`)
}

export function moveTile(sessionId: string, cell: number): Promise<ActionResult> {
  return post(`/api/tiles/${encodeURIComponent(sessionId)}/move`, { cell })
}

export function setGrid(columns: number, rows: number): Promise<ActionResult> {
  return post('/api/grid', { columns, rows })
}

export async function fetchBoard(): Promise<BoardView | null> {
  try {
    const response = await fetch('/api/board')
    return response.ok ? ((await response.json()) as BoardView) : null
  } catch {
    return null
  }
}
