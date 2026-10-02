import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ActionBar } from '@/components/clusters/ClusterDrawer'
import { Drilldowns } from '@/components/shared/Drilldowns'
import { RailLegend, RatingRail } from '@/components/shared/RatingRail'
import { ReasonChip } from '@/components/shared/ReasonChip'
import { RunHeader } from '@/components/shared/RunHeader'
import { buttonVariants } from '@/components/ui/button'
import type { RunOut, RunScores, RunSummary } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatDelta, formatHour, formatInt, formatRating, formatRatingRange, formatUsd, ratingValue } from '@/lib/format'
import { reasonLabel } from '@/lib/methodology'
import { actionName } from '@/lib/palette'
import { waterfall, type WaterfallStep } from '@/lib/scores'
import { cn } from '@/lib/utils'

export function ResultsPage() {
  const { runId = '' } = useParams()
  const source = useDataSource()
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => source.getRun(runId) })
  const datasetId = run.data?.dataset_id
  const dataset = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => source.getDataset(datasetId!),
    enabled: !!datasetId,
    staleTime: Infinity,
  })
  const done = run.data?.status === 'done'
  const scores = useQuery({ queryKey: ['scores', runId], queryFn: () => source.getScores(runId), enabled: done, staleTime: Infinity })
  const scale = dataset.data?.rating_scale ?? 'binary'
  const s = run.data?.summary

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <RunHeader runId={runId} />
      {run.isError ? (
        <p className="p-6 text-sm">Run {runId} could not be loaded: {run.error.message}</p>
      ) : !run.data ? (
        <div className="mx-auto max-w-6xl p-6">
          <div className="h-48 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : !done || !s ? (
        <p className="p-6 text-sm text-muted-foreground">
          Results appear when the run is done.{' '}
          <Link to={`/runs/${runId}`} className="underline underline-offset-4">
            Watch it live
          </Link>
          .
        </p>
      ) : (
        <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6">
          <ThreeRatings s={s} scale={scale} />
          <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Waterfall scores={scores.data} s={s} scale={scale} pending={scores.isPending} />
            <PlatformRemovals s={s} scale={scale} />
          </div>
          <Methodology run={run.data} s={s} exportUrl={(f) => source.exportUrl(runId, f)} />
        </main>
      )}
      <Drilldowns runId={runId} scale={scale} />
    </div>
  )
}

function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-[11px] font-medium tracking-wider text-muted-foreground uppercase', className)}>{children}</h2>
}

function ThreeRatings({ s, scale }: { s: RunSummary; scale: string }) {
  const p = s.platform
  const platformName = scale === 'binary' ? 'Steam policy' : 'Platform policy'
  return (
    <section aria-label="Three ratings" className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-[1fr_1.4fr_1fr] sm:items-end">
        <Figure
          label="Raw"
          value={formatRating(s.raw, scale)}
          sub={s.steam_label_raw ?? undefined}
          note="Every review as the platform shows it today."
        />
        <Figure
          label="Integrity-adjusted"
          value={formatRating(s.adjusted, scale)}
          hero
          sub={`95% CI ${formatRatingRange(s.ci, scale)} · ${formatDelta(s.raw, s.adjusted, scale)} vs raw`}
          note="This engine: each review weighted by its integrity, coordinated groups penalised."
        />
        {p?.rating != null ? (
          <Figure
            label={platformName}
            value={formatRating(p.rating, scale)}
            sub={`95% CI ${formatRatingRange(p.ci, scale)} · ${formatDelta(s.raw, p.rating, scale)} vs raw`}
            note="Steam's published rules applied to the same reviews: key activations and whole off-topic bomb windows left out."
          />
        ) : (
          <Figure label={platformName} value="—" note="Not computed for this run." />
        )}
      </div>
      <div className="rounded-lg bg-card p-4 ring-1 ring-border">
        <RatingRail scale={scale} marks={{ raw: s.raw, adjusted: s.adjusted, ci: s.ci, platform: p?.rating, platformCi: p?.ci }} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <RailLegend platform={p?.rating != null} />
          <p className="num text-[11px] text-muted-foreground">
            {formatInt(s.n_reviews)} reviews · effective n {formatInt(s.n_eff)}
          </p>
        </div>
      </div>
      <ActionBar actions={s.counts} total={s.n_reviews} />
    </section>
  )
}

function Figure({ label, value, sub, note, hero }: { label: string; value: string; sub?: string; note: string; hero?: boolean }) {
  return (
    <div className={cn(hero && 'sm:order-none')}>
      <Label>{label}</Label>
      <p className={cn('num mt-1 font-semibold tracking-tight', hero ? 'text-5xl' : 'text-3xl text-foreground/85')}>{value}</p>
      {sub && <p className="num mt-1 text-xs text-muted-foreground">{sub}</p>}
      <p className="mt-2 max-w-xs text-xs leading-relaxed text-pretty text-muted-foreground">{note}</p>
    </div>
  )
}

