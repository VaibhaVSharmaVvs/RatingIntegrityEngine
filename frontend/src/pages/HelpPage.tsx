import { ArrowLeft } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ActionChip } from '@/components/live/ActionChip'
import { RailLegend, RatingRail } from '@/components/shared/RatingRail'
import { ThemeToggle } from '@/components/ThemeToggle'
import { buttonVariants } from '@/components/ui/button'
import { REASONS } from '@/lib/methodology'
import { cn } from '@/lib/utils'

/**
 * How the three ratings and the four actions work, in plain words. Every number here is
 * measured (docs/MEASUREMENTS.md, M10–M11) or a run-config default (backend app/models.py).
 */

const TOC = [
  ['three-ratings', 'Three ratings'],
  ['worked-examples', 'Worked examples'],
  ['actions', 'The four actions'],
  ['integrity', 'Integrity score'],
  ['rules', 'Rules that change an action'],
  ['reasons', 'Reason codes'],
  ['not-penalised', 'What is not penalised'],
  ['clusters', 'Bursts and clusters'],
  ['platform-policy', 'Steam policy, emulated'],
  ['limits', 'Limits'],
] as const

interface Example {
  game: string
  window: string
  raw: number
  adjusted: number
  ci: [number, number]
  platform: number
  platformCi: [number, number]
  reference?: number
  referenceLabel?: string
  note: string
}

/** MEASUREMENTS M11b / M11d, question set v4, one Jev call per review. */
const EXAMPLES: Example[] = [
  {
    game: 'Helldivers 2',
    window: '5,000 reviews, Apr–Jun 2024',
    raw: 0.764,
    adjusted: 0.776,
    ci: [0.764, 0.788],
    platform: 0.89,
    platformCi: [0.874, 0.905],
    reference: 0.88,
    referenceLabel: 'April 2024, before the bomb (88.0%)',
    note:
      'The PlayStation Network account bomb. Most bomb reviews still talk about the game, so the engine moves little. Steam’s rules remove the whole 3-day spike (2,117 reviews, 78% of its negatives not based on playing) and land on the pre-bomb level. Valve itself never flagged this window.',
  },
  {
    game: 'Borderlands 2',
    window: '12,981 reviews, Apr–Aug 2025',
    raw: 0.338,
    adjusted: 0.374,
    ci: [0.366, 0.383],
    platform: 0.507,
    platformCi: [0.491, 0.523],
    reference: 0.911,
    referenceLabel: 'Jan–Mar 2025 (91.1%)',
    note:
      'The EULA change. Steam’s wording counts EULA changes as off-topic, so its rules remove five windows (4,482 reviews) and 4,935 key activations. The engine counts terms that change the product as about the game, so it moves BL2 less. A buyer-facing rating arguably should stay below the old level here: the product did change.',
  },
  {
    game: 'Metro 2033 Redux',
    window: '2,444 reviews, Dec 2018–Mar 2019',
    raw: 0.488,
    adjusted: 0.629,
    ci: [0.608, 0.649],
    platform: 0.615,
    platformCi: [0.589, 0.642],
    reference: 0.938,
    referenceLabel: 'Sep–Nov 2018 (93.8%)',
    note:
      'The bomb was about a different game (Metro Exodus going Epic-exclusive). Reviews that are not about this game are caught one by one, so the engine makes its largest move: +14.1 pp, closing 31% of the gap to the earlier level.',
  },
  {
    game: 'Cities: Skylines II (control)',
    window: '5,000 reviews, Oct–Dec 2023',
    raw: 0.596,
    adjusted: 0.592,
    ci: [0.578, 0.606],
    platform: 0.599,
    platformCi: [0.584, 0.614],
    note: 'A genuinely troubled launch. Nothing moves beyond noise and no window is removed: complaints about the game are evidence, not manipulation.',
  },
  {
    game: 'Football Manager 26 (control)',
    window: '15,348 reviews, launch to now',
    raw: 0.38,
    adjusted: 0.372,
    ci: [0.364, 0.38],
    platform: 0.384,
    platformCi: [0.374, 0.393],
    note: 'An overwhelmingly negative launch backlash that is about the game. All three ratings stay within a point.',
  },
]

