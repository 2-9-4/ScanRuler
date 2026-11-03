// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {labelsForParts,matingMarks} from '../core/interfaceLabels'

describe('Exterior mold interface engraving numbering',()=>{
  it('gives the same seam number to both mating parts',()=>{
    for(const count of [2,3,4]){
      const marks=matingMarks(count)
      const labels=labelsForParts(count)
      // A two-part mold has one shared interface, not two.
      expect(marks).toHaveLength(count===2?1:count)
      expect(labels).toHaveLength(count)
      for(const mark of marks){
        const [a,b]=mark.pair
        expect(a).not.toBe(b)
        expect(a).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThan(count)
        expect(labels[a].split('-')).toContain(String(mark.number))
        expect(labels[b].split('-')).toContain(String(mark.number))
      }
    }
  })
  it('marks threefold part 1 with interfaces 1 and 3, and fourfold with four distinct interfaces',()=>{
    expect(labelsForParts(1)).toEqual([''])
    expect(labelsForParts(2)).toEqual(['1','1'])
    expect(labelsForParts(3)).toEqual(['1-3','1-2','2-3'])
    expect(labelsForParts(4)).toEqual(['1-4','1-2','3-4','2-3'])
  })
})
