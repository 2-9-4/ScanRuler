// SPDX-License-Identifier: AGPL-3.0-only
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,expect,it} from 'vitest'
import {MoldIcon,type MoldIconName} from '../ui/MoldIcons'

const custom=[
  'moldTool','moldPour','moldVent','moldMount',
  'moldIsolate','moldAssembled','moldExploded','moldExport',
] as const satisfies readonly MoldIconName[]

describe('Mold Making icon language',()=>{
  it('has distinct mold-specific drawings in the native ScanRuler SVG frame',()=>{
    const drawings=custom.map(name=>{
      const svg=renderToStaticMarkup(createElement(MoldIcon,{name,size:20}))
      expect(svg).toContain('class="icon"')
      expect(svg).toContain('viewBox="0 0 24 24"')
      expect(svg).toContain('aria-hidden="true"')
      expect(svg).toContain('class="i-a"')
      return svg
    })
    expect(new Set(drawings).size).toBe(custom.length)
  })
  it('delegates common actions to the established shared icon set',()=>{
    const names=['eye','eyeOff','edit','project','split','scan','model','combine','bin','pickPoints'] as const
    for(const name of names){
      const svg=renderToStaticMarkup(createElement(MoldIcon,{name,size:16}))
      expect(svg).toContain('class="icon small"')
      expect(svg).toContain('aria-hidden="true"')
      expect(svg).toContain('viewBox="0 0 24 24"')
    }
  })
})
