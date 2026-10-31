// SPDX-License-Identifier: AGPL-3.0-only
// The Reverse engineer workspace put back between command tests: as it
// starts, but with the kernel the suite loaded once kept up.

import { useHistory } from '../../../src/state/historyStore'
import { useReverse } from '../state/reStore'

/** The workspace as it starts, its names counting from one — the kernel
 *  kept up — and no undo history. */
export function resetReverse(): void {
  const { kernelStatus, kernelVersion, kernelMessage } = useReverse.getState()
  useReverse.setState({ ...useReverse.getInitialState(), kernelStatus, kernelVersion, kernelMessage }, true)
  useHistory.setState({ past: [], future: [] })
}
