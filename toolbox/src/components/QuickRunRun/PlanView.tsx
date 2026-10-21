import { useToolStore } from "../../store/useToolStore";
import { QuickRunInput } from "../../types";
import { Button } from "../shared/Button";

function InputField({ input }: { input: QuickRunInput }) {
  const value = useToolStore((s) => s.qrInputValues[input.id] ?? "");
  const setValue = useToolStore((s) => s.qrSetInputValue);
  const isPassword = input.type === "password";
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
        {input.label ?? input.id}
        {input.required ? " *" : ""}
      </span>
      <input
        type={isPassword ? "password" : "text"}
        value={value}
        onChange={(e) => setValue(input.id, e.target.value)}
        placeholder={input.default ?? ""}
        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: "var(--color-border-strong)", background: "var(--color-surface)" }}
      />
    </label>
  );
}

export function PlanView() {
  const summary = useToolStore((s) => s.qrSummary);
  const approve = useToolStore((s) => s.qrApprove);
  const cancel = useToolStore((s) => s.qrCancel);
  const supplyInputs = useToolStore((s) => s.qrSupplyInputs);
  const error = useToolStore((s) => s.qrError);

  if (!summary) return null;

  const needsInputs = summary.state === "awaitingInput";
  const requiredInputs = (summary.inputs ?? []).filter((i) => i.required);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5">
      <div className="flex flex-col gap-1">
        <div className="text-[15px] font-medium">{summary.displayName || summary.repo}</div>
        <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          {summary.repo} · ref {summary.ref}
          {summary.commit ? ` · ${summary.commit.slice(0, 7)}` : ""}
        </div>
      </div>

      {summary.provisions && summary.provisions.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}>
          {summary.provisions.map((p, i) => (
            <div key={i} style={{ color: "var(--color-amber)" }}>
              {p}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
          These commands will run:
        </span>
        <div
          className="flex flex-col gap-2 rounded-lg border p-3 font-mono text-[12.5px]"
          style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
        >
          {summary.commands.map((c, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
                {c.phase} · {c.name}
              </span>
              <span className="whitespace-pre-wrap">
                {c.command}
                {c.cwd ? `   (in ${c.cwd})` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {needsInputs && (
        <div
          className="flex flex-col gap-3 rounded-lg border p-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}
        >
          <span className="text-[12px] font-medium">This project needs some values before it can run:</span>
          {requiredInputs.map((input) => (
            <InputField key={input.id} input={input} />
          ))}
          <div className="flex justify-end">
            <Button variant="primary" onClick={supplyInputs}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border p-3 text-[12.5px]" style={{ borderColor: "var(--color-red)", color: "var(--color-red)" }}>
          {error}
        </div>
      )}

      {!needsInputs && (
        <div className="mt-auto flex justify-end gap-2 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={approve}>
            Approve & run
          </Button>
        </div>
      )}
    </div>
  );
}
