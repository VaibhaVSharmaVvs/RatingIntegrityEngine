import { formatDuration, formatInt, formatPct, formatRate, formatUsd } from '@/lib/format'
import { ACTION_LABELS, type ActionName } from '@/lib/palette'
import { STEAM_LABELS, steamTally } from '@/lib/steamLens'
import { useRunStore } from '@/state/runStore'
import { useViewStore } from '@/state/viewStore'
import { SteamSwatch, Swatch } from './ActionChip'

/** Processed / total with a hairline progress bar, then throughput, spend and elapsed time. */
/** A cached run replays another run's System One answers; its own pace and spend are not the real ones. */
export interface ReusedFrom {
  runId: string
  backend: string
  costUsd: number
  reviewsPerS: number | null
  elapsedS: number | null
}

export function RunCounters({ reusedFrom }: { reusedFrom?: ReusedFrom | null } = {}) {
  const c = useRunStore((s) => s.counters)
  const tally = useRunStore((s) => s.tally)
  const total = useRunStore((s) => s.counters?.total ?? s.grid.size)
  // counts what is on screen, so it ticks with the grid rather than per batch
  const processed = total - (tally[0] ?? 0)
  const share = total ? processed / total : 0
  return (
    <section aria-label="Progress" className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="num text-sm">
          <span className="font-semibold">{formatInt(processed)}</span>
          <span className="text-muted-foreground"> / {formatInt(total)} decided</span>
        </span>
        <span className="num text-xs text-muted-foreground">{formatPct(processed, total, 0)}</span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={processed}
        aria-label="Reviews decided"
      >
        <div className="h-full origin-left bg-foreground transition-transform duration-200" style={{ transform: `scaleX(${share})` }} />
      </div>
      <dl className="num grid grid-cols-3 gap-2 text-xs">
        <Stat label="Reviews/s" value={formatRate(reusedFrom ? reusedFrom.reviewsPerS : c?.rps)} />
        <Stat label="Spent" value={formatUsd(reusedFrom ? reusedFrom.costUsd : c?.cost_usd)} />
        <Stat label="Elapsed" value={formatDuration(reusedFrom ? reusedFrom.elapsedS : c?.elapsed_s)} />
      </dl>
      {reusedFrom && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Replays the {reusedFrom.backend === 'jev' ? 'Jev' : reusedFrom.backend} answers of the original run; the integrity rules are re-applied at no
          cost. Speed and spend are the original run’s.
        </p>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  )
}

const LEGEND: { code: 1 | 2 | 3 | 4; action: ActionName }[] = [
  { code: 1, action: 'KEEP' },
  { code: 2, action: 'DOWNWEIGHT' },
  { code: 3, action: 'FLAG' },
  { code: 4, action: 'EXCLUDE' },
]

/** The grid's legend doubles as the per-action counters; in the Steam view, per Steam class. */
export function ActionLegend() {
  const steam = useViewStore((s) => (s.lens === 'steam' ? s.steam : null))
  return steam ? <SteamLegend classes={steam} /> : <IntegrityLegend />
}

function IntegrityLegend() {
  const tally = useRunStore((s) => s.tally)
  const total = useRunStore((s) => s.counters?.total ?? s.grid.size)
  return (
    <ul id="grid-legend" className={LEGEND_ROW} aria-label="Actions">
      {LEGEND.map(({ code, action }) => (
        <li key={code} className="flex items-center gap-1.5">
          <Swatch action={action} />
          <span className="text-muted-foreground">{ACTION_LABELS[action]}</span>
          <span className="font-medium">{formatInt(tally[code] ?? 0)}</span>
          <span className="text-muted-foreground">{formatPct(tally[code] ?? 0, total)}</span>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <Swatch action="PENDING" />
        <span className="text-muted-foreground">Pending</span>
        <span className="font-medium">{formatInt(tally[0] ?? total)}</span>
      </li>
    </ul>
  )
}

const LEGEND_ROW = 'num flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'

const STEAM_LEGEND = [
  [1, 'COUNTS'],
  [2, 'WINDOW'],
  [3, 'KEY'],
] as const

function SteamLegend({ classes }: { classes: Uint8Array }) {
  useRunStore((s) => s.gridVersion) // recount as cells are revealed
  const grid = useRunStore.getState().grid
  const total = useRunStore((s) => s.counters?.total ?? s.grid.size)
  const tally = steamTally(grid.actions, classes, total)
  return (
    <ul id="grid-legend" className={LEGEND_ROW} aria-label="Steam policy">
      {STEAM_LEGEND.map(([code, cls]) => (
        <li key={cls} className="flex items-center gap-1.5">
          <SteamSwatch cls={cls} />
          <span className="text-muted-foreground">{STEAM_LABELS[cls]}</span>
          <span className="font-medium">{formatInt(tally[code])}</span>
          <span className="text-muted-foreground">{formatPct(tally[code], total)}</span>
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <Swatch action="PENDING" />
        <span className="text-muted-foreground">Pending</span>
        <span className="font-medium">{formatInt(tally[0])}</span>
      </li>
    </ul>
  )
}
