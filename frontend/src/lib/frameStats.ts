export interface FrameStats {
  fps: number
  p95FrameMs: number
  maxPaintMs: number
  frames: number
}

declare global {
  interface Window {
    /** dev-only frame stats (`?fps=1`), read by benchmark scripts */
    __rieFrames?: { intervals: number[]; paints: number[] }
  }
}

export function recordPaint(ms: number) {
  window.__rieFrames?.paints.push(ms)
}

export function summarise(intervals: number[], paints: number[]): FrameStats {
  const sorted = [...intervals].sort((a, b) => a - b)
  const mean = intervals.reduce((a, b) => a + b, 0) / (intervals.length || 1)
  return {
    fps: intervals.length ? 1000 / mean : 0,
    p95FrameMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0,
    maxPaintMs: paints.length ? Math.max(...paints) : 0,
    frames: intervals.length,
  }
}
