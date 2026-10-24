import { Dialog } from 'radix-ui'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'

interface Props {
  title: string
  hint: string
  error: string | null
  busy: boolean
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
  submitLabel?: string
  /** Shown beside the buttons, such as a keyboard shortcut. */
  footer?: ReactNode
  /** Return true to keep the dialog open, e.g. while a suggestion list is showing. */
  onEscape?: () => boolean
  onKeyDown?: (e: KeyboardEvent<HTMLFormElement>) => void
}

/** A modal form: title, hint, fields, an error line, Cancel and a submit button. */
export function Frame({
  title,
  hint,
  error,
  busy,
  onSubmit,
  onClose,
  children,
  submitLabel = 'Save',
  footer,
  onEscape,
  onKeyDown,
}: Props) {
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!busy) onSubmit()
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog"
          data-testid="dialog"
          onEscapeKeyDown={(e) => {
            if (onEscape?.()) e.preventDefault()
          }}
        >
          <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-col gap-4">
            <Dialog.Title className="dialog-title">{title}</Dialog.Title>
            <Dialog.Description className="dialog-hint">{hint}</Dialog.Description>
            {children}
            {error && (
              <p role="alert" className="dialog-error">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              {footer && <span className="dialog-hint mr-auto">{footer}</span>}
              <Dialog.Close asChild>
                <button type="button" className="button">
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="button button-primary" disabled={busy}>
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
