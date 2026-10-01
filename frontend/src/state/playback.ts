import type { Playback } from './useRunConnection'

/** `?play=` values for a finished run. Default: the grid fills in 30 s. */
export const PLAY_OPTIONS = [
  { value: '30', label: '30 s', title: 'Fill the grid in 30 seconds' },
  { value: '10', label: '10 s', title: 'Fill the grid in 10 seconds' },
  { value: 'realtime', label: 'Real time', title: 'Recorded pace, idle stages included' },
] as const
export const DEFAULT_PLAY = '30'

/** Finished runs replay; `play=end` (or a run still in progress) streams live. */
export function playbackFor(params: URLSearchParams, finished: boolean, nonce: number): Playback {
  const play = params.get('play') ?? (params.get('replay') === '1' ? 'realtime' : DEFAULT_PLAY)
  if (!finished || play === 'end') return { kind: 'live' }
  if (play === 'realtime') return { kind: 'replay', pace: { mode: 'realtime', speed: Number(params.get('speed')) || 1 }, nonce }
  return { kind: 'replay', pace: { mode: 'fill', seconds: Number(play) || Number(DEFAULT_PLAY) }, nonce }
}
