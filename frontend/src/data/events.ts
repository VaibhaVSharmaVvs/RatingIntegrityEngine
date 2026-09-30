import type {
  ActionCode,
  ClusterEvent,
  CountersEvent,
  DoneEvent,
  ErrorEvent,
  FeaturesDoneEvent,
  JudgedEvent,
  RatingEvent,
  StageEvent,
} from './api'

/** Every SSE event from `GET /runs/{id}/events`; discriminate on `type`. */
export type RunEvent =
  | StageEvent
  | FeaturesDoneEvent
  | JudgedEvent
  | CountersEvent
  | RatingEvent
  | ClusterEvent
  | DoneEvent
  | ErrorEvent

export type RunEventType = RunEvent['type']

export const ACTION: Record<'PENDING' | 'KEEP' | 'DOWNWEIGHT' | 'FLAG' | 'EXCLUDE', ActionCode> = {
  PENDING: 0,
  KEEP: 1,
  DOWNWEIGHT: 2,
  FLAG: 3,
  EXCLUDE: 4,
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Decode a `judged` event into grid indices and their action codes. */
export function decodeJudged(e: JudgedEvent): { indices: Uint32Array; actions: Uint8Array } {
  const idx = base64ToBytes(e.indices_b64)
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength)
  const indices = new Uint32Array(idx.byteLength / 4)
  for (let i = 0; i < indices.length; i++) indices[i] = view.getUint32(i * 4, true)
  return { indices, actions: base64ToBytes(e.actions_b64) }
}
