// SPDX-License-Identifier: AGPL-3.0-only
import type { ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { pick, registerHistory } from '../../src/state/historyStore'
import { MOLD_SETTING_KEYS } from './core/settings'
import { moldSection } from './app/projectSection'
import { useMoldPlugin } from './app/useMoldPlugin'
import { useMold } from './state/moldStore'

const plugin: ScanRulerPlugin = {
  id:'mold-making',
  name:'Mold Making',
  workspace:{
    id:'mold-making', label:'Mold Making',
    title:'Print split molds and silicone casting tooling from STEP or scan geometry',
    icon:'shell',order:30,
  },
  usePlugin:useMoldPlugin,
  install(){
    registerProjectSection(moldSection)
    registerHistory({
      sections:[{
        key:'mold-making',
        capture:()=>pick(useMold.getState(),MOLD_SETTING_KEYS),
        apply:(value)=>useMold.setState(value as Partial<ReturnType<typeof useMold.getState>>),
      }],
      actions:[{
        store:useMold,label:'Mold Making',
        names:['setSource','setMode','setParts','setSplitAxis','setBoxShape','setKeys','setKeyStyle','setKeyPlacement','setKeyPositions','setDimension'],
      }],
    })
  },
}
export default plugin
