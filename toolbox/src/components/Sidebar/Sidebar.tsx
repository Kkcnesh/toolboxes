import { useEffect, useState } from "react";
import { useToolStore } from "../../store/useToolStore";
import { DemoCollection, DiscoveredTool, Tool } from "../../types";
import { demoCollectionLink, parseCollectionLink } from "../../demo/collections";
import { ToolIcon } from "../shared/ToolIcon";
import { Button } from "../shared/Button";

// Demo mode: hide the legacy seeded Python-tool list and marketplace. Their
// source and backend commands are retained; flip this to re-enable them.
const SHOW_LEGACY_TOOLS = false;

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

function parseRepoInput(input: string): string {
  const text = input.trim();
  if (text.startsWith("gitrun://")) {
    try {
      const parsed = new URL(text);
      const repo = parsed.searchParams.get("repo");
      if (repo) return repo;
    } catch {
      // not a valid link; fall through to using it as typed
    }
  }
  return text;
}

function AddFromGithubModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const qrAutorun = useToolStore((s) => s.qrAutorun);
  const qrImportCollection = useToolStore((s) => s.qrImportCollection);
  const openQuickRun = useToolStore((s) => s.openQuickRun);

  async function handleSubmit() {
    if (parseCollectionLink(url)) {
      qrImportCollection(url);
      onClose();
      return;
    }

    const repo = parseRepoInput(url);
    if (!repo) return;
    setSubmitting(true);
    onClose();
    openQuickRun();
    await qrAutorun(repo, token.trim() || null);
    setSubmitting(false);
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
        <div className="text-[13.5px] font-medium">Run a repository</div>
        <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          Paste a GitHub URL or a shared <span className="font-mono">gitrun://</span> link. GitRun
          researches the project, builds the QuickRun config, and starts it.
        </p>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="https://github.com/owner/repo   or   gitrun://run?repo=…"
          className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
        />
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Access token (private repos, optional)"
          className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
        />
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting || !url.trim()}>
            {submitting ? "Starting…" : "Run with AI"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmRunModal({
  name,
  onRun,
  onCancel,
}: {
  name: string;
  onRun: (token: string | null) => void;
  onCancel: () => void;
}) {
  const [token, setToken] = useState("");

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.28)" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[360px] flex-col gap-3 rounded-xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="text-[13.5px] font-medium">Run {name}?</div>
        <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          This starts the saved plan for this repository. You can stop it at any time.
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Access token (private repos, optional)"
          className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
          style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
        />
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onRun(token.trim() || null)}>
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}

function CollectionFolder({ collection }: { collection: DemoCollection }) {
  const openDemoTool = useToolStore((s) => s.qrOpenDemoTool);
  const removeCollection = useToolStore((s) => s.qrRemoveCollection);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="group flex items-center gap-1 px-1 pt-2">
        <span className="truncate text-[11px]" style={{ color: "var(--color-text-faint)" }}>
          📁 {collection.name} ({collection.tools.length})
        </span>
        {collection.id !== "featured" && (
          <button
            onClick={() => removeCollection(collection.id)}
            title="Remove collection"
            className="ml-auto shrink-0 rounded px-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: "var(--color-text-muted)" }}
          >
            ×
          </button>
        )}
      </div>
      {collection.tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => openDemoTool(collection.id, tool)}
          className="flex w-full items-center gap-2 rounded-lg py-1.5 pl-4 pr-2 text-left text-[12px] transition-colors"
          style={{ color: "var(--color-text)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tool.color }} />
          <span className="truncate">{tool.name}</span>
        </button>
      ))}
    </div>
  );
}

function ImportCollectionModal({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState(demoCollectionLink("ai-starter-pack"));
  const [error, setError] = useState<string | null>(null);
  const qrImportCollection = useToolStore((s) => s.qrImportCollection);

  function handleImport() {
    if (qrImportCollection(link)) {
      onClose();
      return;
    }
    setError("That link doesn't match a known collection. Try the demo link below.");
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.28)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[420px] flex-col gap-3 rounded-xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="text-[13.5px] font-medium">Import a collection</div>
        <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          Paste a collection link to add a folder of tools. This is a static demo catalogue.
        </p>
        <input
          autoFocus
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleImport()}
          placeholder="gitrun://collection?id=…"
          className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
        />
        <div className="text-[11px] font-mono break-all" style={{ color: "var(--color-text-faint)" }}>
          {demoCollectionLink("ai-starter-pack")}
        </div>
        {error && (
          <div className="text-[12px]" style={{ color: "var(--color-red)" }}>
            {error}
          </div>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleImport}>
            Import
          </Button>
        </div>
      </div>
    </div>
  );
}

function DiscoverToolsModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("https://github.com/ossu/computer-science");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<DiscoveredTool[]>([]);
  const discover = useToolStore((s) => s.qrDiscoverTools);
  const add = useToolStore((s) => s.qrAddDiscoveredCollection);

  async function handleDiscover() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const found = await discover(url.trim());
      setTools(found.slice(0, 12));
      if (found.length === 0) setError("No tools found on that page.");
    } catch (err) {
      setError(String(err));
    }
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.28)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[480px] flex-col gap-3 rounded-xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="text-[13.5px] font-medium">Discover tools</div>
        <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          Paste a public list or page. TinyFish reads it and extracts the tools into a collection.
        </p>
        <div className="flex gap-2">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-[12.5px] outline-none"
            style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
          />
          <Button variant="primary" onClick={handleDiscover} disabled={busy || !url.trim()}>
            {busy ? "Reading…" : "Discover"}
          </Button>
        </div>
        {error && (
          <div className="text-[12px]" style={{ color: "var(--color-red)" }}>
            {error}
          </div>
        )}
        {tools.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
            {tools.map((tool, index) => (
              <div
                key={`${tool.name}-${index}`}
                className="border-b px-3 py-2 last:border-0"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="text-[12.5px] font-medium">{tool.name}</div>
                {tool.description && (
                  <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                    {tool.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={tools.length === 0}
            onClick={() => {
              add("Discovered tools", tools);
              onClose();
            }}
          >
            Add {tools.length > 0 ? tools.length : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

function KeyField({
  label,
  value,
  onChange,
  status,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  status: string;
}) {
  const configured = status.startsWith("Configured");
  return (
    <label className="flex flex-col gap-1 text-[12px]">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="text-[10.5px]" style={{ color: configured ? "var(--color-green)" : "var(--color-text-faint)" }}>
          {status}
        </span>
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste the key…"
        className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
        style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
      />
    </label>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const qrKeyStatus = useToolStore((s) => s.qrKeyStatus);
  const qrLoadKeys = useToolStore((s) => s.qrLoadKeys);
  const qrSaveKey = useToolStore((s) => s.qrSaveKey);
  const [tinyfish, setTinyfish] = useState("");
  const [openrouter, setOpenrouter] = useState("");
  const [deepseek, setDeepseek] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    qrLoadKeys();
  }, [qrLoadKeys]);

  async function handleSave() {
    setSaving(true);
    if (tinyfish.trim()) await qrSaveKey("tinyfish", tinyfish);
    if (openrouter.trim()) await qrSaveKey("openrouter", openrouter);
    if (deepseek.trim()) await qrSaveKey("deepseek", deepseek);
    await qrLoadKeys();
    setTinyfish("");
    setOpenrouter("");
    setDeepseek("");
    setSaving(false);
    onClose();
  }

  function status(isSet: boolean | undefined, hint: string | null | undefined): string {
    return isSet ? `Configured ${hint ?? ""}`.trim() : "Not set";
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.28)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[420px] flex-col gap-4 rounded-xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <div>
          <div className="text-[13.5px] font-medium">Settings</div>
          <p className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            Keys are stored on this machine. Leave a field blank to keep the current value.
          </p>
        </div>

        <KeyField
          label="TinyFish API key"
          value={tinyfish}
          onChange={setTinyfish}
          status={status(qrKeyStatus?.tinyfish, qrKeyStatus?.tinyfish_hint)}
        />
        <KeyField
          label="OpenRouter API key"
          value={openrouter}
          onChange={setOpenrouter}
          status={status(qrKeyStatus?.openrouter, qrKeyStatus?.openrouter_hint)}
        />
        <KeyField
          label="DeepSeek API key"
          value={deepseek}
          onChange={setDeepseek}
          status={status(qrKeyStatus?.deepseek, qrKeyStatus?.deepseek_hint)}
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || (!tinyfish.trim() && !openrouter.trim() && !deepseek.trim())}
          >
            {saving ? "Saving…" : "Save"}
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
  const [importOpen, setImportOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingRepo, setPendingRepo] = useState<{ repo: string; name: string } | null>(null);
  const collections = useToolStore((s) => s.qrCollections);
  const qrWindows = useToolStore((s) => s.qrWindows);
  const qrOpenAppWindow = useToolStore((s) => s.qrOpenAppWindow);
  const qrCloseAppWindow = useToolStore((s) => s.qrCloseAppWindow);
  const qrSaved = useToolStore((s) => s.qrSaved);
  const qrLoadSaved = useToolStore((s) => s.qrLoadSaved);
  const qrRunSaved = useToolStore((s) => s.qrRunSaved);
  const qrForgetSaved = useToolStore((s) => s.qrForgetSaved);
  const openQuickRun = useToolStore((s) => s.openQuickRun);

  useEffect(() => {
    qrLoadSaved();
  }, [qrLoadSaved]);

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
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-semibold">GitRun</div>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="rounded px-1.5 py-0.5 text-[14px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            ⚙
          </button>
        </div>
        <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
          Run any open-source repository with one click. No setup, no terminal.
        </p>
        <Button variant="primary" onClick={() => setGithubModalOpen(true)}>
          Run a repository
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
      {qrSaved.length > 0 && (
        <div className="flex flex-col gap-0.5 px-3 pb-3">
          <span className="px-1 pb-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
            Recent
          </span>
          {qrSaved.map((item) => (
            <div key={item.repo} className="group flex items-center gap-1">
              <button
                onClick={() => setPendingRepo({ repo: item.repo, name: item.name })}
                title={item.repo}
                className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors"
                style={{ color: "var(--color-text)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {item.name}
              </button>
              <button
                onClick={() => qrForgetSaved(item.repo)}
                title="Remove from recent"
                className="shrink-0 rounded px-1 text-[12px] opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--color-text-muted)" }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {qrWindows.length > 0 && (
        <div className="flex flex-col gap-0.5 px-3 pb-3">
          <span className="px-1 pb-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
            Running
          </span>
          {qrWindows.map((window) => (
            <div key={window.url} className="group flex items-center gap-1">
              <button
                onClick={() => qrOpenAppWindow(window.url, window.name)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors"
                style={{ color: "var(--color-text)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--color-green)" }} />
                <span className="truncate">{window.name}</span>
              </button>
              <button
                onClick={() => qrCloseAppWindow(window.url)}
                title="Close window"
                className="shrink-0 rounded px-1 text-[12px] opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--color-text-muted)" }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {collections.length > 0 && (
        <div className="flex flex-col gap-0.5 px-3 pb-3">
          <span className="px-1 pb-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
            Collections
          </span>
          {collections.map((collection) => (
            <CollectionFolder key={collection.id} collection={collection} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 px-3 pb-3">
        <button
          onClick={() => setImportOpen(true)}
          className="w-full rounded-lg border border-dashed py-2 text-[12px] transition-colors"
          style={{ borderColor: "var(--color-border-strong)", color: "var(--color-text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          + Import a collection
        </button>
        <button
          onClick={() => setDiscoverOpen(true)}
          className="w-full rounded-lg border border-dashed py-2 text-[12px] transition-colors"
          style={{ borderColor: "var(--color-border-strong)", color: "var(--color-text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          + Discover tools
        </button>
      </div>

      {SHOW_LEGACY_TOOLS && (
        <>
          <div className="p-3 pt-0">
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
        </>
      )}

      </div>

      {githubModalOpen && <AddFromGithubModal onClose={() => setGithubModalOpen(false)} />}

      {importOpen && <ImportCollectionModal onClose={() => setImportOpen(false)} />}

      {discoverOpen && <DiscoverToolsModal onClose={() => setDiscoverOpen(false)} />}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {pendingRepo && (
        <ConfirmRunModal
          name={pendingRepo.name}
          onCancel={() => setPendingRepo(null)}
          onRun={(token) => {
            const repo = pendingRepo.repo;
            setPendingRepo(null);
            openQuickRun();
            qrRunSaved(repo, token);
          }}
        />
      )}
    </aside>
  );
}
