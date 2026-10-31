// SPDX-License-Identifier: AGPL-3.0-only
// Whether this JavaScript engine can run the OCCT kernel at all. The build
// of Open CASCADE the Reverse engineer workspace uses is compiled with
// WebAssembly tail calls, which Chrome 114, Safari 17.2, Firefox 121 and
// Node 22 have and older engines refuse at validation time — before a byte
// of the 5 MB download would have been worth fetching. So the question is
// put to the engine with the smallest module that uses the instruction: one
// function that tail-calls itself. Validating it says yes or no in a
// microsecond; the workspace uses the answer to say why it is unavailable
// rather than to fail on an opaque compile error.

/** `(module (func (return_call 0)))`, hand-assembled. */
const TAIL_CALL_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic, version 1
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type section: one type, () → ()
  0x03, 0x02, 0x01, 0x00, // function section: one function of type 0
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x12, 0x00, 0x0b, // code: no locals, return_call 0, end
])

export function wasmTailCallsSupported(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(TAIL_CALL_PROBE)
  } catch {
    // An engine that throws on the probe cannot run the kernel either.
    return false
  }
}

/** Why the kernel cannot run here, for the panel — or null when it can. */
export function kernelUnavailableReason(): string | null {
  if (typeof WebAssembly === 'undefined') return 'This browser has no WebAssembly, which the CAD kernel is built on.'
  if (!wasmTailCallsSupported()) {
    return 'The CAD kernel needs WebAssembly tail calls, which this browser lacks — Chrome 114, Safari 17.2 or Firefox 121 and later have them. The rest of the tool works as before.'
  }
  return null
}
