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
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ dataset_id: 'ds_fixture', backend: 'jev', question_set: 'v5' })),
  )
})

it('uploads a file from the home page and offers it for a live run', async () => {
  const source = renderAt('/')
  fireEvent.click(screen.getByRole('button', { name: /Upload your own reviews/ }))
  const sheet = await screen.findByRole('dialog')
  const file = new File(['body,stars\nGreat,5\n'], 'phones.csv', { type: 'text/csv' })
  fireEvent.change(sheet.querySelector('input[type=file]')!, { target: { files: [file] } })
  expect(await within(sheet).findByText(/tuned for video-game reviews/)).toBeTruthy()
  const upload = vi.spyOn(source, 'uploadCsv')
  fireEvent.click(within(sheet).getByRole('button', { name: /Import dataset/ }))
  await waitFor(() => expect(upload).toHaveBeenCalledWith(file, 'phones', expect.objectContaining({ text: 'body', rating: 'stars' }), undefined))
  // the upload joins the picker and, with nothing to replay yet, only a live run is offered
  const product = (await screen.findByRole('combobox', { name: /^Product/ })) as HTMLSelectElement
  await waitFor(() => expect(product.selectedOptions[0].textContent).toMatch(/your upload/))
  const run = screen.getByRole('combobox', { name: /^Run/ }) as HTMLSelectElement
  expect([...run.options].map((o) => o.value)).toEqual(['live'])
})

it('accepts Excel workbooks as well as CSV', async () => {
  renderAt('/')
  fireEvent.click(screen.getByRole('button', { name: /Upload your own reviews/ }))
  const input = (await screen.findByRole('dialog')).querySelector('input[type=file]') as HTMLInputElement
  expect(input.accept).toContain('.xlsx')
  expect(input.accept).toContain('.csv')
})

it('states the upload limits and refuses an oversized file without sending it', async () => {
  const source = renderAt('/')
  fireEvent.click(screen.getByRole('button', { name: /Upload your own reviews/ }))
  const sheet = await screen.findByRole('dialog')
  expect(await within(sheet).findByText(/up to 50 MB and 200,000 rows/)).toBeTruthy()
  const big = new File(['x'], 'huge.csv', { type: 'text/csv' })
  Object.defineProperty(big, 'size', { value: 60 * 2 ** 20 })
  const preview = vi.spyOn(source, 'previewCsv')
  fireEvent.change(sheet.querySelector('input[type=file]')!, { target: { files: [big] } })
  expect(await within(sheet).findByRole('alert')).toBeTruthy()
  expect(within(sheet).getByText(/huge\.csv is 60\.0 MB; the limit is 50 MB/)).toBeTruthy()
  expect(preview).not.toHaveBeenCalled()
})

it('labels blind: no engine output, saves the answers and moves on', async () => {
  const source = renderAt('/label?set=hd2-300&rater=vs')
  expect(await screen.findByText('Label me 1')).toBeTruthy()
  expect(screen.queryByText(/integrity|downweight line|System One answers/i)).toBeNull()
  fireEvent.click(screen.getByRole('radio', { name: 'No', checked: false, description: undefined }))
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /How much should it count/ })).getByRole('radio', { name: 'Reduced' }))
  fireEvent.click(screen.getByRole('button', { name: /Save and next/ }))
  await waitFor(() => expect(source.labels.get(1)).toMatchObject({ about_game: 'no', overall: 'downweight', spam: 'no' }))
  expect(await screen.findByText('Label me 2')).toBeTruthy()
})

it('renders the benchmarks page with attack, ablation and control rows', async () => {
  const source = new FakeSource()
  const row = (kind: string, name: string, created: string, metrics: Record<string, unknown>) => ({
    id: name, kind, name, backend: 'jev', question_set: 'v4', run_ids: [], metrics, cost_usd: 0.66, notes: null, created_at: created,
  })
  const attack = { per_type: { spam: { discounted: 0.9 } }, rating: { shift_removed: 0.45 }, collateral: { organic_newly_in_penalised_cluster: 127 }, n_organic: 4999, n_injected: 690 }
  source.listBenchmarks = async () =>
    [
      row('attack', 'bench · Jev v4', '2026-10-02T10:00:00Z', attack),
      row('attack', 'bench · heuristics only', '2026-10-02T10:01:00Z', { ...attack, rating: { shift_removed: 0.22 } }),
      row('attack', 'bench · ablation: no-spam', '2026-10-02T10:02:00Z', attack),
      row('ablation', 'bench · ablation: no-spam', '2026-10-02T11:00:00Z', attack),
    ] as never
  renderAt('/benchmarks', source)
  const attacks = await screen.findByRole('region', { name: 'Synthetic attacks' })
  expect(within(attacks).getAllByText('Jev v4').length).toBeGreaterThan(0)
  expect(within(attacks).queryByText('ablation: no-spam')).toBeNull() // re-recorded as an ablation
  expect(within(screen.getByRole('region', { name: 'Ablations' })).getByText('ablation: no-spam')).toBeTruthy()
})
