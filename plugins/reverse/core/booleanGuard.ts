// SPDX-License-Identifier: AGPL-3.0-only
// What a boolean's volume must come to, whatever the kernel says: a join
// never loses volume and never makes more than its parts had, a cut never
// gains and never goes below nothing, and a Combine keeps the volume
// identity — what the two bodies share counted once. OCCT's booleans can
// come back closed and valid and still wrong: a face lost on a tangency, a
// piece left out on a tolerance. The builder plays such a step again the
// kernel's other ways and refuses it, saying why, when none passes
// (Builder's guard); a result accepted on a second try carries a warning.

/** How far a volume may stray from what it must be, of the larger: the
 *  kernel's tolerance on a curved face, not a lost piece. */
export const VOLUME_SLACK = 0.002

/** A boolean as the guard reads it, every volume in mm³. A join: its parts
 *  and the result. A cut: the body and the result. A Combine — union,
 *  subtract, intersect — the body, the tool, what they share (when the
 *  builder worked it out; without it a union and a subtract are held to
 *  their bounds alone) and the result. */
export type GuardAsk =
  | { kind: 'join'; parts: readonly number[]; result: number }
  | { kind: 'cut'; body: number; result: number }
  | { kind: 'union' | 'subtract' | 'intersect'; body: number; tool: number; common?: number; result: number }

// units-ok: build message, also the agent's answer.
const mm3 = (v: number) => `${Number(v.toPrecision(6))} mm³`

/** Why a boolean's result cannot stand, or null when it can. */
export function volumeRefusal(ask: GuardAsk): string | null {
  const off = (got: number, want: number, of: number) => Math.abs(got - want) > VOLUME_SLACK * Math.max(of, 1e-9)
  switch (ask.kind) {
    case 'join': {
      const largest = Math.max(0, ...ask.parts)
      const sum = ask.parts.reduce((a, b) => a + b, 0)
      if (ask.result < largest * (1 - VOLUME_SLACK)) return `the join lost volume — ${mm3(ask.result)}, less than the largest part alone, ${mm3(largest)}`
      if (ask.result > sum * (1 + VOLUME_SLACK)) return `the join made volume — ${mm3(ask.result)}, more than its parts together, ${mm3(sum)}`
      return null
    }
    case 'cut':
      if (ask.result > ask.body * (1 + VOLUME_SLACK)) return `the cut gained volume — ${mm3(ask.result)} from ${mm3(ask.body)}`
      if (ask.result < 0) return 'the cut left less than nothing'
      return null
    case 'union':
      if (ask.result < Math.max(ask.body, ask.tool) * (1 - VOLUME_SLACK)) return `the join lost volume — ${mm3(ask.result)}, less than the larger body alone, ${mm3(Math.max(ask.body, ask.tool))}`
      if (ask.result > (ask.body + ask.tool) * (1 + VOLUME_SLACK)) return `the join made volume — ${mm3(ask.result)}, more than the two bodies together, ${mm3(ask.body + ask.tool)}`
      if (ask.common !== undefined && off(ask.result, ask.body + ask.tool - ask.common, ask.body + ask.tool)) return `the join is ${mm3(ask.result)} where the two bodies less what they share come to ${mm3(ask.body + ask.tool - ask.common)}`
      return null
    case 'subtract':
      if (ask.result > ask.body * (1 + VOLUME_SLACK)) return `the cut gained volume — ${mm3(ask.result)} from ${mm3(ask.body)}`
      if (ask.result < ask.body - ask.tool - VOLUME_SLACK * ask.body) return `the cut took more than the tool holds — ${mm3(ask.result)} left of ${mm3(ask.body)} by a tool of ${mm3(ask.tool)}`
      if (ask.common !== undefined && off(ask.result, ask.body - ask.common, ask.body)) return `the cut left ${mm3(ask.result)} where the body less what it shares with the tool comes to ${mm3(ask.body - ask.common)}`
      return null
    case 'intersect':
      // The result is what they share: bounded by the smaller.
      if (ask.result > Math.min(ask.body, ask.tool) * (1 + VOLUME_SLACK)) return `what the bodies share came to ${mm3(ask.result)}, more than the smaller holds, ${mm3(Math.min(ask.body, ask.tool))}`
      return null
  }
}
