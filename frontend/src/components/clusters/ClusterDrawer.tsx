import { useQuery } from '@tanstack/react-query'
import { TableProperties } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Swatch } from '@/components/live/ActionChip'
import { ReasonList } from '@/components/shared/ReasonChip'
import { buttonVariants } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ClusterDetail, RunOut } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatHour, formatInt, reviewText, snippet, verdictWords } from '@/lib/format'
import { FACTORS, KIND_LABEL } from '@/lib/methodology'
import { ACTION_LABELS, type ActionName } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { useViewStore } from '@/state/viewStore'

const ORDER: ActionName[] = ['KEEP', 'DOWNWEIGHT', 'FLAG', 'EXCLUDE']
const BG: Record<ActionName, string> = {
  PENDING: 'bg-action-pending',
  KEEP: 'bg-action-keep',
  DOWNWEIGHT: 'bg-action-downweight',
  FLAG: 'bg-action-flag',
  EXCLUDE: 'bg-action-exclude',
}

/** Why a group of reviews looks coordinated: the factors, the timing, the phrases, the members. */
export function ClusterDrawer({ runId, scale }: { runId: string; scale: string }) {
  const cid = useViewStore((s) => s.openCid)
  const source = useDataSource()
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => source.getRun(runId) })
  const q = useQuery({
    queryKey: ['cluster', runId, cid, 'detail'],
    queryFn: () => source.getCluster(runId, cid!, 40),
    enabled: cid != null,
    staleTime: Infinity,
  })
  const c = q.data?.cluster_id === cid ? q.data : null
  return (
    <Sheet open={cid != null} onOpenChange={(open) => !open && useViewStore.getState().openCluster(null)}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-[520px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-sm">
            {c ? KIND_LABEL[c.kind] : 'Cluster'} <span className="num font-mono text-xs text-muted-foreground">#{cid}</span>
          </SheetTitle>
          <SheetDescription className="num text-xs">
            {c ? `${formatInt(c.size)} reviews${c.t_start ? ` · ${formatHour(c.t_start)}` : ''}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>
        {c && run.data ? (
          <ClusterBody c={c} run={run.data} runId={runId} scale={scale} />
        ) : q.isError ? (
          <p className="p-4 text-sm text-muted-foreground">Could not load this cluster: {q.error.message}</p>
        ) : (
          <div className="h-48 animate-pulse bg-muted/40" />
        )}
      </SheetContent>
    </Sheet>
  )
}

function ClusterBody({ c, run, runId, scale }: { c: ClusterDetail; run: RunOut; runId: string; scale: string }) {
  const t = run.config.thresholds
  const over = c.suspicion > t.cluster_penalty_threshold
  const eligible = c.size >= t.min_penalty_cluster_size
  const floor = run.config.suspicion?.factor_floor ?? 0.02
  return (
    <div className="divide-y divide-border">
      <section className="p-4">
        <div className="flex items-baseline gap-3">
          <span className="num text-3xl font-semibold tracking-tight">{c.suspicion.toFixed(2)}</span>
          <span className="text-xs text-muted-foreground">suspicion</span>
          <span className={cn('ml-auto text-xs font-medium', over && eligible ? 'text-foreground' : 'text-muted-foreground')}>
            {over && eligible
              ? `Penalised: members × (1 − ${t.cluster_penalty_strength} × ${c.suspicion.toFixed(2)})`
              : over
                ? `Under ${t.min_penalty_cluster_size} reviews: shown, not penalised`
                : `Below the ${t.cluster_penalty_threshold} threshold: no penalty`}
          </span>
        </div>
        <div className="relative mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
          <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/80" style={{ width: `${Math.min(1, c.suspicion) * 100}%` }} />
          <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${t.cluster_penalty_threshold * 100}%` }} />
        </div>
        {c.caption && <p className="mt-3 text-[13px] leading-relaxed text-pretty">{c.caption}</p>}
      </section>

      <section className="p-4">
        <h3 className="mb-2.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Suspicion factors</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
          Suspicion is the weighted geometric mean of these: one factor near zero pulls it down, so a group needs several kinds of evidence at once.
        </p>
        <ul className="space-y-2">
          {Object.entries(c.factors).map(([k, v]) => (
            <li key={k} className="text-xs" title={FACTORS[k]?.short}>
              <div className="flex items-baseline justify-between">
                <span>{FACTORS[k]?.label ?? k}</span>
                <span className="num font-mono text-[11px]">{v == null ? '—' : v.toFixed(2)}</span>
              </div>
              <div className="relative mt-1 h-1 rounded-full bg-muted" aria-hidden>
                {v != null && (
                  <div
                    className={cn('absolute inset-y-0 left-0 rounded-full', v <= floor + 1e-6 ? 'bg-muted-foreground/40' : 'bg-foreground/70')}
                    style={{ width: `${Math.max(v, 0.01) * 100}%` }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
        {c.window && typeof c.window.hours === 'number' && (
          <p className="num mt-3 text-[11px] text-muted-foreground">
            Densest window: {String(c.window.count)} reviews within {c.window.hours < 1 ? `${c.window.hours * 60} min` : `${c.window.hours} h`}; random same-size groups
            from this corpus average {Number(c.window.expected).toFixed(1)}.
          </p>
        )}
      </section>

      {c.hourly.length > 1 && (
        <section className="p-4">
          <h3 className="mb-2.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Members per hour</h3>
          <HourlyBars hourly={c.hourly as { hour: string; count: number }[]} />
        </section>
      )}

      <section className="p-4">
        <h3 className="mb-2.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Decisions on members</h3>
        <ActionBar actions={c.actions} total={c.size} />
        {c.top_phrases.length > 0 && (
          <>
            <h3 className="mt-4 mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Distinctive phrases</h3>
            <ul className="flex flex-wrap gap-1">
              {c.top_phrases.slice(0, 10).map((p) => (
                <li key={p} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px]">
                  {p}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Members <span className="num tracking-normal normal-case">· {Math.min(c.sample.length, c.size)} of {formatInt(c.size)}</span>
          </h3>
          <Link
            to={`/runs/${runId}/reviews?cluster=${c.cluster_id}`}
            onClick={() => useViewStore.getState().openCluster(null)}
            className={buttonVariants({ variant: 'outline', size: 'xs' })}
          >
            <TableProperties />
            All in the table
          </Link>
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {c.sample.map((m) => (
            <li key={m.review_id}>
              <button
                type="button"
                onClick={() => useViewStore.getState().inspect(m.review_id)}
                className="w-full px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {m.action && <Swatch action={m.action as ActionName} />}
                  <span className="num font-mono">#{m.review_id}</span>
                  <span>{verdictWords(m.rating_norm, null, scale)}</span>
                  {m.created_at && <span className="num ml-auto">{formatHour(m.created_at)}</span>}
                </div>
                <p className="mt-0.5 text-xs leading-snug">
                  <Highlight text={snippet(reviewText(m.text), 160)} phrases={c.top_phrases} />
                </p>
                {m.reasons.length > 0 && <ReasonList codes={m.reasons} className="pointer-events-none mt-1" />}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Mark the cluster's distinctive phrases inside a member's text. */
function Highlight({ text, phrases }: { text: string; phrases: string[] }) {
  const terms = [...phrases].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!terms.length) return <>{text}</>
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rx = new RegExp(`(${terms.map(escape).join('|')})`, 'gi')
  return (
    <>
      {text.split(rx).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[2px] bg-foreground/15 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

function HourlyBars({ hourly }: { hourly: { hour: string; count: number }[] }) {
  const t0 = Date.parse(hourly[0].hour)
  const t1 = Date.parse(hourly[hourly.length - 1].hour)
  const span = Math.max(1, Math.round((t1 - t0) / 3_600_000) + 1)
  const max = Math.max(...hourly.map((h) => h.count))
  const W = 100
  const bw = W / span
  return (
    <figure>
      <svg viewBox={`0 0 ${W} 40`} preserveAspectRatio="none" className="h-16 w-full rounded-sm bg-instrument" role="img" aria-label="Members per hour">
        {hourly.map((h) => {
          const x = ((Date.parse(h.hour) - t0) / 3_600_000) * bw
          const ht = (h.count / max) * 36
          return <rect key={h.hour} x={x} y={40 - ht} width={Math.max(bw * 0.8, 0.4)} height={ht} className="fill-instrument-ink" />
        })}
      </svg>
      <figcaption className="num mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatHour(hourly[0].hour)}</span>
        <span>peak {max}/h</span>
        <span>{formatHour(hourly[hourly.length - 1].hour)}</span>
      </figcaption>
    </figure>
  )
}

export function ActionBar({ actions, total }: { actions: Record<string, number>; total: number }) {
  const sum = ORDER.reduce((s, a) => s + (actions[a] ?? 0), 0) || total || 1
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        {ORDER.map((a) => (actions[a] ? <div key={a} className={BG[a]} style={{ width: `${(actions[a] / sum) * 100}%` }} /> : null))}
      </div>
      <ul className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {ORDER.filter((a) => actions[a]).map((a) => (
          <li key={a} className="flex items-center gap-1.5">
            <Swatch action={a} />
            {ACTION_LABELS[a]} <span className="text-muted-foreground">{formatInt(actions[a])}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
