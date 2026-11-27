import type { Meta, StoryObj } from "@storybook/react-vite";
import { Search, X } from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const meta = { title: "Elements/Forms", tags: ["autodocs"] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Input: Story = {
  render: () => (
    <form className="w-full max-w-sm">
      <InputGroup>
        <InputGroupAddon>
          <Search className="ml-1 size-4 text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput aria-label="Search threads" placeholder="Search threads..." defaultValue="Storybook" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="reset" aria-label="Reset search">
            <X className="size-3.5" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  ),
};

export const TextArea: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <Textarea aria-label="Project notes" placeholder="Add project notes..." rows={3} />
      <Textarea aria-label="Read-only notes" defaultValue="Connect a project to edit these notes." disabled rows={2} />
    </div>
  ),
};

const themes = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const SelectMenu: Story = {
  render: () => (
    <Select items={themes} defaultValue="system">
      <SelectTrigger aria-label="Preferred theme" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {themes.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

const workspaces = ["Desktop", "Documentation", "Examples", "Extensions"];

export const SearchableCombobox: Story = {
  render: () => (
    <div className="w-full max-w-sm">
      <Combobox items={workspaces}>
        <ComboboxInput aria-label="Workspace" placeholder="Find a workspace..." showClear />
        <ComboboxContent>
          <ComboboxEmpty>No workspaces found.</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
};
