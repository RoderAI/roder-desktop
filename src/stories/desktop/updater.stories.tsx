import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings } from "lucide-react";
import { useRef, useState } from "react";
import { SidebarUpdatePill } from "@/components/sidebar-update-button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { AppUpdateStatus } from "@/lib/app-update";

const versions = { currentVersion: "0.1.17", availableVersion: "0.1.18" };
const available: AppUpdateStatus = { ...versions, state: "available" };
const demoDurationMs = 4200;
const finishingDurationMs = 650;

function UpdatePreview({ showPercent }: { showPercent: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<AppUpdateStatus>(available);
  const timer = useRef<number | undefined>(undefined);
  useMountEffect(() => () => window.clearInterval(timer.current));

  function advance(): void {
    if (status.state === "ready") {
      setStatus(available);
      return;
    }
    if (timer.current !== undefined) return;

    const download = { ...versions, state: "downloading" } as const;
    const startedAt = performance.now();
    setStatus(showPercent ? { ...download, percent: 0 } : download);
    timer.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      if (elapsed >= demoDurationMs + finishingDurationMs) {
        window.clearInterval(timer.current);
        timer.current = undefined;
        setStatus({ ...versions, state: "ready" });
      } else if (showPercent) {
        setStatus({ ...download, percent: Math.min(100, (elapsed / demoDurationMs) * 100) });
      }
    }, 80);
  }

  return (
    <section className="w-72 space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-sidebar p-2 text-sidebar-foreground">
        <span className="inline-flex min-w-0 flex-1 items-center gap-2 px-2 text-base font-medium">
          <Settings className="size-4 shrink-0" aria-hidden="true" />
          Settings
        </span>
        <SidebarUpdatePill status={status} onClick={advance} />
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {showPercent
          ? "The outline fills as the simulated download progresses."
          : "The loader loops around the outline when the native updater has no percentage data."}{" "}
        Click Update to start and Restart to replay. This preview does not install anything.
      </p>
    </section>
  );
}

const meta = {
  title: "Desktop/Updater",
  component: UpdatePreview,
  parameters: { layout: "centered" },
} satisfies Meta<typeof UpdatePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DownloadProgress: Story = { args: { showPercent: true } };
export const NativeDownload: Story = { args: { showPercent: false } };
