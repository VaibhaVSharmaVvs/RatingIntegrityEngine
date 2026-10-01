import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '@/App'
import { DataSourceProvider } from '@/data/DataSourceProvider'
import { useViewStore } from '@/state/viewStore'
import { FakeSource } from '@/test/fakeSource'

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

beforeEach(() => useViewStore.getState().clear())

it('shows the three ratings, the waterfall and the platform removals', async () => {
  renderAt('/runs/run_fixture/results')
  const ratings = await screen.findByRole('region', { name: 'Three ratings' })
  expect(within(ratings).getByText('66.0%')).toBeTruthy() // adjusted
  expect(within(ratings).getByText('75.0%')).toBeTruthy() // Steam policy
  const fall = await screen.findByRole('region', { name: 'From raw to adjusted' })
  expect(await within(fall).findByRole('link', { name: 'Not about the game' })).toBeTruthy()
  expect(screen.getByRole('region', { name: /Steam policy: what was left out/ })).toBeTruthy()
  expect(screen.getByText(/Not the “true” rating/)).toBeTruthy()
  expect(screen.getByRole('link', { name: /Decisions CSV/ }).getAttribute('href')).toBe('/api/runs/run_fixture/export?fmt=csv')
})

it('recomputes the rating in the browser when a slider moves', async () => {
  renderAt('/runs/run_fixture/results')
  const panel = await screen.findByRole('region', { name: 'Sensitivity' })
  expect(within(panel).getByText(/at this run’s settings/)).toBeTruthy()
  fireEvent.click(within(panel).getByRole('checkbox'))
  // turning the cluster penalty off re-splits on the pre-penalty score (fixture: 0.4 -> 0.5)
  expect(await within(panel).findByText(/reviews change action/)).toBeTruthy()
  fireEvent.click(within(panel).getByText('Reset to this run'))
  expect(within(panel).getByText(/at this run’s settings/)).toBeTruthy()
})

it('opens the inspector with the integrity arithmetic and platform status', async () => {
  renderAt('/runs/run_fixture/results')
  await screen.findByRole('region', { name: 'Three ratings' })
  act(() => useViewStore.getState().inspect(42))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText(/Review 42: the matchmaking/)).toBeTruthy()
  // 1 - (0.6 * 0.88 + 0.5 * 0.05 + 0.2 * 0.02 + 0.15 * 0.04 + 0.2 * 0.88) -> base 0.26 (fixture stores 0.42, so only stored numbers show)
  expect(within(dialog).getByText('Per-review integrity')).toBeTruthy()
  expect(within(dialog).getByText('Cluster penalty')).toBeTruthy()
  expect(within(dialog).getByText(/Left out/)).toBeTruthy()
  expect(within(dialog).getByText(/Later copy of/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: /Open/ }))
  await waitFor(() => expect(useViewStore.getState().openCid).toBe(7))
})

it('filters the reviews table through the URL and opens a row in the inspector', async () => {
  const source = renderAt('/runs/run_fixture/reviews?action=DOWNWEIGHT')
  expect(await screen.findByText(/^100$/)).toBeTruthy() // 10% of 1000 in the fixture band
  const spy = vi.spyOn(source, 'listReviews')
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'KEEP' } })
  await waitFor(() => expect(spy).toHaveBeenCalledWith('run_fixture', expect.objectContaining({ action: 'KEEP' })))
  // the KEEP page replaces the rows: click one of the new ones
  fireEvent.click(await screen.findByRole('row', { name: 'Inspect review 1' }))
  await waitFor(() => expect(useViewStore.getState().inspecting).toBe(1))
})

it('explains every reason code on the help page', async () => {
  renderAt('/help#reason-near-duplicate')
  expect(await screen.findByRole('heading', { name: 'Three ratings' })).toBeTruthy()
  expect(document.getElementById('reason-near-duplicate')).toBeTruthy()
  expect(document.getElementById('reason-off-topic')).toBeTruthy()
  expect(screen.getByText(/System One’s answers alone can never EXCLUDE/)).toBeTruthy()
  expect(document.body.textContent).not.toMatch(/\bfake\b/i)
})

it('shows the pre-flight estimate before a live Jev run starts', async () => {
  const source = renderAt('/')
  fireEvent.change(screen.getByRole('combobox', { name: /^Run/ }), { target: { value: 'live' } })
  const estimate = await screen.findByRole('region', { name: 'Pre-flight estimate' })
  expect(await within(estimate).findByText('$0.06')).toBeTruthy()
  const create = vi.spyOn(source, 'createRun')
  const start = screen.getByRole('button', { name: /Start live run · \$0\.06/ })
  await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
  fireEvent.click(start)
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ dataset_id: 'ds_fixture', backend: 'jev', question_set: 'v4' })),
  )
})
