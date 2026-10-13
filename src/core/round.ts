// SPDX-License-Identifier: AGPL-3.0-only
// Numbers kept to a fixed count of decimals, for an answer to be read rather
// than computed on: what the commands hand back, and the readouts beside
// them. Halves round up, as Math.round has them.

/** `v` to `places` decimals. */
export const roundTo = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places

/** Three decimals — a micrometre, for millimetres. */
export const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** Four decimals. */
export const round4 = (v: number): number => Math.round(v * 10_000) / 10_000
