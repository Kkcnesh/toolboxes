import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ToolPanel } from './components/ToolPanel/ToolPanel'
import { useToolStore } from './store/useToolStore'
import './App.css'

export default function App() {
  const { loadTools, listenToEvents } = useToolStore()

  useEffect(() => {
    loadTools()
    const unlisten = listenToEvents()
    return unlisten
  }, [])

  return (
    <div className="app">
      <Sidebar />
      <ToolPanel />
    </div>
  )
}
