import { useToolStore } from "../../store/useToolStore";
import { Button } from "../shared/Button";

export function GitRequiredScreen() {
  const checkGit = useToolStore((s) => s.checkGit);

  return (
    <div
      className="flex h-screen w-screen flex-col items-center justify-center gap-4 px-8 text-center"
      style={{ background: "var(--color-page)" }}
    >
      <div className="text-[16px] font-medium">Git is required</div>
      <div className="max-w-sm text-[13px]" style={{ color: "var(--color-text-muted)" }}>
        Please install Git from git-scm.com to use Toolbox.
      </div>
      <Button variant="primary" onClick={() => checkGit()}>
        I've installed it — check again
      </Button>
    </div>
  );
}
