import type { DaemonStatus } from '../api/types'
import type { Connection } from '../store'

interface Props {
  connection: Connection
  daemon: DaemonStatus
  loaded: boolean
}

export function StatusBanner({ connection, daemon, loaded }: Props) {
  let message: string | null = null
  if (connection === 'lost') message = 'Board service unreachable · reconnecting'
  else if (!loaded) message = 'Connecting to the board service…'
  else if (!daemon.connected) message = `claude-control unreachable (${daemon.error ?? 'unknown'}) · retrying`
  if (!message) return null
  return (
    <div role="status" className="banner" data-testid="status-banner">
      {message}
    </div>
  )
}
