import type { ReactNode } from 'react'
import type { DataSource } from './DataSource'
import { DataSourceContext } from './source'

export function DataSourceProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  return <DataSourceContext.Provider value={source}>{children}</DataSourceContext.Provider>
}
