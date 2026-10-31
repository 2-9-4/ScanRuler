// SPDX-License-Identifier: AGPL-3.0-only
import type { PluginHost, PluginRuntime } from '../../../src/plugins/api'
import { useShell } from '../../../src/state/shellStore'
import { MoldPanel } from '../ui/MoldPanel'

export function useMoldPlugin(host: PluginHost): PluginRuntime {
  const inWorkspace = useShell((s) => s.workspace === 'mold-making')
  return {
    startPane: {
      title: 'Mold Making',
      blurb: 'Load a target STEP/STP file directly, or import an STL, PLY, OBJ or 3MF scan. Choose a direct-printed cavity, silicone casting box, or thin negative shell. The geometry/export operations are being added in separate validated steps.',
    },
    panel: inWorkspace ? (
      <MoldPanel
        onOpenScan={(file) => void host.openScan(file)}
        onOpenReference={(file) => void host.openReference(file)}
      />
    ) : null,
  }
}
