// SPDX-License-Identifier: AGPL-3.0-only
// The session as a whole: reading it out, starting it over, what an agent's
// recent jobs did, the workspace on screen, the report, and the undo
// history.

import { runImport } from '../../app/imports'
import { historyBlocked, redo, undo, useHistory } from '../../state/historyStore'
import { useShell } from '../../state/shellStore'
import { useStore } from '../../state/store'
import { commandHost } from '../host'
import { reportJson, reportText, REPORT_WORKSPACES, type ReportWorkspace } from '../report'
import { RECENT_KEPT, RECENT_RESULT_CHARS, recentOutcomes } from '../registry'
import { enumOf, int, obj, str } from '../schema'
import { internalWorkspace, publicWorkspace, sessionState, workspaceNames } from '../state'
import { CommandError, type Command } from '../types'
import { discardSchema, requireDiscardable, waitFor } from './common'

const state: Command = {
  name: 'state',
  title: 'Read the session',
  description:
    'The whole session as JSON: the app and its plugins, the project (its name; unsaved — whether it has changes not saved since it was last saved or opened, as the top bar’s "Unsaved changes" says, null with no page; holds — the work a new scan or project would replace, counted by what it is), the workspace on screen, whether it is busy, the scan (file, units, vertex and triangle counts, bounding box, centre, size, applied alignment), every element with its fit, every dimension with its value, limit and verdict, the sections, what is open in the panels, the deviation, wall thickness and 2D Measure state with their statistics, the guided hint for the next step, and the undo history. Lengths in millimetres, angles in degrees. Read it before acting and after.',
  input: obj({}),
  readOnly: true,
  headless: true,
  run: () => sessionState(),
}

const reset: Command<{ discard?: boolean }> = {
  name: 'reset',
  title: 'Start over',
  description:
    'Close the scan, the reference part and the 2D image, and with them every measurement and the project’s name, as opening an empty project does. Refuses while the session holds measurements unless discard is true. Not undoable: the history starts over too.',
  input: obj({ discard: discardSchema }),
  history: false,
  discards: ({ discard }) => discard === true,
  run: async ({ discard }) => {
    requireDiscardable(discard, 'starting over')
    const { session, flat } = commandHost()
    await runImport(session.imports, 'Starting over…', async () => {
      await session.clientRef.current!.commitImport({ scan: null, nominal: null })
      session.scan.commitScan(null)
      session.deviation.commitNominal(null)
      flat?.closeImage()
      useStore.getState().setProjectName(null)
    })
    return await sessionState()
  },
}

const workspace: Command<{ workspace: string }> = {
  name: 'set',
  title: 'Show a workspace',
  description:
    'Put a workspace on screen: measure (fitting elements and dimensions), deviation (scan against a reference part or an element), thickness (wall thickness), flat (2D measuring of an image or a section), or a plugin’s by its id — session.state lists them under app.plugins. Commands put their own workspace on screen; this is for showing the person something.',
  input: obj({ workspace: str('The workspace — measure, deviation, thickness, flat, or a plugin’s id.', { minLength: 1 }) }, ['workspace']),
  run: async ({ workspace: name }) => {
    if (!workspaceNames().includes(name)) {
      throw new CommandError('invalid_input', `There is no workspace "${name}" — there are ${workspaceNames().join(', ')}.`)
    }
    useShell.getState().setWorkspace(internalWorkspace(name))
    return { workspace: publicWorkspace(useShell.getState().workspace) }
  },
}

const report: Command<{ format?: 'json' | 'text'; workspace?: ReportWorkspace }> = {
  name: 'get',
  title: 'Get the report',
  description:
    'The measurement report. format "text" is word for word what the workspace’s Copy report button puts on the clipboard — measure (elements and dimensions with verdicts), deviation, thickness or flat (2D). format "json" (the default) is the whole session’s report structured: what the numbers rest on (units, scale, frame, applied alignment, fit method and each element’s outlier cut-off), every element with its fit, every dimension with value, unit, limit and pass/fail verdict, the tally of checks, the sections, and the deviation, thickness and 2D results with their settings.',
  input: obj({
    format: enumOf(['json', 'text'], 'json (the default) or text.'),
    workspace: enumOf(REPORT_WORKSPACES, 'For text: whose report — measure (the default), deviation, thickness or flat.'),
  }),
  readOnly: true,
  run: async ({ format = 'json', workspace: w = 'measure' }) =>
    format === 'text' ? { format, workspace: w, text: reportText(w) } : { format, report: reportJson() },
}

/** Walk the history one step, as the undo keys do. */
async function travel(back: boolean) {
  const h = useHistory.getState()
  const entry = (back ? h.past : h.future).at(-1)
  if (!entry) throw new CommandError('invalid_state', `There is nothing to ${back ? 'undo' : 'redo'}.`)
  if (historyBlocked()) {
    throw new CommandError('invalid_state', `Something open in a panel is in the way of ${back ? 'undo' : 'redo'} — finish or cancel it first.`)
  }
  await (back ? undo() : redo())
  const after = useHistory.getState()
  if ((back ? after.future : after.past).at(-1) !== entry) {
    throw new CommandError('failed', `The step "${entry.label}" could not be ${back ? 'undone' : 'redone'}.`)
  }
  return { [back ? 'undone' : 'redone']: entry.label, workspace: publicWorkspace(entry.workspace), state: await sessionState() }
}

