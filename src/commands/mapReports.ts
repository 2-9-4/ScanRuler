// SPDX-License-Identifier: AGPL-3.0-only
// What a picture of the 3D view says about the colours on it. The Deviation
// workspace's map is the app's own (describeMapPainted, core/view.ts); a
// plugin whose workspace paints a map of its own says here, under its
// workspace's id, which map a picture of it shows or why none — so that
// view.render answers for every workspace that colours the part, and never
// leaves an uncoloured picture unexplained.

/** A workspace's word on its map, for view.render's answer: `map` what is
 *  painted (any shape the workspace chooses) or null, `mapWhy` why none is
 *  and what puts it there, `mapNote` anything that changes how the colours
 *  read. */
export interface MapReport {
  map: unknown
  mapWhy?: string
  mapNote?: string
}

const reports = new Map<string, () => MapReport | null>()

/** A workspace's map report, under the workspace's id, asked for while that
 *  workspace is on screen; null says nothing. Called from a plugin's
 *  install(); the returned function takes it out again. Two under one
 *  workspace throw. */
export function registerMapReport(workspace: string, report: () => MapReport | null): () => void {
  if (reports.has(workspace)) throw new Error(`Two map reports share the workspace "${workspace}".`)
  reports.set(workspace, report)
  return () => {
    if (reports.get(workspace) === report) reports.delete(workspace)
  }
}

/** What the workspace on screen says of its map; null when it has no
 *  report or says nothing — or its report throws, which a picture
 *  outlives. */
export function mapReportOf(workspace: string): MapReport | null {
  const report = reports.get(workspace)
  if (!report) return null
  try {
    return report()
  } catch {
    return null
  }
}
