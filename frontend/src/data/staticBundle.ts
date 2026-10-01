import type { DataSource } from './DataSource'

const notYet = (what: string) => () => Promise.reject(new Error(`StaticBundle.${what}: lands with the public demo (Phase 9)`))

/**
 * Replay-only data source for the public build: reads exported bundles
 * (tools/export_bundle.py) instead of the API. Stub until Phase 9.
 */
export class StaticBundle implements DataSource {
  readonly mode = 'static' as const
  readonly canStartRuns = false
  listDatasets = notYet('listDatasets')
  getDataset = notYet('getDataset')
  getHours = notYet('getHours')
  listRuns = notYet('listRuns')
  getRun = notYet('getRun')
  createRun = () => Promise.reject(new Error('The public demo plays pre-recorded runs only.'))
  getGrid = notYet('getGrid')
  getClusters = notYet('getClusters')
  getCluster = notYet('getCluster')
  getReview = notYet('getReview')
  listReviews = notYet('listReviews')
  getScores = notYet('getScores')
  exportUrl = () => null
  preflight = () => Promise.reject(new Error('The public demo plays pre-recorded runs only.'))
  getUploadLimits = () => Promise.reject(new Error('The public demo cannot upload data.'))
  previewCsv = () => Promise.reject(new Error('The public demo cannot upload data.'))
  uploadCsv = () => Promise.reject(new Error('The public demo cannot upload data.'))
  getReplay = notYet('getReplay')
  subscribe(): () => void {
    throw new Error('StaticBundle.subscribe: the public demo uses getReplay, not a live stream')
  }
}
