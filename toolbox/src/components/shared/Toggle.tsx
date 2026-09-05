interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <label
      className="flex cursor-pointer flex-col gap-1"
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <span className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-[22px] w-[38px] rounded-full border transition-colors disabled:cursor-not-allowed"
        style={{
          borderColor: checked ? "var(--color-accent)" : "var(--color-border-strong)",
          background: checked ? "var(--color-accent)" : "transparent",
        }}
      >
        <span
          className="absolute top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full transition-all"
          style={{
            left: checked ? "19px" : "3px",
            background: checked ? "var(--color-accent-text)" : "var(--color-text-muted)",
          }}
        />
      </button>
    </label>
  );
}
