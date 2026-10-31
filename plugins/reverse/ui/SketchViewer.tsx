// SPDX-License-Identifier: AGPL-3.0-only
// The sketch editor's stage: the 2D Measure sheet, laid over the 3D
// viewport as a see-through layer while a sketch is open in the Reverse
// engineer workspace — the same FlatScene as the 2D viewport, same
// navigation, same line weights, on a transparent canvas — with the 3D
// camera following its every pan and zoom, so the sketch is drawn on the
// part the way CAD draws it. The same thin-wrapper shape as FlatViewer;
// only what a click means differs, and that is the store's business.

import { useEffect, useRef, useState } from 'react'
import type { Vec2 } from '../../../src/core/flat/types'
import { usePrefs } from '../../../src/state/prefsStore'
import { useStore } from '../../../src/state/store'
import { FlatScene } from '../../../src/viewer/FlatScene'
import { schemeById } from '../../../src/viewer/navSchemes'
import { sceneTheme } from '../../../src/viewer/viewThemes'
import { useFlatSceneSettings } from '../../../src/ui/FlatViewer'

export function SketchViewer({
  onReady,
  onPick,
  onHover,
  onDragStart,
  onDrag,
  onDragEnd,
  onNoteSelect,
  onDimensionEdit,
  onDimensionMove,
  onViewChange,
}: {
  onReady: (scene: FlatScene | null) => void
  /** A click on the sheet; `raw` says Ctrl was held, which switches
   *  snapping off for the pick, as in Fusion. */
  onPick: (p: Vec2, meta: { raw: boolean; shift?: boolean; unitsPerScreenPx: number }) => void
  /** The cursor over the sheet, or off it — what a drawing tool rubber-bands
   *  to. `unitsPerScreenPx` is the scale of the moment, for snapping; `raw`
   *  says snapping is switched off (Ctrl held). */
  onHover: (p: Vec2 | null, unitsPerScreenPx: number, raw: boolean) => void
  /** A press on the sheet the sketch may take as a drag of a piece — see
   *  FlatScene.onSheetDown — and the drag's moves and end. */
  onDragStart: (p: Vec2, meta: { raw: boolean; unitsPerScreenPx: number }) => boolean
  onDrag: (p: Vec2, meta: { raw: boolean; unitsPerScreenPx: number }) => void
  onDragEnd: () => void
  /** A relation's glyph clicked — to select it in the panel. */
  onNoteSelect: (id: number) => void
  /** The text typed into a dimension's label on the sheet — a number, or
   *  an expression — as typed, in the units shown. */
  onDimensionEdit: (id: number, text: string) => void
  /** A dimension's number dragged on the sheet; `begin` on the drag's first
   *  step. */
  onDimensionMove: (id: number, p: Vec2, begin: boolean) => void
  /** The sheet's view moved: what is under its centre, and its scale — for
   *  the 3D viewport underneath to follow. */
  onViewChange: (centre: Vec2, unitsPerScreenPx: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(onViewChange)
  viewRef.current = onViewChange
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover
  const dragStartRef = useRef(onDragStart)
  dragStartRef.current = onDragStart
  const dragRef = useRef(onDrag)
  dragRef.current = onDrag
  const dragEndRef = useRef(onDragEnd)
  dragEndRef.current = onDragEnd
  const noteRef = useRef(onNoteSelect)
  noteRef.current = onNoteSelect
  const dimensionRef = useRef(onDimensionEdit)
  dimensionRef.current = onDimensionEdit
  const dimensionMoveRef = useRef(onDimensionMove)
  dimensionMoveRef.current = onDimensionMove
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const sceneRef = useRef<FlatScene | null>(null)
  const [webglError, setWebglError] = useState<string | null>(null)

  useEffect(() => {
    let scene: FlatScene
    try {
      scene = new FlatScene(containerRef.current!, sceneTheme(useStore.getState().viewTheme, usePrefs.getState().dark), { transparent: true })
      scene.setLineWidth(usePrefs.getState().sheetLines)
      scene.setEdgeWidth(usePrefs.getState().edgeLines)
    } catch (e) {
      console.error(e)
      setWebglError(e instanceof Error ? e.message : String(e))
      return
    }
    scene.setNavScheme(schemeById(useStore.getState().navScheme))
    // The sheet reports every modifier; the sketch reads Ctrl as "raw" and
    // lets Alt be what it is elsewhere in the tool.
    scene.onPick = (p, meta) => pickRef.current(p, { raw: meta.ctrl ?? false, shift: meta.shift, unitsPerScreenPx: meta.unitsPerScreenPx })
    scene.onHoverPoint = (p, _x, _y, _alt, ctrl) => hoverRef.current(p, scene.unitsPerScreenPx(), ctrl ?? false)
    scene.onSheetDown = (p, meta) => dragStartRef.current(p, { raw: meta.ctrl, unitsPerScreenPx: meta.unitsPerScreenPx })
    scene.onSheetDrag = (p, meta) => dragRef.current(p, { raw: meta.ctrl, unitsPerScreenPx: meta.unitsPerScreenPx })
    scene.onSheetDragEnd = () => dragEndRef.current()
    scene.onNoteSelect = (id) => noteRef.current(id)
    scene.onDimensionEdit = (id, value) => dimensionRef.current(id, value)
    scene.onDimensionMove = (id, p, begin) => dimensionMoveRef.current(id, p, begin)
    scene.onViewChange = (centre, upp) => viewRef.current(centre, upp)
    sceneRef.current = scene
    readyRef.current(scene)
    return () => {
      sceneRef.current = null
      readyRef.current(null)
      scene.dispose()
    }
  }, [])

  useFlatSceneSettings(sceneRef)

  return (
    <div className="viewport" ref={containerRef} data-test="sketch-viewport">
      {webglError !== null && (
        <div className="webgl-missing" role="alert">
          <b>The sketch view could not be started.</b>
          <p className="webgl-missing-detail">{webglError}</p>
        </div>
      )}
    </div>
  )
}
