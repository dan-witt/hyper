import type { components } from './schema'

type Schemas = components['schemas']

export type Grid = Schemas['Grid']
export type Tile = Schemas['Tile']
export type Session = Schemas['DaemonSession']
export type SessionState = Session['state']
export type DaemonStatus = Schemas['DaemonStatus']
export type BoardView = Schemas['BoardView']
export type FocusResult = Schemas['FocusResult']

// The SSE item schema is not read by openapi-typescript, so the union is spelled here.
export type BoardEvent =
  | Schemas['SnapshotEvent']
  | Schemas['TileEvent']
  | Schemas['TileRemovedEvent']
  | Schemas['GridEvent']
  | Schemas['DaemonEvent']
  | Schemas['HeartbeatEvent']
