import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { DatasetOut, RunCreate, RunOut } from '@/data/api'
import { ApiError } from '@/data/DataSource'
import { useDataSource } from '@/data/source'
import { formatDuration, formatInt, formatUsd } from '@/lib/format'

type Backend = NonNullable<RunCreate['backend']>

const BACKENDS: { value: Backend; label: string; note: string }[] = [
  { value: 'jev', label: 'Jev (hosted System One)', note: 'One call per review. Costs money: see the estimate below.' },
  { value: 'cached', label: 'Replay a finished run’s answers', note: '$0. Same System One answers, new policy settings.' },
  { value: 'heuristic', label: 'Heuristics only', note: '$0 baseline without System One.' },
  { value: 'laya', label: 'Laya (local, benchmark)', note: 'Needs laya-serve on :8000. Slow on CPU.' },
  { value: 'mock', label: 'Mock System One', note: '$0, paced, for demos of the live screen.' },
]
const QUESTION_SETS = ['v4', 'v3', 'v2', 'v1'] as const

export const fieldClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

/** Run config with the pre-flight estimate; a run above the spend limit needs an explicit confirmation. */
export function NewRunSheet({
  open,
  onOpenChange,
  datasets,
  runs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  datasets: DatasetOut[]
  runs: RunOut[]
}) {
  const source = useDataSource()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ready = datasets.filter((d) => d.status === 'ready')
  const [datasetId, setDatasetId] = useState(ready[0]?.id ?? '')
  const [backend, setBackend] = useState<Backend>('heuristic')
  const [questionSet, setQuestionSet] = useState<(typeof QUESTION_SETS)[number]>('v4')
  const [picked, setPicked] = useState('')
  // The confirmation belongs to one estimate: changing what is estimated clears it.
  const [confirmedFor, setConfirmedFor] = useState('')
  const estimateKey = `${datasetId}|${backend}|${questionSet}`
  const confirmed = confirmedFor === estimateKey

  const sources = runs.filter(
    (r) => r.dataset_id === datasetId && r.status === 'done' && ['jev', 'laya', 'cached'].includes(r.backend),
  )
  const reuseFrom = sources.some((r) => r.id === picked) ? picked : (sources[0]?.id ?? '')

  const req: RunCreate = {
    dataset_id: datasetId,
    backend,
    question_set: backend === 'cached' ? undefined : questionSet,
    reuse_judgments_from: backend === 'cached' ? reuseFrom || null : undefined,
    mock_latency_ms: backend === 'mock' ? 40 : undefined,
  }
  const paid = backend === 'jev'
  const pf = useQuery({
    queryKey: ['preflight', datasetId, backend, questionSet],
    queryFn: () => source.preflight(req),
    enabled: open && !!datasetId && paid,
    staleTime: 60_000,
  })
  const needsConfirm = !!pf.data?.needs_confirmation
  const start = useMutation({
    mutationFn: () => source.createRun({ ...req, confirm_cost: paid && needsConfirm ? confirmed : undefined }),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      onOpenChange(false)
      navigate(`/runs/${run.id}`)
    },
  })
  const blocked =
    !datasetId || start.isPending || (backend === 'cached' && !reuseFrom) || (paid && (!pf.data || (needsConfirm && !confirmed)))
  const note = BACKENDS.find((b) => b.value === backend)?.note

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-[440px]">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-sm">New run</SheetTitle>
          <SheetDescription className="text-xs">Every threshold and weight is recorded with the run.</SheetDescription>
        </SheetHeader>
        <form
          id="new-run"
          className="space-y-5 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!blocked) start.mutate()
          }}
        >
          <Field label="Dataset">
            <select className={fieldClass} value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              {ready.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({formatInt(d.n_reviews)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="System One" hint={note}>
            <select className={fieldClass} value={backend} onChange={(e) => setBackend(e.target.value as Backend)}>
              {BACKENDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          {backend === 'cached' ? (
            <Field label="Reuse answers from" hint={sources.length ? undefined : 'No finished System One run on this dataset yet.'}>
              <select className={fieldClass} value={reuseFrom} onChange={(e) => setPicked(e.target.value)} disabled={!sources.length}>
                {sources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} · {r.backend} · {r.config.question_set}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            backend !== 'heuristic' && (
              <Field label="Question set" hint="v4 is the default; released sets are never edited.">
                <select className={fieldClass} value={questionSet} onChange={(e) => setQuestionSet(e.target.value as typeof questionSet)}>
                  {QUESTION_SETS.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </Field>
            )
          )}

          {paid && (
            <section aria-label="Pre-flight estimate" className="rounded-md bg-muted/50 p-3">
              <h3 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Pre-flight estimate</h3>
              {pf.data ? (
                <>
                  <p className="num mt-1.5 text-2xl font-semibold tracking-tight">{formatUsd(pf.data.est_cost_usd)}</p>
                  <dl className="num mt-2 grid grid-cols-2 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Calls</dt>
                    <dd className="text-right">{formatInt(pf.data.calls)}</dd>
                    <dt className="text-muted-foreground">Input tokens</dt>
                    <dd className="text-right">{formatInt(pf.data.est_input_tokens)}</dd>
                    <dt className="text-muted-foreground">Time</dt>
                    <dd className="text-right">≈ {formatDuration(pf.data.est_seconds)}</dd>
                    <dt className="text-muted-foreground">Spend limit</dt>
                    <dd className="text-right">{formatUsd(pf.data.limit_usd)}</dd>
                  </dl>
                  <p className="mt-2 text-[11px] text-muted-foreground">The run stops if it reaches 1.25 × this estimate.</p>
                  {needsConfirm && (
                    <label className="mt-3 flex items-start gap-2 rounded-md border border-action-downweight/50 bg-action-downweight/10 p-2 text-xs">
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmedFor(e.target.checked ? estimateKey : '')} className="mt-0.5 size-3.5 accent-foreground" />
                      <span>
                        <AlertTriangle className="mr-1 inline size-3.5 -translate-y-px" aria-hidden />
                        Above the {formatUsd(pf.data.limit_usd)} limit. I accept an estimated {formatUsd(pf.data.est_cost_usd)}.
                      </span>
                    </label>
                  )}
                </>
              ) : pf.isError ? (
                <p className="mt-1.5 text-xs text-destructive">{pf.error.message}</p>
              ) : (
                <div className="mt-2 h-8 w-24 animate-pulse rounded bg-muted" />
              )}
            </section>
          )}
          {start.isError && (
            <p role="alert" className="text-xs text-destructive">
              {start.error instanceof ApiError && start.error.status === 402 ? `Spend guard: ${start.error.message}` : start.error.message}
            </p>
          )}
        </form>
        <SheetFooter className="border-t border-border">
          <Button type="submit" form="new-run" disabled={blocked}>
            <Play />
            {start.isPending ? 'Starting…' : paid && pf.data ? `Start run · ${formatUsd(pf.data.est_cost_usd)}` : 'Start run'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  )
}
