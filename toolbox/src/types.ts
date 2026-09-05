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

export interface BuildProgressEventPayload {
  tool_id: string;
  status: "installing" | "installed" | "error";
  step: string;
}

export interface BuildInstalledEventPayload {
  tool_id: string;
  exe_path: string;
}

export interface BuildErrorEventPayload {
  tool_id: string;
  error: string;
}

export const INSTALL_STEPS = [
  "Copying the code…",
  "Installing the parts…",
  "Running a safety scan…",
  "Downloading to your device…",
];
