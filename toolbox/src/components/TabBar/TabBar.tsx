import { useState, type DragEvent } from "react";
import { useToolStore } from "../../store/useToolStore";
import { Tool } from "../../types";
import { ToolIcon } from "../shared/ToolIcon";
import { ThemeToggle } from "../shared/ThemeToggle";
import { cn } from "../shared/cn";

// Demo mode: the marketplace "+" entry point is hidden (code retained).
const SHOW_LEGACY_TOOLS = false;

interface TabProps {
  tool: Tool;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function TabIndicator({ tool }: { tool: Tool }) {
  const run = useToolStore((s) => s.toolRuns[tool.id]);
  const buildStatus = useToolStore((s) => s.buildStatuses[tool.id]);
  const dismissError = useToolStore((s) => s.dismissError);

  const installing = buildStatus?.status === "installing";
  const hasError = run?.status === "error" || buildStatus?.status === "error";
  const running = installing || run?.status === "running";
  const justCompleted = run?.justCompleted;

  if (hasError) {
    return (
      <span
        role="button"
        title="Dismiss error"
        onClick={(e) => {
          e.stopPropagation();
          dismissError(tool.id);
        }}
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: "var(--color-red)" }}
      />
    );
  }
  if (running) {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: "var(--color-amber)", animation: "var(--animate-pulse-dot)" }}
      />
    );
  }
  if (justCompleted) {
    return (
      <span
        className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full text-[8px]"
        style={{
          background: "var(--color-green)",
          color: "var(--color-surface)",
          animation: "var(--animate-fade-out)",
        }}
      >
        ✓
      </span>
    );
  }
  return null;
}

function Tab({ tool, isActive, isDragging, onDragStart, onDragOver, onDrop, onDragEnd }: TabProps) {
  const setActiveTab = useToolStore((s) => s.setActiveTab);
  const closeTab = useToolStore((s) => s.closeTab);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={() => setActiveTab(tool.id)}
      className={cn(
        "group flex w-[168px] shrink-0 cursor-pointer items-center gap-2 border-r px-3",
        isDragging && "opacity-40",
      )}
      style={{
        borderColor: "var(--color-border)",
        background: isActive ? "var(--color-surface)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--color-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <ToolIcon color={tool.icon_color} label={tool.name} size={16} radius={6} />
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{tool.name}</span>
      <TabIndicator tool={tool} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tool.id);
        }}
        className="shrink-0 rounded text-[13px] opacity-0 group-hover:opacity-100"
        style={{ color: "var(--color-text-muted)" }}
      >
        ×
      </button>
    </div>
  );
}

export function TabBar() {
  const openTabs = useToolStore((s) => s.openTabs);
  const tools = useToolStore((s) => s.tools);
  const activeTabId = useToolStore((s) => s.activeTabId);
  const marketplaceOpen = useToolStore((s) => s.marketplaceOpen);
  const reorderTabs = useToolStore((s) => s.reorderTabs);
  const openMarketplace = useToolStore((s) => s.openMarketplace);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div
      className="flex h-10 shrink-0 items-center border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
    >
      <div className="flex h-full flex-1 items-stretch overflow-x-auto">
        {openTabs.map((id, index) => {
          const tool = tools.find((t) => t.id === id);
          if (!tool) return null;
          return (
            <Tab
              key={id}
              tool={tool}
              index={index}
              isActive={!marketplaceOpen && activeTabId === id}
              isDragging={dragIndex === index}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== index) reorderTabs(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
            />
          );
        })}
      </div>
      {SHOW_LEGACY_TOOLS && (
        <button
          onClick={openMarketplace}
          title="Open the marketplace"
          className="flex h-full w-10 shrink-0 items-center justify-center text-[16px]"
          style={{ color: "var(--color-text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          +
        </button>
      )}
      <ThemeToggle />
    </div>
  );
}
