import { invoke } from "@tauri-apps/api/core";
import { useToolStore } from "../../store/useToolStore";
import { Tool, emptyRunState } from "../../types";
import { Select } from "../shared/Select";
import { Toggle } from "../shared/Toggle";
import { PanelFooter } from "../shared/PanelFooter";
import { PipelineButton } from "../shared/PipelineButton";
import { PipelineBadge } from "../shared/PipelineBadge";

const QUALITIES = [
  { value: "2160p", label: "2160p (4K)" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
];

function isLikelyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function UrlInFileOut({ tool }: { tool: Tool }) {
  const run = useToolStore((s) => s.toolRuns[tool.id] ?? emptyRunState);
  const pipeline = useToolStore((s) => s.pipelines[tool.id]);
  const setToolOption = useToolStore((s) => s.setToolOption);
  const setToolInputUrl = useToolStore((s) => s.setToolInputUrl);
  const runTool = useToolStore((s) => s.runTool);

  const quality = (run.options.quality as string) ?? "1080p";
  const audioOnly = Boolean(run.options.audioOnly);
  const isRunning = run.status === "running";
  const canRun = isLikelyUrl(run.inputUrl);

  async function handleRun() {
    if (!canRun) return;
    const args = [run.inputUrl, "--quality", quality];
    if (audioOnly) args.push("--audio-only");
    await runTool(tool.id, args);
  }

  const resultName = run.resultFile ? run.resultFile.split(/[\\/]/).pop() : null;

  async function handleOpenFolder() {
    const path = await invoke<string | null>("get_tool_output_path", { toolId: tool.id });
    if (path) await invoke("reveal_in_folder", { path });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        {pipeline && <PipelineBadge fromToolName={pipeline.fromToolName} toToolName={tool.name} />}

        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              🔗
            </span>
            <input
              value={run.inputUrl}
              onChange={(e) => setToolInputUrl(tool.id, e.target.value)}
              disabled={isRunning}
              placeholder="Paste a video link"
              className="w-full rounded-lg border py-2.5 pl-9 pr-3 text-[13px] outline-none disabled:opacity-50"
              style={{ borderColor: "var(--color-border-strong)", background: "var(--color-surface)" }}
            />
          </div>
          <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            Works with YouTube, Twitter, Instagram and 1,000+ sites
          </span>
        </div>

        <div className="flex items-end gap-3">
          <div className="w-40">
            <Select
              label="Quality"
              value={quality}
              options={QUALITIES}
              onChange={(v) => setToolOption(tool.id, "quality", v)}
              disabled={isRunning || audioOnly}
            />
          </div>
          <Toggle
            label="Audio only"
            checked={audioOnly}
            onChange={(v) => setToolOption(tool.id, "audioOnly", v)}
            disabled={isRunning}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <span className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
            Progress
          </span>
          <div
            className="min-h-[140px] flex-1 overflow-auto rounded-lg border p-3 font-mono text-[12px] leading-relaxed"
            style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
          >
            {run.progressLines.length === 0 ? (
              <span style={{ color: "var(--color-text-faint)" }}>
                Paste a link and press download to see progress here.
              </span>
            ) : (
              run.progressLines.map((line, i) => (
                <div key={i} className="tabular-nums">
                  {line}
                </div>
              ))
            )}
            {run.status === "done" && resultName && (
              <div className="mt-1" style={{ color: "var(--color-green)" }}>
                Saved as {resultName}
              </div>
            )}
          </div>
        </div>

        {run.status === "done" && (
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={handleOpenFolder}
              className="text-[12px] underline underline-offset-2"
              style={{ color: "var(--color-text-muted)" }}
            >
              Open in folder
            </button>
            <PipelineButton fromToolId={tool.id} outputTypes={audioOnly ? ["audio"] : ["video"]} />
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
        chips={[tool.runs_offline ? "Runs offline" : "Needs internet", `v${tool.version}`]}
        primaryLabel="Download"
        runningLabel="Downloading…"
        running={isRunning}
        onPrimary={handleRun}
        disabled={!canRun}
        disabledReason={!canRun ? "Paste a valid link first" : undefined}
      />
    </div>
  );
}
