// One toast at a time, bottom of the screen. Doubles as the undo affordance.
import type { Toast as ToastData } from '@/types'

interface ToastProps {
  toast: ToastData | null
  onUndo: () => void
  onDismiss: () => void
}

export default function Toast({ toast, onUndo, onDismiss }: ToastProps) {
  if (!toast) return null
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.onUndo && (
        <button className="link" onClick={onUndo}>Undo</button>
      )}
      <button className="link dim" onClick={onDismiss} aria-label="Dismiss">Dismiss</button>
    </div>
  )
}
