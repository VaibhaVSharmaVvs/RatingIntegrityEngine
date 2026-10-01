import { formatDuration, formatInt, formatPct, formatRate, formatUsd } from '@/lib/format'
import { ACTION_LABELS, type ActionName } from '@/lib/palette'
import { useRunStore } from '@/state/runStore'
import { Swatch } from './ActionChip'

/** Processed / total with a hairline progress bar, then throughput, spend and elapsed time. */
export function RunCounters() {
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
        <Stat label="Reviews/s" value={formatRate(c?.rps)} />
        <Stat label="Spent" value={formatUsd(c?.cost_usd)} />
        <Stat label="Elapsed" value={formatDuration(c?.elapsed_s)} />
      </dl>
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

/** The grid's legend doubles as the per-action counters. */
export function ActionLegend() {
  const tally = useRunStore((s) => s.tally)
  const total = useRunStore((s) => s.counters?.total ?? s.grid.size)
  return (
    <ul id="grid-legend" className="num flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Actions">
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
