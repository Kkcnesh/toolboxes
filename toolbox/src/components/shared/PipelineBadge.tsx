interface PipelineBadgeProps {
  fromToolName: string;
  toToolName: string;
}

export function PipelineBadge({ fromToolName, toToolName }: PipelineBadgeProps) {
  return (
    <div
      className="mb-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]"
      style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
    >
      <span>⇢</span>
      <span className="font-medium" style={{ color: "var(--color-text)" }}>
        {fromToolName}
      </span>
      <span>→</span>
      <span className="font-medium" style={{ color: "var(--color-text)" }}>
        {toToolName}
      </span>
    </div>
  );
}
