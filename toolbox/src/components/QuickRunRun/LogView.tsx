import { useEffect, useRef } from "react";
import { useToolStore } from "../../store/useToolStore";
import { QuickRunEvent } from "../../types";

function severityColor(severity: string | null): string {
  switch (severity) {
    case "fatal":
    case "error":
      return "var(--color-red)";
    case "warn":
      return "var(--color-amber)";
    default:
      return "var(--color-text)";
  }
}

function Line({ event }: { event: QuickRunEvent }) {
  const prefix = event.task ? `[${event.task}] ` : "";
  return (
    <div className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed" style={{ color: severityColor(event.severity) }}>
      {prefix}
      {event.text}
    </div>
  );
}

export function LogView() {
  const events = useToolStore((s) => s.qrEvents);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div
      ref={ref}
      className="max-h-[40vh] min-h-[120px] overflow-auto rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
    >
      {events.length === 0 ? (
        <span className="text-[12px]" style={{ color: "var(--color-text-faint)" }}>
          Waiting for output…
        </span>
      ) : (
        events.map((e, i) => <Line key={i} event={e} />)
      )}
    </div>
  );
}
