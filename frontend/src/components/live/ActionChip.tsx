import { cn } from '@/lib/utils'
import { ACTION_LABELS, type ActionName } from '@/lib/palette'

const SWATCH: Record<ActionName, string> = {
  PENDING: 'bg-action-pending',
  KEEP: 'bg-action-keep',
  DOWNWEIGHT: 'bg-action-downweight',
  FLAG: 'bg-action-flag',
  EXCLUDE: 'bg-action-exclude',
}

/** Colour square + word, so an action is never conveyed by colour alone. */
export function Swatch({ action, className }: { action: ActionName; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-[2px]', SWATCH[action], className)} />
}

export function ActionChip({ action, className }: { action: ActionName; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-medium tracking-wide uppercase',
        className,
      )}
    >
      <Swatch action={action} />
      {ACTION_LABELS[action]}
    </span>
  )
}
