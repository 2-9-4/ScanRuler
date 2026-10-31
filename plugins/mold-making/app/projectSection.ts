// SPDX-License-Identifier: AGPL-3.0-only
// The mold's recipe is stored, never a stale tessellated result. The scan and
// reference are already archived by ScanRuler's core project serializer.
import type { ProjectSection } from '../../../src/app/projectSections'
import {
  DEFAULT_MOLD_SETTINGS, MOLD_DIMENSIONS,
  parseMoldSettings, type MoldSettings,
} from '../core/settings'
import { moldSettings, useMold } from '../state/moldStore'

const SETTINGS_KEYS = ['source', 'mode', ...MOLD_DIMENSIONS] as const

export const moldSection: ProjectSection<MoldSettings> = {
  key: 'moldMaking',
  collect() {
    return moldSettings()
  },
  prepare(value) {
    const next = value === undefined ? DEFAULT_MOLD_SETTINGS : parseMoldSettings(value)
    return () => useMold.setState({ ...next })
  },
  hasContent(value) {
    return SETTINGS_KEYS.some((key) => value[key] !== DEFAULT_MOLD_SETTINGS[key])
  },
  holdsWork() {
    const s = moldSettings()
    return SETTINGS_KEYS.some((key) => s[key] !== DEFAULT_MOLD_SETTINGS[key])
  },
  watch(changed) {
    return useMold.subscribe((next, prev) => {
      if (SETTINGS_KEYS.some((key) => next[key] !== prev[key])) changed()
    })
  },
}
