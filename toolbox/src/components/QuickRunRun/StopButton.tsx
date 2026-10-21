import { useToolStore } from "../../store/useToolStore";
import { Button } from "../shared/Button";

const ACTIVE = new Set(["researching", "analyzing", "starting", "running", "repairing"]);

export function StopButton() {
  const statusState = useToolStore((s) => s.qrStatus?.state);
  const summaryState = useToolStore((s) => s.qrSummary?.state);
  const stop = useToolStore((s) => s.qrStop);

  const active = statusState ? ACTIVE.has(statusState) : false;
  const running = summaryState === "running" || summaryState === "stopping";

  if (!active && !running) return null;

  return (
    <Button variant="danger" onClick={stop} disabled={summaryState === "stopping"}>
      {summaryState === "stopping" ? "Stopping…" : "Stop"}
    </Button>
  );
}
