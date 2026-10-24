// The pointerup that ends a drag can also click the tile under it; that click must not
// focus the session.
const AFTER_DRAG_MS = 250
let lastDragEnd = Number.NEGATIVE_INFINITY

export function markDragEnd(): void {
  lastDragEnd = Date.now()
}

export function justDragged(): boolean {
  return Date.now() - lastDragEnd < AFTER_DRAG_MS
}
