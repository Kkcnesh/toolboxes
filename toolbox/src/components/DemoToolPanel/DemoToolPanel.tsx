import { useToolStore } from "../../store/useToolStore";
import { Button } from "../shared/Button";

export function DemoToolPanel() {
  const demo = useToolStore((s) => s.qrDemoTool);
  const collections = useToolStore((s) => s.qrCollections);
  const close = useToolStore((s) => s.qrCloseDemoTool);

  if (!demo) return null;

  const collection = collections.find((item) => item.id === demo.collectionId);
  const { tool } = demo;

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 shrink-0 rounded-xl" style={{ background: tool.color }} />
          <div>
            <div className="text-[15px] font-medium">{tool.name}</div>
            <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
              {tool.category}
              {tool.tag ? ` · ${tool.tag}` : ""}
              {collection ? ` · ${collection.name}` : ""}
            </div>
          </div>
        </div>
        <button onClick={close} className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          Close
        </button>
      </div>

      <p className="text-[13px] leading-relaxed" style={{ color: "var(--color-text)" }}>
        {tool.description}
      </p>

      <div
        className="rounded-lg border p-3 text-[12.5px] leading-relaxed"
        style={{ borderColor: "var(--color-border)", background: "var(--color-page)", color: "var(--color-text-muted)" }}
      >
        <span
          className="mb-1 inline-block rounded-full border px-2 py-0.5 text-[10.5px]"
          style={{ borderColor: "var(--color-amber)", color: "var(--color-amber)" }}
        >
          Demo catalogue
        </span>
        <div>
          This is a static catalogue entry. Running it isn't enabled in this build — it shows how an
          imported collection appears inside GitRun.
        </div>
      </div>

      <div className="mt-auto">
        <Button variant="secondary" onClick={close}>
          Back
        </Button>
      </div>
    </div>
  );
}
