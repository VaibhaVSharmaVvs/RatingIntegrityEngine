import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import type { DataSource } from '@/data/DataSource'
import { DataSourceProvider } from '@/data/DataSourceProvider'
import { defaultDataSource } from '@/data/source'
import { LiveRunPage } from '@/pages/LiveRunPage'
import { RunsPage } from '@/pages/RunsPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RunsPage />} />
      <Route path="/runs/:runId" element={<LiveRunPage />} />
    </Routes>
  )
}

export default function App({ source = defaultDataSource }: { source?: DataSource }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }))
  return (
    <QueryClientProvider client={client}>
      <DataSourceProvider source={source}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </DataSourceProvider>
    </QueryClientProvider>
  )
}
