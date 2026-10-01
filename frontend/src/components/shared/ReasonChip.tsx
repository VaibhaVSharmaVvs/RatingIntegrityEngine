import { Link } from 'react-router-dom'
import { REASONS, reasonHelpHref, reasonLabel } from '@/lib/methodology'
import { cn } from '@/lib/utils'

/** A decision reason in words, linking to the rule that produced it on the help page. */
export function ReasonChip({ code, className }: { code: string; className?: string }) {
  return (
    <Link
      to={reasonHelpHref(code)}
      title={REASONS[code]?.short ?? code}
      className={cn(
        'inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 text-[11px] leading-tight text-foreground/85 underline-offset-2 transition-colors outline-none hover:bg-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {reasonLabel(code)}
    </Link>
  )
}

export function ReasonList({ codes, className }: { codes: string[]; className?: string }) {
  if (codes.length === 0) return null
  return (
    <ul className={cn('flex flex-wrap gap-1', className)} aria-label="Reasons">
      {codes.map((c) => (
        <li key={c}>
          <ReasonChip code={c} />
        </li>
      ))}
    </ul>
  )
}
