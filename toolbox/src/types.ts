export type IOType = "audio" | "video" | "text" | "files" | "url";

export type PanelType = "file_in_text_out" | "url_in_file_out" | "file_in_files_out";

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  github_url: string;
  version: string;
  icon_color: string;
  panel_type: PanelType;
  input_types: IOType[];
  output_types: IOType[];
  exe_path: string | null;
  installed: boolean;
  runs_offline: boolean;
  install_count: number;
}

export type BuildStepStatus = "pending" | "active" | "done" | "error";

export interface BuildStep {
  label: string;
  status: BuildStepStatus;
}

export interface BuildStatus {
  status: "installing" | "installed" | "error";
  steps: BuildStep[];
  error?: string;
}

export type OutputKind = "stdout" | "stderr" | "done" | "error";

export interface OutputLine {
  id: string;
  text: string;
  kind: OutputKind;
  timestamp: number;
}

export interface PipelineSource {
  fromToolId: string;
  fromToolName: string;
  outputFile: string;
}

export type RunStatus = "idle" | "running" | "done" | "error";

export interface StemFile {
  name: string;
  path: string;
  duration: string;
}

export interface ToolRunState {
  status: RunStatus;
  inputFile: string | null;
  inputFileName: string | null;
  inputUrl: string;
  options: Record<string, string | boolean>;
  outputText: string;
  progressLines: string[];
  outputFiles: StemFile[];
  resultFile: string | null;
  errorMessage: string | null;
  startedAt: number | null;
  doneAt: number | null;
  justCompleted: boolean;
}

export const emptyRunState: ToolRunState = {
  status: "idle",
  inputFile: null,
  inputFileName: null,
  inputUrl: "",
  options: {},
  outputText: "",
  progressLines: [],
  outputFiles: [],
  resultFile: null,
  errorMessage: null,
  startedAt: null,
  doneAt: null,
  justCompleted: false,
};

export interface ToolOutputEventPayload {
  tool_id: string;
  line: string;
  kind: OutputKind;
}

export type ToolInstallStep = "cloning" | "reading" | "installing" | "ready" | "error";

export interface ToolProgressEventPayload {
  tool_id: string;
  step: ToolInstallStep;
  message: string;
}

export type RuntimeStep = "downloading" | "extracting" | "done" | "error";

export interface RuntimeProgressEventPayload {
  step: RuntimeStep;
  percent: number;
  message: string;
}

export const INSTALL_STEPS = [
  "Downloading the code",
  "Reading how it works",
  "Installing the parts",
  "Getting ready",
];

export const INSTALL_STEP_ORDER: ToolInstallStep[] = ["cloning", "reading", "installing", "ready"];

// ---------------------------------------------------------------------------
// QuickRun (Phase 2) — mirrors the daemon's JSON wire shapes (camelCase).
// ---------------------------------------------------------------------------

export type QuickRunState =
  | "awaitingInput"
  | "awaitingConfirmation"
  | "running"
  | "stopping"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export interface QuickRunCommand {
  phase: string;
  name: string;
  command: string;
  cwd: string | null;
}

export interface QuickRunInput {
  id: string;
  label: string | null;
  type: string;
  description: string | null;
  default: string | null;
  required: boolean;
  pattern: string | null;
  min: number | null;
  max: number | null;
  options: unknown;
  env: string | null;
  persist: boolean;
}

export interface QuickRunTaskStatus {
  name: string;
  state: string;
  url: string | null;
  pid: number | null;
}

export interface QuickRunProgress {
  phase: string;
  percent: number;
  detail: string;
}

export interface QuickRunSummary {
  id: string;
  repo: string;
  ref: string;
  commit: string | null;
  displayName: string;
  state: QuickRunState;
  commands: QuickRunCommand[];
  fingerprint: string;
  progress: QuickRunProgress | null;
  error: string | null;
  workspace: string | null;
  url: string | null;
  liveTasks: number;
  description: string | null;
  inputs: QuickRunInput[] | null;
  values: Record<string, string | null> | null;
  tasks: QuickRunTaskStatus[] | null;
  leftovers: number;
  origin: string;
  originDetail: string | null;
  configText: string | null;
  provisions: string[] | null;
}

export interface QuickRunEvent {
  kind: string;
  task: string | null;
  text: string;
  progress: QuickRunProgress | null;
  severity: string | null;
}

export interface QuickRunStatus {
  state: string;
  message: string;
}

export interface SavedRepo {
  repo: string;
  name: string;
  lastRun: number | null;
}

// ---------------------------------------------------------------------------
// Demo catalogue (static feature, no execution)
// ---------------------------------------------------------------------------

export interface DemoTool {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  tag?: string;
}

export interface DemoCollection {
  id: string;
  name: string;
  description: string;
  tools: DemoTool[];
}

export interface DiscoveredTool {
  name: string;
  repo: string | null;
  description: string | null;
}

export interface Runbook {
  summary: string;
  steps: string[];
  needs: string[];
  done_when: string;
  sources: string[];
}

export interface KeyStatus {
  openrouter: boolean;
  deepseek: boolean;
  tinyfish: boolean;
  openrouter_hint: string | null;
  deepseek_hint: string | null;
  tinyfish_hint: string | null;
}
