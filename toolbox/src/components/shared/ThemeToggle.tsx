import { useToolStore } from "../../store/useToolStore";

export function ThemeToggle() {
  const theme = useToolStore((s) => s.theme);
  const setTheme = useToolStore((s) => s.setTheme);

  return (
    <button
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      className="flex h-full w-10 shrink-0 items-center justify-center border-l text-[14px]"
      style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {theme === "light" ? "☾" : "☀"}
    </button>
  );
}
