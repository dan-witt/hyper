import { useEffect, useState } from 'react'
import { focusSession } from '../api/client'
import type { Tile } from '../api/types'
import { displayName, formatAge, shouldPulse, stateLabel, subtitle, tone } from '../lib/tile'

const TOAST_MS = 4_000

interface Props {
  tile: Tile
  now: number
  /** The data may be out of date: the service or the daemon is unreachable. */
  stale: boolean
}

export function TileCard({ tile, now, stale }: Props) {
  const { session } = tile
  const [toast, setToast] = useState<string | null>(null)
  const pulse = shouldPulse(tile, now)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const onClick = async () => {
    const result = await focusSession(tile.session_id)
    setToast(result.ok ? null : result.message)
  }

  const age = formatAge((now - Date.parse(session.last_event_at)) / 1000)
  const active = session.state === 'running' && session.current_tool !== null

  return (
    <button
      type="button"
      className={`tile${stale ? ' tile-stale' : ''}`}
      data-tone={tone(tile)}
      data-testid="tile"
      data-session={tile.session_id}
      onClick={onClick}
    >
      {pulse && <span key={session.state_since} className="pulse-ring" data-testid="pulse" />}
      <div className="flex items-start justify-between gap-4">
        <h2 className="tile-name truncate">{displayName(tile)}</h2>
        <span className="tile-state shrink-0">{stateLabel(session)}</span>
      </div>
      <p className="tile-subtitle truncate">{subtitle(tile)}</p>
      <div className="mt-auto flex items-center gap-4">
        {active && (
          <span className="activity relative flex shrink-0" aria-label="working" data-testid="activity">
            <span className="tone-fill absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" />
            <span className="tone-fill relative inline-flex h-full w-full rounded-full" />
          </span>
        )}
        <span className="tile-event truncate">{session.last_event_text}</span>
        <span className="tile-age ml-auto shrink-0">{age}</span>
      </div>
      {toast && (
        <div role="alert" className="tile-toast">
          {toast}
        </div>
      )}
    </button>
  )
}
