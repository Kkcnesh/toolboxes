import { open } from "@tauri-apps/plugin-shell";
import { useToolStore } from "../../store/useToolStore";
import { Button } from "../shared/Button";

export function UrlBar() {
  const url = useToolStore((s) => s.qrSummary?.url);

  if (!url) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          Running at
        </span>
        <span className="truncate font-mono text-[13px]" style={{ color: "var(--color-accent)" }}>
          {url}
        </span>
      </div>
      <Button variant="primary" onClick={() => open(url)}>
        Open App
      </Button>
    </div>
  );
}
