import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { buttonVariants } from '@/components/ui/button'
import { useDataSource } from '@/data/source'
import { cn } from '@/lib/utils'

/** Shared top bar of the three run views: tabs left, run stages centre, help and theme right. */
export function RunHeader({ runId, children }: { runId: string; children?: ReactNode }) {
  const source = useDataSource()
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => source.getRun(runId) })
  const done = run.data?.status === 'done'
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative rounded-sm px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
      isActive && 'text-foreground after:absolute after:inset-x-2.5 after:-bottom-[11px] after:h-0.5 after:bg-foreground',
    )
  const off = 'cursor-not-allowed px-2.5 py-1 text-xs font-medium text-muted-foreground/50'
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
      <Link to="/" aria-label="Choose another game" title="Choose another game" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <ArrowLeft />
      </Link>
      <nav aria-label="Run views" className="flex items-center">
        <NavLink end to={`/runs/${runId}`} className={tab}>
          Live
        </NavLink>
        {(['results', 'reviews'] as const).map((v) =>
          done ? (
            <NavLink key={v} to={`/runs/${runId}/${v}`} className={tab}>
              {v === 'results' ? 'Results' : 'Reviews'}
            </NavLink>
          ) : (
            <span key={v} className={off} title="Available when the run is done">
              {v === 'results' ? 'Results' : 'Reviews'}
            </span>
          ),
        )}
      </nav>
      {/* stages: centred on wide screens, their own row on narrow ones */}
      <div className="order-last w-full min-w-0 overflow-x-auto lg:order-none lg:mx-auto lg:w-auto">{children}</div>
      <div className="ml-auto flex items-center gap-1 lg:ml-0">
        <Link to="/help" aria-label="How it works" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <CircleHelp />
          <span className="hidden sm:inline">How it works</span>
        </Link>
        <ThemeToggle />
      </div>
    </header>
  )
}
