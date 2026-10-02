import { useQuery } from '@tanstack/react-query'
import { Layers } from 'lucide-react'
import type { ReactNode } from 'react'
import { ActionChip } from '@/components/live/ActionChip'
import { ReasonList } from '@/components/shared/ReasonChip'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ReviewDetail, RunOut } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatHour, verdictWords } from '@/lib/format'
import { integrityLedger, type Answer } from '@/lib/ledger'
import { KIND_LABEL, QUESTIONS, questionOrder, reasonLabel } from '@/lib/methodology'
import type { ActionName } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { useViewStore } from '@/state/viewStore'

/** Everything the engine knows about one review, and the arithmetic behind its weight. */
export function ReviewInspector({ runId, scale }: { runId: string; scale: string }) {
  const id = useViewStore((s) => s.inspecting)
  const source = useDataSource()
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => source.getRun(runId) })
  const q = useQuery({
    queryKey: ['review', runId, id],
    queryFn: () => source.getReview(runId, id!),
    enabled: id != null,
    staleTime: 5_000,
  })
  const r = q.data?.review_id === id ? q.data : null
  return (
    <Sheet open={id != null} onOpenChange={(open) => !open && useViewStore.getState().inspect(null)}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-[520px]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="flex items-center gap-2 text-sm">
            {r?.action && <ActionChip action={r.action as ActionName} />}
            <span className="num font-mono text-xs text-muted-foreground">Review #{id}</span>
          </SheetTitle>
          <SheetDescription className="num text-xs">
            {r ? (
              <>
                {verdictWords(r.rating_norm, r.rating_raw, scale)}
                {r.created_at && ` · ${formatHour(r.created_at)}`}
                {r.meta?.edited && ' · edited later'}
              </>
            ) : (
              'Loading…'
            )}
          </SheetDescription>
        </SheetHeader>
        {r && run.data ? (
          <InspectorBody r={r} run={run.data} scale={scale} />
        ) : q.isError ? (
          <p className="p-4 text-sm text-muted-foreground">Could not load this review: {q.error.message}</p>
        ) : (
          <div className="space-y-2 p-4">
            {[40, 100, 90, 70].map((w) => (
              <div key={w} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function InspectorBody({ r, run, scale }: { r: ReviewDetail; run: RunOut; scale: string }) {
  const t = run.config.thresholds
  const weights = run.config.weights
  const s = r.signals
  return (
    <div className="divide-y divide-border">
      <Section>
        <p className="max-h-64 overflow-y-auto text-[13px] leading-relaxed text-pretty whitespace-pre-line">{r.text}</p>
        {r.reasons.length > 0 && <ReasonList codes={r.reasons} className="mt-3" />}
      </Section>

      <Section title="Integrity weight">
        <IntegrityReceipt r={r} run={run} />
        <p className="num mt-3 text-xs text-muted-foreground">
          Counts in the integrity-adjusted rating with weight{' '}
          <span className="font-medium text-foreground">{r.weight?.toFixed(2) ?? '—'}</span>
          {r.action && ` (${r.action.toLowerCase()}: ${weightFor(weights, r.action)})`}.
        </p>
      </Section>

      <Section title={scale === 'binary' ? 'Steam policy rating' : 'Platform policy rating'}>
        <p className="text-xs leading-relaxed">
          {r.counts_in_platform_rating == null ? (
            'Not computed for this run.'
          ) : r.counts_in_platform_rating ? (
            <>
              <span className="font-medium">Counts.</span> <span className="text-muted-foreground">Bought on Steam, outside every removed window.</span>
            </>
          ) : (
            <>
              <span className="font-medium">Left out</span>
              <span className="text-muted-foreground">
                {r.meta?.steam_purchase === false
                  ? ': a key activation (not bought on Steam). Steam has not counted these since 2016.'
                  : ': posted inside a negative spike whose negatives are mostly not about playing the game. Steam removes such windows whole (2019).'}
              </span>
            </>
          )}
        </p>
      </Section>

      <Section title="System One answers">
        <Answers answers={r.answers as Record<string, Answer>} thresholds={t} />
      </Section>

      <Section title="Deterministic signals">
        <ul className="flex flex-wrap gap-1.5 text-[11px]">
          {s?.duplicate_of != null && (
            <Signal strong>
              Later copy of{' '}
              <InspectLink id={s.duplicate_of} />
              {s.duplicate_score != null && <span className="num text-muted-foreground"> · Jaccard {s.duplicate_score.toFixed(2)}</span>}
            </Signal>
          )}
          {s?.nearest_review_id != null && s.nearest_cosine != null && s.nearest_cosine >= 0.8 && (
            <Signal>
              Closest in meaning <InspectLink id={s.nearest_review_id} />
              <span className="num text-muted-foreground"> · cos {s.nearest_cosine.toFixed(2)}</span>
            </Signal>
          )}
          {s?.model_note && <Signal strong>Addressed to the AI judging it</Signal>}
          {s && s.influence_hits.length > 0 && !s.model_note && <Signal>Claims its own legitimacy (removed before judging)</Signal>}
          {s?.has_promo && <Signal strong>Promo pattern{s.promo_hits.length ? `: ${s.promo_hits.slice(0, 2).join(', ')}` : ''}</Signal>}
          {s?.has_url && <Signal>Contains a link</Signal>}
          {r.meta?.steam_purchase === false && <Signal>Key activation</Signal>}
          {r.meta?.received_for_free && <Signal>Received for free</Signal>}
          {s?.low_playtime && <Signal>Low playtime</Signal>}
          {s?.single_review_account && <Signal>Single-review account</Signal>}
          {r.meta?.edited && <Signal>Edited {r.meta.updated_at ? formatHour(r.meta.updated_at) : 'later'}</Signal>}
          {s?.n_tokens != null && <Signal muted>{s.n_tokens} tokens</Signal>}
          {r.meta?.playtime_hours != null && <Signal muted>{r.meta.playtime_hours} h played at review</Signal>}
          {r.meta?.votes_up != null && <Signal muted>{r.meta.votes_up} found it helpful</Signal>}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Account signals never lower a single review's weight. They count only as a share inside a cluster.
        </p>
      </Section>

      {r.cluster_id != null && (
        <Section title="Cluster">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">
                {KIND_LABEL[r.cluster_kind ?? ''] ?? 'Cluster'} <span className="num font-mono text-muted-foreground">#{r.cluster_id}</span>
                {r.cluster_suspicion != null && (
                  <span className="num font-normal text-muted-foreground"> · suspicion {r.cluster_suspicion.toFixed(2)}</span>
                )}
              </p>
              {r.cluster_caption && <p className="mt-1 text-xs text-muted-foreground">{r.cluster_caption}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={() => useViewStore.getState().openCluster(r.cluster_id)}>
              <Layers />
              Open
            </Button>
          </div>
        </Section>
      )}
    </div>
  )
}

/** 1.00 − each weighted answer = base integrity, × cluster factor = final, against the threshold. */
function IntegrityReceipt({ r, run }: { r: ReviewDetail; run: RunOut }) {
  const t = run.config.thresholds
  const ledger = integrityLedger(r.answers, t, !!r.signals?.low_playtime)
  const base = r.base_integrity ?? r.integrity_score
  const final = r.integrity_score
  // The mirror should match the stored score; if it does not (heuristics run, older
  // question set) show only the stored numbers rather than an arithmetic that is off.
  const exact = ledger && base != null && Math.abs(ledger.score - base) < 0.01
  const lines = exact ? ledger.lines.filter((l) => l.contribution >= 0.005) : []
  const penalised = base != null && final != null && Math.abs(base - final) > 0.0005
  return (
    <div className="space-y-3">
      <Gauge value={final} threshold={t.downweight_below} />
      <table className="num w-full text-xs">
        <tbody>
          {exact && (
            <tr>
              <td className="py-0.5 text-muted-foreground">Start</td>
              <td />
              <td className="py-0.5 text-right font-mono">1.00</td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.code}>
              <td className="py-0.5">{reasonLabel(l.code)}</td>
              <td className="py-0.5 text-right font-mono text-[11px] text-muted-foreground">
                {l.weight.toFixed(2)} × {l.value.toFixed(2)}
              </td>
              <td className="py-0.5 text-right font-mono">−{l.contribution.toFixed(2)}</td>
            </tr>
          ))}
          {exact && lines.length === 0 && (
            <tr>
              <td colSpan={3} className="py-0.5 text-muted-foreground">
                No weighted answer takes anything off.
              </td>
            </tr>
          )}
          <tr className={cn(exact && 'border-t border-border')}>
            <td className="py-1 font-medium">Per-review integrity</td>
            <td />
            <td className="py-1 text-right font-mono font-medium">{base?.toFixed(2) ?? '—'}</td>
          </tr>
          {penalised && (
            <>
              <tr>
                <td className="py-0.5">Cluster penalty</td>
                <td className="py-0.5 text-right font-mono text-[11px] text-muted-foreground">
                  × (1 − {t.cluster_penalty_strength} × {r.cluster_suspicion?.toFixed(2)})
                </td>
                <td className="py-0.5 text-right font-mono">×{(final! / base!).toFixed(2)}</td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-1 font-medium">Final integrity</td>
                <td />
                <td className="py-1 text-right font-mono font-medium">{final!.toFixed(2)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      {!exact && ledger == null && (
        <p className="text-[11px] text-muted-foreground">This run has no System One answers; the score comes from heuristics.</p>
      )}
    </div>
  )
}

function Gauge({ value, threshold }: { value: number | null; threshold: number }) {
  if (value == null) return null
  const below = value < threshold
  return (
    <div>
      <div className="relative h-2 rounded-full bg-muted" aria-hidden>
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', below ? 'bg-action-downweight' : 'bg-action-keep')}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
        <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${threshold * 100}%` }} />
      </div>
      <p className="num mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>
          {value.toFixed(2)} {below ? 'is below' : 'clears'} the downweight line {threshold.toFixed(2)}
        </span>
        <span>0 – 1</span>
      </p>
    </div>
  )
}

function Answers({ answers, thresholds: t }: { answers: Record<string, Answer>; thresholds: RunOut['config']['thresholds'] }) {
  const ids = questionOrder(Object.keys(answers))
  if (ids.length === 0) return <p className="text-xs text-muted-foreground">No System One answers in this run.</p>
  return (
    <ul className="space-y-2.5">
      {ids.map((id) => {
        const a = answers[id]
        const info = QUESTIONS[id]
        // weight as configured for this run: e.g. informativeness carries none since option B
        const w = info?.weight ? Number((t as unknown as Record<string, number>)[info.weight] ?? 0) : 0
        const unsure = w > 0 && a.confidence != null && a.confidence < t.low_confidence
        return (
          <li key={id} className="text-xs">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{info?.label ?? id}</span>
              {w > 0 ? (
                <span className="num font-mono text-[10px] text-muted-foreground">weight {w.toFixed(2)}</span>
              ) : (
                <span className="text-[10px] text-muted-foreground">no weight</span>
              )}
              {a.confidence != null && (
                <span
                  className={cn('num ml-auto rounded-sm px-1 font-mono text-[10px]', unsure ? 'bg-action-flag/20 text-foreground' : 'text-muted-foreground')}
                  title="System One's confidence in this answer"
                >
                  conf {a.confidence.toFixed(2)}
                </span>
              )}
            </div>
            <AnswerValue a={a} />
          </li>
        )
      })}
    </ul>
  )
}

function AnswerValue({ a }: { a: Answer }) {
  if (a.noul != null) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <div className="relative h-1.5 flex-1 rounded-full bg-muted" aria-hidden>
          <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${a.noul * 100}%` }} />
        </div>
        <span className="num w-20 text-right font-mono text-[11px]">
          {a.noul.toFixed(2)} <span className="text-muted-foreground">{a.noul >= 0.5 ? 'yes' : 'no'}</span>
        </span>
      </div>
    )
  }
  const probs = Object.entries(a.probabilities ?? {})
  // a score answer is an expected value (e.g. 1.06): highlight the most likely level
  const picked = probs.length ? probs.reduce((m, x) => (x[1] > m[1] ? x : m))[0] : a.type === 'score' ? String(a.score) : a.choice
  if (probs.length === 0) return <p className="num mt-1 font-mono text-[11px]">{picked}</p>
  return (
    <div className="mt-1 flex items-end gap-0.5" role="img" aria-label={`Answer ${picked}`}>
      {probs.map(([k, p]) => (
        <div key={k} className="min-w-0 flex-1" title={`${k}: ${p.toFixed(2)}`}>
          <div className="flex h-4 items-end rounded-[2px] bg-muted">
            <div className={cn('w-full rounded-[2px]', k === picked ? 'bg-foreground/80' : 'bg-foreground/25')} style={{ height: `${Math.max(p, 0.04) * 100}%` }} />
          </div>
          <p className={cn('mt-0.5 truncate text-center text-[9px]', k === picked ? 'text-foreground' : 'text-muted-foreground')}>
            {k.replaceAll('_', ' ')}
          </p>
        </div>
      ))}
    </div>
  )
}

function weightFor(w: RunOut['config']['weights'], action: string) {
  const v = w[action as keyof typeof w]
  return typeof v === 'number' ? v.toFixed(2) : '—'
}

function InspectLink({ id }: { id: number }) {
  return (
    <button
      type="button"
      className="num font-mono underline underline-offset-2 hover:text-foreground"
      onClick={() => useViewStore.getState().inspect(id)}
    >
      #{id}
    </button>
  )
}

function Signal({ children, strong, muted }: { children: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <li
      className={cn(
        'rounded-sm border px-1.5 py-0.5',
        strong ? 'border-foreground/30 font-medium' : 'border-border',
        muted && 'text-muted-foreground',
      )}
    >
      {children}
    </li>
  )
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="p-4">
      {title && <h3 className="mb-2.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{title}</h3>}
      {children}
    </section>
  )
}
