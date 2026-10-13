// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { openFromAddress, workspaceFromAddress } from '../src/app/addressOpen'

const PAGE = 'https://scanruler.example/'
const STORE = 'https://files.example/'

const at = (pathname: string, search = '', ...store: [string | undefined] | []) =>
  openFromAddress({ pathname, search }, PAGE + pathname.slice(1) + search, store.length ? store[0] : STORE)

describe('openFromAddress', () => {
  it('says nothing for a plain address', () => {
    expect(at('/')).toBeNull()
    expect(at('/', '?plugins=none')).toBeNull()
    expect(at('/settings')).toBeNull()
  })

  it('?open= names any http(s) file, by its last path segment', () => {
    expect(at('/', '?open=https://host.example/designs/hinge%20v2.scanruler')).toEqual({
      url: 'https://host.example/designs/hinge%20v2.scanruler',
      name: 'hinge v2.scanruler',
    })
    expect(at('/', '?open=http://localhost:8080/ballbar.stl')).toEqual({ url: 'http://localhost:8080/ballbar.stl', name: 'ballbar.stl' })
  })

  it('?open= resolves a relative address against the page', () => {
    expect(at('/', '?open=/f/hinge.scanruler')).toEqual({ url: 'https://scanruler.example/f/hinge.scanruler', name: 'hinge.scanruler' })
  })

  it('?open= refuses other schemes and nonsense', () => {
    expect(at('/', '?open=file:///C:/parts/hinge.scanruler')).toEqual({ error: expect.stringContaining('file') })
    expect(at('/', '?open=javascript:alert(1)')).toEqual({ error: expect.stringContaining('javascript') })
    expect(at('/', '?open=http://')).toEqual({ error: expect.stringContaining('http://') })
  })

  it('/s/<name> points into the file store, as a project unless the name says otherwise', () => {
    expect(at('/s/hinge')).toEqual({ url: 'https://files.example/hinge.scanruler', name: 'hinge.scanruler' })
    expect(at('/s/SampleProjects/vacuumAdapter_CAD')).toEqual({
      url: 'https://files.example/SampleProjects/vacuumAdapter_CAD.scanruler',
      name: 'vacuumAdapter_CAD.scanruler',
    })
    expect(at('/s/SampleProjects/vacuumAdapter_CAD.scanruler')).toEqual(at('/s/SampleProjects/vacuumAdapter_CAD'))
    expect(at('/s/scans/ballbar.stl')).toEqual({ url: 'https://files.example/scans/ballbar.stl', name: 'ballbar.stl' })
    expect(at('/s/nominal.STEP')).toEqual({ url: 'https://files.example/nominal.STEP', name: 'nominal.STEP' })
    expect(at('/s/sheet.png')).toEqual({ url: 'https://files.example/sheet.png', name: 'sheet.png' })
  })

  it('/s/<name> keeps to the store, whatever the base looks like', () => {
    expect(at('/s/hinge', '', 'https://files.example')).toEqual({ url: 'https://files.example/hinge.scanruler', name: 'hinge.scanruler' })
    expect(at('/s/hinge', '', 'https://files.example/designs/')).toEqual({
      url: 'https://files.example/designs/hinge.scanruler',
      name: 'hinge.scanruler',
    })
    expect(at('/s/hinge/')).toEqual({ url: 'https://files.example/hinge.scanruler', name: 'hinge.scanruler' })
  })

  it('/s/<name> refuses names that leave the store or are no name', () => {
    expect(at('/s/../secret')).toEqual({ error: expect.stringContaining('../secret') })
    expect(at('/s/a/../b')).toEqual({ error: expect.any(String) })
    expect(at('/s/a//b')).toEqual({ error: expect.any(String) })
    expect(at('/s/hinge?x')).toEqual({ error: expect.any(String) })
    expect(at('/s/hinge%2F..%2Fx')).toEqual({ error: expect.any(String) })
    expect(at('/s/%E0%A4%A')).toEqual({ error: expect.any(String) })
  })

  it('/s/<name> says so when the build has no store', () => {
    expect(at('/s/hinge', '', undefined)).toEqual({ error: expect.stringContaining('no file store') })
    expect(at('/s/hinge', '', '')).toEqual({ error: expect.stringContaining('no file store') })
  })

  it('?open= wins over a short path', () => {
    expect(at('/s/hinge', '?open=https://host.example/other.stl')).toEqual({ url: 'https://host.example/other.stl', name: 'other.stl' })
  })
})

describe('workspaceFromAddress', () => {
  it('is the workspace= value, lowercased and trimmed, or null', () => {
    expect(workspaceFromAddress({ search: '' })).toBeNull()
    expect(workspaceFromAddress({ search: '?open=x' })).toBeNull()
    expect(workspaceFromAddress({ search: '?workspace=' })).toBeNull()
    expect(workspaceFromAddress({ search: '?workspace=deviation' })).toBe('deviation')
    expect(workspaceFromAddress({ search: '?open=https://h.example/a.stl&workspace=%20Thickness' })).toBe('thickness')
  })
})
