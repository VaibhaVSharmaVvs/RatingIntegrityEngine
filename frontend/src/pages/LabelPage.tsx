import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button, buttonVariants } from '@/components/ui/button'
import { useDataSource } from '@/data/source'
import { cn } from '@/lib/utils'

/**
 * Blind labelling for the agreement benchmark (Phase 7). Raters see only the review and
 * its verdict, answer the same questions System One answers, and never see the engine's
 * output. Keys mirror backend HUMAN_LABELS.
 */
const QUESTIONS: { key: string; ask: string; hint: string; options: [string, string][] }[] = [
  {
    key: 'about_game',
    ask: 'Is the review about the game itself?',
    hint: 'Gameplay, content, story, performance, bugs, price, or requirements that change the product. “No” only if it is aimed solely at the company, politics, other products or outside events.',
    options: [
      ['yes', 'Yes'],
      ['no', 'No'],
    ],
  },
  {
    key: 'verdict_basis',
    ask: 'Is the thumbs up / down based on playing the game?',
    hint: '“Other” if the verdict is mainly driven by the company’s conduct, terms or EULA changes, DRM, mandatory accounts, politics or outside events, even if the game is mentioned.',
    options: [
      ['playing', 'Playing'],
      ['other', 'Other'],
    ],
  },
  {
    key: 'contradicts',
    ask: 'Does the text argue against its own verdict?',
    hint: 'E.g. “Not recommended” over a text that praises the game. A mixed review that still supports its verdict is “No”.',
    options: [
      ['no', 'No'],
      ['yes', 'Yes'],
    ],
  },
  {
    key: 'spam',
    ask: 'Is it spam or promotion?',
    hint: 'Advertising, referral links, key resellers, giveaways, “check out my channel”.',
    options: [
      ['no', 'No'],
      ['yes', 'Yes'],
    ],
  },
  {
    key: 'copied',
    ask: 'Is it copied or template text?',
    hint: 'Copypasta, song lyrics, a famous quote, a meme catchphrase or a fill-in template. Short own words like “good game” are “No”.',
    options: [
      ['no', 'No'],
      ['yes', 'Yes'],
    ],
  },
  {
    key: 'overall',
    ask: 'How much should it count in the rating?',
    hint: 'Your own judgment as a reader: full weight, reduced (low evidential value), or not at all.',
    options: [
      ['keep', 'Full'],
      ['downweight', 'Reduced'],
      ['exclude', 'Not at all'],
    ],
  },
]
const DEFAULTS: Record<string, string> = Object.fromEntries(QUESTIONS.map((q) => [q.key, q.options[0][0]]))
const RATER_KEY = 'rie.rater'

export function LabelPage() {
  const source = useDataSource()
  if (!source.canStartRuns) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-sm text-muted-foreground">
        Labelling runs on a local copy of the engine only.
      </div>
    )
  }
  return <Labelling />
}

function Labelling() {
  const source = useDataSource()
  const [params, setParams] = useSearchParams()
  const set = params.get('set') ?? ''
  const rater = params.get('rater') ?? ''
  const sets = useQuery({ queryKey: ['labelsets'], queryFn: () => source.listLabelSets(), enabled: !set || !rater })

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Link to="/" aria-label="Home" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
          <ArrowLeft />
        </Link>
        <h1 className="text-sm font-semibold">Label reviews</h1>
        {set && rater && (
          <span className="num font-mono text-[11px] text-muted-foreground">
            {set} · {rater}
          </span>
        )}
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      {set && rater ? (
        <Labeller set={set} rater={rater} />
      ) : (
        <Start
          sets={sets.data ?? []}
          error={sets.error?.message}
          onStart={(s, r) => {
            try {
              localStorage.setItem(RATER_KEY, r)
            } catch {
              /* not remembered; fine */
            }
            setParams({ set: s, rater: r })
          }}
        />
      )}
    </div>
  )
}

