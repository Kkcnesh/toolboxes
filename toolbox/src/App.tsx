import { useEffect, useState } from "react";
import { useToolStore } from "./store/useToolStore";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { TabBar } from "./components/TabBar/TabBar";
import { ToolPanel } from "./components/ToolPanel/ToolPanel";
import { SetupScreen } from "./components/Setup/SetupScreen";
import { GitRequiredScreen } from "./components/Setup/GitRequiredScreen";

type StartupPhase = "checking" | "needs-git" | "needs-runtime" | "ready";

export default function App() {
  const loadTools = useToolStore((s) => s.loadTools);
  const listenToEvents = useToolStore((s) => s.listenToEvents);
  const listenToRuntimeEvents = useToolStore((s) => s.listenToRuntimeEvents);
  const checkGit = useToolStore((s) => s.checkGit);
  const checkRuntime = useToolStore((s) => s.checkRuntime);
  const gitInstalled = useToolStore((s) => s.gitInstalled);
  const runtimeReady = useToolStore((s) => s.runtimeReady);

  const [phase, setPhase] = useState<StartupPhase>("checking");

  useEffect(() => {
    (async () => {
      const hasGit = await checkGit();
      if (!hasGit) {
        setPhase("needs-git");
        return;
      }
      const hasRuntime = await checkRuntime();
      setPhase(hasRuntime ? "ready" : "needs-runtime");
    })();
  }, [checkGit, checkRuntime]);

  useEffect(() => {
    if (phase === "needs-git" && gitInstalled) {
      checkRuntime().then((hasRuntime) => setPhase(hasRuntime ? "ready" : "needs-runtime"));
    }
  }, [phase, gitInstalled, checkRuntime]);

  useEffect(() => {
    if (phase === "needs-runtime" && runtimeReady) {
      setPhase("ready");
    }
  }, [phase, runtimeReady]);

  useEffect(() => {
    const unlisten = listenToRuntimeEvents();
    return unlisten;
  }, [listenToRuntimeEvents]);

  useEffect(() => {
    if (phase !== "ready") return;
    loadTools();
    const unlisten = listenToEvents();
    return unlisten;
  }, [phase, loadTools, listenToEvents]);

  if (phase === "checking") {
    return <div className="h-screen w-screen" style={{ background: "var(--color-page)" }} />;
  }

  if (phase === "needs-git") {
    return <GitRequiredScreen />;
  }

  if (phase === "needs-runtime") {
    return <SetupScreen />;
  }

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
