// SPDX-License-Identifier: AGPL-3.0-only
// reverse.build.stop: a build that does not finish, stopped. A wasm call
// cannot be interrupted, so the CAD kernel is let go and started again,
// the feature whose step was in play suppressed, and the part built
// without it (reSession.ts stop) — run at once, beside a change waiting
// for that build, and over the busy guard that change's build holds up.

import { obj } from '../../../src/commands/schema'
import { errorMessage } from '../../../src/commands/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { bodiesChanged, bodyRows, failures } from './reCommandAnswers'
import { re, session } from './reCommandCore'

export const buildStop: Command = {
  name: 'build.stop',
  title: 'Stop the build',
  description:
    'Stop the build the CAD kernel is at — one that does not finish, a step in it running on. A call inside the kernel cannot be interrupted: the kernel is let go and started again, the scan handed to it again, the feature whose step was in play suppressed (its picks and numbers kept) and the part built without it. Runs at once, while the session is busy and beside a change waiting for that build, which then answers what the stop said; a wait for the build stops it the same way at its limit (300 s). Returns stopped: { feature, step, call, seconds } (null with nothing building), message, the bodies the rebuild changed and what failed.',
  input: obj({}),
  interrupts: true,
  label: () => 'stop the build',
  run: async () => {
    const s = session()
    const before = bodyRows(s)
    const stopped = await s.stop('asked')
    if (!stopped) return { stopped: null, message: 'Nothing is building: the CAD kernel is at no build.' }
    try {
      await s.settled()
    } catch (e) {
      throw new CommandError('failed', `${stopped.message} Then: ${errorMessage(e)}`)
    }
    const failed = failures()
    return {
      stopped: {
        feature: stopped.feature?.name ?? null,
        ...(stopped.step !== undefined ? { step: stopped.step } : {}),
        ...(stopped.call ? { call: stopped.call } : {}),
        seconds: Math.round(stopped.ms / 1000),
      },
      message: stopped.message,
      bodies: bodiesChanged(s, before),
      ...(failed.length > 0 ? { failed } : {}),
      ...(re().buildError ? { buildError: re().buildError } : {}),
    }
  },
}
