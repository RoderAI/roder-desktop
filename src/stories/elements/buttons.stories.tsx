import type { Meta, StoryObj } from "@storybook/react-vite";
import { PanelRight, Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { chromeIconButtonClassNameForState } from "@/components/ui/chrome-icon-button";

const variants = [
  "default",
  "secondary",
  "accent",
  "success",
  "warning",
  "ghost",
  "outline",
  "subtle",
] as const satisfies NonNullable<ButtonProps["variant"]>[];
const meta = {
  title: "Elements/Buttons",
  component: Button,
  args: { children: "New thread", variant: "default", size: "default" },
  argTypes: {
    variant: { control: "select", options: variants },
    size: { control: "select", options: ["default", "sm", "compact", "icon", "icon-xs"] },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex max-w-xl flex-wrap gap-3">
      {variants.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button disabled>Disabled</Button>
      <Button size="icon" aria-label="New thread">
        <Plus className="size-4" />
      </Button>
      {[false, true].map((active) => (
        <button
          key={String(active)}
          type="button"
          aria-pressed={active}
          aria-label="Toggle workspace panel"
          className={chromeIconButtonClassNameForState(active)}
        >
          <PanelRight className="size-4" />
        </button>
      ))}
    </div>
  ),
};
