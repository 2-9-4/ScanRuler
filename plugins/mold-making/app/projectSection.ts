// SPDX-License-Identifier: AGPL-3.0-only
// Persist mold recipes only; never persist stale result meshes or worker state.
import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_MOLD_SETTINGS, MOLD_SETTING_KEYS, parseMoldSettings, type MoldSettings } from '../core/settings'
import { moldSettings, useMold } from '../state/moldStore'

export const moldSection: ProjectSection<MoldSettings> = {
  key:'moldMaking',
  collect(){return moldSettings()},
  prepare(value){
    const next = value===undefined ? DEFAULT_MOLD_SETTINGS : parseMoldSettings(value)
    return () => useMold.setState({...next})
  },
  hasContent(value){
    return MOLD_SETTING_KEYS.some(key=>value[key]!==DEFAULT_MOLD_SETTINGS[key])
  },
  holdsWork(){
    const s=moldSettings()
    return MOLD_SETTING_KEYS.some(key=>s[key]!==DEFAULT_MOLD_SETTINGS[key])
  },
  watch(changed){
    return useMold.subscribe((next,prev)=>{
      if(MOLD_SETTING_KEYS.some(key=>next[key]!==prev[key]))changed()
    })
  },
}
