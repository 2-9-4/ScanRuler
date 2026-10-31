// SPDX-License-Identifier: AGPL-3.0-only
// The button every mesh export sits behind: pressed, it asks which format —
// an STL, which every program reads but which says nothing of its units and
// so comes in millimetres or in inches, or a 3MF, which says millimetres and
// keeps the part's colours — and the format picked is what is written. The
// STL in the units on screen is offered first; the other stays a pick away,
// since the unit an STL wants is the unit of whoever reads it.

import { useId, useRef, useState } from 'react'
import { MESH_EXPORT_FORMATS, type MeshFormat } from '../core/exportMesh'
import type { DisplayUnits } from '../core/units'
import { useUnits } from '../app/useUnits'
import { useDismiss } from './useDismiss'
import { useOpenUp } from './useOpenUp'

const FORMAT_LABEL: Record<MeshFormat, string> = {
  stl: 'STL in millimetres',
  'stl-in': 'STL in inches',
  '3mf': '3MF',
}

const FORMAT_TITLE: Record<MeshFormat, string> = {
  stl: 'Binary STL in millimetres — every program reads it; the file does not say its units',
  'stl-in': 'Binary STL in inches, every vertex divided by 25.4 — for a program that reads an STL as inches; the file does not say its units',
  '3mf': '3MF — says it is in millimetres, keeps the part’s colours; slicers and most mesh editors read it',
}

/** The formats in the order offered: the STL in the display units first. */
function formatsFor(units: DisplayUnits): readonly MeshFormat[] {
  return units === 'in' ? ['stl-in', 'stl', '3mf'] : MESH_EXPORT_FORMATS
}

export function ExportMeshButton({
  label = 'Export mesh',
  testId,
  disabled,
  title,
  block,
  onExport,
}: {
  label?: string
  /** The button's data-test; each format's item is `${testId}-${format}`. */
  testId: string
  disabled?: boolean
  title: string
  /** As wide as the panel, as button.block is. */
  block?: boolean
  onExport: (format: MeshFormat) => void
}) {
  const [open, setOpen] = useState(false)
  const units = useUnits()
  const menuId = useId()
  useDismiss(open, () => setOpen(false), { outside: `[data-menu="${menuId}"]` })
  const list = useRef<HTMLDivElement>(null)
  const up = useOpenUp(open && !disabled, list)
  const choose = (format: MeshFormat) => {
    setOpen(false)
    onExport(format)
  }
  return (
    <div className={'exportmesh' + (block ? ' block' : '') + (open ? ' open' : '')} data-menu={menuId}>
      <button
        className={block ? 'block' : undefined}
        data-test={testId}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={title}
      >
        {label} <i aria-hidden>▾</i>
      </button>
      {open && !disabled && (
        <div className={'picklist' + (up ? ' up' : '')} role="menu" ref={list}>
          {formatsFor(units).map((f) => (
            <button key={f} type="button" role="menuitem" className="pickoption" data-test={`${testId}-${f}`} title={FORMAT_TITLE[f]} onClick={() => choose(f)}>
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
