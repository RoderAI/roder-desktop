import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { OnboardingReadyStep } from "@/components/onboarding/onboarding-ready";
import { OnboardingWelcomeStep } from "@/components/onboarding/onboarding-welcome";
import { ProjectConfigDialog } from "@/components/project-config-dialog";
import { SettingsView } from "@/components/settings-view";
import { Button } from "@/components/ui/button";
import type { SettingsSection } from "@/stores/theme-store";
import { models, noopAsync, workspace, workspacePath } from "./fixtures";

const meta = { title: "Desktop/Setup and settings" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const OnboardingWelcome: Story = {
  render: () => (
    <div className="mx-auto max-w-3xl">
      <OnboardingWelcomeStep />
    </div>
  ),
};

export const OnboardingReady: Story = {
  render: () => (
    <div className="mx-auto max-w-3xl">
      <OnboardingReadyStep
        providers={[]}
        readyProviderIds={new Set()}
        modelLabel={models[0].displayName ?? null}
        modelProviderId={models[0].modelProvider}
        project={workspace}
      />
    </div>
  ),
};

function SettingsExample() {
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [open, setOpen] = useState(true);
  return open ? (
    <SettingsView section={section} onClose={() => setOpen(false)} onSectionChange={setSection} />
  ) : (
    <Button className="m-4" onClick={() => setOpen(true)}>
      Open settings
    </Button>
  );
}

function SettingsWithRouter() {
  const [router] = useState(() => {
    const root = createRootRoute();
    const settings = createRoute({
      getParentRoute: () => root,
      path: "settings/$section",
      component: SettingsExample,
    });
    return createRouter({
      routeTree: root.addChildren([settings]),
      history: createMemoryHistory({ initialEntries: ["/settings/appearance"] }),
    });
  });

  return <RouterProvider router={router} />;
}

export const Settings: Story = { render: () => <SettingsWithRouter />, parameters: { layout: "fullscreen" } };

function ProjectExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New project</Button>
      <ProjectConfigDialog
        open={open}
        defaultPath={workspacePath}
        initialFolders={[workspacePath]}
        onOpenChange={setOpen}
        onCreateProject={noopAsync}
      />
    </>
  );
}

export const NewProject: Story = { render: () => <ProjectExample /> };
