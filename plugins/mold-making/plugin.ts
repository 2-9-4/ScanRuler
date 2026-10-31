// SPDX-License-Identifier: AGPL-3.0-only
// A native workspace, registered through ScanRuler's existing plugin glob.
// Never patch the core app's workspace switch for a plugin.
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { pick, registerHistory } from '../../src/state/historyStore'
import { MOLD_DIMENSIONS } from './core/settings'
import { moldSection } from './app/projectSection'
import { useMoldPlugin } from './app/useMoldPlugin'
import { useMold } from './state/moldStore'

const SETTINGS_KEYS = ['source', 'mode', ...MOLD_DIMENSIONS] as const

const plugin: ScanRulerPlugin = {
  id: 'mold-making',
  name: 'Mold Making',
  workspace: {
    id: 'mold-making',
    label: 'Mold Making',
    title: 'Prepare scanned or STEP models for direct molds and silicone-casting tooling',
    icon: 'shell',
    order: 30,
  },
  usePlugin: useMoldPlugin,
  install() {
    registerProjectSection(moldSection)
    registerHistory({
      sections: [{
        key: 'mold-making',
        capture: () => pick(useMold.getState(), SETTINGS_KEYS),
        apply: (value) => useMold.setState(value as Partial<ReturnType<typeof useMold.getState>>),
      }],
      actions: [{
        store: useMold,
        label: 'Mold Making',
        names: ['setSource', 'setMode', 'setDimension'],
      }],
    })
  },
}

export default plugin
