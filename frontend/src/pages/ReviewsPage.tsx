import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ActionChip } from '@/components/live/ActionChip'
import { Drilldowns } from '@/components/shared/Drilldowns'
import { ReasonList } from '@/components/shared/ReasonChip'
import { RunHeader } from '@/components/shared/RunHeader'
import { Button } from '@/components/ui/button'
import type { ReviewFilter } from '@/data/DataSource'
import { useDataSource } from '@/data/source'
import { formatHour, formatInt, verdictWords } from '@/lib/format'
import { REASONS, reasonLabel } from '@/lib/methodology'
import { ACTION_LABELS, type ActionName } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { useViewStore } from '@/state/viewStore'

const PAGE = 50
const ACTIONS = ['KEEP', 'DOWNWEIGHT', 'FLAG', 'EXCLUDE'] as const
const REASON_FILTERS = Object.keys(REASONS).filter((c) => c !== 'LOW_INFORMATIVENESS')

/** Every decision of a finished run, filterable; filters live in the URL so a view can be shared. */
export function ReviewsPage() {
  const { runId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const source = useDataSource()
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => source.getRun(runId) })
  const dataset = useQuery({
    queryKey: ['dataset', run.data?.dataset_id],
    queryFn: () => source.getDataset(run.data!.dataset_id),
    enabled: !!run.data,
    staleTime: Infinity,
  })
  const scale = dataset.data?.rating_scale ?? 'binary'
  const filter: ReviewFilter = {
    action: (params.get('action') as ReviewFilter['action']) || undefined,
    reason: params.get('reason') || undefined,
    cluster: params.get('cluster') ? Number(params.get('cluster')) : undefined,
    verdict: (params.get('verdict') as ReviewFilter['verdict']) || undefined,
    q: params.get('q') || undefined,
    sort: (params.get('sort') as ReviewFilter['sort']) || 'time',
    limit: PAGE,
    offset: Number(params.get('offset') ?? 0),
  }
  const page = useQuery({
    queryKey: ['reviews', runId, filter],
    queryFn: () => source.listReviews(runId, filter),
    enabled: run.data?.status === 'done',
    placeholderData: keepPreviousData,
  })
  const set = (k: string, v: string | undefined) =>
    setParams((p) => {
      if (v) p.set(k, v)
      else p.delete(k)
      if (k !== 'offset') p.delete('offset')
      return p
    })
  const [text, setText] = useState(filter.q ?? '')
  useEffect(() => {
    const id = setTimeout(() => {
      if ((filter.q ?? '') !== text) set('q', text || undefined)
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on the typed text only
  }, [text])

  const total = page.data?.total ?? 0
  const offset = filter.offset ?? 0
  const field =
    'h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const active = ['action', 'reason', 'cluster', 'verdict', 'q'].some((k) => params.get(k))

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <RunHeader runId={runId} />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-6 sm:px-6">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => e.preventDefault()} aria-label="Filter reviews">
          <label className="relative min-w-48 flex-1">
            <span className="sr-only">Search text</span>
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search review text" className={cn(field, 'w-full pl-7')} />
          </label>
          <Select label="Action" value={filter.action} onChange={(v) => set('action', v)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </Select>
          <Select label="Reason" value={filter.reason} onChange={(v) => set('reason', v)}>
            {REASON_FILTERS.map((c) => (
              <option key={c} value={c}>
                {reasonLabel(c)}
              </option>
            ))}
          </Select>
          <Select label="Verdict" value={filter.verdict} onChange={(v) => set('verdict', v)}>
            <option value="positive">{scale === 'binary' ? 'Recommended' : 'Positive'}</option>
            <option value="negative">{scale === 'binary' ? 'Not recommended' : 'Negative'}</option>
          </Select>
          <Select label="Sort" value={filter.sort} onChange={(v) => set('sort', v === 'time' ? undefined : v)} noAll>
            <option value="time">Oldest first</option>
            <option value="integrity">Lowest integrity first</option>
          </Select>
          {filter.cluster != null && (
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs">
              Cluster <span className="num font-mono">#{filter.cluster}</span>
              <button type="button" aria-label="Clear cluster filter" onClick={() => set('cluster', undefined)} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          )}
          {active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setText('')
                setParams({})
              }}
            >
              Clear
            </Button>
          )}
        </form>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="num">
            {page.data ? (
              <>
                <span className="font-medium text-foreground">{formatInt(total)}</span> reviews
                {total > 0 && ` · ${formatInt(offset + 1)}–${formatInt(Math.min(offset + PAGE, total))}`}
              </>
            ) : (
              'Loading…'
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={offset === 0} onClick={() => set('offset', String(Math.max(0, offset - PAGE)))}>
              <ChevronLeft />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={offset + PAGE >= total} onClick={() => set('offset', String(offset + PAGE))}>
              <ChevronRight />
            </Button>
          </div>
        </div>

        {run.data && run.data.status !== 'done' ? (
          <p className="text-sm text-muted-foreground">The table fills when the run is done.</p>
        ) : page.isError ? (
          <p className="text-sm text-muted-foreground">Could not load reviews: {page.error.message}</p>
        ) : (
          <div className={cn('overflow-x-auto rounded-md border border-border transition-opacity', page.isPlaceholderData && 'opacity-60')}>
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-muted/40 text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Posted (UTC)</th>
                  <th className="px-3 py-2 font-medium">Verdict</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 text-right font-medium">Integrity</th>
                  <th className="px-3 py-2 font-medium">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(page.data?.items ?? []).map((r) => (
                  <tr
                    key={r.review_id}
                    tabIndex={0}
                    onClick={() => useViewStore.getState().inspect(r.review_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        useViewStore.getState().inspect(r.review_id)
                      }
                    }}
                    className="cursor-pointer align-top transition-colors outline-none hover:bg-accent/60 focus-visible:bg-accent"
                    aria-label={`Inspect review ${r.review_id}`}
                  >
                    <td className="num px-3 py-2 font-mono text-muted-foreground">{r.review_id}</td>
                    <td className="num px-3 py-2 whitespace-nowrap text-muted-foreground">{r.created_at ? formatHour(r.created_at).replace(' UTC', '') : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{verdictWords(r.rating_norm, null, scale)}</td>
                    <td className="px-3 py-2">{r.action && <ActionChip action={r.action as ActionName} />}</td>
                    <td className="num px-3 py-2 text-right font-mono">{r.integrity_score?.toFixed(2) ?? '—'}</td>
                    <td className="max-w-xl px-3 py-2">
                      <p className="line-clamp-2 leading-snug">{r.snippet}</p>
                      {r.reasons.length > 0 && (
                        <div onClick={(e) => e.stopPropagation()}>
                          <ReasonList codes={r.reasons} className="mt-1" />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {page.data?.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No reviews match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Drilldowns runId={runId} scale={scale} />
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  children,
  noAll,
}: {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
  children: ReactNode
  noAll?: boolean
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!noAll && <option value="">All</option>}
        {children}
      </select>
    </label>
  )
}
