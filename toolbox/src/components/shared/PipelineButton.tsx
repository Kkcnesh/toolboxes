import { useEffect, useRef, useState } from "react";
import { useToolStore } from "../../store/useToolStore";
import { IOType } from "../../types";
import { cn } from "./cn";

interface PipelineButtonProps {
  fromToolId: string;
  outputTypes: IOType[];
}

export function PipelineButton({ fromToolId, outputTypes }: PipelineButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tools = useToolStore((s) => s.tools);
  const pipeOutput = useToolStore((s) => s.pipeOutput);
  const openMarketplace = useToolStore((s) => s.openMarketplace);

  const compatible = tools.filter(
    (t) => t.id !== fromToolId && t.installed && t.input_types.some((it) => outputTypes.includes(it)),
  );

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (compatible.length === 0) {
    return (
      <button
        onClick={openMarketplace}
        className="text-[12px] underline underline-offset-2"
        style={{ color: "var(--color-text-muted)" }}
      >
        Browse compatible tools in marketplace
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="toolbox-btn-secondary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium"
      >
        Send to tool
        <span style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.12s" }}>⌄</span>
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 z-20 mb-2 w-56 overflow-hidden rounded-lg border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          {compatible.map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                pipeOutput(fromToolId, tool.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors",
                "hover:cursor-pointer",
              )}
              style={{ background: "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span
                className="h-5 w-5 shrink-0 rounded-[6px]"
                style={{ background: tool.icon_color }}
              />
              <span className="flex flex-col">
                <span className="font-medium">{tool.name}</span>
                <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {tool.category}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
