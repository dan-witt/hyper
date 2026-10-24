import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { completeDirectory } from '../api/client'

const DEBOUNCE_MS = 120

function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0]
  for (const v of values.slice(1)) {
    let i = 0
    while (i < prefix.length && prefix[i] === v[i]) i++
    prefix = prefix.slice(0, i)
  }
  return prefix
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Reports whether the suggestion list is showing, so Escape can close it first. */
  onListChange?: (open: boolean) => void
}

/**
 * A directory input with completions from the service. Typing lists the directories that
 * complete the last component; arrows pick one, Tab or Enter takes it (Tab with nothing picked
 * takes the common prefix), Escape closes the list.
 */
export function DirectoryField({ value, onChange, onListChange }: Props) {
  const listId = useId()
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => onListChange?.(open && suggestions.length > 0), [open, suggestions, onListChange])

  useEffect(() => {
    if (query === null) return
    let current = true
    const timer = setTimeout(async () => {
      const dirs = await completeDirectory(query)
      if (!current) return
      setSuggestions(dirs)
      setActive(-1)
      setOpen(true)
    }, DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const change = (next: string) => {
    onChange(next)
    setQuery(next)
  }

  const showing = open && suggestions.length > 0

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!showing) {
        setQuery(value)
        return
      }
      const last = suggestions.length - 1
      setActive((i) => (e.key === 'ArrowDown' ? (i >= last ? 0 : i + 1) : i <= 0 ? last : i - 1))
    } else if ((e.key === 'Tab' || e.key === 'Enter') && !e.ctrlKey && !e.metaKey && showing) {
      const pick = active >= 0 ? suggestions[active] : e.key === 'Tab' ? commonPrefix(suggestions) : ''
      if (pick && pick !== value) {
        e.preventDefault()
        change(pick)
      } else if (e.key === 'Tab') {
        setOpen(false)
      }
    } else if (e.key === 'Escape' && showing) {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <input
        className="field"
        aria-label="Directory"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        autoFocus
      />
      {showing && (
        <ul id={listId} ref={listRef} role="listbox" className="suggestions">
          {suggestions.map((dir, i) => (
            <li
              key={dir}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="suggestion"
              onMouseDown={(e) => {
                e.preventDefault() // keep focus in the input
                change(dir)
              }}
            >
              {dir}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
