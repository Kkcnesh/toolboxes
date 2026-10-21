import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  BuildStatus,
  BuildStep,
  DemoCollection,
  DemoTool,
  DiscoveredTool,
  Runbook,
  KeyStatus,
  INSTALL_STEP_ORDER,
  INSTALL_STEPS,
  OutputLine,
  PipelineSource,
  QuickRunEvent,
  QuickRunStatus,
  QuickRunSummary,
  SavedRepo,
  RuntimeProgressEventPayload,
  StemFile,
  Tool,
  ToolOutputEventPayload,
  ToolProgressEventPayload,
  ToolRunState,
  emptyRunState,
} from "../types";
import { DEMO_COLLECTIONS, DEFAULT_COLLECTION, parseCollectionLink } from "../demo/collections";
import { INCOMING, LISTINGS, REDEEM_CODES, IncomingShare, Listing, OutgoingShare } from "../demo/market";

function loadCollections(): DemoCollection[] {
  try {
    const raw = localStorage.getItem("gitrun.collections");
    if (!raw) return [DEFAULT_COLLECTION];
    const imported = JSON.parse(raw) as DemoCollection[];
    return [DEFAULT_COLLECTION, ...(Array.isArray(imported) ? imported : [])];
  } catch {
    return [DEFAULT_COLLECTION];
  }
}

function saveCollections(collections: DemoCollection[]): void {
  try {
    const imported = collections.filter((collection) => collection.id !== "featured");
    localStorage.setItem("gitrun.collections", JSON.stringify(imported));
  } catch {
    // storage unavailable; the in-memory list still works
  }
}

interface MarketState {
  premium: boolean;
  owned: string[];
  myListings: Listing[];
  incoming: IncomingShare[];
  outgoing: OutgoingShare[];
}

function loadMarket(): MarketState {
  const fallback: MarketState = {
    premium: false,
    owned: [],
    myListings: [],
    incoming: INCOMING,
    outgoing: [],
  };

  try {
    const raw = localStorage.getItem("gitrun.market");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MarketState>;
    return {
      premium: parsed.premium ?? false,
      owned: parsed.owned ?? [],
      myListings: parsed.myListings ?? [],
      incoming: parsed.incoming ?? INCOMING,
      outgoing: parsed.outgoing ?? [],
    };
  } catch {
    return fallback;
  }
}

function saveMarket(state: MarketState): void {
  try {
    localStorage.setItem("gitrun.market", JSON.stringify(state));
  } catch {
    // storage unavailable; the session still works
  }
}

function persistMarket(state: {
  qrPremium: boolean;
  qrOwned: string[];
  qrMyListings: Listing[];
  qrIncoming: IncomingShare[];
  qrOutgoing: OutgoingShare[];
}): void {
  saveMarket({
    premium: state.qrPremium,
    owned: state.qrOwned,
    myListings: state.qrMyListings,
    incoming: state.qrIncoming,
    outgoing: state.qrOutgoing,
  });
}

function sharedTool(listing: Listing): DemoTool {
  return {
    id: `shared-${listing.id}`,
    name: listing.name,
    description: listing.description,
    category: listing.category,
    color: listing.color,
    tag: "Shared",
  };
}

