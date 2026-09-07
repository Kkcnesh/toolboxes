import { useEffect, useRef } from "react";
import { useToolStore } from "../../store/useToolStore";
import { Button } from "../shared/Button";

export function SetupScreen() {
  const runtimeProgress = useToolStore((s) => s.runtimeProgress);
  const downloadRuntime = useToolStore((s) => s.downloadRuntime);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    downloadRuntime();
  }, [downloadRuntime]);

  const percent = runtimeProgress?.percent ?? 0;
  const isError = runtimeProgress?.step === "error";
  const message = runtimeProgress?.message ?? "Getting things ready…";

  return (
    <div
      className="flex h-screen w-screen flex-col items-center justify-center gap-8 px-8"
      style={{ background: "var(--color-page)" }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="text-[16px] font-medium">Setting up Toolbox</div>
        <div className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>
          This only happens once — it takes about 30 seconds.
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: "var(--color-border)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${Math.min(100, Math.max(3, percent))}%`,
              background: isError ? "var(--color-red)" : "var(--color-text)",
            }}
          />
        </div>
        <div
          className="text-center text-[12.5px]"
          style={{ color: isError ? "var(--color-red)" : "var(--color-text-muted)" }}
        >
          {message}
        </div>
      </div>

      {isError && (
        <Button variant="primary" onClick={() => downloadRuntime()}>
          Try again
        </Button>
      )}
    </div>
  );
}
