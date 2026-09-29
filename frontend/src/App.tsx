import { Badge } from '@/components/ui/badge'

const ACTIONS = [
  ['KEEP', 'var(--action-keep)'],
  ['DOWNWEIGHT', 'var(--action-downweight)'],
  ['FLAG', 'var(--action-flag)'],
  ['EXCLUDE', 'var(--action-exclude)'],
] as const

export default function App() {
  return (
    <main className="dark min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-2xl font-semibold">Rating Integrity Engine</h1>
      <p className="mt-2 text-muted-foreground">Scaffold is up. Pipeline and live grid land in later phases.</p>
      <div className="mt-6 flex gap-2">
        {ACTIONS.map(([label, color]) => (
          <Badge key={label} style={{ backgroundColor: color }}>
            {label}
          </Badge>
        ))}
      </div>
    </main>
  )
}
