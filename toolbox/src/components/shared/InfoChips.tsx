interface InfoChipsProps {
  chips: string[];
}

export function InfoChips({ chips }: InfoChipsProps) {
  return (
    <div className="flex items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border px-2.5 py-1 text-[11px]"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}
