import { useToolStore } from "../../store/useToolStore";

export function ProgressBar() {
  const summary = useToolStore((s) => s.qrSummary);
  const progress = summary?.progress;
  const tasks = summary?.tasks;
  const percent = progress?.percent ?? 0;

  return (
    <div className="flex flex-col gap-2">
      {progress && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[12px]">
            <span style={{ color: "var(--color-text-muted)" }}>{progress.detail}</span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${percent}%`, background: "var(--color-accent)" }}
            />
          </div>
        </div>
      )}
      {tasks && tasks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tasks.map((t) => (
            <span
              key={t.name}
              className="rounded-full border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: "var(--color-border)",
                color: t.state === "ready" ? "var(--color-green)" : "var(--color-text-muted)",
              }}
            >
              {t.name}: {t.state}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