const undoCommand: Command = {
  name: 'undo',
  title: 'Undo',
  description: 'Undo the last step — one of the person’s or one of these commands, each of which is one step. Returns the step’s name and the session afterwards.',
  input: obj({}),
  history: false,
  headless: true,
  run: () => travel(true),
}

const redoCommand: Command = {
  name: 'redo',
  title: 'Redo',
  description: 'Redo the step undone last. Returns the step’s name and the session afterwards.',
  input: obj({}),
  history: false,
  headless: true,
  run: () => travel(false),
}

const recent: Command<{ job?: string; limit?: number }> = {
  name: 'recent',
  title: 'What recent jobs did',
  description: `What became of the commands an agent’s server ran under its jobs — each change and each batch is one, and the server names it — newest first: the job, the command, running, done or failed, when it started and its ms, and its result or its error { code, message }. A result past ${RECENT_RESULT_CHARS.toLocaleString('en-US')} characters is left out (resultOmitted says its size). The page keeps the last ${RECENT_KEPT} for as long as it stays open, so a server started after the one that asked can still say what a job did. job: only that job’s.`,
  input: obj({
    job: str('Only this job’s commands, as the server named it.', { minLength: 1 }),
    limit: int('How many at most, newest first — 20 by default.', { minimum: 1, maximum: RECENT_KEPT }),
  }),
  readOnly: true,
  run: async ({ job, limit = 20 }) => {
    const all = recentOutcomes(job)
    return { outcomes: all.slice(0, limit), ...(all.length > limit ? { more: all.length - limit } : {}) }
  },
}

export const sessionCommands = [state, reset, recent]
export const workspaceCommands = [workspace]
export const reportCommands = [report]
/** The history as a checkpoint found it: the step on top by itself, the
 *  object the history holds — a checkpoint is the steps under it. */
const checkpoints = new Map<string, { top: object | null; label: string | null }>()
let nextCheckpoint = 1
/** How many checkpoints are remembered, the oldest let go first. */
const CHECKPOINTS = 100

const checkpointCommand: Command = {
  name: 'checkpoint',
  title: 'Mark the history',
  description:
    'Mark where the undo history stands, before a run of changes that should stand or fall together: history.restore { checkpoint } later undoes every step made since, back to this mark. Changes nothing. Returns the checkpoint, the step on top and how many there are.',
  input: obj({}),
  readOnly: true,
  headless: true,
  run: async () => {
    const past = useHistory.getState().past
    const top = past.at(-1) ?? null
    const checkpoint = `cp${nextCheckpoint++}`
    checkpoints.set(checkpoint, { top, label: top?.label ?? null })
    if (checkpoints.size > CHECKPOINTS) checkpoints.delete(checkpoints.keys().next().value!)
    return { checkpoint, top: top?.label ?? null, steps: past.length }
  },
}

const restoreCommand: Command<{ checkpoint: string }> = {
  name: 'restore',
  title: 'Back to a mark in the history',
  description:
    'Undo every step made since history.checkpoint gave this checkpoint, newest first, as the undo key would one by one — so a run of changes that went wrong in the middle is taken back whole. Refused, undoing nothing, when the mark is no longer under the steps on top — undone past it, or the history started afresh (a scan or a project opened). Returns the steps undone, newest first, and the session afterwards.',
  input: obj({ checkpoint: str('What history.checkpoint returned.', { minLength: 1 }) }, ['checkpoint']),
  history: false,
  headless: true,
  run: async ({ checkpoint }) => {
    const mark = checkpoints.get(checkpoint)
    if (!mark) throw new CommandError('not_found', `There is no checkpoint "${checkpoint}" — history.checkpoint gives one.`)
    const past = useHistory.getState().past
    const at = mark.top === null ? -1 : past.indexOf(mark.top as (typeof past)[number])
    if (mark.top !== null && at < 0) {
      throw new CommandError('invalid_state', `The history no longer holds the step the checkpoint was made on (“${mark.label}”) — it was undone, or the history started afresh; nothing was undone.`)
    }
    const undone: string[] = []
    while (useHistory.getState().past.length - 1 > at) {
      // Each step once the one before has settled — a rebuild it set off
      // holds the history until it lands.
      await waitFor(() => !historyBlocked() && !useHistory.getState().restoring, 'the history to be free to undo', 120_000)
      const entry = useHistory.getState().past.at(-1)!
      await undo()
      if (useHistory.getState().future.at(-1) !== entry) throw new CommandError('failed', `The step "${entry.label}" could not be undone; ${undone.length} were.`)
      undone.push(entry.label)
    }
    return { undone, state: await sessionState() }
  },
}

export const historyCommands = [undoCommand, redoCommand, checkpointCommand, restoreCommand]
