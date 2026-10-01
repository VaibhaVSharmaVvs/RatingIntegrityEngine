import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import type { DataSource } from '@/data/DataSource'
import { DataSourceProvider } from '@/data/DataSourceProvider'
import { defaultDataSource } from '@/data/source'
import { LiveRunPage } from '@/pages/LiveRunPage'
import { RunsPage } from '@/pages/RunsPage'

// Drill-down pages load on first visit; the live screen stays in the main bundle.
const ResultsPage = lazy(() => import('@/pages/ResultsPage').then((m) => ({ default: m.ResultsPage })))
const ReviewsPage = lazy(() => import('@/pages/ReviewsPage').then((m) => ({ default: m.ReviewsPage })))
const HelpPage = lazy(() => import('@/pages/HelpPage').then((m) => ({ default: m.HelpPage })))

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <Routes>
        <Route path="/" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<LiveRunPage />} />
        <Route path="/runs/:runId/results" element={<ResultsPage />} />
        <Route path="/runs/:runId/reviews" element={<ReviewsPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Routes>
    </Suspense>
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
