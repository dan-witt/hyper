import type { Session, Tile } from '../api/types'

/** The decorator a tile gets; styled in index.css by `data-tone`. */
export type Tone = 'run' | 'wait' | 'acked' | 'idle' | 'error' | 'off' | 'start'

export function tone(tile: Tile): Tone {
  switch (tile.session.state) {
    case 'running':
      return 'run'
    case 'waiting':
      return tile.acknowledged ? 'acked' : 'wait'
    case 'idle':
      return 'idle'
    case 'error':
      return 'error'
    case 'ended':
      return 'off'
    case 'starting':
      return 'start'
  }
}

export function stateLabel(session: Session): string {
  switch (session.state) {
    case 'waiting':
      return { permission: 'permission', input: 'question', done: 'done' }[session.reason ?? ''] ?? 'waiting'
    case 'ended':
      return 'offline'
    case 'error':
      return session.reason ? `error · ${session.reason}` : 'error'
    default:
      return session.state
  }
}

function lastSegments(path: string, count: number): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length <= count ? path : '…/' + parts.slice(-count).join('/')
}

export function displayName(tile: Tile): string {
  const { session } = tile
  return (
    tile.label ||
    session.name ||
    (session.cwd ? (session.cwd.split('/').filter(Boolean).pop() ?? session.cwd) : null) ||
    tile.session_id.slice(0, 8)
  )
}

export function subtitle(tile: Tile): string {
  return tile.description || (tile.session.cwd ? lastSegments(tile.session.cwd, 2) : '')
}

export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export const PULSE_WINDOW_MS = 5_000

/** Whether a tile has just entered a state that needs attention. */
export function shouldPulse(tile: Tile, nowMs: number): boolean {
  const { state, state_since } = tile.session
  if (tile.acknowledged || (state !== 'waiting' && state !== 'error')) return false
  return nowMs - Date.parse(state_since) < PULSE_WINDOW_MS
}
