import { useToolStore } from '../../store/useToolStore'
import {
  FileInTextOutPanel,
  UrlInFileOutPanel,
  FileInFilesOutPanel,
} from '../panels'

const CATEGORY_ICONS: Record<string, string> = {
  Audio: 'ti-music',
  Video: 'ti-video',
  Image: 'ti-photo',
  Text: 'ti-file-text',
  Code: 'ti-code',
  Data: 'ti-chart-bar',
}

function InstallPrompt({ toolId }: { toolId: string }) {
  const { tools, installTool, buildStatuses } = useToolStore()
  const tool = tools.find(t => t.id === toolId)
  const status = buildStatuses[toolId]

  if (!tool) return null

  const STEP_LABELS: Record<string, string> = {
    queued:      'Waiting in queue…',
    cloning:     'Copying the code…',
    building:    'Installing the parts…',
    scanning:    'Running a safety scan…',
    downloading: 'Downloading to your device…',
    installed:   'Ready',
    failed:      'Something went wrong',
  }

  if (status && status.status !== 'installed' && status.status !== 'failed') {
    return (
      <div className="install-prompt">
        <div className="build-steps">
          {['cloning', 'building', 'scanning', 'downloading'].map((step, i) => {
            const steps = ['cloning', 'building', 'scanning', 'downloading']
            const currentIdx = steps.indexOf(status.status)
            const stepIdx = i
            const done = stepIdx < currentIdx
            const active = stepIdx === currentIdx

            return (
              <div key={step} className={`build-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
                <div className="step-dot">
                  {done && <i className="ti ti-check" aria-hidden="true" />}
                  {active && <i className="ti ti-loader-2 spin" aria-hidden="true" />}
                </div>
                <span>{STEP_LABELS[step]}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (status?.status === 'failed') {
    return (
      <div className="install-prompt">
        <p className="install-error">
          We couldn't package this tool automatically.
          We've logged it and will add support soon.
        </p>
        <button className="run-btn" onClick={() => installTool(tool)}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="install-prompt">
      <div className="install-icon" style={{ background: tool.icon_color }}>
        <i className={`ti ${CATEGORY_ICONS[tool.category] ?? 'ti-tool'}`} aria-hidden="true" />
      </div>
      <h2 className="install-title">{tool.name}</h2>
      <p className="install-desc">{tool.description}</p>
      <div className="install-meta">
        <span className="chip">Free · open source</span>
        <span className="chip">
          <i className="ti ti-wifi-off" aria-hidden="true" /> Runs offline
        </span>
      </div>
      <button className="run-btn install-btn" onClick={() => installTool(tool)}>
        <i className="ti ti-download" aria-hidden="true" />
        Add to your tools
      </button>
      <p className="install-hint">
        Takes 2–4 minutes. Runs entirely on your device after that.
      </p>
    </div>
  )
}

export function ToolPanel() {
  const { tools, activeToolId } = useToolStore()
  const tool = tools.find(t => t.id === activeToolId)

  if (!tool) {
    return (
      <main className="tool-panel empty-state">
        <i className="ti ti-tool empty-icon" aria-hidden="true" />
        <p>Select a tool from the sidebar</p>
      </main>
    )
  }

  const renderPanel = () => {
    if (!tool.installed) return <InstallPrompt toolId={tool.id} />
    switch (tool.panel_type) {
      case 'file_in_text_out':  return <FileInTextOutPanel tool={tool} />
      case 'url_in_file_out':   return <UrlInFileOutPanel tool={tool} />
      case 'file_in_files_out': return <FileInFilesOutPanel tool={tool} />
      default:                   return <FileInTextOutPanel tool={tool} />
    }
  }

  return (
    <main className="tool-panel">
      <header className="panel-header">
        <div className="header-icon" style={{ background: tool.icon_color }}>
          <i
            className={`ti ${CATEGORY_ICONS[tool.category] ?? 'ti-tool'}`}
            aria-hidden="true"
          />
        </div>
        <div className="header-text">
          <div className="header-title">
            {tool.name}
            {tool.installed && (
              <span className="status-pill">
                <span className="status-dot" />
                ready
              </span>
            )}
          </div>
          <div className="header-sub">
            {tool.category} · {tool.description.split('.')[0]}
          </div>
        </div>
        <div className="header-actions">
          <a
            href={tool.github_url}
            target="_blank"
            rel="noreferrer"
            className="ghost-btn"
            aria-label="View on GitHub"
          >
            <i className="ti ti-brand-github" aria-hidden="true" />
          </a>
        </div>
      </header>

      {renderPanel()}
    </main>
  )
}
