import { useEffect } from 'react'
import { Board } from './components/Board'
import { followEvents } from './sse'
import { useBoard } from './store'

export default function App() {
  useEffect(() => {
    const { apply, setConnection } = useBoard.getState()
    return followEvents({ onEvent: apply, onConnection: setConnection })
  }, [])
  return <Board />
}
