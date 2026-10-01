import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataSource } from '@/data/source'
import { planReplay, playReplay, type ReplayHandle, type ReplayPace } from '@/data/replay'
import { createCellDrip, type CellDrip } from './cellDrip'
import { useRunStore } from './runStore'
import { useViewStore } from './viewStore'

export type Playback = { kind: 'live' } | { kind: 'replay'; pace: ReplayPace; /** bump to restart */ nonce: number }

const paceKey = (p: Playback) =>
  p.kind === 'live' ? 'live' : `${p.pace.mode}:${p.pace.mode === 'fill' ? p.pace.seconds : p.pace.speed}:${p.nonce}`

/**
 * Feed a run's events into the store through the cell drip: the live SSE stream (history
 * first, then live), or a finished run's recording on a wall-clock plan.
 */
export function useRunConnection(runId: string, n: number, playback: Playback) {
  const source = useDataSource()
  const key = paceKey(playback)
  const playbackRef = useRef(playback)
  const replayRef = useRef<ReplayHandle | null>(null)
  const dripRef = useRef<CellDrip | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    playbackRef.current = playback
  })

  useEffect(() => {
    if (n <= 0) return
    const pb = playbackRef.current
    useRunStore.getState().reset(runId, n)
    useViewStore.getState().clear()
    const drip = createCellDrip((events) => useRunStore.getState().ingest(events))
    dripRef.current = drip

    if (pb.kind === 'replay') {
      let cancelled = false
      setPlaying(true)
      source
        .getReplay(runId)
        .then((lines) => {
          if (cancelled) return
          replayRef.current = playReplay(
            planReplay(lines, pb.pace),
            (batch) => batch.forEach((p) => drip.push(p.event, p.spreadMs)),
            undefined,
            () => setPlaying(false),
          )
        })
        .catch((e: Error) => {
          setPlaying(false)
          useRunStore.getState().fail(e.message)
        })
      return () => {
        cancelled = true
        replayRef.current?.stop()
        replayRef.current = null
        drip.dispose()
      }
    }

    setPlaying(false)
    const unsubscribe = source.subscribe(runId, {
      onEvent: (e) => drip.push(e),
      onReset: () => {
        drip.flushAll()
        useRunStore.getState().reset(runId, n)
      },
      onError: (message) => {
        drip.flushAll()
        useRunStore.getState().fail(message)
      },
    })
    return () => {
      unsubscribe()
      drip.dispose()
    }
  }, [source, runId, n, key])

  /** Jump to the final state of a replay. */
  const skip = useCallback(() => {
    replayRef.current?.finish()
    dripRef.current?.flushAll()
    setPlaying(false)
  }, [])

  return { playing, skip }
}
