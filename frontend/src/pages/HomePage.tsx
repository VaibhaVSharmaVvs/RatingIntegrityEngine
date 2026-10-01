import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CircleHelp, FileUp, Play } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CsvDatasetSheet } from '@/components/runs/CsvDatasetSheet'
import { RailLegend, RatingRail } from '@/components/shared/RatingRail'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button, buttonVariants } from '@/components/ui/button'
import { ApiError } from '@/data/DataSource'
import { SHOWCASE } from '@/data/showcase'
import { useDataSource } from '@/data/source'
import { formatDuration, formatInt, formatRating, formatUsd } from '@/lib/format'

type Mode = 'replay' | 'live'

interface Product {
  key: string
  title: string
  detail: string
  /** finished run to replay, if any */
  runId?: string
  /** known up front for uploads; for showcase games it comes from the recorded run */
  datasetId?: string
}

// Uploads made in this browser. Other CSV datasets (test data) stay unlisted.
const UPLOADS_KEY = 'rie.uploads'
function readUploads(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(UPLOADS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
function rememberUpload(id: string) {
  try {
    localStorage.setItem(UPLOADS_KEY, JSON.stringify([...new Set([...readUploads(), id])]))
  } catch {
    /* storage unavailable: the upload still works for this visit */
  }
}

const field =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

/**
 * Pick a product, then replay its recorded run ($0) or analyse it live with Jev.
 * Offered: the curated showcase games and this browser's own CSV uploads. Test runs and
 * datasets stay in the database, unlisted.
 */
export function HomePage() {
  const source = useDataSource()
  const navigate = useNavigate()
  const [key, setKey] = useState(SHOWCASE[0].key)
  const [mode, setMode] = useState<Mode>('replay')
  const [confirmedFor, setConfirmedFor] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploads, setUploads] = useState(readUploads)

  const datasets = useQuery({ queryKey: ['datasets'], queryFn: () => source.listDatasets(), enabled: uploads.length > 0 })
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => source.listRuns(), enabled: uploads.length > 0 })
  const products: Product[] = [
    ...SHOWCASE.map((g) => ({ key: g.key, title: `${g.title}: ${g.story}`, detail: g.window, runId: g.runId })),
    ...(datasets.data ?? [])
      .filter((d) => uploads.includes(d.id) && d.status === 'ready')
      .map((d) => ({
        key: d.id,
        title: `${d.name} (your upload)`,
        detail: `CSV upload · ${formatInt(d.n_reviews)} reviews`,
        datasetId: d.id,
        runId: (runs.data ?? []).filter((r) => r.dataset_id === d.id && r.status === 'done' && r.backend === 'jev')[0]?.id,
      })),
  ]
  const product = products.find((g) => g.key === key) ?? products[0]
  const canReplay = !!product.runId
  const live = source.canStartRuns && (mode === 'live' || !canReplay)

  const recorded = useQuery({
    queryKey: ['run', product.runId],
    queryFn: () => source.getRun(product.runId!),
    enabled: canReplay,
    staleTime: 60_000,
  })
  const datasetId = product.datasetId ?? recorded.data?.dataset_id
  const pf = useQuery({
    queryKey: ['preflight', datasetId, 'jev', 'v4'],
    queryFn: () => source.preflight({ dataset_id: datasetId!, backend: 'jev', question_set: 'v4' }),
    enabled: live && !!datasetId,
    staleTime: 60_000,
  })
  const needsConfirm = !!pf.data?.needs_confirmation
  const confirmed = confirmedFor === product.key
  const start = useMutation({
    mutationFn: () =>
      source.createRun({ dataset_id: datasetId!, backend: 'jev', question_set: 'v4', confirm_cost: needsConfirm ? confirmed : undefined }),
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  })

  const s = canReplay ? recorded.data?.summary : undefined
  const blocked = live ? !pf.data || (needsConfirm && !confirmed) || start.isPending : !recorded.data
  const go = () => (live ? start.mutate() : navigate(`/runs/${product.runId}`))

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
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="product" className="text-xs font-medium">
                Product
              </label>
              {source.canStartRuns && (
                <button
                  type="button"
                  onClick={() => setUploading(true)}
                  className="inline-flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileUp className="size-3" aria-hidden />
                  Upload your own reviews (CSV)
                </button>
              )}
            </div>
            <select id="product" className={field} value={product.key} onChange={(e) => setKey(e.target.value)}>
              {products.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.title}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">{product.detail}</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Run</span>
            <select className={field} value={live ? 'live' : 'replay'} onChange={(e) => setMode(e.target.value as Mode)}>
              {canReplay && <option value="replay">Replay the recorded run ($0)</option>}
              {source.canStartRuns && <option value="live">Live run with Jev{pf.data ? ` (≈ ${formatUsd(pf.data.est_cost_usd)})` : ''}</option>}
            </select>
            <span className="block text-[11px] text-muted-foreground">
              {live
                ? canReplay
                  ? 'Every review is judged again by Jev, one call each. It costs money and takes a few minutes; Jev is not deterministic, so about 2.6% of decisions can differ from the recording.'
                  : 'Not analysed yet: every review is judged by Jev, one call each. It costs money and takes a few minutes.'
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
                        onChange={(e) => setConfirmedFor(e.target.checked ? product.key : '')}
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
      {source.canStartRuns && (
        <CsvDatasetSheet
          open={uploading}
          onOpenChange={setUploading}
          onImported={(d) => {
            rememberUpload(d.id)
            setUploads(readUploads())
            setKey(d.id)
            setMode('live')
          }}
        />
      )}
    </div>
  )
}