const INITIAL_MARKET = loadMarket();

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

  gitInstalled: boolean | null;
  runtimeReady: boolean | null;
  runtimeProgress: RuntimeProgressEventPayload | null;

  checkGit: () => Promise<boolean>;
  checkRuntime: () => Promise<boolean>;
  downloadRuntime: () => Promise<void>;
  listenToRuntimeEvents: () => () => void;

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

  // --- QuickRun slice (Phase 2) ---
  qrSummary: QuickRunSummary | null;
  qrEvents: QuickRunEvent[];
  qrPreparing: boolean;
  qrError: string | null;
  qrInputValues: Record<string, string>;
  qrStatus: QuickRunStatus | null;
  qrBrief: { summary: string; sources: string[] } | null;
  qrSaved: SavedRepo[];
  qrCurrentRepo: string | null;
  qrCurrentToken: string | null;
  quickrunOpen: boolean;
  qrSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  qrKeyStatus: KeyStatus | null;
  qrLoadKeys: () => Promise<void>;
  qrSaveKey: (provider: string, key: string) => Promise<void>;
  qrMarketOpen: boolean;
  openMarket: () => void;
  closeMarket: () => void;
  qrMarketTab: "browse" | "shared" | "mine";
  setMarketTab: (tab: "browse" | "shared" | "mine") => void;
  qrPremium: boolean;
  qrOwned: string[];
  qrMyListings: Listing[];
  qrIncoming: IncomingShare[];
  qrOutgoing: OutgoingShare[];
  qrBuyTool: (id: string) => void;
  qrActivatePremium: () => void;
  qrRedeemCode: (code: string) => boolean;
  qrShareTool: (id: string, to: string) => void;
  qrAcceptShare: (id: string) => void;
  qrDeclineShare: (id: string) => void;
  qrPublishListing: (listing: Listing) => void;
  qrToast: string | null;
  qrShowToast: (message: string) => void;
  openQuickRun: () => void;
  closeQuickRun: () => void;
  qrPrepare: (repo: string) => Promise<void>;
  qrAutorun: (repo: string, token?: string | null, rebuild?: boolean) => Promise<void>;
  qrLoadSaved: () => Promise<void>;
  qrRunSaved: (repo: string, token?: string | null) => Promise<void>;
  qrForgetSaved: (repo: string) => Promise<void>;
  qrOpenAppWindow: (url: string, name?: string) => Promise<void>;
  qrCloseAppWindow: (url: string) => Promise<void>;
  qrWindows: { url: string; name: string }[];
  qrCollections: DemoCollection[];
  qrDemoTool: { collectionId: string; tool: DemoTool } | null;
  qrImportCollection: (link: string) => boolean;
  qrOpenDemoTool: (collectionId: string, tool: DemoTool) => void;
  qrCloseDemoTool: () => void;
  qrRemoveCollection: (id: string) => void;
  qrDiscoverTools: (url: string) => Promise<DiscoveredTool[]>;
  qrAddDiscoveredCollection: (name: string, tools: DiscoveredTool[]) => void;
  qrRunbook: Runbook | null;
  qrLoadRunbook: (repo: string) => Promise<void>;
  qrSupplyInputs: () => Promise<void>;
  qrApprove: () => Promise<void>;
  qrCancel: () => Promise<void>;
  qrStop: () => Promise<void>;
  qrResync: () => Promise<void>;
  qrReset: () => void;
  qrPushEvent: (event: QuickRunEvent) => void;
  qrSetInputValue: (id: string, value: string) => void;
  qrListenEvents: () => () => void;
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

  gitInstalled: null,
  runtimeReady: null,
  runtimeProgress: null,

  checkGit: async () => {
    const installed = await invoke<boolean>("check_git_installed");
    set({ gitInstalled: installed });
    return installed;
  },

  checkRuntime: async () => {
    const ready = await invoke<boolean>("check_runtime");
    set({ runtimeReady: ready });
    return ready;
  },

  downloadRuntime: async () => {
    set({
      runtimeProgress: { step: "downloading", percent: 0, message: "Downloading Python…" },
    });
    await invoke("download_runtime");
  },

  listenToRuntimeEvents: () => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      const fn = await listen<RuntimeProgressEventPayload>("runtime:progress", (event) => {
        set({ runtimeProgress: event.payload });
        if (event.payload.step === "done") {
          set({ runtimeReady: true });
        }
      });
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  },

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
      await invoke("install_tool", { toolId: tool.id, githubUrl: tool.github_url });
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

      const progressUnlisten = await listen<ToolProgressEventPayload>("tool:progress", (event) => {
        const { tool_id, step, message } = event.payload;

        if (step === "ready") {
          set((state) => ({
            buildStatuses: {
              ...state.buildStatuses,
              [tool_id]: {
                status: "installed",
                steps: INSTALL_STEPS.map((label): BuildStep => ({ label, status: "done" })),
              },
            },
          }));
          get().loadTools();
          return;
        }

        if (step === "error") {
          set((state) => ({
            buildStatuses: {
              ...state.buildStatuses,
              [tool_id]: {
                status: "error",
                steps: state.buildStatuses[tool_id]?.steps ?? [],
                error: message,
              },
            },
          }));
          return;
        }

        set((state) => {
          const current = state.buildStatuses[tool_id];
          const stepIndex = INSTALL_STEP_ORDER.indexOf(step);
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

      if (cancelled) {
        outputUnlisten();
        progressUnlisten();
      } else {
        unlisteners = [outputUnlisten, progressUnlisten];
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  },

  // --- QuickRun slice (Phase 2/3) ---
  qrSummary: null,
  qrEvents: [],
  qrPreparing: false,
  qrError: null,
  qrInputValues: {},
  qrStatus: null,
  qrBrief: null,
  qrRunbook: null,
  qrSaved: [],
  qrCollections: loadCollections(),
  qrWindows: [],
  qrDemoTool: null,
  qrCurrentRepo: null,
  qrCurrentToken: null,
  quickrunOpen: false,
  qrSettingsOpen: false,
  qrKeyStatus: null,
  qrMarketOpen: false,
  qrMarketTab: "browse",
  qrPremium: INITIAL_MARKET.premium,
  qrOwned: INITIAL_MARKET.owned,
  qrMyListings: INITIAL_MARKET.myListings,
  qrIncoming: INITIAL_MARKET.incoming,
  qrOutgoing: INITIAL_MARKET.outgoing,
  qrToast: null,

  openQuickRun: () => set({ quickrunOpen: true, marketplaceOpen: false }),
  closeQuickRun: () => set({ quickrunOpen: false }),

  qrReset: () =>
    set({
      qrSummary: null,
      qrEvents: [],
      qrError: null,
      qrPreparing: false,
      qrInputValues: {},
      qrStatus: null,
      qrBrief: null,
      qrRunbook: null,
    }),

  qrPushEvent: (event) =>
    set((state) => {
      // Keep the summary in sync with the live stream, so progress, the ready
      // URL, task status and the terminal state update without a full resync.
      let next = state.qrSummary;
      if (next) {
        if (event.kind === "progress" && event.progress) {
          next = { ...next, progress: event.progress };
        } else if (event.kind === "info" && event.text.startsWith("open ")) {
          next = { ...next, url: event.text.slice("open ".length).trim() };
        } else if (event.kind === "finished") {
          next = { ...next, state: "succeeded" };
        } else if (event.kind === "failed") {
          next = { ...next, state: "failed" };
        } else if (event.kind === "cancelled") {
          next = { ...next, state: "cancelled" };
        } else if (event.task) {
          const status =
            event.kind === "taskStarted"
              ? "starting"
              : event.kind === "taskReady"
                ? "ready"
                : event.kind === "taskExited"
                  ? "exited"
                  : null;
          if (status && next.tasks) {
            next = {
              ...next,
              tasks: next.tasks.map((t) => (t.name === event.task ? { ...t, state: status } : t)),
            };
          }
        }
      }
      return { qrEvents: [...state.qrEvents, event], qrSummary: next };
    }),

  qrSetInputValue: (id, value) =>
    set((state) => ({ qrInputValues: { ...state.qrInputValues, [id]: value } })),

  qrPrepare: async (repo) => {
    set({ qrPreparing: true, qrError: null, qrSummary: null, qrEvents: [], qrInputValues: {} });
    try {
      const summary = await invoke<QuickRunSummary>("quickrun_prepare", { repo });
      set({ qrSummary: summary, qrPreparing: false });
    } catch (err) {
      set({ qrError: String(err), qrPreparing: false });
    }
  },

  qrAutorun: async (repo, token = null, rebuild = false) => {
    set({
      qrPreparing: true,
      qrError: null,
      qrSummary: null,
      qrEvents: [],
      qrInputValues: {},
      qrStatus: { state: "analyzing", message: "Reading the repository…" },
      qrBrief: null,
      qrRunbook: null,
      qrCurrentRepo: repo,
      qrCurrentToken: token,
    });
    try {
      // Returns immediately; progress arrives as quickrun:status / :summary / :event.
      await invoke("quickrun_autorun", { repo, token, rebuild });
    } catch (err) {
      set({
        qrError: String(err),
        qrPreparing: false,
        qrStatus: { state: "error", message: String(err) },
      });
    }
  },

  qrLoadSaved: async () => {
    try {
      const saved = await invoke<SavedRepo[]>("quickrun_list_saved");
      set({ qrSaved: saved });
    } catch {
      // an empty list is not an error
    }
  },

  qrRunSaved: async (repo, token = null) => {
    await get().qrAutorun(repo, token, false);
  },

  qrForgetSaved: async (repo) => {
    try {
      await invoke("quickrun_forget_saved", { repo });
    } catch {
      // ignore
    }
    await get().qrLoadSaved();
  },

  qrOpenAppWindow: async (url, name) => {
    try {
      await invoke("open_app_window", { url, name: name ?? null });
      set((state) =>
        state.qrWindows.some((window) => window.url === url)
          ? {}
          : { qrWindows: [...state.qrWindows, { url, name: name ?? url }] },
      );
    } catch {
      // the browser button still works if a window cannot be created
    }
  },

  qrCloseAppWindow: async (url) => {
    try {
      await invoke("close_app_window", { url });
    } catch {
      // closing an already-closed window is fine
    }
    set((state) => ({ qrWindows: state.qrWindows.filter((window) => window.url !== url) }));
  },

  qrImportCollection: (link) => {
    const id = parseCollectionLink(link);
    if (!id) return false;
    const collection = DEMO_COLLECTIONS[id];
    if (!collection) return false;

    set((state) =>
      state.qrCollections.some((existing) => existing.id === id)
        ? {}
        : { qrCollections: [...state.qrCollections, collection] },
    );
    saveCollections(get().qrCollections);
    return true;
  },

  qrOpenDemoTool: (collectionId, tool) =>
    set({ qrDemoTool: { collectionId, tool }, quickrunOpen: false, marketplaceOpen: false }),

  qrCloseDemoTool: () => set({ qrDemoTool: null }),

  qrRemoveCollection: (id) => {
    set((state) => ({
      qrCollections: state.qrCollections.filter((collection) => collection.id !== id),
      qrDemoTool: state.qrDemoTool?.collectionId === id ? null : state.qrDemoTool,
    }));
    saveCollections(get().qrCollections);
  },

  qrDiscoverTools: async (url) => invoke<DiscoveredTool[]>("quickrun_discover_tools", { url }),

  qrAddDiscoveredCollection: (name, tools) => {
    const collection: DemoCollection = {
      id: `discovered-${Date.now()}`,
      name: name || "Discovered tools",
      description: `${tools.length} tools found by TinyFish.`,
      tools: tools.map((tool, index) => ({
        id: `discovered-${index}-${tool.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: tool.name,
        description: tool.description || "",
        category: "Discovered",
        color: "#E6F1FB",
        tag: "Discovered",
      })),
    };
    set((state) => ({ qrCollections: [...state.qrCollections, collection] }));
    saveCollections(get().qrCollections);
  },

  qrLoadRunbook: async (repo) => {
    try {
      const runbook = await invoke<Runbook>("quickrun_runbook", { repo });
      set({ qrRunbook: runbook });
    } catch (err) {
      set({ qrError: String(err) });
    }
  },

  openSettings: () => set({ qrSettingsOpen: true }),
  closeSettings: () => set({ qrSettingsOpen: false }),

  qrLoadKeys: async () => {
    try {
      const status = await invoke<KeyStatus>("config_key_status");
      set({ qrKeyStatus: status });
    } catch {
      // ignore
    }
  },

  qrSaveKey: async (provider, key) => {
    try {
      await invoke("config_set_key", { provider, key });
    } catch (err) {
      set({ qrError: String(err) });
    }
  },

  openMarket: () => set({ qrMarketOpen: true, qrDemoTool: null, marketplaceOpen: false }),
  closeMarket: () => set({ qrMarketOpen: false }),
  setMarketTab: (tab) => set({ qrMarketTab: tab }),

  qrBuyTool: (id) => {
    if (get().qrOwned.includes(id)) return;
    set((state) => ({ qrOwned: [...state.qrOwned, id] }));
    persistMarket(get());
    get().qrShowToast("Purchased — added to your tools.");
  },

  qrActivatePremium: () => {
    set({ qrPremium: true });
    persistMarket(get());
    get().qrShowToast("Premium is active.");
  },

  qrRedeemCode: (code) => {
    if (!REDEEM_CODES.includes(code.trim().toUpperCase())) return false;
    set({ qrPremium: true });
    persistMarket(get());
    get().qrShowToast("Premium unlocked.");
    return true;
  },

  qrShareTool: (id, to) => {
    const username = to.replace(/^@/, "").trim();
    if (!username) return;
    set((state) => ({
      qrOutgoing: [...state.qrOutgoing, { id: `${id}-${Date.now()}`, listingId: id, to: username }],
    }));
    persistMarket(get());
    get().qrShowToast(`Sent to @${username}.`);
  },

  qrAcceptShare: (id) => {
    const share = get().qrIncoming.find((item) => item.id === id);
    if (!share) return;
    const listing = LISTINGS.find((item) => item.id === share.listingId);

    set((state) => ({
      qrIncoming: state.qrIncoming.map((item) =>
        item.id === id ? { ...item, status: "accepted" as const } : item,
      ),
      qrCollections: listing
        ? state.qrCollections.some((collection) => collection.id === "shared-with-me")
          ? state.qrCollections.map((collection) =>
              collection.id === "shared-with-me"
                ? { ...collection, tools: [...collection.tools, sharedTool(listing)] }
                : collection,
            )
          : [
              ...state.qrCollections,
              {
                id: "shared-with-me",
                name: "Shared with me",
                description: "Tools your teammates sent you.",
                tools: [sharedTool(listing)],
              },
            ]
        : state.qrCollections,
    }));

    saveCollections(get().qrCollections);
    persistMarket(get());
    get().qrShowToast("Added to your tools.");
  },

  qrDeclineShare: (id) => {
    set((state) => ({
      qrIncoming: state.qrIncoming.map((item) =>
        item.id === id ? { ...item, status: "declined" as const } : item,
      ),
    }));
    persistMarket(get());
  },

  qrPublishListing: (listing) => {
    set((state) => ({ qrMyListings: [...state.qrMyListings, listing] }));
    persistMarket(get());
    get().qrShowToast("Published to the marketplace.");
  },

  qrShowToast: (message) => {
    set({ qrToast: message });
    window.setTimeout(() => {
      if (get().qrToast === message) set({ qrToast: null });
    }, 2200);
  },

  qrSupplyInputs: async () => {
    const id = get().qrSummary?.id;
    if (!id) return;
    set({ qrError: null });
    try {
      const summary = await invoke<QuickRunSummary>("quickrun_supply_inputs", {
        id,
        inputs: get().qrInputValues,
      });
      set({ qrSummary: summary });
    } catch (err) {
      set({ qrError: String(err) });
    }
  },

  qrApprove: async () => {
    const id = get().qrSummary?.id;
    if (!id) return;
    set({ qrError: null });
    try {
      // The autorun stream is already open; confirm only starts execution.
      const summary = await invoke<QuickRunSummary>("quickrun_confirm", { id });
      set({ qrSummary: summary });
    } catch (err) {
      set({ qrError: String(err) });
    }
  },

  qrCancel: async () => {
    await get().qrStop();
  },

  qrStop: async () => {
    const id = get().qrSummary?.id;
    if (!id) return;
    set({ qrError: null });
    try {
      await invoke("quickrun_stop", { id });
    } catch (err) {
      set({ qrError: String(err) });
    }
    await get().qrResync();
  },

  qrResync: async () => {
    const id = get().qrSummary?.id;
    if (!id) return;
    try {
      const summary = await invoke<QuickRunSummary>("quickrun_state", { id });
      set({ qrSummary: summary });
    } catch (err) {
      // The daemon may have gone away; surface the error without crashing.
      set({ qrError: String(err) });
    }
  },

  qrListenEvents: () => {
    let unlistens: UnlistenFn[] = [];
    let cancelled = false;
    (async () => {
      const onEvent = await listen<QuickRunEvent>("quickrun:event", (event) => {
        get().qrPushEvent(event.payload);
      });
      const onSummary = await listen<QuickRunSummary>("quickrun:summary", (event) => {
        set({ qrSummary: event.payload, qrPreparing: false });
      });
      const onStatus = await listen<QuickRunStatus>("quickrun:status", (event) => {
        set({ qrStatus: event.payload, qrPreparing: false });
        if (event.payload.state === "done" || event.payload.state === "failed") {
          const url = get().qrSummary?.url;
          if (url) get().qrCloseAppWindow(url);
          get().qrLoadSaved();
        }
      });
      const onBrief = await listen<{ summary: string; sources: string[] }>("quickrun:brief", (event) => {
        set({ qrBrief: event.payload });
      });
      const onRunbook = await listen<Runbook>("quickrun:runbook", (event) => {
        set({ qrRunbook: event.payload });
      });
      if (cancelled) {
        onEvent();
        onSummary();
        onStatus();
        onBrief();
        onRunbook();
      } else {
        unlistens = [onEvent, onSummary, onStatus, onBrief, onRunbook];
      }
    })();
    return () => {
      cancelled = true;
      unlistens.forEach((fn) => fn());
    };
  },
}));
