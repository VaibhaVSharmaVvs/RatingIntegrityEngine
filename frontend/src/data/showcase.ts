/**
 * The games a visitor can pick on the home page, each with its reference run: the Jev
 * answers of the original run, re-judged under the current rules at $0 (2026-10-04,
 * MEASUREMENTS M17; docs/RUNS.md). Every other run stays in the database, unlisted.
 */
export interface ShowcaseGame {
  key: string
  title: string
  /** what happened in this window, in a few words */
  story: string
  window: string
  /** finished run whose recording is replayed, and whose dataset a live run reuses */
  runId: string
}

export const SHOWCASE: ShowcaseGame[] = [
  {
    key: 'hd2',
    title: 'Helldivers 2',
    story: 'PlayStation Network account review bomb',
    window: 'Apr–Jun 2024 · 5,000 reviews',
    runId: 'run_5e6bcccc073b',
  },
  {
    key: 'bl2',
    title: 'Borderlands 2',
    story: 'EULA change review bomb',
    window: 'Apr–Aug 2025 · 12,981 reviews',
    runId: 'run_1b0a30615dba',
  },
  {
    key: 'metro',
    title: 'Metro 2033 Redux',
    story: 'Bomb over another game’s Epic exclusivity',
    window: 'Dec 2018–Mar 2019 · 2,444 reviews',
    runId: 'run_c43a4ef3961e',
  },
  {
    key: 'rome2',
    title: 'Total War: ROME II',
    story: 'Culture-war review bomb that Valve flagged',
    window: 'Aug–Oct 2018 · 3,846 reviews',
    runId: 'run_78a53d4b9b62',
  },
  {
    key: 'doom',
    title: 'DOOM Eternal',
    story: 'Bomb over a soundtrack dispute that Valve flagged',
    window: 'Oct–Dec 2022 · 2,825 reviews',
    runId: 'run_50ccafd237cf',
  },
  {
    key: 'fm26',
    title: 'Football Manager 26',
    story: 'Genuine launch backlash (control)',
    window: 'Launch to now · 15,348 reviews',
    runId: 'run_f9e0c3d71f14',
  },
  {
    key: 'cs2',
    title: 'Cities: Skylines II',
    story: 'Troubled launch, no bomb (control)',
    window: 'Oct–Dec 2023 · 5,000 reviews',
    runId: 'run_d6617c6a4778',
  },
  {
    key: 'gollum',
    title: 'The Lord of the Rings: Gollum',
    story: 'A genuinely bad game (control)',
    window: 'May–Jun 2023 · 297 reviews',
    runId: 'run_27907071d5e2',
  },
]
