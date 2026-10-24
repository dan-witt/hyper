import type { BoardView, FocusResult, Grid } from './types'

/** `data` is the parsed response body, or null for a 204. */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; message: string }

/** Every unsafe request carries a JSON content type: the service refuses it otherwise. */
async function send<T = null>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ActionResult<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { ok: false, message: 'board service unreachable' }
  }
  if (response.ok) {
    return { ok: true, data: (response.status === 204 ? null : await response.json()) as T }
  }
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

const tilePath = (sessionId: string) => `/api/tiles/${encodeURIComponent(sessionId)}`

export function focusSession(sessionId: string): Promise<ActionResult<FocusResult>> {
  return send<FocusResult>('POST', `/api/sessions/${encodeURIComponent(sessionId)}/focus`, {})
}

export function moveTile(sessionId: string, cell: number): Promise<ActionResult> {
  return send('POST', `${tilePath(sessionId)}/move`, { cell })
}

/** Fields left out are unchanged; null or blank clears one. */
export function editTile(
  sessionId: string,
  fields: { label?: string | null; description?: string | null },
): Promise<ActionResult> {
  return send('PATCH', tilePath(sessionId), fields)
}

export function acknowledgeTile(sessionId: string): Promise<ActionResult> {
  return send('POST', `${tilePath(sessionId)}/acknowledge`, {})
}

export function hideTile(sessionId: string): Promise<ActionResult> {
  return send('POST', `${tilePath(sessionId)}/hide`, {})
}

export function showTile(sessionId: string, cell: number | null): Promise<ActionResult> {
  return send('POST', `${tilePath(sessionId)}/show`, { cell })
}

export function removeTile(sessionId: string): Promise<ActionResult> {
  return send('DELETE', tilePath(sessionId))
}

/** Resolves to the size applied: rows grow to keep occupied cells. */
export function setGrid(columns: number, rows: number): Promise<ActionResult<Grid>> {
  return send<Grid>('POST', '/api/grid', { columns, rows })
}

export async function fetchBoard(): Promise<BoardView | null> {
  try {
    const response = await fetch('/api/board')
    return response.ok ? ((await response.json()) as BoardView) : null
  } catch {
    return null
  }
}
