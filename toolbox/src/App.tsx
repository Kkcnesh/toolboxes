import { useEffect } from "react";
import { useToolStore } from "./store/useToolStore";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TabBar } from "./components/TabBar/TabBar";
import { ToolPanel } from "./components/ToolPanel/ToolPanel";

export default function App() {
  const loadTools = useToolStore((s) => s.loadTools);
  const listenToEvents = useToolStore((s) => s.listenToEvents);

  // The QuickRun workflow does not depend on GitRun's own Python runtime or a
  // bundled git check, so the old startup gate is gone. The legacy tool list and
  // its events are kept (not deleted) for now.
  useEffect(() => {
    loadTools();
    const unlisten = listenToEvents();
    return unlisten;
  }, [loadTools, listenToEvents]);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: "var(--color-page)" }}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col" style={{ background: "var(--color-surface)" }}>
        <TabBar />
        <div className="min-h-0 flex-1">
          <ToolPanel />
        </div>
      </div>
    </div>
  );
}
