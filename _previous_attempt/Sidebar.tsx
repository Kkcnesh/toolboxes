import { useState } from 'react'
import { useToolStore, Tool } from '../../store/useToolStore'

const CATEGORY_ICONS: Record<string, string> = {
  Audio: 'ti-music',
  Video: 'ti-video',
  Image: 'ti-photo',
  Text: 'ti-file-text',
  Code: 'ti-code',
  Data: 'ti-chart-bar',
}

function ToolRow({ tool, active, onClick }: {
  tool: Tool
  active: boolean
  onClick: () => void
}) {
  const buildStatus = useToolStore(s => s.buildStatuses[tool.id])

  const statusBadge = () => {
    if (!tool.installed && !buildStatus) return null
    if (buildStatus?.status === 'failed') return (
      <span className="badge badge-danger">failed</span>
    )
    if (buildStatus && buildStatus.status !== 'installed') return (
      <span className="badge badge-warning">building</span>
    )
    return null
  }

  return (
    <button
      onClick={onClick}
      className={`tool-row ${active ? 'active' : ''}`}
    >
      <div
        className="tool-icon"
        style={{ background: tool.icon_color }}
      >
        <i
          className={`ti ${CATEGORY_ICONS[tool.category] ?? 'ti-tool'}`}
          aria-hidden="true"
        />
      </div>
      <div className="tool-meta">
        <span className="tool-name">{tool.name}</span>
        <span className="tool-cat">{tool.category}</span>
      </div>
      {statusBadge()}
      {tool.installed && !buildStatus && (
        <span className="installed-dot" aria-label="installed" />
      )}
    </button>
  )
}

export function Sidebar() {
  const [query, setQuery] = useState('')
  const { tools, activeToolId, setActiveTool } = useToolStore()

  const installed = tools.filter(t => t.installed)
  const marketplace = tools.filter(t => !t.installed)

  const filtered = (list: Tool[]) =>
    list.filter(t =>
      t.name.toLowerCase().includes(query.toLowerCase()) ||
      t.category.toLowerCase().includes(query.toLowerCase())
    )

  return (
    <aside className="sidebar">
      <div className="sidebar-search-wrap">
        <i className="ti ti-search search-icon" aria-hidden="true" />
        <input
          className="sidebar-search"
          placeholder="Search tools…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search tools"
        />
      </div>

      {filtered(installed).length > 0 && (
        <>
          <p className="sidebar-section">Your tools</p>
          {filtered(installed).map(t => (
            <ToolRow
              key={t.id}
              tool={t}
              active={t.id === activeToolId}
              onClick={() => setActiveTool(t.id)}
            />
          ))}
        </>
      )}

      {filtered(marketplace).length > 0 && (
        <>
          <p className="sidebar-section">Marketplace</p>
          {filtered(marketplace).map(t => (
            <ToolRow
              key={t.id}
              tool={t}
              active={t.id === activeToolId}
              onClick={() => setActiveTool(t.id)}
            />
          ))}
        </>
      )}

      <div className="sidebar-footer">
        <button
          className="add-btn"
          onClick={() => {/* open add-from-github modal */}}
        >
          <i className="ti ti-plus" aria-hidden="true" />
          Add from GitHub
        </button>
      </div>
    </aside>
  )
}
