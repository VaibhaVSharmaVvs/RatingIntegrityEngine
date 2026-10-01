/**
 * Mutable per-review action buffer. Lives outside React state: 50K cells change many
 * times a second, so components read it through a version counter instead of props.
 */
export class GridBuffer {
  actions: Uint8Array
  /** previous action of each cell, the colour a fade starts from */
  prev: Uint8Array
  /** performance.now() when the cell last changed; -Infinity when never */
  changedAt: Float64Array
  /** cells changed since the renderer last drained them */
  private dirty: number[] = []
  /** set when every cell must be repainted (resize, reset, whole-grid load) */
  fullDirty = true
  /** running count of cells per action code, kept in step with `actions` */
  readonly tally = new Uint32Array(5)

  constructor(n = 0) {
    this.actions = new Uint8Array(n)
    this.prev = new Uint8Array(n)
    this.changedAt = new Float64Array(n).fill(-Infinity)
    this.tally[0] = n
  }

  get size(): number {
    return this.actions.length
  }

  /** Grow to `n` cells, keeping existing values. Never shrinks. */
  ensure(n: number): void {
    if (n <= this.size) return
    const oldSize = this.size
    const grow = <T extends Uint8Array | Float64Array>(old: T, make: (n: number) => T, fill?: number) => {
      const next = make(n)
      if (fill !== undefined) next.fill(fill)
      next.set(old)
      return next
    }
    this.actions = grow(this.actions, (k) => new Uint8Array(k))
    this.prev = grow(this.prev, (k) => new Uint8Array(k))
    this.changedAt = grow(this.changedAt, (k) => new Float64Array(k), -Infinity)
    this.tally[0] += n - oldSize // new cells start pending
    this.fullDirty = true
  }

  /** Apply updates; the last write to a cell wins. Returns how many cells changed. */
  apply(indices: ArrayLike<number>, actions: ArrayLike<number>, now: number): number {
    let max = -1
    for (let k = 0; k < indices.length; k++) if (indices[k] > max) max = indices[k]
    if (max >= this.size) this.ensure(max + 1)
    let changed = 0
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k]
      const a = actions[k]
      if (this.actions[i] === a) continue
      this.tally[this.actions[i]]--
      this.tally[a]++
      this.prev[i] = this.actions[i]
      this.actions[i] = a
      this.changedAt[i] = now
      this.dirty.push(i)
      changed++
    }
    return changed
  }

  /** Replace the whole grid without animation (e.g. `GET /runs/{id}/grid`). */
  load(actions: Uint8Array): void {
    this.ensure(actions.length)
    this.actions.set(actions)
    this.prev.set(actions)
    this.recount()
    this.changedAt.fill(-Infinity)
    this.dirty = []
    this.fullDirty = true
  }

  clear(): void {
    this.actions.fill(0)
    this.prev.fill(0)
    this.recount()
    this.changedAt.fill(-Infinity)
    this.dirty = []
    this.fullDirty = true
  }

  /** Hand the renderer the cells changed since the last call. */
  drainDirty(): number[] {
    const d = this.dirty
    this.dirty = []
    return d
  }

  private recount(): void {
    this.tally.fill(0)
    for (let i = 0; i < this.actions.length; i++) this.tally[this.actions[i]]++
  }

  counts(): [number, number, number, number, number] {
    return Array.from(this.tally) as [number, number, number, number, number]
  }
}
