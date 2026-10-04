import { cn } from '@/lib/utils'
import { ACTION_LABELS, actionName, type ActionName } from '@/lib/palette'
import { STEAM_CLASSES, STEAM_LABELS, type SteamClass } from '@/lib/steamLens'
import { useRunStore } from '@/state/runStore'
import { useViewStore } from '@/state/viewStore'

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
        'inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap uppercase',
        className,
      )}
    >
      <Swatch action={action} />
      {ACTION_LABELS[action]}
    </span>
  )
}

const STEAM_SWATCH: Record<SteamClass, string> = {
  PENDING: 'bg-action-pending',
  COUNTS: 'bg-action-keep',
  WINDOW: 'bg-action-exclude',
  KEY: 'bg-action-flag',
}

/** Swatch for a Steam-policy class (the grid's Steam view). */
export function SteamSwatch({ cls, className }: { cls: SteamClass; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-[2px]', STEAM_SWATCH[cls], className)} />
}

export function SteamChip({ cls, className }: { cls: SteamClass; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap uppercase',
        className,
      )}
    >
      <SteamSwatch cls={cls} />
      {STEAM_LABELS[cls]}
    </span>
  )
}

/**
 * The chip for grid cell `index` in the grid's current view: its integrity action, or in
 * the Steam view its Steam-policy class, so the chip always names the colour on screen.
 */
export function CellChip({ index, className }: { index: number; className?: string }) {
  const steam = useViewStore((s) => (s.lens === 'steam' ? s.steam : null))
  useRunStore((s) => s.gridVersion)
  const action = actionName(useRunStore.getState().grid.actions[index] ?? 0)
  if (steam && action !== 'PENDING') return <SteamChip cls={STEAM_CLASSES[steam[index]]} className={className} />
  return <ActionChip action={action} className={className} />
}
