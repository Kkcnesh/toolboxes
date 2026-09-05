import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface Tool {
  id: string
  name: string
  description: string
  category: string
  github_url: string
  version: string
  icon_color: string
  panel_type: 'file_in_text_out' | 'url_in_file_out' | 'file_in_files_out'
  exe_path: string | null
  installed: boolean
  runs_offline: boolean
}

export interface BuildStatus {
  job_id: string
  tool_id: string
  status: 'queued' | 'cloning' | 'building' | 'scanning' | 'downloading' | 'installed' | 'failed'
  step?: string
  error?: string
}

export interface OutputLine {
  line: string
  kind: 'stdout' | 'stderr' | 'done' | 'error'
}

interface ToolStore {
  tools: Tool[]
  activeToolId: string | null
  buildStatuses: Record<string, BuildStatus>
  outputs: Record<string, OutputLine[]>

  // Actions
  loadTools: () => Promise<void>
  setActiveTool: (id: string) => void
  installTool: (tool: Tool) => Promise<void>
  runTool: (toolId: string, args: string[], inputFile?: string) => Promise<void>
  clearOutput: (toolId: string) => void
  listenToEvents: () => () => void
}

export const useToolStore = create<ToolStore>((set, get) => ({
  tools: [],
  activeToolId: null,
  buildStatuses: {},
  outputs: {},

  loadTools: async () => {
    const tools = await invoke<Tool[]>('list_tools')
    set({ tools })
    // Auto-select first installed tool, or first tool if none installed
    const installed = tools.find(t => t.installed)
    const first = installed ?? tools[0]
    if (first && !get().activeToolId) {
      set({ activeToolId: first.id })
    }
  },

  setActiveTool: (id) => set({ activeToolId: id }),

  installTool: async (tool) => {
    set(s => ({
      buildStatuses: {
        ...s.buildStatuses,
        [tool.id]: { job_id: '', tool_id: tool.id, status: 'queued' }
      }
    }))
    await invoke('request_build', {
      toolId: tool.id,
      githubUrl: tool.github_url,
    })
  },

  runTool: async (toolId, args, inputFile) => {
    // Clear previous output
    set(s => ({ outputs: { ...s.outputs, [toolId]: [] } }))
    await invoke('run_tool', {
      request: { tool_id: toolId, args, input_file: inputFile ?? null }
    })
  },

  clearOutput: (toolId) => {
    set(s => ({ outputs: { ...s.outputs, [toolId]: [] } }))
  },

  listenToEvents: () => {
    const unlisten: Array<() => void> = []

    // Build progress
    listen<{ job_id: string; tool_id: string; status: string; step?: string }>(
      'build:progress',
      ({ payload }) => {
        set(s => ({
          buildStatuses: {
            ...s.buildStatuses,
            [payload.tool_id]: {
              job_id: payload.job_id,
              tool_id: payload.tool_id,
              status: payload.status as BuildStatus['status'],
              step: payload.step,
            }
          }
        }))
      }
    ).then(u => unlisten.push(u))

    // Build installed
    listen<{ tool_id: string; exe_path: string }>(
      'build:installed',
      ({ payload }) => {
        set(s => ({
          tools: s.tools.map(t =>
            t.id === payload.tool_id
              ? { ...t, installed: true, exe_path: payload.exe_path }
              : t
          ),
          buildStatuses: {
            ...s.buildStatuses,
            [payload.tool_id]: {
              ...s.buildStatuses[payload.tool_id],
              status: 'installed'
            }
          }
        }))
      }
    ).then(u => unlisten.push(u))

    // Build error
    listen<{ tool_id?: string; error: string }>(
      'build:error',
      ({ payload }) => {
        if (!payload.tool_id) return
        set(s => ({
          buildStatuses: {
            ...s.buildStatuses,
            [payload.tool_id!]: {
              ...s.buildStatuses[payload.tool_id!],
              status: 'failed',
              error: payload.error
            }
          }
        }))
      }
    ).then(u => unlisten.push(u))

    // Tool stdout/stderr
    listen<{ tool_id: string; line: string; kind: string }>(
      'tool:output',
      ({ payload }) => {
        set(s => ({
          outputs: {
            ...s.outputs,
            [payload.tool_id]: [
              ...(s.outputs[payload.tool_id] ?? []),
              { line: payload.line, kind: payload.kind as OutputLine['kind'] }
            ]
          }
        }))
      }
    ).then(u => unlisten.push(u))

    return () => unlisten.forEach(u => u())
  },
}))
