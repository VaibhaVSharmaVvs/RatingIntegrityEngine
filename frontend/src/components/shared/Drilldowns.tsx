import { ClusterDrawer } from '@/components/clusters/ClusterDrawer'
import { ReviewInspector } from '@/components/inspector/ReviewInspector'

/** The two drill-down drawers, mounted once per run page. */
export function Drilldowns({ runId, scale }: { runId: string; scale: string }) {
  return (
    <>
      <ClusterDrawer runId={runId} scale={scale} />
      <ReviewInspector runId={runId} scale={scale} />
    </>
  )
}
