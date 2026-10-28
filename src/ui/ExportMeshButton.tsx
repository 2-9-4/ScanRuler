// SPDX-License-Identifier: AGPL-3.0-only
// The button every mesh export sits behind: pressed, it asks which format —
// an STL, which every program reads but which says nothing of its units, or
// a 3MF, which says millimetres and keeps the part's colours — and the
// format picked is what is written.

import { useId, useState } from 'react'
import { MESH_FORMATS, MESH_FORMAT_LABEL, type MeshFormat } from '../core/exportMesh'
import { useDismiss } from './useDismiss'

const FORMAT_TITLE: Record<MeshFormat, string> = {
  stl: 'Binary STL — every program reads it; it does not say its units (millimetres)',
  '3mf': '3MF — says it is in millimetres, keeps the part’s colours; slicers and most mesh editors read it',
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
  const menuId = useId()
  useDismiss(open, () => setOpen(false), { outside: `[data-menu="${menuId}"]` })
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
        <div className="picklist" role="menu">
          {MESH_FORMATS.map((f) => (
            <button key={f} type="button" role="menuitem" className="pickoption" data-test={`${testId}-${f}`} title={FORMAT_TITLE[f]} onClick={() => choose(f)}>
              {MESH_FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
