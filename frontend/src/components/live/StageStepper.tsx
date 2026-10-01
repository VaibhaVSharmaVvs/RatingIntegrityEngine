import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STAGES, useRunStore, type StageName, type StageStatus } from '@/state/runStore'

const LABELS: Record<StageName, string> = {
  ingest: 'Ingest',
  features: 'Features',
  systemone: 'System One',
  corpus: 'Corpus',
  decide: 'Decide',
}

const STATUS_WORDS: Record<StageStatus, string> = {
  pending: 'waiting',
  started: 'running',
  done: 'done',
  skipped: 'skipped',
}

function Marker({ status }: { status: StageStatus }) {
  if (status === 'done')
    return (
      <span className="grid size-4 place-items-center rounded-full bg-foreground text-background">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    )
  if (status === 'skipped')
    return (
      <span className="grid size-4 place-items-center rounded-full border border-muted-foreground/50 text-muted-foreground">
        <Minus className="size-2.5" strokeWidth={3} />
      </span>
    )
  if (status === 'started')
    return (
      <span className="relative grid size-4 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-foreground/30" />
        <span className="size-2 rounded-full bg-foreground" />
      </span>
    )
  return <span className="size-4 rounded-full border border-muted-foreground/40" />
}

/** Ingest → Features → System One → Corpus → Decide, with seconds per stage once known. */
export function StageStepper({ timings }: { timings?: Record<string, number> }) {
  const stages = useRunStore((s) => s.stages)
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Pipeline stages">
      {STAGES.map((name, i) => {
        const status = stages[name]
        const secs = timings?.[name]
        return (
          <li key={name} className="flex items-center gap-1">
            {i > 0 && (
              <span
                aria-hidden
                className={cn('h-px w-4 bg-border sm:w-6', status !== 'pending' && 'bg-muted-foreground/60')}
              />
            )}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full py-1 pr-2 pl-1 text-xs',
                status === 'pending' ? 'text-muted-foreground' : 'text-foreground',
                status === 'skipped' && 'text-muted-foreground',
              )}
              aria-label={`${LABELS[name]}: ${STATUS_WORDS[status]}`}
            >
              <Marker status={status} />
              <span className="font-medium">{LABELS[name]}</span>
              {secs != null && <span className="num text-[11px] text-muted-foreground">{secs.toFixed(1)}s</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
