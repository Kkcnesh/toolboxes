import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToolStore } from "../../store/useToolStore";
import { Tool } from "../../types";
import { ToolIcon } from "../shared/ToolIcon";
import { Button } from "../shared/Button";
import { cn } from "../shared/cn";

function ToolRow({ tool }: { tool: Tool }) {
  const activeTabId = useToolStore((s) => s.activeTabId);
  const marketplaceOpen = useToolStore((s) => s.marketplaceOpen);
  const openTab = useToolStore((s) => s.openTab);
  const isActive = !marketplaceOpen && activeTabId === tool.id;

  return (
    <button
      onClick={() => openTab(tool.id)}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors"
      style={{ background: isActive ? "var(--color-surface-active)" : "transparent" }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <div className="relative shrink-0">
        <ToolIcon color={tool.icon_color} label={tool.name} size={28} radius={12} />
        {tool.installed && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2"
            style={{ background: "var(--color-green)", borderColor: "var(--color-surface)" }}
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium">{tool.name}</div>
        <div className="truncate text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          {tool.category}
        </div>
      </div>
    </button>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-1.5 pt-4 text-[11px] first:pt-2" style={{ color: "var(--color-text-faint)" }}>
      {children}
    </div>
  );
}

function AddFromGithubModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadTools = useToolStore((s) => s.loadTools);
  const openTab = useToolStore((s) => s.openTab);
  const installTool = useToolStore((s) => s.installTool);

  async function handleSubmit() {
    if (!url.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const tool = await invoke<Tool>("add_custom_tool", { githubUrl: url.trim() });
      await loadTools();
      openTab(tool.id);
      await installTool(tool);
      onClose();
    } catch {
      setError("We couldn't read that repository. Check the link and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.28)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[380px] flex-col gap-3 rounded-xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="text-[13.5px] font-medium">Add a tool from GitHub</div>
        <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          Paste a link to a public GitHub repository and we'll package it for your device.
        </p>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="https://github.com/owner/repo"
          className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
        />
        {error && (
          <div className="text-[12px]" style={{ color: "var(--color-red)" }}>
            {error}
          </div>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting || !url.trim()}>
            {submitting ? "Adding…" : "Add tool"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  const tools = useToolStore((s) => s.tools);
  const [search, setSearch] = useState("");
  const [githubModalOpen, setGithubModalOpen] = useState(false);

  const filtered = tools.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  });
  const installed = filtered.filter((t) => t.installed);
  const marketplace = filtered.filter((t) => !t.installed);

  return (
    <aside
      className="flex h-full w-[220px] shrink-0 flex-col border-r"
      style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
    >
      <div className="p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools"
          className="w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <SectionLabel>Your tools</SectionLabel>
        {installed.length === 0 ? (
          <div className="px-2 py-1 text-[11.5px]" style={{ color: "var(--color-text-faint)" }}>
            Add a tool to get started
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {installed.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        <SectionLabel>Marketplace</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {marketplace.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </div>
      </div>

      <div className="border-t p-2.5" style={{ borderColor: "var(--color-border)" }}>
        <button
          onClick={() => setGithubModalOpen(true)}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-[12px] transition-colors",
          )}
          style={{ borderColor: "var(--color-border-strong)", color: "var(--color-text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          + Add from GitHub
        </button>
      </div>

      {githubModalOpen && <AddFromGithubModal onClose={() => setGithubModalOpen(false)} />}
    </aside>
  );
}
