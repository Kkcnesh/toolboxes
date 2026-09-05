import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  BuildErrorEventPayload,
  BuildInstalledEventPayload,
  BuildProgressEventPayload,
  BuildStatus,
  BuildStep,
  INSTALL_STEPS,
  OutputLine,
  PipelineSource,
  StemFile,
  Tool,
  ToolOutputEventPayload,
  ToolRunState,
  emptyRunState,
} from "../types";

interface RawTool {
  id: string;
  name: string;
  description: string;
  category: string;
  github_url: string;
  version: string;
  icon_color: string;
  panel_type: string;
  input_types: string[];
  output_types: string[];
  exe_path: string | null;
  installed: boolean;
  runs_offline: boolean;
  install_count: number;
}

function normalizeTool(raw: RawTool): Tool {
  return {
    ...raw,
    panel_type: raw.panel_type as Tool["panel_type"],
    input_types: raw.input_types as Tool["input_types"],
    output_types: raw.output_types as Tool["output_types"],
  };
}

let nextLineId = 0;
function makeLineId() {
  nextLineId += 1;
  return `line-${Date.now()}-${nextLineId}`;
}

interface ToolStore {
  tools: Tool[];
  openTabs: string[];
  activeTabId: string | null;
  marketplaceOpen: boolean;
  buildStatuses: Record<string, BuildStatus>;
  outputs: Record<string, OutputLine[]>;
  pipelines: Record<string, PipelineSource>;
  toolRuns: Record<string, ToolRunState>;
  theme: "light" | "dark";

