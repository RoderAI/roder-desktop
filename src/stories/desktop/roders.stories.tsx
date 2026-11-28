import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { RoderAgentLinks } from "@/components/app-sidebar";
import { IssueConversation } from "@/components/roder-issue-conversation";
import type { RoderAgentTab } from "@/components/roder-agent-overview";
import { RoderAgentView } from "@/components/roder-agent-view";
import { useIssuesStore } from "@/lib/issues-ipc";
import { noop } from "./fixtures";
import {
  answerFixture,
  roderFileFixtures,
  roderFixture,
  roderIssueFixtures,
  roderProjectFixture,
  roderThreads,
  settingsIssue,
} from "./roder-fixtures";

const meta = { title: "Desktop/Roders" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-2xl bg-background p-4 text-base font-medium">{children}</div>;
}

function RoderView({ tab, issueId = null }: { tab: RoderAgentTab; issueId?: string | null }) {
  const [issues, setIssues] = useState(roderIssueFixtures);
  return (
    <Frame>
      <RoderAgentView
        roder={roderFixture}
        files={roderFileFixtures}
        projects={[roderProjectFixture]}
        issues={issues}
        threads={roderThreads}
        initialTab={tab}
        initialIssueId={issueId}
        onComment={async (id, text) => setIssues((current) => answerFixture(current, id, text))}
        onOpenThread={noop}
        onOpenPullRequest={noop}
      />
    </Frame>
  );
}

export const Overview: Story = { render: () => <RoderView tab="overview" /> };
export const Issues: Story = { render: () => <RoderView tab="issues" /> };
export const Threads: Story = { render: () => <RoderView tab="threads" /> };
export const Files: Story = { render: () => <RoderView tab="files" /> };
export const IssueDetail: Story = {
  name: "Issue conversation in the Issues tab",
  render: () => <RoderView tab="issues" issueId={settingsIssue.id} />,
};

function ConversationExample() {
  const [issues, setIssues] = useState([settingsIssue]);
  return (
    <Frame>
      <IssueConversation
        issue={issues[0]}
        threads={roderThreads}
        roderName={roderFixture.name}
        onOpenThread={noop}
        onOpenPullRequest={noop}
        onComment={async (text) => setIssues((current) => answerFixture(current, settingsIssue.id, text))}
      />
    </Frame>
  );
}
export const IssueConversationNeedsYou: Story = {
  name: "Issue conversation (needs you)",
  render: () => <ConversationExample />,
};

function SidebarExample() {
  const [router] = useState(() => {
    useIssuesStore.setState({ projects: [roderProjectFixture], issues: roderIssueFixtures, loaded: true });
    const root = createRootRoute({
      component: () => (
        <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
          <RoderAgentLinks
            roderAgents={[
              roderFixture,
              {
                ...roderFixture,
                id: "storybook-roder-2",
                name: "Docs Roder",
                threadId: "other",
                mission: "Keep the docs current.",
              },
            ]}
            error={null}
            loading={false}
            onRetry={noop}
            activeThreadId=""
            activeManagement={false}
            onSelectThread={noop}
          />
        </div>
      ),
    });
    return createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  });
  return <RouterProvider router={router} />;
}
export const SidebarNeedsYouCount: Story = {
  name: "Sidebar needs-you count",
  render: () => <SidebarExample />,
};
