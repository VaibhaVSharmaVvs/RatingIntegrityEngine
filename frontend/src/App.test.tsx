import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DataSourceProvider } from '@/data/DataSourceProvider'
import { SHOWCASE } from '@/data/showcase'
import { useRunStore } from '@/state/runStore'
import { useViewStore } from '@/state/viewStore'
import { FakeSource } from '@/test/fakeSource'
import { AppRoutes } from './App'

function renderAt(path: string, source = new FakeSource()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DataSourceProvider source={source}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </DataSourceProvider>
    </QueryClientProvider>,
  )
  return source
}

/** Let the per-frame batcher flush. */
const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())))

it('offers only the curated games and replays the chosen one', async () => {
  renderAt('/')
  const game = screen.getByRole('combobox', { name: /^Product/ }) as HTMLSelectElement
  expect(game.options).toHaveLength(SHOWCASE.length)
  expect(screen.queryByText('Fixture game, May 2024')).toBeNull() // runs and datasets are not listed
  fireEvent.change(game, { target: { value: 'metro' } })
  expect(await screen.findByText('66.0%')).toBeTruthy() // the recorded result
  fireEvent.click(screen.getByRole('button', { name: /Play the replay/ }))
  expect(await screen.findByText(/Integrity grid/)).toBeTruthy()
})

it('folds the live stream into the counters, ticker, stepper and cluster feed', async () => {
  const source = renderAt('/runs/run_fixture?play=end')
  await waitFor(() => expect(source.handlers).not.toBeNull())
  act(() => source.emitAll())
  await nextFrame()

  const s = useRunStore.getState()
  expect(s.phase).toBe('done')
  expect(s.grid.size).toBe(1000)
  expect(s.counters?.processed).toBe(1000)

  expect(screen.getByText('66.0%')).toBeTruthy() // adjusted
  expect(screen.getByText('64.0–68.0%')).toBeTruthy() // CI
  expect(screen.getByLabelText('Decide: done')).toBeTruthy()
  expect(screen.getByText(/91% within 3 h/)).toBeTruthy()
  expect(screen.getByText(/Not the “true” rating/)).toBeTruthy()
})

it('pins a cluster brush from its card and clears it with a second click', async () => {
  const source = renderAt('/runs/run_fixture?play=end')
  await waitFor(() => expect(source.handlers).not.toBeNull())
  act(() => source.emitAll())
  await nextFrame()

  const card = screen.getByRole('button', { name: /Burst/ })
  fireEvent.click(card)
  await waitFor(() => expect(useViewStore.getState().brush?.cid).toBe(7))
  const mask = useViewStore.getState().brush!.mask
  expect([mask[0], mask[1], mask[2]]).toEqual([0, 1, 1])
  fireEvent.click(card)
  fireEvent.pointerLeave(card.closest('ul')!)
  await waitFor(() => expect(useViewStore.getState().brush).toBeNull())
})

it('shows the selected review', async () => {
  const source = renderAt('/runs/run_fixture?play=end')
  await waitFor(() => expect(source.handlers).not.toBeNull())
  act(() => useViewStore.getState().select(42))
  expect(await screen.findByText(/Review 42: the matchmaking is broken/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Not about the game' }).getAttribute('href')).toBe('/help#reason-off-topic')
  fireEvent.click(screen.getByLabelText('Clear selection'))
  expect(useViewStore.getState().selected).toBeNull()
})

it('unsubscribes from the stream when leaving the page', async () => {
  const source = new FakeSource()
  const client = new QueryClient()
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <DataSourceProvider source={source}>
        <MemoryRouter initialEntries={['/runs/run_fixture?play=end']}>
          <AppRoutes />
        </MemoryRouter>
      </DataSourceProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(source.handlers).not.toBeNull())
  unmount()
  expect(source.unsubscribed).toBe(1)
})

it('replays a finished run by default, revealing the grid over time, and can skip to the end', async () => {
  const source = new FakeSource()
  const getReplay = vi.spyOn(source, 'getReplay')
  renderAt('/runs/run_fixture', source)
  await waitFor(() => expect(getReplay).toHaveBeenCalled())
  expect(source.handlers).toBeNull() // no live stream for a finished run
  // part-way through: some cells shown, not all
  await waitFor(() => expect(useRunStore.getState().grid.counts()[0]).toBeLessThan(1000), { timeout: 3000 })
  expect(useRunStore.getState().phase).not.toBe('done')
  fireEvent.click(screen.getByRole('button', { name: /Skip to end/ }))
  await nextFrame()
  const s = useRunStore.getState()
  expect(s.phase).toBe('done')
  expect(s.grid.counts()[0]).toBe(0)
  expect(screen.getByRole('button', { name: '30 s' }).getAttribute('aria-pressed')).toBe('true')
})
