import { useQuery } from '@tanstack/react-query'
import { Play, SkipForward } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Drilldowns } from '@/components/shared/Drilldowns'
import { RunHeader } from '@/components/shared/RunHeader'
import { ClusterFeed } from '@/components/live/ClusterFeed'
import { FpsMeter } from '@/components/live/FpsMeter'
import { recordPaint } from '@/lib/frameStats'
import { IntegrityGrid } from '@/components/live/IntegrityGrid'
import { RatingTicker } from '@/components/live/RatingTicker'
import { ActionLegend, RunCounters } from '@/components/live/RunCounters'
import { SelectedReview } from '@/components/live/SelectedReview'
import { StageStepper } from '@/components/live/StageStepper'
import { TimelineStrip, type TimeWindow } from '@/components/live/TimelineStrip'
import { useDataSource } from '@/data/source'
import { formatInt } from '@/lib/format'
import { hourBuckets } from '@/lib/timeline'
import { useRunStore } from '@/state/runStore'
import { DEFAULT_PLAY, PLAY_OPTIONS, playbackFor } from '@/state/playback'
import { useRunConnection } from '@/state/useRunConnection'

export function LiveRunPage() {
  const { runId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const source = useDataSource()
  const showFps = params.get('fps') === '1'
  const [nonce, setNonce] = useState(0)

  const run = useQuery({ queryKey: ['run', runId], queryFn: () => source.getRun(runId) })
  const datasetId = run.data?.dataset_id
  const dataset = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => source.getDataset(datasetId!),
    enabled: !!datasetId,
    staleTime: Infinity,
  })
  const hours = useQuery({
    queryKey: ['hours', datasetId],
    queryFn: () => source.getHours(datasetId!),
    enabled: !!datasetId,
    staleTime: Infinity,
  })
  const buckets = useMemo(() => (hours.data ? hourBuckets(hours.data) : null), [hours.data])
  // a cached run reuses another run's answers: show that run's real pace and cost
  const sourceId = run.data?.backend === 'cached' ? run.data.config.reuse_judgments_from : null
  const source_ = useQuery({
    queryKey: ['run', sourceId],
    queryFn: () => source.getRun(sourceId!),
    enabled: !!sourceId,
    staleTime: Infinity,
  })
  const reusedFrom = source_.data?.summary
    ? {
        runId: source_.data.id,
        backend: source_.data.backend,
        costUsd: source_.data.cost_usd,
        reviewsPerS: source_.data.summary.reviews_per_s,
        elapsedS: source_.data.summary.elapsed_s,
      }
    : null

  const finished = run.data ? ['done', 'error'].includes(run.data.status) : false
  const n = dataset.data?.n_reviews ?? 0
  const playback = playbackFor(params, finished, nonce)
  const activePlay = params.get('play') ?? (params.get('replay') === '1' ? 'realtime' : DEFAULT_PLAY)
  const { playing, skip } = useRunConnection(runId, n, playback)

  const corpusDone = useRunStore((s) => s.stages.corpus === 'done')
  const phase = useRunStore((s) => s.phase)
  const error = useRunStore((s) => s.error)
  const summary = useRunStore((s) => s.summary)
  const bursts = useQuery({
    queryKey: ['clusters', runId, 'burst'],
    queryFn: () => source.getClusters(runId, 'burst'),
    enabled: corpusDone,
    staleTime: Infinity,
  })
  const burstWindows = useMemo<TimeWindow[]>(
    () =>
      (bursts.data ?? [])
        .filter((b) => b.t_start && b.t_end)
        .map((b) => ({ start: Date.parse(b.t_start!), end: Date.parse(b.t_end!), label: 'Burst' })),
    [bursts.data],
  )
  const changePoints = useMemo(() => summary?.corpus.change_points ?? [], [summary])

  if (run.isError) {
    return (
      <Centered>
        <p className="text-sm">Run {runId} could not be loaded: {run.error.message}</p>
        <Link to="/" className="text-sm underline underline-offset-4">
          Choose another game
        </Link>
      </Centered>
    )
  }

  const scale = dataset.data?.rating_scale ?? 'binary'
  const thresholds = run.data?.config.thresholds
  const startReplay = (play: string) => {
    setParams((p) => {
      p.set('play', play)
      p.delete('replay')
      p.delete('speed')
      return p
    })
    setNonce((k) => k + 1)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground lg:h-dvh">
      <RunHeader runId={runId}>
        <StageStepper timings={summary?.timings_s} />
      </RunHeader>

      {error && (
        <div role="alert" className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error.message}
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[minmax(0,1fr)]">
        <section aria-label="Live analysis" className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <h2 className="text-sm font-semibold">
              Integrity grid <span className="num font-normal text-muted-foreground">· {formatInt(n)} reviews, oldest first</span>
            </h2>
            <ActionLegend />
            {finished && (
              <div className="ml-auto flex items-center gap-1" role="group" aria-label="Replay this run">
                <Play className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="mr-1 text-xs text-muted-foreground">Replay</span>
                {PLAY_OPTIONS.map((o) => (
                  <Button
                    key={o.value}
                    size="xs"
                    title={o.title}
                    aria-pressed={playback.kind === 'replay' && activePlay === o.value}
                    variant={playback.kind === 'replay' && activePlay === o.value ? 'secondary' : 'ghost'}
                    className="num"
                    onClick={() => startReplay(o.value)}
                  >
                    {o.label}
                  </Button>
                ))}
                <Button size="xs" variant="ghost" disabled={!playing} onClick={skip} title="Show the final state">
                  <SkipForward />
                  Skip to end
                </Button>
              </div>
            )}
          </div>

          <div className="h-[60vh] min-h-0 rounded-lg bg-instrument p-2 lg:h-auto lg:flex-1">
            {n > 0 && run.data ? (
              <IntegrityGrid
                n={n}
                runId={runId}
                ratingScale={scale}
                buckets={buckets}
                onFrame={showFps ? recordPaint : undefined}
              />
            ) : (
              <div className="grid h-full place-items-center text-xs text-instrument-ink">Loading reviews…</div>
            )}
          </div>

          <div className="rounded-lg bg-instrument p-2">
            {buckets && buckets.ms.length > 0 ? (
              <TimelineStrip buckets={buckets} bursts={burstWindows} changePoints={changePoints} />
            ) : (
              <div className="grid h-24 place-items-center text-xs text-instrument-ink">
                {hours.isError ? 'No timestamps for this dataset.' : 'Loading timeline…'}
              </div>
            )}
          </div>
        </section>

        <aside aria-label="Run summary" className="relative flex min-h-0 flex-col gap-5 lg:overflow-y-auto lg:pr-1 [&>*]:shrink-0">
          <RatingTicker scale={scale} />
          <RunCounters reusedFrom={reusedFrom} />
          <SelectedReview runId={runId} ratingScale={scale} />
          <section aria-label="Clusters" className="flex flex-col gap-2">
            <h2 className="flex items-baseline justify-between text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Clusters
              {summary && (
                <span className="num tracking-normal normal-case">
                  {formatInt(summary.corpus.suspicious_clusters)} above threshold
                </span>
              )}
            </h2>
            <ClusterFeed
              runId={runId}
              threshold={thresholds?.cluster_penalty_threshold ?? 0.5}
              minPenaltySize={thresholds?.min_penalty_cluster_size ?? 10}
            />
          </section>
          {phase === 'done' && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Not the “true” rating: the rating under this documented method. English-language reviews only.
            </p>
          )}
        </aside>
      </main>
      <Drilldowns runId={runId} scale={scale} />
      {showFps && <FpsMeter />}
    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center gap-2 bg-background p-6 text-foreground">{children}</div>
}
