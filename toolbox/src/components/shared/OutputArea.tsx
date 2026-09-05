import { useRef, useState } from "react";
import { Button } from "./Button";

interface OutputAreaProps {
  text: string;
  placeholder: string;
  onSave: () => void;
}

export function OutputArea({ text, placeholder, onSave }: OutputAreaProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          Output
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={handleCopy}
            disabled={!text}
            disabledReason="There's nothing to copy yet"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" onClick={onSave} disabled={!text} disabledReason="There's nothing to save yet">
            Save
          </Button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto rounded-lg border p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap"
        style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
      >
        {text || <span style={{ color: "var(--color-text-faint)" }}>{placeholder}</span>}
      </div>
    </div>
  );
}
