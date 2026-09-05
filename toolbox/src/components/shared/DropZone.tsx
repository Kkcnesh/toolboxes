import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";

interface DropZoneProps {
  label: string;
  hint: string;
  extensions: string[];
  fileName: string | null;
  onFileSelected: (path: string, name: string) => void;
  disabled?: boolean;
}

function isAcceptedFile(path: string, extensions: string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((ext) => lower.endsWith(`.${ext}`));
}

function isOverElement(position: { x: number; y: number }, el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function DropZone({ label, hint, extensions, fileName, onFileSelected, disabled }: DropZoneProps) {
  const [dragState, setDragState] = useState<"idle" | "over" | "rejected">("idle");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        const el = containerRef.current;
        if (payload.type === "enter" || payload.type === "over") {
          setDragState(el && isOverElement(payload.position, el) ? "over" : "idle");
        } else if (payload.type === "drop") {
          if (!el || !isOverElement(payload.position, el)) {
            setDragState("idle");
            return;
          }
          const path = payload.paths[0];
          if (path && isAcceptedFile(path, extensions)) {
            const name = path.split(/[\\/]/).pop() ?? path;
            onFileSelected(path, name);
            setDragState("idle");
          } else {
            setDragState("rejected");
            setTimeout(() => setDragState("idle"), 900);
          }
        } else {
          setDragState("idle");
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [extensions, onFileSelected, disabled]);

  async function handleBrowse() {
    if (disabled) return;
    const path = await invoke<string | null>("open_file_dialog", {
      extensions,
    });
    if (path) {
      const name = path.split(/[\\/]/).pop() ?? path;
      onFileSelected(path, name);
    }
  }

  return (
    <div
      ref={containerRef}
      onClick={handleBrowse}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleBrowse();
      }}
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-8 py-14 text-center transition-colors"
      style={{
        borderColor:
          dragState === "over"
            ? "var(--color-text)"
            : dragState === "rejected"
              ? "var(--color-red)"
              : "var(--color-border-strong)",
        background:
          dragState === "over"
            ? "var(--color-surface-hover)"
            : dragState === "rejected"
              ? "var(--color-red-soft)"
              : "transparent",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {fileName ? (
        <>
          <div className="text-[13px] font-medium">{fileName}</div>
          <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
            Click to choose a different file, or drop a new one here
          </div>
        </>
      ) : (
        <>
          <div className="text-[13px] font-medium">{label}</div>
          <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
            {dragState === "rejected" ? "That file type isn't supported here" : hint}
          </div>
        </>
      )}
    </div>
  );
}
