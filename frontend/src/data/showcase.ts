/**
 * The games a visitor can pick on the home page, each with its recorded reference run
 * (question set v4, one Jev call per review; docs/RUNS.md). Every other run stays in the
 * database but is not listed in the UI.
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
    runId: 'run_32a69a6357c9',
  },
  {
    key: 'bl2',
    title: 'Borderlands 2',
    story: 'EULA change review bomb',
    window: 'Apr–Aug 2025 · 12,981 reviews',
    runId: 'run_cb355add8483',
  },
  {
    key: 'metro',
    title: 'Metro 2033 Redux',
    story: 'Bomb over another game’s Epic exclusivity',
    window: 'Dec 2018–Mar 2019 · 2,444 reviews',
    runId: 'run_319a013d4535',
  },
  {
    key: 'fm26',
    title: 'Football Manager 26',
    story: 'Genuine launch backlash (control)',
    window: 'Launch to now · 15,348 reviews',
    runId: 'run_fe99d4915e40',
  },
  {
    key: 'cs2',
    title: 'Cities: Skylines II',
    story: 'Troubled launch, no bomb (control)',
    window: 'Oct–Dec 2023 · 5,000 reviews',
    runId: 'run_e22d6bb5a0b0',
  },
  {
    key: 'gollum',
    title: 'The Lord of the Rings: Gollum',
    story: 'A genuinely bad game (control)',
    window: 'May–Jun 2023 · 297 reviews',
    runId: 'run_862c7f603aac',
  },
]
