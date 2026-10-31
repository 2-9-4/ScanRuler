// SPDX-License-Identifier: AGPL-3.0-only
// The field every number of the workspace is typed into: a number, or an
// expression — `25.4/12`, `height + 5`, `sin(30) * r` — read by
// core/expression against the model's parameters. A plain number is handed
// on as one; anything else is handed on with the expression beside it, and
// the field keeps showing the expression, the value it comes to written
// where the unit was. An expression that cannot be read stays in the field
// with why under it, until it is put right or Escape puts the old text
// back. The parameters' names are offered as the field is typed into.
//
// A length field holds millimetres and shows and takes the display units,
// writing their word itself; how typed text in inches is kept is said in
// reLength.ts.

import { useState, type KeyboardEvent } from 'react'
import { useUnits } from '../../../src/app/useUnits'
import { unitWord } from '../../../src/core/units'
import { formatValue, type ParameterKind } from '../core/expression'
import { useReverse } from '../state/reStore'
import { fieldText, readField } from './reLength'

/** The id of the datalist of parameter names, rendered once by the
 *  parameter list. */
export const PARAMETER_NAMES_LIST = 're-parameter-names'

export function ExprInput({
  value,
  expr,
  kind,
  unit,
  testId,
  places = 3,
  dataDimension,
  passKeys,
  onCommit,
  onEnter,
}: {
  value: number
  /** The expression behind the value, or none. */
  expr?: string
  kind: ParameterKind
  /** Written after the number — "°", "%" — while no expression is set;
   *  with one, the value it comes to is written there instead. A length
   *  field writes the display unit's word whatever is given, but for "",
   *  which leaves the word to the label. */
  unit?: string
  testId: string
  places?: number
  dataDimension?: number
  /** For a field that takes the keys by itself as its box opens: while
   *  nothing is typed into it, the keys it has no use for do what they do
   *  in the box — Escape goes on to close the box, and Enter does `enter`,
   *  the box's own Enter — as if the field had not taken them. */
  passKeys?: { enter: () => void }
  /** The number read, and the expression it was typed as — null for a
   *  plain number. */
  onCommit: (value: number, expr: string | null) => void
  /** Enter, once the text has been taken. */
  onEnter?: () => void
}) {
  const scope = useReverse((s) => s.parameterTable.scope)
  const units = useUnits()
  const [error, setError] = useState<string | null>(null)
  const shown = expr ?? fieldText(value, kind, places, units)
  const word = unit === '' ? '' : kind === 'length' ? unitWord(units) : (unit ?? '')
  const result = formatValue(value, kind, units)
  const take = (text: string): boolean => {
    const t = text.trim()
    if (t === '' || t === shown) {
      setError(null)
      return true
    }
    const r = readField(t, kind, scope, units)
    if (!r.ok) {
      setError(r.error)
      return false
    }
    setError(null)
    onCommit(r.value, r.expr)
    return true
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const untouched = e.currentTarget.value === shown && !error
    if (e.key === 'Enter') {
      if (passKeys && untouched) {
        e.currentTarget.blur()
        passKeys.enter()
      } else if (take(e.currentTarget.value)) {
        onEnter?.()
        e.currentTarget.blur()
      }
    } else if (e.key === 'Escape') {
      if (passKeys && untouched) return
      // The field's own: the old text comes back, and the key goes no
      // further to put a tool or a selection down.
      e.preventDefault()
      e.currentTarget.value = shown
      setError(null)
      e.currentTarget.blur()
    }
  }
  return (
    <>
      <span className={'unitfield' + (expr ? ' expr' : '')}>
        <input
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          list={PARAMETER_NAMES_LIST}
          data-test={testId}
          data-dimension={dataDimension}
          key={shown}
          defaultValue={shown}
          title={expr ? `${expr} = ${result}` : undefined}
          onBlur={(e) => take(e.target.value)}
          onKeyDown={keys}
        />
        <i>{expr ? `= ${result}` : word}</i>
      </span>
      {error && (
        <span className="hint warn exprerror" data-test={`${testId}-error`}>
          {error}
        </span>
      )}
    </>
  )
}
