// SPDX-License-Identifier: AGPL-3.0-only
// The reference's own mesh for its map: sent with the map's request at the
// spacings it serves, for the reference it was set for only — and a mesh
// handed to the request itself before either.

import { describe, expect, it } from 'vitest'
import { identityRigid } from '../src/core/deviation/rigid'
import { MeshWorkerClient, type ReferenceMesh } from '../src/core/workerClient'

/** A client without its worker: the requests it would post, kept. */
function clientOf(): { client: MeshWorkerClient; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = []
  const client = Object.create(MeshWorkerClient.prototype) as MeshWorkerClient
  Object.assign(client, {
    nextId: 1,
    nominalVersion: 3,
    mapMesh: null,
    request: (msg: Record<string, unknown>) => {
      sent.push(msg)
      return Promise.resolve({})
    },
  })
  return { client, sent }
}

const coarse: ReferenceMesh = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) }
const given: ReferenceMesh = { positions: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0]), indices: Uint32Array.from([0, 1, 2]) }

describe('the mesh set for the map on the reference', () => {
  it('goes with the map at the spacings it serves', async () => {
    const { client, sent } = clientOf()
    client.setReferenceMapMesh(coarse, 0.5)
    await client.deviateReference(identityRigid(), 60, 0.5)
    await client.deviateReference(identityRigid(), 60, 1)
    await client.deviateReference(identityRigid(), 60, 0.25)
    expect(sent.map((m) => m.mesh)).toEqual([coarse, coarse, undefined])
  })

  it('serves the reference it was set for alone', async () => {
    const { client, sent } = clientOf()
    client.setReferenceMapMesh(coarse, 0.5)
    ;(client as unknown as { nominalVersion: number }).nominalVersion++
    await client.deviateReference(identityRigid(), 60, 0.5)
    expect(sent[0].mesh).toBeUndefined()
  })

  it('gives way to a mesh the request is given, and is dropped by null', async () => {
    const { client, sent } = clientOf()
    client.setReferenceMapMesh(coarse)
    await client.deviateReference(identityRigid(), 60, 0.5, given)
    client.setReferenceMapMesh(null)
    await client.deviateReference(identityRigid(), 60, 0.5)
    expect(sent.map((m) => m.mesh)).toEqual([given, undefined])
  })
})
