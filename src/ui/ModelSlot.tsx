// SPDX-License-Identifier: AGPL-3.0-only
// One model the workspace needs, in the left panel. Shared by both
// workspaces, so a scan is opened the same way in either.

import { useRef, type RefObject } from 'react'
import { MESH_ACCEPT, MESH_FORMATS } from '../core/formats'
import { usePulse } from '../app/useHints'

/** A file input out of sight, opened through `inputRef` by the key that
 *  stands for it, and emptied after every pick so the same file can come
 *  again. */
export function HiddenFileInput({ inputRef, accept, onOpen }: { inputRef: RefObject<HTMLInputElement | null>; accept: string; onOpen: (file: File) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) onOpen(f)
        e.target.value = ''
      }}
    />
  )
}

export function ModelSlot({
  role,
  name,
  detail,
  dotColor,
  busy,
  accept = MESH_ACCEPT,
  formats = MESH_FORMATS,
  onOpen,
}: {
  role: string
  name: string | null
  detail: string
  dotColor: string
  busy: boolean
  /** What the file picker offers. The reference slot takes CAD as well. */
  accept?: string
  /** The same list in prose, for the empty slot. */
  formats?: string
  onOpen: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const slot = role.toLowerCase()
  const pulse = usePulse(`open-${slot}`)
  return (
    <div className="slot" data-test={`slot-${slot}`}>
      <HiddenFileInput inputRef={inputRef} accept={accept} onOpen={onOpen} />
      <span
        className="dot"
        style={{ background: name ? dotColor : 'transparent', borderColor: dotColor }}
      />
      <div className="slotname">
        <b title={name ?? undefined}>{name ?? `No ${role.toLowerCase()} loaded`}</b>
        <span>{name ? detail : formats}</span>
      </div>
      <button
        data-test={`open-${slot}`}
        className={pulse ? 'pulse' : undefined}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {name ? 'Replace…' : 'Open…'}
      </button>
    </div>
  )
}
