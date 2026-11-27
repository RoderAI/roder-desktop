import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const meta = { title: "Elements/Overlays", tags: ["autodocs"] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Dropdown: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger>Workspace actions</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem>Rename workspace</DropdownMenuItem>
          <DropdownMenuItem>Copy path</DropdownMenuItem>
          <DropdownMenuItem disabled>Archive workspace</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const RightClickMenu: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="grid h-24 w-64 place-items-center rounded-lg border border-dashed border-input text-muted-foreground">
        Right-click this area
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem>Open in editor</ContextMenuItem>
          <ContextMenuItem>Copy relative path</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const ModalDialog: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive thread?</DialogTitle>
          <DialogDescription>Archived threads are removed from the sidebar.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <DialogClose render={<Button />}>Archive thread</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

function CommandExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open command palette</Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search desktop commands">
        <Command>
          <CommandInput placeholder="Search desktop commands..." />
          <CommandList>
            <CommandEmpty>No commands found.</CommandEmpty>
            <CommandGroup heading="Thread">
              <CommandItem onSelect={() => setOpen(false)}>
                New thread <CommandShortcut>Cmd+N</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Workspace">
              <CommandItem onSelect={() => setOpen(false)}>Find a file</CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>Open settings</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

export const CommandPalette: Story = { render: () => <CommandExample /> };

export const HoverTooltip: Story = {
  render: () => (
    <div className="pt-8">
      <Tooltip>
        <TooltipTrigger render={<Button size="icon" variant="ghost" aria-label="Toggle right panel" />}>
          <PanelRight className="size-4" />
        </TooltipTrigger>
        <TooltipContent>
          Toggle right panel <Kbd>Cmd+\</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
};
