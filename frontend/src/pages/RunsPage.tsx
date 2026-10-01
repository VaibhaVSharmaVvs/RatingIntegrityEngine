import { useQuery } from '@tanstack/react-query'
import { CircleHelp, FileUp, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CsvDatasetSheet } from '@/components/runs/CsvDatasetSheet'
import { NewRunSheet } from '@/components/runs/NewRunSheet'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button, buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DatasetOut, RunOut } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatDelta, formatInt, formatRating, formatUsd } from '@/lib/format'

export function RunsPage() {
  const source = useDataSource()
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => source.listRuns(), refetchInterval: 5_000 })
  const datasets = useQuery({ queryKey: ['datasets'], queryFn: () => source.listDatasets() })
  const byId = new Map((datasets.data ?? []).map((d) => [d.id, d]))
  const [newRun, setNewRun] = useState(false)
  const [csv, setCsv] = useState(false)

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">Rating Integrity Engine</h1>
        <span className="text-xs text-muted-foreground">Runs</span>
        <div className="ml-auto flex items-center gap-1">
          <Link to="/help" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <CircleHelp />
            How it works
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        <section aria-label="Runs" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Recent runs</h2>
            {source.canStartRuns && (
              <>
                <Button size="sm" variant="outline" onClick={() => setCsv(true)}>
                  <FileUp />
                  Add CSV dataset
                </Button>
                <Button size="sm" onClick={() => setNewRun(true)} disabled={!datasets.data?.some((d) => d.status === 'ready')}>
                  <Plus />
                  New run
                </Button>
              </>
            )}
          </div>
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
      {source.canStartRuns && datasets.data && (
        <>
          {newRun && <NewRunSheet open={newRun} onOpenChange={setNewRun} datasets={datasets.data} runs={runs.data ?? []} />}
          <CsvDatasetSheet open={csv} onOpenChange={setCsv} />
        </>
      )}
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
            <TableHead className="text-right">Steam policy</TableHead>
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
                <TableCell className="num text-right">{s?.platform?.rating != null ? formatRating(s.platform.rating, scale) : '—'}</TableCell>
                <TableCell className="num text-right">{formatUsd(r.cost_usd)}</TableCell>
                <TableCell className="num text-right text-xs text-muted-foreground">
                  {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === 'done' && (
                    <span className="flex justify-end gap-3 text-xs">
                      <Link to={`/runs/${r.id}/results`} className="font-medium underline-offset-4 hover:underline">
                        Results
                      </Link>
                      <Link to={`/runs/${r.id}?play=end`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                        Final state
                      </Link>
                    </span>
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
