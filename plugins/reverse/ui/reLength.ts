// SPDX-License-Identifier: AGPL-3.0-only
// Lengths in the workspace's boxes, rows and number fields, in the display
// units. The model holds millimetres — features, drafts, parameters and the
// expressions kept beside them — and keeps them so: what is shown converts
// on the way out and what is typed on the way in, and a project saved with
// either unit on screen builds the same.
//
// Typed text in inches, for a length:
// - a number, signed or not, is the figure in inches: it is held as its
//   millimetres, with no expression kept (a parameter, whose expression is
//   all it holds, keeps it as `0.5 in`, which the language reads as 12.7 mm);
// - arithmetic of bare numbers and nothing else (`1/4`, `0.5 + 0.125`) is
//   also a figure in inches: it is kept as `(1/4) * 1 in`, which reads the
//   same in millimetres wherever it is evaluated again;
// - anything that names a parameter or carries a unit (`width + 5`,
//   `2 * 1 in`) is kept as typed and read as the language always reads it —
//   a bare number beside a length is millimetres there, so `width + 0.5`
//   adds half a millimetre and an inch is written `0.5 in`. Converting those
//   literals would need the evaluator to say which of them became lengths,
//   and an expression kept with inches baked into bare numbers would build
//   otherwise when evaluated as millimetres.

import { fromDisplay, lengthDecimals, lengthInputText, toDisplay, unitWord, type DisplayUnits } from '../../../src/core/units'
import { evaluate, evaluateFor, isPlainNumber, type ParameterKind, type Scope } from '../core/expression'

/** A number to `places` decimals, with no zeros carried behind it. */
const rounded = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places

/** A length as a number in the units shown, without its unit: to
 *  `mmPlaces` decimals in millimetres, one more (at least three) in inches,
 *  no zeros carried — "12.5", "0.492". */
export function lenBare(mm: number, units: DisplayUnits, mmPlaces = 3): string {
  return String(rounded(toDisplay(mm, units), lengthDecimals(mmPlaces, units)))
}

/** A length as a row reads it, with its unit: "12.5 mm", "0.492 in". */
export function lenShort(mm: number, units: DisplayUnits, mmPlaces = 2): string {
  return `${lenBare(mm, units, mmPlaces)} ${unitWord(units)}`
}

/** The number a field shows for what it holds, while no expression is set:
 *  a length in the units shown. */
export function fieldText(value: number, kind: ParameterKind, places: number, units: DisplayUnits): string {
  if (kind !== 'length') return String(rounded(value, places))
  return lenBare(value, units, places)
}

/** A bare number with a sign before it or none: "-5", "+0.25". */
const SIGNED_NUMBER = /^[+-]?\s*(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/** Whether the text is arithmetic of bare numbers and nothing else — no
 *  parameter, no unit: a figure the person means in the units shown. */
function bareArithmetic(text: string): boolean {
  const r = evaluate(text, () => undefined)
  return r.ok && r.dim === 'free'
}

/** Bare arithmetic kept so that it reads in inches wherever it is evaluated
 *  again: `(1/4) * 1 in`. */
const inInches = (text: string): string => `(${text}) * 1 in`

export type ReadField = { ok: true; value: number; expr: string | null } | { ok: false; error: string }

/** A field's text read for a field of `kind`: the value to hold, in
 *  millimetres for a length, and the expression to keep beside it — null
 *  for a plain number. In millimetres, and for every field that is not a
 *  length, it is what the field always did; in inches see the head of this
 *  file. */
export function readField(text: string, kind: ParameterKind, scope: Scope, units: DisplayUnits): ReadField {
  const t = text.trim()
  const r = evaluateFor(t, kind, scope)
  if (!r.ok) return { ok: false, error: r.error }
  if (kind !== 'length' || units === 'mm') return { ok: true, value: r.value, expr: isPlainNumber(t) ? null : t }
  if (SIGNED_NUMBER.test(t)) return { ok: true, value: fromDisplay(r.value, units), expr: null }
  if (bareArithmetic(t)) return { ok: true, value: fromDisplay(r.value, units), expr: inInches(t) }
  return { ok: true, value: r.value, expr: t }
}

/** A parameter's expression as its row shows it: a length given as a plain
 *  number is millimetres, shown in the units shown; anything else as it was
 *  typed. */
export function parameterText(expression: string, kind: ParameterKind, units: DisplayUnits): string {
  const t = expression.trim()
  if (kind !== 'length' || units === 'mm' || !SIGNED_NUMBER.test(t)) return expression
  return lengthInputText(Number(t.replace(/\s+/g, '')), units)
}

/** What a parameter's expression is kept as, from what was typed into its
 *  row — the same text but where a length's figure was typed in inches. */
export function parameterExpression(typed: string, kind: ParameterKind, units: DisplayUnits): string {
  const t = typed.trim()
  if (kind !== 'length' || units === 'mm' || t === '') return typed
  if (SIGNED_NUMBER.test(t)) return `${t} in`
  if (bareArithmetic(t)) return inInches(t)
  return typed
}
