import { useRef, useCallback, useEffect } from 'react'

// Deleting hides the row and schedules the real DELETE for later, so Undo is just
// cancelling a timer. No soft-delete column, no restore endpoint, and the row keeps its
// id and its children because it was never actually removed.
//
// ponytail: if the tab closes inside the window the DELETE never fires and the row
// survives. Acceptable — it fails toward keeping the user's data.
const WINDOW_MS = 5000

interface Options {
  onCommit: (key: string) => void
  onToast: (message: string, onUndo?: (() => void) | null) => void
  reload: () => void
}

export function useUndoableDelete({ onCommit, onToast, reload }: Options) {
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout> }>())

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(({ timer }) => clearTimeout(timer))
  }, [])

  const remove = useCallback(
    (key: string, label: string, doDelete: () => Promise<unknown>) => {
      const timer = setTimeout(async () => {
        timers.current.delete(key)
        try {
          await doDelete()
        } catch {
          reload() // the delete failed — put the row back rather than lying
        }
      }, WINDOW_MS)

      timers.current.set(key, { timer })
      onCommit(key)
      onToast(`Deleted ${label}`, () => {
        const entry = timers.current.get(key)
        if (entry) clearTimeout(entry.timer)
        timers.current.delete(key)
        reload()
      })
    },
    [onCommit, onToast, reload],
  )

  // Rows awaiting deletion must stay hidden across a reload(), or an unrelated refresh
  // would make a "deleted" row reappear before its timer fires.
  const isPending = useCallback((key: string) => timers.current.has(key), [])

  return { remove, isPending }
}
