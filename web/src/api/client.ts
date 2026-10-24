import type { BoardView, FocusResult, Grid, LaunchRequest, LaunchResult } from './types'

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

/** Start a session; its tile goes in `cell`. */
export function launchSession(request: LaunchRequest): Promise<ActionResult<LaunchResult>> {
  return send<LaunchResult>('POST', '/api/launch', request)
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path)
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/** The directory last launched in, or `~/`. */
export async function launchDirectory(): Promise<string> {
  return (await getJson<{ cwd: string }>('/api/launch'))?.cwd ?? '~/'
}

/** Directories completing the last component of `path`. */
export async function completeDirectory(path: string): Promise<string[]> {
  return (await getJson<{ dirs: string[] }>(`/api/dirs?${new URLSearchParams({ path })}`))?.dirs ?? []
}

export function fetchBoard(): Promise<BoardView | null> {
  return getJson<BoardView>('/api/board')
}