const BAR: Record<string, string> = {
  KEEP: 'bg-action-keep',
  DOWNWEIGHT: 'bg-action-downweight',
  FLAG: 'bg-action-flag',
  EXCLUDE: 'bg-action-exclude',
  PENDING: 'bg-action-pending',
}

function Waterfall({ scores, s, scale, pending }: { scores?: RunScores; s: RunSummary; scale: string; pending: boolean }) {
  const steps = useMemo(() => (scores ? waterfall(scores) : []), [scores])
  if (!scores) {
    return (
      <section aria-label="From raw to adjusted" className="space-y-3">
        <Label>From raw to adjusted</Label>
        {pending ? <div className="h-48 animate-pulse rounded-lg bg-muted" /> : <p className="text-xs text-muted-foreground">Scores unavailable.</p>}
      </section>
    )
  }
  const vals = [s.raw, s.adjusted, ...steps.map((x) => x.after)].map((v) => ratingValue(v, scale))
  const span = Math.max(Math.max(...vals) - Math.min(...vals), 2)
  const lo = Math.min(...vals) - span * 0.15
  const hi = Math.max(...vals) + span * 0.15
  const x = (v: number) => ((ratingValue(v, scale) - lo) / (hi - lo)) * 100
  const rows = steps.map((st, i) => ({ st, from: i ? steps[i - 1].after : s.raw }))
  return (
    <section aria-label="From raw to adjusted" className="space-y-3">
      <Label>From raw to adjusted</Label>
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        Each row applies the weights of the reviews whose main reason is that rule. Removing negatives moves the rating up; removing positives moves it down.
      </p>
      <ol className="space-y-1">
        <WaterRow label={<span className="font-medium">Raw</span>} right={formatRating(s.raw, scale)}>
          <div className="absolute inset-y-0 w-0.5 bg-muted-foreground" style={{ left: `${x(s.raw)}%` }} />
        </WaterRow>
        {rows.map(({ st, from }) => (
          <WaterRow
            key={st.code}
            label={st.code === 'OTHER' ? <span className="text-xs">Other</span> : <ReasonChip code={st.code} />}
            meta={`${formatInt(st.reviews)}`}
            right={formatDelta(from, st.after, scale)}
            title={`${reasonLabel(st.code)}: ${formatInt(st.reviews)} reviews, mostly ${actionName(st.action).toLowerCase()}`}
          >
            <StepBar from={x(from)} to={x(st.after)} st={st} />
          </WaterRow>
        ))}
        <WaterRow label={<span className="font-medium">Integrity-adjusted</span>} right={<span className="font-semibold">{formatRating(s.adjusted, scale)}</span>}>
          <div className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${x(s.adjusted)}%` }} />
        </WaterRow>
      </ol>
      <p className="num text-[10px] text-muted-foreground">
        Axis {lo.toFixed(1)}–{hi.toFixed(1)}
        {/^1-\d+$/.test(scale) ? '' : '%'} · bar colour = the action most of those reviews got
      </p>
    </section>
  )
}

function StepBar({ from, to, st }: { from: number; to: number; st: WaterfallStep }) {
  const left = Math.min(from, to)
  const width = Math.max(Math.abs(to - from), 0.4)
  return <div className={cn('absolute inset-y-1 rounded-[2px]', BAR[actionName(st.action)])} style={{ left: `${left}%`, width: `${width}%` }} />
}

function WaterRow({ label, meta, right, title, children }: { label: ReactNode; meta?: string; right: ReactNode; title?: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[10rem_3rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-xs" title={title}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="num text-right text-[11px] text-muted-foreground">{meta}</span>
      <div className="relative h-5 rounded-sm bg-muted/50">{children}</div>
      <span className="num text-right font-mono text-[11px]">{right}</span>
    </li>
  )
}

function PlatformRemovals({ s, scale }: { s: RunSummary; scale: string }) {
  const p = s.platform
  const name = scale === 'binary' ? 'Steam policy' : 'Platform policy'
  if (!p) return null
  return (
    <section aria-label={`${name}: what was left out`} className="space-y-3">
      <Label>{name}: what was left out</Label>
      <dl className="num grid grid-cols-[1fr_auto] gap-y-1.5 text-xs">
        <dt>Key activations (not bought on Steam)</dt>
        <dd className="text-right font-mono">{formatInt(p.key_activations_removed)}</dd>
        <dt>Reviews in removed bomb windows</dt>
        <dd className="text-right font-mono">{formatInt(p.windows.reduce((a, w) => a + w.reviews_removed, 0))}</dd>
        <dt className="font-medium">Counted</dt>
        <dd className="text-right font-mono font-medium">
          {formatInt(p.counted)} <span className="font-normal text-muted-foreground">of {formatInt(s.n_reviews)}</span>
        </dd>
      </dl>
      {p.windows.length > 0 ? (
        <table className="num w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="py-1 font-normal">Window (UTC)</th>
              <th className="py-1 text-right font-normal">Removed</th>
              <th className="py-1 text-right font-normal" title="Share of judged negatives whose verdict is not based on playing">
                Off-topic
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {p.windows.map((w) => (
              <tr key={w.start}>
                <td className="py-1.5">
                  {formatHour(w.start).replace(' UTC', '')} → {formatHour(w.end).replace(' UTC', '')}
                </td>
                <td className="py-1.5 text-right font-mono">{formatInt(w.reviews_removed)}</td>
                <td className="py-1.5 text-right font-mono">{Math.round(w.offtopic_share * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted-foreground">No negative spike here is mostly off-topic, so no window is removed.</p>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A window is removed whole, positives included, when more than half of its judged negatives have a verdict not based on playing the game (question{' '}
        <code className="font-mono">verdict_basis</code>, standing in for Valve's manual review).{' '}
        <Link to="/help#platform-policy" className="underline underline-offset-2">
          How this emulates Steam
        </Link>
      </p>
    </section>
  )
}

function Methodology({ run, s, exportUrl }: { run: RunOut; s: RunSummary; exportUrl: (f: 'csv' | 'json') => string | null }) {
  const t = run.config.thresholds
  const ds = useDataSource()
  const sourceId = run.backend === 'cached' ? run.config.reuse_judgments_from : null
  const src = useQuery({ queryKey: ['run', sourceId], queryFn: () => ds.getRun(sourceId!), enabled: !!sourceId, staleTime: Infinity })
  const reused = src.data
  const csv = exportUrl('csv')
  const json = exportUrl('json')
  const rows: [string, ReactNode][] = [
    [
      'Backend',
      reused
        ? `${reused.backend}${reused.model_version ? ` · ${reused.model_version}` : ''} answers, reused; rules re-applied`
        : `${run.backend}${s.model_version ? ` · ${s.model_version}` : ''}`,
    ],
    ['Question set', run.config.question_set],
    ['Calls per review', `${run.config.samples_per_review}`],
    ['Downweight line', `${t.downweight_below} → weight ${run.config.weights.DOWNWEIGHT}`],
    ['Weights', `off-game ${t.w_offgame} · contradiction ${t.w_contradiction} · spam ${t.w_spam} · copied ${t.w_templated}`],
    ['Brevity', t.w_informativeness === 0 && t.w_rating_support === 0 ? 'not penalised' : `informativeness ${t.w_informativeness}`],
    ['Cluster penalty', `above ${t.cluster_penalty_threshold}, ≥ ${t.min_penalty_cluster_size} reviews`],
    ['Later copies', `${t.duplicate_action.toLowerCase()}; inside a suspicious burst ${t.duplicate_in_burst_action.toLowerCase()}`],
    ['Confidence interval', `bootstrap, ${formatInt(run.config.bootstrap_resamples)} resamples`],
    [
      'Cost',
      reused
        ? `${formatUsd(reused.cost_usd)} for the original run · ${formatInt(reused.tokens_in)} tokens (this re-run: $0)`
        : `${formatUsd(run.cost_usd)}${run.tokens_in ? ` · ${formatInt(run.tokens_in)} tokens` : ''}`,
    ],
  ]
  return (
    <section aria-label="Methodology" className="space-y-3 rounded-lg bg-card p-4 ring-1 ring-border">
      <Label>Method</Label>
      <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        <li>Not the “true” rating: the rating under this documented method.</li>
        <li>English-language reviews only.</li>
        <li>Reviews as they stand today: Steam lets people edit their verdicts later.</li>
        <li>System One is not deterministic: about 1% of decisions flip on a repeat run (measured: 62 of 4,999).</li>
      </ul>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {csv && (
          <a href={csv} download className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Download />
            Decisions CSV
          </a>
        )}
        {json && (
          <a href={json} download className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Download />
            Run JSON
          </a>
        )}
        <Link to="/help" className="ml-auto text-xs underline-offset-4 hover:underline">
          How the ratings work
        </Link>
      </div>
      <p className="text-[10px] text-muted-foreground">Exports carry review text and decisions, never reviewer identifiers.</p>
    </section>
  )
}
