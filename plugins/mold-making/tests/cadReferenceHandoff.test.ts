// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it,vi} from 'vitest'
import {
  showMoldInCadReference,type MoldCadReferencePort,
} from '../app/cadReferenceHandoff'

describe('non-destructive mold CAD reference handoff',()=>{
  it('keeps the original master and every mold/fixture part, assembled in source coordinates',()=>{
    const calls:string[]=[]
    let visible:boolean[]=[]
    let selected=-1
    let notice=''
    const port:MoldCadReferencePort={
      showAllMoldParts:next=>{calls.push('all');visible=next},
      showOriginalMaster:()=>calls.push('original'),
      assemblePreview:()=>calls.push('assembled'),
      focusPart:i=>{calls.push('focus');selected=i},
      showPreview:()=>calls.push('preview'),
      openReverseWorkspace:()=>calls.push('reverse'),
      report:message=>{calls.push('status');notice=message},
    }
    const parts=['Mold part 1','Mold part 2','Glue-on post']
    showMoldInCadReference(parts,1,port)
    expect(visible).toEqual([true,true,true])
    expect(selected).toBe(1)
    expect(calls).toEqual([
      'all','original','assembled','focus','preview','reverse','status',
    ])
    expect(notice).toContain('Mold part 2')
    expect(notice).toMatch(/view-only CAD reference/)
    expect(notice).toMatch(/No scan was replaced/)
    expect(notice).toMatch(/every generated mold part/)
    // There is intentionally no openScan/import function in this port.
    expect(Object.keys(port)).not.toContain('openScan')
  })
  it('rejects invalid selections before changing the workspace or preview',()=>{
    const port:MoldCadReferencePort={
      showAllMoldParts:vi.fn(),showOriginalMaster:vi.fn(),
      assemblePreview:vi.fn(),focusPart:vi.fn(),showPreview:vi.fn(),
      openReverseWorkspace:vi.fn(),report:vi.fn(),
    }
    expect(()=>showMoldInCadReference(['Part'],1,port)).toThrow(/index/)
    expect(()=>showMoldInCadReference(['Part'],-1,port)).toThrow(/index/)
    expect(()=>showMoldInCadReference([''],0,port)).toThrow(/name/)
    expect(port.showAllMoldParts).not.toHaveBeenCalled()
    expect(port.openReverseWorkspace).not.toHaveBeenCalled()
  })
})
