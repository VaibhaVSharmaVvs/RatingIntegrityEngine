import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { buttonVariants } from '@/components/ui/button'
import { useDataSource } from '@/data/source'
import { cn } from '@/lib/utils'

/** Shared top bar of the three run views: live analysis, results, reviews table. */
export function RunHeader({ runId, children }: { runId: string; children?: ReactNode }) {
  const source = useDataSource()
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => source.getRun(runId) })
  const datasetId = run.data?.dataset_id
  const dataset = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => source.getDataset(datasetId!),
    enabled: !!datasetId,
    staleTime: Infinity,
  })
  const done = run.data?.status === 'done'
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-sm',
      isActive && 'text-foreground after:absolute after:inset-x-2.5 after:-bottom-[11px] after:h-0.5 after:bg-foreground',
    )
  const off = 'px-2.5 py-1 text-xs font-medium text-muted-foreground/50 cursor-not-allowed'
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
      <Link to="/" aria-label="All runs" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <ArrowLeft />
      </Link>
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{dataset.data?.name ?? 'Loading run…'}</h1>
        <p className="num truncate font-mono text-[11px] text-muted-foreground">
          {runId} · {run.data?.backend ?? '…'}
          {run.data?.model_version ? ` · ${run.data.model_version}` : ''}
          {run.data ? ` · question set ${run.data.config.question_set}` : ''}
        </p>
      </div>
      <nav aria-label="Run views" className="flex items-center">
        <NavLink end to={`/runs/${runId}`} className={tab}>
          Live
        </NavLink>
        {done ? (
          <>
            <NavLink to={`/runs/${runId}/results`} className={tab}>
              Results
            </NavLink>
            <NavLink to={`/runs/${runId}/reviews`} className={tab}>
              Reviews
            </NavLink>
          </>
        ) : (
          <>
            <span className={off} title="Available when the run is done">
              Results
            </span>
            <span className={off} title="Available when the run is done">
              Reviews
            </span>
          </>
        )}
      </nav>
      <div className="mx-auto min-w-0">{children}</div>
      <div className="flex items-center gap-1">
        <Link to="/help" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <CircleHelp />
          How it works
        </Link>
        <ThemeToggle />
      </div>
    </header>
  )
}
