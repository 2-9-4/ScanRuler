// SPDX-License-Identifier: AGPL-3.0-only
// Manifold (Apache-2.0), the mesh boolean behind core/boolean, loaded in the
// mesh worker on first use: most sessions never take a solid out of a scan,
// and the module carries half a megabyte of WebAssembly. A failed load is
// not cached, so the next attempt tries again.

import type { ManifoldToplevel } from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'

let loading: Promise<ManifoldToplevel> | null = null

export function loadManifold(): Promise<ManifoldToplevel> {
  loading ??= import('manifold-3d')
    .then(async ({ default: Module }) => {
      const wasm = await Module({ locateFile: () => wasmUrl })
      wasm.setup()
      return wasm
    })
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}
