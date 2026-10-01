import { useEffect, useRef, useState } from 'react'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Follow `target` smoothly (ease-out over `ms`), restarting from wherever the display is
 * when the target moves. Snaps under `prefers-reduced-motion`, and for the first value.
 */
export function useTween(target: number | null, ms = 600): number | null {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (target == null || shownRef.current == null || Number.isNaN(target) || reducedMotion()) {
      shownRef.current = target
      setShown(target)
      return
    }
    const from = shownRef.current
    if (from === target) return
    const t0 = performance.now()
    const step = (now: number) => {
      const x = Math.min(1, (now - t0) / ms)
      const v = from + (target - from) * (1 - (1 - x) ** 3)
      shownRef.current = v
      setShown(v)
      raf.current = x < 1 ? requestAnimationFrame(step) : null
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
  }, [target, ms])

  return shown
}
