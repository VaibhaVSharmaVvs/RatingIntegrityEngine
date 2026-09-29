// One interface, two implementations (MVP_SPEC §9):
// LiveApi for local development, StaticBundle for the replay-only public build.
export type DataSourceMode = 'live' | 'static'

export const dataSourceMode: DataSourceMode = import.meta.env.MODE === 'static' ? 'static' : 'live'
