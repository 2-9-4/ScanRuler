// SPDX-License-Identifier: AGPL-3.0-only
// A part's key on the view bar — the scan, the reference, the elements, a
// workspace's own. A click shows the part or puts it away; the menu that
// opens over the key, on hover or from its caret, says how the part is
// drawn: see-through, its mesh, its back faces, whatever it has of its own.
// What is on the stage stays one click away, and how it looks, which is set
// now and then and left, keeps out of sight until it is asked for. A dot on
// the key says something in its menu stands otherwise than the workspace
// opens with, so a setting left on is never out of sight altogether.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

/** A switch on the view bar, as whoever holds it gives it. */
export interface ViewSwitch {
  on: boolean
  set(on: boolean): void
  /** Why it cannot be switched now: greyed out, with this as its tip. */
  disabled?: string
  /** How it stands as the workspace opens: a part's key carries a dot while
   *  a switch in its menu stands otherwise. Left out, it is not counted. */
  normal?: boolean
}

/** Whether any of the switches stands otherwise than it opens. */
export function anyChanged(switches: readonly (ViewSwitch | undefined)[]): boolean {
  return switches.some((s) => s?.normal !== undefined && s.on !== s.normal)
}

/** How long the pointer rests on a key before its menu opens — long enough
 *  that sweeping across the bar opens nothing — and how long it may be off
 *  the key and the menu before the menu closes: the way from one to the
 *  other may cut a corner. */
const OPEN_DELAY = 140
const CLOSE_DELAY = 260

export function PartKey({
  icon,
  label,
  testId,
  shown,
  title,
  changed = false,
  children,
}: {
  icon: ReactNode
  label: string
  testId: string
  /** The click: the part shown or put away. */
  shown: ViewSwitch
  /** The key's tip while it can be clicked. */
  title: string
  /** Something in the menu stands otherwise than it opens — see anyChanged. */
  changed?: boolean
  /** The menu's rows, PartOption and PartChoice; none, no menu. */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  // Opened by its caret rather than by hover: the caret then closes it
  // again. Opened by hover it does not — the pointer resting on the caret
  // has opened the menu by the time the click lands, and the click is meant
  // to open it, not to close it.
  const pinned = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const hasMenu = Boolean(children)
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // A press anywhere else closes it, as any menu: opened from the caret by
  // touch there is no pointer to leave it.
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [open])
  // Hover is the mouse's: a touch would open the menu with the same tap
  // that switches the part.
  const mouse = (e: ReactPointerEvent) => e.pointerType === 'mouse'

  return (
    <div
      className={`partkey${shown.on ? ' on' : ''}${hasMenu ? ' hasmenu' : ''}${shown.disabled ? ' locked' : ''}`}
      ref={root}
      onPointerEnter={(e) => {
        if (hasMenu && mouse(e)) {
          later(() => {
            pinned.current = false
            setOpen(true)
          }, OPEN_DELAY)
        }
      }}
      onPointerLeave={(e) => {
        if (mouse(e)) later(() => setOpen(false), CLOSE_DELAY)
      }}
    >
      {/* Greyed out by its ARIA state, not `disabled`: a disabled button
          swallows the pointer, and the menu of a part that cannot be put
          away is still to be reached. */}
      <button
        className={shown.on ? 'on' : undefined}
        data-test={testId}
        aria-pressed={shown.on}
        aria-disabled={shown.disabled ? true : undefined}
        onClick={() => {
          if (!shown.disabled) shown.set(!shown.on)
        }}
        title={shown.disabled ?? title}
      >
        {icon}
        {label}
        {changed && <span className="partdot" role="img" aria-label="set otherwise in its menu" />}
      </button>
      {hasMenu && (
        <button
          className={`partcaret${shown.on ? ' on' : ''}`}
          data-test={`${testId}-menu`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            window.clearTimeout(timer.current)
            const close = open && pinned.current
            pinned.current = !close
            setOpen(!close)
          }}
          title={`How the ${label.toLowerCase()} ${label.endsWith('s') ? 'are' : 'is'} drawn`}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" focusable="false">
            <path d="M1 5.5 4 2.5 7 5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {/* Kept in the page while closed, so what stands in it can be read. */}
      {hasMenu && (
        <div className="partmenu" role="menu" aria-label={label} data-test={`${testId}-options`} hidden={!open}>
          {children}
        </div>
      )}
    </div>
  )
}

/** A switch in a part's menu, as a key of its own: pressed while on. */
export function PartOption({
  icon,
  label,
  testId,
  value,
  title,
}: {
  icon: ReactNode
  label: string
  testId: string
  value: ViewSwitch
  title: string
}) {
  return (
    <button
      role="menuitemcheckbox"
      className={value.on ? 'on' : undefined}
      data-test={testId}
      aria-checked={value.on}
      disabled={Boolean(value.disabled)}
      onClick={() => value.set(!value.on)}
      title={value.disabled ?? title}
    >
      {icon}
      {label}
    </button>
  )
}

/** One of a few ways a part may be drawn, in its menu: a row of keys, the
 *  one that stands pressed. */
export function PartChoice<T extends string>({
  icon,
  label,
  testId,
  value,
  options,
  onChange,
  title,
}: {
  icon: ReactNode
  label: string
  testId: string
  value: T
  options: readonly { id: T; label: string; title: string }[]
  onChange(value: T): void
  title: string
}) {
  return (
    <div className="partchoice" role="radiogroup" aria-label={label} title={title}>
      <span className="partchoice-label">
        {icon}
        {label}
      </span>
      <span className="partchoice-keys">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            className={value === o.id ? 'on' : undefined}
            data-test={`${testId}-${o.id}`}
            onClick={() => onChange(o.id)}
            title={o.title}
          >
            {o.label}
          </button>
        ))}
      </span>
    </div>
  )
}
