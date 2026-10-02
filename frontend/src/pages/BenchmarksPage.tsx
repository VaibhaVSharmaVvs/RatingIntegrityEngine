import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { buttonVariants } from '@/components/ui/button'
import type { BenchmarkOut } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatUsd } from '@/lib/format'

/** Phase 7 results as the bench_*.py scripts recorded them (GET /benchmarks). No numbers are derived here. */
const ATTACKS: [string, string][] = [
  ['template_flood', 'Template flood'],
  ['paraphrase_flood', 'Paraphrase flood'],
  ['coordinated_burst', 'Coordinated burst'],
  ['astroturf_flood', 'Astroturf flood'],
  ['spam', 'Spam'],
]
const VERSIONS: [string, string][] = [
  ['repeat', 'Identical repeat (noise)'],
  ['claim_prefix', 'Legitimacy claim before'],
  ['claim_suffix', 'Legitimacy claim after'],
  ['injection', 'Note to the AI'],
  ['paraphrase_claim', 'Paraphrased claim'],
  ['paraphrase_note', 'Note to “the system”'],
  ['authority', '“Verified veteran” claim'],
]
const VERSION_LABEL = Object.fromEntries(VERSIONS)

type M = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- metrics are script-defined JSON

const pct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(100 * v).toFixed(d)}%`)

export function BenchmarksPage() {
  const source = useDataSource()
  const q = useQuery({ queryKey: ['benchmarks'], queryFn: () => source.listBenchmarks() })
  // a re-recorded benchmark replaces the earlier row of the same name 
  const byTime = [...(q.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const latest = [...new Map(byTime.map((b) => [b.name, b])).values()]
  const by = (k: BenchmarkOut['kind']) => latest.filter((b) => b.kind === k)
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Link to="/" aria-label="Home" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
          <ArrowLeft />
        </Link>
        <h1 className="text-sm font-semibold">Benchmarks</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6">
        {q.isError ? (
          <p className="text-sm text-muted-foreground">Could not load benchmarks: {q.error.message}</p>
        ) : q.isPending ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        ) : (
          <>
            <AttackSection rows={by('attack')} ablations={by('ablation')} />
            <Section
              title="Ablations"
              lead="The same attack benchmark with one signal switched off (cached runs: the same Jev answers, so differences come from the policy alone), and Jev with five reviews per call."
            >
              {by('ablation').some((b) => (b.metrics as M).per_type) ? (
                <AttackTable rows={by('ablation').filter((b) => (b.metrics as M).per_type)} />
              ) : (
                <Empty />
              )}
              {by('ablation')
                .filter((b) => (b.metrics as M).pairs)
                .map((b) => (
                  <ClusterPenaltyTable key={b.id} row={b} />
                ))}
            </Section>
            <ControlSection rows={by('control')} />
            <AdversarialSection rows={by('adversarial')} />
            <AgreementSection rows={by('agreement')} />
          </>
        )}
      </main>
    </div>
  )
}

function Section({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4">
      <div className="max-w-3xl space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  )
}

function AttackSection({ rows, ablations = [] }: { rows: BenchmarkOut[]; ablations?: BenchmarkOut[] }) {
  // ablations that change the cost (packing) belong on the cost axis; leave-one-out runs
  // reuse the same answers, so they would all sit on one vertical line
  const chartAblations = ablations.filter((b) => /pack \d+/.test(b.name))
  return (
    <Section
      title="Synthetic attacks"
      lead={
        <>
          5,000 real Helldivers 2 reviews from April 2024, plus 690 injected attack reviews with exact ground truth. “Discounted” is the share of each attack
          that lost weight (downweighted or excluded). “Pull removed” is how much of the attack’s effect on the raw rating the adjusted rating undoes,
          measured against a run on the same reviews without the attack.
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-6">
          <AttackTable rows={rows} />
          <CostAccuracy rows={[...rows, ...chartAblations]} />
        </div>
      )}
    </Section>
  )
}

function AttackTable({ rows }: { rows: BenchmarkOut[] }) {
  return (
  <div className="overflow-x-auto rounded-md border border-border">
    <table className="num w-full text-xs">
      <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">Method</th>
          {ATTACKS.map(([k, label]) => (
            <th key={k} className="px-3 py-2 text-right font-medium">
              {label}
            </th>
          ))}
          <th className="px-3 py-2 text-right font-medium">Pull removed</th>
          <th className="px-3 py-2 text-right font-medium" title="Organic reviews pulled into a penalised cluster only when the attack is present">
            Collateral
          </th>
          <th className="px-3 py-2 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((b) => {
          const m = b.metrics as M
          return (
            <tr key={b.id}>
              <td className="px-3 py-2 font-medium whitespace-nowrap">{b.name.split(' · ').slice(1).join(' · ') || b.name}</td>
              {ATTACKS.map(([k]) => (
                <td key={k} className="px-3 py-2 text-right font-mono">
                  {pct(m.per_type?.[k]?.discounted)}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono font-semibold">{pct(m.rating?.shift_removed)}</td>
              <td className="px-3 py-2 text-right font-mono">{m.collateral?.organic_newly_in_penalised_cluster ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono">{formatUsd(b.cost_usd)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
  )
}

/** One series: each method as a dot, cost per 1,000 reviews vs pull removed. Direct labels; table alongside. */
function CostAccuracy({ rows }: { rows: BenchmarkOut[] }) {
  const pts = rows
    .map((b) => {
      const m = b.metrics as M
      const n = (m.n_organic ?? 0) * 2 + (m.n_injected ?? 0) // the clean and attacked runs together
      // short chart label: the method without the parenthetical detail the table carries
      const label = (b.name.split(' · ').slice(1).join(' · ') || b.name).replace(/\s*\(.*\)$/, '')
      return { id: b.id, label, x: n ? (1000 * b.cost_usd) / n : 0, y: m.rating?.shift_removed as number | null }
    })
    .filter((p) => p.y != null) as { id: string; label: string; x: number; y: number }[]
  if (pts.length === 0) return null
  const W = 560
  const H = 240
  const pad = { l: 52, r: 12, t: 12, b: 34 }
  const xMax = Math.max(0.1, ...pts.map((p) => p.x)) * 1.15
  const X = (v: number) => pad.l + (v / xMax) * (W - pad.l - pad.r)
  const Y = (v: number) => H - pad.b - v * (H - pad.t - pad.b)
  // labels: points near the right edge label leftwards; stacked labels keep 12px apart
  const labelled = [...pts]
    .sort((a, b) => b.y - a.y)
    .reduce<(typeof pts[number] & { ly: number; left: boolean })[]>((acc, p) => {
      const left = X(p.x) > W * 0.6
      const prev = acc.filter((q) => q.left === left).at(-1)
      const ly = prev ? Math.max(Y(p.y), prev.ly + 12) : Y(p.y)
      return [...acc, { ...p, ly, left }]
    }, [])
  return (
    <figure className="max-w-xl space-y-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cost per 1,000 reviews against share of the attack's pull removed">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} className="stroke-border" strokeWidth={1} />
            <text x={pad.l - 6} y={Y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
              {t * 100}%
            </text>
          </g>
        ))}
        {[0, xMax / 2, xMax].map((t) => (
          <text key={t} x={X(t)} y={H - pad.b + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            ${t.toFixed(3)}
          </text>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          Jev cost per 1,000 reviews
        </text>
        <text
          transform={`translate(12 ${(pad.t + H - pad.b) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          attack’s pull removed
        </text>
        {pts.map((p) => (
          <g key={p.id} tabIndex={0} className="outline-none focus-visible:[&>circle]:stroke-ring">
            <title>{`${p.label}: ${pct(p.y)} of the pull removed, $${p.x.toFixed(4)} per 1,000 reviews`}</title>
            <circle cx={X(p.x)} cy={Y(p.y)} r={12} className="fill-transparent" />
            <circle cx={X(p.x)} cy={Y(p.y)} r={4.5} className="fill-foreground stroke-background" strokeWidth={2} />
          </g>
        ))}
        {labelled.map((l) => (
          <g key={l.id} aria-hidden>
            {Math.abs(l.ly - Y(l.y)) > 2 && <line x1={X(l.x) + 5} x2={X(l.x) + 12} y1={Y(l.y)} y2={l.ly} className="stroke-muted-foreground" strokeWidth={0.75} />}
            <text x={X(l.x) + (l.left ? -8 : 14)} y={l.ly} dy="0.32em" textAnchor={l.left ? 'end' : 'start'} className="fill-foreground text-[10px]">
              {l.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-[11px] text-muted-foreground">
        Policy variants reuse one Jev run’s answers, so they share its cost; packing several reviews per call is the only cheaper Jev option. Question set
        v5 was measured on the adversarial and genuine-review sets, not on this benchmark.
      </figcaption>
    </figure>
  )
}

function ClusterPenaltyTable({ row }: { row: BenchmarkOut }) {
  const pairs = (row.metrics as M).pairs as M[]
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="num w-full text-xs">
        <caption className="px-3 pt-2 text-left text-[11px] font-medium text-muted-foreground">{row.name}</caption>
        <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Dataset</th>
            <th className="px-3 py-2 text-right font-medium">Normal-period decisions changed</th>
            <th className="px-3 py-2 text-right font-medium">In bursts</th>
            <th className="px-3 py-2 text-right font-medium">Rating move</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pairs.map((p) => (
            <tr key={p.dataset}>
              <td className="px-3 py-2 font-medium">{p.dataset}</td>
              <td className="px-3 py-2 text-right font-mono">
                {p.normal.changed.toLocaleString()} <span className="text-muted-foreground">of {p.normal.reviews.toLocaleString()}</span>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {p.bursts.changed.toLocaleString()} <span className="text-muted-foreground">of {p.bursts.reviews.toLocaleString()}</span>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {p.move_pp >= 0 ? '+' : '−'}
                {Math.abs(p.move_pp).toFixed(2)} pp
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ControlSection({ rows }: { rows: BenchmarkOut[] }) {
  return (
    <Section
      title="Control games"
      lead="Genuine reception the engine must leave alone: a troubled launch, a genuinely bad game and a launch backlash. “False positives” are negative reviews about the game itself that lost weight anyway."
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="num w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Game</th>
                <th className="px-3 py-2 text-right font-medium">Raw</th>
                <th className="px-3 py-2 text-right font-medium">Adjusted</th>
                <th className="px-3 py-2 text-right font-medium">Move</th>
                <th className="px-3 py-2 text-right font-medium">Raw inside 95% CI</th>
                <th className="px-3 py-2 text-right font-medium">On-topic negatives discounted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((b) => {
                const m = b.metrics as M
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2 font-medium">{m.dataset}</td>
                    <td className="px-3 py-2 text-right font-mono">{pct(m.raw, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono">{pct(m.adjusted, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {m.move_pp > 0 ? '+' : '−'}
                      {Math.abs(m.move_pp).toFixed(1)} pp
                    </td>
                    <td className="px-3 py-2 text-right">{m.raw_inside_ci ? 'yes' : 'no'}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {pct(m.fp_rate_on_topic_negatives, 1)}{' '}
                      <span className="text-muted-foreground">
                        ({m.on_topic_negatives_discounted.toLocaleString()} of {m.on_topic_negatives.toLocaleString()})
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function AdversarialSection({ rows }: { rows: BenchmarkOut[] }) {
  // one table per adversarial set; a row per configuration (question set, stripping)
  const sets = [...new Set(rows.map((b) => (b.metrics as M).set ?? 'v1'))].sort()
  return (
    <Section
      title="Reviews that argue for their own legitimacy"
      lead="150 real reviews, each judged as written and again with one added sentence. Set v1 uses common wordings; set v2 uses wordings no detection pattern lists. “Laundered” is the share of the 100 off-topic reviews that crossed above the downweight line and would regain full weight; the identical repeat is System One’s own noise. With question set v5, a kept review with a manipulative sentence added is meant to lose weight too."
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        sets.map((set) => {
          const rs = rows.filter((b) => ((b.metrics as M).set ?? 'v1') === set)
          const versions: string[] = (rs[0].metrics as M).versions ?? VERSIONS.map(([k]) => k)
          return (
            <div key={set} className="overflow-x-auto rounded-md border border-border">
              <table className="num w-full text-xs">
                <caption className="px-3 pt-2 text-left text-[11px] font-medium text-muted-foreground">Set {set}: off-topic reviews laundered</caption>
                <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Configuration</th>
                    {versions.map((v) => (
                      <th key={v} className="px-3 py-2 text-right font-medium">
                        {VERSION_LABEL[v] ?? v.replaceAll('_', ' ')}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium" title="Kept reviews with the manipulative sentence added that lost weight. Under v5 that is intended: the added sentence is the manipulation.">
                      Kept reviews downweighted (max)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rs.map((b) => {
                    const g = (b.metrics as M).groups
                    return (
                      <tr key={b.id}>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{b.name.split(' · ').slice(1).join(' · ')}</td>
                        {versions.map((v) => (
                          <td key={v} className="px-3 py-2 text-right font-mono">
                            {pct(g.offtopic[v]?.laundered)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono">{pct(Math.max(...versions.map((v) => g.kept[v]?.harmed ?? 0)))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </Section>
  )
}

function AgreementSection({ rows }: { rows: BenchmarkOut[] }) {
  const b = rows.at(-1)
  const keys = ['about_game', 'verdict_basis', 'contradicts', 'spam', 'copied', 'overall']
  return (
    <Section
      title="Agreement with human raters"
      lead={
        <>
          300 Helldivers 2 reviews labelled blind by two people, scored with Cohen’s κ per question: human against human, and each human against the
          engine. κ near 0 on a rare class (spam) says little; the raw agreement and rates are in the recorded JSON.{' '}
          <Link to="/label" className="underline underline-offset-2">
            Label reviews
          </Link>
        </>
      }
    >
      {!b ? (
        <p className="text-sm text-muted-foreground">Waiting for both raters to finish labelling.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="num w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Pair</th>
                {keys.map((k) => (
                  <th key={k} className="px-3 py-2 text-right font-medium">
                    {k.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries((b.metrics as M).pairs as Record<string, M>).map(([pair, t]) => (
                <tr key={pair}>
                  <td className="px-3 py-2 font-medium">{pair}</td>
                  {keys.map((k) => (
                    <td key={k} className="px-3 py-2 text-right font-mono">
                      {t[k]?.all?.kappa == null ? '—' : t[k].all.kappa.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
}

