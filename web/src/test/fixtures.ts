import type { Session, Tile } from '../api/types'

export const NOW = Date.parse('2026-10-24T12:00:00.000Z')

export function iso(msBeforeNow: number): string {
  return new Date(NOW - msBeforeNow).toISOString()
}

export function makeTile(
  overrides: Partial<Omit<Tile, 'session'>> = {},
  session: Partial<Session> = {},
): Tile {
  const id = overrides.session_id ?? session.session_id ?? 'sess-1'
  return {
    session_id: id,
    cell: 0,
    label: null,
    description: null,
    hidden: false,
    acknowledged: false,
    ...overrides,
    session: {
      session_id: id,
      name: 'billing',
      state: 'idle',
      reason: null,
      state_since: iso(60_000),
      cwd: '/home/user/work/billing',
      last_event: 'Stop',
      last_event_text: 'finished its turn',
      last_event_at: iso(90_000),
      started_at: iso(3_600_000),
      pane: '%1',
      current_tool: null,
      tool_count: 0,
      background_tasks: 0,
      replaces: null,
      ...session,
    },
  }
}
