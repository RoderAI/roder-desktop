import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownShellProvider } from "@/components/markdown-shell-block";
import { MessageContent } from "@/components/message-content";
import { storybookShellTarget } from "./fixtures";

const meta = {
  title: "Desktop/Markdown",
  component: MessageContent,
  args: { isStreaming: false },
  argTypes: { text: { control: "text" } },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <MarkdownShellProvider target={storybookShellTarget}>
          <Story />
        </MarkdownShellProvider>
      </div>
    ),
  ],
} satisfies Meta<typeof MessageContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShellCodeBlock: Story = {
  args: {
    text: ["```sh", 'open "$HOME/Applications/Roder 0.1.17 Local.app"', "```"].join("\n"),
  },
};

export const BashCodeBlock: Story = {
  args: {
    text: ["```bash", "# Start the desktop UI catalog", "pnpm install --frozen-lockfile", "pnpm storybook", "```"].join(
      "\n",
    ),
  },
};
