interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function Select({ label, value, options, onChange, disabled }: SelectProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border px-2.5 py-1.5 pr-7 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-surface)" }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          ⌄
        </span>
      </div>
    </label>
  );
}
