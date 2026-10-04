import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useDataSource } from '@/data/source'
import { formatHour, reviewText, snippet, verdictWords } from '@/lib/format'
import { actionName } from '@/lib/palette'
import { bucketOfIndex, type HourBuckets } from '@/lib/timeline'
import { useRunStore } from '@/state/runStore'
import { useViewStore } from '@/state/viewStore'
import { ActionChip } from './ActionChip'

const REST_MS = 120
const WIDTH = 288

interface Props {
  runId: string
  ratingScale: string
  buckets: HourBuckets | null
  x: number
  y: number
  boxWidth: number
}

/** Hover card for one grid cell: action, time, verdict and an 80-character snippet. */
export function GridTooltip({ runId, ratingScale, buckets, x, y, boxWidth }: Props) {
  const source = useDataSource()
  const hovered = useViewStore((s) => s.hovered)
  useRunStore((s) => s.gridVersion) // the hovered cell's action can change under the pointer
  const [resting, setResting] = useState<number | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setResting(hovered), REST_MS)
    return () => clearTimeout(id)
  }, [hovered])

  const review = useQuery({
    queryKey: ['review', runId, resting],
    queryFn: () => source.getReview(runId, resting!),
    enabled: resting != null && resting === hovered,
    staleTime: Infinity,
  })

  if (hovered == null) return null
  const action = actionName(useRunStore.getState().grid.actions[hovered] ?? 0)
  const b = buckets ? bucketOfIndex(buckets, hovered) : -1
  const when = b >= 0 && buckets ? formatHour(new Date(buckets.ms[b])) : null
  const data = review.data?.review_id === hovered ? review.data : null

  const left = x + 16 + WIDTH > boxWidth ? Math.max(0, x - 16 - WIDTH) : x + 16
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute z-20 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ left, top: Math.max(0, y - 12), width: WIDTH }}
    >
      <div className="flex items-center justify-between gap-2">
        <ActionChip action={action} />
        <span className="num font-mono text-[11px] text-muted-foreground">#{hovered}</span>
      </div>
      {when && <div className="num mt-2 text-[11px] text-muted-foreground">{when}</div>}
      <div className="mt-1.5 text-[13px] leading-snug">
        {data ? (
          <>
            <span className="font-medium">{verdictWords(data.rating_norm, data.rating_raw, ratingScale)}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-pretty text-foreground/85">“{snippet(reviewText(data.text))}”</span>
          </>
        ) : review.isError ? (
          <span className="text-muted-foreground">Review text unavailable.</span>
        ) : (
          <span className="inline-block h-3.5 w-48 animate-pulse rounded bg-muted align-middle" aria-label="Loading" />
        )}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">Click to select</div>
    </div>
  )
}
