import { formatDelta, formatInt, formatRating, formatRatingRange, ratingUnit, ratingValue } from '@/lib/format'
import { useTween } from '@/lib/useTween'
import { useRunStore, type RatingPoint } from '@/state/runStore'

/**
 * RAW vs INTEGRITY-ADJUSTED, live. The whisker track zooms to the values (at least a
 * 10-point window) so a 2-point CI is still visible; its end labels state the window.
 */
export function RatingTicker({ scale }: { scale: string }) {
  const rating = useRunStore((s) => s.rating)
  const trail = useRunStore((s) => s.ratingTrail)
  const summary = useRunStore((s) => s.summary)
  const total = useRunStore((s) => s.counters?.total ?? s.grid.size)
  // The number counts toward each new estimate instead of jumping.
  const adjusted = useTween(rating?.adjusted ?? null)
  const raw = useTween(rating?.raw ?? null)
  const platform = useTween(rating?.platform ?? null)
  const platformLabel = scale === 'binary' ? 'Steam policy' : 'Platform policy'

  if (!rating || adjusted == null || raw == null) {
    return (
      <section aria-label="Rating" className="space-y-2">
        <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Integrity-adjusted rating</h2>
        <div className="h-9 w-32 animate-pulse rounded bg-muted" />
        <p className="text-xs text-muted-foreground">Appears once the first reviews are judged.</p>
      </section>
    )
  }

  const ci = rating.ci
  return (
    <section aria-label="Rating" className="space-y-3">
      <div>
        <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Integrity-adjusted rating</h2>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="num text-4xl font-semibold tracking-tight">{formatRating(adjusted, scale)}</span>
          <span className="text-sm text-muted-foreground">{ratingUnit(scale)}</span>
        </div>
        <div className="num mt-1 flex flex-wrap items-baseline gap-x-3 text-sm">
          <span className="text-muted-foreground">
            Raw <span className="font-medium text-foreground">{formatRating(raw, scale)}</span>
          </span>
          <span className="font-medium">{formatDelta(raw, adjusted, scale)}</span>
          {platform != null && (
            <span
              className="text-muted-foreground"
              title="The platform's own published rules applied to the same reviews: key activations and whole off-topic review-bomb windows are left out (Steam, 2016 and 2019)."
            >
              {platformLabel} <span className="font-medium text-foreground">{formatRating(platform, scale)}</span>
            </span>
          )}
        </div>
      </div>

      <Whisker raw={raw} adjusted={adjusted} platform={platform} ci={ci} scale={scale} />

      <dl className="num grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">95% CI</dt>
        <dd className="text-right">{ci ? formatRatingRange(ci, scale) : <span className="text-muted-foreground">at Decide</span>}</dd>
        {rating.platform_ci && (
          <>
            <dt className="text-muted-foreground">{platformLabel} 95% CI</dt>
            <dd className="text-right">{formatRatingRange(rating.platform_ci, scale)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Effective n</dt>
        <dd className="text-right">
          {formatInt(rating.n_eff)} <span className="text-muted-foreground">of {formatInt(total)}</span>
        </dd>
        {summary?.steam_label_adjusted && (
          <>
            <dt className="text-muted-foreground">Steam label</dt>
            <dd className="text-right">
              {summary.steam_label_raw === summary.steam_label_adjusted
                ? summary.steam_label_adjusted
                : `${summary.steam_label_raw} → ${summary.steam_label_adjusted}`}
            </dd>
          </>
        )}
      </dl>

      {trail.length > 2 && <Sparkline trail={trail} scale={scale} />}
      {!rating.final && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Live: all three ratings cover the reviews judged so far, in time order.
        </p>
      )}
    </section>
  )
}

function Whisker({
  raw,
  adjusted,
  platform,
  ci,
  scale,
}: {
  raw: number
  adjusted: number
  platform: number | null
  ci: [number, number] | null
  scale: string
}) {
  const vals = [raw, adjusted, ...(platform != null ? [platform] : []), ...(ci ?? [])].map((v) =>
    ratingValue(v, scale),
  )
  const isPct = !/^1-\d+$/.test(scale)
  const minSpan = isPct ? 10 : 0.5
  const [lo0, hi0] = [Math.min(...vals), Math.max(...vals)]
  const pad = Math.max((minSpan - (hi0 - lo0)) / 2, (hi0 - lo0) * 0.25)
  const lo = Math.floor(lo0 - pad)
  const hi = Math.ceil(hi0 + pad)
  const x = (v: number) => `${((ratingValue(v, scale) - lo) / (hi - lo || 1)) * 100}%`
  const unit = isPct ? '%' : ''
  return (
    <figure aria-label="Raw and adjusted rating with confidence interval" className="space-y-1">
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {ci && (
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/35"
            style={{ left: x(ci[0]), width: `calc(${x(ci[1])} - ${x(ci[0])})` }}
          />
        )}
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-muted-foreground"
          style={{ left: x(raw) }}
          title="Raw"
        />
        {platform != null && (
          <div
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-foreground/70 bg-background"
            style={{ left: x(platform) }}
            title="Platform policy"
          />
        )}
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: x(adjusted) }}
          title="Adjusted"
        />
      </div>
      <figcaption className="num flex justify-between text-[10px] text-muted-foreground">
        <span>
          {lo}
          {unit}
        </span>
        <span className="flex gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-0.5 bg-muted-foreground" /> raw
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-foreground" /> adjusted
          </span>
          {platform != null && (
            <span className="flex items-center gap-1">
              <span className="size-2 rotate-45 border-2 border-foreground/70 bg-background" /> platform
            </span>
          )}
          {ci && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full bg-foreground/35" /> 95% CI
            </span>
          )}
        </span>
        <span>
          {hi}
          {unit}
        </span>
      </figcaption>
    </figure>
  )
}

function Sparkline({ trail, scale }: { trail: RatingPoint[]; scale: string }) {
  const W = 100
  const H = 32
  const hasPlatform = trail.some((p) => p.platform != null)
  const ys = trail.flatMap((p) => [
    ratingValue(p.raw, scale),
    ratingValue(p.adjusted, scale),
    ...(p.platform != null ? [ratingValue(p.platform, scale)] : []),
  ])
  const [lo, hi] = [Math.min(...ys), Math.max(...ys)]
  const t0 = trail[0].t
  const span = trail[trail.length - 1].t - t0 || 1
  const path = (k: 'raw' | 'adjusted' | 'platform') =>
    trail
      .filter((p) => p[k] != null)
      .map((p, i) => {
        const px = ((p.t - t0) / span) * W
        const py = H - 2 - ((ratingValue(p[k] as number, scale) - lo) / (hi - lo || 1)) * (H - 4)
        return `${i ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`
      })
      .join('')
  return (
    <figure aria-label="Rating over the run" className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full overflow-visible">
        <path d={path('raw')} fill="none" className="stroke-muted-foreground/60" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hasPlatform && (
          <path
            d={path('platform')}
            fill="none"
            className="stroke-foreground/70"
            strokeWidth={1.5}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={path('adjusted')} fill="none" className="stroke-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="text-[10px] text-muted-foreground">
        Over the run: adjusted (solid), raw (faint){hasPlatform ? ', platform policy (dashed)' : ''}
      </figcaption>
    </figure>
  )
}
