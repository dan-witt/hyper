import { describe, expect, it } from 'vitest'
import { NOW, iso, makeTile } from '../test/fixtures'
import { displayName, formatAge, shouldPulse, stateLabel, subtitle, tone } from './tile'

describe('tone', () => {
  it('maps states to decorators', () => {
    expect(tone(makeTile({}, { state: 'running' }))).toBe('run')
    expect(tone(makeTile({}, { state: 'waiting', reason: 'done' }))).toBe('wait')
    expect(tone(makeTile({ acknowledged: true }, { state: 'waiting', reason: 'done' }))).toBe('acked')
    expect(tone(makeTile({}, { state: 'idle' }))).toBe('idle')
    expect(tone(makeTile({}, { state: 'error' }))).toBe('error')
    expect(tone(makeTile({}, { state: 'ended' }))).toBe('off')
    expect(tone(makeTile({}, { state: 'starting' }))).toBe('start')
  })
})

describe('labels', () => {
  it('words the state', () => {
    expect(stateLabel(makeTile({}, { state: 'waiting', reason: 'permission' }).session)).toBe('permission')
    expect(stateLabel(makeTile({}, { state: 'waiting', reason: 'input' }).session)).toBe('question')
    expect(stateLabel(makeTile({}, { state: 'ended', reason: 'other' }).session)).toBe('offline')
    expect(stateLabel(makeTile({}, { state: 'error', reason: 'overloaded' }).session)).toBe('error · overloaded')
    expect(stateLabel(makeTile({}, { state: 'running' }).session)).toBe('running')
  })

  it('names a tile by label, then session name, then directory', () => {
    expect(displayName(makeTile({ label: 'Billing migration' }))).toBe('Billing migration')
    expect(displayName(makeTile())).toBe('billing')
    expect(displayName(makeTile({}, { name: null, cwd: '/work/auth/' }))).toBe('auth')
    expect(displayName(makeTile({ session_id: 'abcdef123456' }, { name: null, cwd: null }))).toBe('abcdef12')
  })

  it('subtitles with the description, else the end of the path', () => {
    expect(subtitle(makeTile({ description: 'moves invoices' }))).toBe('moves invoices')
    expect(subtitle(makeTile())).toBe('…/work/billing')
    expect(subtitle(makeTile({}, { cwd: '/srv' }))).toBe('/srv')
  })

  it('formats ages', () => {
    expect(formatAge(-3)).toBe('0s')
    expect(formatAge(59.9)).toBe('59s')
    expect(formatAge(61)).toBe('1m')
    expect(formatAge(7200)).toBe('2h')
    expect(formatAge(200_000)).toBe('2d')
  })
})

describe('shouldPulse', () => {
  it('pulses only just after entering waiting or error, unacknowledged', () => {
    expect(shouldPulse(makeTile({}, { state: 'waiting', state_since: iso(1_000) }), NOW)).toBe(true)
    expect(shouldPulse(makeTile({}, { state: 'error', state_since: iso(4_900) }), NOW)).toBe(true)
    expect(shouldPulse(makeTile({}, { state: 'waiting', state_since: iso(6_000) }), NOW)).toBe(false)
    expect(shouldPulse(makeTile({}, { state: 'running', state_since: iso(1_000) }), NOW)).toBe(false)
    expect(
      shouldPulse(makeTile({ acknowledged: true }, { state: 'waiting', state_since: iso(1_000) }), NOW),
    ).toBe(false)
  })
})
