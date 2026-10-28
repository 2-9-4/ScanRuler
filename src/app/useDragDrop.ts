// SPDX-License-Identifier: AGPL-3.0-only
// Drag & drop anywhere. Owns the "drop it here" flag so the overlay can be
// shown without the rest of the app caring about drag state; where the file
// goes is openAny's call.
import { useEffect, useState } from 'react'
import { openAnyFile, type OpenHandlers } from './openAny'
import { bundleFiles, droppedFiles } from './scanFiles'

/** How long the overlay outlives the last dragover. A browser sends one at
 *  least every 550 ms while a file is held over the page, moving or not. */
const DRAG_LAPSE_MS = 1000

export function useDragDrop(handlers: OpenHandlers): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    let shown = false
    let lapse: ReturnType<typeof setTimeout> | undefined
    const end = () => {
      depth = 0
      clearTimeout(lapse)
      if (!shown) return
      shown = false
      setDragging(false)
    }
    // Entering and leaving don't always pair up — Chrome on Windows can send
    // a dragenter after the drop — so the overlay stays only while dragover
    // keeps coming, and the first pointer move (none arrive during a drag)
    // takes it down at once.
    const alive = () => {
      clearTimeout(lapse)
      lapse = setTimeout(end, DRAG_LAPSE_MS)
    }
    // Only a drag that carries files is a file being brought in — text or a
    // list row dragged within the page is the page's own business.
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth++
      alive()
      shown = true
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      alive()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) end()
    }
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      end()
      // Several files, or a folder, are a textured scan's: the model opens,
      // the rest with it (see scanFiles).
      void droppedFiles(e.dataTransfer).then((files) => {
        const file = bundleFiles(files)
        if (file) return openAnyFile(file, handlers)
      })
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', end)
    window.addEventListener('pointermove', end)
    window.addEventListener('pointerdown', end)
    return () => {
      clearTimeout(lapse)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', end)
      window.removeEventListener('pointermove', end)
      window.removeEventListener('pointerdown', end)
    }
    // Runs on the listed dependencies only, not on everything it reads.
  }, [])
  return dragging
}
