import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ClusterEvent } from '@/data/api'
import { DataSourceProvider } from '@/data/DataSourceProvider'
import { useRunStore } from '@/state/runStore'
import { FakeSource } from '@/test/fakeSource'
import { ClusterFeed } from './ClusterFeed'

const cluster = (cid: number, suspicion: number, size = 20): ClusterEvent => ({
  type: 'cluster',
  cid,
  kind: 'semantic',
  size,
  suspicion,
  caption: `cluster ${cid}`,
})

it('lists clusters most suspicious first, whatever order S3 found them in', () => {
  useRunStore.getState().reset('run_fixture', 10)
  // arrival order: ascending suspicion, plus a tie broken by size
  useRunStore.getState().ingest([cluster(1, 0.2), cluster(2, 0.55), cluster(3, 0.9), cluster(4, 0.55, 40)])
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DataSourceProvider source={new FakeSource()}>
        <ClusterFeed runId="run_fixture" threshold={0.5} minPenaltySize={10} />
      </DataSourceProvider>
    </QueryClientProvider>,
  )
  const order = screen.getAllByText(/^cluster \d$/).map((el) => el.textContent)
  expect(order).toEqual(['cluster 3', 'cluster 4', 'cluster 2', 'cluster 1'])
})
