import { useToolStore } from "../../store/useToolStore";
import { FileInTextOut } from "../panels/FileInTextOut";
import { UrlInFileOut } from "../panels/UrlInFileOut";
import { FileInFilesOut } from "../panels/FileInFilesOut";
import { InstallFlow } from "../InstallFlow/InstallFlow";
import { Marketplace } from "../Marketplace/Marketplace";

function EmptyState() {
  const openMarketplace = useToolStore((s) => s.openMarketplace);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <div className="text-[14px] font-medium">Open a tool to get started</div>
      <div className="max-w-xs text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        Pick a tool from the sidebar, or browse the marketplace to add something new.
      </div>
      <button
        onClick={openMarketplace}
        className="mt-2 text-[12.5px] underline underline-offset-2"
        style={{ color: "var(--color-text-muted)" }}
      >
        Browse the marketplace
      </button>
    </div>
  );
}

export function ToolPanel() {
  const activeTabId = useToolStore((s) => s.activeTabId);
  const marketplaceOpen = useToolStore((s) => s.marketplaceOpen);
  const tools = useToolStore((s) => s.tools);
  const buildStatuses = useToolStore((s) => s.buildStatuses);

  if (marketplaceOpen) {
    return <Marketplace />;
  }

  if (!activeTabId) {
    return <EmptyState />;
  }

  const tool = tools.find((t) => t.id === activeTabId);
  if (!tool) return <EmptyState />;

  const buildStatus = buildStatuses[tool.id];
  const isInstalling = buildStatus?.status === "installing";
  const installFailed = buildStatus?.status === "error";

  if (!tool.installed && (isInstalling || installFailed || !buildStatus)) {
    return <InstallFlow tool={tool} buildStatus={buildStatus} />;
  }

  return (
    <div key={tool.id} className="flex h-full flex-col" style={{ animation: "var(--animate-panel-in)" }}>
      {tool.panel_type === "file_in_text_out" && <FileInTextOut tool={tool} />}
      {tool.panel_type === "url_in_file_out" && <UrlInFileOut tool={tool} />}
      {tool.panel_type === "file_in_files_out" && <FileInFilesOut tool={tool} />}
    </div>
  );
}
