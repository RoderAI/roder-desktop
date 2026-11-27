import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const meta = { title: "Elements/Layout and feedback", tags: ["autodocs"] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const BadgesAndShortcuts: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Active</Badge>
      <Badge variant="secondary">Local</Badge>
      <Badge variant="outline">Draft</Badge>
      <Badge variant="muted">Archived</Badge>
      <Separator orientation="vertical" className="h-5" />
      <Kbd>Cmd</Kbd>
      <Kbd>K</Kbd>
    </div>
  ),
};

export const EmptyState: Story = {
  render: () => (
    <Empty className="max-w-md border border-dashed border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpen />
        </EmptyMedia>
        <EmptyTitle>No workspace selected</EmptyTitle>
        <EmptyDescription>Open a project folder to browse its files.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Open folder</Button>
      </EmptyContent>
    </Empty>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="grid w-64 gap-3">
      <div className="flex items-center gap-2" role="status">
        <DotMatrixSpinner /> Loading thread
      </div>
      <Separator />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  ),
};

export const TabStyles: Story = {
  render: () => (
    <div className="grid gap-5">
      {(["default", "line", "chrome"] as const).map((variant) => (
        <Tabs key={variant} defaultValue="files">
          <TabsList variant={variant} aria-label={`${variant} workspace tabs`}>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
          </TabsList>
          <TabsContent value="files">Workspace files</TabsContent>
          <TabsContent value="review">Changes to review</TabsContent>
        </Tabs>
      ))}
    </div>
  ),
};

export const ScrollableList: Story = {
  render: () => (
    <ScrollArea className="h-36 w-72 rounded-lg border border-border">
      <ul className="min-w-80 divide-y divide-border p-2">
        {Array.from({ length: 16 }, (_, index) => (
          <li className="px-2 py-1" key={index}>
            Workspace file {index + 1}
          </li>
        ))}
      </ul>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};