export function HelpPage() {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(decodeURIComponent(hash.slice(1)))
    el?.scrollIntoView?.({ block: 'start' })
    el?.classList.add('help-target')
    const id = setTimeout(() => el?.classList.remove('help-target'), 1600)
    return () => clearTimeout(id)
  }, [hash])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur">
        <Link to="/" aria-label="All runs" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
          <ArrowLeft />
        </Link>
        <h1 className="text-sm font-semibold">How the ratings work</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ol className="sticky top-20 space-y-1 border-l border-border text-xs">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l border-transparent py-0.5 pl-3 text-muted-foreground hover:border-foreground hover:text-foreground">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="max-w-[68ch] space-y-14 text-sm leading-relaxed [&_p]:text-pretty">
          <header className="space-y-3">
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Rating Integrity Engine</p>
            <p className="text-2xl leading-snug font-semibold tracking-tight text-balance">
              Every review gets an integrity weight. The rating is the weighted share of positive verdicts, shown next to the raw rating and the rating under the platform’s own rules.
            </p>
            <p className="text-muted-foreground">
              None of the three is the “true” rating. Each answers a different question, and the gaps between them are the finding.
            </p>
          </header>

          <Section id="three-ratings" title="Three ratings">
            <dl className="space-y-4">
              <Term name="Raw">Every review counts once, as the platform shows it today. This is what a store page displays.</Term>
              <Term name="Integrity-adjusted">
                This engine. System One answers typed questions about every review (is it about the game, does the text support its verdict, is it spam or
                copied text). Those answers become an integrity score per review; corpus analysis adds copies, bursts and coordinated clusters. Each review
                then counts with the weight of its action. The 95% interval is a bootstrap over reviews.
              </Term>
              <Term name="Platform policy (Steam)">
                Steam’s published rules applied to the same reviews. Since 2016, reviews from key activations (not bought on Steam) do not count. Since 2019, a
                spike of negative reviews whose focus is off-topic (explicitly including DRM and EULA changes) is removed whole, positives included.{' '}
                <a href="#platform-policy">How we emulate it</a>.
              </Term>
            </dl>
            <p className="text-muted-foreground">
              The engine judges each review on its own: an off-topic review is downweighted wherever it appears. Steam’s rules work on windows: inside a
              removed window even on-topic reviews are dropped, and outside one nothing is. That difference explains most gaps below.
            </p>
          </Section>

          <Section id="worked-examples" title="Worked examples">
            <RailLegend reference="Reference level (English reviews, earlier window)" />
            <ul className="space-y-8">
              {EXAMPLES.map((e) => (
                <li key={e.game} className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <h3 className="text-sm font-semibold">{e.game}</h3>
                    <span className="text-xs text-muted-foreground">{e.window}</span>
                  </div>
                  <RatingRail
                    scale="binary"
                    size="sm"
                    marks={{
                      raw: e.raw,
                      adjusted: e.adjusted,
                      ci: e.ci,
                      platform: e.platform,
                      platformCi: e.platformCi,
                      reference: e.reference,
                      referenceLabel: e.referenceLabel,
                    }}
                  />
                  <p className="num flex flex-wrap gap-x-4 text-xs">
                    <span>
                      Raw <b className="font-medium">{pct(e.raw)}</b>
                    </span>
                    <span>
                      Adjusted <b className="font-semibold">{pct(e.adjusted)}</b>
                    </span>
                    <span>
                      Steam policy <b className="font-medium">{pct(e.platform)}</b>
                    </span>
                    {e.reference != null && <span className="text-muted-foreground">Reference: {e.referenceLabel}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{e.note}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Reference levels assume the game did not change. That holds for Metro (the bomb was about another game). It does not hold for Borderlands 2,
              where the EULA change changed the product.
            </p>
          </Section>

          <Section id="actions" title="The four actions">
            <p>Each review gets one action. The action sets how much the review counts in the integrity-adjusted rating.</p>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                  <ActionRow action="KEEP" weight="1.00">
                    Integrity at or above the downweight line (0.55) and no rule applies.
                  </ActionRow>
                  <ActionRow action="DOWNWEIGHT" weight="0.25">
                    Integrity below 0.55, or a later copy of an earlier review. The review still counts, at a quarter: low evidential value, not zero.
                  </ActionRow>
                  <ActionRow action="FLAG" weight="1.00">
                    Needs a human: the model is unsure on questions that carry weight, spam without a deterministic promo signal, or a clustered review in the grey
                    zone. Counted as KEEP until someone looks.
                  </ActionRow>
                  <ActionRow action="EXCLUDE" weight="0.00">
                    Only with deterministic evidence: spam confirmed by a promo pattern, or a later copy inside a suspicious burst or cluster.
                  </ActionRow>
                </tbody>
              </table>
            </div>
            <Callout>System One’s answers alone can never EXCLUDE a review. Exclusion always needs a deterministic signal as well.</Callout>
          </Section>

          <Section id="integrity" title="Integrity score">
            <p>Each review starts at 1.00. Each weighted answer takes something off; the result is floored at 0.</p>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="num w-full text-xs">
                <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Takes off</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 font-medium">× the answer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <WeightRow name="Not about the game" w="0.60" x="1 − P(about the game)" />
                  <WeightRow name="Contradicts its verdict" w="0.50" x="P(the text argues against its own thumbs up / down)" />
                  <WeightRow name="Off-game, low playtime" w="0.20" x="1 − P(about the game), only under 2 h played" />
                  <WeightRow name="Spam or promotion" w="0.20" x="P(spam)" />
                  <WeightRow name="Copied text" w="0.15" x="P(copypasta, lyrics, template)" />
                  <WeightRow name="Low information / weak support" w="0" x="shown as evidence quality, not weighted" />
                </tbody>
              </table>
            </div>
            <p>
              A review aimed only at the company scores about 1 − 0.60 × 0.9 ≈ 0.46, below the 0.55 line: DOWNWEIGHT. “Love the game, hate the new EULA”
              is still about the game and keeps its weight. Open any review in the inspector to see its own arithmetic, line by line.
            </p>
          </Section>

          <Section id="rules" title="Rules that change an action">
            <dl className="space-y-4">
              <Term name="Later copies" id="rule-copies">
                A review that is a near-copy (character 5-shingle Jaccard ≥ 0.7) of an earlier one in the dataset is at least DOWNWEIGHTed. The first one keeps
                its weight, and every copy is still judged by System One, so a worse answer still wins. Texts under 8 tokens are never treated as copies:
                independent people do write “good game”.
              </Term>
              <Term name="Copies inside a burst" id="rule-burst-copies">
                A later copy inside a suspicious burst or cluster is EXCLUDEd. Copying is common; copying in a coordinated wave is evidence.
              </Term>
              <Term name="Spam and promotion" id="rule-spam">
                Spam above 0.9 <em>and</em> a deterministic promo pattern (Discord or Telegram invites, link shorteners, key resellers, free-key giveaways):
                EXCLUDE. Spam above 0.9 alone: FLAG for a human.
              </Term>
              <Term name="Low confidence" id="rule-confidence">
                Two or more questions that carry weight answered with confidence under 0.5: FLAG. Questions with no weight never send a review to a human. With
                question sets v3 and v4 only one weighted question (rating support) reports a confidence, so this rule does not currently fire: FLAGs come
                from spam and the grey zone.
              </Term>
              <Term name="Cluster penalty" id="rule-cluster">
                Members of a burst or cluster with suspicion above 0.5 and at least 10 reviews have their integrity multiplied by (1 − 0.5 × suspicion), then
                re-checked against the 0.55 line. Smaller groups are shown but never penalised.
              </Term>
              <Term name="Grey zone" id="rule-grey">
                A penalised cluster member whose integrity lands within 0.1 of the line is FLAGged rather than decided by a hair. Measured cost: +0.6% FLAGs on
                Helldivers 2.
              </Term>
            </dl>
            <p className="text-muted-foreground">Every threshold and weight here is run configuration, recorded with each run, and shown on its results page.</p>
          </Section>

          <Section id="reasons" title="Reason codes">
            <p>Each decision lists up to three reasons, largest first. Reason chips across the app link here.</p>
            <dl className="divide-y divide-border rounded-md border border-border">
              {Object.entries(REASONS)
                .filter(([code]) => code !== 'LOW_INFORMATIVENESS')
                .map(([code, r]) => (
                  <div key={code} id={`reason-${code.toLowerCase().replaceAll('_', '-')}`} className="scroll-mt-20 grid gap-1 px-3 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <dt className="text-xs font-medium">
                      {r.label}
                      <span className="block font-mono text-[10px] font-normal text-muted-foreground">{code}</span>
                    </dt>
                    <dd className="text-xs text-muted-foreground">{r.short}</dd>
                  </div>
                ))}
            </dl>
          </Section>

          <Section id="not-penalised" title="What is deliberately not penalised">
            <dl className="space-y-4">
              <Term name="Brevity">
                The specification first weighted informativeness. Measured, that was a length penalty, and length tracks the verdict: on Helldivers 2, 38.7% of
                positive reviews were downweighted against 19.5% of negatives (median 53 vs 105 characters). Turning those two weights off returned all three
                test games to their raw rating. Brevity is now shown as evidence quality and carries no weight.
              </Term>
              <Term name="Upweighting long reviews">
                The same bias from the other side: it moved Helldivers 2 by −2.5 pp, because negatives are the more informative reviews there. Rejected.
              </Term>
              <Term name="Low playtime on its own">
                49% of Gollum’s negatives (a game that is genuinely bad) were written under 2 hours; people who quit early are valid reviewers. Playtime
                buckets would have raised Gollum by 2.4 pp. Playtime only counts together with an off-game verdict.
              </Term>
              <Term name="Account signals per review">
                New accounts and single-review accounts never lower one review. They count only as a share inside a cluster, where a concentration is evidence.
              </Term>
              <Term name="On-topic complaint waves">
                A wave of negative reviews about the game (Cities: Skylines II, Football Manager 26) is reception, not manipulation. Both controls stay within a
                point, with no window removed.
              </Term>
            </dl>
          </Section>

          <Section id="clusters" title="Bursts, clusters and suspicion">
            <dl className="space-y-4">
              <Term name="Bursts">
                Hours whose review volume, per verdict, is far above a 7-day trailing baseline (robust z ≥ 6, the baseline leaving out hours already flagged).
                Change points in the daily rating mark where reception shifted.
              </Term>
              <Term name="Semantic clusters">
                Reviews that say the same thing in different words: sentence embeddings (MiniLM), reduced with UMAP on corpora of 2,000+ reviews, grouped with
                HDBSCAN.
              </Term>
              <Term name="Duplicate groups">Near-copies found with MinHash over character 5-shingles, verified with exact Jaccard ≥ 0.7.</Term>
            </dl>
            <p>
              Each group gets a suspicion score: the weighted geometric mean of the factors below. A geometric mean means one weak factor pulls the score down,
              so a group needs several kinds of evidence at once.
            </p>
            <ul className="space-y-1.5 text-xs">
              <li>
                <b className="font-medium">Time concentration</b>: how bunched in time, against random groups of the same size drawn from this corpus (never the
                corpus-wide rate: a cluster is a subset of the corpus). A burst is compared with its own trailing baseline.
              </li>
              <li>
                <b className="font-medium">Similar wording</b>: the share of members within cosine 0.8 of the group’s centre.
              </li>
              <li>
                <b className="font-medium">Same verdict</b>: how far the majority verdict is above a 50/50 split.
              </li>
              <li>
                <b className="font-medium">New or low-playtime accounts</b>: their share as a lift over this corpus, at half weight.
              </li>
              <li>
                <b className="font-medium">Off-topic</b>: the mean probability that a member’s topic is off-topic, a joke or platform policy.
              </li>
              <li>Each factor is floored at 0.02, and a factor with no data is skipped, so one missing signal cannot zero the score.</li>
            </ul>
          </Section>

          <Section id="platform-policy" title="Steam policy, emulated">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Key activations (reviews not bought on Steam) are left out, as Steam has done since September 2016.</li>
              <li>
                Our burst detector stands in for Steam’s spike detection. Valve’s manual review is replaced by one System One question,{' '}
                <code className="font-mono text-xs">verdict_basis</code>: is the verdict based on playing the game, or on the company, its terms, DRM,
                mandatory accounts, politics or outside events?
              </li>
              <li>A negative spike is removed whole, positives included, when more than half of its judged negatives (at least 20) are not based on playing.</li>
            </ol>
            <Callout>
              Steam’s written rules and Valve’s decisions differ. By the policy’s own wording, the Helldivers 2 PSN bomb and the Borderlands 2 EULA bomb
              qualify, but Steam still counts the Helldivers 2 bomb in full. Borderlands 2 does have 7,644 reviews excluded by Valve; which window they come
              from is not public.
            </Callout>
          </Section>

          <Section id="limits" title="Limits">
            <ul className="list-disc space-y-2 pl-5">
              <li>English-language reviews only.</li>
              <li>
                Reviews as they stand today. Steam lets people edit their verdicts: 77% of Helldivers 2 bomb-day reviews were edited later, mostly flipping to
                positive after the reversal. The verdict as posted is not available.
              </li>
              <li>System One is not deterministic: about 1% of decisions (62 of 4,999) differed between two identical runs on the same reviews; the rating moved by 0.05 pp.</li>
              <li>
                The contradiction rule has known false positives on mixed reviews (“cool game, but connecting to friends is virtually impossible”,
                Recommended). Its precision is measured against hand labels in the benchmark.
              </li>
              <li>The platform rating emulates Steam’s published rules. It is not Steam’s actual score, which depends on Valve’s own review.</li>
              <li>
                A coordinated campaign of varied, on-topic complaints is detected as a burst but not discounted: the engine does not downweight
                genuine-sounding complaints on timing alone. In the attack benchmark, 17% of such a burst lost weight.{' '}
                <Link to="/benchmarks">Benchmarks</Link>
              </li>
              <li>
                One added sentence claiming the review is honest, or a note addressed to the AI, lifted 30–39% of off-topic reviews back to full weight in
                testing.
              </li>
            </ul>
          </Section>
        </article>
      </div>
    </div>
  )
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-4">
      <h2 id={`${id}-h`} className="text-lg font-semibold tracking-tight">
        <a href={`#${id}`} className="hover:underline hover:decoration-muted-foreground hover:underline-offset-4">
          {title}
        </a>
      </h2>
      {children}
    </section>
  )
}

function Term({ name, id, children }: { name: string; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={cn(id && 'scroll-mt-20')}>
      <dt className="font-medium">{name}</dt>
      <dd className="mt-0.5 text-muted-foreground">{children}</dd>
    </div>
  )
}

function ActionRow({ action, weight, children }: { action: 'KEEP' | 'DOWNWEIGHT' | 'FLAG' | 'EXCLUDE'; weight: string; children: ReactNode }) {
  return (
    <tr>
      <td className="px-3 py-2.5">
        <ActionChip action={action} />
      </td>
      <td className="num px-3 py-2.5 text-right font-mono">{weight}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{children}</td>
    </tr>
  )
}

function WeightRow({ name, w, x }: { name: string; w: string; x: string }) {
  return (
    <tr>
      <td className="px-3 py-2">{name}</td>
      <td className="px-3 py-2 text-right font-mono">{w}</td>
      <td className="px-3 py-2 text-muted-foreground">{x}</td>
    </tr>
  )
}

function Callout({ children }: { children: ReactNode }) {
  return <p className="border-l-2 border-foreground/60 pl-3 text-sm">{children}</p>
}
