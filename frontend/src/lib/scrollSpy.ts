import { useEffect, useState } from 'react'

/**
 * Index of the section being read: the last one whose top has scrolled above `line`.
 * At the bottom of the page the last section wins, since a short final section may never
 * reach the line. Before the first section: -1.
 */
export function activeSectionIndex(tops: readonly number[], line: number, atBottom: boolean): number {
  if (tops.length === 0) return -1
  if (atBottom) return tops.length - 1
  let active = -1
  for (let i = 0; i < tops.length; i++) if (tops[i] <= line) active = i
  return active
}

/**
 * Scroll-spy for a table of contents: the id of the section in view, updated once per
 * frame while the window scrolls or resizes.
 */
export function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    let frame: number | null = null
    const measure = () => {
      frame = null
      const tops = ids.map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY)
      // the reading line sits a third of the way down, below the sticky header
      const line = Math.max(120, window.innerHeight / 3)
      const doc = document.documentElement
      const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2
      const i = activeSectionIndex(tops, line, atBottom)
      setActive(i >= 0 ? ids[i] : null)
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [ids])
  return active
}
