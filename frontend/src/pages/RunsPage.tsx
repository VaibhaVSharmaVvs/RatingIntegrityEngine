import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DatasetOut, RunCreate, RunOut } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatDelta, formatInt, formatRating, formatUsd } from '@/lib/format'

/** $0 backends only: Jev runs need the pre-flight cost drawer (Phase 6). */
const FREE_BACKENDS: { value: RunCreate['backend']; label: string }[] = [
  { value: 'heuristic', label: 'Heuristics only' },
  { value: 'mock', label: 'Mock System One (paced)' },
]

export function RunsPage() {
  const source = useDataSource()
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => source.listRuns(), refetchInterval: 5_000 })
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: () => source.listDatasets() })
  const byId = new Map((datasets.data ?? []).map((d) => [d.id, d]))

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">Rating Integrity Engine</h1>
        <span className="text-xs text-muted-foreground">Runs</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {source.canStartRuns && datasets.data && datasets.data.length > 0 && <StartRun datasets={datasets.data} />}
        <section aria-label="Runs" className="space-y-3">
          <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Recent runs</h2>
          {runs.isError ? (
            <p className="text-sm text-muted-foreground">Could not reach the API ({runs.error.message}).</p>
          ) : runs.isPending ? (
            <div className="h-40 animate-pulse rounded-md bg-muted" />
          ) : runs.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet. Start one above.</p>
          ) : (
            <RunsTable runs={runs.data} datasets={byId} />
          )}
        </section>
      </main>
    </div>
  )
}

function RunsTable({ runs, datasets }: { runs: RunOut[]; datasets: Map<string, DatasetOut> }) {
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dataset</TableHead>
            <TableHead>Backend</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Reviews</TableHead>
            <TableHead className="text-right">Raw → adjusted</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Started</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => {
            const ds = datasets.get(r.dataset_id)
            const scale = ds?.rating_scale ?? 'binary'
            const s = r.summary
            return (
              <TableRow key={r.id}>
                <TableCell className="max-w-64">
                  <Link to={`/runs/${r.id}`} className="block truncate font-medium hover:underline">
                    {ds?.name ?? r.dataset_id}
                  </Link>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.id}</span>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.backend}</TableCell>
                <TableCell className="text-xs">{r.status}</TableCell>
                <TableCell className="num text-right">{formatInt(ds?.n_reviews)}</TableCell>
                <TableCell className="num text-right">
                  {s ? (
                    <>
                      {formatRating(s.raw, scale)} → <span className="font-semibold">{formatRating(s.adjusted, scale)}</span>{' '}
                      <span className="text-xs text-muted-foreground">{formatDelta(s.raw, s.adjusted, scale)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="num text-right">{formatUsd(r.cost_usd)}</TableCell>
                <TableCell className="num text-right text-xs text-muted-foreground">
                  {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === 'done' && (
                    <Link to={`/runs/${r.id}?play=end`} className="text-xs underline-offset-4 hover:underline">
                      Final state
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function StartRun({ datasets }: { datasets: DatasetOut[] }) {
  const source = useDataSource()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ready = datasets.filter((d) => d.status === 'ready')
  const [datasetId, setDatasetId] = useState(ready[0]?.id ?? '')
  const [backend, setBackend] = useState<RunCreate['backend']>('heuristic')
  const start = useMutation({
    mutationFn: () => source.createRun({ dataset_id: datasetId, backend, mock_latency_ms: backend === 'mock' ? 40 : undefined }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      navigate(`/runs/${run.id}`)
    },
  })
  const field = 'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <section aria-label="Start a run" className="space-y-3">
      <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Start a $0 run</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          start.mutate()
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Dataset
          <select className={field} value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
            {ready.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({formatInt(d.n_reviews)})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Backend
          <select className={field} value={backend} onChange={(e) => setBackend(e.target.value as RunCreate['backend'])}>
            {FREE_BACKENDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={!datasetId || start.isPending}>
          {start.isPending ? 'Starting…' : 'Start run'}
        </Button>
        {start.isError && <p className="text-xs text-destructive">{start.error.message}</p>}
      </form>
      <p className="text-xs text-muted-foreground">Jev runs need the pre-flight cost estimate, which arrives with the run-config drawer.</p>
    </section>
  )
}
