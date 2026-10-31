// SPDX-License-Identifier: AGPL-3.0-only
// The build on the stage: while the CAD kernel loads or builds the part, a
// chip at the top of the viewport says so. The bodies on the part are the
// last build's until the new one lands, and a change to the list with
// nothing moving on the part reads as a change that did nothing — the
// feature list's "building" is not where the eye is. A build quicker than
// SHOW_AFTER_MS shows nothing, so an edit that lands at once does not flash
// it; a playback builds every step and has its own caption.

import { useEffect, useState } from 'react'
import { useReverse } from '../state/reStore'

const SHOW_AFTER_MS = 300

export function BuildChip() {
  const label = useReverse((s) =>
    s.kernelStatus === 'loading' && s.features.length + s.rolledBack.length > 0
      ? 'Loading the CAD kernel…'
      : s.building && s.playback === null
        ? 'Building the part…'
        : null,
  )
  const active = label !== null
  const [late, setLate] = useState(false)
  useEffect(() => {
    setLate(false)
    if (!active) return
    const timer = window.setTimeout(() => setLate(true), SHOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [active])
  if (!label || !late) return null
  return (
    <div className="hintchip buildchip" data-test="build-chip">
      <span className="spinner" />
      {label}
    </div>
  )
}
