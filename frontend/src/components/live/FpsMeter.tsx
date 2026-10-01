import { useEffect, useState } from 'react'
import { summarise, type FrameStats } from '@/lib/frameStats'

/** Dev overlay: rolling 2 s frame rate, p95 frame interval and worst grid paint time. */
export function FpsMeter() {
  const [stats, setStats] = useState<FrameStats | null>(null)
  useEffect(() => {
    window.__rieFrames = { intervals: [], paints: [] }
    let last = performance.now()
    let raf = requestAnimationFrame(function loop(now) {
      window.__rieFrames!.intervals.push(now - last)
      last = now
      raf = requestAnimationFrame(loop)
    })
    const id = setInterval(() => {
      const f = window.__rieFrames!
      setStats(summarise(f.intervals.slice(-120), f.paints.slice(-120)))
    }, 500)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(id)
    }
  }, [])
  if (!stats) return null
  return (
    <div className="num pointer-events-none fixed right-3 bottom-3 z-50 rounded-md border border-border bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground shadow">
      {stats.fps.toFixed(0)} fps · p95 {stats.p95FrameMs.toFixed(1)} ms · paint ≤ {stats.maxPaintMs.toFixed(2)} ms
    </div>
  )
}
