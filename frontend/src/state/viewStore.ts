import { create } from 'zustand'

/** A contiguous grid range, e.g. one timeline hour. */
export interface IndexRange {
  start: number
  end: number
}

export interface Brush {
  cid: number
  /** 1 for members, 0 otherwise; same length as the grid */
  mask: Uint8Array
}

/** Pointer/keyboard interaction state, kept apart from run data so hover never re-renders run panels. */
interface ViewStore {
  hovered: number | null
  selected: number | null
  /** range highlighted from the timeline (the hour under the pointer) */
  hoverRange: IndexRange | null
  brush: Brush | null
  /** a brushed cluster stays on after the pointer leaves */
  pinnedCid: number | null
  /** review open in the inspector drawer */
  inspecting: number | null
  /** cluster open in the cluster drawer */
  openCid: number | null
  setHovered: (i: number | null) => void
  select: (i: number | null) => void
  setHoverRange: (r: IndexRange | null) => void
  setBrush: (b: Brush | null) => void
  pin: (cid: number | null) => void
  inspect: (i: number | null) => void
  openCluster: (cid: number | null) => void
  clear: () => void
}

export function membersMask(n: number, members: readonly number[]): Uint8Array {
  const mask = new Uint8Array(n)
  for (const m of members) if (m >= 0 && m < n) mask[m] = 1
  return mask
}

export const useViewStore = create<ViewStore>()((set) => ({
  hovered: null,
  selected: null,
  hoverRange: null,
  brush: null,
  pinnedCid: null,
  inspecting: null,
  openCid: null,
  setHovered: (hovered) => set((s) => (s.hovered === hovered ? s : { hovered })),
  select: (selected) => set({ selected }),
  setHoverRange: (hoverRange) =>
    set((s) =>
      s.hoverRange?.start === hoverRange?.start && s.hoverRange?.end === hoverRange?.end ? s : { hoverRange },
    ),
  setBrush: (brush) => set({ brush }),
  pin: (pinnedCid) => set({ pinnedCid }),
  inspect: (inspecting) => set({ inspecting }),
  openCluster: (openCid) => set({ openCid }),
  clear: () =>
    set({ hovered: null, selected: null, hoverRange: null, brush: null, pinnedCid: null, inspecting: null, openCid: null }),
}))
