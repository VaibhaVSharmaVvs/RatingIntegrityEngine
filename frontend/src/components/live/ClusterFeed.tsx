import { useQuery } from '@tanstack/react-query'
import { Pin } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ClusterEvent } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatInt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRunStore } from '@/state/runStore'
import { membersMask, useViewStore } from '@/state/viewStore'

const KIND_LABEL: Record<ClusterEvent['kind'], string> = {
  semantic: 'Semantic',
  duplicate: 'Duplicate',
  burst: 'Burst',
}

interface Props {
  runId: string
  /** policy: clusters at or above this suspicion are penalised (PolicyThresholds) */
  threshold: number
  /** policy: clusters smaller than this are never penalised */
  minPenaltySize: number
}

/** Cards appear as S3 detects clusters. Hover brushes the grid; click pins the brush. */
export function ClusterFeed({ runId, threshold, minPenaltySize }: Props) {
  const clusters = useRunStore((s) => s.clusters)
  const pinned = useViewStore((s) => s.pinnedCid)
  const [hoverCid, setHoverCid] = useState<number | null>(null)
  useClusterBrush(runId, hoverCid ?? pinned)

  if (clusters.length === 0) {
    return <p className="text-xs leading-relaxed text-muted-foreground">Clusters appear here when the corpus stage finds them.</p>
  }
  const newestFirst = [...clusters].reverse()
  return (
    <ul className="space-y-2" onPointerLeave={() => setHoverCid(null)}>
      {newestFirst.map((c) => (
        <ClusterCard
          key={c.cid}
          cluster={c}
          threshold={threshold}
          eligible={c.size >= minPenaltySize}
          minPenaltySize={minPenaltySize}
          pinned={pinned === c.cid}
          onHover={setHoverCid}
          onToggle={() => useViewStore.getState().pin(pinned === c.cid ? null : c.cid)}
        />
      ))}
    </ul>
  )
}

function ClusterCard({
  cluster: c,
  threshold,
  eligible,
  minPenaltySize,
  pinned,
  onHover,
  onToggle,
}: {
  cluster: ClusterEvent
  threshold: number
  eligible: boolean
  minPenaltySize: number
  pinned: boolean
  onHover: (cid: number | null) => void
  onToggle: () => void
}) {
  const over = c.suspicion >= threshold
  return (
    <li className="animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <button
        type="button"
        onPointerEnter={() => onHover(c.cid)}
        onFocus={() => onHover(c.cid)}
        onBlur={() => onHover(null)}
        onClick={onToggle}
        aria-pressed={pinned}
        className={cn(
          'relative w-full rounded-md border border-border bg-card p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]',
          pinned && 'border-foreground/40 bg-accent',
        )}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{KIND_LABEL[c.kind]}</span>
          <span className="num font-mono text-muted-foreground">#{c.cid}</span>
          <span className="num ml-auto text-muted-foreground">{formatInt(c.size)} reviews</span>
          {pinned && <Pin className="size-3" aria-label="Pinned" />}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative h-1.5 flex-1 rounded-full bg-muted" aria-hidden>
            <div
              className={cn('absolute inset-y-0 left-0 rounded-full', over ? 'bg-foreground' : 'bg-muted-foreground/60')}
              style={{ width: `${Math.min(1, c.suspicion) * 100}%` }}
            />
            <div className="absolute -inset-y-1 w-px bg-foreground/70" style={{ left: `${threshold * 100}%` }} title="Penalty threshold" />
          </div>
          <span className="num w-9 text-right font-mono text-xs">{c.suspicion.toFixed(2)}</span>
        </div>
        <p className="mt-2 line-clamp-3 text-[12px] leading-snug text-muted-foreground">{c.caption}</p>
        {over && !eligible && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Under {minPenaltySize} reviews: not penalised
          </p>
        )}
        <span className="sr-only">
          Suspicion {c.suspicion.toFixed(2)}, penalty threshold {threshold}. {pinned ? 'Pinned.' : 'Click to pin in the grid.'}
        </span>
      </button>
    </li>
  )
}

/** Fetch a cluster's members and dim every other grid cell while it is brushed. */
function useClusterBrush(runId: string, cid: number | null) {
  const source = useDataSource()
  const q = useQuery({
    queryKey: ['cluster', runId, cid],
    queryFn: () => source.getCluster(runId, cid!),
    enabled: cid != null,
    staleTime: Infinity,
  })
  useEffect(() => {
    const view = useViewStore.getState()
    if (cid == null) {
      if (view.brush) view.setBrush(null)
      return
    }
    if (q.data && q.data.cluster_id === cid) {
      view.setBrush({ cid, mask: membersMask(useRunStore.getState().grid.size, q.data.member_ids) })
    }
  }, [cid, q.data])
}
