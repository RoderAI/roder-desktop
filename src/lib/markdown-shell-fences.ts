import { isMarkdownShellLanguage } from "./markdown-shell-command";

export const previewShellPrefix = "roder-preview-";

type MarkdownNode = {
  type: string;
  lang?: string | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MarkdownNode[];
};

export function markUnclosedShellFences() {
  return (tree: MarkdownNode, file: { toString(): string }) => {
    const source = file.toString();

    function visit(node: MarkdownNode, topLevel: boolean) {
      if (node.type === "code" && isMarkdownShellLanguage(node.lang)) {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        const raw = start !== undefined && end !== undefined ? source.slice(start, end) : "";
        const lines = raw.split(/\r\n?|\n/);
        const opener = /^(`{3,}|~{3,})/.exec(lines[0])?.[1];
        const closer = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines.at(-1) ?? "")?.[1];
        // Only an explicit closing fence in a top-level block is eligible to run.
        if (
          !topLevel ||
          lines.length < 2 ||
          !opener ||
          !closer ||
          closer[0] !== opener[0] ||
          closer.length < opener.length
        ) {
          node.lang = `${previewShellPrefix}${node.lang}`;
        }
      }
      for (const child of node.children ?? []) visit(child, node.type === "root");
    }

    visit(tree, false);
  };
}