function Start({
  sets,
  error,
  onStart,
}: {
  sets: { name: string; size: number; labelled: Record<string, number> }[]
  error?: string
  onStart: (set: string, rater: string) => void
}) {
  const [rater, setRater] = useState(() => {
    try {
      return localStorage.getItem(RATER_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [set, setSet] = useState('')
  const chosen = set || sets[0]?.name || ''
  const valid = /^[A-Za-z0-9_.-]{1,40}$/.test(rater)
  const field = 'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-12">
      <p className="text-sm text-muted-foreground">
        You will see each review and its thumbs up / down, and answer six questions. You will not see what the engine decided. Label independently: don’t
        compare answers with the other rater until both are done.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && chosen) onStart(chosen, rater)
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Label set</span>
          <select className={field} value={chosen} onChange={(e) => setSet(e.target.value)}>
            {sets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.size} reviews)
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium">Your rater handle</span>
          <input className={field} value={rater} onChange={(e) => setRater(e.target.value.trim())} placeholder="e.g. vs" />
          <span className="block text-[11px] text-muted-foreground">Initials or a handle, not your full name. Letters, digits, “.”, “_” or “-”.</span>
        </label>
        <Button type="submit" className="w-full" disabled={!valid || !chosen}>
          Start labelling
        </Button>
      </form>
    </main>
  )
}

function Labeller({ set, rater }: { set: string; rater: string }) {
  const source = useDataSource()
  const qc = useQueryClient()
  const data = useQuery({ queryKey: ['labelset', set, rater], queryFn: () => source.getLabelSet(set, rater) })
  const items = data.data?.items ?? []
  const firstOpen = Math.max(0, items.findIndex((i) => !i.label))
  const [pos, setPos] = useState<number | null>(null)
  const index = pos ?? firstOpen
  const item = items[index]
  // unsaved edits per review; otherwise the saved label, otherwise the defaults
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({})
  const draft = (item && edits[item.review_id]) ?? item?.label ?? DEFAULTS
  const setDraft = (f: (d: Record<string, string>) => Record<string, string>) =>
    item && setEdits((e) => ({ ...e, [item.review_id]: f(draft) }))

  const save = useMutation({
    mutationFn: () => source.putLabel(set, item!.review_id, rater, draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['labelset', set, rater] })
      setEdits((e) => {
        const { [item!.review_id]: _saved, ...rest } = e
        return rest
      })
      setPos(Math.min(index + 1, items.length - 1))
    },
  })
  const done = items.filter((i) => i.label).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Enter' && item && !save.isPending) save.mutate()
      if (e.key === 'ArrowRight') setPos(Math.min(index + 1, items.length - 1))
      if (e.key === 'ArrowLeft') setPos(Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, item, save])

  if (data.isError) return <p className="p-6 text-sm text-destructive">{data.error.message}</p>
  if (!item) return <div className="mx-auto mt-12 h-64 max-w-2xl animate-pulse rounded-lg bg-muted" />

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="space-y-1.5">
        <div className="num flex items-baseline justify-between text-xs text-muted-foreground">
          <span>
            Review {index + 1} of {items.length}
          </span>
          <span>
            <span className="font-medium text-foreground">{done}</span> labelled
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Labelled">
          <div className="h-full bg-foreground transition-transform duration-200" style={{ transform: `scaleX(${done / items.length})`, transformOrigin: 'left' }} />
        </div>
      </div>

      <article aria-label="Review" className="rounded-lg bg-card p-4 ring-1 ring-border">
        <p className="mb-2 text-xs font-medium">
          {data.data?.subject} · {item.recommended ? 'Recommended' : 'Not recommended'}
          {item.label && <span className="ml-2 font-normal text-muted-foreground">(labelled; saving replaces it)</span>}
        </p>
        <p className="max-h-72 overflow-y-auto text-sm leading-relaxed text-pretty whitespace-pre-line">{item.text || <em className="text-muted-foreground">(empty)</em>}</p>
      </article>

      <fieldset className="space-y-4">
        <legend className="sr-only">Labels</legend>
        {QUESTIONS.map((q) => (
          <div key={q.key} role="radiogroup" aria-label={q.ask} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div>
              <p className="text-sm font-medium">{q.ask}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{q.hint}</p>
            </div>
            <div className="flex gap-1">
              {q.options.map(([value, label]) => {
                const on = draft[q.key] === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDraft((d) => ({ ...d, [q.key]: value }))}
                    className={cn(
                      'h-8 min-w-16 rounded-md border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      on ? 'border-foreground bg-foreground text-background' : 'border-input text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Previous review" disabled={index === 0} onClick={() => setPos(index - 1)}>
          <ChevronLeft />
        </Button>
        <Button className="flex-1" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save and next'} <span className="ml-1 text-[11px] opacity-60">Enter</span>
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next review" disabled={index === items.length - 1} onClick={() => setPos(index + 1)}>
          <ChevronRight />
        </Button>
      </div>
      {save.isError && <p className="text-xs text-destructive">{save.error.message}</p>}
      {done === items.length && <p className="text-sm font-medium">All {items.length} reviews labelled. Thank you.</p>}
    </main>
  )
}
