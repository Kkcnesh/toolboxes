import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useToolStore } from "../../store/useToolStore";
import { QuickRunEvent } from "../../types";
import { Button } from "../shared/Button";
import { LogView } from "./LogView";
import { StopButton } from "./StopButton";

const PRE_RUN = new Set(["researching", "analyzing", "starting", "repairing"]);

const PHASE: Record<string, string> = {
  researching: "Researching the project…",
  analyzing: "Figuring out how to run it…",
  starting: "Installing what it needs…",
  running: "Starting the app…",
  repairing: "Hit a snag — trying a fix…",
};

const PHASE_DETAIL: Record<string, string> = {
  researching: "Reading the project's documentation and issues.",
  analyzing: "Turning what it found into a run plan.",
  starting: "Installing dependencies and getting things ready.",
  running: "Launching the app — almost there.",
  repairing: "That didn't work, so it's trying a different setup.",
};

function taskColor(state: string): string {
  switch (state) {
    case "ready":
      return "var(--color-green)";
    case "starting":
      return "var(--color-amber)";
    case "exited":
      return "var(--color-text-faint)";
    default:
      return "var(--color-text-muted)";
  }
}

function failureMessage(events: QuickRunEvent[], statusMessage: string | undefined, error: string | null): string {
  const raw =
    [...events].reverse().find((event) => event.kind === "failed")?.text ??
    [...events].reverse().find((event) => event.severity === "error" || event.severity === "fatal")?.text ??
    error ??
    statusMessage ??
    "Something went wrong.";

  if (raw.includes("nothing detectable") || raw.includes("no quickrun.yml")) {
    return "We couldn't work out how to run this one. It may need a custom setup that isn't supported yet.";
  }

  return raw;
}

