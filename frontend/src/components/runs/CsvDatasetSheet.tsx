import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ShieldCheck, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { CsvPreview, DatasetOut } from '@/data/api'
import { useDataSource } from '@/data/source'
import { formatInt } from '@/lib/format'

const fieldClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  )
}

const SCALES = [
  { value: '', label: 'Detect from the column' },
  { value: 'binary', label: 'Binary (recommended / not)' },
  { value: '1-5', label: '1–5 stars' },
  { value: '1-10', label: '1–10' },
]

/** CSV upload with a column mapper: preview first, then map text / rating / time / author. */
export function CsvDatasetSheet({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** the new dataset, ready to analyse */
  onImported?: (dataset: DatasetOut) => void
}) {
  const source = useDataSource()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [name, setName] = useState('')
  const [map, setMap] = useState({ text: '', rating: '', timestamp: '', author: '' })
  const [scale, setScale] = useState('')

  const inspect = useMutation({
    mutationFn: (f: File) => source.previewCsv(f),
    onSuccess: (p) => {
      setPreview(p)
      const find = (...names: string[]) => p.columns.find((c) => names.includes(c.toLowerCase())) ?? ''
      const ratingGuess = Object.keys(p.rating_scale_guesses)[0] ?? ''
      setMap({
        text: find('text', 'review', 'body', 'content', 'comment'),
        rating: find('rating', 'score', 'stars', 'recommended', 'voted_up') || ratingGuess,
        timestamp: find('timestamp', 'date', 'created_at', 'time', 'posted'),
        author: find('author', 'user', 'user_id', 'author_id', 'username'),
      })
    },
  })
  const upload = useMutation({
    mutationFn: () =>
      source.uploadCsv(
        file!,
        name.trim(),
        { text: map.text, rating: map.rating, timestamp: map.timestamp || null, author: map.author || null },
        scale || undefined,
      ),
    onSuccess: (dataset) => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      onImported?.(dataset)
      onOpenChange(false)
      setFile(null)
      setPreview(null)
      setName('')
    },
  })
  const cols = preview?.columns ?? []
  const guess = map.rating ? preview?.rating_scale_guesses[map.rating] : undefined
  const pick = (k: keyof typeof map, optional = false) => (
    <select className={fieldClass} value={map[k]} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}>
      <option value="">{optional ? 'None' : 'Choose a column'}</option>
      {cols.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-[520px]">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-sm">Upload reviews (CSV)</SheetTitle>
          <SheetDescription className="text-xs">One row per review: text and rating are required; a timestamp enables bursts and the timeline.</SheetDescription>
        </SheetHeader>
        <form
          id="csv-upload"
          className="space-y-5 p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (file && name.trim() && map.text && map.rating) upload.mutate()
          }}
        >
          <Field label="File">
            <input
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-xs file:mr-3 file:h-8 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-xs file:font-medium"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                setPreview(null)
                if (f) {
                  setName((n) => n || f.name.replace(/\.csv$/i, ''))
                  inspect.mutate(f)
                }
              }}
            />
          </Field>
          {inspect.isPending && <div className="h-24 animate-pulse rounded-md bg-muted" />}
          {inspect.isError && <p className="text-xs text-destructive">{inspect.error.message}</p>}
          {preview && (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/40 text-left text-muted-foreground">
                    <tr>
                      {cols.map((c) => (
                        <th key={c} className="px-2 py-1.5 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.rows.slice(0, 4).map((row, i) => (
                      <tr key={i}>
                        {cols.map((c) => (
                          <td key={c} className="max-w-40 truncate px-2 py-1.5">
                            {String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="num -mt-3 text-[11px] text-muted-foreground">{formatInt(preview.n_rows)} rows</p>
              <Field label="Product name" hint="Shown in the picker and given to System One as what the reviews are about.">
                <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Review text">{pick('text')}</Field>
                <Field label="Rating" hint={guess ? `Looks like ${guess}` : undefined}>
                  {pick('rating')}
                </Field>
                <Field label="Timestamp">{pick('timestamp', true)}</Field>
                <Field label="Author">{pick('author', true)}</Field>
              </div>
              <Field label="Rating scale">
                <select className={fieldClass} value={scale} onChange={(e) => setScale(e.target.value)}>
                  {SCALES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="flex gap-2 rounded-md border border-action-downweight/50 bg-action-downweight/10 p-2.5 text-[11px] leading-relaxed">
                <AlertTriangle className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />
                The questions System One answers are worded and tuned for video-game reviews. Reviews of other products are judged against
                game wording until a product-neutral question set exists, so treat their integrity weights as provisional.
              </p>
              <p className="flex gap-2 rounded-md bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0 translate-y-0.5" aria-hidden />
                The author column is hashed with a salt at import and the raw value is never stored. Review text may still contain personal data: anonymise it
                before sharing any export.
              </p>
            </>
          )}
          {upload.isError && (
            <p role="alert" className="text-xs text-destructive">
              {upload.error.message}
            </p>
          )}
        </form>
        <SheetFooter className="border-t border-border">
          <Button type="submit" form="csv-upload" disabled={!preview || !name.trim() || !map.text || !map.rating || upload.isPending}>
            <Upload />
            {upload.isPending ? 'Importing…' : 'Import dataset'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
