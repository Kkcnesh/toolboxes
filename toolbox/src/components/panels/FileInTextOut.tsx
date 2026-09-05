import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useToolStore } from "../../store/useToolStore";
import { Tool, emptyRunState } from "../../types";
import { DropZone } from "../shared/DropZone";
import { Select } from "../shared/Select";
import { OutputArea } from "../shared/OutputArea";
import { PanelFooter } from "../shared/PanelFooter";
import { PipelineButton } from "../shared/PipelineButton";
import { PipelineBadge } from "../shared/PipelineBadge";

const LANGUAGES = [
  { value: "auto", label: "Detect automatically" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Japanese" },
];

const FORMATS = [
  { value: "txt", label: "Plain text" },
  { value: "srt", label: "SRT subtitles" },
  { value: "vtt", label: "VTT subtitles" },
];

export function FileInTextOut({ tool }: { tool: Tool }) {
  const run = useToolStore((s) => s.toolRuns[tool.id] ?? emptyRunState);
  const pipeline = useToolStore((s) => s.pipelines[tool.id]);
  const setToolOption = useToolStore((s) => s.setToolOption);
  const setToolInputFile = useToolStore((s) => s.setToolInputFile);
  const runTool = useToolStore((s) => s.runTool);

  const language = (run.options.language as string) ?? "auto";
  const format = (run.options.format as string) ?? "txt";
  const isRunning = run.status === "running";

  const handleFile = useCallback(
    (path: string, name: string) => setToolInputFile(tool.id, path, name),
    [setToolInputFile, tool.id],
  );

  async function handleRun() {
    if (!run.inputFile) return;
    await runTool(tool.id, ["--language", language, "--format", format], run.inputFile);
  }

  async function handleSave() {
    const path = await invoke<string | null>("save_file_dialog", {
      defaultName: `transcript.${format}`,
    });
    if (path) await writeTextFile(path, run.outputText);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        {pipeline && <PipelineBadge fromToolName={pipeline.fromToolName} toToolName={tool.name} />}

        <DropZone
          label="Drop an audio or video file to get started"
          hint="MP3, WAV, FLAC, M4A, MP4, MOV or AVI"
          extensions={["mp3", "wav", "flac", "m4a", "mp4", "mov", "avi"]}
          fileName={run.inputFileName}
          onFileSelected={handleFile}
          disabled={isRunning}
        />

        <div className="flex items-center gap-3">
          <div className="w-48">
            <Select
              label="Language"
              value={language}
              options={LANGUAGES}
              onChange={(v) => setToolOption(tool.id, "language", v)}
              disabled={isRunning}
            />
          </div>
          <div className="w-48">
            <Select
              label="Output format"
              value={format}
              options={FORMATS}
              onChange={(v) => setToolOption(tool.id, "format", v)}
              disabled={isRunning}
            />
          </div>
        </div>

        <OutputArea
          text={run.outputText}
          placeholder="Your transcript will appear here once the file finishes processing."
          onSave={handleSave}
        />

        {run.status === "done" && (
          <div className="flex justify-end">
            <PipelineButton fromToolId={tool.id} outputTypes={["text"]} />
          </div>
        )}

        {run.status === "error" && run.errorMessage && (
          <div
            className="rounded-lg border px-3 py-2 text-[12.5px]"
            style={{ borderColor: "var(--color-red)", background: "var(--color-red-soft)", color: "var(--color-red)" }}
          >
            {run.errorMessage}
          </div>
        )}
      </div>

      <PanelFooter
        chips={[tool.runs_offline ? "Runs offline" : "Needs internet", "CPU mode", `v${tool.version}`]}
        primaryLabel="Transcribe"
        runningLabel="Transcribing…"
        running={isRunning}
        onPrimary={handleRun}
        disabled={!run.inputFile}
        disabledReason={!run.inputFile ? "Drop a file first" : undefined}
      />
    </div>
  );
}
