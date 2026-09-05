import { useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useToolStore, Tool, OutputLine } from '../../store/useToolStore'

// ── Shared output display ─────────────────────────────────────────────────────

function OutputArea({ lines }: { lines: OutputLine[] }) {
  if (lines.length === 0) return (
    <div className="output-empty">Output will appear here…</div>
  )
  return (
    <div className="output-area">
      {lines.map((l, i) => (
        <div key={i} className={`output-line output-${l.kind}`}>
          {l.kind === 'done'
            ? '✓ Done'
            : l.kind === 'error'
            ? '✗ Something went wrong. Try again.'
            : l.line}
        </div>
      ))}
    </div>
  )
}

// ── File drop zone ────────────────────────────────────────────────────────────

function FileDropZone({ onFile, accept, label }: {
  onFile: (path: string) => void
  accept: string
  label: string
}) {
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const pick = async () => {
    const path = await invoke<string | null>('open_file_dialog')
    if (path) {
      setFileName(path.split(/[\\/]/).pop() ?? path)
      onFile(path)
    }
  }

  return (
    <div
      className={`drop-zone ${dragging ? 'dragging' : ''} ${fileName ? 'has-file' : ''}`}
      onClick={pick}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) {
          setFileName(file.name)
          // Tauri gives us the path via the file object in desktop mode
          onFile((file as any).path ?? file.name)
        }
      }}
    >
      {fileName ? (
        <>
          <i className="ti ti-file-check drop-icon" aria-hidden="true" />
          <span className="drop-filename">{fileName}</span>
          <span className="drop-hint">Click to change</span>
        </>
      ) : (
        <>
          <i className="ti ti-upload drop-icon" aria-hidden="true" />
          <span className="drop-label">{label}</span>
          <span className="drop-hint">{accept}</span>
        </>
      )}
    </div>
  )
}

// ── Panel: file in → text out  (Whisper) ─────────────────────────────────────