  loadTools: () => Promise<void>;
  openTab: (toolId: string) => void;
  closeTab: (toolId: string) => void;
  setActiveTab: (toolId: string) => void;
  reorderTabs: (from: number, to: number) => void;
  openMarketplace: () => void;
  closeMarketplace: () => void;
  installTool: (tool: Tool) => Promise<void>;
  runTool: (toolId: string, args: string[], inputFile?: string) => Promise<void>;
  pipeOutput: (fromToolId: string, toToolId: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  listenToEvents: () => () => void;

  setToolOption: (toolId: string, key: string, value: string | boolean) => void;
  setToolInputFile: (toolId: string, filePath: string | null, fileName: string | null) => void;
  setToolInputUrl: (toolId: string, url: string) => void;
  dismissError: (toolId: string) => void;
  clearPipeline: (toolId: string) => void;
}

function getRun(state: ToolStore, toolId: string): ToolRunState {
  return state.toolRuns[toolId] ?? emptyRunState;
}

export const useToolStore = create<ToolStore>((set, get) => ({
  tools: [],
  openTabs: [],
  activeTabId: null,
  marketplaceOpen: false,
  buildStatuses: {},
  outputs: {},
  pipelines: {},
  toolRuns: {},
  theme: (typeof document !== "undefined" &&
    (document.documentElement.getAttribute("data-theme") as "light" | "dark")) || "light",

  loadTools: async () => {
    const raw = await invoke<RawTool[]>("list_tools");
    set({ tools: raw.map(normalizeTool) });
  },

  openTab: (toolId) => {
    set((state) => {
      if (state.openTabs.includes(toolId)) {
        return { activeTabId: toolId, marketplaceOpen: false };
      }
      return {
        openTabs: [...state.openTabs, toolId],
        activeTabId: toolId,
        marketplaceOpen: false,
      };
    });
  },

  closeTab: (toolId) => {
    set((state) => {
      const idx = state.openTabs.indexOf(toolId);
      if (idx === -1) return {};
      const nextTabs = state.openTabs.filter((id) => id !== toolId);
      let nextActive = state.activeTabId;
      if (state.activeTabId === toolId) {
        if (nextTabs.length === 0) {
          nextActive = null;
        } else {
          const fallbackIdx = Math.min(idx, nextTabs.length - 1);
          nextActive = nextTabs[fallbackIdx];
        }
      }
      return { openTabs: nextTabs, activeTabId: nextActive };
    });
  },

  setActiveTab: (toolId) => {
    set({ activeTabId: toolId, marketplaceOpen: false });
  },

  reorderTabs: (from, to) => {
    set((state) => {
      const tabs = [...state.openTabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { openTabs: tabs };
    });
  },

  openMarketplace: () => set({ marketplaceOpen: true }),
  closeMarketplace: () => set({ marketplaceOpen: false }),

  installTool: async (tool) => {
    set((state) => ({
      buildStatuses: {
        ...state.buildStatuses,
        [tool.id]: {
          status: "installing",
          steps: INSTALL_STEPS.map(
            (label, i): BuildStep => ({
              label,
              status: i === 0 ? "active" : "pending",
            }),
          ),
        },
      },
    }));
    try {
      await invoke("request_build", { toolId: tool.id, githubUrl: tool.github_url });
    } catch (err) {
      set((state) => ({
        buildStatuses: {
          ...state.buildStatuses,
          [tool.id]: {
            status: "error",
            steps: state.buildStatuses[tool.id]?.steps ?? [],
            error: String(err),
          },
        },
      }));
    }
  },

  runTool: async (toolId, args, inputFile) => {
    set((state) => ({
      toolRuns: {
        ...state.toolRuns,
        [toolId]: {
          ...getRun(state, toolId),
          status: "running",
          outputText: "",
          progressLines: [],
          outputFiles: [],
          resultFile: null,
          errorMessage: null,
          startedAt: Date.now(),
          doneAt: null,
          justCompleted: false,
        },
      },
      outputs: { ...state.outputs, [toolId]: [] },
    }));
    try {
      await invoke("run_tool", { toolId, args, inputFile: inputFile ?? null });
    } catch (err) {
      set((state) => ({
        toolRuns: {
          ...state.toolRuns,
          [toolId]: {
            ...getRun(state, toolId),
            status: "error",
            errorMessage: String(err),
          },
        },
      }));
    }
  },

  pipeOutput: (fromToolId, toToolId) => {
    const state = get();
    const fromTool = state.tools.find((t) => t.id === fromToolId);
    const fromRun = getRun(state, fromToolId);
    if (!fromTool) return;

    let outputFile = "";
    if (fromRun.resultFile) outputFile = fromRun.resultFile;
    else if (fromRun.outputFiles.length > 0) outputFile = fromRun.outputFiles[0].path;

    set((s) => ({
      pipelines: {
        ...s.pipelines,
        [toToolId]: {
          fromToolId,
          fromToolName: fromTool.name,
          outputFile,
        },
      },
      toolRuns: {
        ...s.toolRuns,
        [toToolId]: {
          ...getRun(s, toToolId),
          inputFile: outputFile || null,
          inputFileName: outputFile ? outputFile.split("/").pop() ?? outputFile : null,
        },
      },
    }));

    if (!state.openTabs.includes(toToolId)) {
      get().openTab(toToolId);
    } else {
      get().setActiveTab(toToolId);
    }
  },

  setTheme: (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("toolbox-theme", theme);
    set({ theme });
  },

  setToolOption: (toolId, key, value) => {
    set((state) => ({
      toolRuns: {
        ...state.toolRuns,
        [toolId]: {
          ...getRun(state, toolId),
          options: { ...getRun(state, toolId).options, [key]: value },
        },
      },
    }));
  },

  setToolInputFile: (toolId, filePath, fileName) => {
    set((state) => ({
      toolRuns: {
        ...state.toolRuns,
        [toolId]: {
          ...getRun(state, toolId),
          inputFile: filePath,
          inputFileName: fileName,
        },
      },
      pipelines: Object.fromEntries(
        Object.entries(state.pipelines).filter(([id]) => id !== toolId),
      ),
    }));
  },

  setToolInputUrl: (toolId, url) => {
    set((state) => ({
      toolRuns: {
        ...state.toolRuns,
        [toolId]: { ...getRun(state, toolId), inputUrl: url },
      },
    }));
  },

  dismissError: (toolId) => {
    set((state) => ({
      toolRuns: {
        ...state.toolRuns,
        [toolId]: { ...getRun(state, toolId), status: "idle", errorMessage: null },
      },
    }));
  },

  clearPipeline: (toolId) => {
    set((state) => {
      const next = { ...state.pipelines };
      delete next[toolId];
      return { pipelines: next };
    });
  },

  listenToEvents: () => {
    let unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    (async () => {
      const outputUnlisten = await listen<ToolOutputEventPayload>("tool:output", (event) => {
        const { tool_id, line, kind } = event.payload;
        const state = get();
        const tool = state.tools.find((t) => t.id === tool_id);

        const newLine: OutputLine = { id: makeLineId(), text: line, kind, timestamp: Date.now() };
        set((s) => ({
          outputs: { ...s.outputs, [tool_id]: [...(s.outputs[tool_id] ?? []), newLine] },
        }));

        if (kind === "stdout" || kind === "stderr") {
          set((s) => {
            const run = getRun(s, tool_id);
            if (tool?.panel_type === "file_in_text_out") {
              return {
                toolRuns: {
                  ...s.toolRuns,
                  [tool_id]: { ...run, outputText: run.outputText ? `${run.outputText}\n${line}` : line },
                },
              };
            }
            return {
              toolRuns: {
                ...s.toolRuns,
                [tool_id]: { ...run, progressLines: [...run.progressLines, line] },
              },
            };
          });
        } else if (kind === "done") {
          set((s) => {
            const run = getRun(s, tool_id);
            let outputFiles: StemFile[] = run.outputFiles;
            let resultFile: string | null = run.resultFile;

            if (tool?.panel_type === "file_in_files_out") {
              try {
                const parsed = JSON.parse(line) as StemFile[];
                outputFiles = parsed;
              } catch {
                outputFiles = [];
              }
            } else if (tool?.panel_type === "url_in_file_out") {
              resultFile = line || null;
            }

            return {
              toolRuns: {
                ...s.toolRuns,
                [tool_id]: {
                  ...run,
                  status: "done",
                  doneAt: Date.now(),
                  justCompleted: true,
                  outputFiles,
                  resultFile,
                },
              },
            };
          });
          setTimeout(() => {
            set((s) => {
              const run = s.toolRuns[tool_id];
              if (!run) return {};
              return { toolRuns: { ...s.toolRuns, [tool_id]: { ...run, justCompleted: false } } };
            });
          }, 3000);
        } else if (kind === "error") {
          set((s) => ({
            toolRuns: {
              ...s.toolRuns,
              [tool_id]: { ...getRun(s, tool_id), status: "error", errorMessage: line },
            },
          }));
        }
      });

      const progressUnlisten = await listen<BuildProgressEventPayload>("build:progress", (event) => {
        const { tool_id, step } = event.payload;
        set((state) => {
          const current = state.buildStatuses[tool_id];
          const stepIndex = INSTALL_STEPS.indexOf(step);
          const steps = INSTALL_STEPS.map((label, i) => ({
            label,
            status: i < stepIndex ? "done" : i === stepIndex ? "active" : "pending",
          })) as BuildStatus["steps"];
          return {
            buildStatuses: {
              ...state.buildStatuses,
              [tool_id]: { status: "installing", steps, error: current?.error },
            },
          };
        });
      });

      const installedUnlisten = await listen<BuildInstalledEventPayload>("build:installed", (event) => {
        const { tool_id, exe_path } = event.payload;
        set((state) => ({
          buildStatuses: {
            ...state.buildStatuses,
            [tool_id]: {
              status: "installed",
              steps: INSTALL_STEPS.map((label): BuildStep => ({ label, status: "done" })),
            },
          },
          tools: state.tools.map((t) =>
            t.id === tool_id ? { ...t, installed: true, exe_path } : t,
          ),
        }));
      });

      const errorUnlisten = await listen<BuildErrorEventPayload>("build:error", (event) => {
        const { tool_id, error } = event.payload;
        set((state) => ({
          buildStatuses: {
            ...state.buildStatuses,
            [tool_id]: {
              status: "error",
              steps: state.buildStatuses[tool_id]?.steps ?? [],
              error,
            },
          },
        }));
      });

      if (cancelled) {
        outputUnlisten();
        progressUnlisten();
        installedUnlisten();
        errorUnlisten();
      } else {
        unlisteners = [outputUnlisten, progressUnlisten, installedUnlisten, errorUnlisten];
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  },
}));
