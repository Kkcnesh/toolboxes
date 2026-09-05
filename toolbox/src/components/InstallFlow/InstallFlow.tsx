import { useToolStore } from "../../store/useToolStore";
import { BuildStatus, Tool } from "../../types";
import { ToolIcon } from "../shared/ToolIcon";
import { Button } from "../shared/Button";

interface InstallFlowProps {
  tool: Tool;
  buildStatus?: BuildStatus;
}

function StepCircle({ status }: { status: "pending" | "active" | "done" | "error" }) {
  if (status === "done") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
        style={{ background: "var(--color-green)", color: "var(--color-surface)" }}
      >
        ✓
      </span>
    );
  }
  if (status === "active") {
    return (
      <span
        className="h-5 w-5 shrink-0 rounded-full border-2"
        style={{
          borderColor: "var(--color-border-strong)",
          borderTopColor: "var(--color-text)",
          animation: "var(--animate-spin-slow)",
        }}
      />
    );
  }
  return (
    <span
      className="h-5 w-5 shrink-0 rounded-full border-2"
      style={{ borderColor: "var(--color-border-strong)" }}
    />
  );
}

export function InstallFlow({ tool, buildStatus }: InstallFlowProps) {
  const installTool = useToolStore((s) => s.installTool);

  if (buildStatus?.status === "installing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
        <ToolIcon color={tool.icon_color} label={tool.name} size={52} radius={16} />
        <div className="text-center">
          <div className="text-[14px] font-medium">Adding {tool.name}</div>
          <div className="mt-1 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            This takes a couple of minutes. You can keep using other tools meanwhile.
          </div>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3.5">
          {buildStatus.steps.map((step) => (
            <div key={step.label} className="flex items-center gap-3">
              <StepCircle status={step.status} />
              <span
                className="text-[13px]"
                style={{ color: step.status === "pending" ? "var(--color-text-faint)" : "var(--color-text)" }}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (buildStatus?.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <ToolIcon color={tool.icon_color} label={tool.name} size={52} radius={16} />
        <div className="max-w-sm">
          <div className="text-[14px] font-medium">We couldn't package this tool</div>
          <div className="mt-1 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            We've logged it and will try again soon.
          </div>
        </div>
        <Button variant="primary" onClick={() => installTool(tool)}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
      <ToolIcon color={tool.icon_color} label={tool.name} size={60} radius={18} />
      <div className="max-w-sm">
        <div className="text-[15px] font-medium">{tool.name}</div>
        <div className="mt-1.5 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          {tool.description}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="rounded-full border px-2.5 py-1 text-[11px]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          Free · open source
        </span>
        {tool.runs_offline && (
          <span
            className="rounded-full border px-2.5 py-1 text-[11px]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
          >
            Runs offline
          </span>
        )}
      </div>
      <Button variant="primary" onClick={() => installTool(tool)}>
        Add to your tools
      </Button>
      <div className="text-[11.5px]" style={{ color: "var(--color-text-faint)" }}>
        Takes 2–4 minutes. Runs on your device after that.
      </div>
    </div>
  );
}
