// SPDX-License-Identifier: AGPL-3.0-only
// Drag & drop anywhere. Owns the "drop it here" flag so the overlay can be
// shown without the rest of the app caring about drag state; where the file
// goes is openAny's call.
import { useEffect, useState } from 'react'
import { openAnyFile, type OpenHandlers } from './openAny'
import { bundleFiles, droppedFiles } from './scanFiles'

export function useDragDrop(handlers: OpenHandlers): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    // Only a drag that carries files is a file being brought in — text or a
    // list row dragged within the page is the page's own business.
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
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
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
    // Runs on the listed dependencies only, not on everything it reads.
  }, [])
  return dragging
}