export function QuickRunRun() {
  const listen = useToolStore((s) => s.qrListenEvents);
  const qrResync = useToolStore((s) => s.qrResync);
  const close = useToolStore((s) => s.closeQuickRun);
  const reset = useToolStore((s) => s.qrReset);
  const qrAutorun = useToolStore((s) => s.qrAutorun);

  const summary = useToolStore((s) => s.qrSummary);
  const status = useToolStore((s) => s.qrStatus);
  const error = useToolStore((s) => s.qrError);
  const events = useToolStore((s) => s.qrEvents);
  const currentRepo = useToolStore((s) => s.qrCurrentRepo);
  const currentToken = useToolStore((s) => s.qrCurrentToken);
  const openAppWindow = useToolStore((s) => s.qrOpenAppWindow);
  const qrApprove = useToolStore((s) => s.qrApprove);
  const qrSupplyInputs = useToolStore((s) => s.qrSupplyInputs);
  const qrStop = useToolStore((s) => s.qrStop);
  const qrInputValues = useToolStore((s) => s.qrInputValues);
  const qrSetInputValue = useToolStore((s) => s.qrSetInputValue);
  const qrBrief = useToolStore((s) => s.qrBrief);
  const qrRunbook = useToolStore((s) => s.qrRunbook);
  const qrLoadRunbook = useToolStore((s) => s.qrLoadRunbook);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  // Register the QuickRun listeners only while this view is mounted.
  useEffect(() => {
    const unlisten = listen();
    return unlisten;
  }, [listen]);

  // Returning to an in-flight run: resync the authoritative state.
  useEffect(() => {
    const state = useToolStore.getState().qrSummary?.state;
    if (state === "running" || state === "stopping") qrResync();
  }, [qrResync]);

  const state = status?.state ?? "";
  const preRun = PRE_RUN.has(state);
  const running = state === "running";
  const ready = running && !!summary?.url;
  const busy = preRun || (running && !summary?.url);
  const done = state === "done";
  const failed = state === "failed" || state === "error";
  const reviewing =
    !busy && !failed && !ready && !done && (state === "review" || summary?.state === "awaitingInput");

  const percent = summary?.progress?.percent ?? 0;
  const canToggleDetails = events.length > 0 || (summary?.commands.length ?? 0) > 0;

  function handleClose() {
    close();
    reset();
  }

  function handleRebuild() {
    if (currentRepo) qrAutorun(currentRepo, currentToken, true);
  }

  async function handleShare() {
    const repo = currentRepo ?? summary?.repo;
    if (!repo) return;
    try {
      await navigator.clipboard.writeText(`gitrun://run?repo=${encodeURIComponent(repo)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; nothing to do
    }
  }

  async function handleProvide() {
    if (summary?.inputs && summary.inputs.length > 0) {
      await qrSupplyInputs();
    }
    await qrApprove();
  }

  async function handleCancelReview() {
    await qrStop();
    close();
    reset();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[14px] font-medium">QuickRun</span>
          {summary && (
            <span className="truncate text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {summary.displayName || summary.repo}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {currentRepo && !busy && (
            <button
              onClick={handleShare}
              title="Copy a share link"
              className="text-[12px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {copied ? "Copied" : "Share"}
            </button>
          )}
          {currentRepo && !busy && (
            <button
              onClick={handleRebuild}
              title="Regenerate the plan with AI"
              className="text-[12px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              Rebuild
            </button>
          )}
          <StopButton />
          <button onClick={handleClose} className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            Close
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
        {busy && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <span
              className="h-8 w-8 rounded-full border-2"
              style={{
                borderColor: "var(--color-border-strong)",
                borderTopColor: "var(--color-text)",
                animation: "var(--animate-spin-slow)",
              }}
            />
            <div className="text-[16px] font-medium">{PHASE[state] ?? "Working…"}</div>
            <div className="max-w-sm text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              {PHASE_DETAIL[state] ?? "Getting things ready."}
            </div>
            {summary && (
              <div className="flex w-full max-w-sm flex-col gap-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${percent}%`, background: "var(--color-accent)" }}
                  />
                </div>
                <div className="text-right text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                  {percent}%
                </div>
              </div>
            )}
            {summary?.tasks && summary.tasks.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {summary.tasks.map((task) => (
                  <span
                    key={task.name}
                    className="rounded-full border px-2 py-0.5 text-[11px]"
                    style={{ borderColor: taskColor(task.state), color: taskColor(task.state) }}
                  >
                    {task.name}: {task.state}
                  </span>
                ))}
              </div>
            )}

            {qrBrief?.summary && (
              <div
                className="w-full max-w-md rounded-lg border p-3 text-left text-[12px]"
                style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
              >
                <div className="mb-1 flex items-center gap-2 text-[10.5px]" style={{ color: "var(--color-text-faint)" }}>
                  <span
                    className="rounded-full border px-1.5 py-0.5"
                    style={{ borderColor: "var(--color-amber)", color: "var(--color-amber)" }}
                  >
                    TinyFish
                  </span>
                  found
                </div>
                <div
                  className="max-h-28 overflow-y-auto whitespace-pre-wrap"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {qrBrief.summary}
                </div>
                {qrBrief.sources.length > 0 && (
                  <button
                    onClick={() => open(qrBrief.sources[0])}
                    className="mt-1 text-[10.5px] underline"
                    style={{ color: "var(--color-text-faint)" }}
                  >
                    {qrBrief.sources.length} source{qrBrief.sources.length === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {reviewing && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[16px] font-medium">A few details first</div>
              <p className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                This project needs some values before it can run. Nothing has started yet.
              </p>
            </div>

            {summary?.inputs && summary.inputs.length > 0 && (
              <div className="flex flex-col gap-3">
                {summary.inputs.map((input) => (
                  <label key={input.id} className="flex flex-col gap-1 text-[12px]">
                    <span>
                      {input.label || input.id}
                      {input.required ? " *" : ""}
                    </span>
                    <input
                      type={input.type === "password" ? "password" : "text"}
                      value={qrInputValues[input.id] ?? input.default ?? ""}
                      onChange={(e) => qrSetInputValue(input.id, e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
                      style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
                    />
                    {input.description && (
                      <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                        {input.description}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}

            {qrBrief?.summary && (
              <div
                className="rounded-lg border p-3 text-[12px]"
                style={{ borderColor: "var(--color-border)", background: "var(--color-page)", color: "var(--color-text-muted)" }}
              >
                <div className="mb-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                  What the docs say
                </div>
                {qrBrief.summary}
              </div>
            )}

            {(summary?.commands.length ?? 0) > 0 && (
              <div
                className="rounded-lg border p-3 font-mono text-[11.5px]"
                style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
              >
                <div className="mb-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                  What will happen
                </div>
                {summary?.commands.map((command, index) => (
                  <div key={index} className="whitespace-pre-wrap">
                    {command.command}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="primary" onClick={handleProvide}>
                Run
              </Button>
              <Button variant="secondary" onClick={handleCancelReview}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {failed && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="text-[16px] font-medium">Couldn't get this app running</div>
            <div
              className="max-w-md rounded-lg border p-3 text-[12.5px]"
              style={{ borderColor: "var(--color-red)", color: "var(--color-red)", background: "var(--color-page)" }}
            >
              {failureMessage(events, status?.message, error)}
            </div>
            <div className="flex gap-2">
              {currentRepo && (
                <Button variant="primary" onClick={handleRebuild}>
                  Try again
                </Button>
              )}
              <Button variant="secondary" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}

        {ready && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="text-[16px] font-medium">Your app is ready</div>
            <div className="max-w-md break-all font-mono text-[13px]" style={{ color: "var(--color-accent)" }}>
              {summary?.url}
            </div>
            {summary?.tasks && summary.tasks.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {summary.tasks.map((task) => (
                  <span
                    key={task.name}
                    className="rounded-full border px-2 py-0.5 text-[11px]"
                    style={{ borderColor: taskColor(task.state), color: taskColor(task.state) }}
                  >
                    {task.name}: {task.state}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => summary?.url && openAppWindow(summary.url, summary.displayName || summary.repo)}
              >
                Open in GitRun
              </Button>
              <Button variant="secondary" onClick={() => summary?.url && open(summary.url)}>
                Open in browser
              </Button>
              {currentRepo && (
                <Button variant="secondary" onClick={() => qrLoadRunbook(currentRepo)}>
                  How to use
                </Button>
              )}
            </div>

            {qrRunbook && qrRunbook.steps.length > 0 && (
              <div
                className="w-full max-w-md rounded-lg border p-3 text-left text-[12px]"
                style={{ borderColor: "var(--color-border)", background: "var(--color-page)", color: "var(--color-text-muted)" }}
              >
                <div className="mb-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                  How to use it
                </div>
                <ol className="list-decimal pl-4">
                  {qrRunbook.steps.map((step, index) => (
                    <li key={index} className="mb-1">
                      {step}
                    </li>
                  ))}
                </ol>
                {qrRunbook.done_when && <div className="mt-1">Done when: {qrRunbook.done_when}</div>}
              </div>
            )}
          </div>
        )}

        {done && !ready && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="text-[16px] font-medium">{status?.message || "Finished"}</div>
            <Button variant="secondary" onClick={reset}>
              Start another
            </Button>
          </div>
        )}

        {!busy && !failed && !ready && !done && (
          <div className="flex flex-1 items-center justify-center text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>
            Paste a GitHub URL to get started.
          </div>
        )}

        {canToggleDetails && (
          <div className="mt-auto border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
            <button
              onClick={() => setShowDetails((value) => !value)}
              className="text-[11px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <div className="mt-2 flex flex-col gap-2">
                {summary && summary.commands.length > 0 && (
                  <div
                    className="flex flex-col gap-1 rounded-lg border p-3 font-mono text-[11.5px]"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
                  >
                    {summary.commands.map((command, index) => (
                      <div key={index} className="whitespace-pre-wrap">
                        <span style={{ color: "var(--color-text-faint)" }}>
                          {command.phase} · {command.name}:{" "}
                        </span>
                        {command.command}
                        {command.cwd ? `   (in ${command.cwd})` : ""}
                      </div>
                    ))}
                  </div>
                )}
                <LogView />
                {qrBrief?.summary && (
                  <div
                    className="rounded-lg border p-3 text-[12px]"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-page)", color: "var(--color-text-muted)" }}
                  >
                    <div className="mb-1 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                      What the docs say
                    </div>
                    {qrBrief.summary}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
