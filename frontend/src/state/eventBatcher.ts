/**
 * Queue events and flush them once per animation frame, so a burst of SSE messages
 * (a finished run replays its whole history at once) costs one store update and one render.
 */
export interface EventBatcher<E> {
  push: (e: E) => void
  /** apply anything queued right now */
  flush: () => void
  dispose: () => void
}

type Schedule = (cb: () => void) => number
type Cancel = (id: number) => void

export function createEventBatcher<E>(
  apply: (events: E[]) => void,
  schedule: Schedule = (cb) => requestAnimationFrame(cb),
  cancel: Cancel = (id) => cancelAnimationFrame(id),
): EventBatcher<E> {
  let queue: E[] = []
  let handle: number | null = null
  let disposed = false

  const flush = () => {
    if (handle !== null) cancel(handle)
    handle = null
    if (queue.length === 0) return
    const batch = queue
    queue = []
    apply(batch)
  }

  return {
    push: (e) => {
      if (disposed) return
      queue.push(e)
      if (handle === null) handle = schedule(flush)
    },
    flush,
    dispose: () => {
      disposed = true
      if (handle !== null) cancel(handle)
      handle = null
      queue = []
    },
  }
}
