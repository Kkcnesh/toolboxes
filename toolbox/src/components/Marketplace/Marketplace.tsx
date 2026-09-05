import { useMemo, useState } from "react";
import { useToolStore } from "../../store/useToolStore";
import { Tool } from "../../types";
import { ToolIcon } from "../shared/ToolIcon";
import { Button } from "../shared/Button";
import { cn } from "../shared/cn";
import { ToolDetail } from "./ToolDetail";

const CATEGORIES = ["All", "Audio", "Video", "Image", "Text", "Code"];

function MarketplaceCard({ tool, onOpenDetail }: { tool: Tool; onOpenDetail: () => void }) {
  const buildStatus = useToolStore((s) => s.buildStatuses[tool.id]);
  const installTool = useToolStore((s) => s.installTool);
  const openTab = useToolStore((s) => s.openTab);
  const isInstalling = buildStatus?.status === "installing";
  const stepIndex = buildStatus?.steps.findIndex((s) => s.status === "active") ?? -1;

  return (
    <div
      onClick={onOpenDetail}
      role="button"
      tabIndex={0}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors"
      style={{ borderColor: "var(--color-border)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div className="flex items-center gap-2.5">
        <ToolIcon color={tool.icon_color} label={tool.name} size={32} radius={12} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium">{tool.name}</div>
          <div className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            {tool.category}
          </div>
        </div>
      </div>

      <p className="line-clamp-2 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
        {tool.description}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-full border px-2 py-0.5 text-[10.5px]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          Windows · Mac · Linux
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[10.5px]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          Free
        </span>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
          {tool.install_count.toLocaleString()} installs
        </span>

        {tool.installed ? (
          <Button
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              openTab(tool.id);
            }}
          >
            Open
          </Button>
        ) : isInstalling ? (
          <span className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            <span
              className="h-3.5 w-3.5 rounded-full border-2"
              style={{
                borderColor: "var(--color-border-strong)",
                borderTopColor: "var(--color-text)",
                animation: "var(--animate-spin-slow)",
              }}
            />
            Step {Math.max(stepIndex, 0) + 1} of {buildStatus?.steps.length ?? 4}
          </span>
        ) : (
          <Button
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              installTool(tool);
            }}
          >
            Add
          </Button>
        )}
      </div>
    </div>
  );
}

export function Marketplace() {
  const tools = useToolStore((s) => s.tools);
  const closeMarketplace = useToolStore((s) => s.closeMarketplace);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [detailToolId, setDetailToolId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return tools.filter((t) => {
      const matchesCategory = category === "All" || t.category === category;
      const matchesSearch =
        search.trim() === "" ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [tools, search, category]);

  const detailTool = tools.find((t) => t.id === detailToolId) ?? null;

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--color-border)" }}>
        <div className="text-[14px] font-medium">Marketplace</div>
        <button onClick={closeMarketplace} className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          Close
        </button>
      </div>

      <div className="flex flex-col gap-3 border-b px-5 py-3.5" style={{ borderColor: "var(--color-border)" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools"
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-surface)" }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px] transition-colors",
                category === c ? "font-medium" : "",
              )}
              style={{
                borderColor: category === c ? "var(--color-accent)" : "var(--color-border)",
                background: category === c ? "var(--color-accent)" : "transparent",
                color: category === c ? "var(--color-accent-text)" : "var(--color-text-muted)",
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>
            No tools match yet — try a different search or category.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filtered.map((tool) => (
              <MarketplaceCard key={tool.id} tool={tool} onOpenDetail={() => setDetailToolId(tool.id)} />
            ))}
          </div>
        )}
      </div>

      {detailTool && <ToolDetail tool={detailTool} onClose={() => setDetailToolId(null)} />}
    </div>
  );
}
