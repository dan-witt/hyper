import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { launchDirectory, launchSession } from '../api/client'
import { useBoard } from '../store'
import { Frame } from './DialogFrame'
import { DirectoryField } from './DirectoryField'

/** Start a Claude Code session whose tile goes in `cell`. Ctrl+Enter launches. */
export function LaunchDialog({ cell, onClose }: { cell: number; onClose: () => void }) {
  const [cwd, setCwd] = useState('')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const listOpen = useRef(false)
  const typed = useRef(false)

  useEffect(() => {
    let current = true
    void launchDirectory().then((dir) => {
      if (current && !typed.current) setCwd(dir)
    })
    return () => {
      current = false
    }
  }, [])

  const launch = async () => {
    if (!cwd.trim()) {
      setError('A directory is required.')
      return
    }
    setBusy(true)
    const result = await launchSession({ cwd: cwd.trim(), name, prompt, cell })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (result.data.dry_run) {
      useBoard.getState().notify({
        kind: 'info',
        message: 'Dry run: the service runs with --dev, so nothing was launched (add --live-launch)',
      })
    }
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter') return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      if (!busy) void launch()
    } else if (e.target instanceof HTMLInputElement) {
      e.preventDefault() // only Ctrl+Enter or the button launches
    }
  }

  return (
    <Frame
      title="Launch a session"
      hint="Starts Claude Code in a new window of the claude tmux session. The board stays where it is."
      error={error}
      busy={busy}
      submitLabel="Launch"
      footer="Ctrl+Enter"
      onSubmit={() => void launch()}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onEscape={() => listOpen.current}
    >
      <label className="flex flex-col gap-1">
        <span className="dialog-hint">Directory</span>
        <DirectoryField
          value={cwd}
          onChange={(v) => {
            typed.current = true
            setCwd(v)
          }}
          onListChange={(open) => {
            listOpen.current = open
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="dialog-hint">Name (optional)</span>
        <input
          className="field"
          aria-label="Name"
          value={name}
          maxLength={60}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="dialog-hint">Prompt (optional)</span>
        <textarea
          className="field resize-y"
          aria-label="Prompt"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
    </Frame>
  )
}
