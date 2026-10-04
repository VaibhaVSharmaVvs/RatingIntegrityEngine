import { useQuery } from '@tanstack/react-query'
import { PanelRightOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDataSource } from '@/data/source'
import { formatHour, reviewText, verdictWords } from '@/lib/format'
import { useRunStore } from '@/state/runStore'
import { useViewStore } from '@/state/viewStore'
import { ReasonChip } from '@/components/shared/ReasonChip'
import { CellChip } from './ActionChip'

/** Compact read-out of the clicked review; "Inspect" opens the full inspector drawer. */
export function SelectedReview({ runId, ratingScale }: { runId: string; ratingScale: string }) {
  const source = useDataSource()
  const selected = useViewStore((s) => s.selected)
  useRunStore((s) => s.gridVersion)
  const q = useQuery({
    queryKey: ['review', runId, selected],
    queryFn: () => source.getReview(runId, selected!),
    enabled: selected != null,
    staleTime: 5_000, // the decision fills in when the run finishes
  })
  if (selected == null) return null
  const r = q.data?.review_id === selected ? q.data : null
  return (
    <section aria-label="Selected review" className="rounded-md border border-border bg-card p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <CellChip index={selected} />
        <span className="num font-mono text-[11px] text-muted-foreground">#{selected}</span>
        {r?.created_at && <span className="num text-[11px] text-muted-foreground">{formatHour(r.created_at)}</span>}
        <Button
          variant="outline"
          size="xs"
          className="ml-auto"
          onClick={() => useViewStore.getState().inspect(selected)}
        >
          <PanelRightOpen />
          Inspect
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear selection"
          onClick={() => useViewStore.getState().select(null)}
        >
          <X />
        </Button>
      </header>
      {r ? (
        <>
          <p className="mt-2 text-xs font-medium">{verdictWords(r.rating_norm, r.rating_raw, ratingScale)}</p>
          <p className="mt-1 line-clamp-6 text-[13px] leading-relaxed text-pretty whitespace-pre-line">{reviewText(r.text)}</p>
          {(r.integrity_score != null || r.reasons.length > 0) && (
            <dl className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
              {r.integrity_score != null && (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">Integrity score</dt>
                  <dd className="num font-mono">{r.integrity_score.toFixed(2)}</dd>
                </div>
              )}
              {r.weight != null && (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">Weight</dt>
                  <dd className="num font-mono">{r.weight.toFixed(2)}</dd>
                </div>
              )}
              {r.reasons.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <dt className="sr-only">Reasons</dt>
                  {r.reasons.map((code) => (
                    <dd key={code}>
                      <ReasonChip code={code} />
                    </dd>
                  ))}
                </div>
              )}
            </dl>
          )}
        </>
      ) : q.isError ? (
        <p className="mt-2 text-xs text-muted-foreground">Could not load this review.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}
    </section>
  )
}
