import { Button } from "./Button";
import { InfoChips } from "./InfoChips";

interface PanelFooterProps {
  chips: string[];
  primaryLabel: string;
  runningLabel: string;
  running: boolean;
  onPrimary: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function PanelFooter({
  chips,
  primaryLabel,
  runningLabel,
  running,
  onPrimary,
  disabled,
  disabledReason,
}: PanelFooterProps) {
  return (
    <div
      className="flex items-center justify-between border-t px-5 py-3.5"
      style={{ borderColor: "var(--color-border)" }}
    >
      <InfoChips chips={chips} />
      <Button
        variant="primary"
        onClick={onPrimary}
        disabled={disabled || running}
        disabledReason={disabledReason}
        className="min-w-[120px]"
      >
        {running ? (
          <>
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: "var(--color-accent-text)", animation: "var(--animate-pulse-dot)" }}
            />
            {runningLabel}
          </>
        ) : (
          primaryLabel
        )}
      </Button>
    </div>
  );
}
