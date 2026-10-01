import { formatRating, ratingValue } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface RailMarks {
  raw: number
  adjusted: number
  ci?: [number, number] | null
  platform?: number | null
  platformCi?: [number, number] | null
  /** a reference level (e.g. the game's rating before the bomb), drawn as a dashed tick */
  reference?: number | null
  referenceLabel?: string
}

/**
 * The three ratings on one scale. Raw is a bare tick, the engine's adjusted rating a
 * filled dot on its CI band, the platform-policy rating a diamond on its own band. The
 * scale zooms to the marks (at least a 20-point window) and states its ends.
 */
export function RatingRail({ scale, marks, size = 'md', className }: { scale: string; marks: RailMarks; size?: 'sm' | 'md'; className?: string }) {
  const { raw, adjusted, ci, platform, platformCi, reference } = marks
  const isPct = !/^1-\d+$/.test(scale)
  const all = [raw, adjusted, platform, reference, ...(ci ?? []), ...(platformCi ?? [])]
    .filter((v): v is number => v != null)
    .map((v) => ratingValue(v, scale))
  const step = isPct ? 5 : 0.25
  const minSpan = isPct ? 20 : 1
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  const pad = Math.max((minSpan - (hi - lo)) / 2, step)
  lo = Math.max(isPct ? 0 : 1, Math.floor((lo - pad) / step) * step)
  hi = Math.min(isPct ? 100 : Number(scale.split('-')[1]), Math.ceil((hi + pad) / step) * step)
  const pos = (v: number) => `${((ratingValue(v, scale) - lo) / (hi - lo || 1)) * 100}%`
  const ticks: number[] = []
  const tickStep = isPct ? (hi - lo > 40 ? 10 : 5) : step
  for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi + 1e-9; t += tickStep) ticks.push(t)
  const md = size === 'md'
  const band = (r: [number, number], cls: string, top: string) => (
    <div
      className={cn('absolute h-1.5 -translate-y-1/2 rounded-full', cls)}
      style={{ left: pos(r[0]), width: `calc(${pos(r[1])} - ${pos(r[0])})`, top }}
    />
  )
  return (
    <figure className={cn('w-full', className)} aria-label={`Raw ${formatRating(raw, scale)}, adjusted ${formatRating(adjusted, scale)}${platform != null ? `, platform policy ${formatRating(platform, scale)}` : ''}`}>
      <div className={cn('relative', md ? 'h-14' : 'h-8')}>
        {/* the scale */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {md &&
          ticks.map((t) => (
            <div
              key={t}
              className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-border"
              style={{ left: `${((t - lo) / (hi - lo || 1)) * 100}%` }}
            />
          ))}
        {reference != null && (
          <div
            className="absolute inset-y-1 w-0 -translate-x-1/2 border-l border-dashed border-muted-foreground/70"
            style={{ left: pos(reference) }}
            title={marks.referenceLabel ?? 'Reference'}
          />
        )}
        {ci && band(ci, 'bg-foreground/30', md ? '38%' : '40%')}
        {platformCi && band(platformCi, 'bg-foreground/15 ring-1 ring-foreground/25 ring-inset', md ? '64%' : '62%')}
        <div
          className={cn('absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-muted-foreground', md ? 'h-6' : 'h-4')}
          style={{ left: pos(raw) }}
          title={`Raw ${formatRating(raw, scale)}`}
        />
        {platform != null && (
          <div
            className={cn(
              'absolute -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-foreground/75 bg-background',
              md ? 'size-3' : 'size-2.5',
            )}
            style={{ left: pos(platform), top: md ? '64%' : '62%' }}
            title={`Platform policy ${formatRating(platform, scale)}`}
          />
        )}
        <div
          className={cn(
            'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground',
            md ? 'size-3.5' : 'size-3',
          )}
          style={{ left: pos(adjusted), top: md ? '38%' : '40%' }}
          title={`Integrity-adjusted ${formatRating(adjusted, scale)}`}
        />
      </div>
      {md && (
        <div className="num relative h-4 text-[10px] text-muted-foreground" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - lo) / (hi - lo || 1)) * 100}%` }}>
              {isPct ? `${t}%` : t.toFixed(2)}
            </span>
          ))}
        </div>
      )}
    </figure>
  )
}

/** Key for the rail's marks, so the shapes are never the only cue. */
export function RailLegend({ platform = true, reference }: { platform?: boolean; reference?: string }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-0.5 bg-muted-foreground" aria-hidden /> Raw
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-foreground" aria-hidden /> Integrity-adjusted, 95% CI
      </li>
      {platform && (
        <li className="flex items-center gap-1.5">
          <span className="size-2 rotate-45 border-2 border-foreground/75 bg-background" aria-hidden /> Platform policy
        </li>
      )}
      {reference && (
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-0 border-l border-dashed border-muted-foreground" aria-hidden /> {reference}
        </li>
      )}
    </ul>
  )
}
