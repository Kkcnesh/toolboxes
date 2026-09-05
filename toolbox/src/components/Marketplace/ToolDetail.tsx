import { open } from "@tauri-apps/plugin-shell";
import { useToolStore } from "../../store/useToolStore";
import { IOType, Tool } from "../../types";
import { ToolIcon } from "../shared/ToolIcon";
import { Button } from "../shared/Button";

const TYPE_LABELS: Record<IOType, string> = {
  audio: "Audio — MP3, WAV, FLAC, M4A",
  video: "Video — MP4, MOV, AVI",
  text: "Text — plain text, SRT, VTT",
  files: "Files — multiple files at once",
  url: "A web link",
};

interface ToolDetailProps {
  tool: Tool;
  onClose: () => void;
}

export function ToolDetail({ tool, onClose }: ToolDetailProps) {
  const installTool = useToolStore((s) => s.installTool);
  const openTabs = useToolStore((s) => s.openTabs);
  const buildStatus = useToolStore((s) => s.buildStatuses[tool.id]);
  const openToolTab = useToolStore((s) => s.openTab);
  const isInstalling = buildStatus?.status === "installing";

  return (
    <div className="absolute inset-0 z-30 flex justify-end" style={{ background: "rgba(0,0,0,0.16)" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-auto border-l p-6"
        style={{
          background: "var(--color-surface)",
          borderColor: "var(--color-border)",
          animation: "var(--animate-slide-in)",
        }}
      >
        <button
          onClick={onClose}
          className="mb-4 self-start text-[12.5px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          ← Back to marketplace
        </button>

        <div className="flex items-center gap-3">
          <ToolIcon color={tool.icon_color} label={tool.name} size={44} radius={14} />
          <div>
            <div className="text-[15px] font-medium">{tool.name}</div>
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
              {tool.category}
            </div>
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--color-text)" }}>
          {tool.description}
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            Accepts
          </span>
          {tool.input_types.map((t) => (
            <span key={t} className="text-[12.5px]">
              {TYPE_LABELS[t]}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            Produces
          </span>
          {tool.output_types.map((t) => (
            <span key={t} className="text-[12.5px]">
              {TYPE_LABELS[t]}
            </span>
          ))}
        </div>

        <button
          onClick={() => open(tool.github_url)}
          className="mt-5 self-start text-[12.5px] underline underline-offset-2"
          style={{ color: "var(--color-text-muted)" }}
        >
          View source and license on GitHub ↗
        </button>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          {tool.installed ? (
            <Button
              variant="primary"
              onClick={() => {
                openToolTab(tool.id);
                onClose();
              }}
            >
              Open tool
            </Button>
          ) : (
            <Button variant="primary" disabled={isInstalling} onClick={() => installTool(tool)}>
              {isInstalling ? "Adding…" : "Add to your tools"}
            </Button>
          )}
          <span className="text-[11.5px]" style={{ color: "var(--color-text-faint)" }}>
            {tool.installed
              ? `Already in your tools · ${openTabs.includes(tool.id) ? "open in a tab" : "closed"}`
              : "Free · open source · runs on your device"}
          </span>
        </div>
      </div>
    </div>
  );
}
