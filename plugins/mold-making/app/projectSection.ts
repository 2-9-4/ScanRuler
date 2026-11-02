// SPDX-License-Identifier: AGPL-3.0-only
// Persist mold recipes only; never persist stale result meshes or worker state.
import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_MOLD_SETTINGS, MOLD_SETTING_KEYS, parseMoldSettings, type MoldSettings } from '../core/settings'
import { moldSettings, useMold } from '../state/moldStore'

function settingsChanged(a:MoldSettings,b:MoldSettings):boolean {
  return MOLD_SETTING_KEYS.some(k=>{
    if(k==='keyPositions'){
      return a.keyPositions.length!==b.keyPositions.length ||
        a.keyPositions.some((x,i)=>x!==b.keyPositions[i])
    }
    if(k==='keyPoints'){
      return a.keyPoints.length!==b.keyPoints.length ||
        a.keyPoints.some((point,i)=>point[0]!==b.keyPoints[i][0]||point[1]!==b.keyPoints[i][1])
    }
    // Snapshots deliberately clone editable XY coordinates. Reference
    // comparison would mark an untouched/default project as having work.
    if(k==='pourPoint')
      return a.pourPoint[0]!==b.pourPoint[0]||a.pourPoint[1]!==b.pourPoint[1]
    if(k==='ventPoints'){
      return a.ventPoints.length!==b.ventPoints.length ||
        a.ventPoints.some((point,i)=>point[0]!==b.ventPoints[i][0]||
          point[1]!==b.ventPoints[i][1])
    }
    return a[k]!==b[k]
  })
}
export const moldSection: ProjectSection<MoldSettings> = {
  key:'moldMaking',
  collect(){return moldSettings()},
  prepare(value){
    const next = value===undefined ? DEFAULT_MOLD_SETTINGS : parseMoldSettings(value)
    return () => useMold.setState({...next})
  },
  hasContent(value){
    return settingsChanged(value, DEFAULT_MOLD_SETTINGS)
  },
  holdsWork(){
    const s=moldSettings()
    return settingsChanged(s, DEFAULT_MOLD_SETTINGS)
  },
  watch(changed){
    return useMold.subscribe((next,prev)=>{
      if(settingsChanged(next,prev))changed()
    })
  },
}