export function FileInTextOutPanel({ tool }: { tool: Tool }) {
  const [inputFile, setInputFile] = useState<string | null>(null)
  const [language, setLanguage] = useState('auto')
  const [format, setFormat] = useState('txt')
  const [running, setRunning] = useState(false)
  const { runTool, outputs } = useToolStore()
  const lines = outputs[tool.id] ?? []
  const done = lines.some(l => l.kind === 'done')

  const handleRun = async () => {
    if (!inputFile) return
    setRunning(true)
    const args = ['--output_format', format]
    if (language !== 'auto') args.push('--language', language)
    await runTool(tool.id, args, inputFile)
    setRunning(false)
  }

  const copyText = () => {
    const text = lines.filter(l => l.kind === 'stdout').map(l => l.line).join('\n')
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="panel-body">
      <section className="panel-section">
        <p className="section-label">Drop your audio or video file</p>
        <FileDropZone
          onFile={setInputFile}
          accept="MP3 · MP4 · WAV · M4A · FLAC · max 2 GB"
          label="Drop file here, or click to browse"
        />
      </section>

      <section className="panel-section">
        <p className="section-label">Options</p>
        <div className="options-row">
          <div className="option-field">
            <label className="option-label">Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="auto">Auto detect</option>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="es">Spanish</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
            </select>
          </div>
          <div className="option-field">
            <label className="option-label">Output format</label>
            <select value={format} onChange={e => setFormat(e.target.value)}>
              <option value="txt">Plain text (.txt)</option>
              <option value="srt">Subtitles (.srt)</option>
              <option value="json">JSON</option>
              <option value="vtt">WebVTT (.vtt)</option>
            </select>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-label-row">
          <p className="section-label">Transcription</p>
          {done && (
            <button className="ghost-btn" onClick={copyText}>
              <i className="ti ti-copy" aria-hidden="true" /> Copy
            </button>
          )}
        </div>
        <OutputArea lines={lines} />
      </section>

      <div className="panel-footer">
        <div className="info-chips">
          <span className="chip"><i className="ti ti-cpu" aria-hidden="true" /> CPU mode</span>
          <span className="chip"><i className="ti ti-wifi-off" aria-hidden="true" /> Offline</span>
          <span className="chip">{tool.version}</span>
        </div>
        <button
          className="run-btn"
          onClick={handleRun}
          disabled={!inputFile || running}
        >
          {running
            ? <><i className="ti ti-loader-2 spin" aria-hidden="true" /> Transcribing…</>
            : <><i className="ti ti-player-play" aria-hidden="true" /> Transcribe</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Panel: URL in → file out  (yt-dlp) ───────────────────────────────────────

export function UrlInFileOutPanel({ tool }: { tool: Tool }) {
  const [url, setUrl] = useState('')
  const [quality, setQuality] = useState('best')
  const [audioOnly, setAudioOnly] = useState(false)
  const [running, setRunning] = useState(false)
  const { runTool, outputs } = useToolStore()
  const lines = outputs[tool.id] ?? []
  const urlError = url && !url.startsWith('http') ? 'Paste a full URL starting with https://' : ''

  const handleRun = async () => {
    if (!url || urlError) return
    setRunning(true)
    const args = [url, '-f', audioOnly ? 'bestaudio' : quality]
    if (audioOnly) args.push('--extract-audio', '--audio-format', 'mp3')
    await runTool(tool.id, args)
    setRunning(false)
  }

  return (
    <div className="panel-body">
      <section className="panel-section">
        <p className="section-label">Video or audio URL</p>
        <div className="url-input-wrap">
          <i className="ti ti-link url-icon" aria-hidden="true" />
          <input
            className={`url-input ${urlError ? 'input-error' : ''}`}
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            aria-label="Video URL"
          />
        </div>
        {urlError && <p className="field-error">{urlError}</p>}
        <p className="field-hint">Works with YouTube, Twitter, Instagram, Vimeo and 1,000+ sites</p>
      </section>

      <section className="panel-section">
        <p className="section-label">Options</p>
        <div className="options-row">
          <div className="option-field">
            <label className="option-label">Quality</label>
            <select value={quality} onChange={e => setQuality(e.target.value)} disabled={audioOnly}>
              <option value="best">Best available</option>
              <option value="bestvideo[height<=1080]+bestaudio">1080p</option>
              <option value="bestvideo[height<=720]+bestaudio">720p</option>
              <option value="bestvideo[height<=480]+bestaudio">480p</option>
            </select>
          </div>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={e => setAudioOnly(e.target.checked)}
            />
            <span className="toggle-track" />
            <span className="toggle-label">Audio only (MP3)</span>
          </label>
        </div>
      </section>

      <section className="panel-section">
        <p className="section-label">Progress</p>
        <OutputArea lines={lines} />
      </section>

      <div className="panel-footer">
        <div className="info-chips">
          <span className="chip"><i className="ti ti-wifi" aria-hidden="true" /> Needs internet</span>
          <span className="chip">{tool.version}</span>
        </div>
        <button
          className="run-btn"
          onClick={handleRun}
          disabled={!url || !!urlError || running}
        >
          {running
            ? <><i className="ti ti-loader-2 spin" aria-hidden="true" /> Downloading…</>
            : <><i className="ti ti-download" aria-hidden="true" /> Download</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Panel: file in → multiple files out  (Demucs) ────────────────────────────

export function FileInFilesOutPanel({ tool }: { tool: Tool }) {
  const [inputFile, setInputFile] = useState<string | null>(null)
  const [model, setModel] = useState('htdemucs')
  const [stems, setStems] = useState('4')
  const [running, setRunning] = useState(false)
  const { runTool, outputs } = useToolStore()
  const lines = outputs[tool.id] ?? []
  const done = lines.some(l => l.kind === 'done')

  const handleRun = async () => {
    if (!inputFile) return
    setRunning(true)
    await runTool(tool.id, ['-n', model, '--two-stems', stems === '2' ? 'vocals' : ''], inputFile)
    setRunning(false)
  }

  const STEMS = ['Vocals', 'Drums', 'Bass', 'Other']

  return (
    <div className="panel-body">
      <section className="panel-section">
        <p className="section-label">Drop a song</p>
        <FileDropZone
          onFile={setInputFile}
          accept="MP3 · WAV · FLAC · max 500 MB"
          label="Drop your audio file here, or click to browse"
        />
      </section>

      <section className="panel-section">
        <p className="section-label">Options</p>
        <div className="options-row">
          <div className="option-field">
            <label className="option-label">Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}>
              <option value="htdemucs">HTDemucs (recommended)</option>
              <option value="htdemucs_ft">HTDemucs fine-tuned (slower)</option>
              <option value="mdx_extra">MDX Extra</option>
            </select>
          </div>
          <div className="option-field">
            <label className="option-label">Output stems</label>
            <select value={stems} onChange={e => setStems(e.target.value)}>
              <option value="4">4 stems — vocals, drums, bass, other</option>
              <option value="2">2 stems — vocals + instrumental</option>
            </select>
          </div>
        </div>
      </section>

      {done && (
        <section className="panel-section">
          <p className="section-label">Output files</p>
          <div className="stems-grid">
            {(stems === '4' ? STEMS : ['Vocals', 'Instrumental']).map(s => (
              <div key={s} className="stem-card">
                <i className="ti ti-file-music stem-icon" aria-hidden="true" />
                <span className="stem-name">{s}.wav</span>
                <button className="ghost-btn">
                  <i className="ti ti-folder-open" aria-hidden="true" /> Show
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!done && (
        <section className="panel-section">
          <p className="section-label">Progress</p>
          <OutputArea lines={lines} />
        </section>
      )}

      <div className="panel-footer">
        <div className="info-chips">
          <span className="chip"><i className="ti ti-cpu" aria-hidden="true" /> CPU mode</span>
          <span className="chip"><i className="ti ti-wifi-off" aria-hidden="true" /> Offline</span>
          <span className="chip">{tool.version}</span>
        </div>
        <button
          className="run-btn"
          onClick={handleRun}
          disabled={!inputFile || running}
        >
          {running
            ? <><i className="ti ti-loader-2 spin" aria-hidden="true" /> Separating…</>
            : <><i className="ti ti-scissors" aria-hidden="true" /> Separate stems</>
          }
        </button>
      </div>
    </div>
  )
}
