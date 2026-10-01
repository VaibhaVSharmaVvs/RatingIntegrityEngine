import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CircleHelp, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RailLegend, RatingRail } from '@/components/shared/RatingRail'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button, buttonVariants } from '@/components/ui/button'
import { ApiError } from '@/data/DataSource'
import { SHOWCASE } from '@/data/showcase'
import { useDataSource } from '@/data/source'
import { formatDuration, formatInt, formatRating, formatUsd } from '@/lib/format'

type Mode = 'replay' | 'live'

const field =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

/**
 * Pick a game, then replay its recorded run ($0) or analyse it again live with Jev.
 * Only the curated games are offered; test runs stay in the database, unlisted.
 */
export function HomePage() {
  const source = useDataSource()
  const navigate = useNavigate()
  const [key, setKey] = useState(SHOWCASE[0].key)
  const [mode, setMode] = useState<Mode>('replay')
  const [confirmedFor, setConfirmedFor] = useState('')
  const game = SHOWCASE.find((g) => g.key === key) ?? SHOWCASE[0]
  const live = mode === 'live' && source.canStartRuns

  const recorded = useQuery({ queryKey: ['run', game.runId], queryFn: () => source.getRun(game.runId), staleTime: 60_000 })
  const datasetId = recorded.data?.dataset_id
  const pf = useQuery({
    queryKey: ['preflight', datasetId, 'jev', 'v4'],
    queryFn: () => source.preflight({ dataset_id: datasetId!, backend: 'jev', question_set: 'v4' }),
    enabled: live && !!datasetId,
    staleTime: 60_000,
  })
  const needsConfirm = !!pf.data?.needs_confirmation
  const confirmed = confirmedFor === game.key
  const start = useMutation({
    mutationFn: () =>
      source.createRun({ dataset_id: datasetId!, backend: 'jev', question_set: 'v4', confirm_cost: needsConfirm ? confirmed : undefined }),
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  })

  const s = recorded.data?.summary
  const blocked = live ? !pf.data || (needsConfirm && !confirmed) || start.isPending : !recorded.data
  const go = () => (live ? start.mutate() : navigate(`/runs/${game.runId}`))

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-end gap-1 px-4 py-2.5">
        <Link to="/help" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <CircleHelp />
          How it works
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-[8vh] pb-16 sm:px-6">
        <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Rating Integrity Engine</p>
        <h1 className="mt-2 text-2xl leading-snug font-semibold tracking-tight text-balance">
          Watch every review get an integrity weight, and the rating move with it.
        </h1>

        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!blocked) go()
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Game</span>
            <select className={field} value={key} onChange={(e) => setKey(e.target.value)}>
              {SHOWCASE.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.title}: {g.story}
                </option>
              ))}
            </select>
            <span className="block text-[11px] text-muted-foreground">{game.window}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Run</span>
            <select className={field} value={live ? 'live' : 'replay'} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="replay">Replay the recorded run ($0)</option>
              {source.canStartRuns && <option value="live">Live run with Jev{pf.data ? ` (≈ ${formatUsd(pf.data.est_cost_usd)})` : ''}</option>}
            </select>
            <span className="block text-[11px] text-muted-foreground">
              {live
                ? 'Every review is judged again by Jev, one call each. It costs money and takes a few minutes; Jev is not deterministic, so about 2.6% of decisions can differ from the recording.'
                : 'Plays back the recorded analysis: the same judgments and timeline, at no cost.'}
            </span>
          </label>

          {live && (
            <section aria-label="Pre-flight estimate" className="rounded-md bg-muted/50 p-3">
              {pf.data ? (
                <>
                  <dl className="num grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Estimated cost</dt>
                    <dd className="text-right font-medium">{formatUsd(pf.data.est_cost_usd)}</dd>
                    <dt className="text-muted-foreground">Calls</dt>
                    <dd className="text-right">{formatInt(pf.data.calls)}</dd>
                    <dt className="text-muted-foreground">Time</dt>
                    <dd className="text-right">≈ {formatDuration(pf.data.est_seconds)}</dd>
                  </dl>
                  <p className="mt-2 text-[11px] text-muted-foreground">The run stops if it reaches 1.25 × the estimate.</p>
                  {needsConfirm && (
                    <label className="mt-3 flex items-start gap-2 rounded-md border border-action-downweight/50 bg-action-downweight/10 p-2 text-xs">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmedFor(e.target.checked ? game.key : '')}
                        className="mt-0.5 size-3.5 accent-foreground"
                      />
                      <span>
                        <AlertTriangle className="mr-1 inline size-3.5 -translate-y-px" aria-hidden />
                        Above the {formatUsd(pf.data.limit_usd)} limit. I accept an estimated {formatUsd(pf.data.est_cost_usd)}.
                      </span>
                    </label>
                  )}
                </>
              ) : pf.isError ? (
                <p className="text-xs text-destructive">{pf.error.message}</p>
              ) : (
                <div className="h-14 animate-pulse rounded bg-muted" />
              )}
            </section>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={blocked}>
            <Play />
            {live ? (start.isPending ? 'Starting…' : `Start live run${pf.data ? ` · ${formatUsd(pf.data.est_cost_usd)}` : ''}`) : 'Play the replay'}
          </Button>
          {start.isError && (
            <p role="alert" className="text-xs text-destructive">
              {start.error instanceof ApiError && start.error.status === 402 ? `Spend guard: ${start.error.message}` : start.error.message}
            </p>
          )}
          {recorded.isError && <p className="text-xs text-destructive">The recorded run could not be loaded: {recorded.error.message}</p>}
        </form>

        {s && (
          <section aria-label="Recorded result" className="mt-10 space-y-3">
            <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Recorded result</h2>
            <RatingRail scale={s.rating_scale} size="sm" marks={{ raw: s.raw, adjusted: s.adjusted, ci: s.ci, platform: s.platform?.rating, platformCi: s.platform?.ci }} />
            <p className="num flex flex-wrap gap-x-4 text-xs">
              <span>
                Raw <b className="font-medium">{formatRating(s.raw, s.rating_scale)}</b>
              </span>
              <span>
                Integrity-adjusted <b className="font-semibold">{formatRating(s.adjusted, s.rating_scale)}</b>
              </span>
              {s.platform?.rating != null && (
                <span>
                  Steam policy <b className="font-medium">{formatRating(s.platform.rating, s.rating_scale)}</b>
                </span>
              )}
            </p>
            <RailLegend platform={s.platform?.rating != null} />
          </section>
        )}
      </main>
    </div>
  )
}
