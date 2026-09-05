import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToolStore } from "../../store/useToolStore";
import { StemFile, Tool, emptyRunState } from "../../types";
import { DropZone } from "../shared/DropZone";
import { Select } from "../shared/Select";
import { PanelFooter } from "../shared/PanelFooter";
import { PipelineButton } from "../shared/PipelineButton";
import { PipelineBadge } from "../shared/PipelineBadge";
import { Button } from "../shared/Button";

const MODELS = [
  { value: "htdemucs", label: "Standard (htdemucs)" },
  { value: "htdemucs_ft", label: "High quality (fine-tuned)" },
  { value: "mdx_extra", label: "Fast (mdx-extra)" },
];

const STEM_COUNTS = [
  { value: "4", label: "4 stems — vocals, drums, bass, other" },
  { value: "2", label: "2 stems — vocals, instrumental" },
];

function barHeights(seed: string): number[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < 28; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(18 + (h % 100) * 0.6);
  }
  return bars;
}

function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/") || path;
}

function StemCard({ stem }: { stem: StemFile }) {
  const heights = barHeights(stem.name);
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3.5" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">{stem.name}</span>
        <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
          {stem.duration}
        </span>
      </div>
      <div className="flex h-10 items-end gap-[2px]" style={{ color: "var(--color-text-faint)" }}>
        {heights.map((h, i) => (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full"
            style={{ height: `${h}%`, background: "currentColor" }}
          />
        ))}
      </div>
      <Button variant="secondary" onClick={() => invoke("reveal_in_folder", { path: dirname(stem.path) })}>
        Open in folder
      </Button>
    </div>
  );
}

export function FileInFilesOut({ tool }: { tool: Tool }) {
  const run = useToolStore((s) => s.toolRuns[tool.id] ?? emptyRunState);
  const pipeline = useToolStore((s) => s.pipelines[tool.id]);
  const setToolOption = useToolStore((s) => s.setToolOption);
  const setToolInputFile = useToolStore((s) => s.setToolInputFile);
  const runTool = useToolStore((s) => s.runTool);

  const model = (run.options.model as string) ?? "htdemucs";
  const stems = (run.options.stems as string) ?? "4";
  const isRunning = run.status === "running";

  const handleFile = useCallback(
    (path: string, name: string) => setToolInputFile(tool.id, path, name),
    [setToolInputFile, tool.id],
  );

  async function handleRun() {
    if (!run.inputFile) return;
    await runTool(tool.id, ["--model", model, "--stems", stems], run.inputFile);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        {pipeline && <PipelineBadge fromToolName={pipeline.fromToolName} toToolName={tool.name} />}

        <DropZone
          label="Drop an audio file to separate its stems"
          hint="MP3, WAV, FLAC or M4A"
          extensions={["mp3", "wav", "flac", "m4a"]}
          fileName={run.inputFileName}
          onFileSelected={handleFile}
          disabled={isRunning}
        />

        <div className="flex items-center gap-3">
          <div className="w-56">
            <Select
              label="Model"
              value={model}
              options={MODELS}
              onChange={(v) => setToolOption(tool.id, "model", v)}
              disabled={isRunning}
            />
          </div>
          <div className="w-64">
            <Select
              label="Stems"
              value={stems}
              options={STEM_COUNTS}
              onChange={(v) => setToolOption(tool.id, "stems", v)}
              disabled={isRunning}
            />
          </div>
        </div>

        {run.outputFiles.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {run.outputFiles.map((stem) => (
              <StemCard key={stem.path} stem={stem} />
            ))}
          </div>
        ) : (
          <div
            className="flex flex-1 items-center justify-center rounded-xl border border-dashed p-8 text-[12.5px]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-faint)" }}
          >
            Separated stems will show up here as cards once processing finishes.
          </div>
        )}

        {run.status === "done" && (
          <div className="flex justify-end">
            <PipelineButton fromToolId={tool.id} outputTypes={["files", "audio"]} />
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
        primaryLabel="Separate"
        runningLabel="Separating…"
        running={isRunning}
        onPrimary={handleRun}
        disabled={!run.inputFile}
        disabledReason={!run.inputFile ? "Drop a file first" : undefined}
      />
    </div>
  );
}
