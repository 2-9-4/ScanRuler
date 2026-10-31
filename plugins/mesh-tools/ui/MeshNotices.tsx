// SPDX-License-Identifier: AGPL-3.0-only
// What the imprint owes the libraries this workspace ships.

export function MeshNotices() {
  return (
    <p>
      The Mesh Tools workspace reduces meshes with{' '}
      <a href="https://github.com/zeux/meshoptimizer" target="_blank" rel="noopener noreferrer">
        meshoptimizer
      </a>{' '}
      (© Arseny Kapoulkine, MIT) and makes its booleans with{' '}
      <a href="https://github.com/elalish/manifold" target="_blank" rel="noopener noreferrer">
        Manifold
      </a>{' '}
      (© The Manifold Authors, Apache-2.0). Both are loaded as WebAssembly when they are first
      used, and are used unmodified.
    </p>
  )
}
